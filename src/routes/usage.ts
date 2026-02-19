// 사용량 입력 API (별도 관리 - 수불부에 영향 없음)
// 재고 관리 참고용으로만 사용
import { Hono } from 'hono';
import type { Bindings } from '../types';

const usageRoutes = new Hono<{ Bindings: Bindings }>();

// 사용 가능한 원료 목록 조회
usageRoutes.get('/available', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT item_code, item_name, category, unit, current_stock, safety_stock
    FROM master
    WHERE category = '원료'
    ORDER BY item_name
  `).all();
  
  return c.json({ success: true, data: result.results });
});

// 오늘 사용량 기록 조회
usageRoutes.get('/today', async (c) => {
  const today = new Date().toISOString().split('T')[0];
  
  const result = await c.env.DB.prepare(`
    SELECT u.*, m.item_name, m.unit
    FROM usage_records u
    LEFT JOIN master m ON u.item_code = m.item_code
    WHERE u.usage_date = ?
    ORDER BY u.created_at DESC
  `).bind(today).all();
  
  return c.json({ success: true, data: result.results });
});

// 기간별 사용량 기록 조회
usageRoutes.get('/history', async (c) => {
  const start_date = c.req.query('start_date');
  const end_date = c.req.query('end_date');
  const item_code = c.req.query('item_code');
  
  let query = `
    SELECT u.*, m.item_name as master_item_name, m.unit as master_unit
    FROM usage_records u
    LEFT JOIN master m ON u.item_code = m.item_code
    WHERE 1=1
  `;
  const params: any[] = [];
  
  if (start_date) {
    query += ' AND u.usage_date >= ?';
    params.push(start_date);
  }
  if (end_date) {
    query += ' AND u.usage_date <= ?';
    params.push(end_date);
  }
  if (item_code) {
    query += ' AND u.item_code = ?';
    params.push(item_code);
  }
  
  query += ' ORDER BY u.usage_date DESC, u.id DESC';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// 사용량 요약 조회 (품목별 합계)
usageRoutes.get('/summary', async (c) => {
  const start_date = c.req.query('start_date');
  const end_date = c.req.query('end_date');
  
  let query = `
    SELECT u.item_code, 
           COALESCE(m.item_name, u.item_name) as item_name,
           COALESCE(m.unit, u.unit) as unit,
           SUM(u.quantity) as total_usage,
           COUNT(*) as record_count
    FROM usage_records u
    LEFT JOIN master m ON u.item_code = m.item_code
    WHERE 1=1
  `;
  const params: any[] = [];
  
  if (start_date) {
    query += ' AND u.usage_date >= ?';
    params.push(start_date);
  }
  if (end_date) {
    query += ' AND u.usage_date <= ?';
    params.push(end_date);
  }
  
  query += ' GROUP BY u.item_code ORDER BY total_usage DESC';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// 사용량 단일 등록
usageRoutes.post('/single', async (c) => {
  const body = await c.req.json();
  const { item_code, item_name, quantity, unit, usage_date, purpose, memo } = body;
  
  if (!item_code || !quantity || quantity <= 0) {
    return c.json({ success: false, error: '품목코드와 수량을 입력해주세요.' }, 400);
  }
  
  const date = usage_date || new Date().toISOString().split('T')[0];
  
  // 마스터에서 품목 정보 조회
  const master = await c.env.DB.prepare(
    'SELECT item_name, unit FROM master WHERE item_code = ?'
  ).bind(item_code).first<{ item_name: string; unit: string }>();
  
  await c.env.DB.prepare(`
    INSERT INTO usage_records (usage_date, item_code, item_name, quantity, unit, purpose, memo)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    date,
    item_code,
    item_name || master?.item_name || item_code,
    quantity,
    unit || master?.unit || 'g',
    purpose || null,
    memo || null
  ).run();
  
  return c.json({ 
    success: true, 
    message: '사용량이 기록되었습니다.',
    note: '이 기록은 참고용이며 수불부에는 반영되지 않습니다.'
  });
});

// 사용량 일괄 등록 (수불부 영향 없음)
usageRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const { items, usage_date, purpose } = body;
  
  if (!items || items.length === 0) {
    return c.json({ success: false, error: '사용 내역을 입력해주세요.' }, 400);
  }
  
  const date = usage_date || new Date().toISOString().split('T')[0];
  let successCount = 0;
  
  for (const item of items) {
    if (!item.quantity || item.quantity <= 0) {
      continue;
    }
    
    // 마스터에서 품목 정보 조회
    const master = await c.env.DB.prepare(
      'SELECT item_name, unit FROM master WHERE item_code = ?'
    ).bind(item.item_code).first<{ item_name: string; unit: string }>();
    
    await c.env.DB.prepare(`
      INSERT INTO usage_records (usage_date, item_code, item_name, quantity, unit, purpose, memo)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      date,
      item.item_code,
      item.item_name || master?.item_name || item.item_code,
      item.quantity,
      item.unit || master?.unit || 'g',
      purpose || item.purpose || null,
      item.memo || null
    ).run();
    
    successCount++;
  }
  
  return c.json({ 
    success: true, 
    message: `${successCount}개 품목의 사용량이 기록되었습니다.`,
    note: '이 기록은 참고용이며 수불부에는 반영되지 않습니다.'
  });
});

// 사용량 기록 삭제
usageRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  
  await c.env.DB.prepare('DELETE FROM usage_records WHERE id = ?').bind(id).run();
  
  return c.json({ success: true, message: '사용량 기록이 삭제되었습니다.' });
});

// 기간별 사용량 일괄 삭제
usageRoutes.delete('/bulk/clear', async (c) => {
  const start_date = c.req.query('start_date');
  const end_date = c.req.query('end_date');
  
  if (!start_date || !end_date) {
    return c.json({ success: false, error: '기간을 지정해주세요.' }, 400);
  }
  
  const result = await c.env.DB.prepare(`
    DELETE FROM usage_records WHERE usage_date BETWEEN ? AND ?
  `).bind(start_date, end_date).run();
  
  return c.json({ 
    success: true, 
    message: `${result.meta.changes}개 사용량 기록이 삭제되었습니다.`
  });
});

export default usageRoutes;
