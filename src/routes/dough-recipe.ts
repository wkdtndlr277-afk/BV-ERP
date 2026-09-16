import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const dough = new Hono<{ Bindings: Bindings }>()

// ============================================================
// 반죽(sub-recipe) 마스터
// ============================================================

// GET /api/dough/list - 모든 반죽 + 배합 정보
dough.get('/list', async (c) => {
  try {
    const recipesRes = await c.env.DB.prepare(`
      SELECT * FROM dough_recipe WHERE is_active = 1 ORDER BY dough_name
    `).all()
    const recipes = (recipesRes.results as any[]) || []

    const materialsRes = await c.env.DB.prepare(`
      SELECT * FROM dough_material ORDER BY dough_code, id
    `).all()
    const materials = (materialsRes.results as any[]) || []

    const matByDough: Record<string, any[]> = {}
    for (const m of materials) {
      if (!matByDough[m.dough_code]) matByDough[m.dough_code] = []
      matByDough[m.dough_code].push(m)
    }

    const data = recipes.map(r => ({
      ...r,
      materials: matByDough[r.dough_code] || [],
      total_ratio: (matByDough[r.dough_code] || []).reduce((s: number, m: any) => s + (m.quantity_per_kg || 0), 0)
    }))

    return c.json({ success: true, data })
  } catch (e: any) {
    if (e.message?.includes('no such table')) {
      return c.json({ success: true, data: [], needs_migration: true })
    }
    return c.json({ success: false, error: e.message }, 500)
  }
})

