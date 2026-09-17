// ★★★ v3.6.185: 브랜드 마스터 (대표코드 BRD001~) ★★★
import { Hono } from 'hono';
import type { Bindings } from '../types';

const brands = new Hono<{ Bindings: Bindings }>();

// -----------------------------------------------
// GET /api/brands — 전체 브랜드 목록 (활성만)
// -----------------------------------------------
brands.get('/', async (c) => {
  try {
    const includeInactive = c.req.query('include_inactive') === '1';
    const search = (c.req.query('search') || '').trim();
    
    let query = `
      SELECT b.brand_code, b.brand_name, b.description, b.is_active,
             b.created_at, b.updated_at,
             (SELECT COUNT(*) FROM products_new WHERE brand_code = b.brand_code AND is_active = 1) as product_count
      FROM brands b
      WHERE 1=1
    `;
    const params: any[] = [];
    
    if (!includeInactive) {
      query += ` AND b.is_active = 1`;
    }
    if (search) {
      query += ` AND (b.brand_code LIKE ? OR b.brand_name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    query += ` ORDER BY b.brand_code ASC`;
    
    const result = await c.env.DB.prepare(query).bind(...params).all();
    return c.json({ success: true, data: result.results || [] });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// -----------------------------------------------
// GET /api/brands/:code — 단일 브랜드 상세
// -----------------------------------------------
brands.get('/:code', async (c) => {
  try {
    const code = c.req.param('code');
    const brand = await c.env.DB.prepare(
      `SELECT * FROM brands WHERE brand_code = ?`
    ).bind(code).first();
    
    if (!brand) return c.json({ success: false, error: '브랜드를 찾을 수 없습니다' }, 404);
    return c.json({ success: true, data: brand });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// -----------------------------------------------
// POST /api/brands — 브랜드 신규 등록 (자동 채번 BRD001~)
// -----------------------------------------------
brands.post('/', async (c) => {
  try {
    const { brand_name, description } = await c.req.json<any>();
    const name = (brand_name || '').trim();
    if (!name) return c.json({ success: false, error: '브랜드명은 필수입니다' }, 400);
    
    // 중복 체크: 활성 브랜드는 진짜 중복
    const activeDup = await c.env.DB.prepare(
      `SELECT brand_code FROM brands WHERE brand_name = ? AND is_active = 1`
    ).bind(name).first();
    if (activeDup) return c.json({ success: false, error: `이미 등록된 브랜드입니다: ${(activeDup as any).brand_code}` }, 409);
    
    // 비활성 브랜드가 있으면 재활성화 (같은 코드 유지)
    const inactiveDup = await c.env.DB.prepare(
      `SELECT brand_code FROM brands WHERE brand_name = ? AND is_active = 0`
    ).bind(name).first();
    if (inactiveDup) {
      const oldCode = (inactiveDup as any).brand_code;
      await c.env.DB.prepare(
        `UPDATE brands SET is_active = 1, description = ?, updated_at = CURRENT_TIMESTAMP WHERE brand_code = ?`
      ).bind(description || null, oldCode).run();
      return c.json({ success: true, brand_code: oldCode, brand_name: name, reactivated: true });
    }
    
    // 채번: BRD001, BRD002...
    const nextCode = await getNextCode(c.env.DB, 'BRD');
    
    await c.env.DB.prepare(
      `INSERT INTO brands (brand_code, brand_name, description) VALUES (?, ?, ?)`
    ).bind(nextCode, name, description || null).run();
    
    return c.json({ success: true, brand_code: nextCode, brand_name: name });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// -----------------------------------------------
// PUT /api/brands/:code — 브랜드 수정
// -----------------------------------------------
brands.put('/:code', async (c) => {
  try {
    const code = c.req.param('code');
    const { brand_name, description, is_active } = await c.req.json<any>();
    
    const exists = await c.env.DB.prepare(`SELECT brand_code FROM brands WHERE brand_code = ?`).bind(code).first();
    if (!exists) return c.json({ success: false, error: '브랜드가 없습니다' }, 404);
    
    await c.env.DB.prepare(`
      UPDATE brands 
         SET brand_name = COALESCE(?, brand_name),
             description = ?,
             is_active = COALESCE(?, is_active),
             updated_at = CURRENT_TIMESTAMP
       WHERE brand_code = ?
    `).bind(brand_name || null, description ?? null, is_active ?? null, code).run();
    
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// -----------------------------------------------
// DELETE /api/brands/:code — 브랜드 삭제 (Soft delete)
// -----------------------------------------------
brands.delete('/:code', async (c) => {
  try {
    const code = c.req.param('code');
    // 하위 제품 있으면 경고
    const cnt = await c.env.DB.prepare(
      `SELECT COUNT(*) as n FROM products_new WHERE brand_code = ? AND is_active = 1`
    ).bind(code).first();
    if (cnt && (cnt as any).n > 0) {
      return c.json({ success: false, error: `이 브랜드에 ${(cnt as any).n}개 제품이 있어 삭제할 수 없습니다.` }, 400);
    }
    
    await c.env.DB.prepare(
      `UPDATE brands SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE brand_code = ?`
    ).bind(code).run();
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// -----------------------------------------------
// 채번 함수 (BRD/PD 공통)
// -----------------------------------------------
export async function getNextCode(db: D1Database, prefix: string): Promise<string> {
  // code_sequences 테이블이 존재하고 초기값 있어야 함 (마이그레이션에서 처리)
  await db.prepare(
    `INSERT OR IGNORE INTO code_sequences (prefix, last_number) VALUES (?, 0)`
  ).bind(prefix).run();
  
  await db.prepare(
    `UPDATE code_sequences SET last_number = last_number + 1 WHERE prefix = ?`
  ).bind(prefix).run();
  
  const row = await db.prepare(
    `SELECT last_number FROM code_sequences WHERE prefix = ?`
  ).bind(prefix).first();
  
  const num = (row as any)?.last_number || 1;
  return `${prefix}${String(num).padStart(3, '0')}`;
}

export default brands;
