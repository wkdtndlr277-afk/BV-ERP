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
  const body = await c.req.json<any>();
  const { item_code, item_name, category, unit, safety_stock, expiry_days, pack_unit, pack_unit_name } = body;
  
  if (!item_code || !item_name || !category) {
    return c.json({ success: false, error: '필수 항목을 입력해주세요.' }, 400);
  }
  
  try {
    const unitValue = unit || (category === '부자재' ? 'ea' : 'kg');
    const safetyValue = safety_stock || 0;
    const packUnitValue = pack_unit || null;
    const packUnitNameValue = pack_unit_name || null;
    
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
      
      // supplies 테이블에 삽입 (pack_unit 포함)
      await c.env.DB.prepare(`
        INSERT INTO supplies (item_code, item_name, category, unit, current_stock, safety_stock, expiry_days, pack_unit, pack_unit_name)
        VALUES (?, ?, '부자재', ?, 0, ?, NULL, ?, ?)
      `).bind(item_code, item_name, unitValue, safetyValue, packUnitValue, packUnitNameValue).run();
      
      return c.json({ success: true, message: '부자재가 등록되었습니다.' });
    } else {
      // 원료/제품은 master 테이블에 저장 (pack_unit 포함)
      const expiryValue = expiry_days || 365;
      await c.env.DB.prepare(`
        INSERT INTO master (item_code, item_name, category, unit, current_stock, safety_stock, expiry_days, pack_unit, pack_unit_name)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
      `).bind(item_code, item_name, category, unitValue, safetyValue, expiryValue, packUnitValue, packUnitNameValue).run();
      
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
  const body = await c.req.json<any>();
  const { item_name, category, unit, safety_stock, expiry_days } = body;
  // pack_unit, pack_unit_name은 undefined가 아닌 null로 명시적 변환
  const pack_unit = body.pack_unit !== undefined ? body.pack_unit : null;
  const pack_unit_name = body.pack_unit_name !== undefined ? body.pack_unit_name : null;
  
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
      // 같은 테이블 내 업데이트 (pack_unit 포함)
      if (isCurrentlyInMaster) {
        // 전달된 값이 있으면 사용, 없으면 기존값 유지
        const finalPackUnit = body.hasOwnProperty('pack_unit') ? (body.pack_unit === null ? null : body.pack_unit) : currentItem!.pack_unit;
        const finalPackUnitName = body.hasOwnProperty('pack_unit_name') ? (body.pack_unit_name === null ? null : body.pack_unit_name) : currentItem!.pack_unit_name;
        
        await c.env.DB.prepare(`
          UPDATE master 
          SET item_name = COALESCE(?, item_name),
              category = COALESCE(?, category),
              unit = COALESCE(?, unit),
              safety_stock = COALESCE(?, safety_stock),
              expiry_days = COALESCE(?, expiry_days),
              pack_unit = ?,
              pack_unit_name = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE item_code = ?
        `).bind(
          item_name || null, 
          category || null, 
          unit || null, 
          safety_stock !== undefined ? safety_stock : null, 
          expiry_days !== undefined ? expiry_days : null, 
          finalPackUnit !== undefined ? finalPackUnit : null, 
          finalPackUnitName !== undefined ? finalPackUnitName : null, 
          item_code
        ).run();
      } else {
        const finalPackUnit = body.hasOwnProperty('pack_unit') ? (body.pack_unit === null ? null : body.pack_unit) : currentItem!.pack_unit;
        const finalPackUnitName = body.hasOwnProperty('pack_unit_name') ? (body.pack_unit_name === null ? null : body.pack_unit_name) : currentItem!.pack_unit_name;
        
        await c.env.DB.prepare(`
          UPDATE supplies 
          SET item_name = COALESCE(?, item_name),
              unit = COALESCE(?, unit),
              safety_stock = COALESCE(?, safety_stock),
              expiry_days = COALESCE(?, expiry_days),
              pack_unit = ?,
              pack_unit_name = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE item_code = ?
        `).bind(
          item_name || null, 
          unit || null, 
          safety_stock !== undefined ? safety_stock : null, 
          expiry_days !== undefined ? expiry_days : null, 
          finalPackUnit !== undefined ? finalPackUnit : null, 
          finalPackUnitName !== undefined ? finalPackUnitName : null, 
          item_code
        ).run();
      }
      
      return c.json({ success: true, message: '품목이 수정되었습니다.' });
    }
  } catch (error: any) {
    console.error('Master update error:', error);
    return c.json({ success: false, error: `수정 실패: ${error.message}` }, 500);
  }
});