// POST /api/dough/save - 반죽 생성/수정 (원료 배합 포함)
// body: { dough_code, dough_name, dough_name_en, batch_size_kg, memo, materials: [{material_name, quantity_per_kg, memo}] }
dough.post('/save', async (c) => {
  try {
    const b = await c.req.json()
    if (!b.dough_code || !b.dough_name) {
      return c.json({ success: false, error: 'dough_code, dough_name 필수' }, 400)
    }
    // upsert
    await c.env.DB.prepare(`
      INSERT INTO dough_recipe (dough_code, dough_name, dough_name_en, batch_size_kg, memo)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(dough_code) DO UPDATE SET
        dough_name = excluded.dough_name,
        dough_name_en = excluded.dough_name_en,
        batch_size_kg = excluded.batch_size_kg,
        memo = excluded.memo,
        updated_at = CURRENT_TIMESTAMP
    `).bind(b.dough_code, b.dough_name, b.dough_name_en || null, b.batch_size_kg || 40, b.memo || null).run()

    // 재료 재작성 (전삭 후 삽입)
    await c.env.DB.prepare(`DELETE FROM dough_material WHERE dough_code = ?`).bind(b.dough_code).run()
    if (Array.isArray(b.materials)) {
      for (const m of b.materials) {
        if (!m.material_name || !m.quantity_per_kg) continue
        await c.env.DB.prepare(`
          INSERT INTO dough_material (dough_code, material_code, material_name, quantity_per_kg, memo)
          VALUES (?, ?, ?, ?, ?)
        `).bind(b.dough_code, m.material_code || null, m.material_name, Number(m.quantity_per_kg), m.memo || null).run()
      }
    }
    return c.json({ success: true, dough_code: b.dough_code })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// DELETE /api/dough/:code
dough.delete('/:code', async (c) => {
  try {
    const code = c.req.param('code')
    await c.env.DB.prepare(`UPDATE dough_recipe SET is_active = 0 WHERE dough_code = ?`).bind(code).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ============================================================
// 제품 ↔ 반죽 사용량 매핑
// ============================================================

// GET /api/dough/product-usage - 전체 매핑 조회
dough.get('/product-usage', async (c) => {
  try {
    const res = await c.env.DB.prepare(`
      SELECT pdu.*, dr.dough_name, dr.batch_size_kg
      FROM product_dough_usage pdu
      LEFT JOIN dough_recipe dr ON pdu.dough_code = dr.dough_code
      ORDER BY pdu.production_code
    `).all()
    return c.json({ success: true, data: res.results || [] })
  } catch (e: any) {
    if (e.message?.includes('no such table')) return c.json({ success: true, data: [] })
    return c.json({ success: false, error: e.message }, 500)
  }
})

// POST /api/dough/product-usage - 제품 반죽 사용량 저장
// body: { production_code, dough_code, dough_g_per_product, memo }
dough.post('/product-usage', async (c) => {
  try {
    const b = await c.req.json()
    if (!b.production_code || !b.dough_code || !b.dough_g_per_product) {
      return c.json({ success: false, error: 'production_code, dough_code, dough_g_per_product 필수' }, 400)
    }
    // 제품명 조회
    const p = await c.env.DB.prepare(`
      SELECT production_name FROM production_items WHERE production_code = ?
    `).bind(b.production_code).first() as any

    // 기존 삭제 후 재삽입 (한 제품 = 한 반죽만 가정 — 필요시 확장 가능)
    await c.env.DB.prepare(`
      DELETE FROM product_dough_usage WHERE production_code = ? AND dough_code = ?
    `).bind(b.production_code, b.dough_code).run()

    await c.env.DB.prepare(`
      INSERT INTO product_dough_usage (production_code, production_name, dough_code, dough_g_per_product, memo)
      VALUES (?, ?, ?, ?, ?)
    `).bind(b.production_code, p?.production_name || null, b.dough_code, Number(b.dough_g_per_product), b.memo || null).run()

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// POST /api/dough/product-usage/bulk - 여러 매핑 한번에
// body: { rows: [{production_code, dough_code, dough_g_per_product}] }
dough.post('/product-usage/bulk', async (c) => {
  try {
    const { rows } = await c.req.json()
    if (!Array.isArray(rows)) return c.json({ success: false, error: 'rows 배열 필요' }, 400)
    let saved = 0
    for (const r of rows) {
      if (!r.production_code || !r.dough_code || !r.dough_g_per_product) continue
      const p = await c.env.DB.prepare(`
        SELECT production_name FROM production_items WHERE production_code = ?
      `).bind(r.production_code).first() as any
      await c.env.DB.prepare(`
        DELETE FROM product_dough_usage WHERE production_code = ? AND dough_code = ?
      `).bind(r.production_code, r.dough_code).run()
      await c.env.DB.prepare(`
        INSERT INTO product_dough_usage (production_code, production_name, dough_code, dough_g_per_product, memo)
        VALUES (?, ?, ?, ?, ?)
      `).bind(r.production_code, p?.production_name || null, r.dough_code, Number(r.dough_g_per_product), r.memo || null).run()
      saved++
    }
    return c.json({ success: true, saved })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// DELETE /api/dough/product-usage/:id
dough.delete('/product-usage/:id', async (c) => {
  try {
    await c.env.DB.prepare(`DELETE FROM product_dough_usage WHERE id = ?`).bind(c.req.param('id')).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ============================================================
// 반죽 벌크 임포트 (엑셀 재료체크시트 기반)
// POST /api/dough/bulk-import
// body: { doughs: [{dough_code, dough_name, dough_name_en, batch_size_kg, memo, materials:[...]}] }
// ============================================================
dough.post('/bulk-import', async (c) => {
  try {
    const { doughs } = await c.req.json()
    if (!Array.isArray(doughs) || doughs.length === 0) {
      return c.json({ success: false, error: 'doughs 배열 필요' }, 400)
    }
    let created = 0, updated = 0, matCount = 0
    for (const d of doughs) {
      if (!d.dough_code || !d.dough_name) continue
      // upsert dough
      const existing = await c.env.DB.prepare(
        `SELECT dough_code FROM dough_recipe WHERE dough_code = ?`
      ).bind(d.dough_code).first()

      await c.env.DB.prepare(`
        INSERT INTO dough_recipe (dough_code, dough_name, dough_name_en, batch_size_kg, memo, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT(dough_code) DO UPDATE SET
          dough_name = excluded.dough_name,
          dough_name_en = excluded.dough_name_en,
          batch_size_kg = excluded.batch_size_kg,
          memo = COALESCE(excluded.memo, dough_recipe.memo),
          is_active = 1,
          updated_at = CURRENT_TIMESTAMP
      `).bind(
        d.dough_code,
        d.dough_name,
        d.dough_name_en || null,
        Number(d.batch_size_kg) || 40,
        d.memo || null
      ).run()
      if (existing) updated++; else created++

      // 배합비가 제공된 경우에만 재작성 (없으면 기존 유지)
      if (Array.isArray(d.materials) && d.materials.length > 0) {
        await c.env.DB.prepare(
          `DELETE FROM dough_material WHERE dough_code = ?`
        ).bind(d.dough_code).run()
        for (const m of d.materials) {
          if (!m.material_name) continue
          const qty = Number(m.quantity_per_kg)
          if (!qty || qty <= 0) continue
          await c.env.DB.prepare(`
            INSERT INTO dough_material (dough_code, material_code, material_name, quantity_per_kg, memo)
            VALUES (?, ?, ?, ?, ?)
          `).bind(
            d.dough_code,
            m.material_code || null,
            m.material_name,
            qty,
            m.memo || null
          ).run()
          matCount++
        }
      }
    }
    return c.json({ success: true, created, updated, materials_saved: matCount })
  } catch (e: any) {
    if (e.message?.includes('no such table')) {
      return c.json({ success: false, error: '테이블 없음. 마이그레이션 0042 필요', needs_migration: true }, 500)
    }
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ============================================================
// 원료 마스터 벌크 임포트 (재료체크시트 기반)
// POST /api/dough/import-materials-master
// body: { materials: [{name, memo}], prefix?: 'RM' }
// - master 테이블에 category='원료'로 저장
// - 자동 코드 생성 (기존 최대 RMxxxx +1부터)
// - 중복 이름은 스킵 (이미 등록된 원료명은 건너뛴다)
// ============================================================
dough.post('/import-materials-master', async (c) => {
  try {
    const { materials, prefix } = await c.req.json()
    if (!Array.isArray(materials) || materials.length === 0) {
      return c.json({ success: false, error: 'materials 배열 필요' }, 400)
    }
    const codePrefix = (prefix || 'RM').toUpperCase()

    // 기존 원료 목록 조회 (이름/코드 중복 확인용)
    const existRes = await c.env.DB.prepare(`
      SELECT item_code, item_name FROM master WHERE category = '원료'
    `).all()
    const existRows = (existRes.results as any[]) || []
    const existNames = new Set(existRows.map(r => (r.item_name || '').trim()))
    // 다음 코드 번호 산출
    let maxNum = 0
    const re = new RegExp('^' + codePrefix + '(\\d+)$')
    for (const r of existRows) {
      const m = String(r.item_code || '').match(re)
      if (m) {
        const n = parseInt(m[1], 10)
        if (n > maxNum) maxNum = n
      }
    }

    let inserted = 0, skipped = 0
    const insertedList: Array<{ item_code: string; item_name: string }> = []
    const skippedList: string[] = []

    for (const m of materials) {
      const name = String(m.name || '').trim()
      if (!name) continue
      if (existNames.has(name)) {
        skipped++
        skippedList.push(name)
        continue
      }
      maxNum++
      const code = codePrefix + String(maxNum).padStart(4, '0')
      try {
        await c.env.DB.prepare(`
          INSERT INTO master (item_code, item_name, category, unit, current_stock, safety_stock, expiry_days)
          VALUES (?, ?, '원료', 'kg', 0, 0, 365)
        `).bind(code, name).run()
        inserted++
        insertedList.push({ item_code: code, item_name: name })
        existNames.add(name)

        // memo가 있으면 haccp_variance_threshold의 memo 슬롯에는 넣지 말고 무시.
        // (원료 마스터 스키마에는 memo 컬럼 없음)
      } catch (err: any) {
        skipped++
        skippedList.push(name + ' (' + err.message + ')')
        maxNum--  // rollback code counter
      }
    }

    return c.json({
      success: true,
      inserted,
      skipped,
      inserted_list: insertedList,
      skipped_list: skippedList,
      total: materials.length
    })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ============================================================
// 초기 반죽 시딩 (엑셀 재료체크시트 기반 8종 반죽 자동 등록)
// POST /api/dough/seed-defaults - 기본 반죽 8종 (배합 비율 없음, 사용자가 채워야 함)
// ============================================================
dough.post('/seed-defaults', async (c) => {
  try {
    const defaults = [
      { code: 'DOUGH_LEVAIN', name: '발효종르방', en: 'Levain', batch: 40 },
      { code: 'DOUGH_POLISH', name: '폴리쉬', en: 'Polish', batch: 40 },
      { code: 'DOUGH_WW_LEVAIN', name: '통밀르방', en: 'Whole Wheat Levain', batch: 40 },
      { code: 'DOUGH_WW_POLISH', name: '통밀폴리쉬', en: 'Whole Wheat Polish', batch: 40 },
      { code: 'DOUGH_TANGJONG', name: '탕종', en: 'TangJong', batch: 40 },
      { code: 'DOUGH_WW_TANGJONG', name: '통밀 탕종', en: 'Whole Wheat TangJong', batch: 40 },
      { code: 'DOUGH_RICE_LEVAIN', name: '쌀르방', en: 'Rice Levain', batch: 40 },
      { code: 'DOUGH_RICE_TANGJONG', name: '쌀탕종', en: 'Rice TangJong', batch: 40 },
    ]
    let seeded = 0
    for (const d of defaults) {
      const res = await c.env.DB.prepare(`
        INSERT OR IGNORE INTO dough_recipe (dough_code, dough_name, dough_name_en, batch_size_kg)
        VALUES (?, ?, ?, ?)
      `).bind(d.code, d.name, d.en, d.batch).run()
      if ((res.meta as any).changes > 0) seeded++
    }
    return c.json({ success: true, seeded, total: defaults.length })
  } catch (e: any) {
    if (e.message?.includes('no such table')) {
      return c.json({ success: false, error: '테이블 없음. 마이그레이션 필요', needs_migration: true }, 500)
    }
    return c.json({ success: false, error: e.message }, 500)
  }
})

export default dough
