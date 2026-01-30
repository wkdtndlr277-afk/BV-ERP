// 수불 이력 통합 검색 API
import { Hono } from 'hono';
import type { Bindings, TransactionSearchParams } from '../types';

const transactionRoutes = new Hono<{ Bindings: Bindings }>();

// 통합 검색 - 입고 정보 포함
transactionRoutes.get('/search', async (c) => {
  const start_date = c.req.query('start_date');
  const end_date = c.req.query('end_date');
  const item_code = c.req.query('item_code');
  const trans_type = c.req.query('trans_type');
  const lot_number = c.req.query('lot_number');
  const category = c.req.query('category');
  const search = c.req.query('search');  // 원료명/LOT 통합 검색
  
  // 입고 테이블을 LEFT JOIN하여 입고일자, 유통기한, 입고량, 잔량 포함
  let query = `
    SELECT 
      t.*,
      m.item_name,
      m.category,
      m.unit,
      i.inbound_date,
      i.expiry_date,
      i.origin_qty as inbound_qty,
      i.remain_qty as lot_remain_qty
    FROM transactions t
    JOIN master m ON t.item_code = m.item_code
    LEFT JOIN inbound i ON t.lot_number = i.lot_number
    WHERE 1=1
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
  if (trans_type && trans_type !== '전체') {
    query += ' AND t.trans_type = ?';
    params.push(trans_type);
  }
  if (lot_number) {
    query += ' AND t.lot_number LIKE ?';
    params.push(`%${lot_number}%`);
  }
  if (category) {
    query += ' AND m.category = ?';
    params.push(category);
  }
  // 원료명 또는 LOT 통합 검색
  if (search) {
    query += ' AND (m.item_name LIKE ? OR t.lot_number LIKE ? OR m.item_code LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  
  query += ' ORDER BY t.trans_date DESC, t.id DESC';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  
  // 상단 요약 계산
  let summaryQuery = `
    SELECT 
      COALESCE(SUM(CASE WHEN t.trans_type = '입고' THEN t.quantity ELSE 0 END), 0) as total_inbound,
      COALESCE(SUM(CASE WHEN t.trans_type = '사용' THEN ABS(t.quantity) ELSE 0 END), 0) as total_usage,
      COALESCE(SUM(CASE WHEN t.trans_type = '출고' THEN ABS(t.quantity) ELSE 0 END), 0) as total_outbound,
      COALESCE(SUM(CASE WHEN t.trans_type = '재고조정' THEN t.quantity ELSE 0 END), 0) as total_adjustment
    FROM transactions t
    JOIN master m ON t.item_code = m.item_code
    WHERE 1=1
  `;
  const summaryParams: any[] = [];
  
  if (start_date) {
    summaryQuery += ' AND t.trans_date >= ?';
    summaryParams.push(start_date);
  }
  if (end_date) {
    summaryQuery += ' AND t.trans_date <= ?';
    summaryParams.push(end_date);
  }
  if (item_code) {
    summaryQuery += ' AND t.item_code = ?';
    summaryParams.push(item_code);
  }
  if (trans_type && trans_type !== '전체') {
    summaryQuery += ' AND t.trans_type = ?';
    summaryParams.push(trans_type);
  }
  if (lot_number) {
    summaryQuery += ' AND t.lot_number LIKE ?';
    summaryParams.push(`%${lot_number}%`);
  }
  if (category) {
    summaryQuery += ' AND m.category = ?';
    summaryParams.push(category);
  }
  
  const summary = await c.env.DB.prepare(summaryQuery).bind(...summaryParams).first();
  
  return c.json({ 
    success: true, 
    data: result.results,
    summary: summary
  });
});

// LOT 이력 조회
transactionRoutes.get('/lot/:lot_number', async (c) => {
  const lot_number = c.req.param('lot_number');
  
  const lot = await c.env.DB.prepare(`
    SELECT i.*, m.item_name, m.category, m.unit 
    FROM inbound i 
    JOIN master m ON i.item_code = m.item_code
    WHERE i.lot_number = ?
  `).bind(lot_number).first();
  
  if (!lot) {
    return c.json({ success: false, error: 'LOT을 찾을 수 없습니다.' }, 404);
  }
  
  const history = await c.env.DB.prepare(`
    SELECT * FROM transactions 
    WHERE lot_number = ? 
    ORDER BY trans_date ASC, id ASC
  `).bind(lot_number).all();
  
  return c.json({ 
    success: true, 
    data: { 
      lot, 
      history: history.results 
    } 
  });
});

// 일별 수불부 (원료/제품)
transactionRoutes.get('/daily-report', async (c) => {
  const date = c.req.query('date') || new Date().toISOString().split('T')[0];
  const category = c.req.query('category');
  
  let query = `
    SELECT 
      ? as report_date,
      m.item_code,
      m.item_name,
      m.category,
      m.unit,
      m.current_stock,
      COALESCE(SUM(CASE WHEN t.trans_type = '입고' AND t.trans_date = ? THEN t.quantity ELSE 0 END), 0) as inbound,
      COALESCE(SUM(CASE WHEN t.trans_type = '사용' AND t.trans_date = ? THEN ABS(t.quantity) ELSE 0 END), 0) as usage,
      COALESCE(SUM(CASE WHEN t.trans_type = '출고' AND t.trans_date = ? THEN ABS(t.quantity) ELSE 0 END), 0) as outbound,
      COALESCE(SUM(CASE WHEN t.trans_type = '재고조정' AND t.trans_date = ? THEN t.quantity ELSE 0 END), 0) as adjustment
    FROM master m
    LEFT JOIN transactions t ON m.item_code = t.item_code
  `;
  const params: any[] = [date, date, date, date, date];
  
  if (category) {
    query += ' WHERE m.category = ?';
    params.push(category);
  }
  
  query += ' GROUP BY m.item_code ORDER BY m.category, m.item_name';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// 월별 수불부 (원료/제품) - 품목별 요약
transactionRoutes.get('/monthly-report', async (c) => {
  const year = c.req.query('year') || new Date().getFullYear().toString();
  const month = c.req.query('month') || String(new Date().getMonth() + 1).padStart(2, '0');
  const category = c.req.query('category');
  
  const startDate = `${year}-${month}-01`;
  const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];
  
  let query = `
    SELECT 
      m.item_code,
      m.item_name,
      m.category,
      m.unit,
      m.current_stock as closing_stock,
      COALESCE(SUM(CASE WHEN t.trans_type = '입고' AND t.trans_date >= ? AND t.trans_date <= ? THEN t.quantity ELSE 0 END), 0) as total_inbound,
      COALESCE(SUM(CASE WHEN t.trans_type = '사용' AND t.trans_date >= ? AND t.trans_date <= ? THEN ABS(t.quantity) ELSE 0 END), 0) as total_usage,
      COALESCE(SUM(CASE WHEN t.trans_type = '출고' AND t.trans_date >= ? AND t.trans_date <= ? THEN ABS(t.quantity) ELSE 0 END), 0) as total_outbound,
      COALESCE(SUM(CASE WHEN t.trans_type = '재고조정' AND t.trans_date >= ? AND t.trans_date <= ? THEN t.quantity ELSE 0 END), 0) as total_adjustment
    FROM master m
    LEFT JOIN transactions t ON m.item_code = t.item_code
  `;
  const params: any[] = [startDate, endDate, startDate, endDate, startDate, endDate, startDate, endDate];
  
  if (category) {
    query += ' WHERE m.category = ?';
    params.push(category);
  }
  
  query += ' GROUP BY m.item_code ORDER BY m.category, m.item_name';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  
  // 월초 재고 계산 (현재고 - 당월 변동)
  const dataWithOpening = result.results?.map((item: any) => {
    const netChange = item.total_inbound - item.total_usage - item.total_outbound + item.total_adjustment;
    return {
      ...item,
      opening_stock: item.closing_stock - netChange
    };
  });
  
  return c.json({ 
    success: true, 
    data: dataWithOpening,
    period: { year, month, startDate, endDate }
  });
});

// 월별 LOT별 수불부 (이월량 포함)
transactionRoutes.get('/monthly-lot-report', async (c) => {
  const year = c.req.query('year') || new Date().getFullYear().toString();
  const month = c.req.query('month') || String(new Date().getMonth() + 1).padStart(2, '0');
  const category = c.req.query('category');
  const item_code = c.req.query('item_code');
  const lot_number = c.req.query('lot_number');
  const search = c.req.query('search');  // 원료명/LOT 통합 검색
  
  const startDate = `${year}-${month}-01`;
  const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];
  
  // 1. 해당 월에 거래가 있거나, 해당 월 이전에 입고되어 잔량이 있는 LOT 조회
  let lotQuery = `
    SELECT DISTINCT 
      i.lot_number,
      i.item_code,
      m.item_name,
      m.category,
      m.unit,
      i.inbound_date,
      i.expiry_date,
      i.origin_qty,
      i.remain_qty as current_remain
    FROM inbound i
    JOIN master m ON i.item_code = m.item_code
    WHERE (
      -- 해당 월에 입고된 LOT
      (i.inbound_date >= ? AND i.inbound_date <= ?)
      OR
      -- 해당 월 이전에 입고되어 해당 월에 거래가 있는 LOT
      EXISTS (
        SELECT 1 FROM transactions t 
        WHERE t.lot_number = i.lot_number 
        AND t.trans_date >= ? AND t.trans_date <= ?
      )
      OR
      -- 해당 월 이전에 입고되어 아직 잔량이 있는 LOT
      (i.inbound_date < ? AND i.remain_qty > 0)
    )
  `;
  const lotParams: any[] = [startDate, endDate, startDate, endDate, startDate];
  
  if (category) {
    lotQuery += ' AND m.category = ?';
    lotParams.push(category);
  }
  if (item_code) {
    lotQuery += ' AND i.item_code = ?';
    lotParams.push(item_code);
  }
  if (lot_number) {
    lotQuery += ' AND i.lot_number LIKE ?';
    lotParams.push(`%${lot_number}%`);
  }
  // 원료명 또는 LOT 통합 검색
  if (search) {
    lotQuery += ' AND (m.item_name LIKE ? OR i.lot_number LIKE ? OR m.item_code LIKE ?)';
    lotParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  
  lotQuery += ' ORDER BY m.item_name, i.expiry_date, i.inbound_date';
  
  const lots = await c.env.DB.prepare(lotQuery).bind(...lotParams).all();
  
  // 2. 각 LOT에 대해 이월량, 당월 입고/사용/출고, 월말 잔량 계산
  const lotData = await Promise.all((lots.results || []).map(async (lot: any) => {
    // 이월량: 해당 월 이전까지의 모든 거래 합계
    const carryOverResult = await c.env.DB.prepare(`
      SELECT COALESCE(SUM(quantity), 0) as carry_over
      FROM transactions
      WHERE lot_number = ? AND trans_date < ?
    `).bind(lot.lot_number, startDate).first();
    
    // 당월 거래 내역
    const monthlyTrans = await c.env.DB.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN trans_type = '입고' THEN quantity ELSE 0 END), 0) as inbound,
        COALESCE(SUM(CASE WHEN trans_type = '사용' THEN ABS(quantity) ELSE 0 END), 0) as usage,
        COALESCE(SUM(CASE WHEN trans_type = '출고' THEN ABS(quantity) ELSE 0 END), 0) as outbound,
        COALESCE(SUM(CASE WHEN trans_type = '재고조정' THEN quantity ELSE 0 END), 0) as adjustment
      FROM transactions
      WHERE lot_number = ? AND trans_date >= ? AND trans_date <= ?
    `).bind(lot.lot_number, startDate, endDate).first();
    
    const carryOver = (carryOverResult as any)?.carry_over || 0;
    const inbound = (monthlyTrans as any)?.inbound || 0;
    const usage = (monthlyTrans as any)?.usage || 0;
    const outbound = (monthlyTrans as any)?.outbound || 0;
    const adjustment = (monthlyTrans as any)?.adjustment || 0;
    
    // 월말 잔량 = 이월 + 입고 - 사용 - 출고 + 조정
    const closingQty = carryOver + inbound - usage - outbound + adjustment;
    
    return {
      ...lot,
      carry_over: carryOver,        // 이월량 (전월 잔량)
      month_inbound: inbound,       // 당월 입고
      month_usage: usage,           // 당월 사용
      month_outbound: outbound,     // 당월 출고
      month_adjustment: adjustment, // 당월 조정
      closing_qty: closingQty       // 월말 잔량
    };
  }));
  
  // 3. 요약 계산
  const summary = lotData.reduce((acc: any, lot: any) => {
    acc.total_carry_over += lot.carry_over;
    acc.total_inbound += lot.month_inbound;
    acc.total_usage += lot.month_usage;
    acc.total_outbound += lot.month_outbound;
    acc.total_adjustment += lot.month_adjustment;
    acc.total_closing += lot.closing_qty;
    return acc;
  }, {
    total_carry_over: 0,
    total_inbound: 0,
    total_usage: 0,
    total_outbound: 0,
    total_adjustment: 0,
    total_closing: 0
  });
  
  return c.json({
    success: true,
    data: lotData,
    summary,
    period: { year, month, startDate, endDate }
  });
});

