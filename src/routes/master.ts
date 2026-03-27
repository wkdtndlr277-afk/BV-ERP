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

// 전체 품목 조회 (master + supplies UNION)
masterRoutes.get('/', async (c) => {
  const category = c.req.query('category');
  
  try {
    // supplies 테이블 존재 여부 확인
    const suppliesExists = await c.env.DB.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='supplies'
    `).first();
    
    if (category === '부자재') {
      // 부자재만 조회 - supplies 테이블에서
      if (!suppliesExists) {
        return c.json({ success: true, data: [] });
      }
      const result = await c.env.DB.prepare(`
        SELECT * FROM supplies ORDER BY item_code
      `).all<Master>();
      return c.json({ success: true, data: result.results });
    } else if (category) {
      // 특정 카테고리 (원료/제품) - master 테이블에서
      const result = await c.env.DB.prepare(`
        SELECT * FROM master WHERE category = ? ORDER BY item_code
      `).bind(category).all<Master>();
      return c.json({ success: true, data: result.results });
    } else {
      // 전체 조회 - master + supplies UNION
      if (suppliesExists) {
        const result = await c.env.DB.prepare(`
          SELECT id, item_code, item_name, category, unit, current_stock, safety_stock, expiry_days, created_at, updated_at FROM master 
          UNION ALL 
          SELECT id, item_code, item_name, category, unit, current_stock, COALESCE(safety_stock, 0) as safety_stock, expiry_days, created_at, updated_at FROM supplies 
          ORDER BY category, item_code
        `).all<Master>();
        return c.json({ success: true, data: result.results });
      } else {
        const result = await c.env.DB.prepare(`
          SELECT * FROM master ORDER BY category, item_code
        `).all<Master>();
        return c.json({ success: true, data: result.results });
      }
    }
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 품목 상세 조회 (master 또는 supplies에서)
masterRoutes.get('/:item_code', async (c) => {
  const item_code = c.req.param('item_code');
  
  // 먼저 master에서 찾기
  let result = await c.env.DB.prepare(
    'SELECT * FROM master WHERE item_code = ?'
  ).bind(item_code).first<Master>();
  
  // master에 없으면 supplies에서 찾기
  if (!result) {
    try {
      result = await c.env.DB.prepare(
        'SELECT * FROM supplies WHERE item_code = ?'
      ).bind(item_code).first<Master>();
    } catch (e) {
      // supplies 테이블이 없을 수 있음
    }
  }
  
  if (!result) {
    return c.json({ success: false, error: '품목을 찾을 수 없습니다.' }, 404);
  }
  return c.json({ success: true, data: result });
});

// 품목 등록 (부자재는 supplies 테이블에, 원료/제품은 master 테이블에)
masterRoutes.post('/', async (c) => {
  const body = await c.req.json<Partial<Master>>();
  const { item_code, item_name, category, unit, safety_stock, expiry_days } = body;
  
  if (!item_code || !item_name || !category) {
    return c.json({ success: false, error: '필수 항목을 입력해주세요.' }, 400);
  }
  
  try {
    const unitValue = unit || (category === '부자재' ? 'ea' : 'kg');
    const safetyValue = safety_stock || 0;
    
    if (category === '부자재') {
      // 부자재는 supplies 테이블에 저장
      // supplies 테이블 존재 확인 및 생성
      const suppliesExists = await c.env.DB.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='supplies'
      `).first();
      
      if (!suppliesExists) {
        // supplies 테이블 자동 생성
        await c.env.DB.prepare(`
          CREATE TABLE supplies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_code TEXT UNIQUE NOT NULL,
            item_name TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT '부자재',
            unit TEXT DEFAULT 'ea',
            current_stock REAL DEFAULT 0,
            safety_stock REAL DEFAULT 0,
            expiry_days INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `).run();
        await c.env.DB.prepare(`CREATE INDEX idx_supplies_item_code ON supplies(item_code)`).run();
      }
      
      // supplies 테이블에 삽입
      await c.env.DB.prepare(`
        INSERT INTO supplies (item_code, item_name, category, unit, current_stock, safety_stock, expiry_days)
        VALUES (?, ?, '부자재', ?, 0, ?, NULL)
      `).bind(item_code, item_name, unitValue, safetyValue).run();
      
      return c.json({ success: true, message: '부자재가 등록되었습니다.' });
    } else {
      // 원료/제품은 master 테이블에 저장
      const expiryValue = expiry_days || 365;
      await c.env.DB.prepare(`
        INSERT INTO master (item_code, item_name, category, unit, current_stock, safety_stock, expiry_days)
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `).bind(item_code, item_name, category, unitValue, safetyValue, expiryValue).run();
      
      return c.json({ success: true, message: '품목이 등록되었습니다.' });
    }
  } catch (error: any) {
    console.error('Master insert error:', error);
    if (error.message?.includes('UNIQUE')) {
      return c.json({ success: false, error: '이미 존재하는 품목코드입니다.' }, 400);
    }
    if (error.message?.includes('CHECK') || error.message?.includes('constraint')) {
      return c.json({ success: false, error: `DB 제약조건 오류: ${error.message}` }, 400);
    }
    return c.json({ success: false, error: `등록 실패: ${error.message || '알 수 없는 오류'}` }, 500);
  }
});

