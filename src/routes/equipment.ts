import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const equipment = new Hono<{ Bindings: Bindings }>()

// ===== 품목 목록 =====
equipment.get('/items', async (c) => {
  try {
    const category = c.req.query('category')
    let query = `
      SELECT i.*, 
        (SELECT COALESCE(SUM(current_stock), 0) FROM equipment_stock WHERE item_code = i.item_code) as total_stock,
        (SELECT COUNT(*) FROM equipment_stock WHERE item_code = i.item_code) as size_variant_count
      FROM equipment_items i
      WHERE i.is_active = 1
    `
    const params: any[] = []
    if (category) {
      query += ' AND i.category = ?'
      params.push(category)
    }
    query += ' ORDER BY i.category, i.item_code'

    const result = await c.env.DB.prepare(query).bind(...params).all()
    return c.json({ success: true, data: result.results || [] })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 품목 등록 =====
equipment.post('/items', async (c) => {
  try {
    const { item_code, item_name, category, unit, unit_price, memo } = await c.req.json()
    if (!item_code || !item_name) {
      return c.json({ success: false, error: 'item_code, item_name은 필수입니다.' }, 400)
    }

    await c.env.DB.prepare(`
      INSERT INTO equipment_items (item_code, item_name, category, unit, unit_price, memo)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(item_code, item_name, category || '기타', unit || 'EA', unit_price || 0, memo || null).run()

    return c.json({ success: true, message: '품목이 등록되었습니다.' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 사이즈별 재고 목록 (전체 또는 특정 품목) =====
equipment.get('/stock', async (c) => {
  try {
    const itemCode = c.req.query('item_code')
    let query = `
      SELECT es.id, es.item_code, ei.item_name, ei.category, ei.unit, ei.unit_price,
             es.size, es.current_stock, es.safety_stock,
             CASE WHEN es.current_stock <= es.safety_stock THEN 1 ELSE 0 END as is_low
      FROM equipment_stock es
      JOIN equipment_items ei ON es.item_code = ei.item_code
      WHERE 1=1
    `
    const params: any[] = []
    if (itemCode) {
      query += ' AND es.item_code = ?'
      params.push(itemCode)
    }
    query += ' ORDER BY ei.category, es.item_code, es.size'

    const result = await c.env.DB.prepare(query).bind(...params).all()
    return c.json({ success: true, data: result.results || [] })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 사이즈 추가 (해당 품목에 새 사이즈 등록) =====
equipment.post('/stock/init', async (c) => {
  try {
    const { item_code, size, initial_stock, safety_stock } = await c.req.json()
    if (!item_code) {
      return c.json({ success: false, error: 'item_code는 필수입니다.' }, 400)
    }

    const item = await c.env.DB.prepare('SELECT item_code FROM equipment_items WHERE item_code = ?').bind(item_code).first()
    if (!item) {
      return c.json({ success: false, error: '등록되지 않은 품목입니다. 먼저 품목을 등록해주세요.' }, 404)
    }

    const sizeValue = size || ''
    const existing = await c.env.DB.prepare(
      'SELECT id FROM equipment_stock WHERE item_code = ? AND size = ?'
    ).bind(item_code, sizeValue).first()

    if (existing) {
      return c.json({ success: false, error: '이미 등록된 사이즈입니다. 재고 조정 API를 사용해주세요.' }, 409)
    }

    await c.env.DB.prepare(`
      INSERT INTO equipment_stock (item_code, size, current_stock, safety_stock)
      VALUES (?, ?, ?, ?)
    `).bind(item_code, sizeValue, initial_stock || 0, safety_stock || 0).run()

    return c.json({ success: true, message: '사이즈가 등록되었습니다.' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 입고(구매) 등록 =====
equipment.post('/inbound', async (c) => {
  try {
    const { item_code, size, quantity, unit_price, trans_date, memo } = await c.req.json()
    if (!item_code || !quantity || quantity <= 0) {
      return c.json({ success: false, error: 'item_code, quantity(양수)는 필수입니다.' }, 400)
    }

    const sizeValue = size || ''
    const date = trans_date || new Date().toISOString().split('T')[0]

    const stockRow = await c.env.DB.prepare(
      'SELECT id, current_stock FROM equipment_stock WHERE item_code = ? AND size = ?'
    ).bind(item_code, sizeValue).first<any>()

    if (!stockRow) {
      return c.json({ success: false, error: '등록되지 않은 품목/사이즈입니다. 먼저 stock/init으로 사이즈를 등록해주세요.' }, 404)
    }

    const batch: any[] = [
      c.env.DB.prepare('UPDATE equipment_stock SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(quantity, stockRow.id),
      c.env.DB.prepare(`
        INSERT INTO equipment_transactions (trans_date, item_code, size, trans_type, quantity, unit_price, memo)
        VALUES (?, ?, ?, '입고', ?, ?, ?)
      `).bind(date, item_code, sizeValue, quantity, unit_price || 0, memo || null)
    ]
    // 입고 단가가 있으면 품목의 "현재 단가"도 최신으로 갱신
    if (unit_price !== undefined && unit_price !== null) {
      batch.push(
        c.env.DB.prepare('UPDATE equipment_items SET unit_price = ?, updated_at = CURRENT_TIMESTAMP WHERE item_code = ?')
          .bind(unit_price, item_code)
      )
    }

    await c.env.DB.batch(batch)
    return c.json({ success: true, message: '입고 등록되었습니다.' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 지급 등록 (누가 가져갔는지 기록) =====
equipment.post('/issue', async (c) => {
  try {
    const { item_code, size, quantity, issued_to, department, trans_date, memo } = await c.req.json()
    if (!item_code || !quantity || quantity <= 0 || !issued_to) {
      return c.json({ success: false, error: 'item_code, quantity(양수), issued_to는 필수입니다.' }, 400)
    }

    const sizeValue = size || ''
    const date = trans_date || new Date().toISOString().split('T')[0]

    const stockRow = await c.env.DB.prepare(
      'SELECT id, current_stock FROM equipment_stock WHERE item_code = ? AND size = ?'
    ).bind(item_code, sizeValue).first<any>()

    if (!stockRow) {
      return c.json({ success: false, error: '등록되지 않은 품목/사이즈입니다.' }, 404)
    }
    if (stockRow.current_stock < quantity) {
      return c.json({ success: false, error: `재고 부족 (현재고: ${stockRow.current_stock})` }, 400)
    }

    const item = await c.env.DB.prepare('SELECT unit_price FROM equipment_items WHERE item_code = ?').bind(item_code).first<any>()

    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE equipment_stock SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(quantity, stockRow.id),
      c.env.DB.prepare(`
        INSERT INTO equipment_transactions (trans_date, item_code, size, trans_type, quantity, unit_price, issued_to, department, memo)
        VALUES (?, ?, ?, '지급', ?, ?, ?, ?, ?)
      `).bind(date, item_code, sizeValue, quantity, item?.unit_price || 0, issued_to, department || null, memo || null)
    ])

    return c.json({ success: true, message: `${issued_to}님에게 지급 등록되었습니다.` })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 재고 실사 조정 =====
equipment.post('/adjust', async (c) => {
  try {
    const { item_code, size, new_stock, memo } = await c.req.json()
    if (!item_code || new_stock === undefined || new_stock === null) {
      return c.json({ success: false, error: 'item_code, new_stock은 필수입니다.' }, 400)
    }

    const sizeValue = size || ''
    const stockRow = await c.env.DB.prepare(
      'SELECT id, current_stock FROM equipment_stock WHERE item_code = ? AND size = ?'
    ).bind(item_code, sizeValue).first<any>()

    if (!stockRow) {
      return c.json({ success: false, error: '등록되지 않은 품목/사이즈입니다.' }, 404)
    }

    const diff = new_stock - stockRow.current_stock
    const date = new Date().toISOString().split('T')[0]

    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE equipment_stock SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(new_stock, stockRow.id),
      c.env.DB.prepare(`
        INSERT INTO equipment_transactions (trans_date, item_code, size, trans_type, quantity, memo)
        VALUES (?, ?, ?, '재고조정', ?, ?)
      `).bind(date, item_code, sizeValue, diff, memo || '재고 실사 조정')
    ])

    return c.json({ success: true, message: '재고가 조정되었습니다.', diff })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 지급 이력 조회 (누가 언제 무엇을 가져갔는지) =====
equipment.get('/issuance-history', async (c) => {
  try {
    const issuedTo = c.req.query('issued_to')
    const itemCode = c.req.query('item_code')
    const start = c.req.query('start')
    const end = c.req.query('end')

    let query = `
      SELECT t.id, t.trans_date, t.item_code, ei.item_name, t.size, t.quantity, t.unit_price,
             (t.quantity * t.unit_price) as total_price, t.issued_to, t.department, t.memo
      FROM equipment_transactions t
      LEFT JOIN equipment_items ei ON t.item_code = ei.item_code
      WHERE t.trans_type = '지급'
    `
    const params: any[] = []
    if (issuedTo) {
      query += ' AND t.issued_to = ?'
      params.push(issuedTo)
    }
    if (itemCode) {
      query += ' AND t.item_code = ?'
      params.push(itemCode)
    }
    if (start && end) {
      query += ' AND t.trans_date BETWEEN ? AND ?'
      params.push(start, end)
    }
    query += ' ORDER BY t.trans_date DESC, t.id DESC'

    const result = await c.env.DB.prepare(query).bind(...params).all()
    return c.json({ success: true, data: result.results || [] })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 월별 구매(입고) 금액 리포트 =====
equipment.get('/monthly-report', async (c) => {
  try {
    const month = c.req.query('month') || new Date().toISOString().slice(0, 7) // YYYY-MM

    const purchases = await c.env.DB.prepare(`
      SELECT t.item_code, ei.item_name, ei.category,
             SUM(t.quantity) as total_qty,
             SUM(t.quantity * t.unit_price) as total_cost
      FROM equipment_transactions t
      LEFT JOIN equipment_items ei ON t.item_code = ei.item_code
      WHERE t.trans_type = '입고' AND t.trans_date LIKE ?
      GROUP BY t.item_code
      ORDER BY total_cost DESC
    `).bind(`${month}%`).all()

    const issuance = await c.env.DB.prepare(`
      SELECT t.item_code, ei.item_name,
             SUM(t.quantity) as total_qty,
             SUM(t.quantity * t.unit_price) as total_cost
      FROM equipment_transactions t
      LEFT JOIN equipment_items ei ON t.item_code = ei.item_code
      WHERE t.trans_type = '지급' AND t.trans_date LIKE ?
      GROUP BY t.item_code
      ORDER BY total_cost DESC
    `).bind(`${month}%`).all()

    const totalPurchaseCost = (purchases.results as any[]).reduce((s, r) => s + (r.total_cost || 0), 0)
    const totalIssuanceCost = (issuance.results as any[]).reduce((s, r) => s + (r.total_cost || 0), 0)

    return c.json({
      success: true,
      month,
      purchases: { total_cost: totalPurchaseCost, by_item: purchases.results || [] },
      issuance: { total_cost: totalIssuanceCost, by_item: issuance.results || [] }
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

export default equipment
