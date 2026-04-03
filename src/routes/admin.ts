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

// 수불부 데이터 동기화 - LOT 기반으로 transactions 재계산
// LOT 잔량이 정확하다고 가정하고, 계산 잔량과 차이를 재고조정으로 보정
admin.post('/sync-stock-ledger', async (c) => {
  const { env } = c
  const { reason, item_codes } = await c.req.json()
  
  try {
    // 동기화 대상 품목 조회
    let items: any[] = []
    if (item_codes && item_codes.length > 0) {
      // 특정 품목만
      const placeholders = item_codes.map(() => '?').join(',')
      const result = await env.DB.prepare(
        `SELECT item_code, item_name, category, current_stock FROM master WHERE item_code IN (${placeholders})`
      ).bind(...item_codes).all()
      items = result.results as any[]
    } else {
      // 전체 원료/부자재
      const result = await env.DB.prepare(
        "SELECT item_code, item_name, category, current_stock FROM master WHERE category IN ('원료', '부자재')"
      ).all()
      items = result.results as any[]
    }
    
    const adjustments: any[] = []
    const errors: string[] = []
    
    for (const item of items) {
      try {
        // 1. LOT 기준 데이터
        const lotData = await env.DB.prepare(`
          SELECT 
            COALESCE(SUM(origin_qty), 0) as total_inbound,
            COALESCE(SUM(remain_qty), 0) as total_remain
          FROM inbound
          WHERE item_code = ? AND quality_status = '합격'
        `).bind(item.item_code).first() as any
        
        // LOT 기반 실제 사용량 = 입고 합계 - 잔량 합계
        const lotBasedUsage = (lotData?.total_inbound || 0) - (lotData?.total_remain || 0)
        
        // 2. Transactions 기준 데이터
        const transData = await env.DB.prepare(`
          SELECT
            COALESCE(SUM(CASE WHEN trans_type = '입고' THEN quantity ELSE 0 END), 0) as trans_inbound,
            COALESCE(SUM(CASE WHEN trans_type = '사용' THEN ABS(quantity) ELSE 0 END), 0) as trans_usage,
            COALESCE(SUM(CASE WHEN trans_type = '출고' THEN ABS(quantity) ELSE 0 END), 0) as trans_outbound,
            COALESCE(SUM(CASE WHEN trans_type = '재고조정' THEN quantity ELSE 0 END), 0) as trans_adjustment
          FROM transactions
          WHERE item_code = ?
        `).bind(item.item_code).first() as any
        
        // 현재 transactions 기반 계산 잔량
        const transBasedRemain = (transData?.trans_inbound || 0) 
          - (transData?.trans_usage || 0) 
          - (transData?.trans_outbound || 0) 
          + (transData?.trans_adjustment || 0)
        
        // 3. 차이 계산
        const lotRemain = lotData?.total_remain || 0
        const diff = lotRemain - transBasedRemain  // 양수: LOT이 더 많음 (재고조정 +), 음수: transactions이 더 많음 (재고조정 -)
        
        // 차이가 0.01 이상인 경우만 조정
        if (Math.abs(diff) > 0.01) {
          // 재고조정 트랜잭션 추가
          await env.DB.prepare(`
            INSERT INTO transactions (trans_date, item_code, trans_type, quantity, memo)
            VALUES (date('now'), ?, '재고조정', ?, ?)
          `).bind(item.item_code, diff, `[수불부 동기화] ${reason || ''} - LOT잔량: ${lotRemain.toFixed(2)}, 계산잔량: ${transBasedRemain.toFixed(2)}`).run()
          
          // 마스터 재고도 LOT 잔량으로 업데이트
          if (item.current_stock !== lotRemain) {
            await env.DB.prepare(`
              UPDATE master SET current_stock = ?, updated_at = CURRENT_TIMESTAMP
              WHERE item_code = ?
            `).bind(lotRemain, item.item_code).run()
          }
          
          adjustments.push({
            item_code: item.item_code,
            item_name: item.item_name,
            lot_inbound: lotData?.total_inbound || 0,
            lot_remain: lotRemain,
            lot_usage: lotBasedUsage,
            trans_usage: transData?.trans_usage || 0,
            trans_based_remain: transBasedRemain,
            adjustment: diff,
            master_before: item.current_stock,
            master_after: lotRemain
          })
        }
      } catch (itemError: any) {
        errors.push(`${item.item_code}: ${itemError.message}`)
      }
    }
    
    // 로그 기록
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, before_data, after_data, reason)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      '수불부동기화', 
      'transactions', 
      JSON.stringify({ items_count: items.length }), 
      JSON.stringify({ adjusted: adjustments.length, errors: errors.length, details: adjustments.slice(0, 10) }), 
      reason || '수불부 LOT 동기화'
    ).run()
    
    return c.json({
      success: true,
      message: `${adjustments.length}개 품목의 수불부가 동기화되었습니다`,
      total_items: items.length,
      adjusted: adjustments.length,
      details: adjustments,
      errors: errors.length > 0 ? errors : undefined
    })
  } catch (error: any) {
    return c.json({ success: false, message: '수불부 동기화 실패: ' + error.message }, 500)
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

// ========== 데이터베이스 마이그레이션 ==========

// BOM 테이블 및 관련 테이블 생성 (프로덕션 D1 초기화용)
admin.post('/migrate/production-bom', async (c) => {
  const { env } = c
  
  try {
    // BOM 테이블 생성
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS bom (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_code TEXT NOT NULL,
        item_code TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit TEXT NOT NULL DEFAULT 'g',
        sort_order INTEGER DEFAULT 0,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_code, item_code)
      )
    `).run()
    
    // production 테이블 생성
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS production (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prod_date DATE NOT NULL,
        product_code TEXT NOT NULL,
        quantity REAL NOT NULL,
        lot_number TEXT,
        status TEXT DEFAULT '완료' CHECK (status IN ('계획', '진행중', '완료', '취소')),
        memo TEXT,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // production_materials 테이블 생성
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS production_materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        production_id INTEGER NOT NULL,
        item_code TEXT NOT NULL,
        lot_number TEXT,
        planned_qty REAL NOT NULL,
        actual_qty REAL,
        unit TEXT NOT NULL DEFAULT 'g',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // product_outbound 테이블 생성
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS product_outbound (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        outbound_date DATE NOT NULL,
        product_code TEXT NOT NULL,
        quantity REAL NOT NULL,
        lot_number TEXT,
        market TEXT,
        order_number TEXT,
        customer TEXT,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // market_codes 테이블 생성
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS market_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_code TEXT NOT NULL,
        market TEXT NOT NULL,
        market_product_code TEXT,
        market_product_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_code, market)
      )
    `).run()
    
    // 인덱스 생성 (에러 무시)
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_bom_product_code ON bom(product_code)').run() } catch {}
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_bom_item_code ON bom(item_code)').run() } catch {}
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_production_date ON production(prod_date)').run() } catch {}
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_production_product ON production(product_code)').run() } catch {}
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_production_materials_prod ON production_materials(production_id)').run() } catch {}
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_product_outbound_date ON product_outbound(outbound_date)').run() } catch {}
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_market_codes_product ON market_codes(product_code)').run() } catch {}
    
    // 로그 기록
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, reason)
      VALUES (?, ?, ?)
    `).bind('마이그레이션', 'bom,production,production_materials,product_outbound,market_codes', 'BOM/생산관리 테이블 생성').run()
    
    return c.json({ 
      success: true, 
      message: 'BOM 및 생산관리 테이블이 생성되었습니다.',
      tables: ['bom', 'production', 'production_materials', 'product_outbound', 'market_codes']
    })
  } catch (error: any) {
    return c.json({ success: false, message: `마이그레이션 실패: ${error.message}` }, 500)
  }
})

// 테이블 목록 조회
admin.get('/tables', async (c) => {
  const { env } = c
  
  try {
    const result = await env.DB.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
    `).all()
    
    return c.json({ success: true, tables: result.results?.map((r: any) => r.name) })
  } catch (error: any) {
    return c.json({ success: false, message: error.message }, 500)
  }
})

// ========== 최고관리자 전용 기능 ==========

// 권한 체크 헬퍼
async function isSuperAdmin(env: D1Database, token: string): Promise<boolean> {
  const session = await env.prepare(`
    SELECT u.role FROM Sessions s
    JOIN Users u ON s.user_id = u.id
    WHERE s.session_token = ? AND s.expires_at > datetime('now')
  `).bind(token).first()
  return session?.role === 'super_admin'
}

