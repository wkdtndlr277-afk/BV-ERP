// 거래처 관리 API
import { Hono } from 'hono';
import type { Bindings } from '../types';

interface Supplier {
  id?: number;
  supplier_code: string;
  supplier_name: string;
  supplier_type?: string;
  contact?: string;
  contact_person?: string;  // 담당자
  address?: string;
  material_name?: string;   // 원료명
  haccp_certified?: number; // HACCP 인증 여부 (0/1)
  is_imported?: number;     // 수입 여부 (0/1)
  business_number?: string; // 사업자번호
  email?: string;
  memo?: string;
  created_at?: string;
  updated_at?: string;
}

const supplierRoutes = new Hono<{ Bindings: Bindings }>();

// 거래처 테이블 확장 (컬럼 추가)
supplierRoutes.get('/migrate', async (c) => {
  try {
    // 새 컬럼들 추가 (이미 있으면 무시)
    const columns = [
      { name: 'contact_person', type: 'TEXT' },
      { name: 'material_name', type: 'TEXT' },
      { name: 'haccp_certified', type: 'INTEGER DEFAULT 0' },
      { name: 'is_imported', type: 'INTEGER DEFAULT 0' },
      { name: 'business_number', type: 'TEXT' },
      { name: 'email', type: 'TEXT' },
      { name: 'memo', type: 'TEXT' },
      { name: 'updated_at', type: 'DATETIME DEFAULT CURRENT_TIMESTAMP' }
    ];
    
    for (const col of columns) {
      try {
        await c.env.DB.prepare(`ALTER TABLE suppliers ADD COLUMN ${col.name} ${col.type}`).run();
      } catch (e: any) {
        // 이미 존재하는 컬럼이면 무시
        if (!e.message?.includes('duplicate column')) {
          console.log(`Column ${col.name} may already exist`);
        }
      }
    }
    
    return c.json({ success: true, message: '거래처 테이블 마이그레이션 완료' });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 거래처 목록 조회 (검색 기능 포함)
supplierRoutes.get('/', async (c) => {
  const supplier_type = c.req.query('type');
  const search = c.req.query('search');
  const haccp_only = c.req.query('haccp_only');
  const imported_only = c.req.query('imported_only');
  
  let query = 'SELECT * FROM suppliers WHERE 1=1';
  const params: any[] = [];
  
  if (supplier_type) {
    query += ' AND (supplier_type = ? OR supplier_type = ?)';
    params.push(supplier_type, '양방향');
  }
  
  // 검색어 (거래처명, 거래처코드, 담당자, 원료명)
  if (search) {
    query += ' AND (supplier_name LIKE ? OR supplier_code LIKE ? OR contact_person LIKE ? OR material_name LIKE ?)';
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern, searchPattern, searchPattern);
  }
  
  // HACCP 인증 필터
  if (haccp_only === '1') {
    query += ' AND haccp_certified = 1';
  }
  
  // 수입 여부 필터
  if (imported_only === '1') {
    query += ' AND is_imported = 1';
  }
  
  query += ' ORDER BY supplier_name';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// 거래처 상세 조회
supplierRoutes.get('/:supplier_code', async (c) => {
  const supplier_code = c.req.param('supplier_code');
  
  // 숫자 ID인 경우와 문자 코드인 경우 모두 처리
  let result;
  if (/^\d+$/.test(supplier_code)) {
    result = await c.env.DB.prepare(
      'SELECT * FROM suppliers WHERE id = ?'
    ).bind(parseInt(supplier_code)).first();
  } else {
    result = await c.env.DB.prepare(
      'SELECT * FROM suppliers WHERE supplier_code = ?'
    ).bind(supplier_code).first();
  }
  
  if (!result) {
    return c.json({ success: false, error: '거래처를 찾을 수 없습니다.' }, 404);
  }
  return c.json({ success: true, data: result });
});

// 거래처 등록
supplierRoutes.post('/', async (c) => {
  const body = await c.req.json<Partial<Supplier>>();
  const { 
    supplier_code, 
    supplier_name, 
    supplier_type, 
    contact, 
    contact_person,
    address,
    material_name,
    haccp_certified,
    is_imported,
    business_number,
    email,
    memo
  } = body;
  
  if (!supplier_code || !supplier_name) {
    return c.json({ success: false, error: '거래처 코드와 이름을 입력해주세요.' }, 400);
  }
  
  try {
    await c.env.DB.prepare(`
      INSERT INTO suppliers (
        supplier_code, supplier_name, supplier_type, contact, contact_person,
        address, material_name, haccp_certified, is_imported, business_number, email, memo
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      supplier_code,
      supplier_name,
      supplier_type || '입고',
      contact || null,
      contact_person || null,
      address || null,
      material_name || null,
      haccp_certified ? 1 : 0,
      is_imported ? 1 : 0,
      business_number || null,
      email || null,
      memo || null
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
  const { 
    supplier_name, 
    supplier_type, 
    contact, 
    contact_person,
    address,
    material_name,
    haccp_certified,
    is_imported,
    business_number,
    email,
    memo
  } = body;
  
  // ID 또는 코드로 수정
  let updateQuery = `
    UPDATE suppliers 
    SET supplier_name = COALESCE(?, supplier_name),
        supplier_type = COALESCE(?, supplier_type),
        contact = COALESCE(?, contact),
        contact_person = COALESCE(?, contact_person),
        address = COALESCE(?, address),
        material_name = COALESCE(?, material_name),
        haccp_certified = ?,
        is_imported = ?,
        business_number = COALESCE(?, business_number),
        email = COALESCE(?, email),
        memo = COALESCE(?, memo),
        updated_at = CURRENT_TIMESTAMP
  `;
  
  const params = [
    supplier_name, supplier_type, contact, contact_person, address,
    material_name, 
    haccp_certified !== undefined ? (haccp_certified ? 1 : 0) : null,
    is_imported !== undefined ? (is_imported ? 1 : 0) : null,
    business_number, email, memo
  ];
  
  if (/^\d+$/.test(supplier_code)) {
    updateQuery += ' WHERE id = ?';
    params.push(parseInt(supplier_code));
  } else {
    updateQuery += ' WHERE supplier_code = ?';
    params.push(supplier_code);
  }
  
  const result = await c.env.DB.prepare(updateQuery).bind(...params).run();
  
  if (result.meta.changes === 0) {
    return c.json({ success: false, error: '거래처를 찾을 수 없습니다.' }, 404);
  }
  return c.json({ success: true, message: '거래처가 수정되었습니다.' });
});

// 거래처 삭제
supplierRoutes.delete('/:supplier_code', async (c) => {
  const supplier_code = c.req.param('supplier_code');
  
  let result;
  if (/^\d+$/.test(supplier_code)) {
    result = await c.env.DB.prepare(
      'DELETE FROM suppliers WHERE id = ?'
    ).bind(parseInt(supplier_code)).run();
  } else {
    result = await c.env.DB.prepare(
      'DELETE FROM suppliers WHERE supplier_code = ?'
    ).bind(supplier_code).run();
  }
  
  if (result.meta.changes === 0) {
    return c.json({ success: false, error: '거래처를 찾을 수 없습니다.' }, 404);
  }
  return c.json({ success: true, message: '거래처가 삭제되었습니다.' });
});

// 거래처 통계
supplierRoutes.get('/stats/summary', async (c) => {
  const total = await c.env.DB.prepare('SELECT COUNT(*) as count FROM suppliers').first<{count: number}>();
  const haccp = await c.env.DB.prepare('SELECT COUNT(*) as count FROM suppliers WHERE haccp_certified = 1').first<{count: number}>();
  const imported = await c.env.DB.prepare('SELECT COUNT(*) as count FROM suppliers WHERE is_imported = 1').first<{count: number}>();
  
  return c.json({
    success: true,
    data: {
      total: total?.count || 0,
      haccp_certified: haccp?.count || 0,
      imported: imported?.count || 0
    }
  });
});

export default supplierRoutes;
