// 수불 이력 통합 검색 API
import { Hono } from 'hono';
import type { Bindings, TransactionSearchParams } from '../types';

const transactionRoutes = new Hono<{ Bindings: Bindings }>();

// 통합 검색
transactionRoutes.get('/search', async (c) => {
  const start_date = c.req.query('start_date');
  const end_date = c.req.query('end_date');
  const item_code = c.req.query('item_code');
  const trans_type = c.req.query('trans_type');
  const lot_number = c.req.query('lot_number');
  const category = c.req.query('category');
  
  let query = `
    SELECT t.*, m.item_name, m.category, m.unit
    FROM transactions t
    JOIN master m ON t.item_code = m.item_code
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

// 월별 수불부 (원료/제품)
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

export default transactionRoutes;
