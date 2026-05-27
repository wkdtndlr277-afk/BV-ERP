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

// 생산 기록 일괄 삭제 (최고관리자 전용) - ID 범위 지정
admin.delete('/super/production-batch', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  const { start_id, end_id, reason, admin_key } = await c.req.json()
  const { env } = c
  
  // 임시 관리자 키 또는 세션 토큰 확인
  const isValidAdminKey = admin_key === 'bonvivant2026!'
  if (!isValidAdminKey && (!token || !await isSuperAdmin(env.DB, token))) {
    return c.json({ success: false, message: '최고관리자 권한이 필요합니다' }, 403)
  }
  
  if (!start_id || !end_id || start_id > end_id) {
    return c.json({ success: false, message: 'start_id와 end_id를 올바르게 입력하세요' }, 400)
  }
  
  try {
    // 삭제 대상 조회
    const targets = await env.DB.prepare(`
      SELECT id, product_code, quantity, lot_number FROM production 
      WHERE id BETWEEN ? AND ?
    `).bind(start_id, end_id).all()
    
    const count = targets.results?.length || 0
    if (count === 0) {
      return c.json({ success: false, message: '삭제할 생산 기록이 없습니다' }, 404)
    }
    
    // 1. production_materials 삭제
    await env.DB.prepare(`
      DELETE FROM production_materials WHERE production_id BETWEEN ? AND ?
    `).bind(start_id, end_id).run()
    
    // 2. production_inbound 삭제 (새 테이블)
    const lotNumbers = (targets.results as any[]).map(t => t.lot_number).filter(Boolean)
    if (lotNumbers.length > 0) {
      const placeholders = lotNumbers.map(() => '?').join(',')
      await env.DB.prepare(`
        DELETE FROM production_inbound WHERE lot_number IN (${placeholders})
      `).bind(...lotNumbers).run()
    }
    
    // 3. production_transactions 삭제 (새 테이블)
    const productCodes = [...new Set((targets.results as any[]).map(t => t.product_code))]
    if (productCodes.length > 0) {
      const placeholders = productCodes.map(() => '?').join(',')
      await env.DB.prepare(`
        DELETE FROM production_transactions WHERE production_code IN (${placeholders})
      `).bind(...productCodes).run()
    }
    
    // 4. 기존 transactions 삭제 (생산ID 메모 기준)
    await env.DB.prepare(`
      DELETE FROM transactions WHERE memo LIKE '%생산ID:%' 
      AND CAST(SUBSTR(memo, INSTR(memo, '생산ID:') + 5, 10) AS INTEGER) BETWEEN ? AND ?
    `).bind(start_id, end_id).run()
    
    // 5. 기존 inbound 삭제 (자체생산 LOT)
    if (lotNumbers.length > 0) {
      const placeholders = lotNumbers.map(() => '?').join(',')
      await env.DB.prepare(`
        DELETE FROM inbound WHERE lot_number IN (${placeholders})
      `).bind(...lotNumbers).run()
    }
    
    // 6. production 삭제
    await env.DB.prepare(`
      DELETE FROM production WHERE id BETWEEN ? AND ?
    `).bind(start_id, end_id).run()
    
    // 로그 기록
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, before_data, reason)
      VALUES (?, ?, ?, ?)
    `).bind('생산일괄삭제', 'production', JSON.stringify({ start_id, end_id, count }), reason || `ID ${start_id}~${end_id} 일괄 삭제`).run()
    
    return c.json({ 
      success: true, 
      message: `생산 기록 ${count}건이 삭제되었습니다`,
      deleted: { start_id, end_id, count }
    })
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

// 소비기한 컬럼 마이그레이션
admin.get('/migrate-shelf-life', async (c) => {
  const { env } = c
  
  try {
    // production_items에 shelf_life_days 컬럼 추가
    await env.DB.prepare(`
      ALTER TABLE production_items ADD COLUMN shelf_life_days INTEGER DEFAULT NULL
    `).run()
  } catch (e: any) {
    // 이미 존재하면 무시
    if (!e.message?.includes('duplicate column')) {
      console.log('shelf_life_days column may already exist')
    }
  }
  
  try {
    // production_daily_items에 expiry_date 컬럼 추가
    await env.DB.prepare(`
      ALTER TABLE production_daily_items ADD COLUMN expiry_date TEXT DEFAULT NULL
    `).run()
  } catch (e: any) {
    // 이미 존재하면 무시
    if (!e.message?.includes('duplicate column')) {
      console.log('expiry_date column may already exist')
    }
  }
  
  // production_daily_items에 channel(판매처) 컬럼 추가
  try {
    await env.DB.prepare(`
      ALTER TABLE production_daily_items ADD COLUMN channel TEXT DEFAULT NULL
    `).run()
  } catch (e: any) {
    // 이미 존재하면 무시
    if (!e.message?.includes('duplicate column')) {
      console.log('channel column may already exist')
    }
  }
  
  // production 테이블에도 expiry_date, channel 컬럼 추가 (생산일보 인쇄용)
  try {
    await env.DB.prepare(`
      ALTER TABLE production ADD COLUMN expiry_date TEXT DEFAULT NULL
    `).run()
  } catch (e: any) {
    if (!e.message?.includes('duplicate column')) {
      console.log('production.expiry_date column may already exist')
    }
  }
  
  try {
    await env.DB.prepare(`
      ALTER TABLE production ADD COLUMN channel TEXT DEFAULT NULL
    `).run()
  } catch (e: any) {
    if (!e.message?.includes('duplicate column')) {
      console.log('production.channel column may already exist')
    }
  }
  
  return c.json({ success: true, message: '소비기한/판매처 컬럼 마이그레이션 완료' })
})

// 기존 생산 데이터 소비기한/판매처 업데이트 (v2.0.39)
admin.get('/update-production-expiry-channel', async (c) => {
  const { env } = c
  const results: string[] = []
  
  try {
    // 1. production_items의 shelf_life_days를 기반으로 expiry_date 업데이트 (NULL인 경우만)
    const updateExpiry = await env.DB.prepare(`
      UPDATE production 
      SET expiry_date = date(prod_date, '+' || COALESCE(
        (SELECT shelf_life_days FROM production_items WHERE production_code = production.product_code), 
        7
      ) || ' days')
      WHERE expiry_date IS NULL
    `).run()
    results.push(`소비기한 업데이트: ${updateExpiry.meta.changes}건`)
    
    // 2. production_daily_items에서 channel 정보 가져와서 업데이트
    // memo 필드에서 DR-YYYYMMDD-XXXX 형태의 리포트 번호 추출하여 매칭
    const updateChannel = await env.DB.prepare(`
      UPDATE production 
      SET channel = (
        SELECT pdi.channel 
        FROM production_daily_items pdi
        JOIN production_daily_report pdr ON pdi.report_id = pdr.id
        WHERE pdi.production_code = production.product_code
          AND pdr.report_date = production.prod_date
          AND pdi.channel IS NOT NULL
        LIMIT 1
      )
      WHERE channel IS NULL
    `).run()
    results.push(`판매처 업데이트: ${updateChannel.meta.changes}건`)
    
    // 3. 아직 channel이 NULL인 경우 memo에서 추론
    // 예: "쿠팡" 포함 시 coupang, "컬리" 포함 시 kurly
    await env.DB.prepare(`
      UPDATE production SET channel = 'coupang'
      WHERE channel IS NULL AND memo LIKE '%쿠팡%'
    `).run()
    await env.DB.prepare(`
      UPDATE production SET channel = 'kurly'
      WHERE channel IS NULL AND memo LIKE '%컬리%'
    `).run()
    
    return c.json({ 
      success: true, 
      message: '기존 생산 데이터 소비기한/판매처 업데이트 완료',
      details: results
    })
  } catch (e: any) {
    return c.json({ success: false, error: e.message })
  }
})

// 생산 재고/입고/트랜잭션 테이블 마이그레이션 (v2.0.35)
admin.get('/migrate-production-stock', async (c) => {
  const { env } = c
  const results: string[] = []
  
  try {
    // 1. production_items에 current_stock 컬럼 추가
    try {
      await env.DB.prepare(`
        ALTER TABLE production_items ADD COLUMN current_stock REAL DEFAULT 0
      `).run()
      results.push('production_items.current_stock 컬럼 추가 완료')
    } catch (e: any) {
      if (e.message?.includes('duplicate column')) {
        results.push('production_items.current_stock 컬럼 이미 존재')
      } else {
        results.push(`current_stock 추가 실패: ${e.message}`)
      }
    }
    
    // 2. production_inbound 테이블 생성
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS production_inbound (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lot_number TEXT NOT NULL,
        production_code TEXT NOT NULL,
        inbound_date DATE NOT NULL,
        expiry_date DATE,
        origin_qty REAL NOT NULL,
        remain_qty REAL NOT NULL,
        quality_status TEXT DEFAULT '합격',
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    results.push('production_inbound 테이블 생성 완료')
    
    // 3. production_transactions 테이블 생성
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS production_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trans_date DATE NOT NULL,
        production_code TEXT NOT NULL,
        trans_type TEXT NOT NULL,
        quantity REAL NOT NULL,
        lot_number TEXT,
        memo TEXT,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    results.push('production_transactions 테이블 생성 완료')
    
    // 4. 인덱스 생성
    try { await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_production_inbound_code ON production_inbound(production_code)`).run() } catch {}
    try { await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_production_inbound_date ON production_inbound(inbound_date)`).run() } catch {}
    try { await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_production_inbound_lot ON production_inbound(lot_number)`).run() } catch {}
    try { await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_production_transactions_code ON production_transactions(production_code)`).run() } catch {}
    try { await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_production_transactions_date ON production_transactions(trans_date)`).run() } catch {}
    try { await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_production_transactions_type ON production_transactions(trans_type)`).run() } catch {}
    results.push('인덱스 생성 완료')
    
    return c.json({ success: true, message: '생산 재고 테이블 마이그레이션 완료', details: results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message, details: results }, 500)
  }
})

// 바코드별 입수량(box_quantity) 컬럼 추가 마이그레이션
admin.post('/migrate/add-box-quantity', async (c) => {
  const { env } = c
  const results: string[] = []
  
  try {
    // production_barcodes 테이블에 box_quantity 컬럼 추가
    try {
      await env.DB.prepare(`
        ALTER TABLE production_barcodes ADD COLUMN box_quantity INTEGER DEFAULT 1
      `).run()
      results.push('production_barcodes.box_quantity 컬럼 추가 완료')
    } catch (e: any) {
      if (e.message?.includes('duplicate column')) {
        results.push('production_barcodes.box_quantity 컬럼 이미 존재')
      } else {
        results.push(`box_quantity 추가 실패: ${e.message}`)
      }
    }
    
    // 기본값 1로 업데이트 (NULL인 경우)
    await env.DB.prepare(`
      UPDATE production_barcodes SET box_quantity = 1 WHERE box_quantity IS NULL
    `).run()
    results.push('기존 데이터 box_quantity 기본값(1) 설정 완료')
    
    // production_daily_items 테이블에도 box_quantity 컬럼 추가
    try {
      await env.DB.prepare(`
        ALTER TABLE production_daily_items ADD COLUMN box_quantity INTEGER DEFAULT 1
      `).run()
      results.push('production_daily_items.box_quantity 컬럼 추가 완료')
    } catch (e: any) {
      if (e.message?.includes('duplicate column')) {
        results.push('production_daily_items.box_quantity 컬럼 이미 존재')
      } else {
        results.push(`production_daily_items.box_quantity 추가 실패: ${e.message}`)
      }
    }
    
    return c.json({ success: true, message: '바코드 입수량 마이그레이션 완료', details: results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message, details: results }, 500)
  }
})

// 원료의 is_sanitary를 0으로 수정 (잘못 입고된 데이터)
admin.post('/migrate/fix-raw-material-sanitary', async (c) => {
  const { env } = c
  const results: string[] = []
  
  try {
    // 원료인데 is_sanitary=1인 데이터 확인
    const wrongData = await env.DB.prepare(`
      SELECT i.id, i.lot_number, i.item_code, m.item_name, m.category, i.is_sanitary
      FROM inbound i
      JOIN master m ON i.item_code = m.item_code
      WHERE m.category = '원료' AND i.is_sanitary = 1
    `).all();
    
    results.push(`원료인데 is_sanitary=1인 데이터: ${wrongData.results?.length || 0}건`);
    
    if (wrongData.results && wrongData.results.length > 0) {
      // 수정
      const updateResult = await env.DB.prepare(`
        UPDATE inbound SET is_sanitary = 0 
        WHERE item_code IN (SELECT item_code FROM master WHERE category = '원료')
        AND is_sanitary = 1
      `).run();
      
      results.push(`${updateResult.meta?.changes || 0}건 수정 완료`);
    }
    
    return c.json({ success: true, message: '원료 is_sanitary 수정 완료', details: results, wrongData: wrongData.results });
  } catch (error: any) {
    return c.json({ success: false, error: error.message, details: results }, 500);
  }
})

// inbound 테이블 NULL id 수정 마이그레이션
admin.post('/migrate/fix-inbound-ids', async (c) => {
  const { env } = c
  const results: string[] = []
  
  try {
    // 1. 현재 최대 id 조회
    const maxIdResult = await env.DB.prepare('SELECT MAX(id) as max_id FROM inbound WHERE id IS NOT NULL').first() as any;
    let nextId = (maxIdResult?.max_id || 0) + 1;
    results.push(`현재 최대 id: ${maxIdResult?.max_id || 0}, 다음 id: ${nextId}`);
    
    // 2. NULL id 개수 확인
    const nullCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM inbound WHERE id IS NULL').first() as any;
    results.push(`NULL id 개수: ${nullCount?.cnt || 0}`);
    
    if (nullCount?.cnt > 0) {
      // 3. NULL id 레코드를 rowid 순서대로 업데이트
      const nullRows = await env.DB.prepare('SELECT rowid, lot_number FROM inbound WHERE id IS NULL ORDER BY rowid').all();
      
      let updated = 0;
      for (const row of nullRows.results || []) {
        await env.DB.prepare('UPDATE inbound SET id = ?, created_at = COALESCE(created_at, CURRENT_TIMESTAMP), updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP) WHERE rowid = ?')
          .bind(nextId, (row as any).rowid)
          .run();
        nextId++;
        updated++;
      }
      results.push(`${updated}건 id 할당 완료`);
    }
    
    // 4. 확인
    const finalCheck = await env.DB.prepare('SELECT COUNT(*) as cnt FROM inbound WHERE id IS NULL').first() as any;
    results.push(`수정 후 NULL id 개수: ${finalCheck?.cnt || 0}`);
    
    return c.json({ success: true, message: 'inbound id 수정 완료', details: results });
  } catch (error: any) {
    return c.json({ success: false, error: error.message, details: results }, 500);
  }
})

// 바코드별 소비기한(expiry_days) 컬럼 추가 마이그레이션
admin.post('/migrate/add-barcode-expiry', async (c) => {
  const { env } = c
  const results: string[] = []
  
  try {
    // production_barcodes 테이블에 expiry_days 컬럼 추가
    try {
      await env.DB.prepare(`
        ALTER TABLE production_barcodes ADD COLUMN expiry_days INTEGER DEFAULT NULL
      `).run()
      results.push('production_barcodes.expiry_days 컬럼 추가 완료')
    } catch (e: any) {
      if (e.message?.includes('duplicate column')) {
        results.push('production_barcodes.expiry_days 컬럼 이미 존재')
      } else {
        results.push(`expiry_days 추가 실패: ${e.message}`)
      }
    }
    
    // 냉동 채널 바코드에 기본값 90일 설정
    const updateResult = await env.DB.prepare(`
      UPDATE production_barcodes 
      SET expiry_days = 90 
      WHERE expiry_days IS NULL 
      AND (channel LIKE '%냉동%' OR channel LIKE '%frozen%' OR channel LIKE '%쿠팡냉동%')
    `).run()
    results.push(`냉동 채널 바코드 ${updateResult.meta?.changes || 0}건에 90일 기본 설정`)
    
    // 실온 채널 바코드에 기본값 7일 설정 (옵션)
    // const updateResult2 = await env.DB.prepare(`
    //   UPDATE production_barcodes 
    //   SET expiry_days = 7 
    //   WHERE expiry_days IS NULL 
    //   AND channel NOT LIKE '%냉동%'
    // `).run()
    
    return c.json({ success: true, message: '바코드별 소비기한 마이그레이션 완료', details: results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message, details: results }, 500)
  }
})