// 모든 데이터 일괄 삭제 (최고관리자 전용)
admin.delete('/super/all-data/:table', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  const table = c.req.param('table')
  const { reason } = await c.req.json()
  const { env } = c
  
  if (!token || !await isSuperAdmin(env.DB, token)) {
    return c.json({ success: false, message: '최고관리자 권한이 필요합니다' }, 403)
  }
  
  const allowedTables = ['inbound', 'transactions', 'production', 'production_materials', 'product_outbound', 'bom', 'quality_kpi']
  if (!allowedTables.includes(table)) {
    return c.json({ success: false, message: '삭제할 수 없는 테이블입니다' }, 400)
  }
  
  try {
    // 삭제 전 데이터 카운트
    const countResult = await env.DB.prepare(`SELECT COUNT(*) as count FROM ${table}`).first()
    const count = countResult?.count || 0
    
    // 데이터 삭제
    await env.DB.prepare(`DELETE FROM ${table}`).run()
    
    // 재고 관련 테이블이면 마스터 재고 초기화
    if (table === 'inbound' || table === 'transactions') {
      await env.DB.prepare(`UPDATE master SET current_stock = 0, updated_at = CURRENT_TIMESTAMP`).run()
    }
    
    // 로그 기록
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, before_data, reason)
      VALUES (?, ?, ?, ?)
    `).bind('전체삭제', table, JSON.stringify({ deleted_count: count }), `[최고관리자] ${reason || '전체 삭제'}`).run()
    
    return c.json({ success: true, message: `${table} 테이블의 ${count}건이 삭제되었습니다`, deleted: count })
  } catch (error: any) {
    return c.json({ success: false, message: `삭제 실패: ${error.message}` }, 500)
  }
})

// 마스터 데이터 전체 삭제 (최고관리자 전용)
admin.delete('/super/master-data', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  const { category, reason } = await c.req.json()
  const { env } = c
  
  if (!token || !await isSuperAdmin(env.DB, token)) {
    return c.json({ success: false, message: '최고관리자 권한이 필요합니다' }, 403)
  }
  
  try {
    let query = 'DELETE FROM master'
    const params: any[] = []
    
    if (category) {
      query += ' WHERE category = ?'
      params.push(category)
    }
    
    // 삭제 전 카운트
    let countQuery = 'SELECT COUNT(*) as count FROM master'
    if (category) countQuery += ' WHERE category = ?'
    const countResult = await env.DB.prepare(countQuery).bind(...params).first()
    const count = countResult?.count || 0
    
    // 관련 데이터 먼저 삭제
    if (category === '제품') {
      await env.DB.prepare('DELETE FROM bom').run()
      await env.DB.prepare('DELETE FROM production').run()
      await env.DB.prepare('DELETE FROM production_materials').run()
      await env.DB.prepare('DELETE FROM product_outbound').run()
    } else if (category === '원료') {
      await env.DB.prepare('DELETE FROM bom').run()
      await env.DB.prepare('DELETE FROM inbound WHERE item_code IN (SELECT item_code FROM master WHERE category = ?)').bind('원료').run()
      await env.DB.prepare('DELETE FROM transactions WHERE item_code IN (SELECT item_code FROM master WHERE category = ?)').bind('원료').run()
    }
    
    // 마스터 삭제
    await env.DB.prepare(query).bind(...params).run()
    
    // 로그 기록
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, before_data, reason)
      VALUES (?, ?, ?, ?)
    `).bind('마스터삭제', 'master', JSON.stringify({ category, deleted_count: count }), `[최고관리자] ${reason || '마스터 삭제'}`).run()
    
    return c.json({ success: true, message: `마스터 데이터 ${count}건이 삭제되었습니다`, deleted: count })
  } catch (error: any) {
    return c.json({ success: false, message: `삭제 실패: ${error.message}` }, 500)
  }
})

// 데이터베이스 통계 조회 (최고관리자 전용)
admin.get('/super/db-stats', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  const { env } = c
  
  if (!token || !await isSuperAdmin(env.DB, token)) {
    return c.json({ success: false, message: '최고관리자 권한이 필요합니다' }, 403)
  }
  
  try {
    const tables = ['master', 'inbound', 'transactions', 'bom', 'production', 'production_materials', 
                    'product_outbound', 'quality_kpi', 'Users', 'Sessions', 'admin_logs']
    
    const stats: any = {}
    for (const table of tables) {
      try {
        const result = await env.DB.prepare(`SELECT COUNT(*) as count FROM ${table}`).first()
        stats[table] = result?.count || 0
      } catch {
        stats[table] = 'N/A'
      }
    }
    
    // 카테고리별 마스터 통계
    const masterStats = await env.DB.prepare(`
      SELECT category, COUNT(*) as count FROM master GROUP BY category
    `).all()
    
    return c.json({ 
      success: true, 
      stats, 
      masterByCategory: masterStats.results,
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    return c.json({ success: false, message: error.message }, 500)
  }
})

// 모든 품목 수정 (최고관리자 전용)
admin.put('/super/master/:item_code', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  const item_code = c.req.param('item_code')
  const { item_name, category, unit, safety_stock, expiry_days, reason } = await c.req.json()
  const { env } = c
  
  if (!token || !await isSuperAdmin(env.DB, token)) {
    return c.json({ success: false, message: '최고관리자 권한이 필요합니다' }, 403)
  }
  
  try {
    const oldData = await env.DB.prepare('SELECT * FROM master WHERE item_code = ?').bind(item_code).first()
    if (!oldData) {
      return c.json({ success: false, message: '품목을 찾을 수 없습니다' }, 404)
    }
    
    await env.DB.prepare(`
      UPDATE master 
      SET item_name = COALESCE(?, item_name),
          category = COALESCE(?, category),
          unit = COALESCE(?, unit),
          safety_stock = COALESCE(?, safety_stock),
          expiry_days = COALESCE(?, expiry_days),
          updated_at = CURRENT_TIMESTAMP
      WHERE item_code = ?
    `).bind(item_name, category, unit, safety_stock, expiry_days, item_code).run()
    
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, target_id, before_data, after_data, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('마스터수정', 'master', item_code, JSON.stringify(oldData), JSON.stringify({ item_name, category, unit, safety_stock, expiry_days }), `[최고관리자] ${reason || '품목 수정'}`).run()
    
    return c.json({ success: true, message: '품목이 수정되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, message: `수정 실패: ${error.message}` }, 500)
  }
})

// 품목 강제 삭제 (최고관리자 전용 - 관련 데이터 포함)
admin.delete('/super/master/:item_code', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  const item_code = c.req.param('item_code')
  const { reason } = await c.req.json()
  const { env } = c
  
  if (!token || !await isSuperAdmin(env.DB, token)) {
    return c.json({ success: false, message: '최고관리자 권한이 필요합니다' }, 403)
  }
  
  try {
    const oldData = await env.DB.prepare('SELECT * FROM master WHERE item_code = ?').bind(item_code).first()
    if (!oldData) {
      return c.json({ success: false, message: '품목을 찾을 수 없습니다' }, 404)
    }
    
    // 관련 데이터 삭제
    await env.DB.prepare('DELETE FROM bom WHERE product_code = ? OR item_code = ?').bind(item_code, item_code).run()
    await env.DB.prepare('DELETE FROM production_materials WHERE item_code = ?').bind(item_code).run()
    await env.DB.prepare('DELETE FROM production WHERE product_code = ?').bind(item_code).run()
    await env.DB.prepare('DELETE FROM product_outbound WHERE product_code = ?').bind(item_code).run()
    await env.DB.prepare('DELETE FROM transactions WHERE item_code = ?').bind(item_code).run()
    await env.DB.prepare('DELETE FROM inbound WHERE item_code = ?').bind(item_code).run()
    
    // 마스터 삭제
    await env.DB.prepare('DELETE FROM master WHERE item_code = ?').bind(item_code).run()
    
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, target_id, before_data, reason)
      VALUES (?, ?, ?, ?, ?)
    `).bind('강제삭제', 'master', item_code, JSON.stringify(oldData), `[최고관리자] ${reason || '품목 강제 삭제 (관련 데이터 포함)'}`).run()
    
    return c.json({ success: true, message: '품목 및 관련 데이터가 삭제되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, message: `삭제 실패: ${error.message}` }, 500)
  }
})

// 생산 데이터 삭제 (최고관리자 전용)
admin.delete('/super/production/:id', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  const id = c.req.param('id')
  const { reason, restore_stock } = await c.req.json()
  const { env } = c
  
  if (!token || !await isSuperAdmin(env.DB, token)) {
    return c.json({ success: false, message: '최고관리자 권한이 필요합니다' }, 403)
  }
  
  try {
    const production = await env.DB.prepare('SELECT * FROM production WHERE id = ?').bind(id).first() as any
    if (!production) {
      return c.json({ success: false, message: '생산 기록을 찾을 수 없습니다' }, 404)
    }
    
    // 재고 복원 옵션이 있으면 원재료 재고 복원
    if (restore_stock) {
      const materials = await env.DB.prepare(`
        SELECT item_code, actual_qty, unit, lot_number FROM production_materials WHERE production_id = ?
      `).bind(id).all()
      
      for (const mat of materials.results as any[]) {
        const qty = mat.unit === 'g' ? mat.actual_qty / 1000 : mat.actual_qty
        
        // 마스터 재고 복원
        await env.DB.prepare(`
          UPDATE master SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP
          WHERE item_code = ?
        `).bind(qty, mat.item_code).run()
        
        // LOT 잔량 복원
        if (mat.lot_number) {
          await env.DB.prepare(`
            UPDATE inbound SET remain_qty = remain_qty + ?, updated_at = CURRENT_TIMESTAMP
            WHERE lot_number = ?
          `).bind(qty, mat.lot_number).run()
        }
      }
      
      // 생산된 제품 재고 차감
      await env.DB.prepare(`
        UPDATE master SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP
        WHERE item_code = ?
      `).bind(production.quantity, production.product_code).run()
      
      // 제품 입고 삭제
      await env.DB.prepare(`DELETE FROM inbound WHERE lot_number = ?`).bind(production.lot_number).run()
    }
    
    // 관련 트랜잭션 삭제
    await env.DB.prepare(`DELETE FROM transactions WHERE memo LIKE ?`).bind(`%생산ID:${id}%`).run()
    
    // 사용 원재료 삭제
    await env.DB.prepare('DELETE FROM production_materials WHERE production_id = ?').bind(id).run()
    
    // 생산 기록 삭제
    await env.DB.prepare('DELETE FROM production WHERE id = ?').bind(id).run()
    
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, target_id, before_data, reason)
      VALUES (?, ?, ?, ?, ?)
    `).bind('생산삭제', 'production', id, JSON.stringify(production), `[최고관리자] ${reason || '생산 기록 삭제'}${restore_stock ? ' (재고 복원됨)' : ''}`).run()
    
    return c.json({ success: true, message: '생산 기록이 삭제되었습니다', restored_stock: restore_stock })
  } catch (error: any) {
    return c.json({ success: false, message: `삭제 실패: ${error.message}` }, 500)
  }
})

