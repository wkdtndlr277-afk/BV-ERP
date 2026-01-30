import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const admin = new Hono<{ Bindings: Bindings }>()

// 관리자 인증
admin.post('/auth', async (c) => {
  const { password } = await c.req.json()
  const { env } = c
  
  try {
    const setting = await env.DB.prepare(
      'SELECT setting_value FROM admin_settings WHERE setting_key = ?'
    ).bind('admin_password').first()
    
    if (!setting) {
      return c.json({ success: false, message: '관리자 설정이 없습니다' }, 401)
    }
    
    if (setting.setting_value === password) {
      // 로그 기록
      await env.DB.prepare(
        'INSERT INTO admin_logs (action_type, target_table, reason) VALUES (?, ?, ?)'
      ).bind('로그인', 'admin', '관리자 로그인').run()
      
      return c.json({ success: true, message: '인증 성공', token: 'admin-authenticated' })
    } else {
      return c.json({ success: false, message: '비밀번호가 올바르지 않습니다' }, 401)
    }
  } catch (error) {
    return c.json({ success: false, message: '인증 오류' }, 500)
  }
})

// 비밀번호 변경
admin.post('/change-password', async (c) => {
  const { currentPassword, newPassword } = await c.req.json()
  const { env } = c
  
  try {
    const setting = await env.DB.prepare(
      'SELECT setting_value FROM admin_settings WHERE setting_key = ?'
    ).bind('admin_password').first()
    
    if (!setting || setting.setting_value !== currentPassword) {
      return c.json({ success: false, message: '현재 비밀번호가 올바르지 않습니다' }, 401)
    }
    
    await env.DB.prepare(
      'UPDATE admin_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?'
    ).bind(newPassword, 'admin_password').run()
    
    await env.DB.prepare(
      'INSERT INTO admin_logs (action_type, target_table, reason) VALUES (?, ?, ?)'
    ).bind('비밀번호변경', 'admin_settings', '관리자 비밀번호 변경').run()
    
    return c.json({ success: true, message: '비밀번호가 변경되었습니다' })
  } catch (error) {
    return c.json({ success: false, message: '비밀번호 변경 실패' }, 500)
  }
})

// ========== 입고(Inbound) 관리 ==========

// 입고 목록 조회 (관리자용 - 전체)
admin.get('/inbound', async (c) => {
  const { env } = c
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '50')
  const offset = (page - 1) * limit
  
  try {
    const data = await env.DB.prepare(`
      SELECT i.*, m.item_name, m.unit
      FROM inbound i
      LEFT JOIN master m ON i.item_code = m.item_code
      ORDER BY i.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all()
    
    const countResult = await env.DB.prepare('SELECT COUNT(*) as total FROM inbound').first()
    
    return c.json({
      success: true,
      data: data.results,
      pagination: {
        page,
        limit,
        total: countResult?.total || 0,
        totalPages: Math.ceil((countResult?.total as number || 0) / limit)
      }
    })
  } catch (error) {
    return c.json({ success: false, message: '조회 실패' }, 500)
  }
})

// 입고 수정
admin.put('/inbound/:id', async (c) => {
  const id = c.req.param('id')
  const { origin_qty, remain_qty, expiry_date, quality_status, supplier, reason } = await c.req.json()
  const { env } = c
  
  try {
    // 기존 데이터 조회
    const oldData = await env.DB.prepare('SELECT * FROM inbound WHERE id = ?').bind(id).first()
    if (!oldData) {
      return c.json({ success: false, message: '입고 데이터를 찾을 수 없습니다' }, 404)
    }
    
    // 재고 차이 계산
    const qtyDiff = (remain_qty || oldData.remain_qty) - (oldData.remain_qty as number)
    
    // 입고 데이터 수정
    await env.DB.prepare(`
      UPDATE inbound 
      SET origin_qty = ?, remain_qty = ?, expiry_date = ?, 
          quality_status = ?, supplier = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      origin_qty || oldData.origin_qty,
      remain_qty || oldData.remain_qty,
      expiry_date || oldData.expiry_date,
      quality_status || oldData.quality_status,
      supplier || oldData.supplier,
      id
    ).run()
    
    // 잔량 변경 시 마스터 재고 업데이트
    if (qtyDiff !== 0) {
      await env.DB.prepare(`
        UPDATE master 
        SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP
        WHERE item_code = ?
      `).bind(qtyDiff, oldData.item_code).run()
      
      // 재고조정 트랜잭션 기록
      await env.DB.prepare(`
        INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, remain_qty, memo)
        VALUES (date('now'), ?, '재고조정', ?, ?, ?, ?)
      `).bind(oldData.item_code, qtyDiff, oldData.lot_number, remain_qty, `[관리자 수정] ${reason || ''}`).run()
    }
    
    // 로그 기록
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, target_id, before_data, after_data, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      '수정', 
      'inbound', 
      id, 
      JSON.stringify(oldData),
      JSON.stringify({ origin_qty, remain_qty, expiry_date, quality_status, supplier }),
      reason || '관리자 수정'
    ).run()
    
    return c.json({ success: true, message: '입고 데이터가 수정되었습니다' })
  } catch (error) {
    return c.json({ success: false, message: '수정 실패' }, 500)
  }
})