// 바코드 UNIQUE 제약 조건 변경 (barcode + channel 조합으로)
admin.post('/migrate/barcode-unique-channel', async (c) => {
  const { env } = c
  const results: string[] = []
  
  try {
    // 1. 기존 데이터 백업 (expiry_days 컬럼 없을 수 있음)
    const existingData = await env.DB.prepare(`
      SELECT production_code, barcode, product_name, channel, box_quantity, created_at
      FROM production_barcodes
    `).all()
    results.push(`기존 데이터 ${existingData.results?.length || 0}건 백업 완료`)
    
    // 2. 기존 테이블 삭제
    await env.DB.prepare(`DROP TABLE IF EXISTS production_barcodes_old`).run()
    await env.DB.prepare(`ALTER TABLE production_barcodes RENAME TO production_barcodes_old`).run()
    results.push('기존 테이블 이름 변경 완료')
    
    // 3. 새 테이블 생성 (barcode + channel 조합이 unique)
    await env.DB.prepare(`
      CREATE TABLE production_barcodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        production_code TEXT NOT NULL,
        barcode TEXT NOT NULL,
        product_name TEXT,
        channel TEXT DEFAULT '',
        box_quantity INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(barcode, channel)
      )
    `).run()
    results.push('새 테이블 생성 완료 (UNIQUE: barcode + channel)')
    
    // 4. 데이터 복원
    let insertCount = 0
    for (const row of (existingData.results || []) as any[]) {
      try {
        await env.DB.prepare(`
          INSERT INTO production_barcodes (production_code, barcode, product_name, channel, box_quantity, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          row.production_code,
          row.barcode,
          row.product_name,
          row.channel || '',
          row.box_quantity || 1,
          row.created_at
        ).run()
        insertCount++
      } catch (e: any) {
        results.push(`중복 제외: ${row.barcode} (${row.channel})`)
      }
    }
    results.push(`데이터 복원 완료: ${insertCount}건`)
    
    // 5. 기존 테이블 삭제
    await env.DB.prepare(`DROP TABLE production_barcodes_old`).run()
    results.push('이전 테이블 정리 완료')
    
    return c.json({ success: true, message: '바코드 테이블 UNIQUE 제약 조건 변경 완료', details: results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message, details: results }, 500)
  }
})

// 바코드 소비기한 수정
admin.put('/barcodes/:id/expiry-days', async (c) => {
  const { env } = c
  const id = c.req.param('id')
  const { expiry_days } = await c.req.json()
  
  // NULL 허용 (NULL이면 생산명 기본값 사용)
  await env.DB.prepare(`
    UPDATE production_barcodes SET expiry_days = ? WHERE id = ?
  `).bind(expiry_days || null, id).run()
  
  return c.json({ success: true, message: '소비기한 수정 완료' })
})

// 바코드 소비기한 일괄 수정
admin.post('/barcodes/bulk-expiry-days', async (c) => {
  const { env } = c
  const { updates } = await c.req.json()
  
  if (!updates || !Array.isArray(updates)) {
    return c.json({ success: false, error: '수정 데이터가 필요합니다.' }, 400)
  }
  
  let successCount = 0
  for (const item of updates) {
    try {
      if (item.id) {
        await env.DB.prepare(`
          UPDATE production_barcodes SET expiry_days = ? WHERE id = ?
        `).bind(item.expiry_days || null, item.id).run()
      } else if (item.barcode) {
        await env.DB.prepare(`
          UPDATE production_barcodes SET expiry_days = ? WHERE barcode = ?
        `).bind(item.expiry_days || null, item.barcode).run()
      }
      successCount++
    } catch (e) {
      console.error('Barcode expiry update failed:', item, e)
    }
  }
  
  return c.json({ success: true, message: `${successCount}건 수정 완료` })
})

// 바코드 입수량 일괄 조회
admin.get('/barcodes/box-quantity', async (c) => {
  const { env } = c
  const production_code = c.req.query('production_code')
  
  let query = `
    SELECT pb.*, pi.production_name 
    FROM production_barcodes pb
    LEFT JOIN production_items pi ON pb.production_code = pi.production_code
  `
  const params: any[] = []
  
  if (production_code) {
    query += ' WHERE pb.production_code = ?'
    params.push(production_code)
  }
  
  query += ' ORDER BY pb.production_code, pb.channel'
  
  const result = await env.DB.prepare(query).bind(...params).all()
  return c.json({ success: true, data: result.results || [] })
})

// 바코드 입수량 수정
admin.put('/barcodes/:id/box-quantity', async (c) => {
  const { env } = c
  const id = c.req.param('id')
  const { box_quantity } = await c.req.json()
  
  if (!box_quantity || box_quantity < 1) {
    return c.json({ success: false, error: '입수량은 1 이상이어야 합니다.' }, 400)
  }
  
  await env.DB.prepare(`
    UPDATE production_barcodes SET box_quantity = ? WHERE id = ?
  `).bind(box_quantity, id).run()
  
  return c.json({ success: true, message: '입수량 수정 완료' })
})

// 바코드 입수량 일괄 수정
admin.post('/barcodes/bulk-box-quantity', async (c) => {
  const { env } = c
  const { items } = await c.req.json()
  // items: [{ barcode, box_quantity }] 또는 [{ id, box_quantity }]
  
  if (!items || !Array.isArray(items)) {
    return c.json({ success: false, error: '잘못된 요청입니다.' }, 400)
  }
  
  let successCount = 0
  for (const item of items) {
    try {
      if (item.id) {
        await env.DB.prepare(`
          UPDATE production_barcodes SET box_quantity = ? WHERE id = ?
        `).bind(item.box_quantity || 1, item.id).run()
      } else if (item.barcode) {
        await env.DB.prepare(`
          UPDATE production_barcodes SET box_quantity = ? WHERE barcode = ?
        `).bind(item.box_quantity || 1, item.barcode).run()
      }
      successCount++
    } catch (e) {
      console.error('바코드 입수량 수정 오류:', e)
    }
  }
  
  return c.json({ success: true, message: `${successCount}건 수정 완료` })
})

// 제품 입고 기록 조회 (production_inbound)
admin.get('/production-inbound', async (c) => {
  const { env } = c
  const start_date = c.req.query('start_date') || '2020-01-01'
  const end_date = c.req.query('end_date') || '2099-12-31'
  const limit = parseInt(c.req.query('limit') || '100')
  
  const result = await env.DB.prepare(`
    SELECT pi.*, 
           pit.production_name
    FROM production_inbound pi
    LEFT JOIN production_items pit ON pi.production_code = pit.production_code
    WHERE pi.inbound_date BETWEEN ? AND ?
    ORDER BY pi.inbound_date DESC, pi.id DESC
    LIMIT ?
  `).bind(start_date, end_date, limit).all()
  
  return c.json({ success: true, data: result.results || [], total: result.results?.length || 0 })
})

// 제품 트랜잭션 기록 조회 (production_transactions)
admin.get('/production-transactions', async (c) => {
  const { env } = c
  const start_date = c.req.query('start_date') || '2020-01-01'
  const end_date = c.req.query('end_date') || '2099-12-31'
  const limit = parseInt(c.req.query('limit') || '100')
  
  const result = await env.DB.prepare(`
    SELECT pt.*, 
           pit.production_name
    FROM production_transactions pt
    LEFT JOIN production_items pit ON pt.production_code = pit.production_code
    WHERE pt.trans_date BETWEEN ? AND ?
    ORDER BY pt.trans_date DESC, pt.id DESC
    LIMIT ?
  `).bind(start_date, end_date, limit).all()
  
  return c.json({ success: true, data: result.results || [], total: result.results?.length || 0 })
})

// BOM 테이블 동기화 (bom → production_bom) - 누락 생산명 자동 등록 포함
admin.get('/sync-bom-tables', async (c) => {
  const { env } = c
  
  try {
    // 1. 누락된 제품을 production_items에 자동 등록
    const missingProducts = await env.DB.prepare(`
      SELECT DISTINCT pm.item_name
      FROM bom b
      JOIN master pm ON b.product_code = pm.item_code
      WHERE NOT EXISTS (
        SELECT 1 FROM production_items pi 
        WHERE pi.production_name = pm.item_name OR pi.alias1 = pm.item_name
      )
    `).all()
    
    // 새 생산코드 생성을 위한 최대값 조회
    const maxCode = await env.DB.prepare(`
      SELECT MAX(CAST(SUBSTR(production_code, 3) AS INTEGER)) as max_num FROM production_items
    `).first() as any
    let nextNum = (maxCode?.max_num || 0) + 1
    
    let addedCount = 0
    for (const product of missingProducts.results as any[]) {
      const productionCode = `PR${String(nextNum).padStart(3, '0')}`
      await env.DB.prepare(`
        INSERT INTO production_items (production_code, production_name, category, is_active)
        VALUES (?, ?, '빵', 1)
      `).bind(productionCode, product.item_name).run()
      nextNum++
      addedCount++
    }
    
    // 2. 기존 production_bom 전체 삭제
    await env.DB.prepare(`DELETE FROM production_bom`).run()
    
    // 3. 한번의 쿼리로 bom → production_bom 복사 (production_name 매칭)
    // SF 계열은 semi_finished_items 테이블에서, 일반 원료는 master 테이블에서 이름 조회
    await env.DB.prepare(`
      INSERT INTO production_bom (production_code, material_code, material_name, quantity, unit)
      SELECT 
        pi.production_code,
        b.item_code,
        COALESCE(
          mm.item_name,
          sf.item_name,
          CASE 
            WHEN b.item_code LIKE 'SF%' THEN '반제품-' || b.item_code
            ELSE '원료-' || b.item_code
          END
        ),
        b.quantity,
        b.unit
      FROM bom b
      JOIN master pm ON b.product_code = pm.item_code
      JOIN production_items pi ON pi.production_name = pm.item_name OR pi.alias1 = pm.item_name
      LEFT JOIN master mm ON b.item_code = mm.item_code
      LEFT JOIN semi_finished_items sf ON b.item_code = sf.item_code
      WHERE pi.is_active = 1
    `).run()
    
    // 4. 동기화 결과 확인
    const syncedProducts = await env.DB.prepare(`
      SELECT COUNT(DISTINCT production_code) as count FROM production_bom
    `).first() as any
    
    const totalBomRows = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM production_bom
    `).first() as any
    
    return c.json({ 
      success: true, 
      message: `BOM 동기화 완료`,
      added_production_items: addedCount,
      synced_products: syncedProducts?.count || 0,
      synced_bom_rows: totalBomRows?.count || 0
    })
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
             (
               SELECT COUNT(*) FROM production_bom pb WHERE pb.production_code = pi.production_code
             ) + (
               SELECT COUNT(*) FROM bom b WHERE b.product_code = pi.production_code
             ) as bom_count,
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
  const { production_code, production_name, alias1, alias2, category, unit, shelf_life_days } = body
  
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
    
    // 새 코드 생성 (제공된 코드가 없는 경우)
    let finalProductionCode = production_code
    if (!finalProductionCode) {
      const maxCode = await env.DB.prepare(`
        SELECT MAX(CAST(SUBSTR(production_code, 3) AS INTEGER)) as max_num 
        FROM production_items
      `).first() as { max_num: number | null }
      const nextNum = (maxCode?.max_num || 0) + 1
      finalProductionCode = `PR${String(nextNum).padStart(3, '0')}`
    }
    
    // 중량 추출
    const weightMatch = production_name.match(/(\d+)g/i)
    const standardWeight = weightMatch ? parseFloat(weightMatch[1]) : null
    
    await env.DB.prepare(`
      INSERT INTO production_items (production_code, production_name, alias1, alias2, standard_weight, category, unit, shelf_life_days)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      finalProductionCode, 
      production_name, 
      alias1 || null, 
      alias2 || null, 
      standardWeight,
      category || '제품',
      unit || 'ea',
      shelf_life_days || 3
    ).run()
    
    return c.json({ 
      success: true, 
      message: '생산명이 등록되었습니다',
      production_code: finalProductionCode 
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
  const { production_name, alias1, alias2, shelf_life_days } = body
  
  if (!production_name) {
    return c.json({ success: false, error: '생산명은 필수입니다' }, 400)
  }
  
  try {
    await env.DB.prepare(`
      UPDATE production_items 
      SET production_name = ?, alias1 = ?, alias2 = ?, shelf_life_days = ?, updated_at = CURRENT_TIMESTAMP
      WHERE production_code = ?
    `).bind(production_name, alias1 || null, alias2 || null, shelf_life_days || null, code).run()
    
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

// ========== BOM 원료명 일괄 변경 API ==========

// 슬라이스치즈 → RM162 아메리칸슬라이스치즈 변경
// 대상: R074(슬라이스 치즈), RM143(슬라이스치즈) → RM162(아메리칸슬라이스치즈)
admin.post('/migrate/rename-slice-cheese', async (c) => {
  const { env } = c
  
  try {
    const results: string[] = []
    const OLD_ITEM_CODES = ['R074', 'RM143']  // 변경 대상 원료 코드
    const NEW_ITEM_CODE = 'RM162'
    const NEW_ITEM_NAME = '아메리칸슬라이스치즈'
    
    // 1. bom 테이블에서 슬라이스치즈 관련 원료 찾기 (item_code 기준)
    const bomItems = await env.DB.prepare(`
      SELECT id, product_code, item_code, quantity, unit
      FROM bom 
      WHERE item_code IN ('R074', 'RM143')
    `).all()
    
    if (bomItems.results && bomItems.results.length > 0) {
      // bom 테이블에서 해당 item_code를 RM162로 변경
      await env.DB.prepare(`
        UPDATE bom SET item_code = ? WHERE item_code IN ('R074', 'RM143')
      `).bind(NEW_ITEM_CODE).run()
      results.push(`bom 테이블: ${bomItems.results.length}건 업데이트 (${bomItems.results.map((r: any) => `${r.product_code}:${r.item_code}`).join(', ')})`)
    } else {
      results.push('bom 테이블: 슬라이스치즈 항목 없음')
    }
    
    // 2. production_bom 테이블에서 슬라이스치즈 관련 원료 찾기
    const prodBomItems = await env.DB.prepare(`
      SELECT id, production_code, material_code, material_name 
      FROM production_bom 
      WHERE material_code IN ('R074', 'RM143')
         OR material_name LIKE '%슬라이스%치즈%' 
         OR material_name LIKE '%슬라이스치즈%'
         OR material_name = '슬라이스치즈'
         OR material_name = '슬라이스 치즈'
    `).all()
    
    if (prodBomItems.results && prodBomItems.results.length > 0) {
      // production_bom 테이블 업데이트
      await env.DB.prepare(`
        UPDATE production_bom 
        SET material_code = ?, material_name = ?
        WHERE material_code IN ('R074', 'RM143')
           OR material_name LIKE '%슬라이스%치즈%' 
           OR material_name LIKE '%슬라이스치즈%'
           OR material_name = '슬라이스치즈'
           OR material_name = '슬라이스 치즈'
      `).bind(NEW_ITEM_CODE, NEW_ITEM_NAME).run()
      results.push(`production_bom 테이블: ${prodBomItems.results.length}건 업데이트 (${prodBomItems.results.map((r: any) => `${r.production_code}:${r.material_name}`).join(', ')})`)
    } else {
      results.push('production_bom 테이블: 슬라이스치즈 항목 없음')
    }
    
    // 로그 기록
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, reason)
      VALUES ('원료명변경', 'bom,production_bom', 'R074/RM143 슬라이스치즈 → RM162 아메리칸슬라이스치즈')
    `).run()
    
    return c.json({
      success: true,
      message: '슬라이스치즈 → RM162 아메리칸슬라이스치즈 변경 완료',
      details: results,
      target_codes: { old: OLD_ITEM_CODES, new: NEW_ITEM_CODE },
      changed: {
        bom: bomItems.results || [],
        production_bom: prodBomItems.results || []
      }
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 변경 전 슬라이스치즈 항목 미리보기
admin.get('/migrate/preview-slice-cheese', async (c) => {
  const { env } = c
  
  try {
    // bom 테이블 조회 (item_code 기준)
    const bomItems = await env.DB.prepare(`
      SELECT id, product_code, item_code, quantity, unit
      FROM bom 
      WHERE item_code IN ('R074', 'RM143')
    `).all()
    
    // production_bom 테이블 조회
    const prodBomItems = await env.DB.prepare(`
      SELECT id, production_code, material_code, material_name, quantity, unit 
      FROM production_bom 
      WHERE material_code IN ('R074', 'RM143')
         OR material_name LIKE '%슬라이스%치즈%' 
         OR material_name LIKE '%슬라이스치즈%'
         OR material_name = '슬라이스치즈'
         OR material_name = '슬라이스 치즈'
    `).all()
    
    return c.json({
      success: true,
      target_codes: ['R074 (슬라이스 치즈)', 'RM143 (슬라이스치즈)'],
      new_code: 'RM162 (아메리칸슬라이스치즈)',
      preview: {
        bom: bomItems.results || [],
        production_bom: prodBomItems.results || []
      },
      summary: {
        bom_count: bomItems.results?.length || 0,
        production_bom_count: prodBomItems.results?.length || 0
      }
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ========== 범용 BOM 원료 변경 API ==========

// BOM 원료 코드 변경 (범용)
admin.post('/migrate/rename-material', async (c) => {
  const { env } = c
  const { old_code, new_code, new_name } = await c.req.json()
  
  if (!old_code || !new_code) {
    return c.json({ success: false, message: '변경 전/후 원료 코드가 필요합니다' }, 400)
  }
  
  try {
    const results: string[] = []
    
    // 새 원료 정보 조회
    let newMaterialName = new_name
    if (!newMaterialName) {
      const newMaterial = await env.DB.prepare(`
        SELECT item_name FROM master WHERE item_code = ?
      `).bind(new_code).first<any>()
      newMaterialName = newMaterial?.item_name || new_code
    }
    
    // 1. bom 테이블에서 해당 원료 찾기
    const bomItems = await env.DB.prepare(`
      SELECT id, product_code, item_code, quantity, unit
      FROM bom WHERE item_code = ?
    `).bind(old_code).all()
    
    if (bomItems.results && bomItems.results.length > 0) {
      await env.DB.prepare(`
        UPDATE bom SET item_code = ? WHERE item_code = ?
      `).bind(new_code, old_code).run()
      results.push(`bom 테이블: ${bomItems.results.length}건 업데이트`)
    } else {
      results.push('bom 테이블: 해당 원료 없음')
    }
    
    // 2. production_bom 테이블에서 해당 원료 찾기
    const prodBomItems = await env.DB.prepare(`
      SELECT id, production_code, material_code, material_name 
      FROM production_bom WHERE material_code = ?
    `).bind(old_code).all()
    
    if (prodBomItems.results && prodBomItems.results.length > 0) {
      await env.DB.prepare(`
        UPDATE production_bom SET material_code = ?, material_name = ?
        WHERE material_code = ?
      `).bind(new_code, newMaterialName, old_code).run()
      results.push(`production_bom 테이블: ${prodBomItems.results.length}건 업데이트`)
    } else {
      results.push('production_bom 테이블: 해당 원료 없음')
    }
    
    // 로그 기록
    await env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, reason)
      VALUES ('원료명변경', 'bom,production_bom', ?)
    `).bind(`${old_code} → ${new_code} (${newMaterialName})`).run()
    
    return c.json({
      success: true,
      message: `${old_code} → ${new_code} (${newMaterialName}) 변경 완료`,
      details: results,
      changed: {
        bom: bomItems.results || [],
        production_bom: prodBomItems.results || []
      }
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// BOM 원료 변경 미리보기 (범용)
admin.get('/migrate/preview-material', async (c) => {
  const { env } = c
  const old_code = c.req.query('old_code')
  
  if (!old_code) {
    return c.json({ success: false, message: '변경 전 원료 코드가 필요합니다' }, 400)
  }
  
  try {
    // 원료 정보 조회
    const oldMaterial = await env.DB.prepare(`
      SELECT item_code, item_name FROM master WHERE item_code = ?
    `).bind(old_code).first<any>()
    
    // bom 테이블 조회
    const bomItems = await env.DB.prepare(`
      SELECT id, product_code, item_code, quantity, unit
      FROM bom WHERE item_code = ?
    `).bind(old_code).all()
    
    // production_bom 테이블 조회
    const prodBomItems = await env.DB.prepare(`
      SELECT id, production_code, material_code, material_name, quantity, unit 
      FROM production_bom WHERE material_code = ?
    `).bind(old_code).all()
    
    return c.json({
      success: true,
      target: {
        code: old_code,
        name: oldMaterial?.item_name || '(알 수 없음)'
      },
      preview: {
        bom: bomItems.results || [],
        production_bom: prodBomItems.results || []
      },
      summary: {
        bom_count: bomItems.results?.length || 0,
        production_bom_count: prodBomItems.results?.length || 0
      }
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 반제품 기존 코드 정리 (master 삭제 + BOM SF코드 변경)
admin.post('/cleanup-semi-finished', async (c) => {
  const { env } = c
  
  try {
    const results: string[] = []
    
    // 반제품 코드 매핑 (RM213 추가)
    const mapping = [
      { old: 'RM146', sf: 'SF001', name: '발효종르방' },
      { old: 'R076', sf: 'SF002', name: '통밀르방' },
      { old: 'RM136', sf: 'SF003', name: '폴리쉬' },
      { old: 'RM155', sf: 'SF004', name: '쌀르방' },
      { old: 'RM156', sf: 'SF005', name: '쌀탕종' },
      { old: 'RM137', sf: 'SF006', name: '탕종' },
      { old: 'RM149', sf: 'SF007', name: '통밀탕종' },
      { old: 'RM145', sf: 'SF008', name: '통밀폴리쉬' },
      { old: 'RM265', sf: 'SF009', name: '호밀르방' },
      { old: 'RM213', sf: 'SF010', name: '솔트라이발효종르방' },
    ]
    
    // SF010 반제품 추가 (없으면)
    await env.DB.prepare(`
      INSERT OR IGNORE INTO semi_finished_items (item_code, item_name, unit, shelf_life_days, old_item_code)
      VALUES ('SF010', '솔트라이발효종르방', 'kg', 7, 'RM213')
    `).run()
    results.push('SF010 (솔트라이발효종르방) 추가됨')
    
    for (const m of mapping) {
      // 1. bom 테이블: 기존 코드 → SF 코드
      const bomResult = await env.DB.prepare(`
        UPDATE bom SET item_code = ? WHERE item_code = ?
      `).bind(m.sf, m.old).run()
      
      // 2. production_bom 테이블: 기존 코드 → SF 코드
      const prodBomResult = await env.DB.prepare(`
        UPDATE production_bom SET material_code = ?, material_name = ? WHERE material_code = ?
      `).bind(m.sf, m.name, m.old).run()
      
      // 3. master 테이블에서 기존 코드 삭제
      const masterResult = await env.DB.prepare(`
        DELETE FROM master WHERE item_code = ?
      `).bind(m.old).run()
      
      results.push(`${m.old} → ${m.sf}: bom ${bomResult.meta.changes || 0}건, prod_bom ${prodBomResult.meta.changes || 0}건, master 삭제 ${masterResult.meta.changes || 0}건`)
    }
    
    return c.json({ 
      success: true, 
      message: '반제품 코드 정리 완료', 
      details: results 
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 원재료 코드 변경 API
admin.post('/change-material-code', async (c) => {
  const { env } = c
  const { oldCode, newCode } = await c.req.json()
  
  if (!oldCode || !newCode) {
    return c.json({ success: false, error: 'oldCode와 newCode가 필요합니다.' }, 400)
  }
  
  try {
    const results: string[] = []
    
    // 1. newCode가 master에 있는지 확인
    const newItem = await env.DB.prepare(`SELECT item_code, item_name FROM master WHERE item_code = ?`).bind(newCode).first()
    if (!newItem) {
      return c.json({ success: false, error: `대상 코드 ${newCode}가 master에 존재하지 않습니다.` }, 400)
    }
    
    // 2. bom 테이블 업데이트
    const bomResult = await env.DB.prepare(`UPDATE bom SET item_code = ? WHERE item_code = ?`).bind(newCode, oldCode).run()
    results.push(`bom: ${bomResult.meta.changes || 0}건 변경`)
    
    // 3. production_bom 테이블 업데이트
    const prodBomResult = await env.DB.prepare(`
      UPDATE production_bom SET material_code = ?, material_name = ? WHERE material_code = ?
    `).bind(newCode, newItem.item_name, oldCode).run()
    results.push(`production_bom: ${prodBomResult.meta.changes || 0}건 변경`)
    
    // 4. 기존 코드가 master에 있으면 삭제 (중복 코드 정리)
    const oldItem = await env.DB.prepare(`SELECT item_code FROM master WHERE item_code = ?`).bind(oldCode).first()
    if (oldItem) {
      await env.DB.prepare(`DELETE FROM master WHERE item_code = ?`).bind(oldCode).run()
      results.push(`master: ${oldCode} 삭제됨`)
    }
    
    return c.json({
      success: true,
      message: `${oldCode} → ${newCode} 변경 완료`,
      newItemName: newItem.item_name,
      details: results
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 반제품 정리 미리보기
admin.get('/cleanup-semi-finished/preview', async (c) => {
  const { env } = c
  
  try {
    const oldCodes = ['RM146', 'R076', 'RM136', 'RM155', 'RM156', 'RM137', 'RM149', 'RM145', 'RM265', 'RM213']
    
    // master에서 기존 코드 확인
    const masterItems = await env.DB.prepare(`
      SELECT item_code, item_name FROM master WHERE item_code IN (${oldCodes.map(() => '?').join(',')})
    `).bind(...oldCodes).all()
    
    // bom에서 기존 코드 확인
    const bomItems = await env.DB.prepare(`
      SELECT item_code, COUNT(*) as count FROM bom WHERE item_code IN (${oldCodes.map(() => '?').join(',')}) GROUP BY item_code
    `).bind(...oldCodes).all()
    
    // production_bom에서 기존 코드 확인
    const prodBomItems = await env.DB.prepare(`
      SELECT material_code, COUNT(*) as count FROM production_bom WHERE material_code IN (${oldCodes.map(() => '?').join(',')}) GROUP BY material_code
    `).bind(...oldCodes).all()
    
    return c.json({
      success: true,
      preview: {
        master: masterItems.results,
        bom: bomItems.results,
        production_bom: prodBomItems.results
      }
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// PR 코드를 PD 코드로 변환 (master에 등록 + bom 복사 + 바코드 연결)
admin.post('/convert-pr-to-pd', async (c) => {
  const { env } = c
  const { pr_codes } = await c.req.json()
  
  if (!pr_codes || !Array.isArray(pr_codes) || pr_codes.length === 0) {
    return c.json({ success: false, error: 'PR 코드 목록이 필요합니다.' }, 400)
  }
  
  try {
    const results: any[] = []
    
    // 현재 최대 PD 코드 조회
    const maxPd = await env.DB.prepare(`
      SELECT item_code FROM master 
      WHERE item_code LIKE 'PD%' 
      ORDER BY CAST(SUBSTR(item_code, 3) AS INTEGER) DESC 
      LIMIT 1
    `).first() as any
    
    let pdCounter = maxPd ? parseInt(maxPd.item_code.replace('PD', '')) + 1 : 194
    
    for (const prCode of pr_codes) {
      // 1. production_items에서 PR 정보 조회
      const prInfo = await env.DB.prepare(`
        SELECT * FROM production_items WHERE production_code = ?
      `).bind(prCode).first() as any
      
      if (!prInfo) {
        results.push({ pr_code: prCode, success: false, error: 'PR 코드를 찾을 수 없습니다.' })
        continue
      }
      
      // 2. 새 PD 코드 생성
      const newPdCode = `PD${String(pdCounter).padStart(3, '0')}`
      pdCounter++
      
      // 3. master 테이블에 등록
      await env.DB.prepare(`
        INSERT INTO master (item_code, item_name, category, unit, expiry_days, current_stock)
        VALUES (?, ?, '제품', ?, ?, 0)
      `).bind(newPdCode, prInfo.production_name, prInfo.unit || 'ea', prInfo.shelf_life_days || 3).run()
      
      // 4. production_bom에서 BOM 조회 후 bom 테이블에 복사
      const bomData = await env.DB.prepare(`
        SELECT material_code, material_name, quantity, unit FROM production_bom WHERE production_code = ?
      `).bind(prCode).all()
      
      let bomCopied = 0
      for (const bom of bomData.results as any[]) {
        await env.DB.prepare(`
          INSERT INTO bom (product_code, item_code, quantity, unit)
          VALUES (?, ?, ?, ?)
        `).bind(newPdCode, bom.material_code, bom.quantity, bom.unit || 'g').run()
        bomCopied++
      }
      
      // 5. production_barcodes에서 바코드 조회
      const barcodeData = await env.DB.prepare(`
        SELECT barcode, channel, box_quantity FROM production_barcodes WHERE production_code = ?
      `).bind(prCode).all()
      
      // 6. 바코드를 새 PD 코드에도 연결 (production_barcodes에 추가)
      let barcodeLinked = 0
      for (const bc of barcodeData.results as any[]) {
        try {
          await env.DB.prepare(`
            INSERT OR IGNORE INTO production_barcodes (production_code, barcode, channel, box_quantity)
            VALUES (?, ?, ?, ?)
          `).bind(newPdCode, bc.barcode, bc.channel || null, bc.box_quantity || 1).run()
          barcodeLinked++
        } catch (e) {
          // 중복 무시
        }
      }
      
      results.push({
        pr_code: prCode,
        pd_code: newPdCode,
        name: prInfo.production_name,
        bom_copied: bomCopied,
        barcode_linked: barcodeLinked,
        success: true
      })
    }
    
    return c.json({ success: true, results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 생산일보 기반 원료 사용 트랜잭션 동기화
// 생산일보의 materials_summary를 기반으로 transactions 테이블에 사용 기록 생성
admin.post('/sync-production-materials', async (c) => {
  const { env } = c
  const { report_id, date, dry_run } = await c.req.json()
  
  try {
    let reports: any[] = []
    
    if (report_id) {
      // 특정 생산일보만
      const report = await env.DB.prepare(`SELECT * FROM production_daily_report WHERE id = ?`).bind(report_id).first()
      if (report) reports = [report]
    } else if (date) {
      // 특정 날짜의 모든 생산일보
      const result = await env.DB.prepare(`SELECT * FROM production_daily_report WHERE report_date = ?`).bind(date).all()
      reports = result.results as any[]
    } else {
      return c.json({ success: false, error: 'report_id 또는 date가 필요합니다.' }, 400)
    }
    
    if (reports.length === 0) {
      return c.json({ success: false, error: '생산일보를 찾을 수 없습니다.' }, 404)
    }
    
    const results: any[] = []
    let totalInserted = 0
    let totalSkipped = 0
    
    for (const report of reports) {
      // 해당 생산일보의 원료 사용 정보 조회
      const materials = await env.DB.prepare(`
        SELECT material_code, material_name, required_quantity, unit
        FROM production_daily_materials
        WHERE report_id = ?
      `).bind(report.id).all()
      
      const reportDate = report.report_date
      const insertedItems: any[] = []
      const skippedItems: any[] = []
      
      for (const mat of materials.results as any[]) {
        const itemCode = mat.material_code
        const quantity = mat.required_quantity || 0
        
        if (quantity <= 0) {
          skippedItems.push({ item_code: itemCode, reason: '수량 0 이하' })
          continue
        }
        
        // 이미 해당 날짜에 같은 품목의 생산사용 트랜잭션이 있는지 확인
        const existing = await env.DB.prepare(`
          SELECT id FROM transactions 
          WHERE item_code = ? AND trans_date = ? AND trans_type = '사용' 
          AND memo LIKE '%생산일보%' AND memo LIKE ?
        `).bind(itemCode, reportDate, `%${report.report_no}%`).first()
        
        if (existing) {
          skippedItems.push({ item_code: itemCode, reason: '이미 존재' })
          totalSkipped++
          continue
        }
        
        // g -> kg 변환 (단위가 g인 경우)
        let quantityKg = quantity
        if (mat.unit === 'g') {
          quantityKg = quantity / 1000
        }
        
        if (!dry_run) {
          // 트랜잭션 INSERT (사용은 음수)
          const now = new Date().toISOString().replace('T', ' ').substring(0, 19)
          await env.DB.prepare(`
            INSERT INTO transactions (trans_date, item_code, trans_type, quantity, memo, created_at)
            VALUES (?, ?, '사용', ?, ?, ?)
          `).bind(reportDate, itemCode, -quantityKg, `생산일보 동기화 (${report.report_no})`, now).run()
          
          // master 재고 차감
          await env.DB.prepare(`
            UPDATE master SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP
            WHERE item_code = ?
          `).bind(quantityKg, itemCode).run()
        }
        
        insertedItems.push({
          item_code: itemCode,
          name: mat.material_name,
          quantity: quantityKg,
          unit: 'kg'
        })
        totalInserted++
      }
      
      results.push({
        report_id: report.id,
        report_no: report.report_no,
        report_date: reportDate,
        inserted: insertedItems.length,
        skipped: skippedItems.length,
        items: insertedItems,
        skipped_items: skippedItems
      })
    }
    
    return c.json({
      success: true,
      dry_run: dry_run || false,
      summary: {
        reports_processed: reports.length,
        total_inserted: totalInserted,
        total_skipped: totalSkipped
      },
      results
    })
  } catch (error: any) {
    console.error('Sync production materials error:', error)
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 기간별 생산일보 원료 사용 일괄 동기화
admin.post('/sync-production-materials-bulk', async (c) => {
  const { env } = c
  const { start_date, end_date, dry_run } = await c.req.json()
  
  if (!start_date || !end_date) {
    return c.json({ success: false, error: 'start_date와 end_date가 필요합니다.' }, 400)
  }
  
  try {
    // 해당 기간의 모든 생산일보 조회
    const reports = await env.DB.prepare(`
      SELECT id, report_no, report_date 
      FROM production_daily_report 
      WHERE report_date >= ? AND report_date <= ?
      ORDER BY report_date
    `).bind(start_date, end_date).all()
    
    if (reports.results.length === 0) {
      return c.json({ success: false, error: '해당 기간에 생산일보가 없습니다.' }, 404)
    }
    
    let totalInserted = 0
    let totalSkipped = 0
    const reportResults: any[] = []
    
    for (const report of reports.results as any[]) {
      // 해당 생산일보의 원료 사용 정보 조회
      const materials = await env.DB.prepare(`
        SELECT material_code, material_name, required_quantity, unit
        FROM production_daily_materials
        WHERE report_id = ?
      `).bind(report.id).all()
      
      let inserted = 0
      let skipped = 0
      
      for (const mat of materials.results as any[]) {
        const itemCode = mat.material_code
        const quantity = mat.required_quantity || 0
        
        if (quantity <= 0) {
          skipped++
          continue
        }
        
        // 이미 존재하는지 확인
        const existing = await env.DB.prepare(`
          SELECT id FROM transactions 
          WHERE item_code = ? AND trans_date = ? AND trans_type = '사용' 
          AND memo LIKE '%생산일보%'
        `).bind(itemCode, report.report_date).first()
        
        if (existing) {
          skipped++
          totalSkipped++
          continue
        }
        
        // g -> kg 변환
        let quantityKg = mat.unit === 'g' ? quantity / 1000 : quantity
        
        if (!dry_run) {
          const now = new Date().toISOString().replace('T', ' ').substring(0, 19)
          await env.DB.prepare(`
            INSERT INTO transactions (trans_date, item_code, trans_type, quantity, memo, created_at)
            VALUES (?, ?, '사용', ?, ?, ?)
          `).bind(report.report_date, itemCode, -quantityKg, `생산일보 동기화 (${report.report_no})`, now).run()
          
          await env.DB.prepare(`
            UPDATE master SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP
            WHERE item_code = ?
          `).bind(quantityKg, itemCode).run()
        }
        
        inserted++
        totalInserted++
      }
      
      reportResults.push({
        report_no: report.report_no,
        date: report.report_date,
        inserted,
        skipped
      })
    }
    
    return c.json({
      success: true,
      dry_run: dry_run || false,
      summary: {
        reports_processed: reports.results.length,
        total_inserted: totalInserted,
        total_skipped: totalSkipped
      },
      results: reportResults
    })
  } catch (error: any) {
    console.error('Sync production materials bulk error:', error)
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 제품 추적 시스템 (Product Tracker) =====
// 바코드/생산코드/생산명으로 검색하여 연관된 모든 데이터 조회

admin.get('/product-tracker', async (c) => {
  const { env } = c
  const query = c.req.query('q')?.trim()
  const searchType = c.req.query('type') || 'auto' // auto, barcode, production_code, production_name
  
  if (!query) {
    return c.json({ success: false, error: '검색어를 입력해주세요' }, 400)
  }
  
  try {
    let productionCode: string | null = null
    let barcodeInfo: any = null
    let productionItem: any = null
    
    // 1. 검색 타입에 따라 생산코드 찾기
    if (searchType === 'auto' || searchType === 'barcode') {
      // 바코드로 검색
      barcodeInfo = await env.DB.prepare(`
        SELECT pb.*, pi.production_name, pi.shelf_life_days as pi_shelf_life_days
        FROM production_barcodes pb
        LEFT JOIN production_items pi ON pb.production_code = pi.production_code
        WHERE pb.barcode = ?
      `).bind(query).first()
      
      if (barcodeInfo) {
        productionCode = barcodeInfo.production_code
      }
    }
    
    if (!productionCode && (searchType === 'auto' || searchType === 'production_code')) {
      // 생산코드로 검색
      productionItem = await env.DB.prepare(`
        SELECT * FROM production_items WHERE production_code = ?
      `).bind(query).first()
      
      if (productionItem) {
        productionCode = productionItem.production_code
      }
    }
    
    if (!productionCode && (searchType === 'auto' || searchType === 'production_name')) {
      // 생산명으로 검색 (부분 일치)
      productionItem = await env.DB.prepare(`
        SELECT * FROM production_items WHERE production_name LIKE ?
      `).bind(`%${query}%`).first()
      
      if (productionItem) {
        productionCode = productionItem.production_code
      }
    }
    
    if (!productionCode) {
      return c.json({ 
        success: false, 
        error: '검색 결과가 없습니다',
        searched: { query, type: searchType }
      }, 404)
    }
    
    // 2. 생산품목 정보 조회
    if (!productionItem) {
      productionItem = await env.DB.prepare(`
        SELECT * FROM production_items WHERE production_code = ?
      `).bind(productionCode).first()
    }
    
    // 3. 모든 관련 바코드 조회
    const barcodes = await env.DB.prepare(`
      SELECT * FROM production_barcodes 
      WHERE production_code = ?
      ORDER BY channel, created_at DESC
    `).bind(productionCode).all()
    
    // 4. BOM 데이터 조회 (production_bom + bom 테이블)
    const productionBom = await env.DB.prepare(`
      SELECT pb.*, m.item_name as material_name, m.unit, m.category
      FROM production_bom pb
      LEFT JOIN master m ON pb.material_code = m.item_code
      WHERE pb.production_code = ?
      ORDER BY pb.id
    `).bind(productionCode).all()
    
    // 기존 bom 테이블에서도 조회 (item_code 기준)
    const itemCode = productionItem?.item_code
    let legacyBom: any = { results: [] }
    if (itemCode) {
      legacyBom = await env.DB.prepare(`
        SELECT b.*, m.item_name as material_name, m.unit, m.category
        FROM bom b
        LEFT JOIN master m ON b.material_code = m.item_code
        WHERE b.product_code = ?
        ORDER BY b.id
      `).bind(itemCode).all()
    }
    
    // 5. 생산 이력 조회 (최근 50건)
    const productionHistory = await env.DB.prepare(`
      SELECT p.*, 
        (SELECT SUM(quantity) FROM production WHERE product_code = p.product_code AND prod_date = p.prod_date) as daily_total
      FROM production p
      WHERE p.product_code = ?
      ORDER BY p.prod_date DESC, p.created_at DESC
      LIMIT 50
    `).bind(productionCode).all()
    
    // 6. 생산입고 이력 조회 (최근 50건)
    const inboundHistory = await env.DB.prepare(`
      SELECT * FROM production_inbound
      WHERE production_code = ?
      ORDER BY inbound_date DESC, created_at DESC
      LIMIT 50
    `).bind(productionCode).all()
    
    // 7. 생산일보 이력 조회 (최근 30건)
    const dailyReportItems = await env.DB.prepare(`
      SELECT dri.*, dr.report_no, dr.report_date, dr.status as report_status
      FROM production_daily_items dri
      JOIN production_daily_report dr ON dri.report_id = dr.id
      WHERE dri.production_code = ?
      ORDER BY dr.report_date DESC
      LIMIT 30
    `).bind(productionCode).all()
    
    // 8. 출고 이력 조회 (최근 30건) - product_outbound 테이블 사용
    let outboundHistory: any = { results: [] }
    try {
      outboundHistory = await env.DB.prepare(`
        SELECT * FROM product_outbound
        WHERE production_code = ? OR lot_number LIKE ?
        ORDER BY outbound_date DESC
        LIMIT 30
      `).bind(productionCode, `%${productionCode}%`).all()
    } catch (e) {
      // 테이블이 없으면 무시
    }
    
    // 9. 통계 계산
    const stats = {
      total_barcodes: barcodes.results?.length || 0,
      total_bom_items: (productionBom.results?.length || 0) + (legacyBom.results?.length || 0),
      total_production_records: productionHistory.results?.length || 0,
      total_production_qty: productionHistory.results?.reduce((sum: number, p: any) => sum + (p.quantity || 0), 0) || 0,
      total_inbound_records: inboundHistory.results?.length || 0,
      total_daily_reports: dailyReportItems.results?.length || 0,
      channels: [...new Set((barcodes.results || []).map((b: any) => b.channel))].filter(Boolean)
    }
    
    return c.json({
      success: true,
      searched: { query, type: searchType, matched_production_code: productionCode },
      data: {
        // 기본 정보
        production_item: productionItem,
        searched_barcode: barcodeInfo,
        
        // 바코드 목록 (채널별)
        barcodes: barcodes.results || [],
        
        // BOM 데이터
        bom: {
          production_bom: productionBom.results || [],
          legacy_bom: legacyBom.results || [],
          total_count: (productionBom.results?.length || 0) + (legacyBom.results?.length || 0)
        },
        
        // 이력 데이터
        history: {
          production: productionHistory.results || [],
          inbound: inboundHistory.results || [],
          daily_reports: dailyReportItems.results || [],
          outbound: outboundHistory.results || []
        },
        
        // 통계
        stats
      }
    })
  } catch (error: any) {
    console.error('Product tracker error:', error)
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 제품 추적 - 빠른 검색 (자동완성용)
admin.get('/product-tracker/search', async (c) => {
  const { env } = c
  const query = c.req.query('q')?.trim()
  
  if (!query || query.length < 2) {
    return c.json({ success: true, data: [] })
  }
  
  try {
    // 바코드, 생산코드, 생산명에서 검색
    const results = await env.DB.prepare(`
      SELECT DISTINCT 
        pi.production_code,
        pi.production_name,
        pi.item_code,
        (SELECT COUNT(*) FROM production_barcodes WHERE production_code = pi.production_code) as barcode_count,
        (SELECT GROUP_CONCAT(DISTINCT channel) FROM production_barcodes WHERE production_code = pi.production_code) as channels
      FROM production_items pi
      LEFT JOIN production_barcodes pb ON pi.production_code = pb.production_code
      WHERE pi.production_code LIKE ? 
         OR pi.production_name LIKE ?
         OR pb.barcode LIKE ?
         OR pb.product_name LIKE ?
      GROUP BY pi.production_code
      ORDER BY pi.production_name
      LIMIT 20
    `).bind(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`).all()
    
    return c.json({ success: true, data: results.results || [] })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ===== 원료품목 기준 제품 추적 (Material-based Product Tracker) =====
// 원료코드/원료명으로 검색하여 해당 원료를 사용하는 모든 제품과 이력 조회
admin.get('/product-tracker/by-material', async (c) => {
  const { env } = c
  const query = c.req.query('q')?.trim()
  
  if (!query) {
    return c.json({ success: false, error: '원료코드 또는 원료명을 입력해주세요' }, 400)
  }
  
  try {
    // 1. 원료품목 정보 조회 (코드 또는 품명으로 검색)
    let material = await env.DB.prepare(`
      SELECT * FROM master 
      WHERE item_code = ? AND category IN ('원료', '부자재', '포장재', '소모품')
    `).bind(query).first()
    
    if (!material) {
      // 품명으로 검색
      material = await env.DB.prepare(`
        SELECT * FROM master 
        WHERE item_name LIKE ? AND category IN ('원료', '부자재', '포장재', '소모품')
        LIMIT 1
      `).bind(`%${query}%`).first()
    }
    
    if (!material) {
      return c.json({ 
        success: false, 
        error: '원료품목을 찾을 수 없습니다',
        searched: { query, type: 'material' }
      }, 404)
    }
    
    const materialCode = (material as any).item_code
    
    // 2. production_bom에서 해당 원료를 사용하는 생산품목 조회
    const productionBomProducts = await env.DB.prepare(`
      SELECT DISTINCT 
        pb.production_code,
        pi.production_name,
        pb.quantity as usage_quantity,
        pb.unit as usage_unit,
        (SELECT COUNT(*) FROM production_barcodes WHERE production_code = pb.production_code) as barcode_count
      FROM production_bom pb
      LEFT JOIN production_items pi ON pb.production_code = pi.production_code
      WHERE pb.material_code = ?
      ORDER BY pi.production_name
    `).bind(materialCode).all()
    
    // 3. bom 테이블에서 해당 원료를 사용하는 제품 조회 (레거시)
    const legacyBomProducts = await env.DB.prepare(`
      SELECT DISTINCT 
        b.product_code,
        m.item_name as product_name,
        m.unit as product_unit,
        b.quantity as usage_quantity,
        b.unit as usage_unit,
        m.category
      FROM bom b
      LEFT JOIN master m ON b.product_code = m.item_code
      WHERE b.item_code = ?
      ORDER BY m.item_name
    `).bind(materialCode).all()
    
    // 4. 원료 입고 이력 조회 (최근 50건)
    const inboundHistory = await env.DB.prepare(`
      SELECT i.*, m.item_name
      FROM inbound i
      LEFT JOIN master m ON i.item_code = m.item_code
      WHERE i.item_code = ?
      ORDER BY i.inbound_date DESC, i.created_at DESC
      LIMIT 50
    `).bind(materialCode).all()
    
    // 5. 원료 사용(출고) 이력 조회 - transactions 테이블 (최근 50건)
    const usageHistory = await env.DB.prepare(`
      SELECT t.*, m.item_name
      FROM transactions t
      LEFT JOIN master m ON t.item_code = m.item_code
      WHERE t.item_code = ? AND t.trans_type = '출고'
      ORDER BY t.trans_date DESC, t.created_at DESC
      LIMIT 50
    `).bind(materialCode).all()
    
    // 6. 생산자재 사용 이력 조회 - production_materials 테이블 (최근 50건)
    const productionMaterialsHistory = await env.DB.prepare(`
      SELECT pm.*, p.prod_date, p.product_code as production_product_code,
             pi.production_name
      FROM production_materials pm
      LEFT JOIN production p ON pm.production_id = p.id
      LEFT JOIN production_items pi ON p.product_code = pi.production_code
      WHERE pm.item_code = ?
      ORDER BY p.prod_date DESC, pm.created_at DESC
      LIMIT 50
    `).bind(materialCode).all()
    
    // 7. 현재 재고 LOT 정보 조회
    const currentLots = await env.DB.prepare(`
      SELECT lot_number, inbound_date, origin_qty as quantity, remain_qty, quality_status, supplier
      FROM inbound
      WHERE item_code = ? AND quality_status = '합격' AND remain_qty > 0
      ORDER BY inbound_date ASC
    `).bind(materialCode).all()
    
    // 8. 통계 계산
    const productionProducts = productionBomProducts.results || []
    const legacyProducts = legacyBomProducts.results || []
    
    // 중복 제거된 제품 목록 (production_code 또는 product_code 기준)
    const allProductCodes = new Set([
      ...productionProducts.map((p: any) => p.production_code),
      ...legacyProducts.map((p: any) => p.product_code)
    ])
    
    const stats = {
      total_products_using_material: allProductCodes.size,
      production_bom_count: productionProducts.length,
      legacy_bom_count: legacyProducts.length,
      total_inbound_records: inboundHistory.results?.length || 0,
      total_usage_records: usageHistory.results?.length || 0,
      total_production_materials_records: productionMaterialsHistory.results?.length || 0,
      current_stock: (material as any).current_stock || 0,
      current_lots_count: currentLots.results?.length || 0,
      current_lots_total_qty: currentLots.results?.reduce((sum: number, lot: any) => sum + (lot.remain_qty || 0), 0) || 0
    }
    
    return c.json({
      success: true,
      searched: { query, type: 'material', matched_material_code: materialCode },
      data: {
        // 원료 기본 정보
        material: material,
        
        // 해당 원료를 사용하는 제품 목록
        products: {
          production_bom: productionProducts,
          legacy_bom: legacyProducts,
          total_count: allProductCodes.size
        },
        
        // 현재 재고 LOT
        current_lots: currentLots.results || [],
        
        // 이력 데이터
        history: {
          inbound: inboundHistory.results || [],
          usage: usageHistory.results || [],
          production_materials: productionMaterialsHistory.results || []
        },
        
        // 통계
        stats
      }
    })
  } catch (error: any) {
    console.error('Material product tracker error:', error)
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 원료품목 검색 - 빠른 검색 (자동완성용)
admin.get('/product-tracker/material-search', async (c) => {
  const { env } = c
  const query = c.req.query('q')?.trim()
  
  if (!query || query.length < 2) {
    return c.json({ success: true, data: [] })
  }
  
  try {
    // 원료/부자재/포장재/소모품 카테고리에서 검색
    const results = await env.DB.prepare(`
      SELECT DISTINCT 
        m.item_code,
        m.item_name,
        m.category,
        m.unit,
        m.current_stock,
        (SELECT COUNT(DISTINCT production_code) FROM production_bom WHERE material_code = m.item_code) as product_count,
        (SELECT COUNT(DISTINCT product_code) FROM bom WHERE item_code = m.item_code) as legacy_product_count
      FROM master m
      WHERE (m.item_code LIKE ? OR m.item_name LIKE ?)
        AND m.category IN ('원료', '부자재', '포장재', '소모품')
      ORDER BY m.item_name
      LIMIT 20
    `).bind(`%${query}%`, `%${query}%`).all()
    
    return c.json({ success: true, data: results.results || [] })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 샘플 재고 기능 활성화 - inbound/transactions 테이블에 is_sample, storage_location 컬럼 추가
admin.post('/migrate/enable-sample-inventory', async (c) => {
  const env = c.env as Env
  const results: string[] = []
  
  try {
    // 1. inbound 테이블에 is_sample 컬럼 추가
    try {
      await env.DB.prepare(`ALTER TABLE inbound ADD COLUMN is_sample INTEGER DEFAULT 0`).run()
      results.push('inbound.is_sample 컬럼 추가 완료')
    } catch (e: any) {
      if (e.message.includes('duplicate column')) {
        results.push('inbound.is_sample 컬럼 이미 존재')
      } else {
        results.push(`inbound.is_sample 추가 실패: ${e.message}`)
      }
    }
    
    // 2. inbound 테이블에 storage_location 컬럼 추가
    try {
      await env.DB.prepare(`ALTER TABLE inbound ADD COLUMN storage_location TEXT`).run()
      results.push('inbound.storage_location 컬럼 추가 완료')
    } catch (e: any) {
      if (e.message.includes('duplicate column')) {
        results.push('inbound.storage_location 컬럼 이미 존재')
      } else {
        results.push(`inbound.storage_location 추가 실패: ${e.message}`)
      }
    }
    
    // 3. transactions 테이블에 is_sample 컬럼 추가
    try {
      await env.DB.prepare(`ALTER TABLE transactions ADD COLUMN is_sample INTEGER DEFAULT 0`).run()
      results.push('transactions.is_sample 컬럼 추가 완료')
    } catch (e: any) {
      if (e.message.includes('duplicate column')) {
        results.push('transactions.is_sample 컬럼 이미 존재')
      } else {
        results.push(`transactions.is_sample 추가 실패: ${e.message}`)
      }
    }
    
    return c.json({ 
      success: true, 
      message: '샘플 재고 기능이 활성화되었습니다.',
      results 
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message, results }, 500)
  }
})

// =============================================
// 재고 정합성 검증 API
// =============================================

// 재고 검증 - master.current_stock vs inbound.remain_qty 합계 비교
admin.get('/verify-inventory', async (c) => {
  const env = c.env as Env
  const category = c.req.query('category') // 원료, 부자재, 제품
  const threshold = parseFloat(c.req.query('threshold') || '0.01') // 차이 임계값
  
  try {
    // 1. 원료/부자재 검증 (master + supplies 테이블)
    const rawMaterialsQuery = `
      SELECT 
        m.item_code,
        m.item_name,
        m.category,
        m.unit,
        m.current_stock,
        COALESCE(lot_sum.lot_remain_total, 0) as lot_remain_total,
        COALESCE(lot_sum.lot_count, 0) as lot_count,
        COALESCE(trans_sum.total_inbound, 0) as total_inbound,
        COALESCE(trans_sum.total_usage, 0) as total_usage,
        COALESCE(trans_sum.total_outbound, 0) as total_outbound,
        COALESCE(trans_sum.total_adjustment, 0) as total_adjustment,
        m.current_stock - COALESCE(lot_sum.lot_remain_total, 0) as difference,
        ABS(m.current_stock - COALESCE(lot_sum.lot_remain_total, 0)) as abs_difference
      FROM master m
      LEFT JOIN (
        SELECT 
          item_code, 
          SUM(remain_qty) as lot_remain_total,
          COUNT(*) as lot_count
        FROM inbound 
        WHERE quality_status = '합격'
        GROUP BY item_code
      ) lot_sum ON m.item_code = lot_sum.item_code
      LEFT JOIN (
        SELECT 
          item_code,
          SUM(CASE WHEN trans_type = '입고' THEN quantity ELSE 0 END) as total_inbound,
          SUM(CASE WHEN trans_type = '사용' THEN ABS(quantity) ELSE 0 END) as total_usage,
          SUM(CASE WHEN trans_type = '출고' THEN ABS(quantity) ELSE 0 END) as total_outbound,
          SUM(CASE WHEN trans_type = '재고조정' THEN quantity ELSE 0 END) as total_adjustment
        FROM transactions
        GROUP BY item_code
      ) trans_sum ON m.item_code = trans_sum.item_code
      WHERE m.current_stock > 0 OR COALESCE(lot_sum.lot_remain_total, 0) > 0
      ${category && category !== '전체' ? `AND m.category = '${category}'` : ''}
      ORDER BY abs_difference DESC
    `
    
    // 2. 부자재 검증
    const suppliesQuery = `
      SELECT 
        s.item_code,
        s.item_name,
        s.category,
        s.unit,
        s.current_stock,
        COALESCE(lot_sum.lot_remain_total, 0) as lot_remain_total,
        COALESCE(lot_sum.lot_count, 0) as lot_count,
        COALESCE(trans_sum.total_inbound, 0) as total_inbound,
        COALESCE(trans_sum.total_usage, 0) as total_usage,
        COALESCE(trans_sum.total_outbound, 0) as total_outbound,
        COALESCE(trans_sum.total_adjustment, 0) as total_adjustment,
        s.current_stock - COALESCE(lot_sum.lot_remain_total, 0) as difference,
        ABS(s.current_stock - COALESCE(lot_sum.lot_remain_total, 0)) as abs_difference
      FROM supplies s
      LEFT JOIN (
        SELECT 
          item_code, 
          SUM(remain_qty) as lot_remain_total,
          COUNT(*) as lot_count
        FROM inbound 
        WHERE quality_status = '합격'
        GROUP BY item_code
      ) lot_sum ON s.item_code = lot_sum.item_code
      LEFT JOIN (
        SELECT 
          item_code,
          SUM(CASE WHEN trans_type = '입고' THEN quantity ELSE 0 END) as total_inbound,
          SUM(CASE WHEN trans_type = '사용' THEN ABS(quantity) ELSE 0 END) as total_usage,
          SUM(CASE WHEN trans_type = '출고' THEN ABS(quantity) ELSE 0 END) as total_outbound,
          SUM(CASE WHEN trans_type = '재고조정' THEN quantity ELSE 0 END) as total_adjustment
        FROM transactions
        GROUP BY item_code
      ) trans_sum ON s.item_code = trans_sum.item_code
      WHERE s.current_stock > 0 OR COALESCE(lot_sum.lot_remain_total, 0) > 0
      ORDER BY abs_difference DESC
    `
    
    // 3. 제품 검증
    const productsQuery = `
      SELECT 
        p.production_code as item_code,
        COALESCE(p.alias1, p.production_name) as item_name,
        '제품' as category,
        COALESCE(p.unit, 'EA') as unit,
        p.current_stock,
        COALESCE(lot_sum.lot_remain_total, 0) as lot_remain_total,
        COALESCE(lot_sum.lot_count, 0) as lot_count,
        COALESCE(trans_sum.total_inbound, 0) as total_inbound,
        0 as total_usage,
        COALESCE(trans_sum.total_outbound, 0) as total_outbound,
        COALESCE(trans_sum.total_adjustment, 0) as total_adjustment,
        p.current_stock - COALESCE(lot_sum.lot_remain_total, 0) as difference,
        ABS(p.current_stock - COALESCE(lot_sum.lot_remain_total, 0)) as abs_difference
      FROM production_items p
      LEFT JOIN (
        SELECT 
          production_code, 
          SUM(remain_qty) as lot_remain_total,
          COUNT(*) as lot_count
        FROM production_inbound 
        WHERE quality_status = '합격'
        GROUP BY production_code
      ) lot_sum ON p.production_code = lot_sum.production_code
      LEFT JOIN (
        SELECT 
          production_code,
          SUM(CASE WHEN trans_type = '생산입고' THEN quantity ELSE 0 END) as total_inbound,
          SUM(CASE WHEN trans_type = '출고' THEN ABS(quantity) ELSE 0 END) as total_outbound,
          SUM(CASE WHEN trans_type = '재고조정' THEN quantity ELSE 0 END) as total_adjustment
        FROM production_transactions
        GROUP BY production_code
      ) trans_sum ON p.production_code = trans_sum.production_code
      WHERE p.current_stock > 0 OR COALESCE(lot_sum.lot_remain_total, 0) > 0
      ORDER BY abs_difference DESC
    `
    
    // 병렬 실행
    const [rawResult, suppliesResult, productsResult] = await Promise.all([
      (!category || category === '전체' || category === '원료') 
        ? env.DB.prepare(rawMaterialsQuery).all() 
        : Promise.resolve({ results: [] }),
      (!category || category === '전체' || category === '부자재') 
        ? env.DB.prepare(suppliesQuery).all() 
        : Promise.resolve({ results: [] }),
      (!category || category === '전체' || category === '제품') 
        ? env.DB.prepare(productsQuery).all() 
        : Promise.resolve({ results: [] })
    ])
    
    // 결과 합치기
    const allItems = [
      ...(rawResult.results || []),
      ...(suppliesResult.results || []),
      ...(productsResult.results || [])
    ]
    
    // 불일치 항목 필터링
    const discrepancies = allItems.filter((item: any) => Math.abs(item.difference) > threshold)
    const matched = allItems.filter((item: any) => Math.abs(item.difference) <= threshold)
    
    // 통계
    const stats = {
      total_items: allItems.length,
      matched_count: matched.length,
      discrepancy_count: discrepancies.length,
      total_current_stock: allItems.reduce((sum: number, item: any) => sum + (item.current_stock || 0), 0),
      total_lot_remain: allItems.reduce((sum: number, item: any) => sum + (item.lot_remain_total || 0), 0),
      total_difference: allItems.reduce((sum: number, item: any) => sum + (item.difference || 0), 0),
      by_category: {
        원료: {
          count: allItems.filter((i: any) => i.category === '원료').length,
          discrepancies: discrepancies.filter((i: any) => i.category === '원료').length
        },
        부자재: {
          count: allItems.filter((i: any) => i.category === '부자재').length,
          discrepancies: discrepancies.filter((i: any) => i.category === '부자재').length
        },
        제품: {
          count: allItems.filter((i: any) => i.category === '제품').length,
          discrepancies: discrepancies.filter((i: any) => i.category === '제품').length
        }
      }
    }
    
    return c.json({
      success: true,
      stats,
      discrepancies: discrepancies.slice(0, 100), // 상위 100건
      matched_sample: matched.slice(0, 10), // 일치 샘플 10건
      threshold
    })
  } catch (error: any) {
    console.error('Verify inventory error:', error)
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 개별 품목 상세 검증
admin.get('/verify-inventory/:itemCode', async (c) => {
  const env = c.env as Env
  const itemCode = c.req.param('itemCode')
  
  try {
    // 1. 품목 정보 조회 (master 또는 supplies)
    let itemInfo = await env.DB.prepare(`
      SELECT item_code, item_name, category, unit, current_stock, 'master' as source_table
      FROM master WHERE item_code = ?
    `).bind(itemCode).first()
    
    if (!itemInfo) {
      itemInfo = await env.DB.prepare(`
        SELECT item_code, item_name, category, unit, current_stock, 'supplies' as source_table
        FROM supplies WHERE item_code = ?
      `).bind(itemCode).first()
    }
    
    if (!itemInfo) {
      // 제품 확인
      itemInfo = await env.DB.prepare(`
        SELECT production_code as item_code, COALESCE(alias1, production_name) as item_name, 
               '제품' as category, COALESCE(unit, 'EA') as unit, current_stock, 'production_items' as source_table
        FROM production_items WHERE production_code = ?
      `).bind(itemCode).first()
    }
    
    if (!itemInfo) {
      return c.json({ success: false, error: '품목을 찾을 수 없습니다' }, 404)
    }
    
    // 2. LOT 정보 조회
    const isProduct = itemInfo.source_table === 'production_items'
    
    const lotsQuery = isProduct
      ? `SELECT lot_number, inbound_date, expiry_date, origin_qty, remain_qty, quality_status
         FROM production_inbound WHERE production_code = ? ORDER BY inbound_date`
      : `SELECT lot_number, inbound_date, expiry_date, origin_qty, remain_qty, quality_status, supplier
         FROM inbound WHERE item_code = ? ORDER BY inbound_date`
    
    const lots = await env.DB.prepare(lotsQuery).bind(itemCode).all()
    
    // 3. 트랜잭션 내역 조회 (최근 100건)
    const transQuery = isProduct
      ? `SELECT id, trans_date, trans_type, quantity, lot_number, memo, created_at
         FROM production_transactions WHERE production_code = ? 
         ORDER BY trans_date DESC, id DESC LIMIT 100`
      : `SELECT id, trans_date, trans_type, quantity, lot_number, memo, created_at
         FROM transactions WHERE item_code = ? 
         ORDER BY trans_date DESC, id DESC LIMIT 100`
    
    const transactions = await env.DB.prepare(transQuery).bind(itemCode).all()
    
    // 4. 계산 검증
    const activeLots = (lots.results || []).filter((lot: any) => lot.quality_status === '합격')
    const lotRemainTotal = activeLots.reduce((sum: number, lot: any) => sum + (lot.remain_qty || 0), 0)
    const lotOriginTotal = activeLots.reduce((sum: number, lot: any) => sum + (lot.origin_qty || 0), 0)
    
    // 트랜잭션 기반 계산
    const trans = transactions.results || []
    const transInbound = trans.filter((t: any) => t.trans_type === '입고' || t.trans_type === '생산입고')
      .reduce((sum: number, t: any) => sum + Math.abs(t.quantity || 0), 0)
    const transUsage = trans.filter((t: any) => t.trans_type === '사용')
      .reduce((sum: number, t: any) => sum + Math.abs(t.quantity || 0), 0)
    const transOutbound = trans.filter((t: any) => t.trans_type === '출고')
      .reduce((sum: number, t: any) => sum + Math.abs(t.quantity || 0), 0)
    const transAdjustment = trans.filter((t: any) => t.trans_type === '재고조정')
      .reduce((sum: number, t: any) => sum + (t.quantity || 0), 0)
    
    // 계산된 재고 (트랜잭션 기반)
    const calculatedStock = transInbound - transUsage - transOutbound + transAdjustment
    
    // 불일치 분석
    const analysis = {
      current_stock: itemInfo.current_stock,
      lot_remain_total: lotRemainTotal,
      lot_origin_total: lotOriginTotal,
      lot_used_total: lotOriginTotal - lotRemainTotal,
      calculated_from_transactions: calculatedStock,
      difference_stock_vs_lot: (itemInfo.current_stock as number) - lotRemainTotal,
      difference_stock_vs_calc: (itemInfo.current_stock as number) - calculatedStock,
      difference_lot_vs_calc: lotRemainTotal - calculatedStock,
      transaction_summary: {
        inbound: transInbound,
        usage: transUsage,
        outbound: transOutbound,
        adjustment: transAdjustment
      }
    }
    
    return c.json({
      success: true,
      item: itemInfo,
      analysis,
      lots: lots.results,
      active_lots: activeLots,
      transactions: transactions.results
    })
  } catch (error: any) {
    console.error('Verify inventory detail error:', error)
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 재고 불일치 자동 수정 (LOT 잔량 합계로 current_stock 동기화)
admin.post('/sync-inventory', async (c) => {
  const env = c.env as Env
  const { item_codes, dry_run = true } = await c.req.json()
  
  try {
    const results: any[] = []
    
    // item_codes가 없으면 모든 불일치 항목 대상
    let targetItems: string[] = item_codes || []
    
    if (targetItems.length === 0) {
      // 불일치 항목 자동 검색
      const discrepancyQuery = `
        SELECT m.item_code, m.current_stock, COALESCE(SUM(i.remain_qty), 0) as lot_total
        FROM master m
        LEFT JOIN inbound i ON m.item_code = i.item_code AND i.quality_status = '합격'
        GROUP BY m.item_code
        HAVING ABS(m.current_stock - COALESCE(SUM(i.remain_qty), 0)) > 0.01
        
        UNION ALL
        
        SELECT s.item_code, s.current_stock, COALESCE(SUM(i.remain_qty), 0) as lot_total
        FROM supplies s
        LEFT JOIN inbound i ON s.item_code = i.item_code AND i.quality_status = '합격'
        GROUP BY s.item_code
        HAVING ABS(s.current_stock - COALESCE(SUM(i.remain_qty), 0)) > 0.01
      `
      const discResult = await env.DB.prepare(discrepancyQuery).all()
      targetItems = (discResult.results || []).map((r: any) => r.item_code)
    }
    
    for (const itemCode of targetItems) {
      // LOT 잔량 합계 계산
      const lotSum = await env.DB.prepare(`
        SELECT COALESCE(SUM(remain_qty), 0) as total
        FROM inbound WHERE item_code = ? AND quality_status = '합격'
      `).bind(itemCode).first()
      
      const lotTotal = (lotSum as any)?.total || 0
      
      // 현재 재고 조회
      let currentItem = await env.DB.prepare(`
        SELECT item_code, item_name, current_stock, 'master' as tbl FROM master WHERE item_code = ?
      `).bind(itemCode).first()
      
      if (!currentItem) {
        currentItem = await env.DB.prepare(`
          SELECT item_code, item_name, current_stock, 'supplies' as tbl FROM supplies WHERE item_code = ?
        `).bind(itemCode).first()
      }
      
      if (currentItem) {
        const oldStock = (currentItem as any).current_stock
        const diff = lotTotal - oldStock
        
        if (!dry_run && Math.abs(diff) > 0.001) {
          // 실제 업데이트
          const table = (currentItem as any).tbl
          await env.DB.prepare(`UPDATE ${table} SET current_stock = ?, updated_at = datetime('now') WHERE item_code = ?`)
            .bind(lotTotal, itemCode).run()
        }
        
        results.push({
          item_code: itemCode,
          item_name: (currentItem as any).item_name,
          old_stock: oldStock,
          lot_total: lotTotal,
          difference: diff,
          updated: !dry_run && Math.abs(diff) > 0.001
        })
      }
    }
    
    return c.json({
      success: true,
      dry_run,
      message: dry_run ? '시뮬레이션 결과입니다. 실제 적용하려면 dry_run: false로 요청하세요.' : '재고 동기화가 완료되었습니다.',
      total_items: results.length,
      updated_count: results.filter(r => r.updated).length,
      results
    })
  } catch (error: any) {
    console.error('Sync inventory error:', error)
    return c.json({ success: false, error: error.message }, 500)
  }
})

// LOT remain_qty 재계산 (current_stock 기준으로 FIFO 역산)
// current_stock이 정확하다고 가정하고 LOT remain_qty를 맞춤
admin.post('/fix-lot-remain', async (c) => {
  const env = c.env as Env
  const { item_codes, dry_run = true } = await c.req.json()
  
  try {
    const results: any[] = []
    
    // item_codes가 없으면 모든 불일치 항목 대상
    let targetItems: string[] = item_codes || []
    
    if (targetItems.length === 0) {
      // 불일치 항목 자동 검색 (LOT 합계 > current_stock인 경우만)
      const discrepancyQuery = `
        SELECT m.item_code, m.current_stock, COALESCE(SUM(i.remain_qty), 0) as lot_total
        FROM master m
        LEFT JOIN inbound i ON m.item_code = i.item_code AND i.quality_status = '합격'
        GROUP BY m.item_code
        HAVING COALESCE(SUM(i.remain_qty), 0) > m.current_stock + 0.01
        
        UNION ALL
        
        SELECT s.item_code, s.current_stock, COALESCE(SUM(i.remain_qty), 0) as lot_total
        FROM supplies s
        LEFT JOIN inbound i ON s.item_code = i.item_code AND i.quality_status = '합격'
        GROUP BY s.item_code
        HAVING COALESCE(SUM(i.remain_qty), 0) > s.current_stock + 0.01
      `
      const discResult = await env.DB.prepare(discrepancyQuery).all()
      targetItems = (discResult.results || []).map((r: any) => r.item_code)
    }
    
    for (const itemCode of targetItems) {
      // 현재 재고 조회
      let currentItem = await env.DB.prepare(`
        SELECT item_code, item_name, current_stock FROM master WHERE item_code = ?
      `).bind(itemCode).first()
      
      if (!currentItem) {
        currentItem = await env.DB.prepare(`
          SELECT item_code, item_name, current_stock FROM supplies WHERE item_code = ?
        `).bind(itemCode).first()
      }
      
      if (!currentItem) continue
      
      const targetStock = (currentItem as any).current_stock
      
      // LOT 목록 조회 (FIFO 순서: 유효기한 → 입고일)
      const lots = await env.DB.prepare(`
        SELECT id, lot_number, inbound_date, expiry_date, origin_qty, remain_qty
        FROM inbound 
        WHERE item_code = ? AND quality_status = '합격'
        ORDER BY 
          CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END,
          expiry_date ASC, 
          inbound_date ASC
      `).bind(itemCode).all()
      
      const lotList = lots.results || []
      const oldLotTotal = lotList.reduce((sum: number, lot: any) => sum + lot.remain_qty, 0)
      const excessQty = oldLotTotal - targetStock // 초과 차감해야 할 양
      
      if (excessQty <= 0) {
        results.push({
          item_code: itemCode,
          item_name: (currentItem as any).item_name,
          status: 'skip',
          reason: 'LOT 합계가 current_stock보다 작거나 같음'
        })
        continue
      }
      
      // FIFO 방식으로 LOT remain_qty 조정
      let remainingToDeduct = excessQty
      const lotChanges: any[] = []
      
      for (const lot of lotList as any[]) {
        if (remainingToDeduct <= 0) break
        
        const deductQty = Math.min(remainingToDeduct, lot.remain_qty)
        const newRemainQty = lot.remain_qty - deductQty
        
        lotChanges.push({
          lot_number: lot.lot_number,
          old_remain: lot.remain_qty,
          deduct: deductQty,
          new_remain: newRemainQty
        })
        
        if (!dry_run) {
          await env.DB.prepare(`
            UPDATE inbound SET remain_qty = ?, updated_at = datetime('now') WHERE id = ?
          `).bind(newRemainQty, lot.id).run()
        }
        
        remainingToDeduct -= deductQty
      }
      
      const newLotTotal = oldLotTotal - excessQty + remainingToDeduct
      
      results.push({
        item_code: itemCode,
        item_name: (currentItem as any).item_name,
        current_stock: targetStock,
        old_lot_total: oldLotTotal,
        excess_qty: excessQty,
        deducted: excessQty - remainingToDeduct,
        new_lot_total: newLotTotal,
        lot_changes: lotChanges,
        updated: !dry_run
      })
    }
    
    return c.json({
      success: true,
      dry_run,
      message: dry_run 
        ? 'LOT 재계산 시뮬레이션입니다. 실제 적용하려면 dry_run: false로 요청하세요.' 
        : 'LOT remain_qty 재계산이 완료되었습니다.',
      total_items: results.length,
      updated_count: results.filter(r => r.updated).length,
      results
    })
  } catch (error: any) {
    console.error('Fix LOT remain error:', error)
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 마이그레이션 실행 (pack_unit 컬럼 추가)
admin.post('/migrate-pack-unit', async (c) => {
  const { env } = c
  
  try {
    const results: string[] = []
    
    // master 테이블에 pack_unit 컬럼 추가 시도
    try {
      await env.DB.prepare('ALTER TABLE master ADD COLUMN pack_unit REAL DEFAULT NULL').run()
      results.push('master.pack_unit added')
    } catch (e: any) {
      if (e.message?.includes('duplicate column')) {
        results.push('master.pack_unit already exists')
      } else {
        results.push(`master.pack_unit error: ${e.message}`)
      }
    }
    
    try {
      await env.DB.prepare('ALTER TABLE master ADD COLUMN pack_unit_name TEXT DEFAULT NULL').run()
      results.push('master.pack_unit_name added')
    } catch (e: any) {
      if (e.message?.includes('duplicate column')) {
        results.push('master.pack_unit_name already exists')
      } else {
        results.push(`master.pack_unit_name error: ${e.message}`)
      }
    }
    
    // supplies 테이블에 pack_unit 컬럼 추가 시도
    try {
      await env.DB.prepare('ALTER TABLE supplies ADD COLUMN pack_unit REAL DEFAULT NULL').run()
      results.push('supplies.pack_unit added')
    } catch (e: any) {
      if (e.message?.includes('duplicate column')) {
        results.push('supplies.pack_unit already exists')
      } else {
        results.push(`supplies.pack_unit error: ${e.message}`)
      }
    }
    
    try {
      await env.DB.prepare('ALTER TABLE supplies ADD COLUMN pack_unit_name TEXT DEFAULT NULL').run()
      results.push('supplies.pack_unit_name added')
    } catch (e: any) {
      if (e.message?.includes('duplicate column')) {
        results.push('supplies.pack_unit_name already exists')
      } else {
        results.push(`supplies.pack_unit_name error: ${e.message}`)
      }
    }
    
    return c.json({ success: true, message: 'Migration completed', results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

export default admin
