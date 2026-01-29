// 품목 마스터 API
import { Hono } from 'hono';
import type { Bindings, Master } from '../types';

const masterRoutes = new Hono<{ Bindings: Bindings }>();

// 전체 품목 조회
masterRoutes.get('/', async (c) => {
  const category = c.req.query('category');
  let query = 'SELECT * FROM master';
  const params: string[] = [];
  
  if (category) {
    query += ' WHERE category = ?';
    params.push(category);
  }
  query += ' ORDER BY category, item_code';
  
  const result = await c.env.DB.prepare(query).bind(...params).all<Master>();
  return c.json({ success: true, data: result.results });
});

// 품목 상세 조회
masterRoutes.get('/:item_code', async (c) => {
  const item_code = c.req.param('item_code');
  const result = await c.env.DB.prepare(
    'SELECT * FROM master WHERE item_code = ?'
  ).bind(item_code).first<Master>();
  
  if (!result) {
    return c.json({ success: false, error: '품목을 찾을 수 없습니다.' }, 404);
  }
  return c.json({ success: true, data: result });
});

// 품목 등록
masterRoutes.post('/', async (c) => {
  const body = await c.req.json<Partial<Master>>();
  const { item_code, item_name, category, unit, safety_stock, expiry_days } = body;
  
  if (!item_code || !item_name || !category) {
    return c.json({ success: false, error: '필수 항목을 입력해주세요.' }, 400);
  }
  
  try {
    await c.env.DB.prepare(`
      INSERT INTO master (item_code, item_name, category, unit, current_stock, safety_stock, expiry_days)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).bind(
      item_code,
      item_name,
      category,
      unit || 'kg',
      safety_stock || 0,
      expiry_days || 365
    ).run();
    
    return c.json({ success: true, message: '품목이 등록되었습니다.' });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) {
      return c.json({ success: false, error: '이미 존재하는 품목코드입니다.' }, 400);
    }
    throw error;
  }
});

// 품목 수정
masterRoutes.put('/:item_code', async (c) => {
  const item_code = c.req.param('item_code');
  const body = await c.req.json<Partial<Master>>();
  const { item_name, unit, safety_stock, expiry_days } = body;
  
  const result = await c.env.DB.prepare(`
    UPDATE master 
    SET item_name = COALESCE(?, item_name),
        unit = COALESCE(?, unit),
        safety_stock = COALESCE(?, safety_stock),
        expiry_days = COALESCE(?, expiry_days),
        updated_at = CURRENT_TIMESTAMP
    WHERE item_code = ?
  `).bind(item_name, unit, safety_stock, expiry_days, item_code).run();
  
  if (result.meta.changes === 0) {
    return c.json({ success: false, error: '품목을 찾을 수 없습니다.' }, 404);
  }
  return c.json({ success: true, message: '품목이 수정되었습니다.' });
});

// 품목 삭제
masterRoutes.delete('/:item_code', async (c) => {
  const item_code = c.req.param('item_code');
  
  // 해당 품목의 거래 내역이 있는지 확인
  const hasTransactions = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM transactions WHERE item_code = ?'
  ).bind(item_code).first<{ count: number }>();
  
  if (hasTransactions && hasTransactions.count > 0) {
    return c.json({ success: false, error: '거래 내역이 있는 품목은 삭제할 수 없습니다.' }, 400);
  }
  
  const result = await c.env.DB.prepare(
    'DELETE FROM master WHERE item_code = ?'
  ).bind(item_code).run();
  
  if (result.meta.changes === 0) {
    return c.json({ success: false, error: '품목을 찾을 수 없습니다.' }, 404);
  }
  return c.json({ success: true, message: '품목이 삭제되었습니다.' });
});

// 품목 일괄 업로드 (CSV/JSON)
masterRoutes.post('/upload', async (c) => {
  const { items } = await c.req.json<{ items: Partial<Master>[] }>();
  
  if (!items || !Array.isArray(items) || items.length === 0) {
    return c.json({ success: false, error: '업로드할 데이터가 없습니다.' }, 400);
  }
  
  const results = {
    success: 0,
    failed: 0,
    errors: [] as string[]
  };
  
  for (const item of items) {
    const { item_code, item_name, category, unit, safety_stock, expiry_days } = item;
    
    if (!item_code || !item_name || !category) {
      results.failed++;
      results.errors.push(`${item_code || '코드없음'}: 필수 항목 누락`);
      continue;
    }
    
    if (category !== '원료' && category !== '제품') {
      results.failed++;
      results.errors.push(`${item_code}: 구분은 '원료' 또는 '제품'이어야 합니다`);
      continue;
    }
    
    try {
      // 이미 존재하면 업데이트, 없으면 삽입
      const existing = await c.env.DB.prepare(
        'SELECT item_code FROM master WHERE item_code = ?'
      ).bind(item_code).first();
      
      if (existing) {
        await c.env.DB.prepare(`
          UPDATE master SET 
            item_name = ?, category = ?, unit = ?, 
            safety_stock = ?, expiry_days = ?, updated_at = CURRENT_TIMESTAMP
          WHERE item_code = ?
        `).bind(
          item_name, category, unit || 'ea', 
          safety_stock || 0, expiry_days || 365, item_code
        ).run();
      } else {
        await c.env.DB.prepare(`
          INSERT INTO master (item_code, item_name, category, unit, current_stock, safety_stock, expiry_days)
          VALUES (?, ?, ?, ?, 0, ?, ?)
        `).bind(
          item_code, item_name, category, unit || 'ea', 
          safety_stock || 0, expiry_days || 365
        ).run();
      }
      results.success++;
    } catch (error: any) {
      results.failed++;
      results.errors.push(`${item_code}: ${error.message || '등록 실패'}`);
    }
  }
  
  return c.json({ 
    success: true, 
    message: `${results.success}건 성공, ${results.failed}건 실패`,
    results
  });
});

// 품목 템플릿 다운로드용 예시 데이터
masterRoutes.get('/template/sample', async (c) => {
  const sampleData = [
    { item_code: 'RM001', item_name: '강력분', category: '원료', unit: 'kg', safety_stock: 100, expiry_days: 180 },
    { item_code: 'PD001', item_name: '식빵', category: '제품', unit: 'ea', safety_stock: 20, expiry_days: 5 }
  ];
  
  return c.json({ success: true, data: sampleData });
});

export default masterRoutes;
