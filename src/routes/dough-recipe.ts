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