// BOM 일괄 삭제 (최고관리자 전용) - 제품 마스터도 함께 삭제
admin.delete('/super/bom-all', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  const { product_code, reason } = await c.req.json()
  const { env } = c
  
  if (!token || !await isSuperAdmin(env.DB, token)) {
    return c.json({ success: false, message: '최고관리자 권한이 필요합니다' }, 403)
  }
  
  try {
    let bomCount = 0
    let masterCount = 0
    
    if (product_code) {
      // 특정 제품만 삭제
      const bomCountResult = await env.DB.prepare('SELECT COUNT(*) as count FROM bom WHERE product_code = ?').bind(product_code).first()
      bomCount = bomCountResult?.count || 0
      
      // BOM 삭제
      await env.DB.prepare('DELETE FROM bom WHERE product_code = ?').bind(product_code).run()
      
      // 제품 마스터 삭제 (카테고리가 '제품'인 경우만)
      const masterResult = await env.DB.prepare('DELETE FROM master WHERE item_code = ? AND category = ?').bind(product_code, '제품').run()
      masterCount = masterResult.meta.changes || 0
    } else {
      // 전체 삭제
      const bomCountResult = await env.DB.prepare('SELECT COUNT(*) as count FROM bom').first()
      bomCount = bomCountResult?.count || 0
      
      const masterCountResult = await env.DB.prepare("SELECT COUNT(*) as count FROM master WHERE category = '제품'").first()
      masterCount = masterCountResult?.count || 0
      
      // BOM 전체 삭제
      await env.DB.prepare('DELETE FROM bom').run()
      
      // 제품 마스터 전체 삭제
      await env.DB.prepare("DELETE FROM master WHERE category = '제품'").run()
    }
    
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, before_data, reason)
      VALUES (?, ?, ?, ?)
    `).bind('BOM+제품삭제', 'bom,master', JSON.stringify({ 
      product_code: product_code || '전체', 
      bom_deleted: bomCount,
      master_deleted: masterCount 
    }), `[최고관리자] ${reason || 'BOM 및 제품 삭제'}`).run()
    
    return c.json({ 
      success: true, 
      message: `BOM ${bomCount}건, 제품 마스터 ${masterCount}건이 삭제되었습니다`, 
      deleted: { bom: bomCount, master: masterCount }
    })
  } catch (error: any) {
    return c.json({ success: false, message: `삭제 실패: ${error.message}` }, 500)
  }
})

// 제품 마스터 전체 삭제 (최고관리자 전용) - BOM 삭제 후 남은 제품 정리용
admin.delete('/super/products-all', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  const { env } = c
  
  if (!token || !await isSuperAdmin(env.DB, token)) {
    return c.json({ success: false, message: '최고관리자 권한이 필요합니다' }, 403)
  }
  
  try {
    // 제품 코드 목록 조회
    const products = await env.DB.prepare("SELECT item_code FROM master WHERE category = '제품'").all()
    const productCodes = products.results?.map((p: any) => p.item_code) || []
    const count = productCodes.length
    
    if (count === 0) {
      return c.json({ success: true, message: '삭제할 제품이 없습니다', deleted: 0 })
    }
    
    // 외래키 제약 조건 임시 해제
    await env.DB.prepare('PRAGMA foreign_keys = OFF').run()
    
    // 관련 테이블 순서대로 삭제 (자식 테이블 먼저)
    // 1. production_materials (production의 자식)
    const prodIds = await env.DB.prepare("SELECT id FROM production WHERE product_code IN (SELECT item_code FROM master WHERE category = '제품')").all()
    for (const p of (prodIds.results || []) as any[]) {
      await env.DB.prepare('DELETE FROM production_materials WHERE production_id = ?').bind(p.id).run()
    }
    
    // 2. production
    await env.DB.prepare("DELETE FROM production WHERE product_code IN (SELECT item_code FROM master WHERE category = '제품')").run()
    
    // 3. transactions
    await env.DB.prepare("DELETE FROM transactions WHERE item_code IN (SELECT item_code FROM master WHERE category = '제품')").run()
    
    // 4. bom (혹시 남아있는 것)
    await env.DB.prepare("DELETE FROM bom WHERE product_code IN (SELECT item_code FROM master WHERE category = '제품')").run()
    
    // 5. inbound (제품 입고가 있다면)
    await env.DB.prepare("DELETE FROM inbound WHERE item_code IN (SELECT item_code FROM master WHERE category = '제품')").run()
    
    // 6. 마지막으로 master 삭제
    await env.DB.prepare("DELETE FROM master WHERE category = '제품'").run()
    
    // 외래키 제약 조건 다시 활성화
    await env.DB.prepare('PRAGMA foreign_keys = ON').run()
    
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, before_data, reason)
      VALUES (?, ?, ?, ?)
    `).bind('제품전체삭제', 'master', JSON.stringify({ deleted_count: count }), '[최고관리자] 제품 마스터 전체 삭제').run()
    
    return c.json({ success: true, message: `제품 마스터 ${count}건 및 관련 데이터가 삭제되었습니다`, deleted: count })
  } catch (error: any) {
    // 에러 발생 시에도 외래키 제약 조건 복구
    await env.DB.prepare('PRAGMA foreign_keys = ON').run()
    return c.json({ success: false, message: `삭제 실패: ${error.message}` }, 500)
  }
})

