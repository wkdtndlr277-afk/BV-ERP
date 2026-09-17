// ★★★ v3.6.188: 채널별 SKU 관리 (product_channels) ★★★
// 같은 상품이 여러 채널(쿠팡/네이버/오프라인 등)로 판매될 때 채널별로 코드/바코드/가격 관리
import { Hono } from 'hono';
import type { Bindings } from '../types';

const productChannels = new Hono<{ Bindings: Bindings }>();

// -----------------------------------------------
// GET /api/product-channels?product_code=PD001 — 특정 상품의 전체 채널 목록
// GET /api/product-channels — 전체 채널 SKU 목록 (관리자용)
// -----------------------------------------------
productChannels.get('/', async (c) => {
  try {
    const productCode = (c.req.query('product_code') || '').trim();
    const channelName = (c.req.query('channel_name') || '').trim();
    const search = (c.req.query('search') || '').trim();
    
    let query = `
      SELECT pc.*, p.product_name, p.brand_code, b.brand_name
      FROM product_channels pc
      LEFT JOIN products_new p ON pc.product_code = p.product_code
      LEFT JOIN brands b ON p.brand_code = b.brand_code
      WHERE pc.is_active = 1
    `;
    const params: any[] = [];
    if (productCode) { query += ` AND pc.product_code = ?`; params.push(productCode); }
    if (channelName) { query += ` AND pc.channel_name = ?`; params.push(channelName); }
    if (search) {
      query += ` AND (pc.channel_code LIKE ? OR pc.channel_sku LIKE ? OR pc.channel_barcode LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    query += ` ORDER BY pc.product_code ASC, pc.channel_name ASC`;
    
    const rows = await c.env.DB.prepare(query).bind(...params).all();
    return c.json({ success: true, data: rows.results || [] });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// -----------------------------------------------
// GET /api/product-channels/:code — 단일 채널 SKU 상세
// -----------------------------------------------
productChannels.get('/:code', async (c) => {
  try {
    const code = c.req.param('code');
    const row = await c.env.DB.prepare(
      `SELECT pc.*, p.product_name, p.brand_code, b.brand_name
       FROM product_channels pc
       LEFT JOIN products_new p ON pc.product_code = p.product_code
       LEFT JOIN brands b ON p.brand_code = b.brand_code
       WHERE pc.channel_code = ?`
    ).bind(code).first();
    if (!row) return c.json({ success: false, error: '채널 SKU 없음' }, 404);
    return c.json({ success: true, data: row });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// -----------------------------------------------
// POST /api/product-channels — 채널 SKU 등록
// 자동 코드: {product_code}-{연속번호 2자리}, 예: PD001-01, PD001-02
// -----------------------------------------------
productChannels.post('/', async (c) => {
  try {
    const body = await c.req.json<any>();
    const {
      product_code, channel_name, channel_sku, channel_barcode,
      channel_price, channel_url, channel_memo
    } = body;
    
    if (!product_code) return c.json({ success: false, error: 'product_code 필수' }, 400);
    if (!channel_name || !String(channel_name).trim()) return c.json({ success: false, error: '판매채널명 필수' }, 400);
    
    // 상품 존재 확인
    const prod = await c.env.DB.prepare(`SELECT product_code FROM products_new WHERE product_code = ? AND is_active = 1`).bind(product_code).first();
    if (!prod) return c.json({ success: false, error: '해당 상품이 없습니다' }, 404);
    
    // 동일 상품 + 동일 채널명 활성 중복 방지
    const dup = await c.env.DB.prepare(
      `SELECT channel_code FROM product_channels WHERE product_code = ? AND channel_name = ? AND is_active = 1`
    ).bind(product_code, channel_name.trim()).first();
    if (dup) return c.json({ success: false, error: `이미 등록된 채널입니다: ${(dup as any).channel_code}` }, 409);
    
    // 채널 코드 채번: PD001-01, PD001-02 ...
    const existing = await c.env.DB.prepare(
      `SELECT channel_code FROM product_channels WHERE product_code = ?`
    ).bind(product_code).all();
    let maxSeq = 0;
    for (const r of (existing.results || [])) {
      const m = String((r as any).channel_code).match(/-(\d+)$/);
      if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
    }
    const nextSeq = maxSeq + 1;
    const channelCode = `${product_code}-${String(nextSeq).padStart(2, '0')}`;
    
    await c.env.DB.prepare(
      `INSERT INTO product_channels 
       (channel_code, product_code, channel_name, channel_sku, channel_barcode, channel_price, channel_url, channel_memo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      channelCode,
      product_code,
      channel_name.trim(),
      channel_sku || null,
      channel_barcode || null,
      channel_price != null && channel_price !== '' ? Number(channel_price) : null,
      channel_url || null,
      channel_memo || null
    ).run();
    
    return c.json({ success: true, channel_code: channelCode });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// -----------------------------------------------
// PUT /api/product-channels/:code — 채널 SKU 수정
// -----------------------------------------------
productChannels.put('/:code', async (c) => {
  try {
    const code = c.req.param('code');
    const body = await c.req.json<any>();
    
    const exists = await c.env.DB.prepare(`SELECT channel_code FROM product_channels WHERE channel_code = ?`).bind(code).first();
    if (!exists) return c.json({ success: false, error: '채널 SKU 없음' }, 404);
    
    const fields = ['channel_name', 'channel_sku', 'channel_barcode', 'channel_price', 'channel_url', 'channel_memo'];
    const sets: string[] = [];
    const params: any[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) {
        sets.push(`${f} = ?`);
        if (f === 'channel_price') params.push(body[f] === '' || body[f] == null ? null : Number(body[f]));
        else params.push(body[f] || null);
      }
    }
    if (sets.length === 0) return c.json({ success: false, error: '수정할 필드 없음' }, 400);
    sets.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(code);
    
    await c.env.DB.prepare(
      `UPDATE product_channels SET ${sets.join(', ')} WHERE channel_code = ?`
    ).bind(...params).run();
    
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// -----------------------------------------------
// DELETE /api/product-channels/:code — 채널 SKU 삭제 (soft)
// -----------------------------------------------
productChannels.delete('/:code', async (c) => {
  try {
    const code = c.req.param('code');
    const exists = await c.env.DB.prepare(`SELECT channel_code FROM product_channels WHERE channel_code = ?`).bind(code).first();
    if (!exists) return c.json({ success: false, error: '채널 SKU 없음' }, 404);
    
    await c.env.DB.prepare(`UPDATE product_channels SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE channel_code = ?`).bind(code).run();
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// -----------------------------------------------
// GET /api/product-channels/meta/channels — 등록된 채널 이름 목록 (자동완성용)
// -----------------------------------------------
productChannels.get('/meta/channels', async (c) => {
  try {
    const rows = await c.env.DB.prepare(
      `SELECT DISTINCT channel_name FROM product_channels WHERE is_active = 1 AND channel_name IS NOT NULL ORDER BY channel_name`
    ).all();
    return c.json({ success: true, channels: (rows.results || []).map((r: any) => r.channel_name) });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default productChannels;
