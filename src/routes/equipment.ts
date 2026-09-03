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

// v3.6.72: ===== 품목 마스터 수정 =====
equipment.put('/items/:code', async (c) => {
  try {
    const code = c.req.param('code')
    const { item_name, category, unit, unit_price, memo, is_active } = await c.req.json()
    if (!item_name) {
      return c.json({ success: false, error: 'item_name은 필수입니다.' }, 400)
    }
    const existing = await c.env.DB.prepare('SELECT item_code FROM equipment_items WHERE item_code = ?').bind(code).first()
    if (!existing) {
      return c.json({ success: false, error: '존재하지 않는 품목입니다.' }, 404)
    }
    await c.env.DB.prepare(`
      UPDATE equipment_items
      SET item_name = ?, category = ?, unit = ?, unit_price = ?, memo = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE item_code = ?
    `).bind(
      item_name,
      category || '기타',
      unit || 'EA',
      unit_price !== undefined && unit_price !== null ? unit_price : 0,
      memo || null,
      is_active !== undefined ? (is_active ? 1 : 0) : 1,
      code
    ).run()
    return c.json({ success: true, message: '품목이 수정되었습니다.' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// v3.6.72: ===== 품목 삭제 (거래 이력이 있으면 하드 삭제 대신 비활성화) =====
equipment.delete('/items/:code', async (c) => {
  try {
    const code = c.req.param('code')
    const force = c.req.query('force') === '1'  // ?force=1 이면 강제 삭제 시도

    const existing = await c.env.DB.prepare('SELECT item_code FROM equipment_items WHERE item_code = ?').bind(code).first()
    if (!existing) {
      return c.json({ success: false, error: '존재하지 않는 품목입니다.' }, 404)
    }

    const txnCount = await c.env.DB.prepare('SELECT COUNT(*) as n FROM equipment_transactions WHERE item_code = ?').bind(code).first<any>()
    const hasTxn = (txnCount?.n || 0) > 0

    if (hasTxn && !force) {
      // 이력이 있으면 비활성화 (soft delete)
      await c.env.DB.prepare('UPDATE equipment_items SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE item_code = ?').bind(code).run()
      return c.json({
        success: true,
        soft_delete: true,
        message: `거래 이력이 ${txnCount.n}건 있어 완전 삭제 대신 비활성화되었습니다. 완전 삭제는 이력을 먼저 정리한 뒤 재시도해주세요.`
      })
    }

    // 관련 데이터 함께 삭제
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM equipment_stock WHERE item_code = ?').bind(code),
      c.env.DB.prepare('DELETE FROM equipment_transactions WHERE item_code = ?').bind(code),
      c.env.DB.prepare('DELETE FROM equipment_items WHERE item_code = ?').bind(code)
    ])
    return c.json({ success: true, message: '품목이 완전 삭제되었습니다.' })
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

    // v3.6.70: 품목코드 유효성 먼저 확인
    const itemExists = await c.env.DB.prepare(
      'SELECT item_code FROM equipment_items WHERE item_code = ?'
    ).bind(item_code).first<any>()
    if (!itemExists) {
      return c.json({ success: false, error: '등록되지 않은 품목입니다. 먼저 [품목 추가]로 비품을 등록해주세요.' }, 404)
    }

    // v3.6.70: stock 레코드가 없으면 자동 생성 (upsert)
    // 이렇게 하면 첫 입고 시 별도의 stock/init 호출이 필요 없음
    const stockRow = await c.env.DB.prepare(
      'SELECT id, current_stock FROM equipment_stock WHERE item_code = ? AND size = ?'
    ).bind(item_code, sizeValue).first<any>()

    const batch: any[] = []
    if (!stockRow) {
      // 자동 생성
      batch.push(
        c.env.DB.prepare('INSERT INTO equipment_stock (item_code, size, current_stock) VALUES (?, ?, ?)')
          .bind(item_code, sizeValue, quantity)
      )
    } else {
      batch.push(
        c.env.DB.prepare('UPDATE equipment_stock SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .bind(quantity, stockRow.id)
      )
    }
    batch.push(
      c.env.DB.prepare(`
        INSERT INTO equipment_transactions (trans_date, item_code, size, trans_type, quantity, unit_price, memo)
        VALUES (?, ?, ?, '입고', ?, ?, ?)
      `).bind(date, item_code, sizeValue, quantity, unit_price || 0, memo || null)
    )
    // 입고 단가가 있으면 품목의 "현재 단가"도 최신으로 갱신
    if (unit_price !== undefined && unit_price !== null && unit_price > 0) {
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

// v3.6.72: ===== 사이즈별 재고 항목 수정 (재고 조정 + 안전재고 변경) =====
// PUT /stock/:id — 사이즈 자체를 rename 하는 것은 매핑 복잡성 때문에 지원하지 않음
// 재고 수량 변경 시 자동으로 '재고조정' 이력을 남김
equipment.put('/stock/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    const { current_stock, safety_stock, memo } = await c.req.json()

    const row = await c.env.DB.prepare(
      'SELECT id, item_code, size, current_stock, safety_stock FROM equipment_stock WHERE id = ?'
    ).bind(id).first<any>()
    if (!row) return c.json({ success: false, error: '존재하지 않는 재고 항목입니다.' }, 404)

    const newStock = (current_stock !== undefined && current_stock !== null) ? Number(current_stock) : row.current_stock
    const newSafety = (safety_stock !== undefined && safety_stock !== null) ? Number(safety_stock) : row.safety_stock
    if (newStock < 0 || newSafety < 0) {
      return c.json({ success: false, error: '재고/안전재고는 0 이상이어야 합니다.' }, 400)
    }

    const diff = newStock - row.current_stock
    const date = new Date().toISOString().split('T')[0]

    const batch: any[] = [
      c.env.DB.prepare(
        'UPDATE equipment_stock SET current_stock = ?, safety_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(newStock, newSafety, id)
    ]
    // 재고 수량이 실제로 바뀐 경우에만 이력 남김
    if (diff !== 0) {
      batch.push(
        c.env.DB.prepare(`
          INSERT INTO equipment_transactions (trans_date, item_code, size, trans_type, quantity, memo)
          VALUES (?, ?, ?, '재고조정', ?, ?)
        `).bind(date, row.item_code, row.size, diff, memo || '재고 실사 조정')
      )
    }
    await c.env.DB.batch(batch)

    return c.json({
      success: true,
      message: diff !== 0 ? `재고가 ${row.current_stock} → ${newStock} 로 조정되었습니다.` : '안전재고가 수정되었습니다.',
      diff
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// v3.6.72: ===== 사이즈 삭제 =====
// 재고 > 0 이거나 거래 이력이 있으면 기본적으로 거부. force=1 로 강제 삭제 가능
equipment.delete('/stock/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    const force = c.req.query('force') === '1'

    const row = await c.env.DB.prepare(
      'SELECT id, item_code, size, current_stock FROM equipment_stock WHERE id = ?'
    ).bind(id).first<any>()
    if (!row) return c.json({ success: false, error: '존재하지 않는 재고 항목입니다.' }, 404)

    if (!force) {
      if (row.current_stock > 0) {
        return c.json({
          success: false,
          error: `현재 재고가 ${row.current_stock} 남아 있습니다. 재고를 0으로 조정한 뒤 삭제하거나 강제 삭제를 사용하세요.`
        }, 400)
      }
      const txnCount = await c.env.DB.prepare(
        'SELECT COUNT(*) as n FROM equipment_transactions WHERE item_code = ? AND size = ?'
      ).bind(row.item_code, row.size).first<any>()
      if ((txnCount?.n || 0) > 0) {
        return c.json({
          success: false,
          error: `해당 사이즈에 거래 이력이 ${txnCount.n}건 있습니다. 강제 삭제를 사용하면 이력도 함께 삭제됩니다.`
        }, 400)
      }
    }

    // 강제 삭제인 경우 관련 거래 이력까지 정리
    const batch: any[] = []
    if (force) {
      batch.push(
        c.env.DB.prepare('DELETE FROM equipment_transactions WHERE item_code = ? AND size = ?')
          .bind(row.item_code, row.size)
      )
    }
    batch.push(c.env.DB.prepare('DELETE FROM equipment_stock WHERE id = ?').bind(id))
    await c.env.DB.batch(batch)

    return c.json({ success: true, message: '사이즈가 삭제되었습니다.' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// v3.6.70: ===== 전체 거래 이력 조회 (입고/지급/조정 모두) =====
equipment.get('/transactions', async (c) => {
  try {
    const itemCode = c.req.query('item_code')
    const transType = c.req.query('trans_type')  // '입고' | '지급' | '재고조정'
    const start = c.req.query('start')
    const end = c.req.query('end')
    const limit = Number(c.req.query('limit') || 200)

    let query = `
      SELECT t.id, t.trans_date, t.item_code, ei.item_name, t.size, t.trans_type,
             t.quantity, t.unit_price, (t.quantity * t.unit_price) as total_price,
             t.issued_to, t.department, t.memo, t.created_at
      FROM equipment_transactions t
      LEFT JOIN equipment_items ei ON t.item_code = ei.item_code
      WHERE 1=1
    `
    const params: any[] = []
    if (itemCode) { query += ' AND t.item_code = ?'; params.push(itemCode) }
    if (transType) { query += ' AND t.trans_type = ?'; params.push(transType) }
    if (start && end) { query += ' AND t.trans_date BETWEEN ? AND ?'; params.push(start, end) }
    query += ' ORDER BY t.trans_date DESC, t.id DESC LIMIT ?'
    params.push(limit)

    const result = await c.env.DB.prepare(query).bind(...params).all()
    return c.json({ success: true, data: result.results || [] })
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
