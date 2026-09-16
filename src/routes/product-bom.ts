import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const bom = new Hono<{ Bindings: Bindings }>()

// ============================================================
// 제품 BOM (완제품 배합) 관리 API
// ============================================================

// 자기 초기화(마이그레이션 없이도 동작)
async function ensureTables(DB: D1Database) {
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS product_bom_material (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      production_code TEXT NOT NULL,
      production_name TEXT,
      bom_source_name TEXT,
      material_name TEXT NOT NULL,
      material_code TEXT,
      quantity_per_unit_g REAL NOT NULL,
      unit TEXT DEFAULT 'g',
      seq INTEGER DEFAULT 0,
      memo TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run()
  await DB.prepare(`CREATE INDEX IF NOT EXISTS idx_pbm_prod ON product_bom_material(production_code)`).run()
  await DB.prepare(`CREATE INDEX IF NOT EXISTS idx_pbm_mat ON product_bom_material(material_name)`).run()
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS product_bom_mapping (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      production_code TEXT NOT NULL UNIQUE,
      production_name TEXT NOT NULL,
      bom_source_name TEXT,
      match_type TEXT,
      match_score REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run()
}

// POST /api/product-bom/init - 테이블 자체 초기화 (마이그레이션 대체)
bom.post('/init', async (c) => {
  try {
    await ensureTables(c.env.DB)
    return c.json({ success: true, message: 'product_bom_material, product_bom_mapping 테이블 준비 완료' })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// GET /api/product-bom/status - 요약 통계
bom.get('/status', async (c) => {
  try {
    await ensureTables(c.env.DB)
    const total = await c.env.DB.prepare(`SELECT COUNT(*) as n FROM product_bom_material`).first() as any
    const unique = await c.env.DB.prepare(`SELECT COUNT(DISTINCT production_code) as n FROM product_bom_material`).first() as any
    const mapping = await c.env.DB.prepare(`SELECT COUNT(*) as n FROM product_bom_mapping`).first() as any
    const matched = await c.env.DB.prepare(`SELECT COUNT(*) as n FROM product_bom_mapping WHERE match_type != 'unmatched'`).first() as any
    return c.json({
      success: true,
      total_bom_rows: total?.n || 0,
      products_with_bom: unique?.n || 0,
      total_mappings: mapping?.n || 0,
      matched: matched?.n || 0
    })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// GET /api/product-bom/list - 제품별 BOM 리스트
bom.get('/list', async (c) => {
  try {
    await ensureTables(c.env.DB)
    const res = await c.env.DB.prepare(`
      SELECT * FROM product_bom_material ORDER BY production_code, seq, id
    `).all()
    const rows = (res.results as any[]) || []
    const grouped: Record<string, any> = {}
    for (const r of rows) {
      if (!grouped[r.production_code]) {
        grouped[r.production_code] = {
          production_code: r.production_code,
          production_name: r.production_name,
          bom_source_name: r.bom_source_name,
          materials: [],
          total_g: 0
        }
      }
      grouped[r.production_code].materials.push(r)
      grouped[r.production_code].total_g += Number(r.quantity_per_unit_g || 0)
    }
    return c.json({ success: true, data: Object.values(grouped) })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// GET /api/product-bom/mappings - 매핑 이력 리스트
bom.get('/mappings', async (c) => {
  try {
    await ensureTables(c.env.DB)
    const res = await c.env.DB.prepare(`
      SELECT * FROM product_bom_mapping ORDER BY match_type, production_name
    `).all()
    return c.json({ success: true, data: res.results || [] })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// GET /api/product-bom/:code - 특정 제품 BOM
bom.get('/:code', async (c) => {
  try {
    await ensureTables(c.env.DB)
    const code = c.req.param('code')
    const res = await c.env.DB.prepare(`
      SELECT * FROM product_bom_material WHERE production_code = ? ORDER BY seq, id
    `).bind(code).all()
    return c.json({ success: true, data: res.results || [] })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// POST /api/product-bom/bulk-import
// body: { rows: [{production_code, production_name, bom_source_name, materials: [{material_name, quantity_per_unit_g, seq}], match_type, match_score}] }
bom.post('/bulk-import', async (c) => {
  try {
    await ensureTables(c.env.DB)
    const { rows } = await c.req.json()
    if (!Array.isArray(rows)) return c.json({ success: false, error: 'rows 배열 필요' }, 400)
    let saved_products = 0, saved_materials = 0
    for (const r of rows) {
      if (!r.production_code) continue
      await c.env.DB.prepare(`DELETE FROM product_bom_material WHERE production_code = ?`).bind(r.production_code).run()
      await c.env.DB.prepare(`
        INSERT INTO product_bom_mapping (production_code, production_name, bom_source_name, match_type, match_score)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(production_code) DO UPDATE SET
          production_name = excluded.production_name,
          bom_source_name = excluded.bom_source_name,
          match_type = excluded.match_type,
          match_score = excluded.match_score,
          updated_at = CURRENT_TIMESTAMP
      `).bind(r.production_code, r.production_name || '', r.bom_source_name || null, r.match_type || 'manual', r.match_score || 0).run()

      if (Array.isArray(r.materials)) {
        for (let i = 0; i < r.materials.length; i++) {
          const m = r.materials[i]
          if (!m.material_name) continue
          const g = Number(m.quantity_per_unit_g)
          if (isNaN(g) || g <= 0) continue
          await c.env.DB.prepare(`
            INSERT INTO product_bom_material (production_code, production_name, bom_source_name, material_name, material_code, quantity_per_unit_g, unit, seq, memo)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            r.production_code,
            r.production_name || null,
            r.bom_source_name || null,
            m.material_name,
            m.material_code || null,
            g,
            m.unit || 'g',
            m.seq !== undefined ? m.seq : i,
            r.match_type || 'manual'
          ).run()
          saved_materials++
        }
      }
      saved_products++
    }
    return c.json({ success: true, saved_products, saved_materials })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// POST /api/product-bom/mapping - 단일 매핑 upsert (수동 매핑용)
bom.post('/mapping', async (c) => {
  try {
    await ensureTables(c.env.DB)
    const { production_code, production_name, bom_source_name, match_type, match_score } = await c.req.json()
    if (!production_code || !production_name) return c.json({ success: false, error: 'production_code, production_name 필수' }, 400)
    await c.env.DB.prepare(`
      INSERT INTO product_bom_mapping (production_code, production_name, bom_source_name, match_type, match_score)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(production_code) DO UPDATE SET
        production_name = excluded.production_name,
        bom_source_name = excluded.bom_source_name,
        match_type = excluded.match_type,
        match_score = excluded.match_score,
        updated_at = CURRENT_TIMESTAMP
    `).bind(production_code, production_name, bom_source_name || null, match_type || 'manual', match_score || 0).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// POST /api/product-bom/clear - 전체 삭제 (재삽입용)
bom.post('/clear', async (c) => {
  try {
    await ensureTables(c.env.DB)
    const b = await c.env.DB.prepare(`SELECT COUNT(*) as n FROM product_bom_material`).first() as any
    await c.env.DB.prepare(`DELETE FROM product_bom_material`).run()
    await c.env.DB.prepare(`DELETE FROM product_bom_mapping`).run()
    return c.json({ success: true, cleared: b?.n || 0 })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// DELETE /api/product-bom/:code
bom.delete('/:code', async (c) => {
  try {
    await ensureTables(c.env.DB)
    const code = c.req.param('code')
    await c.env.DB.prepare(`DELETE FROM product_bom_material WHERE production_code = ?`).bind(code).run()
    await c.env.DB.prepare(`DELETE FROM product_bom_mapping WHERE production_code = ?`).bind(code).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ============================================================
// 계획 기반 원료 사용량 산출 (BOM + 반죽 통합)
// GET /api/product-bom/material-usage/:date
// ============================================================
bom.get('/material-usage/:date', async (c) => {
  try {
    await ensureTables(c.env.DB)
    const date = c.req.param('date')

    // 1. 계획 조회
    const plansRes = await c.env.DB.prepare(`
      SELECT production_code, production_name,
        COALESCE(coupang, 0) + COALESCE(oasis, 0) + COALESCE(kurly_frozen, 0) + COALESCE(kurly_ambient, 0) +
        COALESCE(store, 0) + COALESCE(franchise, 0) + COALESCE(gs, 0) + COALESCE(baemin, 0) +
        COALESCE(lotte, 0) + COALESCE(cj, 0) + COALESCE(sandwich, 0) + COALESCE(extra1, 0) +
        COALESCE(extra2, 0) + COALESCE(extra3, 0) as total_qty
      FROM order_plan
      WHERE plan_date = ?
    `).bind(date).all()
    const plans = (plansRes.results as any[]) || []
    const withQty = plans.filter(p => Number(p.total_qty) > 0)

    // 2. BOM (제품별 완제품 배합)
    const bomRes = await c.env.DB.prepare(`SELECT * FROM product_bom_material`).all()
    const bomRows = (bomRes.results as any[]) || []
    const bomByProduct: Record<string, any[]> = {}
    for (const b of bomRows) {
      if (!bomByProduct[b.production_code]) bomByProduct[b.production_code] = []
      bomByProduct[b.production_code].push(b)
    }

    // 3. 반죽 정보 (BOM 없는 제품 fallback)
    let pduByProduct: Record<string, any[]> = {}
    let dmByDough: Record<string, any[]> = {}
    try {
      const pduRes = await c.env.DB.prepare(`
        SELECT production_code, dough_code, dough_g_per_product FROM product_dough_usage
      `).all()
      const pduRows = (pduRes.results as any[]) || []
      for (const p of pduRows) {
        if (!pduByProduct[p.production_code]) pduByProduct[p.production_code] = []
        pduByProduct[p.production_code].push(p)
      }
    } catch (_) { /* table may not exist */ }
    try {
      const dmRes = await c.env.DB.prepare(`SELECT * FROM dough_material`).all()
      const dmRows = (dmRes.results as any[]) || []
      for (const d of dmRows) {
        if (!dmByDough[d.dough_code]) dmByDough[d.dough_code] = []
        dmByDough[d.dough_code].push(d)
      }
    } catch (_) { /* table may not exist */ }

    // 4. 원료별 사용량 집계
    const materialTotals: Record<string, { name: string, g: number, sources: Set<string>, from_bom: boolean, from_dough: boolean }> = {}
    const productsCoveredBom: string[] = []
    const productsCoveredDough: string[] = []
    const productsNotCovered: string[] = []

    for (const p of withQty) {
      const qty = Number(p.total_qty)
      const code = p.production_code
      let covered = false

      // Option A: BOM 직접 사용 (우선)
      if (bomByProduct[code] && bomByProduct[code].length > 0) {
        for (const b of bomByProduct[code]) {
          const g = Number(b.quantity_per_unit_g) * qty
          const key = b.material_name
          if (!materialTotals[key]) materialTotals[key] = { name: key, g: 0, sources: new Set(), from_bom: false, from_dough: false }
          materialTotals[key].g += g
          materialTotals[key].sources.add(p.production_name)
          materialTotals[key].from_bom = true
        }
        covered = true
        productsCoveredBom.push(p.production_name)
      }
      // Option B: 반죽 경유 (fallback)
      else if (pduByProduct[code]) {
        let hasMat = false
        for (const pdu of pduByProduct[code]) {
          const doughG = Number(pdu.dough_g_per_product) * qty
          const materials = dmByDough[pdu.dough_code] || []
          for (const m of materials) {
            const g = doughG / 1000 * Number(m.quantity_per_kg)
            const key = m.material_name
            if (!materialTotals[key]) materialTotals[key] = { name: key, g: 0, sources: new Set(), from_bom: false, from_dough: false }
            materialTotals[key].g += g
            materialTotals[key].sources.add(p.production_name)
            materialTotals[key].from_dough = true
            hasMat = true
          }
        }
        if (hasMat) {
          covered = true
          productsCoveredDough.push(p.production_name)
        }
      }

      if (!covered) productsNotCovered.push(p.production_name)
    }

    // 5. 결과 정리
    const materials = Object.values(materialTotals)
      .map(m => ({
        name: m.name,
        kg: +(m.g / 1000).toFixed(3),
        g: +m.g.toFixed(1),
        product_count: m.sources.size,
        source: m.from_bom && m.from_dough ? 'BOM+반죽' : (m.from_bom ? 'BOM' : '반죽')
      }))
      .sort((a, b) => b.kg - a.kg)

    const totalKg = materials.reduce((s, m) => s + m.kg, 0)

    return c.json({
      success: true,
      date,
      total_products_planned: withQty.length,
      products_covered_bom: productsCoveredBom.length,
      products_covered_dough: productsCoveredDough.length,
      products_not_covered: productsNotCovered.length,
      products_not_covered_list: productsNotCovered,
      total_materials: materials.length,
      total_kg: +totalKg.toFixed(3),
      materials
    })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

export default bom
