// 사용량 입력 API (원료 전용, FEFO 자동 적용)
import { Hono } from 'hono';
import type { Bindings, UsageRequest, Inbound } from '../types';

const usageRoutes = new Hono<{ Bindings: Bindings }>();

// FEFO 방식으로 LOT에서 차감 처리
async function deductFromLots(
  db: D1Database,
  item_code: string,
  quantity: number,
  trans_date: string
): Promise<{ success: boolean; error?: string; deductions?: any[] }> {
  // 해당 품목의 잔량이 있는 LOT를 FEFO(유통기한 빠른 순)로 조회
  const lots = await db.prepare(`
    SELECT * FROM inbound 
    WHERE item_code = ? AND remain_qty > 0 AND quality_status = '합격'
    ORDER BY expiry_date ASC, inbound_date ASC
  `).bind(item_code).all<Inbound>();
  
  if (!lots.results || lots.results.length === 0) {
    return { success: false, error: `${item_code}: 사용 가능한 재고가 없습니다.` };
  }
  
  // 총 가용 재고 확인
  const totalAvailable = lots.results.reduce((sum, lot) => sum + lot.remain_qty, 0);
  if (totalAvailable < quantity) {
    return { success: false, error: `${item_code}: 재고 부족 (가용: ${totalAvailable}, 요청: ${quantity})` };
  }
  
  // FEFO 방식으로 차감
  let remaining = quantity;
  const deductions: any[] = [];
  
  for (const lot of lots.results) {
    if (remaining <= 0) break;
    
    const deductQty = Math.min(lot.remain_qty, remaining);
    const newRemainQty = lot.remain_qty - deductQty;
    
    // LOT 잔량 업데이트
    await db.prepare(`
      UPDATE inbound SET remain_qty = ?, updated_at = CURRENT_TIMESTAMP WHERE lot_number = ?
    `).bind(newRemainQty, lot.lot_number).run();
    
    // Transaction 기록
    await db.prepare(`
      INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, remain_qty)
      VALUES (?, ?, '사용', ?, ?, ?)
    `).bind(trans_date, item_code, -deductQty, lot.lot_number, newRemainQty).run();
    
    deductions.push({
      lot_number: lot.lot_number,
      deducted: deductQty,
      remain_qty: newRemainQty
    });
    
    remaining -= deductQty;
  }
  
  // Master 재고 감소
  await db.prepare(`
    UPDATE master SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP WHERE item_code = ?
  `).bind(quantity, item_code).run();
  
  return { success: true, deductions };
}

// 오늘 사용 가능한 원료 목록 (잔량 있는 것)
usageRoutes.get('/available', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT m.*, 
           COALESCE(SUM(i.remain_qty), 0) as available_qty,
           COUNT(DISTINCT i.lot_number) as lot_count
    FROM master m
    LEFT JOIN inbound i ON m.item_code = i.item_code AND i.remain_qty > 0 AND i.quality_status = '합격'
    WHERE m.category = '원료'
    GROUP BY m.item_code
    ORDER BY m.item_name
  `).all();
  
  return c.json({ success: true, data: result.results });
});

// 오늘 사용량 조회
usageRoutes.get('/today', async (c) => {
  const today = new Date().toISOString().split('T')[0];
  
  const result = await c.env.DB.prepare(`
    SELECT t.item_code, m.item_name, m.unit, SUM(ABS(t.quantity)) as total_usage
    FROM transactions t
    JOIN master m ON t.item_code = m.item_code
    WHERE t.trans_date = ? AND t.trans_type = '사용'
    GROUP BY t.item_code
    ORDER BY m.item_name
  `).bind(today).all();
  
  return c.json({ success: true, data: result.results });
});

// 기간별 사용량 조회
usageRoutes.get('/history', async (c) => {
  const start_date = c.req.query('start_date');
  const end_date = c.req.query('end_date');
  const item_code = c.req.query('item_code');
  
  let query = `
    SELECT t.*, m.item_name, m.unit
    FROM transactions t
    JOIN master m ON t.item_code = m.item_code
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

// 사용량 일괄 등록
usageRoutes.post('/', async (c) => {
  const body = await c.req.json<UsageRequest>();
  const { items, usage_date } = body;
  
  if (!items || items.length === 0) {
    return c.json({ success: false, error: '사용 내역을 입력해주세요.' }, 400);
  }
  
  const results: any[] = [];
  const errors: string[] = [];
  
  for (const item of items) {
    if (!item.quantity || item.quantity <= 0) {
      continue; // 수량이 없으면 스킵
    }
    
    // 원료인지 확인
    const master = await c.env.DB.prepare(
      'SELECT * FROM master WHERE item_code = ? AND category = ?'
    ).bind(item.item_code, '원료').first();
    
    if (!master) {
      errors.push(`${item.item_code}: 원료가 아니거나 존재하지 않는 품목입니다.`);
      continue;
    }
    
    // FEFO 방식으로 차감
    const result = await deductFromLots(c.env.DB, item.item_code, item.quantity, usage_date);
    
    if (result.success) {
      results.push({
        item_code: item.item_code,
        quantity: item.quantity,
        deductions: result.deductions
      });
    } else {
      errors.push(result.error!);
    }
  }
  
  if (errors.length > 0 && results.length === 0) {
    return c.json({ success: false, error: errors.join('\n') }, 400);
  }
  
  return c.json({ 
    success: true, 
    message: `${results.length}개 품목의 사용량이 등록되었습니다.`,
    data: results,
    warnings: errors.length > 0 ? errors : undefined
  });
});

export default usageRoutes;
