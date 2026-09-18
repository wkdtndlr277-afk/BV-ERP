// ★★★ v3.6.188: 채널별 SKU 관리 (product_channels) ★★★
// v3.6.190: 채널 약자 코드 부여 (PD001-CP01, PD001-OA01 형식)
// 같은 상품이 여러 채널(쿠팡/네이버/오프라인 등)로 판매될 때 채널별로 코드/바코드/가격 관리
import { Hono } from 'hono';
import type { Bindings } from '../types';

const productChannels = new Hono<{ Bindings: Bindings }>();

// 채널명 → 약자 매핑 (v3.6.190)
const CHANNEL_ABBR_MAP: { [key: string]: string } = {
  '쿠팡': 'CP',
  'coupang': 'CP',
  '네이버': 'NV',
  'naver': 'NV',
  '네이버스마트스토어': 'NV',
  '스마트스토어': 'NV',
  '오아시스': 'OA',
  'oasis': 'OA',
  'CJ': 'CJ',
  'cj': 'CJ',
  'CJ온스타일': 'CJ',
  'CJ오쇼핑': 'CJ',
  '롯데': 'LT',
  'lotte': 'LT',
  '롯데온': 'LT',
  '롯데마트': 'LT',
  '컬리': 'KL',
  'kurly': 'KL',
  '마켓컬리': 'KL',
  '이마트': 'EM',
  'emart': 'EM',
  '홈플러스': 'HP',
  'homeplus': 'HP',
  'SSG': 'SG',
  'ssg': 'SG',
  '11번가': '11',
  'GS': 'GS',
  'gs': 'GS',
  'GS샵': 'GS',
  '현대': 'HD',
  '현대홈쇼핑': 'HD',
  'hyundai': 'HD',
  '카카오': 'KK',
  'kakao': 'KK',
  '카카오톡선물하기': 'KK',
  '오프라인': 'OF',
  'offline': 'OF',
  '자사몰': 'OW',
  '자사': 'OW',
  '위메프': 'WM',
  'wemakeprice': 'WM',
  '티몬': 'TM',
  'tmon': 'TM',
  '알리익스프레스': 'AL',
  'aliexpress': 'AL',
  '아마존': 'AZ',
  'amazon': 'AZ',
};

