import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const yieldRoutes = new Hono<{ Bindings: Bindings }>()

// ===== 폐기 등록 =====
yieldRoutes.post('/discard', async (c) => {
  try {
    const { production_id, discard_qty, discard_weight_kg, reason, discard_date, memo, created_by } = await c.req.json()

    if (!production_id || !discard_qty || discard_qty <= 0 || !reason) {
      return c.json({ success: false, error: 'production_id, discard_qty(양수), reason은 필수입니다.' }, 400)
    }

    const production = await c.env.DB.prepare('SELECT id, product_code FROM production WHERE id = ?').bind(production_id).first<any>()
    if (!production) {
      return c.json({ success: false, error: '존재하지 않는 생산 기록입니다.' }, 404)
    }

    const date = discard_date || new Date().toISOString().split('T')[0]

    await c.env.DB.prepare(`
      INSERT INTO production_discard (production_id, discard_qty, discard_weight_kg, reason, discard_date, memo, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(production_id, discard_qty, discard_weight_kg ?? null, reason, date, memo || null, created_by || null).run()

    return c.json({ success: true, message: '폐기 내역이 등록되었습니다.' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

yieldRoutes.get('/discard/:productionId', async (c) => {
  try {
    const productionId = c.req.param('productionId')
    const result = await c.env.DB.prepare(
      'SELECT * FROM production_discard WHERE production_id = ? ORDER BY created_at DESC'
    ).bind(productionId).all()
    return c.json({ success: true, data: result.results || [] })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 특정 생산 건의 수율 계산 =====
// 수율(%) = 산출 중량(양품) / 총 투입 중량 * 100
// 폐기율(%) = 폐기 중량 / 총 투입 중량 * 100
// 미상 손실율(%) = 100 - 수율 - 폐기율  (수분증발/눌러붙음 등 설명되지 않는 차이)
yieldRoutes.get('/production/:id', async (c) => {
  try {
    const id = c.req.param('id')

    const production = await c.env.DB.prepare(`
      SELECT p.id, p.prod_date, p.product_code, p.quantity, p.lot_number,
             pi.production_name, pi.standard_weight
      FROM production p
      LEFT JOIN production_items pi ON p.product_code = pi.production_code
      WHERE p.id = ?
    `).bind(id).first<any>()

    if (!production) {
      return c.json({ success: false, error: '존재하지 않는 생산 기록입니다.' }, 404)
    }

    const inputResult = await c.env.DB.prepare(
      'SELECT COALESCE(SUM(actual_qty), 0) as total_input FROM production_materials WHERE production_id = ?'
    ).bind(id).first<any>()
    const totalInputKg = inputResult?.total_input || 0

    const discardResult = await c.env.DB.prepare(
      'SELECT COALESCE(SUM(discard_qty), 0) as total_qty, COALESCE(SUM(discard_weight_kg), 0) as total_weight_declared FROM production_discard WHERE production_id = ?'
    ).bind(id).first<any>()
    const totalDiscardQty = discardResult?.total_qty || 0

    const hasStandardWeight = production.standard_weight !== null && production.standard_weight !== undefined
    let outputKg: number | null = null
    let discardKg: number | null = null

    if (hasStandardWeight) {
      outputKg = (production.quantity * production.standard_weight) / 1000
      // 폐기 중량은 직접 입력값이 있으면 우선, 없으면 표준중량으로 환산
      discardKg = discardResult?.total_weight_declared > 0
        ? discardResult.total_weight_declared
        : (totalDiscardQty * production.standard_weight) / 1000
    }

    let yieldRate: number | null = null
    let discardRate: number | null = null
    let unexplainedLossRate: number | null = null

    if (hasStandardWeight && totalInputKg > 0) {
      yieldRate = Math.round((outputKg! / totalInputKg) * 1000) / 10
      discardRate = Math.round((discardKg! / totalInputKg) * 1000) / 10
      unexplainedLossRate = Math.round((100 - yieldRate - discardRate) * 10) / 10
    }

    return c.json({
      success: true,
      data: {
        production_id: production.id,
        prod_date: production.prod_date,
        product_code: production.product_code,
        production_name: production.production_name,
        lot_number: production.lot_number,
        good_quantity: production.quantity,
        discard_quantity: totalDiscardQty,
        standard_weight_g: production.standard_weight,
        has_standard_weight: hasStandardWeight,
        total_input_kg: Math.round(totalInputKg * 1000) / 1000,
        output_kg: outputKg !== null ? Math.round(outputKg * 1000) / 1000 : null,
        discard_kg: discardKg !== null ? Math.round(discardKg * 1000) / 1000 : null,
        yield_rate_pct: yieldRate,
        discard_rate_pct: discardRate,
        unexplained_loss_rate_pct: unexplainedLossRate,
        note: hasStandardWeight ? null : '이 제품은 표준중량(standard_weight)이 등록되지 않아 중량 기준 수율을 계산할 수 없습니다.'
      }
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 기간별 수율 리포트 (제품별 집계) =====
yieldRoutes.get('/report', async (c) => {
  try {
    const start = c.req.query('start') || new Date().toISOString().split('T')[0]
    const end = c.req.query('end') || start
    const productCode = c.req.query('product_code')

    let query = `
      SELECT p.id, p.prod_date, p.product_code, pi.production_name, p.quantity, pi.standard_weight,
             (SELECT COALESCE(SUM(actual_qty), 0) FROM production_materials WHERE production_id = p.id) as total_input_kg,
             (SELECT COALESCE(SUM(discard_qty), 0) FROM production_discard WHERE production_id = p.id) as total_discard_qty,
             (SELECT COALESCE(SUM(discard_weight_kg), 0) FROM production_discard WHERE production_id = p.id) as declared_discard_kg
      FROM production p
      LEFT JOIN production_items pi ON p.product_code = pi.production_code
      WHERE p.prod_date BETWEEN ? AND ? AND p.status = '완료'
    `
    const params: any[] = [start, end]
    if (productCode) {
      query += ' AND p.product_code = ?'
      params.push(productCode)
    }
    query += ' ORDER BY p.prod_date DESC'

    const result = await c.env.DB.prepare(query).bind(...params).all()

    const rows = (result.results as any[]).map(r => {
      const hasWeight = r.standard_weight !== null && r.standard_weight !== undefined
      let outputKg = null, discardKg = null, yieldPct = null
      if (hasWeight) {
        outputKg = (r.quantity * r.standard_weight) / 1000
        discardKg = r.declared_discard_kg > 0 ? r.declared_discard_kg : (r.total_discard_qty * r.standard_weight) / 1000
        if (r.total_input_kg > 0) {
          yieldPct = Math.round((outputKg / r.total_input_kg) * 1000) / 10
        }
      }
      return {
        production_id: r.id,
        prod_date: r.prod_date,
        product_code: r.product_code,
        production_name: r.production_name,
        good_quantity: r.quantity,
        discard_quantity: r.total_discard_qty,
        total_input_kg: Math.round(r.total_input_kg * 1000) / 1000,
        output_kg: outputKg !== null ? Math.round(outputKg * 1000) / 1000 : null,
        discard_kg: discardKg !== null ? Math.round(discardKg * 1000) / 1000 : null,
        yield_rate_pct: yieldPct,
        has_standard_weight: hasWeight
      }
    })

    const withYield = rows.filter(r => r.yield_rate_pct !== null)
    const avgYield = withYield.length > 0
      ? Math.round((withYield.reduce((s, r) => s + r.yield_rate_pct!, 0) / withYield.length) * 10) / 10
      : null

    return c.json({
      success: true,
      start, end,
      summary: {
        total_batches: rows.length,
        batches_with_yield_data: withYield.length,
        batches_missing_standard_weight: rows.length - withYield.length,
        average_yield_pct: avgYield
      },
      data: rows
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 제품명에서 표준중량(g) 추정 제안 (자동 적용 아님, 검토용) =====
yieldRoutes.get('/standard-weight/suggest', async (c) => {
  try {
    const result = await c.env.DB.prepare(
      `SELECT production_code, production_name FROM production_items WHERE standard_weight IS NULL`
    ).all()

    const suggestions: any[] = []
    for (const row of (result.results as any[])) {
      const matches = [...row.production_name.matchAll(/(\d+(?:\.\d+)?)\s*g(?!\w)/gi)]
      if (matches.length > 0) {
        const lastMatch = matches[matches.length - 1]
        suggestions.push({
          production_code: row.production_code,
          production_name: row.production_name,
          suggested_weight_g: parseFloat(lastMatch[1]),
          confidence: matches.length === 1 ? 'high' : 'low'
        })
      }
    }

    return c.json({
      success: true,
      message: '제품명에서 추정한 값입니다. 확인 후 /standard-weight/apply 로 반영해주세요.',
      count: suggestions.length,
      data: suggestions
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 표준중량 일괄 반영 =====
yieldRoutes.post('/standard-weight/apply', async (c) => {
  try {
    const { items } = await c.req.json() // [{ production_code, standard_weight }]
    if (!items || !Array.isArray(items)) {
      return c.json({ success: false, error: 'items 배열이 필요합니다.' }, 400)
    }

    let updated = 0
    for (const item of items) {
      if (item.production_code && item.standard_weight) {
        await c.env.DB.prepare(
          'UPDATE production_items SET standard_weight = ?, updated_at = CURRENT_TIMESTAMP WHERE production_code = ?'
        ).bind(item.standard_weight, item.production_code).run()
        updated++
      }
    }

    return c.json({ success: true, message: `${updated}개 제품의 표준중량이 등록되었습니다.`, count: updated })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

export default yieldRoutes
