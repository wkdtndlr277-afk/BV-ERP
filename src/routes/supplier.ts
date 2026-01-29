// 거래처 관리 API
import { Hono } from 'hono';
import type { Bindings, Supplier } from '../types';

const supplierRoutes = new Hono<{ Bindings: Bindings }>();

// 거래처 목록 조회
supplierRoutes.get('/', async (c) => {
  const supplier_type = c.req.query('type');
  
  let query = 'SELECT * FROM suppliers';
  const params: any[] = [];
  
  if (supplier_type) {
    query += ' WHERE supplier_type = ? OR supplier_type = ?';
    params.push(supplier_type, '양방향');
  }
  
  query += ' ORDER BY supplier_name';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// 거래처 상세 조회
supplierRoutes.get('/:supplier_code', async (c) => {
  const supplier_code = c.req.param('supplier_code');
  
  const result = await c.env.DB.prepare(
    'SELECT * FROM suppliers WHERE supplier_code = ?'
  ).bind(supplier_code).first();
  
  if (!result) {
    return c.json({ success: false, error: '거래처를 찾을 수 없습니다.' }, 404);
  }
  return c.json({ success: true, data: result });
});

// 거래처 등록
supplierRoutes.post('/', async (c) => {
  const body = await c.req.json<Partial<Supplier>>();
  const { supplier_code, supplier_name, supplier_type, contact, address } = body;
  
  if (!supplier_code || !supplier_name) {
    return c.json({ success: false, error: '거래처 코드와 이름을 입력해주세요.' }, 400);
  }
  
  try {
    await c.env.DB.prepare(`
      INSERT INTO suppliers (supplier_code, supplier_name, supplier_type, contact, address)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      supplier_code,
      supplier_name,
      supplier_type || '입고',
      contact || null,
      address || null
    ).run();
    
    return c.json({ success: true, message: '거래처가 등록되었습니다.' });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) {
      return c.json({ success: false, error: '이미 존재하는 거래처 코드입니다.' }, 400);
    }
    throw error;
  }
});

// 거래처 수정
supplierRoutes.put('/:supplier_code', async (c) => {
  const supplier_code = c.req.param('supplier_code');
  const body = await c.req.json<Partial<Supplier>>();
  const { supplier_name, supplier_type, contact, address } = body;
  
  const result = await c.env.DB.prepare(`
    UPDATE suppliers 
    SET supplier_name = COALESCE(?, supplier_name),
        supplier_type = COALESCE(?, supplier_type),
        contact = COALESCE(?, contact),
        address = COALESCE(?, address)
    WHERE supplier_code = ?
  `).bind(supplier_name, supplier_type, contact, address, supplier_code).run();
  
  if (result.meta.changes === 0) {
    return c.json({ success: false, error: '거래처를 찾을 수 없습니다.' }, 404);
  }
  return c.json({ success: true, message: '거래처가 수정되었습니다.' });
});

// 거래처 삭제
supplierRoutes.delete('/:supplier_code', async (c) => {
  const supplier_code = c.req.param('supplier_code');
  
  const result = await c.env.DB.prepare(
    'DELETE FROM suppliers WHERE supplier_code = ?'
  ).bind(supplier_code).run();
  
  if (result.meta.changes === 0) {
    return c.json({ success: false, error: '거래처를 찾을 수 없습니다.' }, 404);
  }
  return c.json({ success: true, message: '거래처가 삭제되었습니다.' });
});

export default supplierRoutes;