// 채널명 → 약자 자동 변환 (한글/영문 대소문자 무시)
function getChannelAbbr(channelName: string, customAbbr?: string): string {
  if (customAbbr && customAbbr.trim()) {
    // 사용자 지정 약자 (영문+숫자만, 2~3자 권장)
    const clean = customAbbr.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return clean.substring(0, 3) || 'XX';
  }
  const trimmed = channelName.trim();
  // 정확 매칭
  if (CHANNEL_ABBR_MAP[trimmed]) return CHANNEL_ABBR_MAP[trimmed];
  // 소문자 매칭
  const lower = trimmed.toLowerCase();
  if (CHANNEL_ABBR_MAP[lower]) return CHANNEL_ABBR_MAP[lower];
  // 부분 매칭 (채널명에 키워드 포함)
  for (const [key, abbr] of Object.entries(CHANNEL_ABBR_MAP)) {
    if (trimmed.includes(key) || lower.includes(key.toLowerCase())) return abbr;
  }
  // 기본: 첫 글자를 영문 대문자로 (한글이면 XX)
  const asciiFirst = trimmed.match(/[A-Za-z]/);
  if (asciiFirst) return trimmed.substring(0, 2).toUpperCase();
  return 'XX';
}

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
      product_code, channel_name, channel_abbr, channel_sku, channel_barcode,
      channel_price, channel_url, channel_memo,
      channel_package_unit, channel_package_size,
      channel_product_name, channel_box_size, channel_box_qty, channel_product_size,
      channel_barcode_image_url, channel_barcode_filename,
      // v3.6.195: 채널별 사진/보관방법/품목제조번호 (같은 규격이라도 채널마다 다를 수 있음)
      channel_photo_url, channel_photo_filename,
      channel_storage_method, channel_manufacture_report_no,
      // v3.6.196: 파생 SKU 고유 코드 (PD001-01 형식) + 채널별 원재료명
      sku_code, channel_ingredients
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
    
    // v3.6.190: 채널 약자 계산 (예: 쿠팡 → CP)
    const abbr = getChannelAbbr(channel_name, channel_abbr);
    
    // 채널 코드 채번: PD001-CP01, PD001-CP02, PD001-OA01 ...
    // 동일 상품 + 동일 약자 내에서 연번 부여
    const existing = await c.env.DB.prepare(
      `SELECT channel_code FROM product_channels WHERE product_code = ?`
    ).bind(product_code).all();
    let maxSeq = 0;
    const abbrPattern = new RegExp(`-${abbr}(\\d+)$`);
    const legacyPattern = /-(\d+)$/; // 구버전 (v3.6.188) 코드 호환
    for (const r of (existing.results || [])) {
      const code = String((r as any).channel_code);
      const m1 = code.match(abbrPattern);
      if (m1) {
        maxSeq = Math.max(maxSeq, parseInt(m1[1], 10));
      } else {
        // 구버전 코드 (PD001-01) 는 CP 등 특정 약자와 무관하므로 스킵
        // 단 abbr이 없는 경우(레거시)만 참조
      }
    }
    const nextSeq = maxSeq + 1;
    const channelCode = `${product_code}-${abbr}${String(nextSeq).padStart(2, '0')}`;
    
    // v3.6.196: 파생 SKU 고유코드 (sku_code) 채번
    // 형식: {product_code}-{2자리 연번} (예: PD001-01, PD001-02)
    // 사용자 지정 값이 있으면 그대로 사용 + 중복 체크
    // 비어있으면 해당 product_code 내에서 다음 순번 자동 생성
    let finalSkuCode: string | null = null;
    if (sku_code && String(sku_code).trim()) {
      const trimmed = String(sku_code).trim();
      // 동일 product_code 내에서 sku_code 중복 체크 (활성 채널만)
      const skuDup = await c.env.DB.prepare(
        `SELECT channel_code FROM product_channels WHERE product_code = ? AND sku_code = ? AND is_active = 1`
      ).bind(product_code, trimmed).first();
      if (skuDup) {
        return c.json({ success: false, error: `이미 사용중인 SKU 코드입니다: ${trimmed} (${(skuDup as any).channel_code})` }, 409);
      }
      finalSkuCode = trimmed;
    } else {
      // 자동 생성: {product_code}-{연번 2자리}, 해당 product_code 내 max+1
      const skuRows = await c.env.DB.prepare(
        `SELECT sku_code FROM product_channels WHERE product_code = ? AND sku_code IS NOT NULL`
      ).bind(product_code).all();
      const skuPattern = new RegExp(`^${product_code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
      let maxSkuSeq = 0;
      for (const r of (skuRows.results || [])) {
        const s = String((r as any).sku_code || '');
        const m = s.match(skuPattern);
        if (m) maxSkuSeq = Math.max(maxSkuSeq, parseInt(m[1], 10));
      }
      const nextSkuSeq = maxSkuSeq + 1;
      finalSkuCode = `${product_code}-${String(nextSkuSeq).padStart(2, '0')}`;
    }
    
    await c.env.DB.prepare(
      `INSERT INTO product_channels 
       (channel_code, product_code, channel_name, channel_abbr, channel_sku, channel_barcode, channel_price, channel_url, channel_memo, 
        channel_package_unit, channel_package_size,
        channel_product_name, channel_box_size, channel_box_qty, channel_product_size,
        channel_barcode_image_url, channel_barcode_filename,
        channel_photo_url, channel_photo_filename,
        channel_storage_method, channel_manufacture_report_no,
        sku_code, channel_ingredients)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      channelCode,
      product_code,
      channel_name.trim(),
      abbr,
      channel_sku || null,
      channel_barcode || null,
      channel_price != null && channel_price !== '' ? Number(channel_price) : null,
      channel_url || null,
      channel_memo || null,
      channel_package_unit || null,
      channel_package_size || null,
      channel_product_name || null,
      channel_box_size || null,
      channel_box_qty || null,
      channel_product_size || null,
      channel_barcode_image_url || null,
      channel_barcode_filename || null,
      channel_photo_url || null,
      channel_photo_filename || null,
      channel_storage_method || null,
      channel_manufacture_report_no || null,
      finalSkuCode,
      channel_ingredients || null
    ).run();
    
    return c.json({ success: true, channel_code: channelCode, channel_abbr: abbr, sku_code: finalSkuCode });
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
    
    const exists = await c.env.DB.prepare(`SELECT channel_code, product_code FROM product_channels WHERE channel_code = ?`).bind(code).first();
    if (!exists) return c.json({ success: false, error: '채널 SKU 없음' }, 404);
    
    // v3.6.196: sku_code 수정 시 동일 product_code 내 중복 체크
    if (body.sku_code !== undefined && body.sku_code !== null && String(body.sku_code).trim()) {
      const newSku = String(body.sku_code).trim();
      const productCodeOfChannel = (exists as any).product_code;
      const skuDup = await c.env.DB.prepare(
        `SELECT channel_code FROM product_channels WHERE product_code = ? AND sku_code = ? AND channel_code != ? AND is_active = 1`
      ).bind(productCodeOfChannel, newSku, code).first();
      if (skuDup) {
        return c.json({ success: false, error: `이미 사용중인 SKU 코드입니다: ${newSku} (${(skuDup as any).channel_code})` }, 409);
      }
      body.sku_code = newSku; // 정규화된 값 저장
    }
    
    const fields = ['channel_name', 'channel_abbr', 'channel_sku', 'channel_barcode', 'channel_price', 'channel_url', 'channel_memo',
      'channel_package_unit', 'channel_package_size',
      'channel_product_name', 'channel_box_size', 'channel_box_qty', 'channel_product_size',
      'channel_barcode_image_url', 'channel_barcode_filename',
      // v3.6.195
      'channel_photo_url', 'channel_photo_filename',
      'channel_storage_method', 'channel_manufacture_report_no',
      // v3.6.196
      'sku_code', 'channel_ingredients'];
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
    // 기본 제안 채널명 (신규 등록 시 자동완성 도움)
    const DEFAULT_CHANNELS = [
      '쿠팡', '네이버스마트스토어', '오아시스', 'CJ온스타일', '롯데온',
      '마켓컬리', '이마트', '홈플러스', 'SSG', '11번가', 'GS샵',
      '현대홈쇼핑', '카카오톡선물하기', '위메프', '티몬', '오프라인', '자사몰'
    ];
    const rows = await c.env.DB.prepare(
      `SELECT DISTINCT channel_name FROM product_channels WHERE is_active = 1 AND channel_name IS NOT NULL ORDER BY channel_name`
    ).all();
    const dbChannels = (rows.results || []).map((r: any) => r.channel_name);
    // DB 채널을 앞에, 기본 채널을 뒤에 (중복 제거)
    const merged = Array.from(new Set([...dbChannels, ...DEFAULT_CHANNELS]));
    return c.json({ success: true, channels: merged, db_channels: dbChannels, default_channels: DEFAULT_CHANNELS });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// -----------------------------------------------
// GET /api/product-channels/meta/abbr-map — 채널명 → 약자 매핑 (프론트 미리보기용)
// GET /api/product-channels/meta/preview-abbr?channel_name=쿠팡 — 특정 채널명의 약자 예상
// -----------------------------------------------
productChannels.get('/meta/abbr-map', async (c) => {
  return c.json({ success: true, map: CHANNEL_ABBR_MAP });
});

productChannels.get('/meta/preview-abbr', async (c) => {
  const name = c.req.query('channel_name') || '';
  const custom = c.req.query('channel_abbr') || '';
  if (!name.trim()) return c.json({ success: false, error: 'channel_name 필요' }, 400);
  const abbr = getChannelAbbr(name, custom);
  return c.json({ success: true, channel_name: name, channel_abbr: abbr });
});

export default productChannels;
