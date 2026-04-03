// 재고 관리 API (제품 재고 간편 등록 포함)
import { Hono } from 'hono';
import type { Bindings, StockAdjustmentRequest } from '../types';

const stockRoutes = new Hono<{ Bindings: Bindings }>();

// 현재 재고 현황 (원료, 제품, 부자재 통합)
stockRoutes.get('/current', async (c) => {
  const category = c.req.query('category');
  
  // master 테이블 (원료, 제품)
  let masterQuery = `
    SELECT m.item_code, m.item_name, m.category, m.unit, m.current_stock, m.safety_stock,
           CASE WHEN m.current_stock < m.safety_stock THEN 1 ELSE 0 END as is_low_stock,
           m.expiry_days, m.created_at, m.updated_at
    FROM master m
  `;
  
  // supplies 테이블 (부자재)
  let suppliesQuery = `
    SELECT s.item_code, s.item_name, '부자재' as category, s.unit, s.current_stock, 0 as safety_stock,
           0 as is_low_stock,
           NULL as expiry_days, s.created_at, s.updated_at
    FROM supplies s
  `;
  
  const params: any[] = [];
  
  if (category && category !== '전체') {
    if (category === '부자재') {
      // 부자재만
      suppliesQuery += " WHERE 1=1";
      const result = await c.env.DB.prepare(suppliesQuery).all();
      return c.json({ success: true, data: result.results });
    } else {
      // 원료 또는 제품만
      masterQuery += ' WHERE m.category = ?';
      params.push(category);
      masterQuery += ' ORDER BY m.category, m.item_name';
      const result = await c.env.DB.prepare(masterQuery).bind(...params).all();
      return c.json({ success: true, data: result.results });
    }
  }
  
  // 전체 조회 - UNION ALL
  const unionQuery = `
    ${masterQuery}
    UNION ALL
    ${suppliesQuery}
    ORDER BY category, item_name
  `;
  
  const result = await c.env.DB.prepare(unionQuery).all();
  return c.json({ success: true, data: result.results });
});