// ★★★ v3.6.179: 품목코드 변경 (관리자 전용) ★★★
// 자동 부여된 코드가 실제 분류와 맞지 않을 때 (예: RM1014가 실제 부자재) 사용
// 모든 관련 테이블의 item_code / product_code를 함께 업데이트하여 무결성 유지
//
// GET /:item_code/related-count : 관련 데이터 건수 조회 (사전 확인용)
masterRoutes.get('/:item_code/related-count', async (c) => {
  const item_code = c.req.param('item_code');

  // 헬퍼: 테이블 존재 여부 확인 후 COUNT
  const safeCount = async (table: string, column: string, value: string): Promise<number> => {
    try {
      const exists = await c.env.DB.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
      ).bind(table).first();
      if (!exists) return 0;
      const r = await c.env.DB.prepare(
        `SELECT COUNT(*) as count FROM ${table} WHERE ${column} = ?`
      ).bind(value).first<{count: number}>();
      return r?.count || 0;
    } catch { return 0; }
  };

  const [
    m, s, tx, ib, bomA, bomB, prod, pm, prodTx, prodUsage,
    barcodeAdj, barcodeMap, bomV, inspNums, matCosts, openAdj,
    prodItems, semiItems, semiLots, semiTx, stockAudit,
    prodOutbound, frozen, frozenTx, orders, prodCat, prodCosts,
    prodRouting, prodBarcodes, prodBatch, shipments, workStd, prodInb
  ] = await Promise.all([
    safeCount('master', 'item_code', item_code),
    safeCount('supplies', 'item_code', item_code),
    safeCount('transactions', 'item_code', item_code),
    safeCount('inbound', 'item_code', item_code),
    safeCount('bom', 'item_code', item_code),
    safeCount('bom', 'product_code', item_code),
    safeCount('production', 'product_code', item_code),
    safeCount('production_materials', 'item_code', item_code),
    safeCount('production_transactions', 'item_code', item_code),
    safeCount('production_usage', 'item_code', item_code),
    safeCount('barcode_adjustments', 'item_code', item_code),
    safeCount('barcode_mapping', 'item_code', item_code),
    safeCount('bom_versioned', 'item_code', item_code),
    safeCount('inspection_numbers', 'item_code', item_code),
    safeCount('material_costs', 'item_code', item_code),
    safeCount('opening_stock_adjustments', 'item_code', item_code),
    safeCount('production_items', 'item_code', item_code),
    safeCount('semi_finished_items', 'item_code', item_code),
    safeCount('semi_finished_lots', 'item_code', item_code),
    safeCount('semi_finished_transactions', 'item_code', item_code),
    safeCount('stock_audit_log', 'item_code', item_code),
    safeCount('product_outbound', 'product_code', item_code),
    safeCount('frozen_stock', 'product_code', item_code),
    safeCount('frozen_stock_transactions', 'product_code', item_code),
    safeCount('orders', 'product_code', item_code),
    safeCount('product_catalog', 'product_code', item_code),
    safeCount('product_costs', 'product_code', item_code),
    safeCount('product_process_routing', 'product_code', item_code),
    safeCount('production_barcodes', 'product_code', item_code),
    safeCount('production_batch', 'product_code', item_code),
    safeCount('shipments', 'product_code', item_code),
    safeCount('work_standards', 'product_code', item_code),
    safeCount('production_inbound', 'item_code', item_code)
  ]);

  const related = {
    master: m,
    supplies: s,
    transactions: tx,
    inbound: ib,
    bom_as_material: bomA,
    bom_as_product: bomB,
    production: prod,
    production_materials: pm,
    production_transactions: prodTx,
    production_usage: prodUsage,
    barcode_adjustments: barcodeAdj,
    barcode_mapping: barcodeMap,
    bom_versioned: bomV,
    inspection_numbers: inspNums,
    material_costs: matCosts,
    opening_stock_adjustments: openAdj,
    production_items: prodItems,
    semi_finished_items: semiItems,
    semi_finished_lots: semiLots,
    semi_finished_transactions: semiTx,
    stock_audit_log: stockAudit,
    product_outbound: prodOutbound,
    frozen_stock: frozen,
    frozen_stock_transactions: frozenTx,
    orders: orders,
    product_catalog: prodCat,
    product_costs: prodCosts,
    product_process_routing: prodRouting,
    production_barcodes: prodBarcodes,
    production_batch: prodBatch,
    shipments: shipments,
    work_standards: workStd,
    production_inbound: prodInb
  };

  const total = Object.values(related).reduce((a, b) => a + b, 0);

  return c.json({ success: true, item_code, total, related });
});

