// 사용량 입력 API (원료 전용, FEFO 자동 적용)
import { Hono } from 'hono';
import type { Bindings, UsageRequest, Inbound } from '../types';

const usageRoutes = new Hono<{ Bindings: Bindings }>();

// FEFO 방식으로 LOT에서 차감 처리 (LOT가 없으면 마스터 재고에서 직접 차감)
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
  
  // LOT가 없는 경우 마스터 재고에서 직접 차감
  if (!lots.results || lots.results.length === 0) {
    // 마스터 재고 확인
    const master = await db.prepare(
      'SELECT current_stock FROM master WHERE item_code = ?'
    ).bind(item_code).first<{ current_stock: number }>();
    
    if (!master || master.current_stock < quantity) {
      return { success: false, error: `${item_code}: 재고 부족 (가용: ${master?.current_stock || 0}, 요청: ${quantity})` };
    }
    
    // 마스터 재고에서 직접 차감 (LOT 없이)
    await db.prepare(`
      UPDATE master SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP WHERE item_code = ?
    `).bind(quantity, item_code).run();
    
    // Transaction 기록 (LOT 없음)
    await db.prepare(`
      INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, remain_qty)
      VALUES (?, ?, '사용', ?, NULL, NULL)
    `).bind(trans_date, item_code, -quantity).run();
    
    return { 
      success: true, 
      deductions: [{ lot_number: '재고조정분', deducted: quantity, remain_qty: master.current_stock - quantity }] 
    };
  }
  
  // 총 가용 재고 확인 (LOT + 마스터 조정분)
  const totalLotAvailable = lots.results.reduce((sum, lot) => sum + lot.remain_qty, 0);
  
  // 마스터 현재고 확인 (LOT 잔량과의 차이가 조정분)
  const master = await db.prepare(
    'SELECT current_stock FROM master WHERE item_code = ?'
  ).bind(item_code).first<{ current_stock: number }>();
  
  const adjustedStock = (master?.current_stock || 0) - totalLotAvailable;
  const totalAvailable = totalLotAvailable + Math.max(0, adjustedStock);
  
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
  
  // LOT로 다 못 빼면 조정분에서 차감
  if (remaining > 0 && adjustedStock > 0) {
    const adjustDeduct = Math.min(remaining, adjustedStock);
    
    await db.prepare(`
      INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, remain_qty)
      VALUES (?, ?, '사용', ?, NULL, NULL)
    `).bind(trans_date, item_code, -adjustDeduct).run();
    
    deductions.push({
      lot_number: '재고조정분',
      deducted: adjustDeduct,
      remain_qty: adjustedStock - adjustDeduct
    });
    
    remaining -= adjustDeduct;
  }
  
  // Master 재고 감소
  await db.prepare(`
    UPDATE master SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP WHERE item_code = ?
  `).bind(quantity, item_code).run();
  
  return { success: true, deductions };
}

// 오늘 사용 가능한 원료 목록 (입고 LOT 또는 현재고가 있는 것)
usageRoutes.get('/available', async (c) => {
  // LOT 잔량이 있는 원료 (FEFO 사용 가능)
  const lotResult = await c.env.DB.prepare(`
    SELECT m.item_code, m.item_name, m.category, m.unit, m.safety_stock, m.expiry_days,
           m.created_at, m.updated_at,
           SUM(i.remain_qty) as available_qty,
           COUNT(DISTINCT i.lot_number) as lot_count,
           'lot' as stock_type
    FROM master m
    INNER JOIN inbound i ON m.item_code = i.item_code AND i.remain_qty > 0 AND i.quality_status = '합격'
    WHERE m.category = '원료'
    GROUP BY m.item_code
    HAVING available_qty > 0
  `).all();
  
  // LOT가 없지만 현재고가 있는 원료 (재고조정된 것)
  const lotItemCodes = (lotResult.results as any[]).map(r => r.item_code);
  
  const stockResult = await c.env.DB.prepare(`
    SELECT item_code, item_name, category, unit, safety_stock, expiry_days,
           current_stock as available_qty,
           0 as lot_count,
           'stock' as stock_type,
           created_at, updated_at
    FROM master
    WHERE category = '원료' AND current_stock > 0
  `).all();
  
  // LOT가 없는 것만 필터 (중복 제외)
  const stockOnly = (stockResult.results as any[]).filter(
    r => !lotItemCodes.includes(r.item_code)
  );
  
  // 합쳐서 이름순 정렬
  const combined = [...(lotResult.results as any[]), ...stockOnly].sort(
    (a, b) => a.item_name.localeCompare(b.item_name)
  );
  
  return c.json({ success: true, data: combined });
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
