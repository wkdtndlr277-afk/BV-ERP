// 사용량 입력 API - 수불부에 반영됨
// transactions 테이블에 저장 + LOT 잔량 차감 (FEFO: First Expired First Out)
// 최적화: Atomic Transaction, FEFO 강제, MAX(0,...) 적용, 재고 부족 방어
import { Hono } from 'hono';
import type { Bindings } from '../types';
import { FEFO_QUERY, checkStockAvailability } from '../utils/inventory';

const usageRoutes = new Hono<{ Bindings: Bindings }>();

// 사용 가능한 원료/부자재 목록 조회 (잔량 있는 것만)
usageRoutes.get('/available', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT * FROM (
      -- 원료 (master 테이블)
      SELECT m.item_code, m.item_name, m.category, m.unit, m.current_stock, m.safety_stock,
             COALESCE((SELECT SUM(i.remain_qty) FROM inbound i WHERE i.item_code = m.item_code AND i.quality_status = '합격' AND i.remain_qty > 0), 0) as available_qty
      FROM master m
      WHERE m.category = '원료' AND m.current_stock > 0
      
      UNION ALL
      
      -- 부자재 (supplies 테이블)
      SELECT s.item_code, s.item_name, '부자재' as category, s.unit, s.current_stock, 0 as safety_stock,
             COALESCE((SELECT SUM(i.remain_qty) FROM inbound i WHERE i.item_code = s.item_code AND i.quality_status = '합격' AND i.remain_qty > 0), 0) as available_qty
      FROM supplies s
      WHERE s.current_stock > 0
    ) combined
    ORDER BY category, item_name
  `).all();
  
  return c.json({ success: true, data: result.results });
});

// 오늘 사용량 기록 조회 (transactions 테이블에서)
usageRoutes.get('/today', async (c) => {
  const today = new Date().toISOString().split('T')[0];
  
  const result = await c.env.DB.prepare(`
    SELECT t.id, t.trans_date as usage_date, t.item_code, t.lot_number, 
           ABS(t.quantity) as quantity, t.memo, t.created_at,
           COALESCE(m.item_name, s.item_name) as item_name, 
           COALESCE(m.unit, s.unit) as unit
    FROM transactions t
    LEFT JOIN master m ON t.item_code = m.item_code
    LEFT JOIN supplies s ON t.item_code = s.item_code
    WHERE t.trans_type = '사용' AND t.trans_date = ?
    ORDER BY t.created_at DESC
  `).bind(today).all();
  
  return c.json({ success: true, data: result.results });
});

// 기간별 사용량 기록 조회
usageRoutes.get('/history', async (c) => {
  const start_date = c.req.query('start_date');
  const end_date = c.req.query('end_date');
  const item_code = c.req.query('item_code');
  
  let query = `
    SELECT t.id, t.trans_date as usage_date, t.item_code, t.lot_number,
           ABS(t.quantity) as quantity, t.memo, t.created_at,
           COALESCE(m.item_name, s.item_name) as item_name, 
           COALESCE(m.unit, s.unit) as unit
    FROM transactions t
    LEFT JOIN master m ON t.item_code = m.item_code
    LEFT JOIN supplies s ON t.item_code = s.item_code
    WHERE t.trans_type = '사용'
  `;
  const params: any[] = [];
  
  if (start_date) {
    query += ' AND t.trans_date >= ?';
    params.push(start_date);
  }
  if (end_date) {
    query += ' AND t.trans_date <= ?';
    params.push(end_date);
  }
  if (item_code) {
    query += ' AND t.item_code = ?';
    params.push(item_code);
  }
  
  query += ' ORDER BY t.trans_date DESC, t.id DESC';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// 사용량 요약 조회 (품목별 합계)
usageRoutes.get('/summary', async (c) => {
  const start_date = c.req.query('start_date');
  const end_date = c.req.query('end_date');
  
  let query = `
    SELECT t.item_code, 
           COALESCE(m.item_name, s.item_name) as item_name,
           COALESCE(m.unit, s.unit) as unit,
           SUM(ABS(t.quantity)) as total_usage,
           COUNT(*) as record_count
    FROM transactions t
    LEFT JOIN master m ON t.item_code = m.item_code
    LEFT JOIN supplies s ON t.item_code = s.item_code
    WHERE t.trans_type = '사용'
  `;
  const params: any[] = [];
  
  if (start_date) {
    query += ' AND t.trans_date >= ?';
    params.push(start_date);
  }
  if (end_date) {
    query += ' AND t.trans_date <= ?';
    params.push(end_date);
  }
  
  query += ' GROUP BY t.item_code ORDER BY total_usage DESC';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// 사용량 단일 등록 (FEFO 방식으로 LOT 차감 + transactions 저장)
// 최적화: Atomic Transaction + MAX(0,...) + 재고 부족 방어
usageRoutes.post('/single', async (c) => {
  const body = await c.req.json();
  const { item_code, quantity, usage_date, purpose, memo } = body;
  
  if (!item_code || !quantity || quantity <= 0) {
    return c.json({ success: false, error: '품목코드와 수량을 입력해주세요.' }, 400);
  }
  
  const date = usage_date || new Date().toISOString().split('T')[0];
  
  try {
    // 1. FEFO 쿼리로 사용 가능한 LOT 조회 (소비기한 빠른 순)
    const lots = await c.env.DB.prepare(FEFO_QUERY.INBOUND).bind(item_code, date).all<{
      id: number;
      lot_number: string;
      item_code: string;
      remain_qty: number;
      inbound_date: string;
      expiry_date: string;
    }>();
    
    if (!lots.results || lots.results.length === 0) {
      return c.json({ 
        success: false, 
        error: '사용 가능한 LOT가 없습니다.',
        errorCode: 'NO_LOT_AVAILABLE'
      }, 400);
    }
    
    // 2. 재고 검증 (방어 코드)
    const totalAvailable = lots.results.reduce((sum, lot) => sum + lot.remain_qty, 0);
    if (totalAvailable < quantity) {
      return c.json({ 
        success: false, 
        error: `재고 부족: 요청 ${quantity}, 가용 ${totalAvailable.toFixed(2)} (부족: ${(quantity - totalAvailable).toFixed(2)})`,
        errorCode: 'INSUFFICIENT_STOCK',
        details: { required: quantity, available: totalAvailable, shortage: quantity - totalAvailable }
      }, 400);
    }
    
    // 3. Atomic Transaction 준비 (FEFO 차감)
    const batchStatements: D1PreparedStatement[] = [];
    let remainingQty = quantity;
    const usedLots: any[] = [];
    
    for (const lot of lots.results) {
      if (remainingQty <= 0) break;
      
      const useQty = Math.min(remainingQty, lot.remain_qty);
      const newRemainQty = lot.remain_qty - useQty;
      
      // LOT 잔량 업데이트 (MAX(0,...) 적용)
      batchStatements.push(
        c.env.DB.prepare(`
          UPDATE inbound SET remain_qty = MAX(0, remain_qty - ?), updated_at = CURRENT_TIMESTAMP 
          WHERE id = ? AND remain_qty >= ?
        `).bind(useQty, lot.id, useQty)
      );
      
      // transactions 테이블에 사용 기록
      batchStatements.push(
        c.env.DB.prepare(`
          INSERT INTO transactions (trans_date, trans_type, item_code, lot_number, quantity, remain_qty, memo)
          VALUES (?, '사용', ?, ?, ?, ?, ?)
        `).bind(date, item_code, lot.lot_number, -useQty, newRemainQty, memo || purpose || null)
      );
      
      usedLots.push({ lot_number: lot.lot_number, used_qty: useQty, expiry_date: lot.expiry_date });
      remainingQty -= useQty;
    }
    
    // 4. master 또는 supplies 테이블 current_stock 업데이트 (MAX(0,...) 적용)
    const masterItem = await c.env.DB.prepare(
      'SELECT item_code FROM master WHERE item_code = ?'
    ).bind(item_code).first();
    
    if (masterItem) {
      batchStatements.push(
        c.env.DB.prepare(`
          UPDATE master SET current_stock = MAX(0, current_stock - ?), updated_at = CURRENT_TIMESTAMP 
          WHERE item_code = ?
        `).bind(quantity, item_code)
      );
    } else {
      batchStatements.push(
        c.env.DB.prepare(`
          UPDATE supplies SET current_stock = MAX(0, current_stock - ?), updated_at = CURRENT_TIMESTAMP 
          WHERE item_code = ?
        `).bind(quantity, item_code)
      );
    }
    
    // 5. Atomic 실행: batch()로 모든 작업 한 번에
    await c.env.DB.batch(batchStatements);
    
    return c.json({ 
      success: true, 
      message: `${quantity} 사용 등록 완료 (FEFO 적용)`,
      used_lots: usedLots
    });
    
  } catch (error: any) {
    console.error('Usage registration error:', error);
    return c.json({ success: false, error: error.message, errorCode: 'DB_ERROR' }, 500);
  }
});

// 사용량 일괄 등록 (FEFO 방식으로 LOT 차감 + transactions 저장)
// 최적화: Atomic Transaction + MAX(0,...) + 재고 부족 방어
usageRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const { items, usage_date, purpose, strict_mode } = body;
  // strict_mode: true면 하나라도 재고 부족 시 전체 작업 중단
  
  if (!items || items.length === 0) {
    return c.json({ success: false, error: '사용 내역을 입력해주세요.' }, 400);
  }
  
  const date = usage_date || new Date().toISOString().split('T')[0];
  const results: any[] = [];
  const batchStatements: D1PreparedStatement[] = [];
  const successItems: any[] = [];
  const failedItems: any[] = [];
  
  // 1단계: 모든 품목의 재고 검증 및 차감 준비
  for (const item of items) {
    if (!item.quantity || item.quantity <= 0) {
      continue;
    }
    
    try {
      // FEFO 쿼리로 LOT 조회
      const lots = await c.env.DB.prepare(FEFO_QUERY.INBOUND).bind(item.item_code, date).all<{
        id: number;
        lot_number: string;
        item_code: string;
        remain_qty: number;
        expiry_date: string;
      }>();
      
      if (!lots.results || lots.results.length === 0) {
        failedItems.push({ item_code: item.item_code, error: 'LOT 없음', errorCode: 'NO_LOT_AVAILABLE' });
        if (strict_mode) break;
        continue;
      }
      
      // 재고 검증
      const totalAvailable = lots.results.reduce((sum, lot) => sum + lot.remain_qty, 0);
      if (totalAvailable < item.quantity) {
        failedItems.push({ 
          item_code: item.item_code, 
          error: `재고 부족 (요청: ${item.quantity}, 가용: ${totalAvailable.toFixed(2)})`,
          errorCode: 'INSUFFICIENT_STOCK',
          shortage: item.quantity - totalAvailable
        });
        if (strict_mode) break;
        continue;
      }
      
      // FEFO 차감 statements 준비
      let remainingQty = item.quantity;
      const usedLots: any[] = [];
      
      for (const lot of lots.results) {
        if (remainingQty <= 0) break;
        
        const useQty = Math.min(remainingQty, lot.remain_qty);
        const newRemainQty = lot.remain_qty - useQty;
        
        batchStatements.push(
          c.env.DB.prepare(`
            UPDATE inbound SET remain_qty = MAX(0, remain_qty - ?), updated_at = CURRENT_TIMESTAMP 
            WHERE id = ? AND remain_qty >= ?
          `).bind(useQty, lot.id, useQty)
        );
        
        batchStatements.push(
          c.env.DB.prepare(`
            INSERT INTO transactions (trans_date, trans_type, item_code, lot_number, quantity, remain_qty, memo)
            VALUES (?, '사용', ?, ?, ?, ?, ?)
          `).bind(date, item.item_code, lot.lot_number, -useQty, newRemainQty, item.memo || purpose || null)
        );
        
        usedLots.push({ lot_number: lot.lot_number, used_qty: useQty, expiry_date: lot.expiry_date });
        remainingQty -= useQty;
      }
      
      // master/supplies 재고 차감 준비
      const masterItem = await c.env.DB.prepare(
        'SELECT item_code FROM master WHERE item_code = ?'
      ).bind(item.item_code).first();
      
      if (masterItem) {
        batchStatements.push(
          c.env.DB.prepare(`
            UPDATE master SET current_stock = MAX(0, current_stock - ?), updated_at = CURRENT_TIMESTAMP 
            WHERE item_code = ?
          `).bind(item.quantity, item.item_code)
        );
      } else {
        batchStatements.push(
          c.env.DB.prepare(`
            UPDATE supplies SET current_stock = MAX(0, current_stock - ?), updated_at = CURRENT_TIMESTAMP 
            WHERE item_code = ?
          `).bind(item.quantity, item.item_code)
        );
      }
      
      successItems.push({ 
        item_code: item.item_code, 
        quantity: item.quantity,
        used_lots: usedLots 
      });
      
    } catch (error: any) {
      failedItems.push({ item_code: item.item_code, error: error.message, errorCode: 'DB_ERROR' });
      if (strict_mode) break;
    }
  }
  
  // strict_mode에서 실패 항목이 있으면 전체 작업 중단
  if (strict_mode && failedItems.length > 0) {
    return c.json({
      success: false,
      error: '재고 부족으로 전체 작업이 중단되었습니다.',
      errorCode: 'BATCH_ABORTED',
      failed_items: failedItems
    }, 400);
  }
  
  // 2단계: Atomic 실행
  if (batchStatements.length > 0) {
    try {
      await c.env.DB.batch(batchStatements);
    } catch (error: any) {
      return c.json({
        success: false,
        error: 'DB 트랜잭션 실패: ' + error.message,
        errorCode: 'TRANSACTION_FAILED'
      }, 500);
    }
  }
  
  // 결과 정리
  for (const item of successItems) {
    results.push({ ...item, success: true });
  }
  for (const item of failedItems) {
    results.push({ ...item, success: false });
  }
  
  return c.json({ 
    success: successItems.length > 0, 
    message: `${successItems.length}개 품목 사용량 등록 완료 (FEFO 적용)`,
    summary: {
      total: items.length,
      success: successItems.length,
      failed: failedItems.length
    },
    results
  });
});

// 사용량 기록 삭제 (LOT 복원 + transactions 삭제)
// 최적화: Atomic Transaction
usageRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    // 1. 삭제할 트랜잭션 조회
    const trans = await c.env.DB.prepare(`
      SELECT item_code, lot_number, quantity FROM transactions WHERE id = ? AND trans_type = '사용'
    `).bind(id).first<{ item_code: string; lot_number: string; quantity: number }>();
    
    if (!trans) {
      return c.json({ success: false, error: '해당 사용 기록을 찾을 수 없습니다.', errorCode: 'NOT_FOUND' }, 404);
    }
    
    const restoreQty = Math.abs(trans.quantity);
    
    // 2. Atomic Transaction 준비
    const batchStatements: D1PreparedStatement[] = [];
    
    // LOT 잔량 복원
    batchStatements.push(
      c.env.DB.prepare(`
        UPDATE inbound SET remain_qty = remain_qty + ?, updated_at = CURRENT_TIMESTAMP 
        WHERE lot_number = ?
      `).bind(restoreQty, trans.lot_number)
    );
    
    // master/supplies current_stock 복원
    const masterItem = await c.env.DB.prepare(
      'SELECT item_code FROM master WHERE item_code = ?'
    ).bind(trans.item_code).first();
    
    if (masterItem) {
      batchStatements.push(
        c.env.DB.prepare(`
          UPDATE master SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP 
          WHERE item_code = ?
        `).bind(restoreQty, trans.item_code)
      );
    } else {
      batchStatements.push(
        c.env.DB.prepare(`
          UPDATE supplies SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP 
          WHERE item_code = ?
        `).bind(restoreQty, trans.item_code)
      );
    }
    
    // transactions 삭제
    batchStatements.push(
      c.env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(id)
    );
    
    // 3. Atomic 실행
    await c.env.DB.batch(batchStatements);
    
    return c.json({ 
      success: true, 
      message: '사용 기록이 삭제되고 재고가 복원되었습니다.',
      restored: { item_code: trans.item_code, lot_number: trans.lot_number, quantity: restoreQty }
    });
    
  } catch (error: any) {
    console.error('Usage delete error:', error);
    return c.json({ success: false, error: error.message, errorCode: 'DB_ERROR' }, 500);
  }
});

export default usageRoutes;