// PUT /:item_code/change-code : 품목코드 변경 (관련 데이터 연동 업데이트)
// body: { new_code: string, confirm: true }
masterRoutes.put('/:item_code/change-code', async (c) => {
  const old_code = c.req.param('item_code');
  const body = await c.req.json<{ new_code: string; confirm?: boolean }>();
  const new_code = (body.new_code || '').trim();

  // 1. 입력 검증
  if (!new_code) {
    return c.json({ success: false, error: '새 품목코드를 입력해주세요.' }, 400);
  }
  if (new_code === old_code) {
    return c.json({ success: false, error: '기존 코드와 동일합니다.' }, 400);
  }
  // v3.6.182: 코드 형식 엄격화 - 접두어(영문 대문자 2~4자) + 번호(숫자 2~10자리)
  // 예전 정규식 ^[A-Z][A-Z0-9]{1,19}$는 'SM' 같이 번호 없는 코드도 통과되어 오작동 유발
  if (!/^[A-Z]{2,4}\d{2,10}$/.test(new_code)) {
    return c.json({
      success: false,
      error: '품목코드는 접두어(영문 대문자 2~4자) + 번호(숫자 2~10자리)여야 합니다. (예: RM100, SM014, PD001)'
    }, 400);
  }

  try {
    // 2. 기존 품목 조회 (master or supplies)
    const masterItem = await c.env.DB.prepare(
      'SELECT * FROM master WHERE item_code = ?'
    ).bind(old_code).first<any>();

    let suppliesItem: any = null;
    try {
      suppliesItem = await c.env.DB.prepare(
        'SELECT * FROM supplies WHERE item_code = ?'
      ).bind(old_code).first<any>();
    } catch { /* supplies 테이블 없을 수 있음 */ }

    const existingItem = masterItem || suppliesItem;
    if (!existingItem) {
      return c.json({ success: false, error: '변경할 품목을 찾을 수 없습니다.' }, 404);
    }

    // 3. 새 코드 중복 확인 (master + supplies)
    const dupMaster = await c.env.DB.prepare(
      'SELECT item_code FROM master WHERE item_code = ?'
    ).bind(new_code).first();
    let dupSupplies: any = null;
    try {
      dupSupplies = await c.env.DB.prepare(
        'SELECT item_code FROM supplies WHERE item_code = ?'
      ).bind(new_code).first();
    } catch { /* ignore */ }

    if (dupMaster || dupSupplies) {
      return c.json({
        success: false,
        error: `새 코드 "${new_code}"는 이미 사용 중입니다.`
      }, 400);
    }

    // 4. 관련 테이블 일괄 업데이트
    // 헬퍼: 테이블 존재 + 컬럼 존재 시에만 UPDATE
    const safeUpdate = async (table: string, column: string): Promise<number> => {
      try {
        const exists = await c.env.DB.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
        ).bind(table).first();
        if (!exists) return 0;
        // 컬럼 존재 확인
        const cols = await c.env.DB.prepare(`PRAGMA table_info(${table})`).all<{name: string}>();
        const hasColumn = (cols.results || []).some((r: any) => r.name === column);
        if (!hasColumn) return 0;
        const r = await c.env.DB.prepare(
          `UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`
        ).bind(new_code, old_code).run();
        return (r.meta?.changes as number) || 0;
      } catch (e: any) {
        console.error(`safeUpdate ${table}.${column} failed:`, e.message);
        return 0;
      }
    };

    // item_code 컬럼을 가진 테이블들
    const itemCodeTables = [
      'transactions', 'inbound', 'bom', 'production_materials',
      'production_transactions', 'production_usage', 'barcode_adjustments',
      'barcode_mapping', 'bom_versioned', 'inspection_numbers',
      'material_costs', 'opening_stock_adjustments', 'production_items',
      'semi_finished_items', 'semi_finished_lots', 'semi_finished_transactions',
      'stock_audit_log', 'production_inbound'
    ];
    // product_code 컬럼을 가진 테이블들 (제품/원료 모두 참조 가능)
    const productCodeTables = [
      'bom', 'bom_versioned', 'production', 'product_outbound',
      'frozen_stock', 'frozen_stock_transactions', 'orders',
      'product_catalog', 'product_costs', 'product_process_routing',
      'production_barcodes', 'production_batch', 'shipments', 'work_standards'
    ];

    const updateResults: Record<string, number> = {};

    for (const t of itemCodeTables) {
      updateResults[`${t}.item_code`] = await safeUpdate(t, 'item_code');
    }
    for (const t of productCodeTables) {
      updateResults[`${t}.product_code`] = await safeUpdate(t, 'product_code');
    }

    // 5. 마지막으로 master / supplies 자체의 item_code 변경
    if (masterItem) {
      await c.env.DB.prepare(
        'UPDATE master SET item_code = ?, updated_at = CURRENT_TIMESTAMP WHERE item_code = ?'
      ).bind(new_code, old_code).run();
      updateResults['master.item_code'] = 1;
    }
    if (suppliesItem) {
      await c.env.DB.prepare(
        'UPDATE supplies SET item_code = ?, updated_at = CURRENT_TIMESTAMP WHERE item_code = ?'
      ).bind(new_code, old_code).run();
      updateResults['supplies.item_code'] = 1;
    }

    // 6. 감사 로그 (선택적)
    try {
      await c.env.DB.prepare(`
        INSERT INTO stock_audit_log (item_code, action, memo, created_at)
        VALUES (?, 'code_change', ?, CURRENT_TIMESTAMP)
      `).bind(new_code, `품목코드 변경: ${old_code} → ${new_code}`).run();
    } catch { /* audit_log 테이블 없거나 스키마 다를 수 있음 */ }

    const totalUpdated = Object.values(updateResults).reduce((a, b) => a + b, 0);

    return c.json({
      success: true,
      message: `품목코드가 변경되었습니다: ${old_code} → ${new_code}`,
      old_code,
      new_code,
      total_rows_updated: totalUpdated,
      updates: updateResults
    });
  } catch (error: any) {
    console.error('Change item_code error:', error);
    return c.json({
      success: false,
      error: `품목코드 변경 실패: ${error.message}`
    }, 500);
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