// 입고 삭제
admin.delete('/inbound/:id', async (c) => {
  const id = c.req.param('id')
  const { reason } = await c.req.json()
  const { env } = c
  
  try {
    // 기존 데이터 조회
    const oldData = await env.DB.prepare('SELECT * FROM inbound WHERE id = ?').bind(id).first()
    if (!oldData) {
      return c.json({ success: false, message: '입고 데이터를 찾을 수 없습니다' }, 404)
    }
    
    // 관련 트랜잭션 삭제
    await env.DB.prepare('DELETE FROM transactions WHERE lot_number = ?').bind(oldData.lot_number).run()
    
    // 합격 상태였던 경우 재고 차감
    if (oldData.quality_status === '합격') {
      await env.DB.prepare(`
        UPDATE master 
        SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP
        WHERE item_code = ?
      `).bind(oldData.remain_qty, oldData.item_code).run()
    }
    
    // 입고 삭제
    await env.DB.prepare('DELETE FROM inbound WHERE id = ?').bind(id).run()
    
    // 로그 기록
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, target_id, before_data, reason)
      VALUES (?, ?, ?, ?, ?)
    `).bind('삭제', 'inbound', id, JSON.stringify(oldData), reason || '관리자 삭제').run()
    
    return c.json({ success: true, message: '입고 데이터가 삭제되었습니다' })
  } catch (error) {
    return c.json({ success: false, message: '삭제 실패' }, 500)
  }
})

// ========== 트랜잭션 관리 ==========

// 트랜잭션 목록 조회
admin.get('/transactions', async (c) => {
  const { env } = c
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '50')
  const offset = (page - 1) * limit
  
  try {
    const data = await env.DB.prepare(`
      SELECT t.*, m.item_name, m.unit
      FROM transactions t
      LEFT JOIN master m ON t.item_code = m.item_code
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all()
    
    const countResult = await env.DB.prepare('SELECT COUNT(*) as total FROM transactions').first()
    
    return c.json({
      success: true,
      data: data.results,
      pagination: {
        page,
        limit,
        total: countResult?.total || 0,
        totalPages: Math.ceil((countResult?.total as number || 0) / limit)
      }
    })
  } catch (error) {
    return c.json({ success: false, message: '조회 실패' }, 500)
  }
})

