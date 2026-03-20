// 품목 마스터 API
import { Hono } from 'hono';
import type { Bindings, Master } from '../types';

const masterRoutes = new Hono<{ Bindings: Bindings }>();

// D1 바인딩 검증 미들웨어
masterRoutes.use('*', async (c, next) => {
  if (!c.env.DB) {
    return c.json({ 
      success: false, 
      error: 'D1 데이터베이스가 연결되지 않았습니다. Cloudflare 대시보드에서 D1 바인딩을 설정해주세요.'
    }, 503);
  }
  await next();
});

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
    const unitValue = unit || (category === '부자재' ? 'ea' : 'kg');
    const safetyValue = safety_stock || 0;
    
    // 부자재는 소비기한 없음 (NULL로 저장)
    if (category === '부자재') {
      await c.env.DB.prepare(`
        INSERT INTO master (item_code, item_name, category, unit, current_stock, safety_stock, expiry_days)
        VALUES (?, ?, ?, ?, 0, ?, NULL)
      `).bind(item_code, item_name, category, unitValue, safetyValue).run();
    } else {
      // 원료/제품은 소비기한 필수 (기본 365일)
      const expiryValue = expiry_days || 365;
      await c.env.DB.prepare(`
        INSERT INTO master (item_code, item_name, category, unit, current_stock, safety_stock, expiry_days)
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `).bind(item_code, item_name, category, unitValue, safetyValue, expiryValue).run();
    }
    
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

// 품목 삭제 (관련 데이터 연동 삭제)
masterRoutes.delete('/:item_code', async (c) => {
  const item_code = c.req.param('item_code');
  const force = c.req.query('force') === 'true'; // 강제 삭제 옵션
  
  // 해당 품목 확인
  const item = await c.env.DB.prepare(
    'SELECT * FROM master WHERE item_code = ?'
  ).bind(item_code).first<any>();
  
  if (!item) {
    return c.json({ success: false, error: '품목을 찾을 수 없습니다.' }, 404);
  }
  
  // 관련 데이터 확인
  const [transactions, inbounds, boms, productions, prodMaterials] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM transactions WHERE item_code = ?').bind(item_code).first<{count:number}>(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM inbound WHERE item_code = ?').bind(item_code).first<{count:number}>(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM bom WHERE item_code = ? OR product_code = ?').bind(item_code, item_code).first<{count:number}>(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM production WHERE product_code = ?').bind(item_code).first<{count:number}>(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM production_materials WHERE item_code = ?').bind(item_code).first<{count:number}>()
  ]);
  
  const relatedData = {
    transactions: transactions?.count || 0,
    inbounds: inbounds?.count || 0,
    boms: boms?.count || 0,
    productions: productions?.count || 0,
    production_materials: prodMaterials?.count || 0
  };
  
  const hasRelated = Object.values(relatedData).some(v => v > 0);
  
  if (hasRelated && !force) {
    return c.json({ 
      success: false, 
      error: '관련 데이터가 있습니다. 강제 삭제하려면 ?force=true를 추가하세요.',
      relatedData
    }, 400);
  }
  
  // 강제 삭제: 모든 관련 데이터 삭제 (순서 중요: 자식 테이블 먼저)
  if (force && hasRelated) {
    // 1. production_materials 먼저 삭제 (production의 자식)
    await c.env.DB.prepare('DELETE FROM production_materials WHERE item_code = ?').bind(item_code).run();
    // production_id로 연결된 것도 삭제
    const prodIds = await c.env.DB.prepare('SELECT id FROM production WHERE product_code = ?').bind(item_code).all<{id:number}>();
    for (const p of prodIds.results || []) {
      await c.env.DB.prepare('DELETE FROM production_materials WHERE production_id = ?').bind(p.id).run();
    }
    
    // 2. 나머지 테이블 삭제
    await c.env.DB.prepare('DELETE FROM transactions WHERE item_code = ?').bind(item_code).run();
    await c.env.DB.prepare('DELETE FROM inbound WHERE item_code = ?').bind(item_code).run();
    await c.env.DB.prepare('DELETE FROM bom WHERE item_code = ? OR product_code = ?').bind(item_code, item_code).run();
    await c.env.DB.prepare('DELETE FROM production WHERE product_code = ?').bind(item_code).run();
  }
  
  // 마스터 삭제
  await c.env.DB.prepare('DELETE FROM master WHERE item_code = ?').bind(item_code).run();
  
  return c.json({ 
    success: true, 
    message: force ? `품목 및 관련 데이터가 삭제되었습니다.` : '품목이 삭제되었습니다.',
    deletedData: force ? relatedData : null
  });
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
    
    if (category !== '원료' && category !== '제품' && category !== '부자재') {
      results.failed++;
      results.errors.push(`${item_code}: 구분은 '원료', '제품', '부자재' 중 하나여야 합니다`);
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
    { item_code: 'PD001', item_name: '식빵', category: '제품', unit: 'ea', safety_stock: 20, expiry_days: 5 },
    { item_code: 'SM001', item_name: '비닐봉투', category: '부자재', unit: 'ea', safety_stock: 500, expiry_days: null }
  ];
  
  return c.json({ success: true, data: sampleData });
});