// 품목별 월별 수불부 (재고조정 품목 포함 - LOT 없는 품목도 표시)
transactionRoutes.get('/monthly-item-report', async (c) => {
  const year = c.req.query('year') || new Date().getFullYear().toString();
  const month = c.req.query('month') || String(new Date().getMonth() + 1).padStart(2, '0');
  const category = c.req.query('category');
  const search = c.req.query('search');
  
  const startDate = `${year}-${month.padStart(2, '0')}-01`;
  const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];
  
  // 1. 마스터의 모든 품목 조회 (재고가 있거나 거래가 있는 품목)
  let itemQuery = `
    SELECT 
      m.id,
      m.item_code,
      m.item_name,
      m.category,
      m.unit,
      m.current_stock
    FROM master m
    WHERE (
      m.current_stock > 0
      OR EXISTS (
        SELECT 1 FROM transactions t 
        WHERE t.item_code = m.item_code 
        AND t.trans_date >= ? AND t.trans_date <= ?
      )
      OR EXISTS (
        SELECT 1 FROM inbound i 
        WHERE i.item_code = m.item_code 
        AND i.inbound_date >= ? AND i.inbound_date <= ?
      )
    )
  `;
  const itemParams: any[] = [startDate, endDate, startDate, endDate];
  
  if (category) {
    itemQuery += ' AND m.category = ?';
    itemParams.push(category);
  }
  if (search) {
    itemQuery += ' AND (m.item_name LIKE ? OR m.item_code LIKE ?)';
    itemParams.push(`%${search}%`, `%${search}%`);
  }
  
  itemQuery += ' ORDER BY m.category, m.item_name';
  
  const items = await c.env.DB.prepare(itemQuery).bind(...itemParams).all();
  
  // 2. 각 품목에 대해 이월량, 당월 입고/사용/출고/조정, 월말 재고 계산
  const itemData = await Promise.all((items.results || []).map(async (item: any) => {
    // LOT 기반 이월량 (해당 월 이전까지의 모든 LOT별 거래 합계)
    const lotCarryOverResult = await c.env.DB.prepare(`
      SELECT COALESCE(SUM(quantity), 0) as carry_over
      FROM transactions t
      JOIN inbound i ON t.lot_number = i.lot_number
      WHERE i.item_code = ? AND t.trans_date < ?
    `).bind(item.item_code, startDate).first();
    
    // LOT 없는 거래의 이월량 (재고조정 등)
    const noLotCarryOverResult = await c.env.DB.prepare(`
      SELECT COALESCE(SUM(quantity), 0) as carry_over
      FROM transactions t
      WHERE t.item_code = ? AND t.trans_date < ? AND (t.lot_number IS NULL OR t.lot_number = '')
    `).bind(item.item_code, startDate).first();
    
    // 당월 입고량 (inbound 테이블에서 직접)
    const monthlyInboundResult = await c.env.DB.prepare(`
      SELECT COALESCE(SUM(origin_qty), 0) as inbound
      FROM inbound
      WHERE item_code = ? AND inbound_date >= ? AND inbound_date <= ?
    `).bind(item.item_code, startDate, endDate).first();
    
    // 당월 거래 내역 (transactions 테이블)
    const monthlyTransResult = await c.env.DB.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN trans_type = '사용' THEN ABS(quantity) ELSE 0 END), 0) as usage,
        COALESCE(SUM(CASE WHEN trans_type = '출고' THEN ABS(quantity) ELSE 0 END), 0) as outbound,
        COALESCE(SUM(CASE WHEN trans_type = '재고조정' THEN quantity ELSE 0 END), 0) as adjustment
      FROM transactions
      WHERE item_code = ? AND trans_date >= ? AND trans_date <= ?
    `).bind(item.item_code, startDate, endDate).first();
    
    const lotCarryOver = (lotCarryOverResult as any)?.carry_over || 0;
    const noLotCarryOver = (noLotCarryOverResult as any)?.carry_over || 0;
    const carryOver = lotCarryOver + noLotCarryOver;
    
    const inbound = (monthlyInboundResult as any)?.inbound || 0;
    const usage = (monthlyTransResult as any)?.usage || 0;
    const outbound = (monthlyTransResult as any)?.outbound || 0;
    const adjustment = (monthlyTransResult as any)?.adjustment || 0;
    
    // 월말 잔량 = 이월 + 입고 - 사용 - 출고 + 조정
    // 또는 master의 current_stock 사용 (더 정확)
    const closingQty = item.current_stock;
    const calculatedClosing = carryOver + inbound - usage - outbound + adjustment;
    
    return {
      ...item,
      carry_over: carryOver,        // 이월량 (전월 잔량)
      month_inbound: inbound,       // 당월 입고
      month_usage: usage,           // 당월 사용
      month_outbound: outbound,     // 당월 출고
      month_adjustment: adjustment, // 당월 조정
      closing_qty: closingQty,      // 월말 잔량 (master 기준)
      calculated_closing: calculatedClosing  // 계산된 월말 잔량
    };
  }));
  
  // 3. 요약 계산
  const summary = itemData.reduce((acc: any, item: any) => {
    acc.total_carry_over += item.carry_over;
    acc.total_inbound += item.month_inbound;
    acc.total_usage += item.month_usage;
    acc.total_outbound += item.month_outbound;
    acc.total_adjustment += item.month_adjustment;
    acc.total_closing += item.closing_qty;
    return acc;
  }, {
    total_carry_over: 0,
    total_inbound: 0,
    total_usage: 0,
    total_outbound: 0,
    total_adjustment: 0,
    total_closing: 0
  });
  
  return c.json({
    success: true,
    data: itemData,
    summary,
    period: { year, month, startDate, endDate },
    item_count: itemData.length
  });
});

export default transactionRoutes;