// 트랜잭션 수정
admin.put('/transactions/:id', async (c) => {
  const id = c.req.param('id')
  const { quantity, memo, reason } = await c.req.json()
  const { env } = c
  
  try {
    const oldData = await env.DB.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first()
    if (!oldData) {
      return c.json({ success: false, message: '트랜잭션을 찾을 수 없습니다' }, 404)
    }
    
    const qtyDiff = quantity - (oldData.quantity as number)
    
    // 트랜잭션 수정
    await env.DB.prepare(`
      UPDATE transactions SET quantity = ?, memo = ? WHERE id = ?
    `).bind(quantity, memo || oldData.memo, id).run()
    
    // 재고 조정 (입고는 +, 사용/출고는 -)
    if (qtyDiff !== 0) {
      let stockAdjust = qtyDiff
      if (oldData.trans_type === '사용' || oldData.trans_type === '출고') {
        stockAdjust = -qtyDiff // 사용/출고는 반대로
      }
      
      await env.DB.prepare(`
        UPDATE master SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP
        WHERE item_code = ?
      `).bind(stockAdjust, oldData.item_code).run()
      
      // LOT 잔량 조정
      if (oldData.lot_number) {
        await env.DB.prepare(`
          UPDATE inbound SET remain_qty = remain_qty + ?, updated_at = CURRENT_TIMESTAMP
          WHERE lot_number = ?
        `).bind(stockAdjust, oldData.lot_number).run()
      }
    }
    
    // 로그 기록
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, target_id, before_data, after_data, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('수정', 'transactions', id, JSON.stringify(oldData), JSON.stringify({ quantity, memo }), reason || '관리자 수정').run()
    
    return c.json({ success: true, message: '트랜잭션이 수정되었습니다' })
  } catch (error) {
    return c.json({ success: false, message: '수정 실패' }, 500)
  }
})