// 부자재 카테고리 추가 마이그레이션
admin.post('/migrate/add-supplies-category', async (c) => {
  const { env } = c
  
  try {
    // 현재 master 테이블의 CHECK 제약 조건 확인
    const schemaResult = await env.DB.prepare(`
      SELECT sql FROM sqlite_master WHERE name = 'master' AND type = 'table'
    `).first()
    
    const currentSchema = schemaResult?.sql?.toString() || ''
    const hasCheck = currentSchema.includes('CHECK')
    
    if (!hasCheck) {
      return c.json({ 
        success: true, 
        message: 'master 테이블에 이미 CHECK 제약 조건이 없습니다. 부자재 등록이 가능합니다.'
      })
    }
    
    // D1 batch를 사용하여 여러 쿼리를 순차 실행
    // 먼저 현재 데이터 개수 확인
    const countBefore = await env.DB.prepare(`SELECT COUNT(*) as count FROM master`).first()
    
    // Step 1: 백업 테이블 생성 (이미 있으면 삭제)
    const results = await env.DB.batch([
      env.DB.prepare(`DROP TABLE IF EXISTS master_migration_backup`),
      env.DB.prepare(`CREATE TABLE master_migration_backup AS SELECT * FROM master`)
    ])
    
    // Step 2: 인덱스 삭제
    await env.DB.batch([
      env.DB.prepare(`DROP INDEX IF EXISTS idx_master_category`),
      env.DB.prepare(`DROP INDEX IF EXISTS idx_master_item_code`)
    ])
    
    // Step 3: 기존 테이블 삭제 시도 
    // foreign_keys가 활성화 되어있으면 실패할 수 있음
    // 그래서 참조하는 테이블들의 외래키를 먼저 처리해야 함
    
    // 참조 테이블들도 함께 재생성하는 방법을 사용
    // 모든 참조 테이블의 데이터를 백업
    await env.DB.batch([
      env.DB.prepare(`DROP TABLE IF EXISTS inbound_backup`),
      env.DB.prepare(`DROP TABLE IF EXISTS transactions_backup`),
      env.DB.prepare(`CREATE TABLE inbound_backup AS SELECT * FROM inbound`),
      env.DB.prepare(`CREATE TABLE transactions_backup AS SELECT * FROM transactions`)
    ])
    
    // 참조 테이블 삭제 (역순 - 자식 먼저)
    await env.DB.batch([
      env.DB.prepare(`DROP TABLE IF EXISTS transactions`),
      env.DB.prepare(`DROP TABLE IF EXISTS inbound`)
    ])
    
    // master 테이블 삭제
    await env.DB.prepare(`DROP TABLE master`).run()
    
    // 새 master 테이블 생성 (CHECK 제약 없음)
    await env.DB.prepare(`
      CREATE TABLE master (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_code TEXT UNIQUE NOT NULL,
        item_name TEXT NOT NULL,
        category TEXT NOT NULL,
        unit TEXT DEFAULT 'kg',
        current_stock REAL DEFAULT 0,
        safety_stock REAL DEFAULT 0,
        expiry_days INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // master 데이터 복원
    await env.DB.prepare(`
      INSERT INTO master (id, item_code, item_name, category, unit, current_stock, safety_stock, expiry_days, created_at, updated_at)
      SELECT id, item_code, item_name, category, unit, current_stock, safety_stock, expiry_days, created_at, updated_at
      FROM master_migration_backup
    `).run()
    
    // 인덱스 생성
    await env.DB.batch([
      env.DB.prepare(`CREATE INDEX idx_master_category ON master(category)`),
      env.DB.prepare(`CREATE INDEX idx_master_item_code ON master(item_code)`)
    ])
    
    // inbound 테이블 재생성
    await env.DB.prepare(`
      CREATE TABLE inbound (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lot_number TEXT UNIQUE NOT NULL,
        item_code TEXT NOT NULL,
        inbound_date TEXT NOT NULL,
        expiry_date TEXT,
        origin_qty REAL NOT NULL,
        remain_qty REAL NOT NULL,
        quality_status TEXT DEFAULT '합격',
        supplier TEXT,
        unit_price REAL DEFAULT 0,
        is_sample INTEGER DEFAULT 0,
        storage_location TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (item_code) REFERENCES master(item_code)
      )
    `).run()
    
    // inbound 데이터 복원
    await env.DB.prepare(`
      INSERT INTO inbound 
      SELECT * FROM inbound_backup
    `).run()
    
    // inbound 인덱스
    await env.DB.batch([
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_inbound_item_code ON inbound(item_code)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_inbound_inbound_date ON inbound(inbound_date)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_inbound_expiry_date ON inbound(expiry_date)`)
    ])
    
    // transactions 테이블 재생성
    await env.DB.prepare(`
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trans_date TEXT NOT NULL,
        item_code TEXT NOT NULL,
        trans_type TEXT NOT NULL,
        quantity REAL NOT NULL,
        lot_number TEXT,
        production_lot TEXT,
        remain_qty REAL,
        memo TEXT,
        supplier TEXT,
        is_sample INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (item_code) REFERENCES master(item_code)
      )
    `).run()
    
    // transactions 데이터 복원
    await env.DB.prepare(`
      INSERT INTO transactions 
      SELECT * FROM transactions_backup
    `).run()
    
    // transactions 인덱스
    await env.DB.batch([
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(trans_date)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_transactions_item_code ON transactions(item_code)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_transactions_lot ON transactions(lot_number)`)
    ])
    
    // 백업 테이블들 삭제
    await env.DB.batch([
      env.DB.prepare(`DROP TABLE IF EXISTS master_migration_backup`),
      env.DB.prepare(`DROP TABLE IF EXISTS inbound_backup`),
      env.DB.prepare(`DROP TABLE IF EXISTS transactions_backup`)
    ])
    
    // 검증
    const countAfter = await env.DB.prepare(`SELECT COUNT(*) as count FROM master`).first()
    const inboundCount = await env.DB.prepare(`SELECT COUNT(*) as count FROM inbound`).first()
    const transCount = await env.DB.prepare(`SELECT COUNT(*) as count FROM transactions`).first()
    
    const newSchema = await env.DB.prepare(`
      SELECT sql FROM sqlite_master WHERE name = 'master' AND type = 'table'
    `).first()
    
    return c.json({ 
      success: true, 
      message: `마이그레이션 완료! CHECK 제약 조건이 제거되었습니다. 부자재 등록이 가능합니다.`,
      details: {
        masterCount: { before: countBefore?.count, after: countAfter?.count },
        inboundCount: inboundCount?.count,
        transactionsCount: transCount?.count,
        newSchema: newSchema?.sql
      }
    })
  } catch (error: any) {
    // 에러 발생 시 상세 정보 반환
    return c.json({ 
      success: false, 
      message: `마이그레이션 실패: ${error.message}`,
      hint: '데이터가 손상되었을 수 있습니다. 백업 테이블(master_migration_backup, inbound_backup, transactions_backup)이 있다면 복원이 가능합니다.'
    }, 500)
  }
})

// 마이그레이션 실패 시 복구 API
admin.post('/migrate/restore-from-backup', async (c) => {
  const { env } = c
  
  try {
    const results: string[] = []
    
    // 백업 테이블들 존재 확인
    const tables = await env.DB.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_backup'
    `).all()
    
    const backupTables = (tables.results || []).map((t: any) => t.name)
    results.push(`백업 테이블 발견: ${backupTables.join(', ')}`)
    
    // inbound 복원
    if (backupTables.includes('inbound_backup')) {
      // 현재 inbound 테이블 상태 확인
      const inboundExists = await env.DB.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='inbound'
      `).first()
      
      if (!inboundExists) {
        // inbound 테이블이 없으면 백업에서 생성
        await env.DB.prepare(`CREATE TABLE inbound AS SELECT * FROM inbound_backup`).run()
        results.push('inbound 테이블 복원됨')
      } else {
        // 테이블은 있지만 데이터 확인
        const count = await env.DB.prepare(`SELECT COUNT(*) as count FROM inbound`).first()
        if (count?.count === 0) {
          await env.DB.prepare(`INSERT INTO inbound SELECT * FROM inbound_backup`).run()
          results.push('inbound 데이터 복원됨')
        } else {
          results.push(`inbound 테이블 정상 (${count?.count}건)`)
        }
      }
    }
    
    // transactions 복원
    if (backupTables.includes('transactions_backup')) {
      const transExists = await env.DB.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='transactions'
      `).first()
      
      if (!transExists) {
        await env.DB.prepare(`CREATE TABLE transactions AS SELECT * FROM transactions_backup`).run()
        results.push('transactions 테이블 복원됨')
      } else {
        const count = await env.DB.prepare(`SELECT COUNT(*) as count FROM transactions`).first()
        if (count?.count === 0) {
          await env.DB.prepare(`INSERT INTO transactions SELECT * FROM transactions_backup`).run()
          results.push('transactions 데이터 복원됨')
        } else {
          results.push(`transactions 테이블 정상 (${count?.count}건)`)
        }
      }
    }
    
    // 최종 상태 확인
    const masterCount = await env.DB.prepare(`SELECT COUNT(*) as count FROM master`).first()
    const inboundCount = await env.DB.prepare(`SELECT COUNT(*) as count FROM inbound`).first()
    const transCount = await env.DB.prepare(`SELECT COUNT(*) as count FROM transactions`).first()
    
    return c.json({
      success: true,
      message: '복원 완료',
      results,
      counts: {
        master: masterCount?.count,
        inbound: inboundCount?.count,
        transactions: transCount?.count
      }
    })
  } catch (error: any) {
    return c.json({ success: false, message: `복원 실패: ${error.message}` }, 500)
  }
})

// 테이블 스키마 확인 API
admin.get('/schema/:table_name', async (c) => {
  const { env } = c
  const tableName = c.req.param('table_name')
  
  try {
    const schema = await env.DB.prepare(`
      SELECT sql FROM sqlite_master WHERE name = ? AND type = 'table'
    `).bind(tableName).first()
    
    const count = await env.DB.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).first()
    
    return c.json({
      success: true,
      table: tableName,
      count: count?.count,
      schema: schema?.sql
    })
  } catch (error: any) {
    return c.json({ success: false, message: error.message }, 500)
  }
})

// supplies(부자재) 테이블 생성 마이그레이션
admin.post('/migrate/create-supplies-table', async (c) => {
  const { env } = c
  
  try {
    // supplies 테이블 존재 확인
    const exists = await env.DB.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='supplies'
    `).first()
    
    if (exists) {
      const count = await env.DB.prepare(`SELECT COUNT(*) as count FROM supplies`).first()
      return c.json({ 
        success: true, 
        message: 'supplies 테이블이 이미 존재합니다.',
        count: count?.count
      })
    }
    
    // supplies 테이블 생성 (master와 동일한 구조, CHECK 제약 없음)
    await env.DB.prepare(`
      CREATE TABLE supplies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_code TEXT UNIQUE NOT NULL,
        item_name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '부자재',
        unit TEXT DEFAULT 'ea',
        current_stock REAL DEFAULT 0,
        safety_stock REAL DEFAULT 0,
        expiry_days INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // 인덱스 생성
    await env.DB.prepare(`CREATE INDEX idx_supplies_item_code ON supplies(item_code)`).run()
    
    return c.json({ 
      success: true, 
      message: 'supplies(부자재) 테이블이 생성되었습니다.'
    })
  } catch (error: any) {
    return c.json({ success: false, message: `테이블 생성 실패: ${error.message}` }, 500)
  }
})

// BOM 일괄 등록 API
admin.post('/import-bom', async (c) => {
  const { env } = c
  const body = await c.req.json()
  const { materials, products, bom } = body
  
  if (!materials || !products || !bom) {
    return c.json({ success: false, message: '필수 데이터가 없습니다 (materials, products, bom)' }, 400)
  }
  
  try {
    const results = {
      materials: { inserted: 0, skipped: 0 },
      products: { inserted: 0, skipped: 0 },
      bom: { inserted: 0, skipped: 0 }
    }
    
    // 1. 원료 등록
    for (const mat of materials) {
      try {
        const existing = await env.DB.prepare(
          'SELECT item_code FROM master WHERE item_code = ?'
        ).bind(mat.code).first()
        
        if (!existing) {
          await env.DB.prepare(`
            INSERT INTO master (item_code, item_name, category, unit, current_stock, safety_stock, expiry_days)
            VALUES (?, ?, '원료', 'kg', 0, 0, 365)
          `).bind(mat.code, mat.name).run()
          results.materials.inserted++
        } else {
          results.materials.skipped++
        }
      } catch (e) {
        results.materials.skipped++
      }
    }
    
    // 2. 제품 등록
    for (const prod of products) {
      try {
        const existing = await env.DB.prepare(
          'SELECT item_code FROM master WHERE item_code = ?'
        ).bind(prod.code).first()
        
        if (!existing) {
          const displayName = prod.alias && prod.alias.length > 0 ? prod.alias.substring(0, 100) : prod.name.substring(0, 100)
          await env.DB.prepare(`
            INSERT INTO master (item_code, item_name, category, unit, current_stock, safety_stock, expiry_days)
            VALUES (?, ?, '제품', 'ea', 0, 0, 30)
          `).bind(prod.code, displayName).run()
          results.products.inserted++
        } else {
          results.products.skipped++
        }
      } catch (e) {
        results.products.skipped++
      }
    }
    
    // 3. BOM 등록
    const errors: string[] = []
    for (const item of bom) {
      try {
        const existing = await env.DB.prepare(
          'SELECT id FROM bom WHERE product_code = ? AND item_code = ?'
        ).bind(item.product_code, item.item_code).first()
        
        if (!existing) {
          await env.DB.prepare(`
            INSERT INTO bom (product_code, item_code, quantity, unit, memo)
            VALUES (?, ?, ?, 'g', '')
          `).bind(item.product_code, item.item_code, item.quantity).run()
          results.bom.inserted++
        } else {
          results.bom.skipped++
        }
      } catch (e: any) {
        errors.push(`${item.product_code}/${item.item_code}: ${e.message}`)
        results.bom.skipped++
      }
    }
    
    if (errors.length > 0) {
      console.error('BOM insert errors:', errors.slice(0, 5))
    }
    
    // 로그 기록
    await env.DB.prepare(
      'INSERT INTO admin_logs (action_type, target_table, reason) VALUES (?, ?, ?)'
    ).bind('BOM 일괄등록', 'master, bom', `원료 ${results.materials.inserted}개, 제품 ${results.products.inserted}개, BOM ${results.bom.inserted}개 등록`).run()
    
    return c.json({ 
      success: true, 
      message: 'BOM 일괄 등록 완료',
      results,
      errors: errors.slice(0, 10)
    })
  } catch (error: any) {
    return c.json({ success: false, message: `등록 실패: ${error.message}` }, 500)
  }
})

