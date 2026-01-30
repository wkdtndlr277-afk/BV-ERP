// BOM (배합표) 관리 API
import { Hono } from 'hono';
import type { Bindings } from '../types';

const bomRoutes = new Hono<{ Bindings: Bindings }>();

// BOM 목록 조회 (제품별)
bomRoutes.get('/', async (c) => {
  const productCode = c.req.query('product_code');
  
  let query = `
    SELECT b.*, 
           m.item_name as item_name,
           m.unit as item_unit,
           m.current_stock as item_stock,
           p.item_name as product_name
    FROM bom b
    LEFT JOIN master m ON b.item_code = m.item_code
    LEFT JOIN master p ON b.product_code = p.item_code
  `;
  const params: string[] = [];
  
  if (productCode) {
    query += ' WHERE b.product_code = ?';
    params.push(productCode);
  }
  
  query += ' ORDER BY b.product_code, b.sort_order, b.id';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// 특정 제품의 BOM 조회
bomRoutes.get('/product/:product_code', async (c) => {
  const productCode = c.req.param('product_code');
  
  // 제품 정보
  const product = await c.env.DB.prepare(`
    SELECT * FROM master WHERE item_code = ? AND category = '제품'
  `).bind(productCode).first();
  
  if (!product) {
    return c.json({ success: false, error: '제품을 찾을 수 없습니다.' }, 404);
  }
  
  // BOM 목록
  const bom = await c.env.DB.prepare(`
    SELECT b.*, 
           m.item_name,
           m.unit as item_unit,
           m.current_stock
    FROM bom b
    LEFT JOIN master m ON b.item_code = m.item_code
    WHERE b.product_code = ?
    ORDER BY b.sort_order, b.id
  `).bind(productCode).all();
  
  return c.json({ 
    success: true, 
    data: {
      product,
      materials: bom.results
    }
  });
});

// BOM 등록 (개별)
bomRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const { product_code, item_code, quantity, unit, sort_order, memo } = body;
  
  if (!product_code || !item_code || !quantity) {
    return c.json({ success: false, error: '필수 항목을 입력해주세요.' }, 400);
  }
  
  // 제품/원료 존재 확인
  const product = await c.env.DB.prepare(
    'SELECT item_code FROM master WHERE item_code = ? AND category = ?'
  ).bind(product_code, '제품').first();
  
  if (!product) {
    return c.json({ success: false, error: '제품을 찾을 수 없습니다.' }, 404);
  }
  
  const material = await c.env.DB.prepare(
    'SELECT item_code FROM master WHERE item_code = ?'
  ).bind(item_code).first();
  
  if (!material) {
    return c.json({ success: false, error: '원재료를 찾을 수 없습니다.' }, 404);
  }
  
  try {
    await c.env.DB.prepare(`
      INSERT INTO bom (product_code, item_code, quantity, unit, sort_order, memo)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      product_code,
      item_code,
      quantity,
      unit || 'g',
      sort_order || 0,
      memo || null
    ).run();
    
    return c.json({ success: true, message: 'BOM이 등록되었습니다.' });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) {
      return c.json({ success: false, error: '이미 등록된 원재료입니다.' }, 400);
    }
    throw error;
  }
});

// BOM 일괄 등록
bomRoutes.post('/bulk', async (c) => {
  const { product_code, materials } = await c.req.json();
  
  if (!product_code || !materials || !Array.isArray(materials)) {
    return c.json({ success: false, error: '잘못된 요청입니다.' }, 400);
  }
  
  const results = { success: 0, failed: 0, errors: [] as string[] };
  
  for (const mat of materials) {
    try {
      // 기존 BOM 있으면 업데이트, 없으면 삽입
      const existing = await c.env.DB.prepare(
        'SELECT id FROM bom WHERE product_code = ? AND item_code = ?'
      ).bind(product_code, mat.item_code).first();
      
      if (existing) {
        await c.env.DB.prepare(`
          UPDATE bom SET quantity = ?, unit = ?, sort_order = ?, memo = ?, updated_at = CURRENT_TIMESTAMP
          WHERE product_code = ? AND item_code = ?
        `).bind(
          mat.quantity,
          mat.unit || 'g',
          mat.sort_order || 0,
          mat.memo || null,
          product_code,
          mat.item_code
        ).run();
      } else {
        await c.env.DB.prepare(`
          INSERT INTO bom (product_code, item_code, quantity, unit, sort_order, memo)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          product_code,
          mat.item_code,
          mat.quantity,
          mat.unit || 'g',
          mat.sort_order || 0,
          mat.memo || null
        ).run();
      }
      results.success++;
    } catch (error: any) {
      results.failed++;
      results.errors.push(`${mat.item_code}: ${error.message || '등록 실패'}`);
    }
  }
  
  return c.json({ 
    success: true, 
    message: `${results.success}건 성공, ${results.failed}건 실패`,
    results
  });
});

// BOM 수정
bomRoutes.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { quantity, unit, sort_order, memo } = body;
  
  const result = await c.env.DB.prepare(`
    UPDATE bom 
    SET quantity = COALESCE(?, quantity),
        unit = COALESCE(?, unit),
        sort_order = COALESCE(?, sort_order),
        memo = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(quantity, unit, sort_order, memo, id).run();
  
  if (result.meta.changes === 0) {
    return c.json({ success: false, error: 'BOM을 찾을 수 없습니다.' }, 404);
  }
  
  return c.json({ success: true, message: 'BOM이 수정되었습니다.' });
});

// BOM 삭제
bomRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  
  const result = await c.env.DB.prepare(
    'DELETE FROM bom WHERE id = ?'
  ).bind(id).run();
  
  if (result.meta.changes === 0) {
    return c.json({ success: false, error: 'BOM을 찾을 수 없습니다.' }, 404);
  }
  
  return c.json({ success: true, message: 'BOM이 삭제되었습니다.' });
});

// 제품의 BOM 전체 삭제
bomRoutes.delete('/product/:product_code', async (c) => {
  const productCode = c.req.param('product_code');
  
  await c.env.DB.prepare(
    'DELETE FROM bom WHERE product_code = ?'
  ).bind(productCode).run();
  
  return c.json({ success: true, message: '제품의 BOM이 모두 삭제되었습니다.' });
});

// BOM 있는 제품 목록
bomRoutes.get('/products/with-bom', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT DISTINCT m.item_code, m.item_name, m.unit,
           (SELECT COUNT(*) FROM bom WHERE product_code = m.item_code) as material_count
    FROM master m
    WHERE m.category = '제품'
    AND EXISTS (SELECT 1 FROM bom WHERE product_code = m.item_code)
    ORDER BY m.item_name
  `).all();
  
  return c.json({ success: true, data: result.results });
});

// BOM 없는 제품 목록
bomRoutes.get('/products/without-bom', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT m.item_code, m.item_name, m.unit
    FROM master m
    WHERE m.category = '제품'
    AND NOT EXISTS (SELECT 1 FROM bom WHERE product_code = m.item_code)
    ORDER BY m.item_name
  `).all();
  
  return c.json({ success: true, data: result.results });
});

export default bomRoutes;