// 트랜잭션 삭제
admin.delete('/transactions/:id', async (c) => {
  const id = c.req.param('id')
  const { reason } = await c.req.json()
  const { env } = c
  
  try {
    const oldData = await env.DB.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first()
    if (!oldData) {
      return c.json({ success: false, message: '트랜잭션을 찾을 수 없습니다' }, 404)
    }
    
    // 재고 원복
    let stockRevert = -(oldData.quantity as number)
    if (oldData.trans_type === '사용' || oldData.trans_type === '출고') {
      stockRevert = oldData.quantity as number
    }
    
    await env.DB.prepare(`
      UPDATE master SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP
      WHERE item_code = ?
    `).bind(stockRevert, oldData.item_code).run()
    
    // LOT 잔량 원복
    if (oldData.lot_number) {
      await env.DB.prepare(`
        UPDATE inbound SET remain_qty = remain_qty + ?, updated_at = CURRENT_TIMESTAMP
        WHERE lot_number = ?
      `).bind(stockRevert, oldData.lot_number).run()
    }
    
    // 트랜잭션 삭제
    await env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run()
    
    // 로그 기록
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, target_id, before_data, reason)
      VALUES (?, ?, ?, ?, ?)
    `).bind('삭제', 'transactions', id, JSON.stringify(oldData), reason || '관리자 삭제').run()
    
    return c.json({ success: true, message: '트랜잭션이 삭제되었습니다' })
  } catch (error) {
    return c.json({ success: false, message: '삭제 실패' }, 500)
  }
})

// ========== 마스터 데이터 관리 ==========

// 마스터 재고 강제 수정 (가상 LOT 자동 생성으로 FEFO 추적 가능)
admin.put('/master/:item_code/stock', async (c) => {
  const item_code = c.req.param('item_code')
  const { new_stock, reason } = await c.req.json()
  const { env } = c
  
  try {
    const oldData = await env.DB.prepare('SELECT * FROM master WHERE item_code = ?').bind(item_code).first() as any
    if (!oldData) {
      return c.json({ success: false, message: '품목을 찾을 수 없습니다' }, 404)
    }
    
    const diff = new_stock - (oldData.current_stock || 0)
    const today = new Date().toISOString().split('T')[0]
    const todayCompact = today.replace(/-/g, '')
    
    // 마스터 재고 수정
    await env.DB.prepare(`
      UPDATE master SET current_stock = ?, updated_at = CURRENT_TIMESTAMP
      WHERE item_code = ?
    `).bind(new_stock, item_code).run()
    
    // diff > 0 인 경우 (재고 증가) - 가상 LOT 생성
    if (diff > 0) {
      // 유통기한 계산 (기본 365일 또는 master의 expiry_days 사용)
      const expiryDays = oldData.expiry_days || 365
      const expiryDate = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      
      // 가상 LOT 번호 생성 (ADJ-날짜-품목코드-순번)
      const countResult = await env.DB.prepare(`
        SELECT COUNT(*) as cnt FROM inbound 
        WHERE lot_number LIKE ? AND inbound_date = ?
      `).bind(`ADJ-${todayCompact}-${item_code}%`, today).first() as any
      const seq = String((countResult?.cnt || 0) + 1).padStart(3, '0')
      const lot_number = `ADJ-${todayCompact}-${item_code}-${seq}`
      
      // 입고(inbound) 테이블에 가상 LOT 등록
      await env.DB.prepare(`
        INSERT INTO inbound (lot_number, item_code, inbound_date, expiry_date, origin_qty, remain_qty, quality_status, supplier, memo)
        VALUES (?, ?, ?, ?, ?, ?, '합격', '재고조정', ?)
      `).bind(lot_number, item_code, today, expiryDate, diff, diff, `[재고조정] ${reason || ''}`).run()
      
      // 트랜잭션 기록 (LOT 포함)
      await env.DB.prepare(`
        INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, memo)
        VALUES (?, ?, '재고조정', ?, ?, ?)
      `).bind(today, item_code, diff, lot_number, `[관리자 재고조정] ${reason || ''}`).run()
      
    } else if (diff < 0) {
      // diff < 0 인 경우 (재고 감소) - FEFO로 기존 LOT에서 차감
      let remaining = Math.abs(diff)
      
      // 합격된 LOT 중 잔량이 있는 것을 유통기한 순으로 조회
      const lots = await env.DB.prepare(`
        SELECT lot_number, remain_qty FROM inbound
        WHERE item_code = ? AND remain_qty > 0 AND quality_status = '합격'
        ORDER BY expiry_date ASC, inbound_date ASC
      `).bind(item_code).all()
      
      for (const lot of (lots.results || []) as any[]) {
        if (remaining <= 0) break
        
        const deductQty = Math.min(lot.remain_qty, remaining)
        remaining -= deductQty
        
        // LOT 잔량 차감
        await env.DB.prepare(`
          UPDATE inbound SET remain_qty = remain_qty - ?, updated_at = CURRENT_TIMESTAMP
          WHERE lot_number = ?
        `).bind(deductQty, lot.lot_number).run()
        
        // 트랜잭션 기록
        await env.DB.prepare(`
          INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, memo)
          VALUES (?, ?, '재고조정', ?, ?, ?)
        `).bind(today, item_code, -deductQty, lot.lot_number, `[관리자 재고조정] ${reason || ''}`).run()
      }
      
      // LOT 없이 남은 차감량이 있으면 LOT 없이 트랜잭션만 기록
      if (remaining > 0) {
        await env.DB.prepare(`
          INSERT INTO transactions (trans_date, item_code, trans_type, quantity, memo)
          VALUES (?, ?, '재고조정', ?, ?)
        `).bind(today, item_code, -remaining, `[관리자 재고조정-LOT없음] ${reason || ''}`).run()
      }
    }
    
    // 로그 기록
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, target_id, before_data, after_data, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('재고조정', 'master', oldData.id, JSON.stringify({ current_stock: oldData.current_stock }), JSON.stringify({ current_stock: new_stock }), reason || '관리자 강제조정').run()
    
    return c.json({ success: true, message: '재고가 조정되었습니다', diff })
  } catch (error) {
    console.error('Stock adjustment error:', error)
    return c.json({ success: false, message: '재고 조정 실패' }, 500)
  }
})

// ========== 재고 재계산 ==========

// 전체 재고 재계산 (입고 잔량 합계로 마스터 재고 동기화)
admin.post('/recalculate-stock', async (c) => {
  const { env } = c
  const { reason } = await c.req.json()
  
  try {
    // 모든 품목의 재고를 입고 잔량 합계로 재계산
    const items = await env.DB.prepare('SELECT item_code, current_stock FROM master').all()
    
    const results = []
    for (const item of items.results as any[]) {
      // 해당 품목의 합격 입고 잔량 합계
      const sumResult = await env.DB.prepare(`
        SELECT COALESCE(SUM(remain_qty), 0) as total_remain
        FROM inbound
        WHERE item_code = ? AND quality_status = '합격'
      `).bind(item.item_code).first()
      
      const calculatedStock = sumResult?.total_remain || 0
      const diff = (calculatedStock as number) - (item.current_stock as number)
      
      if (diff !== 0) {
        // 마스터 재고 업데이트
        await env.DB.prepare(`
          UPDATE master SET current_stock = ?, updated_at = CURRENT_TIMESTAMP
          WHERE item_code = ?
        `).bind(calculatedStock, item.item_code).run()
        
        // 재고조정 트랜잭션 기록
        await env.DB.prepare(`
          INSERT INTO transactions (trans_date, item_code, trans_type, quantity, memo)
          VALUES (date('now'), ?, '재고조정', ?, ?)
        `).bind(item.item_code, diff, `[시스템 재계산] ${reason || ''}`).run()
        
        results.push({
          item_code: item.item_code,
          before: item.current_stock,
          after: calculatedStock,
          diff
        })
      }
    }
    
    // 로그 기록
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, before_data, after_data, reason)
      VALUES (?, ?, ?, ?, ?)
    `).bind('재계산', 'master', JSON.stringify({ items_count: items.results.length }), JSON.stringify({ adjusted: results.length, details: results }), reason || '전체 재고 재계산').run()
    
    return c.json({
      success: true,
      message: `${results.length}개 품목의 재고가 재계산되었습니다`,
      adjusted: results
    })
  } catch (error) {
    return c.json({ success: false, message: '재계산 실패' }, 500)
  }
})

