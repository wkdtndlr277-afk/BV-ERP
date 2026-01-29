// 출고 관리 API (원료·제품 공통, FEFO 자동 적용)
import { Hono } from 'hono';
import type { Bindings, OutboundRequest, Inbound } from '../types';

const outboundRoutes = new Hono<{ Bindings: Bindings }>();

// FEFO 방식으로 LOT에서 출고 차감 처리
async function deductForOutbound(
  db: D1Database,
  item_code: string,
  quantity: number,
  trans_date: string,
  supplier: string | null
): Promise<{ success: boolean; error?: string; deductions?: any[] }> {
  // 해당 품목의 잔량이 있는 LOT를 FEFO(유통기한 빠른 순)로 조회
  const lots = await db.prepare(`
    SELECT * FROM inbound 
    WHERE item_code = ? AND remain_qty > 0 AND quality_status = '합격'
    ORDER BY expiry_date ASC, inbound_date ASC
  `).bind(item_code).all<Inbound>();
  
  // LOT이 없으면 마스터 재고에서 직접 차감 (제품 재고 실사 등록 케이스)
  if (!lots.results || lots.results.length === 0) {
    const master = await db.prepare(
      'SELECT current_stock FROM master WHERE item_code = ?'
    ).bind(item_code).first<{ current_stock: number }>();
    
    if (!master || master.current_stock < quantity) {
      return { success: false, error: `${item_code}: 재고 부족` };
    }
    
    // Master 재고 감소
    await db.prepare(`
      UPDATE master SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP WHERE item_code = ?
    `).bind(quantity, item_code).run();
    
    // Transaction 기록 (LOT 없이)
    await db.prepare(`
      INSERT INTO transactions (trans_date, item_code, trans_type, quantity, supplier)
      VALUES (?, ?, '출고', ?, ?)
    `).bind(trans_date, item_code, -quantity, supplier).run();
    
    return { success: true, deductions: [{ lot_number: null, deducted: quantity }] };
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
      INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, remain_qty, supplier)
      VALUES (?, ?, '출고', ?, ?, ?, ?)
    `).bind(trans_date, item_code, -deductQty, lot.lot_number, newRemainQty, supplier).run();
    
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

// 출고 가능한 품목 목록
outboundRoutes.get('/available', async (c) => {
  const category = c.req.query('category');
  
  let query = `
    SELECT m.*, 
           COALESCE(SUM(CASE WHEN i.remain_qty > 0 AND i.quality_status = '합격' THEN i.remain_qty ELSE 0 END), m.current_stock) as available_qty
    FROM master m
    LEFT JOIN inbound i ON m.item_code = i.item_code
  `;
  const params: any[] = [];
  
  if (category) {
    query += ' WHERE m.category = ?';
    params.push(category);
  }
  
  query += ' GROUP BY m.item_code ORDER BY m.category, m.item_name';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// 오늘 출고 내역 조회
outboundRoutes.get('/today', async (c) => {
  const today = new Date().toISOString().split('T')[0];
  
  const result = await c.env.DB.prepare(`
    SELECT t.item_code, m.item_name, m.category, m.unit, 
           SUM(ABS(t.quantity)) as total_outbound,
           t.supplier
    FROM transactions t
    JOIN master m ON t.item_code = m.item_code
    WHERE t.trans_date = ? AND t.trans_type = '출고'
    GROUP BY t.item_code, t.supplier
    ORDER BY m.category, m.item_name
  `).bind(today).all();
  
  return c.json({ success: true, data: result.results });
});

// 기간별 출고 내역 조회
outboundRoutes.get('/history', async (c) => {
  const start_date = c.req.query('start_date');
  const end_date = c.req.query('end_date');
  const item_code = c.req.query('item_code');
  const category = c.req.query('category');
  
  let query = `
    SELECT t.*, m.item_name, m.category, m.unit
    FROM transactions t
    JOIN master m ON t.item_code = m.item_code
    WHERE t.trans_type = '출고'
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
  if (category) {
    query += ' AND m.category = ?';
    params.push(category);
  }
  
  query += ' ORDER BY t.trans_date DESC, t.id DESC';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// 출고 등록
outboundRoutes.post('/', async (c) => {
  const body = await c.req.json<OutboundRequest>();
  const { item_code, quantity, outbound_date, supplier } = body;
  
  if (!item_code || !quantity || quantity <= 0) {
    return c.json({ success: false, error: '품목과 수량을 올바르게 입력해주세요.' }, 400);
  }
  
  // 품목 확인
  const master = await c.env.DB.prepare(
    'SELECT * FROM master WHERE item_code = ?'
  ).bind(item_code).first();
  
  if (!master) {
    return c.json({ success: false, error: '등록되지 않은 품목입니다.' }, 404);
  }
  
  // FEFO 방식으로 출고 차감
  const result = await deductForOutbound(c.env.DB, item_code, quantity, outbound_date, supplier || null);
  
  if (!result.success) {
    return c.json({ success: false, error: result.error }, 400);
  }
  
  return c.json({ 
    success: true, 
    message: '출고가 등록되었습니다.',
    data: { deductions: result.deductions }
  });
});

export default outboundRoutes;