// ========== 생산명 기반 BOM 관리 ==========

// DB 마이그레이션: production_items, production_bom 테이블 생성
admin.post('/migrate-production-items', async (c) => {
  const { env } = c
  
  try {
    // production_items 테이블 생성
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS production_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        production_code TEXT UNIQUE NOT NULL,
        production_name TEXT NOT NULL,
        alias1 TEXT,
        alias2 TEXT,
        category TEXT DEFAULT '빵',
        unit TEXT DEFAULT 'g',
        standard_weight REAL,
        is_active INTEGER DEFAULT 1,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // production_bom 테이블 생성
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS production_bom (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        production_code TEXT NOT NULL,
        material_code TEXT NOT NULL,
        material_name TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit TEXT DEFAULT 'g',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // 인덱스 생성
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_production_items_name ON production_items(production_name)`).run()
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_production_items_alias1 ON production_items(alias1)`).run()
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_production_bom_code ON production_bom(production_code)`).run()
    
    return c.json({ success: true, message: '생산명 테이블 마이그레이션 완료' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 생산명 목록 조회
admin.get('/production-items', async (c) => {
  const { env } = c
  
  try {
    const result = await env.DB.prepare(`
      SELECT pi.*, 
             (SELECT COUNT(*) FROM production_bom pb WHERE pb.production_code = pi.production_code) as bom_count,
             (SELECT COUNT(*) FROM production_barcodes pbc WHERE pbc.production_code = pi.production_code) as barcode_count
      FROM production_items pi 
      WHERE pi.is_active = 1
      ORDER BY pi.production_name
    `).all()
    
    return c.json({ success: true, data: result.results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 생산명 BOM 일괄 등록 (엑셀 데이터 기반)
admin.post('/import-production-bom', async (c) => {
  const { items } = await c.req.json()
  const { env } = c
  
  // items 구조: [{ production_name, alias1, alias2, materials: [{name, quantity}] }]
  
  const results = {
    production_items: { inserted: 0, updated: 0, skipped: 0 },
    bom: { inserted: 0, skipped: 0 }
  }
  const errors: string[] = []
  
  try {
    // 기존 원재료 마스터 조회 (매칭용)
    const materialsResult = await env.DB.prepare(`
      SELECT item_code, item_name FROM master WHERE category = '원료'
    `).all()
    const materialMap = new Map<string, string>()
    for (const m of materialsResult.results as any[]) {
      // 원재료명 정규화하여 매핑
      const normalizedName = m.item_name.replace(/\s+/g, '').toLowerCase()
      materialMap.set(normalizedName, m.item_code)
      materialMap.set(m.item_name, m.item_code)
    }
    
    let codeCounter = 1
    // 기존 최대 코드 조회
    const maxCode = await env.DB.prepare(`
      SELECT MAX(CAST(SUBSTR(production_code, 3) AS INTEGER)) as max_num 
      FROM production_items
    `).first() as { max_num: number | null }
    if (maxCode?.max_num) {
      codeCounter = maxCode.max_num + 1
    }
    
    for (const item of items) {
      try {
        const productionName = item.production_name?.trim()
        if (!productionName) continue
        
        // 생산명 코드 생성 또는 조회
        let productionCode: string
        const existing = await env.DB.prepare(`
          SELECT production_code FROM production_items WHERE production_name = ?
        `).bind(productionName).first() as { production_code: string } | null
        
        if (existing) {
          productionCode = existing.production_code
          results.production_items.updated++
        } else {
          productionCode = `PR${String(codeCounter++).padStart(3, '0')}`
          
          // 중량 추출 시도 (예: "300g", "150g (3개)")
          const weightMatch = productionName.match(/(\d+)g/i)
          const standardWeight = weightMatch ? parseFloat(weightMatch[1]) : null
          
          await env.DB.prepare(`
            INSERT INTO production_items (production_code, production_name, alias1, alias2, standard_weight)
            VALUES (?, ?, ?, ?, ?)
          `).bind(productionCode, productionName, item.alias1 || null, item.alias2 || null, standardWeight).run()
          
          results.production_items.inserted++
        }
        
        // BOM 등록 (기존 BOM 삭제 후 새로 등록)
        await env.DB.prepare(`DELETE FROM production_bom WHERE production_code = ?`).bind(productionCode).run()
        
        for (const mat of item.materials || []) {
          const materialName = mat.name?.trim()
          if (!materialName || !mat.quantity) continue
          
          // 원재료 코드 찾기
          const normalizedMatName = materialName.replace(/\s+/g, '').toLowerCase()
          let materialCode = materialMap.get(normalizedMatName) || materialMap.get(materialName)
          
          // 매칭 안되면 유사 매칭 시도
          if (!materialCode) {
            for (const [key, code] of materialMap.entries()) {
              if (key.includes(normalizedMatName) || normalizedMatName.includes(key)) {
                materialCode = code
                break
              }
            }
          }
          
          // 그래도 없으면 새 원재료 등록
          if (!materialCode) {
            // 새 원재료 코드 생성
            const maxMat = await env.DB.prepare(`
              SELECT MAX(CAST(SUBSTR(item_code, 2) AS INTEGER)) as max_num 
              FROM master WHERE item_code LIKE 'R%' AND category = '원료'
            `).first() as { max_num: number | null }
            const nextNum = (maxMat?.max_num || 0) + 1
            materialCode = `R${String(nextNum).padStart(3, '0')}`
            
            await env.DB.prepare(`
              INSERT OR IGNORE INTO master (item_code, item_name, category, unit, safety_stock)
              VALUES (?, ?, '원료', 'kg', 10)
            `).bind(materialCode, materialName).run()
            
            materialMap.set(normalizedMatName, materialCode)
            materialMap.set(materialName, materialCode)
          }
          
          // BOM 등록
          await env.DB.prepare(`
            INSERT INTO production_bom (production_code, material_code, material_name, quantity, unit)
            VALUES (?, ?, ?, ?, 'g')
          `).bind(productionCode, materialCode, materialName, mat.quantity).run()
          
          results.bom.inserted++
        }
      } catch (e: any) {
        errors.push(`${item.production_name}: ${e.message}`)
      }
    }
    
    // 로그 기록
    await env.DB.prepare(
      'INSERT INTO admin_logs (action_type, target_table, reason) VALUES (?, ?, ?)'
    ).bind('생산명BOM등록', 'production_items, production_bom', 
      `생산명 ${results.production_items.inserted}개 등록, BOM ${results.bom.inserted}개 등록`).run()
    
    return c.json({ 
      success: true, 
      message: '생산명 BOM 등록 완료',
      results,
      errors: errors.slice(0, 10)
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 생산명으로 검색 (발주서 매칭용)
admin.get('/match-production', async (c) => {
  const { env } = c
  const name = c.req.query('name') || ''
  
  try {
    // 정확히 일치하는 생산명 찾기
    let result = await env.DB.prepare(`
      SELECT * FROM production_items 
      WHERE production_name = ? OR alias1 = ? OR alias2 = ?
    `).bind(name, name, name).first()
    
    if (!result) {
      // LIKE 검색
      const searchName = `%${name}%`
      result = await env.DB.prepare(`
        SELECT * FROM production_items 
        WHERE production_name LIKE ? OR alias1 LIKE ? OR alias2 LIKE ?
        LIMIT 1
      `).bind(searchName, searchName, searchName).first()
    }
    
    return c.json({ success: true, data: result })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 생산명 BOM 조회
admin.get('/production-bom/:code', async (c) => {
  const { env } = c
  const code = c.req.param('code')
  
  try {
    const bom = await env.DB.prepare(`
      SELECT pb.*, m.item_name as master_name, m.unit as master_unit
      FROM production_bom pb
      LEFT JOIN master m ON pb.material_code = m.item_code
      WHERE pb.production_code = ?
      ORDER BY pb.id
    `).bind(code).all()
    
    const item = await env.DB.prepare(`
      SELECT * FROM production_items WHERE production_code = ?
    `).bind(code).first()
    
    return c.json({ success: true, data: { item, bom: bom.results } })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 생산명 수동 등록
admin.post('/production-items', async (c) => {
  const { env } = c
  const body = await c.req.json()
  const { production_name, alias1, alias2 } = body
  
  if (!production_name) {
    return c.json({ success: false, error: '생산명은 필수입니다' }, 400)
  }
  
  try {
    // 중복 체크
    const existing = await env.DB.prepare(`
      SELECT production_code FROM production_items WHERE production_name = ?
    `).bind(production_name).first()
    
    if (existing) {
      return c.json({ success: false, error: '이미 등록된 생산명입니다' }, 400)
    }
    
    // 새 코드 생성
    const maxCode = await env.DB.prepare(`
      SELECT MAX(CAST(SUBSTR(production_code, 3) AS INTEGER)) as max_num 
      FROM production_items
    `).first() as { max_num: number | null }
    const nextNum = (maxCode?.max_num || 0) + 1
    const productionCode = `PR${String(nextNum).padStart(3, '0')}`
    
    // 중량 추출
    const weightMatch = production_name.match(/(\d+)g/i)
    const standardWeight = weightMatch ? parseFloat(weightMatch[1]) : null
    
    await env.DB.prepare(`
      INSERT INTO production_items (production_code, production_name, alias1, alias2, standard_weight)
      VALUES (?, ?, ?, ?, ?)
    `).bind(productionCode, production_name, alias1 || null, alias2 || null, standardWeight).run()
    
    return c.json({ 
      success: true, 
      message: '생산명이 등록되었습니다',
      production_code: productionCode 
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 생산명 단일 조회
admin.get('/production-items/:code', async (c) => {
  const { env } = c
  const code = c.req.param('code')
  
  try {
    const item = await env.DB.prepare(`
      SELECT * FROM production_items WHERE production_code = ?
    `).bind(code).first()
    
    if (!item) {
      return c.json({ success: false, error: '생산명을 찾을 수 없습니다' }, 404)
    }
    
    const bom = await env.DB.prepare(`
      SELECT * FROM production_bom WHERE production_code = ? ORDER BY id
    `).bind(code).all()
    
    return c.json({ success: true, data: { item, bom: bom.results } })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 생산명 수정
admin.put('/production-items/:code', async (c) => {
  const { env } = c
  const code = c.req.param('code')
  const body = await c.req.json()
  const { production_name, alias1, alias2 } = body
  
  if (!production_name) {
    return c.json({ success: false, error: '생산명은 필수입니다' }, 400)
  }
  
  try {
    await env.DB.prepare(`
      UPDATE production_items 
      SET production_name = ?, alias1 = ?, alias2 = ?, updated_at = CURRENT_TIMESTAMP
      WHERE production_code = ?
    `).bind(production_name, alias1 || null, alias2 || null, code).run()
    
    return c.json({ success: true, message: '생산명이 수정되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 생산명 삭제
admin.delete('/production-items/:code', async (c) => {
  const { env } = c
  const code = c.req.param('code')
  
  try {
    // 관련 BOM 삭제
    await env.DB.prepare(`DELETE FROM production_bom WHERE production_code = ?`).bind(code).run()
    
    // 관련 바코드 삭제
    await env.DB.prepare(`DELETE FROM production_barcodes WHERE production_code = ?`).bind(code).run()
    
    // 생산명 삭제
    await env.DB.prepare(`DELETE FROM production_items WHERE production_code = ?`).bind(code).run()
    
    // 로그 기록
    await env.DB.prepare(
      'INSERT INTO admin_logs (action_type, target_table, reason) VALUES (?, ?, ?)'
    ).bind('생산명삭제', 'production_items', `생산명 ${code} 삭제`).run()
    
    return c.json({ success: true, message: '삭제되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// BOM 수동 등록 (단일 생산명)
admin.post('/production-bom', async (c) => {
  const { env } = c
  const body = await c.req.json()
  const { production_code, materials } = body
  
  if (!production_code || !materials || materials.length === 0) {
    return c.json({ success: false, error: '생산명 코드와 원료 목록이 필요합니다' }, 400)
  }
  
  try {
    // 생산명 존재 확인
    const item = await env.DB.prepare(`
      SELECT production_code FROM production_items WHERE production_code = ?
    `).bind(production_code).first()
    
    if (!item) {
      return c.json({ success: false, error: '존재하지 않는 생산명입니다' }, 404)
    }
    
    // 기존 원재료 마스터 조회 (매칭용)
    const materialsResult = await env.DB.prepare(`
      SELECT item_code, item_name FROM master WHERE category = '원료'
    `).all()
    const materialMap = new Map<string, string>()
    for (const m of materialsResult.results as any[]) {
      materialMap.set(m.item_name.toLowerCase(), m.item_code)
    }
    
    // 기존 BOM 삭제
    await env.DB.prepare(`DELETE FROM production_bom WHERE production_code = ?`).bind(production_code).run()
    
    // 새 BOM 등록
    let insertCount = 0
    for (const mat of materials) {
      const materialName = mat.material_name?.trim()
      const quantity = parseFloat(mat.quantity) || 0
      
      if (!materialName || quantity <= 0) continue
      
      // 원재료 코드 찾기
      let materialCode = materialMap.get(materialName.toLowerCase())
      
      // 매칭 안되면 새 원재료 등록
      if (!materialCode) {
        const maxMat = await env.DB.prepare(`
          SELECT MAX(CAST(SUBSTR(item_code, 2) AS INTEGER)) as max_num 
          FROM master WHERE item_code LIKE 'R%' AND category = '원료'
        `).first() as { max_num: number | null }
        const nextNum = (maxMat?.max_num || 0) + 1
        materialCode = `R${String(nextNum).padStart(3, '0')}`
        
        await env.DB.prepare(`
          INSERT OR IGNORE INTO master (item_code, item_name, category, unit, safety_stock)
          VALUES (?, ?, '원료', 'kg', 10)
        `).bind(materialCode, materialName).run()
      }
      
      await env.DB.prepare(`
        INSERT INTO production_bom (production_code, material_code, material_name, quantity, unit)
        VALUES (?, ?, ?, ?, ?)
      `).bind(production_code, materialCode, materialName, quantity, mat.unit || 'g').run()
      
      insertCount++
    }
    
    return c.json({ 
      success: true, 
      message: `BOM ${insertCount}개 등록 완료`,
      inserted: insertCount
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// BOM 삭제 (특정 생산명)
admin.delete('/production-bom/:code', async (c) => {
  const { env } = c
  const code = c.req.param('code')
  
  try {
    await env.DB.prepare(`DELETE FROM production_bom WHERE production_code = ?`).bind(code).run()
    
    return c.json({ success: true, message: 'BOM이 삭제되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 생산일보 관련 테이블 생성
admin.post('/create-daily-report-tables', async (c) => {
  const { env } = c
  
  try {
    // 바코드 매핑 테이블
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS production_barcodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        production_code TEXT NOT NULL,
        barcode TEXT NOT NULL,
        product_name TEXT,
        channel TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(production_code, barcode)
      )
    `).run()
    
    // 생산일보 헤더 테이블
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS production_daily_report (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_date DATE NOT NULL,
        report_no TEXT,
        order_file_name TEXT,
        status TEXT DEFAULT 'draft',
        total_products INTEGER DEFAULT 0,
        total_quantity INTEGER DEFAULT 0,
        notes TEXT,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // 생산일보 품목 테이블
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS production_daily_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id INTEGER NOT NULL,
        production_code TEXT NOT NULL,
        production_name TEXT NOT NULL,
        barcode TEXT,
        order_product_name TEXT,
        quantity INTEGER NOT NULL,
        unit TEXT DEFAULT 'EA',
        has_bom INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (report_id) REFERENCES production_daily_report(id) ON DELETE CASCADE
      )
    `).run()
    
    // 생산일보 원재료 테이블
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS production_daily_materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id INTEGER NOT NULL,
        item_id INTEGER,
        material_code TEXT,
        material_name TEXT NOT NULL,
        required_quantity REAL NOT NULL,
        unit TEXT DEFAULT 'g',
        production_code TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (report_id) REFERENCES production_daily_report(id) ON DELETE CASCADE
      )
    `).run()
    
    return c.json({ success: true, message: '생산일보 테이블 생성 완료' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ========== 시스템 설정 관리 API ==========

// 시스템 설정 테이블 생성/마이그레이션
admin.post('/system/migrate', async (c) => {
  const { env } = c
  
  try {
    // 시스템 설정 테이블
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS system_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_key TEXT UNIQUE NOT NULL,
        config_value TEXT,
        config_type TEXT DEFAULT 'string',
        category TEXT DEFAULT 'general',
        description TEXT,
        is_editable INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // 양식 템플릿 테이블
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS form_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        form_type TEXT UNIQUE NOT NULL,
        form_name TEXT NOT NULL,
        template_html TEXT,
        template_css TEXT,
        fields TEXT,
        is_active INTEGER DEFAULT 1,
        version INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // 품질검사 항목 테이블
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS quality_check_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        check_type TEXT NOT NULL,
        check_name TEXT NOT NULL,
        check_method TEXT,
        standard_value TEXT,
        min_value REAL,
        max_value REAL,
        unit TEXT,
        is_required INTEGER DEFAULT 1,
        display_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // 코드 생성 규칙 테이블
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS code_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_type TEXT UNIQUE NOT NULL,
        rule_name TEXT NOT NULL,
        prefix TEXT,
        separator TEXT DEFAULT '',
        date_format TEXT,
        sequence_digits INTEGER DEFAULT 3,
        example TEXT,
        description TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // 카테고리 관리 테이블
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_type TEXT NOT NULL,
        category_name TEXT NOT NULL,
        parent_id INTEGER,
        display_order INTEGER DEFAULT 0,
        color TEXT,
        icon TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(category_type, category_name)
      )
    `).run()
    
    // 기본 시스템 설정 삽입
    const defaultConfigs = [
      ['company_name', '(주)본비반트', 'string', 'company', '회사명'],
      ['company_address', '', 'string', 'company', '회사 주소'],
      ['company_tel', '', 'string', 'company', '회사 전화번호'],
      ['company_fax', '', 'string', 'company', '회사 팩스번호'],
      ['company_email', '', 'string', 'company', '회사 이메일'],
      ['company_ceo', '', 'string', 'company', '대표자명'],
      ['company_business_number', '', 'string', 'company', '사업자등록번호'],
      ['company_haccp_number', '', 'string', 'company', 'HACCP 인증번호'],
      ['default_unit', 'kg', 'string', 'general', '기본 단위'],
      ['default_expiry_days', '365', 'number', 'general', '기본 유통기한(일)'],
      ['stock_warning_percent', '20', 'number', 'general', '재고 경고 기준(%)'],
      ['lot_expiry_warning_days', '30', 'number', 'general', 'LOT 만료 경고 기준(일)'],
      ['notify_low_stock', 'true', 'boolean', 'notification', '재고 부족 알림'],
      ['notify_expiry_soon', 'true', 'boolean', 'notification', '유통기한 임박 알림'],
      ['date_format', 'YYYY-MM-DD', 'string', 'general', '날짜 형식'],
      ['timezone', 'Asia/Seoul', 'string', 'general', '시간대'],
      ['language', 'ko', 'string', 'general', '언어']
    ]
    
    for (const config of defaultConfigs) {
      await env.DB.prepare(`
        INSERT OR IGNORE INTO system_config (config_key, config_value, config_type, category, description)
        VALUES (?, ?, ?, ?, ?)
      `).bind(...config).run()
    }
    
    // 기본 코드 규칙 삽입
    const defaultCodeRules = [
      ['material', '원료 코드', 'R', 3, 'R001, R002', '원료 품목 코드 생성 규칙'],
      ['submaterial', '부자재 코드', 'S', 3, 'S001, S002', '부자재 품목 코드 생성 규칙'],
      ['product', '제품 코드', 'P', 3, 'P001, P002', '제품 품목 코드 생성 규칙'],
      ['production', '생산명 코드', 'PR', 3, 'PR001, PR002', '생산명 코드 생성 규칙'],
      ['lot', 'LOT 번호', 'LOT', 4, 'LOT240403-0001', 'LOT 번호 생성 규칙'],
      ['document', '문서 번호', 'DOC', 4, 'DOC-2024-0001', '문서 번호 생성 규칙']
    ]
    
    for (const rule of defaultCodeRules) {
      await env.DB.prepare(`
        INSERT OR IGNORE INTO code_rules (rule_type, rule_name, prefix, sequence_digits, example, description)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(...rule).run()
    }
    
    // 기본 품질검사 항목 삽입
    const defaultQualityItems = [
      ['원료', '외관', '외관 검사', '육안 검사', '이상 없음', 1, 1],
      ['원료', '이물', '이물질 검사', '육안 검사', '이물 없음', 1, 2],
      ['원료', '냄새', '냄새 검사', '관능 검사', '이취 없음', 1, 3],
      ['원료', '포장상태', '포장 상태', '육안 검사', '양호', 1, 4],
      ['부자재', '외관', '외관 검사', '육안 검사', '이상 없음', 1, 1],
      ['부자재', '이물', '이물질 검사', '육안 검사', '이물 없음', 1, 2],
      ['부자재', '파손', '파손 여부', '육안 검사', '파손 없음', 1, 3],
      ['제품', '외관', '외관 검사', '육안 검사', '이상 없음', 1, 1],
      ['제품', '이물', '이물질 검사', '육안 검사', '이물 없음', 1, 2],
      ['제품', '맛', '맛 검사', '관능 검사', '양호', 1, 3],
      ['제품', '색상', '색상 검사', '육안 검사', '양호', 1, 4]
    ]
    
    for (const item of defaultQualityItems) {
      await env.DB.prepare(`
        INSERT OR IGNORE INTO quality_check_items (category, check_type, check_name, check_method, standard_value, is_required, display_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(...item).run()
    }
    
    // 기본 카테고리 삽입
    const defaultCategories = [
      ['item', '원료', 1, 'blue', 'fa-flask'],
      ['item', '부자재', 2, 'gray', 'fa-box'],
      ['item', '소모품', 3, 'yellow', 'fa-tools'],
      ['item', '제품', 4, 'green', 'fa-bread-slice'],
      ['supplier', '원료 공급사', 1, 'blue', 'fa-truck'],
      ['supplier', '부자재 공급사', 2, 'gray', 'fa-boxes'],
      ['supplier', '기타', 3, 'yellow', 'fa-building']
    ]
    
    for (const cat of defaultCategories) {
      await env.DB.prepare(`
        INSERT OR IGNORE INTO categories (category_type, category_name, display_order, color, icon)
        VALUES (?, ?, ?, ?, ?)
      `).bind(...cat).run()
    }
    
    return c.json({ success: true, message: '시스템 설정 테이블 마이그레이션 완료' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 시스템 설정 조회
admin.get('/system/config', async (c) => {
  const { env } = c
  const category = c.req.query('category')
  
  try {
    let query = 'SELECT * FROM system_config'
    let params: any[] = []
    
    if (category) {
      query += ' WHERE category = ?'
      params.push(category)
    }
    
    query += ' ORDER BY category, config_key'
    
    const data = await env.DB.prepare(query).bind(...params).all()
    return c.json({ success: true, data: data.results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 시스템 설정 수정
admin.put('/system/config/:key', async (c) => {
  const { env } = c
  const key = c.req.param('key')
  const { value } = await c.req.json()
  
  try {
    await env.DB.prepare(`
      UPDATE system_config SET config_value = ?, updated_at = CURRENT_TIMESTAMP WHERE config_key = ?
    `).bind(value, key).run()
    
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, target_id, reason)
      VALUES ('설정변경', 'system_config', ?, ?)
    `).bind(key, `설정값 변경: ${value}`).run()
    
    return c.json({ success: true, message: '설정이 변경되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 시스템 설정 일괄 수정
admin.put('/system/config-bulk', async (c) => {
  const { env } = c
  const { configs } = await c.req.json()
  
  try {
    for (const config of configs) {
      await env.DB.prepare(`
        INSERT INTO system_config (config_key, config_value, config_type, category, description)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(config_key) DO UPDATE SET
        config_value = excluded.config_value,
        updated_at = CURRENT_TIMESTAMP
      `).bind(config.key, config.value, config.type || 'string', config.category || 'general', config.description || '').run()
    }
    
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, reason)
      VALUES ('설정변경', 'system_config', ?)
    `).bind(`일괄 설정 변경: ${configs.length}개 항목`).run()
    
    return c.json({ success: true, message: '설정이 저장되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ========== 양식 템플릿 관리 API ==========

// 양식 템플릿 목록 조회
admin.get('/system/forms', async (c) => {
  const { env } = c
  
  try {
    const data = await env.DB.prepare(`
      SELECT * FROM form_templates ORDER BY form_type
    `).all()
    return c.json({ success: true, data: data.results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 양식 템플릿 상세 조회
admin.get('/system/forms/:type', async (c) => {
  const { env } = c
  const formType = c.req.param('type')
  
  try {
    const data = await env.DB.prepare(`
      SELECT * FROM form_templates WHERE form_type = ?
    `).bind(formType).first()
    
    if (!data) {
      return c.json({ success: false, message: '양식을 찾을 수 없습니다' }, 404)
    }
    
    return c.json({ success: true, data })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 양식 템플릿 생성/수정
admin.post('/system/forms', async (c) => {
  const { env } = c
  const { form_type, form_name, template_html, template_css, fields } = await c.req.json()
  
  try {
    await env.DB.prepare(`
      INSERT INTO form_templates (form_type, form_name, template_html, template_css, fields, version)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(form_type) DO UPDATE SET
      form_name = excluded.form_name,
      template_html = excluded.template_html,
      template_css = excluded.template_css,
      fields = excluded.fields,
      version = form_templates.version + 1,
      updated_at = CURRENT_TIMESTAMP
    `).bind(form_type, form_name, template_html || '', template_css || '', JSON.stringify(fields || [])).run()
    
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, target_id, reason)
      VALUES ('양식수정', 'form_templates', ?, ?)
    `).bind(form_type, `양식 저장: ${form_name}`).run()
    
    return c.json({ success: true, message: '양식이 저장되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 양식 템플릿 삭제
admin.delete('/system/forms/:type', async (c) => {
  const { env } = c
  const formType = c.req.param('type')
  
  try {
    await env.DB.prepare(`DELETE FROM form_templates WHERE form_type = ?`).bind(formType).run()
    
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, target_id, reason)
      VALUES ('양식삭제', 'form_templates', ?, '양식 삭제')
    `).bind(formType).run()
    
    return c.json({ success: true, message: '양식이 삭제되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ========== 품질검사 항목 관리 API ==========

// 품질검사 항목 목록 조회
admin.get('/system/quality-items', async (c) => {
  const { env } = c
  const category = c.req.query('category')
  
  try {
    let query = 'SELECT * FROM quality_check_items'
    let params: any[] = []
    
    if (category) {
      query += ' WHERE category = ?'
      params.push(category)
    }
    
    query += ' ORDER BY category, display_order, check_name'
    
    const data = await env.DB.prepare(query).bind(...params).all()
    return c.json({ success: true, data: data.results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 품질검사 항목 추가
admin.post('/system/quality-items', async (c) => {
  const { env } = c
  const { category, check_type, check_name, check_method, standard_value, min_value, max_value, unit, is_required, display_order } = await c.req.json()
  
  try {
    const result = await env.DB.prepare(`
      INSERT INTO quality_check_items (category, check_type, check_name, check_method, standard_value, min_value, max_value, unit, is_required, display_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(category, check_type, check_name, check_method || '', standard_value || '', min_value || null, max_value || null, unit || '', is_required ? 1 : 0, display_order || 0).run()
    
    return c.json({ success: true, message: '검사 항목이 추가되었습니다', id: result.meta.last_row_id })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 품질검사 항목 수정
admin.put('/system/quality-items/:id', async (c) => {
  const { env } = c
  const id = c.req.param('id')
  const { category, check_type, check_name, check_method, standard_value, min_value, max_value, unit, is_required, display_order, is_active } = await c.req.json()
  
  try {
    await env.DB.prepare(`
      UPDATE quality_check_items SET
        category = ?, check_type = ?, check_name = ?, check_method = ?,
        standard_value = ?, min_value = ?, max_value = ?, unit = ?,
        is_required = ?, display_order = ?, is_active = ?
      WHERE id = ?
    `).bind(category, check_type, check_name, check_method || '', standard_value || '', min_value || null, max_value || null, unit || '', is_required ? 1 : 0, display_order || 0, is_active ? 1 : 0, id).run()
    
    return c.json({ success: true, message: '검사 항목이 수정되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 품질검사 항목 삭제
admin.delete('/system/quality-items/:id', async (c) => {
  const { env } = c
  const id = c.req.param('id')
  
  try {
    await env.DB.prepare(`DELETE FROM quality_check_items WHERE id = ?`).bind(id).run()
    return c.json({ success: true, message: '검사 항목이 삭제되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ========== 코드 규칙 관리 API ==========

// 코드 규칙 목록 조회
admin.get('/system/code-rules', async (c) => {
  const { env } = c
  
  try {
    const data = await env.DB.prepare(`SELECT * FROM code_rules ORDER BY rule_type`).all()
    return c.json({ success: true, data: data.results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 코드 규칙 수정
admin.put('/system/code-rules/:type', async (c) => {
  const { env } = c
  const ruleType = c.req.param('type')
  const { rule_name, prefix, separator, date_format, sequence_digits, example, description } = await c.req.json()
  
  try {
    await env.DB.prepare(`
      UPDATE code_rules SET
        rule_name = ?, prefix = ?, separator = ?, date_format = ?,
        sequence_digits = ?, example = ?, description = ?
      WHERE rule_type = ?
    `).bind(rule_name, prefix || '', separator || '', date_format || '', sequence_digits || 3, example || '', description || '', ruleType).run()
    
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, target_id, reason)
      VALUES ('규칙변경', 'code_rules', ?, ?)
    `).bind(ruleType, `코드 규칙 변경: ${rule_name}`).run()
    
    return c.json({ success: true, message: '코드 규칙이 수정되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ========== 카테고리 관리 API ==========

// 카테고리 목록 조회
admin.get('/system/categories', async (c) => {
  const { env } = c
  const categoryType = c.req.query('type')
  
  try {
    let query = 'SELECT * FROM categories'
    let params: any[] = []
    
    if (categoryType) {
      query += ' WHERE category_type = ?'
      params.push(categoryType)
    }
    
    query += ' ORDER BY category_type, display_order, category_name'
    
    const data = await env.DB.prepare(query).bind(...params).all()
    return c.json({ success: true, data: data.results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 카테고리 추가
admin.post('/system/categories', async (c) => {
  const { env } = c
  const { category_type, category_name, display_order, color, icon } = await c.req.json()
  
  try {
    const result = await env.DB.prepare(`
      INSERT INTO categories (category_type, category_name, display_order, color, icon)
      VALUES (?, ?, ?, ?, ?)
    `).bind(category_type, category_name, display_order || 0, color || 'gray', icon || 'fa-tag').run()
    
    return c.json({ success: true, message: '카테고리가 추가되었습니다', id: result.meta.last_row_id })
  } catch (error: any) {
    if (error.message.includes('UNIQUE constraint')) {
      return c.json({ success: false, message: '이미 존재하는 카테고리입니다' }, 400)
    }
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 카테고리 수정
admin.put('/system/categories/:id', async (c) => {
  const { env } = c
  const id = c.req.param('id')
  const { category_name, display_order, color, icon, is_active } = await c.req.json()
  
  try {
    await env.DB.prepare(`
      UPDATE categories SET
        category_name = ?, display_order = ?, color = ?, icon = ?, is_active = ?
      WHERE id = ?
    `).bind(category_name, display_order || 0, color || 'gray', icon || 'fa-tag', is_active ? 1 : 0, id).run()
    
    return c.json({ success: true, message: '카테고리가 수정되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 카테고리 삭제
admin.delete('/system/categories/:id', async (c) => {
  const { env } = c
  const id = c.req.param('id')
  
  try {
    await env.DB.prepare(`DELETE FROM categories WHERE id = ?`).bind(id).run()
    return c.json({ success: true, message: '카테고리가 삭제되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ========== 관리자 활동 로그 조회 API ==========

// 활동 로그 조회 (상세)
admin.get('/system/logs', async (c) => {
  const { env } = c
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '50')
  const offset = (page - 1) * limit
  const actionType = c.req.query('action_type')
  const targetTable = c.req.query('target_table')
  const startDate = c.req.query('start_date')
  const endDate = c.req.query('end_date')
  
  try {
    let query = `SELECT * FROM admin_logs WHERE 1=1`
    let countQuery = `SELECT COUNT(*) as total FROM admin_logs WHERE 1=1`
    let params: any[] = []
    let countParams: any[] = []
    
    if (actionType) {
      query += ' AND action_type = ?'
      countQuery += ' AND action_type = ?'
      params.push(actionType)
      countParams.push(actionType)
    }
    
    if (targetTable) {
      query += ' AND target_table = ?'
      countQuery += ' AND target_table = ?'
      params.push(targetTable)
      countParams.push(targetTable)
    }
    
    if (startDate) {
      query += ' AND DATE(created_at) >= ?'
      countQuery += ' AND DATE(created_at) >= ?'
      params.push(startDate)
      countParams.push(startDate)
    }
    
    if (endDate) {
      query += ' AND DATE(created_at) <= ?'
      countQuery += ' AND DATE(created_at) <= ?'
      params.push(endDate)
      countParams.push(endDate)
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)
    
    const data = await env.DB.prepare(query).bind(...params).all()
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
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 로그 통계 조회
admin.get('/system/logs/stats', async (c) => {
  const { env } = c
  
  try {
    // 오늘 활동 수
    const todayCount = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM admin_logs WHERE DATE(created_at) = DATE('now')
    `).first()
    
    // 최근 7일 일별 활동 수
    const weeklyStats = await env.DB.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM admin_logs
      WHERE created_at >= DATE('now', '-7 days')
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `).all()
    
    // 액션 타입별 통계
    const actionStats = await env.DB.prepare(`
      SELECT action_type, COUNT(*) as count
      FROM admin_logs
      GROUP BY action_type
      ORDER BY count DESC
      LIMIT 10
    `).all()
    
    // 테이블별 통계
    const tableStats = await env.DB.prepare(`
      SELECT target_table, COUNT(*) as count
      FROM admin_logs
      WHERE target_table IS NOT NULL
      GROUP BY target_table
      ORDER BY count DESC
      LIMIT 10
    `).all()
    
    return c.json({
      success: true,
      data: {
        todayCount: todayCount?.count || 0,
        weeklyStats: weeklyStats.results,
        actionStats: actionStats.results,
        tableStats: tableStats.results
      }
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ========== 데이터 백업/복원 API ==========

// 테이블 데이터 내보내기
admin.get('/system/export/:table', async (c) => {
  const { env } = c
  const table = c.req.param('table')
  
  // 허용된 테이블만
  const allowedTables = ['master', 'supplies', 'production_items', 'production_bom', 'production_barcodes', 'suppliers', 'system_config', 'form_templates', 'quality_check_items', 'code_rules', 'categories']
  
  if (!allowedTables.includes(table)) {
    return c.json({ success: false, message: '내보내기가 허용되지 않는 테이블입니다' }, 400)
  }
  
  try {
    const data = await env.DB.prepare(`SELECT * FROM ${table}`).all()
    
    return c.json({
      success: true,
      table,
      count: data.results.length,
      data: data.results,
      exportedAt: new Date().toISOString()
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 테이블 데이터 가져오기
admin.post('/system/import/:table', async (c) => {
  const { env } = c
  const table = c.req.param('table')
  const { data, mode } = await c.req.json() // mode: 'replace' | 'merge'
  
  const allowedTables = ['master', 'supplies', 'production_items', 'production_bom', 'production_barcodes', 'suppliers', 'system_config', 'form_templates', 'quality_check_items', 'code_rules', 'categories']
  
  if (!allowedTables.includes(table)) {
    return c.json({ success: false, message: '가져오기가 허용되지 않는 테이블입니다' }, 400)
  }
  
  if (!Array.isArray(data) || data.length === 0) {
    return c.json({ success: false, message: '가져올 데이터가 없습니다' }, 400)
  }
  
  try {
    let inserted = 0
    let updated = 0
    let skipped = 0
    
    // replace 모드면 기존 데이터 삭제
    if (mode === 'replace') {
      await env.DB.prepare(`DELETE FROM ${table}`).run()
    }
    
    // 데이터 삽입
    for (const row of data) {
      const columns = Object.keys(row).filter(k => k !== 'id')
      const values = columns.map(k => row[k])
      const placeholders = columns.map(() => '?').join(', ')
      
      try {
        if (mode === 'merge') {
          // UPSERT 시도
          const result = await env.DB.prepare(`
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES (${placeholders})
          `).bind(...values).run()
          
          if (result.meta.changes > 0) {
            inserted++
          }
        } else {
          await env.DB.prepare(`
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES (${placeholders})
          `).bind(...values).run()
          inserted++
        }
      } catch (e: any) {
        if (e.message.includes('UNIQUE constraint')) {
          skipped++
        } else {
          throw e
        }
      }
    }
    
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, reason)
      VALUES ('데이터가져오기', ?, ?)
    `).bind(table, `${data.length}건 가져오기 (삽입: ${inserted}, 중복: ${skipped})`).run()
    
    return c.json({
      success: true,
      message: '데이터 가져오기 완료',
      stats: { total: data.length, inserted, updated, skipped }
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 전체 시스템 설정 백업
admin.get('/system/backup', async (c) => {
  const { env } = c
  
  try {
    const backup: any = {}
    const tables = ['system_config', 'form_templates', 'quality_check_items', 'code_rules', 'categories']
    
    for (const table of tables) {
      try {
        const data = await env.DB.prepare(`SELECT * FROM ${table}`).all()
        backup[table] = data.results
      } catch (e) {
        backup[table] = []
      }
    }
    
    return c.json({
      success: true,
      backup,
      backupAt: new Date().toISOString(),
      version: '1.0'
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

export default admin
