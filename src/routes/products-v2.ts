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
      brand_code, product_name, sales_channel, recipe_name, category,
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
        product_code, brand_code, product_name, sales_channel, recipe_name, category,
        photo_url, photo_filename, barcode_number, barcode_image_url, barcode_filename,
        manufacture_report_no, storage_method, shelf_life, shelf_life_condition,
        package_unit, package_size, package_material, box_size, box_qty,
        ingredients, product_size, memo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      nextCode, brand_code, product_name.trim(), sales_channel || null, recipe_name || null, category || null,
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
        category = ?,
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
      body.category ?? null,
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

// =====================================================================
// v3.8.6: 엑셀 다운로드/업로드 (표준 양식 · 금액/VAT 제외)
// =====================================================================

/**
 * GET /api/products-v2/export/rows — 다운로드용 평탄화 JSON
 *   - 1 행 = 1 (제품) 또는 1 (제품×채널) 조합
 *   - 채널 없는 제품은 1행 (채널 컬럼 공란)
 *   - 채널이 N개면 N행 (제품 공통정보 반복)
 *   - 가격/VAT 필드는 전부 제외 (standing rule)
 *   - 이미지/바코드이미지 URL도 제외 → ERP 에서 수동 등록
 */
productsV2.get('/export/rows', async (c) => {
  try {
    const includeInactive = c.req.query('include_inactive') === '1';

    const prodWhere = includeInactive ? '' : 'WHERE p.is_active = 1';
    const prodRows = await c.env.DB.prepare(`
      SELECT p.*, b.brand_name
      FROM products_new p
      LEFT JOIN brands b ON p.brand_code = b.brand_code
      ${prodWhere}
      ORDER BY p.brand_code ASC, p.product_code ASC
    `).all<any>();

    const products = (prodRows.results || []) as any[];

    // 채널 전체 로드 (1 쿼리)
    const chRows = await c.env.DB.prepare(`
      SELECT * FROM product_channels WHERE is_active = 1 ORDER BY product_code, channel_code
    `).all<any>();
    const byProduct: Record<string, any[]> = {};
    for (const ch of (chRows.results || []) as any[]) {
      (byProduct[ch.product_code] ||= []).push(ch);
    }

    // 평탄화
    const flat: any[] = [];
    for (const p of products) {
      const channels = byProduct[p.product_code] || [];
      if (channels.length === 0) {
        flat.push(flattenRow(p, null));
      } else {
        for (const ch of channels) {
          flat.push(flattenRow(p, ch));
        }
      }
    }

    return c.json({ success: true, data: flat, product_count: products.length, row_count: flat.length });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

/** 1 행 평탄화 (한글 컬럼 키 사용 → Excel 헤더 그대로) */
function flattenRow(p: any, ch: any | null): Record<string, any> {
  return {
    // ───── 제품 공통 ─────
    '대표코드': p.product_code || '',
    '브랜드코드': p.brand_code || '',
    '브랜드명': p.brand_name || '',
    '카테고리': p.category || '',
    '제품명': p.product_name || '',
    '레시피명': p.recipe_name || '',
    '품목제조보고번호': p.manufacture_report_no || '',
    '보관방법': p.storage_method || '',
    '유통기한': p.shelf_life || '',
    '유통기한조건': p.shelf_life_condition || '',
    '포장단위': p.package_unit || '',
    '포장중량(g)': p.package_size || '',
    '포장재질': p.package_material || '',
    '박스사이즈': p.box_size || '',
    '박스수량': p.box_qty || '',
    '제품사이즈': p.product_size || '',
    '원재료명': p.ingredients || '',
    '비고': p.memo || '',
    '활성여부': p.is_active == null ? 1 : p.is_active,
    // ───── 채널(판매처) ─────
    '채널코드': ch?.channel_code || '',
    '채널명': ch?.channel_name || '',
    '채널약어': ch?.channel_abbr || '',
    'SKU코드': ch?.sku_code || '',
    '채널SKU': ch?.channel_sku || '',
    '채널바코드': ch?.channel_barcode || '',
    '채널URL': ch?.channel_url || '',
    '채널제품명': ch?.channel_product_name || '',
    '채널포장단위': ch?.channel_package_unit || '',
    '채널포장중량(g)': ch?.channel_package_size || '',
    '채널박스사이즈': ch?.channel_box_size || '',
    '채널박스수량': ch?.channel_box_qty || '',
    '채널제품사이즈': ch?.channel_product_size || '',
    '채널보관방법': ch?.channel_storage_method || '',
    '채널품목제조보고번호': ch?.channel_manufacture_report_no || '',
    '채널원재료명': ch?.channel_ingredients || '',
    '채널비고': ch?.channel_memo || '',
  };
}

/**
 * POST /api/products-v2/import/rows — 엑셀에서 파싱한 JSON 업로드
 *   body: { rows: [{ 대표코드, 브랜드코드, 제품명, ...}] }
 *   매칭 규칙:
 *     - '대표코드' 있으면 UPDATE (제품), 없으면 INSERT (자동 채번)
 *     - '채널코드' 있으면 UPDATE (채널), '채널명'만 있으면 INSERT (자동 채번)
 *     - '채널명' 공란이면 채널 처리 스킵 (제품만 등록/수정)
 *     - '브랜드코드' 가 brands 테이블에 없으면 에러 (브랜드 자동생성 X)
 *   재업로드 금지 규정(중복 누적 X): 모든 매칭은 코드 기반 upsert
 */
productsV2.post('/import/rows', async (c) => {
  try {
    const body = await c.req.json<any>();
    const rows: any[] = Array.isArray(body?.rows) ? body.rows : [];
    if (rows.length === 0) return c.json({ success: false, error: '업로드할 행이 없습니다' }, 400);
    if (rows.length > 2000) return c.json({ success: false, error: '한 번에 최대 2000행까지 가능합니다' }, 400);

    const db = c.env.DB;
    const result = {
      total: rows.length,
      product_inserted: 0,
      product_updated: 0,
      product_skipped: 0,
      channel_inserted: 0,
      channel_updated: 0,
      channel_skipped: 0,
      errors: [] as Array<{ row: number; message: string }>,
    };

    // 브랜드 사전 로드 (검증용)
    const brandRows = await db.prepare(`SELECT brand_code FROM brands WHERE is_active = 1`).all<any>();
    const validBrands = new Set((brandRows.results || []).map((b: any) => b.brand_code));

    // 중복 등록 방지: 같은 import 내에서 (brand_code+product_name) 조합이 두 번 이상 나오면
    // 두 번째부터는 첫 번째에서 생성/매칭된 product_code 를 재사용 (스택 금지)
    const createdInThisImport = new Map<string, string>(); // key = brand_code|product_name → product_code

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNo = i + 2; // 엑셀 기준 (헤더 포함)
      try {
        // ───── 제품 upsert ─────
        const code = s(r['대표코드']);
        const brand = s(r['브랜드코드']);
        const name = s(r['제품명']);

        let productCode = code;

        if (code) {
          // UPDATE 모드
          const exists = await db.prepare(`SELECT product_code FROM products_new WHERE product_code = ?`).bind(code).first();
          if (!exists) {
            result.errors.push({ row: rowNo, message: `대표코드 ${code} 없음 (업데이트 불가, 비워두면 신규로 등록됨)` });
            result.product_skipped++;
            productCode = ''; // 채널 처리도 스킵
          } else {
            if (brand && !validBrands.has(brand)) {
              result.errors.push({ row: rowNo, message: `브랜드코드 ${brand} 없음 (brands 테이블에 먼저 등록 필요)` });
              result.product_skipped++;
              productCode = '';
            } else {
              await db.prepare(`
                UPDATE products_new SET
                  brand_code = COALESCE(?, brand_code),
                  product_name = COALESCE(?, product_name),
                  category = ?, recipe_name = ?,
                  manufacture_report_no = ?, storage_method = ?,
                  shelf_life = ?, shelf_life_condition = ?,
                  package_unit = ?, package_size = ?, package_material = ?,
                  box_size = ?, box_qty = ?, product_size = ?,
                  ingredients = ?, memo = ?, is_active = ?,
                  updated_at = CURRENT_TIMESTAMP
                WHERE product_code = ?
              `).bind(
                brand || null,
                name || null,
                nullable(r['카테고리']), nullable(r['레시피명']),
                nullable(r['품목제조보고번호']), nullable(r['보관방법']),
                nullable(r['유통기한']), nullable(r['유통기한조건']),
                nullable(r['포장단위']), nullable(r['포장중량(g)']), nullable(r['포장재질']),
                nullable(r['박스사이즈']), nullable(r['박스수량']), nullable(r['제품사이즈']),
                nullable(r['원재료명']), nullable(r['비고']),
                parseActive(r['활성여부']),
                code
              ).run();
              result.product_updated++;
            }
          }
        } else if (name && brand) {
          // INSERT 모드 (대표코드 공란)
          if (!validBrands.has(brand)) {
            result.errors.push({ row: rowNo, message: `브랜드코드 ${brand} 없음 (brands 테이블에 먼저 등록 필요)` });
            result.product_skipped++;
            continue;
          }
          // 같은 import 내 중복 체크 (brand|name)
          const dedupKey = `${brand}|${name}`;
          if (createdInThisImport.has(dedupKey)) {
            productCode = createdInThisImport.get(dedupKey)!;
          } else {
            // DB 중복 체크 (brand_code + product_name 같은 활성 제품 있으면 재사용)
            const existing = await db.prepare(
              `SELECT product_code FROM products_new WHERE brand_code = ? AND product_name = ? AND is_active = 1 LIMIT 1`
            ).bind(brand, name).first<any>();
            if (existing) {
              productCode = existing.product_code;
              createdInThisImport.set(dedupKey, productCode);
              result.product_skipped++;
            } else {
              productCode = await getNextCode(db, 'PD');
              await db.prepare(`
                INSERT INTO products_new (
                  product_code, brand_code, product_name,
                  category, recipe_name, manufacture_report_no, storage_method,
                  shelf_life, shelf_life_condition,
                  package_unit, package_size, package_material,
                  box_size, box_qty, product_size,
                  ingredients, memo, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).bind(
                productCode, brand, name,
                nullable(r['카테고리']), nullable(r['레시피명']),
                nullable(r['품목제조보고번호']), nullable(r['보관방법']),
                nullable(r['유통기한']), nullable(r['유통기한조건']),
                nullable(r['포장단위']), nullable(r['포장중량(g)']), nullable(r['포장재질']),
                nullable(r['박스사이즈']), nullable(r['박스수량']), nullable(r['제품사이즈']),
                nullable(r['원재료명']), nullable(r['비고']),
                parseActive(r['활성여부'])
              ).run();
              createdInThisImport.set(dedupKey, productCode);
              result.product_inserted++;
            }
          }
        } else {
          // 대표코드도 없고 (브랜드코드+제품명)도 없음 → 스킵
          result.product_skipped++;
          if (!name) result.errors.push({ row: rowNo, message: '제품명 공란' });
          else if (!brand) result.errors.push({ row: rowNo, message: '브랜드코드 공란 (신규 등록 불가)' });
          continue;
        }

        // ───── 채널 upsert (productCode 가 확정된 경우만) ─────
        if (!productCode) continue;
        const chCode = s(r['채널코드']);
        const chName = s(r['채널명']);
        if (!chName && !chCode) continue; // 채널 정보 없음 → 스킵

        if (chCode) {
          // 채널 UPDATE
          const chExists = await db.prepare(`SELECT channel_code FROM product_channels WHERE channel_code = ?`).bind(chCode).first();
          if (!chExists) {
            result.errors.push({ row: rowNo, message: `채널코드 ${chCode} 없음` });
            result.channel_skipped++;
            continue;
          }
          await db.prepare(`
            UPDATE product_channels SET
              channel_name = COALESCE(?, channel_name),
              channel_abbr = COALESCE(?, channel_abbr),
              channel_sku = ?, channel_barcode = ?, channel_url = ?,
              channel_product_name = ?,
              channel_package_unit = ?, channel_package_size = ?,
              channel_box_size = ?, channel_box_qty = ?, channel_product_size = ?,
              channel_storage_method = ?, channel_manufacture_report_no = ?,
              channel_ingredients = ?, channel_memo = ?,
              sku_code = COALESCE(?, sku_code),
              updated_at = CURRENT_TIMESTAMP
            WHERE channel_code = ?
          `).bind(
            chName || null,
            nullable(r['채널약어']),
            nullable(r['채널SKU']), nullable(r['채널바코드']), nullable(r['채널URL']),
            nullable(r['채널제품명']),
            nullable(r['채널포장단위']), nullable(r['채널포장중량(g)']),
            nullable(r['채널박스사이즈']), nullable(r['채널박스수량']), nullable(r['채널제품사이즈']),
            nullable(r['채널보관방법']), nullable(r['채널품목제조보고번호']),
            nullable(r['채널원재료명']), nullable(r['채널비고']),
            nullable(r['SKU코드']),
            chCode
          ).run();
          result.channel_updated++;
        } else if (chName) {
          // 채널 INSERT (자동 채번)
          const abbr = s(r['채널약어']) || deriveAbbr(chName);
          // 동일 상품+채널명 중복 체크
          const dup = await db.prepare(
            `SELECT channel_code FROM product_channels WHERE product_code = ? AND channel_name = ? AND is_active = 1`
          ).bind(productCode, chName).first();
          if (dup) {
            result.errors.push({ row: rowNo, message: `${productCode} 에 이미 ${chName} 채널 있음 (${(dup as any).channel_code}) — 업데이트하려면 채널코드 입력` });
            result.channel_skipped++;
            continue;
          }
          // 채널코드 채번: {product_code}-{abbr}{nn}
          const existing = await db.prepare(
            `SELECT channel_code FROM product_channels WHERE product_code = ?`
          ).bind(productCode).all<any>();
          const pat = new RegExp(`-${abbr}(\\d+)$`);
          let maxSeq = 0;
          for (const r2 of (existing.results || []) as any[]) {
            const m = String(r2.channel_code || '').match(pat);
            if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
          }
          const newChCode = `${productCode}-${abbr}${String(maxSeq + 1).padStart(2, '0')}`;
          // sku_code 자동 or 사용자 지정
          let skuCode = s(r['SKU코드']) || null;
          if (!skuCode) {
            const skuRows = await db.prepare(
              `SELECT sku_code FROM product_channels WHERE product_code = ? AND sku_code IS NOT NULL`
            ).bind(productCode).all<any>();
            const skuPat = new RegExp(`^${productCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
            let maxSkuSeq = 0;
            for (const r3 of (skuRows.results || []) as any[]) {
              const m = String(r3.sku_code || '').match(skuPat);
              if (m) maxSkuSeq = Math.max(maxSkuSeq, parseInt(m[1], 10));
            }
            skuCode = `${productCode}-${String(maxSkuSeq + 1).padStart(2, '0')}`;
          }

          await db.prepare(`
            INSERT INTO product_channels (
              channel_code, product_code, channel_name, channel_abbr,
              channel_sku, channel_barcode, channel_url,
              channel_product_name,
              channel_package_unit, channel_package_size,
              channel_box_size, channel_box_qty, channel_product_size,
              channel_storage_method, channel_manufacture_report_no,
              channel_ingredients, channel_memo,
              sku_code, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          `).bind(
            newChCode, productCode, chName, abbr,
            nullable(r['채널SKU']), nullable(r['채널바코드']), nullable(r['채널URL']),
            nullable(r['채널제품명']),
            nullable(r['채널포장단위']), nullable(r['채널포장중량(g)']),
            nullable(r['채널박스사이즈']), nullable(r['채널박스수량']), nullable(r['채널제품사이즈']),
            nullable(r['채널보관방법']), nullable(r['채널품목제조보고번호']),
            nullable(r['채널원재료명']), nullable(r['채널비고']),
            skuCode
          ).run();
          result.channel_inserted++;
        }
      } catch (rowErr: any) {
        result.errors.push({ row: rowNo, message: rowErr.message || String(rowErr) });
      }
    }

    return c.json({ success: true, result });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ───── 유틸 ─────
function s(v: any): string {
  if (v == null) return '';
  return String(v).trim();
}
function nullable(v: any): string | number | null {
  if (v == null) return null;
  const str = String(v).trim();
  if (str === '' || str === '-') return null;
  return str;
}
function parseActive(v: any): number {
  if (v == null || v === '') return 1;
  const n = Number(v);
  if (!isNaN(n)) return n === 0 ? 0 : 1;
  const low = String(v).toLowerCase().trim();
  if (['n', 'no', 'false', '비활성', '0', '아니오'].includes(low)) return 0;
  return 1;
}
// 채널명 → 영문 약어 (간단 매핑, 없으면 처음 2글자)
function deriveAbbr(name: string): string {
  const map: Record<string, string> = {
    '쿠팡': 'CP', '네이버': 'NV', '네이버스마트스토어': 'NV', '컬리': 'KL', '마켓컬리': 'KL',
    '카카오': 'KK', '카카오톡': 'KK', '카카오톡스토어': 'KK', '11번가': 'EL',
    '지마켓': 'GM', '옥션': 'AU', '위메프': 'WM', '티몬': 'TM',
    '오아시스': 'OA', 'SSG': 'SS', '쇼피파이': 'SP', '자사몰': 'OW', '자사': 'OW',
  };
  if (map[name]) return map[name];
  // ASCII 알파벳만 2글자 추출
  const ascii = name.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (ascii.length >= 2) return ascii.slice(0, 2);
  // 한글은 OT (기타)
  return 'OT';
}

export default productsV2;