// 품목 수정 (카테고리 변경 시 테이블 간 이동 지원)
masterRoutes.put('/:item_code', async (c) => {
  const item_code = c.req.param('item_code');
  const body = await c.req.json<Partial<Master>>();
  const { item_name, category, unit, safety_stock, expiry_days } = body;
  
  try {
    // 현재 품목 위치 확인
    const masterItem = await c.env.DB.prepare(
      'SELECT * FROM master WHERE item_code = ?'
    ).bind(item_code).first<Master>();
    
    let suppliesItem = null;
    try {
      suppliesItem = await c.env.DB.prepare(
        'SELECT * FROM supplies WHERE item_code = ?'
      ).bind(item_code).first<Master>();
    } catch (e) {
      // supplies 테이블이 없을 수 있음
    }
    
    if (!masterItem && !suppliesItem) {
      return c.json({ success: false, error: '품목을 찾을 수 없습니다.' }, 404);
    }
    
    const currentItem = masterItem || suppliesItem;
    const isCurrentlyInMaster = !!masterItem;
    const currentCategory = currentItem?.category || (isCurrentlyInMaster ? '원료' : '부자재');
    const newCategory = category || currentCategory;
    const shouldBeInSupplies = newCategory === '부자재';
    
    // 카테고리 변경으로 테이블 이동이 필요한 경우
    if (isCurrentlyInMaster && shouldBeInSupplies) {
      // master → supplies 이동
      // supplies 테이블 존재 확인 및 생성
      const suppliesExists = await c.env.DB.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='supplies'
      `).first();
      
      if (!suppliesExists) {
        await c.env.DB.prepare(`
          CREATE TABLE supplies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_code TEXT UNIQUE NOT NULL,
            item_name TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT '부자재',
            unit TEXT DEFAULT 'ea',
            current_stock REAL DEFAULT 0,
            safety_stock REAL DEFAULT 0,
            expiry_days INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `).run();
        await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_supplies_item_code ON supplies(item_code)`).run();
      }
      
      // supplies에 삽입
      await c.env.DB.prepare(`
        INSERT INTO supplies (item_code, item_name, category, unit, current_stock, safety_stock, expiry_days, created_at)
        VALUES (?, ?, '부자재', ?, ?, ?, ?, ?)
      `).bind(
        item_code,
        item_name || currentItem!.item_name,
        unit || currentItem!.unit || 'ea',
        currentItem!.current_stock || 0,
        safety_stock ?? currentItem!.safety_stock ?? 0,
        expiry_days ?? currentItem!.expiry_days,
        currentItem!.created_at
      ).run();
      
      // master에서 삭제
      await c.env.DB.prepare('DELETE FROM master WHERE item_code = ?').bind(item_code).run();
      
      return c.json({ success: true, message: '품목이 부자재로 변경되었습니다.' });
      
    } else if (!isCurrentlyInMaster && !shouldBeInSupplies) {
      // supplies → master 이동
      await c.env.DB.prepare(`
        INSERT INTO master (item_code, item_name, category, unit, current_stock, safety_stock, expiry_days, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        item_code,
        item_name || currentItem!.item_name,
        newCategory,
        unit || currentItem!.unit || 'kg',
        currentItem!.current_stock || 0,
        safety_stock ?? currentItem!.safety_stock ?? 0,
        expiry_days ?? currentItem!.expiry_days ?? 365,
        currentItem!.created_at
      ).run();
      
      // supplies에서 삭제
      await c.env.DB.prepare('DELETE FROM supplies WHERE item_code = ?').bind(item_code).run();
      
      return c.json({ success: true, message: `품목이 ${newCategory}(으)로 변경되었습니다.` });
      
    } else {
      // 같은 테이블 내 업데이트
      if (isCurrentlyInMaster) {
        await c.env.DB.prepare(`
          UPDATE master 
          SET item_name = COALESCE(?, item_name),
              category = COALESCE(?, category),
              unit = COALESCE(?, unit),
              safety_stock = COALESCE(?, safety_stock),
              expiry_days = COALESCE(?, expiry_days),
              updated_at = CURRENT_TIMESTAMP
          WHERE item_code = ?
        `).bind(item_name, category, unit, safety_stock, expiry_days, item_code).run();
      } else {
        await c.env.DB.prepare(`
          UPDATE supplies 
          SET item_name = COALESCE(?, item_name),
              unit = COALESCE(?, unit),
              safety_stock = COALESCE(?, safety_stock),
              expiry_days = COALESCE(?, expiry_days),
              updated_at = CURRENT_TIMESTAMP
          WHERE item_code = ?
        `).bind(item_name, unit, safety_stock, expiry_days, item_code).run();
      }
      
      return c.json({ success: true, message: '품목이 수정되었습니다.' });
    }
  } catch (error: any) {
    console.error('Master update error:', error);
    return c.json({ success: false, error: `수정 실패: ${error.message}` }, 500);
  }
});

// 품목 삭제 (관련 데이터 연동 삭제)
masterRoutes.delete('/:item_code', async (c) => {
  const item_code = c.req.param('item_code');
  const force = c.req.query('force') === 'true'; // 강제 삭제 옵션
  
  // 해당 품목 확인 (master 또는 supplies)
  let item = await c.env.DB.prepare(
    'SELECT *, "master" as source FROM master WHERE item_code = ?'
  ).bind(item_code).first<any>();
  
  let isSupplies = false;
  if (!item) {
    item = await c.env.DB.prepare(
      'SELECT *, "supplies" as source FROM supplies WHERE item_code = ?'
    ).bind(item_code).first<any>();
    isSupplies = true;
  }
  
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
  
  // 마스터 또는 부자재 삭제
  if (isSupplies) {
    await c.env.DB.prepare('DELETE FROM supplies WHERE item_code = ?').bind(item_code).run();
  } else {
    await c.env.DB.prepare('DELETE FROM master WHERE item_code = ?').bind(item_code).run();
  }
  
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
