import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const packaging = new Hono<{ Bindings: Bindings }>()

// ===== 제품별 포장재 연결(입수량) 목록 =====
packaging.get('/list', async (c) => {
  try {
    const productionCode = c.req.query('production_code')
    let query = `
      SELECT pp.id, pp.production_code, pi.production_name, pp.supply_code, s.item_name as supply_name,
             s.unit as supply_unit, s.current_stock as supply_current_stock,
             pp.pack_qty, pp.memo, pp.created_at
      FROM production_packaging pp
      LEFT JOIN production_items pi ON pp.production_code = pi.production_code
      LEFT JOIN supplies s ON pp.supply_code = s.item_code
      WHERE 1=1
    `
    const params: any[] = []
    if (productionCode) {
      query += ' AND pp.production_code = ?'
      params.push(productionCode)
    }
    query += ' ORDER BY pp.production_code'

    const result = await c.env.DB.prepare(query).bind(...params).all()
    return c.json({ success: true, data: result.results || [] })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 제품-포장재 연결 등록/수정 (입수량 포함) =====
packaging.post('/link', async (c) => {
  try {
    const { production_code, supply_code, pack_qty, memo } = await c.req.json()

    if (!production_code || !supply_code || !pack_qty) {
      return c.json({ success: false, error: 'production_code, supply_code, pack_qty는 필수입니다.' }, 400)
    }
    if (pack_qty <= 0) {
      return c.json({ success: false, error: 'pack_qty(입수량)는 0보다 커야 합니다.' }, 400)
    }

    const existing = await c.env.DB.prepare(
      'SELECT id FROM production_packaging WHERE production_code = ? AND supply_code = ?'
    ).bind(production_code, supply_code).first()

    if (existing) {
      await c.env.DB.prepare(
        'UPDATE production_packaging SET pack_qty = ?, memo = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(pack_qty, memo || null, existing.id).run()
      return c.json({ success: true, message: '입수량이 수정되었습니다.', id: existing.id })
    } else {
      const result = await c.env.DB.prepare(
        'INSERT INTO production_packaging (production_code, supply_code, pack_qty, memo) VALUES (?, ?, ?, ?)'
      ).bind(production_code, supply_code, pack_qty, memo || null).run()
      return c.json({ success: true, message: '포장재가 연결되었습니다.', id: result.meta.last_row_id })
    }
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

packaging.delete('/link/:id', async (c) => {
  try {
    const id = c.req.param('id')
    await c.env.DB.prepare('DELETE FROM production_packaging WHERE id = ?').bind(id).run()
    return c.json({ success: true, message: '연결이 삭제되었습니다.' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 출고 수량 기준 필요 포장재(박스) 수량 미리보기 =====
// 실제 차감 없이 "이 수량을 출고하면 박스가 몇 개 필요한지"만 계산
packaging.get('/preview', async (c) => {
  try {
    const productionCode = c.req.query('production_code')
    const quantity = Number(c.req.query('quantity') || 0)

    if (!productionCode || !quantity) {
      return c.json({ success: false, error: 'production_code, quantity는 필수입니다.' }, 400)
    }

    const links = await c.env.DB.prepare(`
      SELECT pp.supply_code, s.item_name as supply_name, s.unit, s.current_stock, pp.pack_qty
      FROM production_packaging pp
      LEFT JOIN supplies s ON pp.supply_code = s.item_code
      WHERE pp.production_code = ?
    `).bind(productionCode).all()

    const preview = (links.results as any[]).map(l => {
      const needed = Math.ceil(quantity / l.pack_qty)
      return {
        supply_code: l.supply_code,
        supply_name: l.supply_name,
        unit: l.unit,
        pack_qty: l.pack_qty,
        needed_qty: needed,
        current_stock: l.current_stock,
        shortage: Math.max(0, needed - (l.current_stock || 0))
      }
    })

    return c.json({ success: true, production_code: productionCode, quantity, data: preview })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 포장재 입고 등록 =====
packaging.post('/inbound', async (c) => {
  try {
    const { item_code, quantity, trans_date, memo } = await c.req.json()

    if (!item_code || !quantity || quantity <= 0) {
      return c.json({ success: false, error: 'item_code, quantity(양수)는 필수입니다.' }, 400)
    }

    const date = trans_date || new Date().toISOString().split('T')[0]

    const supply = await c.env.DB.prepare('SELECT item_code FROM supplies WHERE item_code = ?').bind(item_code).first()
    if (!supply) {
      return c.json({ success: false, error: '등록되지 않은 부자재 코드입니다.' }, 404)
    }

    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE supplies SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE item_code = ?')
        .bind(quantity, item_code),
      c.env.DB.prepare(`
        INSERT INTO supply_transactions (trans_date, item_code, trans_type, quantity, reference_type, memo)
        VALUES (?, ?, '입고', ?, 'manual', ?)
      `).bind(date, item_code, quantity, memo || null)
    ])

    return c.json({ success: true, message: '입고 등록되었습니다.' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 포장재 재고 수동 조정 =====
packaging.post('/adjust', async (c) => {
  try {
    const { item_code, new_stock, memo } = await c.req.json()

    if (!item_code || new_stock === undefined || new_stock === null) {
      return c.json({ success: false, error: 'item_code, new_stock은 필수입니다.' }, 400)
    }

    const supply = await c.env.DB.prepare('SELECT current_stock FROM supplies WHERE item_code = ?').bind(item_code).first<any>()
    if (!supply) {
      return c.json({ success: false, error: '등록되지 않은 부자재 코드입니다.' }, 404)
    }

    const diff = new_stock - (supply.current_stock || 0)
    const date = new Date().toISOString().split('T')[0]

    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE supplies SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE item_code = ?')
        .bind(new_stock, item_code),
      c.env.DB.prepare(`
        INSERT INTO supply_transactions (trans_date, item_code, trans_type, quantity, reference_type, memo)
        VALUES (?, ?, '재고조정', ?, 'manual', ?)
      `).bind(date, item_code, diff, memo || '재고 실사 조정')
    ])

    return c.json({ success: true, message: '재고가 조정되었습니다.', diff })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 일별수불부 (부자재/포장재) =====
packaging.get('/ledger', async (c) => {
  try {
    const startDate = c.req.query('start') || new Date().toISOString().split('T')[0]
    const endDate = c.req.query('end') || startDate
    const itemCode = c.req.query('item_code')

    let itemFilter = ''
    const params: any[] = [startDate, endDate]
    if (itemCode) {
      itemFilter = ' AND item_code = ?'
      params.push(itemCode)
    }

    // 기간 내 일자별 입고/사용/조정 합계
    const daily = await c.env.DB.prepare(`
      SELECT 
        trans_date,
        item_code,
        SUM(CASE WHEN trans_type = '입고' THEN quantity ELSE 0 END) as inbound_qty,
        SUM(CASE WHEN trans_type = '사용' THEN -quantity ELSE 0 END) as usage_qty,
        SUM(CASE WHEN trans_type = '재고조정' THEN quantity ELSE 0 END) as adjust_qty
      FROM supply_transactions
      WHERE trans_date BETWEEN ? AND ? ${itemFilter}
      GROUP BY trans_date, item_code
      ORDER BY trans_date DESC, item_code
    `).bind(...params).all()

    // 품목명/현재고 붙이기
    const codes = [...new Set((daily.results as any[]).map(r => r.item_code))]
    let nameMap = new Map<string, any>()
    if (codes.length > 0) {
      const placeholders = codes.map(() => '?').join(',')
      const supplyInfo = await c.env.DB.prepare(
        `SELECT item_code, item_name, unit, current_stock FROM supplies WHERE item_code IN (${placeholders})`
      ).bind(...codes).all()
      nameMap = new Map((supplyInfo.results as any[]).map(s => [s.item_code, s]))
    }

    const data = (daily.results as any[]).map(r => {
      const info = nameMap.get(r.item_code) || {}
      return {
        trans_date: r.trans_date,
        item_code: r.item_code,
        item_name: info.item_name || r.item_code,
        unit: info.unit || '',
        inbound_qty: r.inbound_qty,
        usage_qty: r.usage_qty,
        adjust_qty: r.adjust_qty,
        net_change: r.inbound_qty + r.usage_qty + r.adjust_qty,
        current_stock: info.current_stock
      }
    })

    return c.json({ success: true, start: startDate, end: endDate, data })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

export default packaging