// ========== 로그 조회 ==========

// 관리자 로그 조회
admin.get('/logs', async (c) => {
  const { env } = c
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '50')
  const offset = (page - 1) * limit
  const action_type = c.req.query('action_type')
  const target_table = c.req.query('target_table')
  
  try {
    let query = 'SELECT * FROM admin_logs WHERE 1=1'
    const params: any[] = []
    
    if (action_type) {
      query += ' AND action_type = ?'
      params.push(action_type)
    }
    if (target_table) {
      query += ' AND target_table = ?'
      params.push(target_table)
    }
    
    query += ' ORDER BY action_date DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)
    
    const data = await env.DB.prepare(query).bind(...params).all()
    
    let countQuery = 'SELECT COUNT(*) as total FROM admin_logs WHERE 1=1'
    const countParams: any[] = []
    if (action_type) {
      countQuery += ' AND action_type = ?'
      countParams.push(action_type)
    }
    if (target_table) {
      countQuery += ' AND target_table = ?'
      countParams.push(target_table)
    }
    
    const countResult = await env.DB.prepare(countQuery).bind(...countParams).first()
    
    return c.json({
      success: true,
      data: data.results,
      pagination: {
        page,
        limit,
        total: countResult?.total || 0,
        totalPages: Math.ceil((countResult?.total as number || 0) / limit)
      }
    })
  } catch (error) {
    return c.json({ success: false, message: '로그 조회 실패' }, 500)
  }
})

// 품질 KPI 삭제
admin.delete('/quality/:id', async (c) => {
  const id = c.req.param('id')
  const { reason } = await c.req.json()
  const { env } = c
  
  try {
    const oldData = await env.DB.prepare('SELECT * FROM quality_kpi WHERE id = ?').bind(id).first()
    if (!oldData) {
      return c.json({ success: false, message: 'KPI 데이터를 찾을 수 없습니다' }, 404)
    }
    
    await env.DB.prepare('DELETE FROM quality_kpi WHERE id = ?').bind(id).run()
    
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, target_id, before_data, reason)
      VALUES (?, ?, ?, ?, ?)
    `).bind('삭제', 'quality_kpi', id, JSON.stringify(oldData), reason || '관리자 삭제').run()
    
    return c.json({ success: true, message: 'KPI 데이터가 삭제되었습니다' })
  } catch (error) {
    return c.json({ success: false, message: '삭제 실패' }, 500)
  }
})

export default admin
