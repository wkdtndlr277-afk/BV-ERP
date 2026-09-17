// ★★★ v3.6.185: 새 제품 관리 (PD001~ 자동 채번, 브랜드 FK, R2 사진/바코드) ★★★
import { Hono } from 'hono';
import type { Bindings } from '../types';
import { getNextCode } from './brands';

const productsV2 = new Hono<{ Bindings: Bindings }>();

// -----------------------------------------------
// GET /api/products-v2 — 목록 조회 (검색/필터/브랜드/채널)
// -----------------------------------------------
productsV2.get('/', async (c) => {
  try {
    const search = (c.req.query('search') || '').trim();
    const brand = c.req.query('brand_code');
    const channel = c.req.query('channel');
    const includeInactive = c.req.query('include_inactive') === '1';
    
    let query = `
      SELECT p.*, b.brand_name
      FROM products_new p
      LEFT JOIN brands b ON p.brand_code = b.brand_code
      WHERE 1=1
    `;
    const params: any[] = [];
    
    if (!includeInactive) query += ` AND p.is_active = 1`;
    if (brand) { query += ` AND p.brand_code = ?`; params.push(brand); }
    // v3.6.188: 채널 필터는 product_channels 기준으로 변경 (하위 SKU 존재 여부)
    if (channel) {
      query += ` AND EXISTS (
        SELECT 1 FROM product_channels pc
        WHERE pc.product_code = p.product_code
          AND pc.channel_name = ?
          AND pc.is_active = 1
      )`;
      params.push(channel);
    }
    if (search) {
      query += ` AND (
        p.product_code LIKE ? OR p.product_name LIKE ? OR p.barcode_number LIKE ? OR b.brand_name LIKE ?
        OR EXISTS (SELECT 1 FROM product_channels pc WHERE pc.product_code = p.product_code AND pc.is_active = 1
          AND (pc.channel_code LIKE ? OR pc.channel_sku LIKE ? OR pc.channel_barcode LIKE ?))
      )`;
      const s = `%${search}%`;
      params.push(s, s, s, s, s, s, s);
    }
    query += ` ORDER BY p.brand_code ASC, p.product_code ASC`;
    
    const result = await c.env.DB.prepare(query).bind(...params).all();
    const products = (result.results || []) as any[];
    
    // 각 상품의 채널 SKU 목록을 첨부
    if (products.length > 0) {
      const productCodes = products.map(p => p.product_code);
      // D1 IN 절: placeholder만들기
      const placeholders = productCodes.map(() => '?').join(',');
      const channelRows = await c.env.DB.prepare(
        `SELECT * FROM product_channels WHERE product_code IN (${placeholders}) AND is_active = 1 ORDER BY channel_code`
      ).bind(...productCodes).all();
      
      // 상품별로 그룹핑
      const byProduct: Record<string, any[]> = {};
      for (const c2 of (channelRows.results || []) as any[]) {
        if (!byProduct[c2.product_code]) byProduct[c2.product_code] = [];
        byProduct[c2.product_code].push(c2);
      }
      for (const p of products) {
        p.channels = byProduct[p.product_code] || [];
      }
    }
    
    // 판매채널 필터 목록 (product_channels 기준)
    const channels = await c.env.DB.prepare(
      `SELECT DISTINCT channel_name FROM product_channels WHERE channel_name IS NOT NULL AND channel_name != '' AND is_active = 1 ORDER BY channel_name`
    ).all();
    
    return c.json({
      success: true,
      data: products,
      channels: (channels.results || []).map((r: any) => r.channel_name)
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// -----------------------------------------------
// GET /api/products-v2/:code — 단일 제품 상세
// -----------------------------------------------
productsV2.get('/:code', async (c) => {
  try {
    const code = c.req.param('code');
    const row = await c.env.DB.prepare(`
      SELECT p.*, b.brand_name FROM products_new p
      LEFT JOIN brands b ON p.brand_code = b.brand_code
      WHERE p.product_code = ?
    `).bind(code).first();
    
    if (!row) return c.json({ success: false, error: '제품 없음' }, 404);
    return c.json({ success: true, data: row });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// -----------------------------------------------
// POST /api/products-v2 — 신규 제품 등록 (자동 채번 PD001~)
// -----------------------------------------------
productsV2.post('/', async (c) => {
  try {
    const body = await c.req.json<any>();
    const {
      brand_code, product_name, sales_channel, recipe_name,
      photo_url, photo_filename, barcode_number, barcode_image_url, barcode_filename,
      manufacture_report_no, storage_method, shelf_life, shelf_life_condition,
      package_unit, package_size, package_material, box_size, box_qty,
      ingredients, product_size, memo
    } = body;
    
    if (!brand_code) return c.json({ success: false, error: '브랜드는 필수입니다' }, 400);
    if (!product_name) return c.json({ success: false, error: '제품명은 필수입니다' }, 400);
    
    // 브랜드 존재 확인
    const brand = await c.env.DB.prepare(`SELECT brand_code FROM brands WHERE brand_code = ? AND is_active = 1`).bind(brand_code).first();
    if (!brand) return c.json({ success: false, error: '브랜드가 없습니다' }, 400);
    
    // 채번
    const nextCode = await getNextCode(c.env.DB, 'PD');
    
    await c.env.DB.prepare(`
      INSERT INTO products_new (
        product_code, brand_code, product_name, sales_channel, recipe_name,
        photo_url, photo_filename, barcode_number, barcode_image_url, barcode_filename,
        manufacture_report_no, storage_method, shelf_life, shelf_life_condition,
        package_unit, package_size, package_material, box_size, box_qty,
        ingredients, product_size, memo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      nextCode, brand_code, product_name.trim(), sales_channel || null, recipe_name || null,
      photo_url || null, photo_filename || null, barcode_number || null, barcode_image_url || null, barcode_filename || null,
      manufacture_report_no || null, storage_method || null, shelf_life || null, shelf_life_condition || null,
      package_unit || null, package_size || null, package_material || null, box_size || null, box_qty || null,
      ingredients || null, product_size || null, memo || null
    ).run();
    
    return c.json({ success: true, product_code: nextCode });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// -----------------------------------------------
// PUT /api/products-v2/:code — 제품 수정
// -----------------------------------------------
productsV2.put('/:code', async (c) => {
  try {
    const code = c.req.param('code');
    const body = await c.req.json<any>();
    
    const exists = await c.env.DB.prepare(`SELECT product_code FROM products_new WHERE product_code = ?`).bind(code).first();
    if (!exists) return c.json({ success: false, error: '제품 없음' }, 404);
    
    await c.env.DB.prepare(`
      UPDATE products_new SET
        brand_code = COALESCE(?, brand_code),
        product_name = COALESCE(?, product_name),
        sales_channel = ?,
        recipe_name = ?,
        photo_url = ?,
        photo_filename = ?,
        barcode_number = ?,
        barcode_image_url = ?,
        barcode_filename = ?,
        manufacture_report_no = ?,
        storage_method = ?,
        shelf_life = ?,
        shelf_life_condition = ?,
        package_unit = ?,
        package_size = ?,
        package_material = ?,
        box_size = ?,
        box_qty = ?,
        ingredients = ?,
        product_size = ?,
        memo = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE product_code = ?
    `).bind(
      body.brand_code || null,
      body.product_name || null,
      body.sales_channel ?? null,
      body.recipe_name ?? null,
      body.photo_url ?? null,
      body.photo_filename ?? null,
      body.barcode_number ?? null,
      body.barcode_image_url ?? null,
      body.barcode_filename ?? null,
      body.manufacture_report_no ?? null,
      body.storage_method ?? null,
      body.shelf_life ?? null,
      body.shelf_life_condition ?? null,
      body.package_unit ?? null,
      body.package_size ?? null,
      body.package_material ?? null,
      body.box_size ?? null,
      body.box_qty ?? null,
      body.ingredients ?? null,
      body.product_size ?? null,
      body.memo ?? null,
      code
    ).run();
    
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// -----------------------------------------------
// DELETE /api/products-v2/:code — 제품 삭제 (Soft delete)
// -----------------------------------------------
productsV2.delete('/:code', async (c) => {
  try {
    const code = c.req.param('code');
    await c.env.DB.prepare(
      `UPDATE products_new SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE product_code = ?`
    ).bind(code).run();
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// -----------------------------------------------
// GET /api/products-v2/meta/channels — 채널 목록 (필터 옵션)
// -----------------------------------------------
productsV2.get('/meta/channels', async (c) => {
  try {
    const rows = await c.env.DB.prepare(
      `SELECT DISTINCT sales_channel FROM products_new WHERE sales_channel IS NOT NULL AND sales_channel != '' AND is_active = 1 ORDER BY sales_channel`
    ).all();
    return c.json({ success: true, channels: (rows.results || []).map((r: any) => r.sales_channel) });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default productsV2;