// 안전재고 미만 품목
stockRoutes.get('/low-stock', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT m.*,
           (m.safety_stock - m.current_stock) as shortage
    FROM master m
    WHERE m.current_stock < m.safety_stock
    ORDER BY m.category, shortage DESC
  `).all();
  
  return c.json({ success: true, data: result.results });
});

// 제품 재고 간편 등록 (재고 실사/초기등록/조정용)
stockRoutes.post('/quick-register', async (c) => {
  const body = await c.req.json<StockAdjustmentRequest>();
  const { items, adjustment_date } = body;
  
  if (!items || items.length === 0) {
    return c.json({ success: false, error: '재고 정보를 입력해주세요.' }, 400);
  }
  
  const results: any[] = [];
  const errors: string[] = [];
  
  for (const item of items) {
    if (item.new_stock < 0) {
      errors.push(`${item.item_code}: 재고는 0 이상이어야 합니다.`);
      continue;
    }
    
    // 제품인지 확인
    const master = await c.env.DB.prepare(
      'SELECT * FROM master WHERE item_code = ?'
    ).bind(item.item_code).first<{ item_code: string; current_stock: number; category: string }>();
    
    if (!master) {
      errors.push(`${item.item_code}: 존재하지 않는 품목입니다.`);
      continue;
    }
    
    const diff = item.new_stock - master.current_stock;
    
    if (diff === 0) {
      continue; // 변동 없으면 스킵
    }
    
    // Master 재고 업데이트
    await c.env.DB.prepare(`
      UPDATE master SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE item_code = ?
    `).bind(item.new_stock, item.item_code).run();
    
    // 재고 조정 LOT 생성 (양수인 경우 - 재고 증가)
    let lot_number = null;
    if (diff > 0) {
      const dateStr = adjustment_date.replace(/-/g, '');
      lot_number = `${dateStr}-${item.item_code}-ADJ`;
      
      // 기존 조정 LOT이 있으면 수량 추가, 없으면 새로 생성
      const existingLot = await c.env.DB.prepare(
        'SELECT * FROM inbound WHERE lot_number = ?'
      ).bind(lot_number).first();
      
      if (existingLot) {
        await c.env.DB.prepare(`
          UPDATE inbound SET origin_qty = origin_qty + ?, remain_qty = remain_qty + ?, updated_at = CURRENT_TIMESTAMP 
          WHERE lot_number = ?
        `).bind(diff, diff, lot_number).run();
      } else {
        // 유통기한 계산 (품목의 기본 유통기한 사용)
        const masterDetail = await c.env.DB.prepare(
          'SELECT expiry_days FROM master WHERE item_code = ?'
        ).bind(item.item_code).first<{ expiry_days: number }>();
        
        const expiryDays = masterDetail?.expiry_days || 365;
        const expiryDate = new Date(adjustment_date);
        expiryDate.setDate(expiryDate.getDate() + expiryDays);
        
        await c.env.DB.prepare(`
          INSERT INTO inbound (lot_number, item_code, inbound_date, expiry_date, origin_qty, remain_qty, quality_status)
          VALUES (?, ?, ?, ?, ?, ?, '합격')
        `).bind(
          lot_number, 
          item.item_code, 
          adjustment_date, 
          expiryDate.toISOString().split('T')[0],
          diff, 
          diff
        ).run();
      }
    }
    
    // Transaction 기록
    await c.env.DB.prepare(`
      INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, remain_qty, memo)
      VALUES (?, ?, '재고조정', ?, ?, ?, ?)
    `).bind(
      adjustment_date, 
      item.item_code, 
      diff, 
      lot_number, 
      item.new_stock,
      diff > 0 ? '재고 실사 증가' : '재고 실사 감소'
    ).run();
    
    results.push({
      item_code: item.item_code,
      previous_stock: master.current_stock,
      new_stock: item.new_stock,
      adjustment: diff
    });
  }
  
  if (errors.length > 0 && results.length === 0) {
    return c.json({ success: false, error: errors.join('\n') }, 400);
  }
  
  return c.json({ 
    success: true, 
    message: `${results.length}개 품목의 재고가 조정되었습니다.`,
    data: results,
    warnings: errors.length > 0 ? errors : undefined
  });
});

// 품목별 재고 집계
stockRoutes.get('/summary', async (c) => {
  const category = c.req.query('category');
  
  let baseQuery = `
    SELECT 
      m.item_code,
      m.item_name,
      m.category,
      m.unit,
      m.current_stock,
      m.safety_stock,
      COALESCE(SUM(CASE WHEN t.trans_type = '입고' THEN t.quantity ELSE 0 END), 0) as total_inbound,
      COALESCE(SUM(CASE WHEN t.trans_type = '사용' THEN ABS(t.quantity) ELSE 0 END), 0) as total_usage,
      COALESCE(SUM(CASE WHEN t.trans_type = '출고' THEN ABS(t.quantity) ELSE 0 END), 0) as total_outbound,
      COALESCE(SUM(CASE WHEN t.trans_type = '재고조정' THEN t.quantity ELSE 0 END), 0) as total_adjustment
    FROM master m
    LEFT JOIN transactions t ON m.item_code = t.item_code
  `;
  const params: any[] = [];
  
  if (category) {
    baseQuery += ' WHERE m.category = ?';
    params.push(category);
  }
  
  baseQuery += ' GROUP BY m.item_code ORDER BY m.category, m.item_name';
  
  const result = await c.env.DB.prepare(baseQuery).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// 재고 수동 조정
stockRoutes.post('/adjust', async (c) => {
  const body = await c.req.json();
  const { item_code, adjustment, reason, new_quantity } = body;
  
  if (!item_code || new_quantity === undefined) {
    return c.json({ success: false, error: '품목코드와 변경할 재고량이 필요합니다' }, 400);
  }
  
  if (!reason) {
    return c.json({ success: false, error: '사유가 필요합니다' }, 400);
  }
  
  try {
    // 현재 재고 조회
    const current = await c.env.DB.prepare(`
      SELECT current_stock FROM master WHERE item_code = ?
    `).bind(item_code).first() as { current_stock: number } | null;
    
    const oldQty = current?.current_stock || 0;
    const diff = new_quantity - oldQty;
    
    // 재고 업데이트
    await c.env.DB.prepare(`
      UPDATE master SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE item_code = ?
    `).bind(new_quantity, item_code).run();
    
    // 트랜잭션 기록 (조정)
    await c.env.DB.prepare(`
      INSERT INTO transactions (item_code, transaction_type, quantity, lot_number, notes, transaction_date)
      VALUES (?, '조정', ?, ?, ?, datetime('now', '+9 hours'))
    `).bind(item_code, diff, 'ADJUST-' + Date.now(), `재고조정: ${reason} (${oldQty} → ${new_quantity})`).run();
    
    // 로그 기록
    await c.env.DB.prepare(`
      INSERT INTO admin_logs (action_type, target_table, reason)
      VALUES (?, ?, ?)
    `).bind('재고조정', 'master', `${item_code}: ${oldQty} → ${new_quantity} (${reason})`).run();
    
    return c.json({ 
      success: true, 
      message: '재고가 조정되었습니다',
      old_quantity: oldQty,
      new_quantity: new_quantity,
      adjustment: diff
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 재고 재계산
stockRoutes.post('/recalculate', async (c) => {
  try {
    // 모든 품목의 재고를 트랜잭션 기반으로 재계산
    const items = await c.env.DB.prepare(`
      SELECT item_code FROM master
    `).all();
    
    let updated = 0;
    for (const item of items.results as any[]) {
      const code = item.item_code;
      
      // 트랜잭션 합계 계산
      const result = await c.env.DB.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN transaction_type = '입고' THEN quantity ELSE 0 END), 0) as total_in,
          COALESCE(SUM(CASE WHEN transaction_type = '사용' THEN quantity ELSE 0 END), 0) as total_usage,
          COALESCE(SUM(CASE WHEN transaction_type = '출고' THEN quantity ELSE 0 END), 0) as total_out,
          COALESCE(SUM(CASE WHEN transaction_type = '조정' THEN quantity ELSE 0 END), 0) as total_adjust
        FROM transactions WHERE item_code = ?
      `).bind(code).first() as { total_in: number, total_usage: number, total_out: number, total_adjust: number };
      
      const calculatedStock = (result.total_in || 0) - (result.total_usage || 0) - (result.total_out || 0) + (result.total_adjust || 0);
      
      await c.env.DB.prepare(`
        UPDATE master SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE item_code = ?
      `).bind(calculatedStock, code).run();
      
      updated++;
    }
    
    return c.json({ 
      success: true, 
      message: `${updated}개 품목의 재고가 재계산되었습니다`,
      updated: updated
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default stockRoutes;