// 카테고리별 전체 삭제 (관련 데이터 포함)
masterRoutes.delete('/category/:category/all', async (c) => {
  const category = c.req.param('category');
  const confirm = c.req.query('confirm');
  
  if (category !== '원료' && category !== '제품' && category !== '부자재') {
    return c.json({ success: false, error: '유효한 카테고리가 아닙니다. (원료/제품/부자재)' }, 400);
  }
  
  // 해당 카테고리의 모든 품목 조회
  const items = await c.env.DB.prepare(
    'SELECT item_code FROM master WHERE category = ?'
  ).bind(category).all<{item_code: string}>();
  
  const itemCodes = items.results?.map(i => i.item_code) || [];
  
  if (itemCodes.length === 0) {
    return c.json({ success: false, error: '삭제할 품목이 없습니다.' }, 404);
  }
  
  if (confirm !== 'DELETE_ALL') {
    return c.json({ 
      success: false, 
      error: `${category} ${itemCodes.length}개를 삭제하려면 ?confirm=DELETE_ALL을 추가하세요.`,
      count: itemCodes.length
    }, 400);
  }
  
  // 관련 데이터 모두 삭제 (순서 중요: 자식 테이블 먼저)
  const placeholders = itemCodes.map(() => '?').join(',');
  
  // 1. production_materials 먼저 삭제 (production의 자식)
  await c.env.DB.prepare(`DELETE FROM production_materials WHERE item_code IN (${placeholders})`).bind(...itemCodes).run();
  // production_id로 연결된 것도 삭제
  const prodIds = await c.env.DB.prepare(`SELECT id FROM production WHERE product_code IN (${placeholders})`).bind(...itemCodes).all<{id:number}>();
  for (const p of prodIds.results || []) {
    await c.env.DB.prepare('DELETE FROM production_materials WHERE production_id = ?').bind(p.id).run();
  }
  
  // 2. 나머지 테이블 삭제
  await c.env.DB.prepare(`DELETE FROM transactions WHERE item_code IN (${placeholders})`).bind(...itemCodes).run();
  await c.env.DB.prepare(`DELETE FROM inbound WHERE item_code IN (${placeholders})`).bind(...itemCodes).run();
  await c.env.DB.prepare(`DELETE FROM bom WHERE item_code IN (${placeholders}) OR product_code IN (${placeholders})`).bind(...itemCodes, ...itemCodes).run();
  await c.env.DB.prepare(`DELETE FROM production WHERE product_code IN (${placeholders})`).bind(...itemCodes).run();
  await c.env.DB.prepare(`DELETE FROM master WHERE category = ?`).bind(category).run();
  
  return c.json({ 
    success: true, 
    message: `${category} ${itemCodes.length}개 및 관련 데이터가 삭제되었습니다.`
  });
});

export default masterRoutes;
