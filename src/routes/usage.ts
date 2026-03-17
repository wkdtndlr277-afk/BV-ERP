// 사용량 입력 API - 수불부에 반영됨
// transactions 테이블에 저장 + LOT 잔량 차감 (FIFO)
import { Hono } from 'hono';
import type { Bindings } from '../types';

const usageRoutes = new Hono<{ Bindings: Bindings }>();

// 사용 가능한 원료 목록 조회 (잔량 있는 것만)
usageRoutes.get('/available', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT m.item_code, m.item_name, m.category, m.unit, m.current_stock, m.safety_stock,
           COALESCE((SELECT SUM(i.remain_qty) FROM inbound i WHERE i.item_code = m.item_code AND i.quality_status = '합격' AND i.remain_qty > 0), 0) as available_qty
    FROM master m
    WHERE m.category IN ('원료', '부자재')
      AND m.current_stock > 0
    ORDER BY m.category, m.item_name
  `).all();
  
  return c.json({ success: true, data: result.results });
});

// 오늘 사용량 기록 조회 (transactions 테이블에서)
usageRoutes.get('/today', async (c) => {
  const today = new Date().toISOString().split('T')[0];
  
  const result = await c.env.DB.prepare(`
    SELECT t.id, t.trans_date as usage_date, t.item_code, t.lot_number, 
           ABS(t.quantity) as quantity, t.memo, t.created_at,
           m.item_name, m.unit
    FROM transactions t
    LEFT JOIN master m ON t.item_code = m.item_code
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
           m.item_name, m.unit
    FROM transactions t
    LEFT JOIN master m ON t.item_code = m.item_code
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
           m.item_name,
           m.unit,
           SUM(ABS(t.quantity)) as total_usage,
           COUNT(*) as record_count
    FROM transactions t
    LEFT JOIN master m ON t.item_code = m.item_code
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

// 사용량 단일 등록 (FIFO 방식으로 LOT 차감 + transactions 저장)
usageRoutes.post('/single', async (c) => {
  const body = await c.req.json();
  const { item_code, quantity, usage_date, purpose, memo } = body;
  
  if (!item_code || !quantity || quantity <= 0) {
    return c.json({ success: false, error: '품목코드와 수량을 입력해주세요.' }, 400);
  }
  
  const date = usage_date || new Date().toISOString().split('T')[0];
  
  try {
    // 1. 해당 품목의 사용 가능한 LOT 조회 (FIFO: 입고일순, 소비기한순)
    const lots = await c.env.DB.prepare(`
      SELECT id, lot_number, remain_qty, inbound_date, expiry_date
      FROM inbound
      WHERE item_code = ? AND quality_status = '합격' AND remain_qty > 0
      ORDER BY expiry_date ASC, inbound_date ASC, lot_number ASC
    `).bind(item_code).all();
    
    if (!lots.results || lots.results.length === 0) {
      return c.json({ success: false, error: '사용 가능한 LOT가 없습니다.' }, 400);
    }
    
    // 2. 총 가용 재고 확인
    const totalAvailable = lots.results.reduce((sum: number, lot: any) => sum + lot.remain_qty, 0);
    if (totalAvailable < quantity) {
      return c.json({ 
        success: false, 
        error: `재고가 부족합니다. (요청: ${quantity}, 가용: ${totalAvailable})` 
      }, 400);
    }
    
    // 3. FIFO 방식으로 LOT에서 차감
    let remainingQty = quantity;
    const usedLots: any[] = [];
    
    for (const lot of lots.results as any[]) {
      if (remainingQty <= 0) break;
      
      const useQty = Math.min(remainingQty, lot.remain_qty);
      const newRemainQty = lot.remain_qty - useQty;
      
      // LOT 잔량 업데이트
      await c.env.DB.prepare(`
        UPDATE inbound SET remain_qty = ? WHERE id = ?
      `).bind(newRemainQty, lot.id).run();
      
      // transactions 테이블에 사용 기록 저장
      await c.env.DB.prepare(`
        INSERT INTO transactions (trans_date, trans_type, item_code, lot_number, quantity, memo)
        VALUES (?, '사용', ?, ?, ?, ?)
      `).bind(date, item_code, lot.lot_number, -useQty, memo || purpose || null).run();
      
      usedLots.push({ lot_number: lot.lot_number, used_qty: useQty });
      remainingQty -= useQty;
    }
    
    // 4. master 테이블 current_stock 업데이트
    await c.env.DB.prepare(`
      UPDATE master SET current_stock = current_stock - ? WHERE item_code = ?
    `).bind(quantity, item_code).run();
    
    return c.json({ 
      success: true, 
      message: `${quantity} 사용 등록 완료`,
      used_lots: usedLots
    });
    
  } catch (error: any) {
    console.error('Usage registration error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 사용량 일괄 등록 (FIFO 방식으로 LOT 차감 + transactions 저장)
usageRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const { items, usage_date, purpose } = body;
  
  if (!items || items.length === 0) {
    return c.json({ success: false, error: '사용 내역을 입력해주세요.' }, 400);
  }
  
  const date = usage_date || new Date().toISOString().split('T')[0];
  let successCount = 0;
  const results: any[] = [];
  
  for (const item of items) {
    if (!item.quantity || item.quantity <= 0) {
      continue;
    }
    
    try {
      // 1. 해당 품목의 사용 가능한 LOT 조회 (FIFO)
      const lots = await c.env.DB.prepare(`
        SELECT id, lot_number, remain_qty, inbound_date, expiry_date
        FROM inbound
        WHERE item_code = ? AND quality_status = '합격' AND remain_qty > 0
        ORDER BY expiry_date ASC, inbound_date ASC, lot_number ASC
      `).bind(item.item_code).all();
      
      if (!lots.results || lots.results.length === 0) {
        results.push({ item_code: item.item_code, success: false, error: 'LOT 없음' });
        continue;
      }
      
      // 2. 총 가용 재고 확인
      const totalAvailable = lots.results.reduce((sum: number, lot: any) => sum + lot.remain_qty, 0);
      if (totalAvailable < item.quantity) {
        results.push({ 
          item_code: item.item_code, 
          success: false, 
          error: `재고 부족 (요청: ${item.quantity}, 가용: ${totalAvailable})` 
        });
        continue;
      }
      
      // 3. FIFO 방식으로 LOT에서 차감
      let remainingQty = item.quantity;
      const usedLots: any[] = [];
      
      for (const lot of lots.results as any[]) {
        if (remainingQty <= 0) break;
        
        const useQty = Math.min(remainingQty, lot.remain_qty);
        const newRemainQty = lot.remain_qty - useQty;
        
        // LOT 잔량 업데이트
        await c.env.DB.prepare(`
          UPDATE inbound SET remain_qty = ? WHERE id = ?
        `).bind(newRemainQty, lot.id).run();
        
        // transactions 테이블에 사용 기록 저장
        await c.env.DB.prepare(`
          INSERT INTO transactions (trans_date, trans_type, item_code, lot_number, quantity, memo)
          VALUES (?, '사용', ?, ?, ?, ?)
        `).bind(date, item.item_code, lot.lot_number, -useQty, item.memo || purpose || null).run();
        
        usedLots.push({ lot_number: lot.lot_number, used_qty: useQty });
        remainingQty -= useQty;
      }
      
      // 4. master 테이블 current_stock 업데이트
      await c.env.DB.prepare(`
        UPDATE master SET current_stock = current_stock - ? WHERE item_code = ?
      `).bind(item.quantity, item.item_code).run();
      
      successCount++;
      results.push({ 
        item_code: item.item_code, 
        success: true, 
        quantity: item.quantity,
        used_lots: usedLots 
      });
      
    } catch (error: any) {
      results.push({ item_code: item.item_code, success: false, error: error.message });
    }
  }
  
  return c.json({ 
    success: successCount > 0, 
    message: `${successCount}개 품목의 사용량이 등록되었습니다.`,
    results
  });
});

// 사용량 기록 삭제 (LOT 복원 + transactions 삭제)
usageRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    // 1. 삭제할 트랜잭션 조회
    const trans = await c.env.DB.prepare(`
      SELECT item_code, lot_number, quantity FROM transactions WHERE id = ? AND trans_type = '사용'
    `).bind(id).first<{ item_code: string; lot_number: string; quantity: number }>();
    
    if (!trans) {
      return c.json({ success: false, error: '해당 사용 기록을 찾을 수 없습니다.' }, 404);
    }
    
    const restoreQty = Math.abs(trans.quantity);
    
    // 2. LOT 잔량 복원
    await c.env.DB.prepare(`
      UPDATE inbound SET remain_qty = remain_qty + ? WHERE lot_number = ?
    `).bind(restoreQty, trans.lot_number).run();
    
    // 3. master current_stock 복원
    await c.env.DB.prepare(`
      UPDATE master SET current_stock = current_stock + ? WHERE item_code = ?
    `).bind(restoreQty, trans.item_code).run();
    
    // 4. transactions 삭제
    await c.env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run();
    
    return c.json({ success: true, message: '사용 기록이 삭제되고 재고가 복원되었습니다.' });
    
  } catch (error: any) {
    console.error('Usage delete error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default usageRoutes;
