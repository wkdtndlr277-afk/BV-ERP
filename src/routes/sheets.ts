// 구글 시트 연동 API
// v1.0.0: ERP ↔ 구글 시트 데이터 동기화
import { Hono } from 'hono';
import { GoogleSheetsService } from '../services/GoogleSheetsService';

type Bindings = {
  DB: D1Database;
  GOOGLE_CLIENT_EMAIL?: string;
  GOOGLE_PRIVATE_KEY?: string;
};

const sheets = new Hono<{ Bindings: Bindings }>();

// 서비스 인스턴스 생성 헬퍼
function getSheetService(c: any): GoogleSheetsService | null {
  const clientEmail = c.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = c.env.GOOGLE_PRIVATE_KEY;
  
  if (!clientEmail || !privateKey) {
    return null;
  }
  
  // 환경변수에서 개행문자 복원
  const formattedKey = privateKey.replace(/\\n/g, '\n');
  return new GoogleSheetsService(clientEmail, formattedKey);
}

// ===== 시트 초기화 =====
sheets.post('/init', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ 
      success: false, 
      error: '구글 시트 인증 정보가 설정되지 않았습니다. 환경변수를 확인하세요.' 
    }, 400);
  }

  try {
    const result = await service.initializeSheets();
    return c.json(result);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 디버그용 시트 직접 읽기 =====
sheets.get('/debug/raw-read', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const sheetName = c.req.query('sheet') || '출고일지';
    const range = c.req.query('range') || 'A1:J20';
    const showFormulas = c.req.query('formulas') === 'true';  // ★ 수식 보기 옵션
    
    const data = showFormulas 
      ? await service.readSheetFormulas(sheetName, range)
      : await service.readSheet(sheetName, range);
    
    return c.json({
      success: true,
      sheet: sheetName,
      range,
      show_formulas: showFormulas,
      row_count: data.length,
      data
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== ERP → 시트 동기화 =====

// 원료 입고 데이터 동기화 (원료 R/RM만, 부자재/제품 제외)
// ★★★ 원료입고 동기화 비활성화 - 구글시트 원료입고는 수동 관리 ★★★
// D1 → 구글시트 덮어쓰기 방지 (일별수불부 전일재고 영향)
sheets.post('/sync/inbound', async (c) => {
  return c.json({ 
    success: false, 
    error: '원료입고 동기화 비활성화됨. 구글시트 원료입고는 직접 관리하세요.',
    note: 'D1 → 구글시트 덮어쓰기로 인한 일별수불부 전일재고 오류 방지'
  }, 400);
});

// BOM 데이터 동기화 (SM 부자재 제외)
sheets.post('/sync/bom', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    // production_bom 테이블에서 BOM 데이터 조회 (SM 부자재 제외)
    const bomData = await c.env.DB.prepare(`
      SELECT pb.production_code as product_code, 
             COALESCE(pi.production_name, pb.production_code) as product_name,
             pb.material_code as item_code, 
             COALESCE(pb.material_name, m.item_name) as item_name,
             pb.quantity, 
             COALESCE(pb.unit, 'g') as unit
      FROM production_bom pb
      LEFT JOIN production_items pi ON pb.production_code = pi.production_code
      LEFT JOIN master m ON pb.material_code = m.item_code
      WHERE pb.material_code NOT LIKE 'SM%'
      ORDER BY pb.production_code, pb.material_code
    `).all<any>();

    await service.syncBomData(bomData.results || []);
    
    return c.json({ 
      success: true, 
      message: `BOM ${bomData.results?.length || 0}건 동기화 완료 (SM 부자재 제외)` 
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 제품마스터 동기화 (D1 production_barcodes → 구글시트) =====
sheets.post('/sync/product-master', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    // D1 DB에서 production_barcodes 데이터 조회
    const barcodeData = await c.env.DB.prepare(`
      SELECT 
        pb.production_code,
        COALESCE(pi.production_name, pb.production_code) as production_name,
        pb.barcode,
        pb.product_name as order_product_name,
        pb.channel,
        COALESCE(pb.expiry_days, 24) as expiry_days,
        COALESCE(pb.box_quantity, 1) as box_quantity,
        pb.created_at
      FROM production_barcodes pb
      LEFT JOIN production_items pi ON pb.production_code = pi.production_code
      ORDER BY pb.production_code, pb.channel, pb.barcode
    `).all<any>();

    const result = await service.syncProductMaster(barcodeData.results || []);
    
    return c.json({ 
      success: result.success, 
      message: `제품마스터 ${result.count}건 동기화 완료`,
      count: result.count
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 제품마스터 조회 (구글시트에서)
sheets.get('/product-master', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const productCode = c.req.query('product_code');
    const products = await service.getProductMaster(productCode);
    
    return c.json({ 
      success: true, 
      data: products,
      count: products.length
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.39: 제품마스터 역방향 동기화 (구글시트 → D1) ★★★
// SSOT: 구글시트가 원본, D1에 반영
sheets.post('/sync/product-master-from-sheet', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false;
    
    // 구글시트 제품마스터 읽기 (A=제품코드, B=제품명, C=바코드, D=발주상품명, E=채널, F=소비기한, G=박스수량)
    const sheetData = await service.readSheet('제품마스터', 'A2:H');
    
    if (!sheetData || sheetData.length === 0) {
      return c.json({ success: false, error: '구글시트 제품마스터가 비어있습니다.' }, 400);
    }
    
    // D1에서 현재 데이터 조회
    const d1Data = await c.env.DB.prepare(`
      SELECT id, production_code, barcode, product_name, channel, expiry_days, box_quantity
      FROM production_barcodes
    `).all<any>();
    
    const d1Map = new Map<string, any>();
    for (const row of d1Data.results || []) {
      d1Map.set(`${row.production_code}|${row.barcode}`, row);
    }
    
    const updates: any[] = [];
    const inserts: any[] = [];
    const skipped: any[] = [];
    
    for (const row of sheetData) {
      const productCode = row[0]?.toString().trim() || '';
      const barcode = row[2]?.toString().trim() || '';
      const orderProductName = row[3]?.toString().trim() || '';
      const channel = row[4]?.toString().trim() || '';
      const expiryDays = parseInt(row[5]?.toString().trim()) || null;
      const boxQuantity = parseInt(row[6]?.toString().trim()) || 1;
      
      if (!productCode || !barcode) {
        skipped.push({ productCode, barcode, reason: '제품코드/바코드 없음' });
        continue;
      }
      
      const existing = d1Map.get(`${productCode}|${barcode}`);
      
      if (existing) {
        const hasChange = existing.product_name !== orderProductName ||
          existing.channel !== channel ||
          existing.expiry_days !== expiryDays ||
          existing.box_quantity !== boxQuantity;
        
        if (hasChange) {
          updates.push({
            id: existing.id, production_code: productCode, barcode,
            product_name: orderProductName, channel, expiry_days: expiryDays, box_quantity: boxQuantity,
            changes: {
              expiry_days: existing.expiry_days !== expiryDays ? `${existing.expiry_days}→${expiryDays}` : null,
              product_name: existing.product_name !== orderProductName ? `변경됨` : null
            }
          });
        }
      } else {
        inserts.push({ production_code: productCode, barcode, product_name: orderProductName, channel, expiry_days: expiryDays, box_quantity: boxQuantity });
      }
    }
    
    if (dryRun) {
      return c.json({
        success: true, dry_run: true,
        message: '미리보기 (실제 반영: dry_run: false)',
        summary: { sheet_total: sheetData.length, to_update: updates.length, to_insert: inserts.length, skipped: skipped.length },
        updates: updates.slice(0, 20), inserts: inserts.slice(0, 20)
      });
    }
    
    let updatedCount = 0, insertedCount = 0;
    const updateErrors: string[] = [];
    
    for (const item of updates) {
      try {
        await c.env.DB.prepare(`UPDATE production_barcodes SET product_name=?, channel=?, expiry_days=?, box_quantity=? WHERE id=?`)
          .bind(item.product_name, item.channel, item.expiry_days, item.box_quantity, item.id).run();
        updatedCount++;
      } catch (e: any) {
        updateErrors.push(`${item.production_code}/${item.barcode}: ${e.message}`);
      }
    }
    
    // ★★★ v3.6.39: INSERT OR IGNORE로 중복 시 무시 ★★★
    const insertErrors: string[] = [];
    for (const item of inserts) {
      try {
        await c.env.DB.prepare(`INSERT OR IGNORE INTO production_barcodes (production_code, barcode, product_name, channel, expiry_days, box_quantity) VALUES (?,?,?,?,?,?)`)
          .bind(item.production_code, item.barcode, item.product_name, item.channel, item.expiry_days, item.box_quantity).run();
        insertedCount++;
      } catch (e: any) {
        insertErrors.push(`${item.production_code}/${item.barcode}: ${e.message}`);
      }
    }
    
    return c.json({
      success: true, dry_run: false,
      message: `제품마스터 구글시트→D1 동기화 완료`,
      summary: { 
        updated: updatedCount, 
        inserted: insertedCount, 
        skipped: skipped.length,
        update_errors: updateErrors.length,
        insert_errors: insertErrors.length
      },
      errors: [...updateErrors, ...insertErrors].slice(0, 10)  // 최대 10개 에러만 표시
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 제품 소비기한 조회 (생산일보용)
sheets.get('/product-expiry', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const productCode = c.req.query('product_code');
    const channel = c.req.query('channel');
    
    if (!productCode) {
      return c.json({ success: false, error: 'product_code 필수' }, 400);
    }
    
    const expiryDays = await service.getProductExpiryDays(productCode, channel);
    
    return c.json({ 
      success: true, 
      product_code: productCode,
      channel: channel || null,
      expiry_days: expiryDays
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 발주서 데이터 동기화 (production_report 기준)
sheets.post('/sync/orders', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const startDate = body.start_date || new Date().toISOString().split('T')[0];
    const endDate = body.end_date || startDate;

    // 생산일보에서 발주 데이터 조회
    const orderData = await c.env.DB.prepare(`
      SELECT pr.report_date as order_date,
             pr.product_code,
             COALESCE(pi.production_name, pr.product_code) as product_name,
             pr.quantity,
             pr.report_date as delivery_date,
             pr.channel,
             '' as memo,
             '대기' as status
      FROM production_report pr
      LEFT JOIN production_items pi ON pr.product_code = pi.production_code
      WHERE pr.report_date BETWEEN ? AND ?
      ORDER BY pr.report_date DESC, pr.id DESC
    `).bind(startDate, endDate).all<any>();

    await service.syncOrderData(orderData.results || []);
    
    return c.json({ 
      success: true, 
      message: `발주서 ${orderData.results?.length || 0}건 동기화 완료` 
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 전체 동기화 (입고 + BOM + 발주서)
sheets.post('/sync/all', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const results: string[] = [];

    // ★★★ 1. 입고 동기화 비활성화 - 구글시트 원료입고는 수동 관리 ★★★
    // D1 → 구글시트 덮어쓰기 방지 (일별수불부 전일재고 영향)
    results.push(`입고: 동기화 비활성화 (구글시트 수동 관리)`);

    // 2. BOM 동기화 (SM 부자재 제외)
    const bomData = await c.env.DB.prepare(`
      SELECT pb.production_code as product_code, 
             COALESCE(pi.production_name, pb.production_code) as product_name,
             pb.material_code as item_code, 
             COALESCE(pb.material_name, m.item_name) as item_name,
             pb.quantity, 
             COALESCE(pb.unit, 'g') as unit
      FROM production_bom pb
      LEFT JOIN production_items pi ON pb.production_code = pi.production_code
      LEFT JOIN master m ON pb.material_code = m.item_code
      WHERE pb.material_code NOT LIKE 'SM%'
    `).all<any>();
    await service.syncBomData(bomData.results || []);
    results.push(`BOM ${bomData.results?.length || 0}건`);

    // ★★★ v3.6.13: 3. 제품마스터(바코드) 동기화 추가 ★★★
    const barcodeData = await c.env.DB.prepare(`
      SELECT 
        pb.production_code,
        COALESCE(pi.production_name, pb.production_code) as production_name,
        pb.barcode,
        pb.product_name as order_product_name,
        pb.channel,
        COALESCE(pb.expiry_days, 24) as expiry_days,
        COALESCE(pb.box_quantity, 1) as box_quantity,
        pb.created_at
      FROM production_barcodes pb
      LEFT JOIN production_items pi ON pb.production_code = pi.production_code
      ORDER BY pb.production_code, pb.channel, pb.barcode
    `).all<any>();
    await service.syncProductMaster(barcodeData.results || []);
    results.push(`제품마스터 ${barcodeData.results?.length || 0}건`);

    return c.json({ 
      success: true, 
      message: `전체 동기화 완료: ${results.join(', ')}` 
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 시트 → ERP 불러오기 =====

// 생산 실적 조회 (시트에서)
sheets.get('/production', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const date = c.req.query('date');
    const records = await service.getProductionRecords(date);
    
    return c.json({ 
      success: true, 
      data: records,
      count: records.length
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 일별수불부 조회 (시트에서 계산된 결과)
sheets.get('/daily-stock', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const date = c.req.query('date') || new Date().toISOString().split('T')[0];
    const stockReport = await service.getDailyStockReport(date);
    
    return c.json({ 
      success: true, 
      date,
      data: stockReport,
      count: stockReport.length
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 로트 매칭 결과 조회 (시트에서 FEFO 계산 결과)
sheets.get('/lot-matching', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const prodDate = c.req.query('prod_date') || '';
    const productLot = c.req.query('product_lot') || '';
    
    if (!prodDate || !productLot) {
      return c.json({ success: false, error: 'prod_date와 product_lot 필수' }, 400);
    }

    const lotMatching = await service.getLotMatching(prodDate, productLot);
    
    return c.json({ 
      success: true, 
      data: lotMatching,
      count: lotMatching.length
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★ 제품 LOT로 원료 사용량 조회 (HACCP 추적성용)
// 로트매칭 시트 구조: A:생산일, B:제품LOT, C:원료코드, D:원료명, E:사용량, F:원료LOT, G:유통기한
sheets.get('/lot-trace/:product_lot', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const productLot = c.req.param('product_lot');
    
    if (!productLot) {
      return c.json({ success: false, error: '제품 LOT 번호가 필요합니다' }, 400);
    }

    // 1. 로트매칭 시트에서 해당 제품 LOT 조회
    const lotMatchingData = await service.readSheet('로트매칭', 'A2:G');
    const materials = lotMatchingData
      .filter(row => row[1]?.toString() === productLot)
      .map(row => ({
        prod_date: row[0]?.toString().replace(/^'/, '') || '',
        product_lot: row[1]?.toString() || '',
        item_code: row[2]?.toString() || '',
        item_name: row[3]?.toString() || '',
        usage_qty: parseFloat(row[4]) || 0,
        material_lot: row[5]?.toString() || '-',
        expiry_date: row[6]?.toString() || '-'
      }));

    // 2. 생산실적 시트에서 해당 LOT의 제품 정보 조회
    const productionData = await service.readSheet('생산실적', 'A2:H');
    const production = productionData
      .filter(row => row[4]?.toString() === productLot)
      .map(row => ({
        prod_date: row[0]?.toString().replace(/^'/, '') || '',
        product_code: row[1]?.toString() || '',
        product_name: row[2]?.toString() || '',
        quantity: parseFloat(row[3]) || 0,
        lot_number: row[4]?.toString() || '',
        channel: row[5]?.toString() || '',
        status: row[6]?.toString() || ''
      }));

    // 3. 원료별 집계
    const materialSummary = new Map<string, { code: string; name: string; total_qty: number; lots: string[] }>();
    for (const m of materials) {
      if (!materialSummary.has(m.item_code)) {
        materialSummary.set(m.item_code, { code: m.item_code, name: m.item_name, total_qty: 0, lots: [] });
      }
      const summary = materialSummary.get(m.item_code)!;
      summary.total_qty += m.usage_qty;
      if (m.material_lot !== '-' && !summary.lots.includes(m.material_lot)) {
        summary.lots.push(m.material_lot);
      }
    }

    return c.json({
      success: true,
      product_lot: productLot,
      production: production[0] || null,
      materials: materials,
      material_summary: Array.from(materialSummary.values()),
      count: materials.length,
      note: 'HACCP 추적성: 제품 LOT → 사용 원료 LOT 추적'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 생산일보 출력용 데이터 조합 =====

// 시트에서 계산된 결과 + ERP 로트번호 부여 → 생산일보 데이터
sheets.get('/report/daily-production', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const date = c.req.query('date') || new Date().toISOString().split('T')[0];

    // 1. 시트에서 생산 실적 조회
    const productionRecords = await service.getProductionRecords(date);

    // 2. 각 생산 건에 대해 로트 매칭 정보 조회
    const reportData = [];
    for (const record of productionRecords) {
      const lotMatching = await service.getLotMatching(date, record.lot_number);
      
      reportData.push({
        ...record,
        materials: lotMatching
      });
    }

    // 3. 일별수불부 조회
    const dailyStock = await service.getDailyStockReport(date);

    return c.json({ 
      success: true, 
      date,
      production: {
        items: reportData,
        count: reportData.length
      },
      stock_report: {
        items: dailyStock,
        count: dailyStock.length
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 연결 테스트
sheets.get('/test', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ 
      success: false, 
      error: '구글 시트 인증 정보가 설정되지 않았습니다.',
      help: 'GOOGLE_CLIENT_EMAIL과 GOOGLE_PRIVATE_KEY 환경변수를 설정하세요.'
    }, 400);
  }

  try {
    // 시트 읽기 테스트
    const testData = await service.readSheet('시트1', 'A1:A1');
    
    return c.json({ 
      success: true, 
      message: '구글 시트 연결 성공!',
      sheet_id: '1aEvc4673J0wZoPuojwgrxVu7qhkR5VuymmlKPdHpNfU'
    });
  } catch (error: any) {
    return c.json({ 
      success: false, 
      error: error.message,
      help: '서비스 계정에 시트 편집 권한이 있는지 확인하세요.'
    }, 500);
  }
});

// ===== 테스트용 API =====

// 테스트 생산 실적 추가
sheets.post('/test/add-production', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const {
      prod_date = new Date().toISOString().split('T')[0],
      product_code,
      product_name,
      quantity,
      channel = '',
      memo = ''
    } = body;

    if (!product_code || !quantity) {
      return c.json({ success: false, error: 'product_code와 quantity 필수' }, 400);
    }

    // 제품 로트번호 생성 (YYYYMMDD-제품코드-순번)
    const existingRecords = await service.getProductionRecords(prod_date);
    const sameProductCount = existingRecords.filter(r => r.product_code === product_code).length;
    const seq = String(sameProductCount + 1).padStart(3, '0');
    const lot_number = `${prod_date.replace(/-/g, '')}-${product_code}-${seq}`;

    // 생산실적 시트에 추가
    const row = [
      prod_date,
      product_code,
      product_name || product_code,
      quantity,
      lot_number,
      channel,
      memo,
      new Date().toISOString()
    ];

    // ★ v3.5.67: 중복 방지 함수 사용
    const prodResult = await service.appendProductionWithDedup([row]);

    return c.json({
      success: true,
      message: prodResult.added > 0 ? '생산 실적 추가 완료' : '중복 데이터로 스킵됨',
      added: prodResult.added,
      skipped: prodResult.skipped,
      data: {
        prod_date,
        product_code,
        product_name,
        quantity,
        lot_number,
        channel
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// BOM 기반 원료 사용량 계산 (시트 수식 대신 API로 계산 후 로트매칭 시트에 기록)
sheets.post('/test/calculate-usage', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const prod_date = body.prod_date || new Date().toISOString().split('T')[0];

    // ★ 재고 관리 제외 원료 (물 등 무한 공급)
    const EXCLUDE_STOCK = ['RM184'];  // 정제수
    
    // ★★★ v3.5.61: SF원료 (자체 생산 원료) - 입고 개념 없음, 로트 공란 처리 ★★★
    const SF_ITEMS = ['SF001', 'SF002', 'SF003', 'SF004', 'SF005', 'SF006', 'SF007', 'SF008', 'SF009', 'SF010'];

    // 1. 생산실적 조회
    const productions = await service.getProductionRecords(prod_date);
    if (productions.length === 0) {
      return c.json({ success: false, error: '해당 날짜 생산 실적 없음' }, 400);
    }

    // 2. BOM 마스터 조회 - ★ v3.5.70: 단위 통일 (g → kg 변환)
    const bomData = await service.readSheet('BOM마스터', 'A2:F');
    const bomMap = new Map<string, any[]>();
    for (const row of bomData) {
      const productCode = row[0];
      if (!bomMap.has(productCode)) bomMap.set(productCode, []);
      
      const rawQty = parseFloat(row[4]) || 0;
      const unit = (row[5] || 'kg').toString().toLowerCase().trim();
      // g 단위면 /1000으로 kg 변환
      const quantity_kg = unit === 'g' ? rawQty / 1000 : rawQty;
      
      bomMap.get(productCode)!.push({
        item_code: row[2],
        item_name: row[3],
        quantity: quantity_kg,  // 항상 kg 단위
        unit: 'kg'  // 통일
      });
    }

    // 3. 원료입고 조회 (FEFO용)
    const inboundData = await service.readSheet('원료입고', 'A2:I');
    const inboundMap = new Map<string, any[]>();
    for (const row of inboundData) {
      const itemCode = row[1];
      if (!inboundMap.has(itemCode)) inboundMap.set(itemCode, []);
      inboundMap.get(itemCode)!.push({
        inbound_date: row[0],
        lot_number: row[3],
        remain_qty: parseFloat(row[8]) || 0,
        // ★★★ v3.6.03 BUG FIX: 원료입고 시트 구조 - G열(6)=공급업체, H열(7)=소비기한 ★★★
        expiry_date: row[7]
      });
    }
    // FEFO 정렬 (유통기한 빠른 순)
    for (const [, lots] of inboundMap) {
      lots.sort((a, b) => (a.expiry_date || '9999').localeCompare(b.expiry_date || '9999'));
    }

    // 4. 각 생산 건별 원료 사용량 계산 + 로트 매칭
    const lotMatchingRows: any[][] = [];
    const usageByItem = new Map<string, { item_name: string, total: number, unit: string, isExcluded: boolean }>();

    for (const prod of productions) {
      const bom = bomMap.get(prod.product_code) || [];
      
      for (const material of bom) {
        const isExcluded = EXCLUDE_STOCK.includes(material.item_code);
        
        // ★ v3.5.70: BOM 읽을 때 이미 kg로 변환됨
        let usageKg = material.quantity * prod.quantity;

        // 원료별 사용량 집계
        if (!usageByItem.has(material.item_code)) {
          usageByItem.set(material.item_code, { 
            item_name: material.item_name, 
            total: 0, 
            unit: 'kg',
            isExcluded 
          });
        }
        usageByItem.get(material.item_code)!.total += usageKg;

        // ★ 정제수 등 제외 원료는 사용량만 기록 (로트매칭 없음)
        if (isExcluded) {
          lotMatchingRows.push([
            `'${prod_date}`,  // ★ v3.5.61: 날짜를 문자열로 강제
            prod.lot_number,
            material.item_code,
            material.item_name,
            usageKg.toFixed(3),
            '-',  // 로트 없음
            '-'   // 유통기한 없음
          ]);
          continue;
        }
        
        // ★★★ v3.5.61: SF원료는 자체 생산원료로 입고 개념 없음 - 로트 공란 처리 ★★★
        if (SF_ITEMS.includes(material.item_code)) {
          lotMatchingRows.push([
            `'${prod_date}`,  // 날짜 문자열 강제
            prod.lot_number,
            material.item_code,
            material.item_name,
            usageKg.toFixed(3),
            '',  // ★ 로트 공란 (SF원료는 입고 개념 없음)
            ''   // ★ 소비기한 공란
          ]);
          // SF원료는 수불부에서도 제외
          usageByItem.get(material.item_code)!.isExcluded = true;
          continue;
        }

        // ★★★ v3.6.04: FEFO 로트 매칭 + 소비기한 만료 LOT 자동 제외 ★★★
        const lots = inboundMap.get(material.item_code) || [];
        let remaining = usageKg;
        for (const lot of lots) {
          if (remaining <= 0) break;
          if (lot.remain_qty <= 0) continue;
          
          // ★★★ v3.6.04: 소비기한이 생산일 이전인 LOT는 건너뛰기 ★★★
          if (lot.expiry_date && lot.expiry_date < prod_date) {
            continue;  // 만료된 LOT 건너뛰기
          }

          const useFromLot = Math.min(remaining, lot.remain_qty);
          remaining -= useFromLot;

          // 로트매칭 시트에 기록
          lotMatchingRows.push([
            `'${prod_date}`,  // ★ v3.5.61: 날짜를 문자열로 강제
            prod.lot_number,
            material.item_code,
            material.item_name,
            useFromLot.toFixed(3),
            lot.lot_number,
            lot.expiry_date
          ]);
        }

        // 로트가 부족한 경우
        if (remaining > 0) {
          lotMatchingRows.push([
            `'${prod_date}`,  // ★ v3.5.61: 날짜를 문자열로 강제
            prod.lot_number,
            material.item_code,
            material.item_name,
            remaining.toFixed(3),
            '재고부족',
            ''
          ]);
        }
      }
    }

    // 5. 로트매칭 시트에 기록
    if (lotMatchingRows.length > 0) {
      await service.appendSheet('로트매칭', lotMatchingRows);
    }

    // 6. ★★★ v3.5.57: 일별수불부는 수식 기반으로 변경 ★★★
    // 값을 직접 저장하지 않고, 수식이 적용된 행만 생성
    // 실제 계산은 구글시트 수식이 원료입고/로트매칭 시트를 참조해서 수행
    const itemCodesToAdd: string[] = [];
    for (const [itemCode, usage] of usageByItem) {
      // 정제수 등 제외 원료는 수불부에서 제외
      if (usage.isExcluded) continue;
      itemCodesToAdd.push(itemCode);
    }

    let dailyStockResult = { rows_created: 0 };
    if (itemCodesToAdd.length > 0) {
      // 수식 기반 행 생성 (중복 체크 포함)
      dailyStockResult = await service.setupDailyStockWithFormulas(prod_date, itemCodesToAdd);
    }

    return c.json({
      success: true,
      message: '원료 사용량 계산 및 로트 매칭 완료',
      summary: {
        production_count: productions.length,
        lot_matching_count: lotMatchingRows.length,
        daily_stock_count: dailyStockResult.rows_created,
        excluded_items: EXCLUDE_STOCK,
        usage_items: Array.from(usageByItem.entries()).map(([code, data]) => ({
          item_code: code,
          item_name: data.item_name,
          total_usage_kg: data.total.toFixed(3),
          excluded: data.isExcluded
        }))
      },
      note: '★ 일별수불부는 수식 기반으로 자동 계산됩니다 (원료입고/로트매칭 시트 참조)'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ========================================
// ★★★ v3.5.21: 수식 설정 및 자동화 API ★★★
// ERP는 입력만, 계산은 시트 수식에서
// ========================================

// 일별수불부 + 로트매칭 수식 한번에 설정
sheets.post('/setup-formulas', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const results: string[] = [];

    // 1. 일별수불부 수식 설정
    const dailyResult = await service.setupDailyStockFormulas();
    results.push(`일별수불부: ${dailyResult.message}`);

    // 2. 로트매칭 헤더 설정
    const lotResult = await service.setupLotMatchingFormulas();
    results.push(`로트매칭: ${lotResult.message}`);

    return c.json({
      success: true,
      message: '수식 설정 완료',
      details: results,
      note: '★ 이제 ERP에서 생산실적만 등록하면 시트가 자동으로 원료사용량, 재고를 계산합니다.'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.16: 일별수불부 재생성 API (force 옵션 추가) ★★★
// 생산실적 시트에서 날짜 목록을 가져와서 일별수불부 재생성
sheets.post('/rebuild-daily-stock', async (c) => {
  // ★★★ v3.6.42: 데이터 삭제 방지 - API 비활성화 ★★★
  return c.json({ 
    success: false, 
    error: '🚫 데이터 보호: 이 API는 비활성화되었습니다. 일별수불부 데이터는 삭제할 수 없습니다.',
    message: '데이터 무결성 보호를 위해 rebuild-daily-stock API가 비활성화되었습니다.'
  }, 403);

  // 아래 코드는 실행되지 않음 (데이터 보호)
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const { start_date, end_date, force = false } = body;
    
    // 1. 생산실적 시트에서 날짜 목록 가져오기
    const productionData = await service.readSheet('생산실적', 'A2:A5000');
    const uniqueDates = new Set<string>();
    
    for (const row of productionData) {
      const dateStr = row[0]?.toString().replace(/^'/, '') || '';
      if (dateStr && dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        // 날짜 필터링 (start_date, end_date)
        if (start_date && dateStr < start_date) continue;
        if (end_date && dateStr > end_date) continue;
        uniqueDates.add(dateStr);
      }
    }
    
    if (uniqueDates.size === 0) {
      return c.json({ 
        success: false, 
        error: '생산실적 시트에 유효한 날짜 데이터가 없습니다.',
        filter: { start_date, end_date }
      }, 400);
    }
    
    // 날짜 정렬 (오름차순)
    const sortedDates = Array.from(uniqueDates).sort();
    console.log(`[rebuild-daily-stock] 처리할 날짜: ${sortedDates.join(', ')}, force=${force}`);
    
    // ★★★ v3.6.19: force=true면 해당 날짜 데이터 먼저 삭제 + 정렬 ★★★
    if (force) {
      console.log(`[rebuild-daily-stock] force 모드: ${sortedDates.length}개 날짜 데이터 삭제 후 재생성`);
      
      // 일별수불부 전체 읽기
      const existingData = await service.readSheet('일별수불부', 'A2:H50000');
      
      // 삭제할 날짜가 아닌 행만 필터링
      const datesToDelete = new Set(sortedDates);
      const remainingData = existingData.filter(row => {
        const rowDate = row[0]?.toString().replace(/^'/, '') || '';
        return !datesToDelete.has(rowDate);
      });
      
      // ★★★ v3.6.19: 날짜 + 품목코드 순 정렬 ★★★
      remainingData.sort((a, b) => {
        const dateA = a[0]?.toString().replace(/^'/, '') || '';
        const dateB = b[0]?.toString().replace(/^'/, '') || '';
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        const codeA = a[1]?.toString() || '';
        const codeB = b[1]?.toString() || '';
        return codeA.localeCompare(codeB);
      });
      
      // 클리어 후 남은 데이터만 다시 쓰기 (정렬된 상태로)
      await service.clearRange('일별수불부', 'A2:H50000');
      if (remainingData.length > 0) {
        await service.writeSheet('일별수불부', 'A2', remainingData);
      }
      console.log(`[rebuild-daily-stock] 기존 ${existingData.length}행 중 ${existingData.length - remainingData.length}행 삭제, ${remainingData.length}행 유지 (정렬됨)`);
    }
    
    // 2. 각 날짜별로 일별수불부 생성
    const results: any[] = [];
    for (const date of sortedDates) {
      try {
        const result = await service.addDailyStockDate(date);
        results.push({
          date,
          status: 'success',
          new_rows: result.new_rows,
          total_rows: result.total_rows
        });
        console.log(`[rebuild-daily-stock] ${date} 완료: ${result.new_rows}행 추가`);
      } catch (err: any) {
        results.push({
          date,
          status: 'error',
          error: err.message
        });
        console.error(`[rebuild-daily-stock] ${date} 실패:`, err.message);
      }
    }
    
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    
    return c.json({
      success: true,
      message: `일별수불부 재생성 완료: ${successCount}개 성공, ${errorCount}개 실패`,
      total_dates: sortedDates.length,
      force_mode: force,
      results,
      note: '★ 각 날짜의 사용량(F열)은 로트매칭 시트 참조 수식으로 자동 계산됩니다.'
    });
  } catch (error: any) {
    console.error('[rebuild-daily-stock] 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.19: 일별수불부 전체 정렬 API ★★★
sheets.post('/sort-daily-stock', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    // 전체 데이터 읽기
    const existingData = await service.readSheet('일별수불부', 'A2:H50000');
    
    if (existingData.length === 0) {
      return c.json({ success: true, message: '정렬할 데이터 없음', rows: 0 });
    }
    
    // 날짜 + 품목코드 순 정렬
    existingData.sort((a, b) => {
      const dateA = a[0]?.toString().replace(/^'/, '') || '';
      const dateB = b[0]?.toString().replace(/^'/, '') || '';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      const codeA = a[1]?.toString() || '';
      const codeB = b[1]?.toString() || '';
      return codeA.localeCompare(codeB);
    });
    
    // 클리어 후 정렬된 데이터 쓰기
    await service.clearRange('일별수불부', 'A2:H50000');
    await service.writeSheet('일별수불부', 'A2', existingData);
    
    return c.json({
      success: true,
      message: '일별수불부 정렬 완료',
      rows: existingData.length
    });
  } catch (error: any) {
    console.error('[sort-daily-stock] 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 원료별 현재고 조회 (시트 기반 SSOT)
sheets.get('/current-stock', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const itemCode = c.req.query('item_code');
    const stockData = await service.getCurrentStock(itemCode);

    return c.json({
      success: true,
      data: stockData,
      count: stockData.length,
      source: 'google_sheets',
      note: '시트 원료입고 잔량 기준 (SSOT)'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 생산 실적 등록 (단순화 - 시트에만 기록, 계산은 수식이 처리)
sheets.post('/add-production-simple', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const {
      prod_date = new Date().toISOString().split('T')[0],
      product_code,
      product_name,
      quantity,
      channel = '',
      memo = ''
    } = body;

    if (!product_code || !quantity) {
      return c.json({ success: false, error: 'product_code와 quantity 필수' }, 400);
    }

    // 제품 로트번호 자동 생성
    const existingRecords = await service.getProductionRecords(prod_date);
    const sameProductCount = existingRecords.filter(r => r.product_code === product_code).length;
    const seq = String(sameProductCount + 1).padStart(3, '0');
    const lot_number = `${prod_date.replace(/-/g, '')}-${product_code}-${seq}`;

    // 시트에 생산실적 추가
    await service.addProductionRecord({
      prod_date,
      product_code,
      product_name: product_name || product_code,
      quantity: parseFloat(quantity),
      lot_number,
      channel,
      memo
    });

    return c.json({
      success: true,
      message: '생산 실적 등록 완료 (시트 수식이 자동으로 원료사용량, 재고 계산)',
      data: {
        prod_date,
        product_code,
        product_name,
        quantity,
        lot_number,
        channel
      },
      note: '★ BOM 소모량, FEFO 로트매칭, 수불부는 시트 수식이 자동 계산합니다.'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 일괄 생산 실적 등록 (발주 기반)
sheets.post('/add-production-batch', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const { items, prod_date = new Date().toISOString().split('T')[0] } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return c.json({ success: false, error: 'items 배열 필수' }, 400);
    }

    const results: any[] = [];
    const existingRecords = await service.getProductionRecords(prod_date);
    const countByProduct = new Map<string, number>();
    
    // 기존 레코드 카운트
    for (const r of existingRecords) {
      countByProduct.set(r.product_code, (countByProduct.get(r.product_code) || 0) + 1);
    }

    for (const item of items) {
      const { product_code, product_name, quantity, channel = '', memo = '' } = item;
      
      if (!product_code || !quantity) continue;

      // 로트번호 생성
      const count = (countByProduct.get(product_code) || 0) + 1;
      countByProduct.set(product_code, count);
      const seq = String(count).padStart(3, '0');
      const lot_number = `${prod_date.replace(/-/g, '')}-${product_code}-${seq}`;

      await service.addProductionRecord({
        prod_date,
        product_code,
        product_name: product_name || product_code,
        quantity: parseFloat(quantity),
        lot_number,
        channel,
        memo
      });

      results.push({
        product_code,
        quantity,
        lot_number,
        status: 'success'
      });
    }

    return c.json({
      success: true,
      message: `${results.length}건 생산 실적 일괄 등록 완료`,
      data: results,
      note: '★ BOM 소모량, FEFO 로트매칭, 수불부는 시트 수식이 자동 계산합니다.'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 시트 데이터 초기화 (헤더 유지, 데이터만 삭제)
sheets.post('/clear-data', async (c) => {
  // ★★★ v3.6.42: 데이터 삭제 방지 - API 비활성화 ★★★
  return c.json({ 
    success: false, 
    error: '🚫 데이터 보호: 이 API는 비활성화되었습니다. 시트 데이터를 삭제할 수 없습니다.',
    message: '데이터 무결성 보호를 위해 clear-data API가 비활성화되었습니다.'
  }, 403);

  // 아래 코드는 실행되지 않음 (데이터 보호)
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const { sheet_name, confirm = false } = body;

    if (!confirm) {
      return c.json({ 
        success: false, 
        error: 'confirm: true를 전송해야 합니다',
        warning: '이 작업은 시트 데이터를 삭제합니다 (헤더 제외)'
      }, 400);
    }

    const sheets_to_clear = sheet_name 
      ? [sheet_name] 
      : ['생산실적', '로트매칭', '일별수불부'];

    for (const name of sheets_to_clear) {
      await service.clearSheetData(name, 2);
    }

    return c.json({
      success: true,
      message: `${sheets_to_clear.join(', ')} 시트 데이터 초기화 완료`,
      note: '헤더는 유지됨, 수식 템플릿 행(2행)도 유지됨'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ========================================
// ★★★ v3.5.23: 3단계 레이어 아키텍처 API ★★★
// 입력 → 연산(SSOT) → 출력 분리
// ========================================

import { 
  validateInboundData, 
  validateProductionData,
  SHEET_NAMES,
  INVENTORY_FORMULAS
} from '../services/SheetArchitecture';

// [1단계] 입력 레이어: 무결성 검증 후 RAW 시트에 저장
sheets.post('/v2/input/inbound', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const items = Array.isArray(body) ? body : [body];
    
    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[]
    };

    const validRows: any[][] = [];
    
    for (const item of items) {
      const validation = validateInboundData(item);
      
      if (!validation.valid) {
        results.failed++;
        results.errors.push(...validation.errors);
        continue;
      }

      const data = validation.sanitizedData;
      validRows.push([
        `'${data.inbound_date}`,  // 날짜를 문자열로 강제
        data.item_code,
        data.item_name || '',
        data.lot_number,
        data.quantity,
        'kg',
        data.supplier,
        data.expiry_date ? `'${data.expiry_date}` : '',
        data.quantity  // 잔량 (초기값 = 입고량)
      ]);
      results.success++;
    }

    // RAW 시트에 저장
    if (validRows.length > 0) {
      await service.appendSheet('원료입고', validRows);
    }

    return c.json({
      success: true,
      layer: 'INPUT',
      message: `입고 ${results.success}건 저장, ${results.failed}건 실패`,
      validation_errors: results.errors.length > 0 ? results.errors : undefined,
      note: '★ 무결성 검증 통과 데이터만 저장됨'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// [1단계] 입력 레이어: 생산실적 무결성 검증 후 저장
sheets.post('/v2/input/production', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const { prod_date, items } = body;
    
    if (!prod_date || !items || !Array.isArray(items)) {
      return c.json({ success: false, error: 'prod_date, items 필수' }, 400);
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[]
    };

    const validRows: any[][] = [];
    const lotNum = prod_date.replace(/-/g, '').slice(2);
    
    for (const item of items) {
      const validation = validateProductionData({
        prod_date,
        product_code: item.product_code,
        quantity: item.quantity
      });
      
      if (!validation.valid) {
        results.failed++;
        results.errors.push(...validation.errors);
        continue;
      }

      const data = validation.sanitizedData;
      validRows.push([
        `'${data.prod_date}`,  // A: 생산일자 (문자열 강제)
        data.product_code,     // B: 제품코드
        item.product_name || '', // C: 제품명
        data.quantity,         // D: 생산수량
        `${lotNum}-${data.product_code}`, // E: 제품로트
        item.channel || '',    // F: 채널
        '',                    // G: 비고
        new Date().toISOString() // H: 등록시간
      ]);
      results.success++;
    }

    // RAW 시트에 저장 - ★ v3.5.67: 중복 방지 함수 사용
    let addedCount = 0;
    let skippedCount = 0;
    if (validRows.length > 0) {
      const prodResult = await service.appendProductionWithDedup(validRows);
      addedCount = prodResult.added;
      skippedCount = prodResult.skipped;
    }

    return c.json({
      success: true,
      layer: 'INPUT',
      lot_number: lotNum,
      message: `생산 ${addedCount}건 저장, ${skippedCount}건 중복 스킵, ${results.failed}건 실패`,
      added: addedCount,
      skipped: skippedCount,
      validation_errors: results.errors.length > 0 ? results.errors : undefined,
      note: '★ 무결성 검증 통과 데이터만 저장됨. 원료사용량은 자동 계산됩니다. 중복 데이터는 자동 스킵됩니다.'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// [2단계] 연산 레이어: 재고마스터 시트 초기화 + 수식 설정
sheets.post('/v2/setup/inventory-master', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    // 재고마스터 시트 헤더 설정
    const headers = [
      '일자', '품목코드', '품목명', '전일재고', '입고(+)', '출고/사용(-)', '현재고', '단위'
    ];
    
    await service.writeSheet('재고마스터', 'A1:H1', [headers]);

    // 수식 템플릿 행 (2행) - 복사해서 사용
    const formulaRow = [
      '=TODAY()',  // A: 일자
      '',          // B: 품목코드 (수동/참조)
      '=IFERROR(VLOOKUP(B2,원료입고!B:C,2,FALSE),"")',  // C: 품목명
      // D: 전일재고 = 전일 동일 품목의 현재고
      '=IFERROR(INDEX(재고마스터!G:G,MATCH(1,(재고마스터!A:A=A2-1)*(재고마스터!B:B=B2),0)),SUMIFS(원료입고!I:I,원료입고!B:B,B2))',
      // E: 입고(+) = 당일 입고량 합계
      '=SUMIFS(원료입고!E:E,원료입고!B:B,B2,원료입고!A:A,TEXT(A2,"YYYY-MM-DD"))',
      // F: 출고/사용(-) = BOM × 생산수량 합계 (핵심!)
      `=SUMPRODUCT(
        --(생산실적!A:A=TEXT(A2,"YYYY-MM-DD")),
        --(생산실적!B:B<>""),
        IFERROR(SUMIFS(BOM마스터!E:E,BOM마스터!A:A,생산실적!B:B,BOM마스터!C:C,B2),0),
        생산실적!D:D
      )/1000`,
      // G: 현재고 = 전일재고 + 입고 - 사용
      '=D2+E2-F2',
      'kg'  // H: 단위
    ];
    
    await service.writeWithFormulas('재고마스터', 'A2:H2', [formulaRow]);

    return c.json({
      success: true,
      layer: 'PROCESSING',
      message: '재고마스터 시트 초기화 완료',
      structure: {
        A: '일자',
        B: '품목코드 (수동 입력)',
        C: '품목명 (자동: VLOOKUP)',
        D: '전일재고 (자동: 전일 현재고)',
        E: '입고(+) (자동: SUMIFS)',
        F: '출고/사용(-) (자동: BOM×생산수량)',
        G: '현재고 (자동: D+E-F)',
        H: '단위'
      },
      note: '★ 품목코드(B열)만 입력하면 나머지는 모두 자동 계산됩니다.'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// [2단계] 연산 레이어: 특정 일자의 수불부 자동 생성
sheets.post('/v2/calculate/daily-stock', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const { date } = body;

    if (!date) {
      return c.json({ success: false, error: 'date 필수' }, 400);
    }

    // 1. 해당 날짜의 생산실적 조회
    const productions = await service.getProductionRecords(date);
    
    // 2. BOM 데이터 조회 - ★ v3.5.71: 단위 통일 (g → kg 변환)
    const bomData = await service.readSheet('BOM마스터', 'A2:F');
    const bomMap = new Map<string, any[]>();
    for (const row of bomData) {
      const productCode = row[0];
      if (!bomMap.has(productCode)) bomMap.set(productCode, []);
      
      const rawQty = parseFloat(row[4]) || 0;
      const unit = (row[5] || 'kg').toString().toLowerCase().trim();
      // g 단위면 /1000으로 kg 변환
      const quantity_kg = unit === 'g' ? rawQty / 1000 : rawQty;
      
      bomMap.get(productCode)!.push({
        item_code: row[2],
        item_name: row[3],
        quantity: quantity_kg,  // 항상 kg 단위
        unit: 'kg'  // 통일
      });
    }

    // 3. 원료입고 데이터 조회 (잔량 기반)
    const inboundData = await service.readSheet('원료입고', 'A2:I');
    const stockMap = new Map<string, { name: string, qty: number, lots: any[] }>();
    
    for (const row of inboundData) {
      const itemCode = row[1];
      const remainQty = parseFloat(row[8]) || 0;
      if (remainQty <= 0) continue;
      
      if (!stockMap.has(itemCode)) {
        stockMap.set(itemCode, { name: row[2], qty: 0, lots: [] });
      }
      const stock = stockMap.get(itemCode)!;
      stock.qty += remainQty;
      stock.lots.push({
        lot: row[3],
        qty: remainQty,
        expiry: row[7]
      });
    }

    // 4. 원료별 사용량 계산
    const usageMap = new Map<string, { name: string, usage: number }>();
    const EXCLUDE_STOCK = ['RM184'];  // 정제수 제외

    for (const prod of productions) {
      const bom = bomMap.get(prod.product_code) || [];
      
      for (const material of bom) {
        if (EXCLUDE_STOCK.includes(material.item_code)) continue;
        
        // ★ v3.5.71: BOM 읽을 때 이미 kg로 변환됨
        const usageKg = material.quantity * prod.quantity;
        
        if (!usageMap.has(material.item_code)) {
          usageMap.set(material.item_code, { name: material.item_name, usage: 0 });
        }
        usageMap.get(material.item_code)!.usage += usageKg;
      }
    }

    // 5. ★★★ v3.5.57: 일별수불부는 수식 기반으로 변경 ★★★
    // 값을 직접 저장하지 않고, 수식이 적용된 행만 생성
    const itemCodes = Array.from(usageMap.keys());
    
    let dailyStockResult = { rows_created: 0 };
    if (itemCodes.length > 0) {
      dailyStockResult = await service.setupDailyStockWithFormulas(date, itemCodes);
    }

    return c.json({
      success: true,
      layer: 'PROCESSING',
      date,
      production_count: productions.length,
      items_calculated: dailyStockResult.rows_created,
      message: `${date} 일별수불부 ${dailyStockResult.rows_created}건 수식 행 생성 완료`,
      sample: Array.from(usageMap.entries()).slice(0, 3).map(([code, usageData]) => ({ item_code: code, item_name: usageData.name, usage: usageData.usage.toFixed(3) })),
      note: '★ 일별수불부는 수식 기반으로 자동 계산됩니다'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// [3단계] 출력 레이어: 일별수불부 조회 (정리된 형태)
sheets.get('/v2/output/daily-stock', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const date = c.req.query('date') || new Date().toISOString().split('T')[0];
    
    // 일별수불부 시트에서 조회
    const data = await service.readSheet('일별수불부', 'A2:H');
    
    const records = data
      .filter(row => {
        // 날짜 필터링 (엑셀 숫자/문자열 모두 지원)
        let rowDate = row[0];
        if (typeof rowDate === 'number' || /^\d+$/.test(rowDate)) {
          const excelDate = parseInt(rowDate);
          const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
          rowDate = jsDate.toISOString().split('T')[0];
        } else if (typeof rowDate === 'string') {
          rowDate = rowDate.replace(/^'/, '');
        }
        return rowDate === date;
      })
      .map(row => ({
        date: row[0]?.toString().replace(/^'/, ''),
        item_code: row[1],  // ★ v3.5.63 fix: code → row[1]
        item_name: row[2],
        prev_stock: parseFloat(row[3]) || 0,
        inbound_qty: parseFloat(row[4]) || 0,
        usage_qty: parseFloat(row[5]) || 0,
        current_stock: parseFloat(row[6]) || 0,
        unit: row[7] || 'kg'
      }))
      // ★ v3.5.68: 품목코드순 정렬 (관리자 재고 검토 편의)
      .sort((a, b) => {
        const aMatch = a.item_code?.match(/^([A-Z]+)(\d+)$/);
        const bMatch = b.item_code?.match(/^([A-Z]+)(\d+)$/);
        if (aMatch && bMatch) {
          if (aMatch[1] === bMatch[1]) {
            return parseInt(aMatch[2]) - parseInt(bMatch[2]);
          }
          return aMatch[1].localeCompare(bMatch[1]);
        }
        return (a.item_code || '').localeCompare(b.item_code || '');
      });

    // 요약 통계
    const summary = {
      total_items: records.length,
      total_inbound: records.reduce((sum, r) => sum + r.inbound_qty, 0),
      total_usage: records.reduce((sum, r) => sum + r.usage_qty, 0),
      items_with_usage: records.filter(r => r.usage_qty > 0).length
    };

    return c.json({
      success: true,
      layer: 'OUTPUT',
      date,
      summary,
      data: records,
      note: '★ 입고(+)와 출고/사용(-)이 정확히 분리되어 표시됩니다.'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// =====================================================
// 원료 사용 현황 - 생산일보 PDF용
// 사용량: 일별수불부 시트 (SSOT)
// LOT/소비기한: 로트매칭 시트에서 추출
// ★ 이원료(SF001~SF010): 사용량만 표기, LOT/소비기한 없음
// =====================================================

// ★★★ 이원료 마스터 (고정) - 입고 개념 없음, 사용량만 표기 ★★★
const IWON_MATERIALS: Record<string, string> = {
  'SF001': '발효종르방',
  'SF002': '통밀르방',
  'SF003': '폴리쉬',
  'SF004': '쌀르방',
  'SF005': '쌀탕종',
  'SF006': '탕종',
  'SF007': '통밀탕종',
  'SF008': '통밀폴리쉬',
  'SF009': '호밀르방',
  'SF010': '솔트라이발효종르방'
};

sheets.get('/v2/output/material-usage', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const date = c.req.query('date') || new Date().toISOString().split('T')[0];
    
    // ★★★ 1. 일별수불부 시트에서 사용량 조회 (SSOT) ★★★
    const dailyStockData = await service.readSheet('일별수불부', 'A2:H');
    
    const usageMap = new Map<string, { item_code: string; item_name: string; usage_qty: number; unit: string }>();
    
    dailyStockData.forEach(row => {
      // 날짜 필터링
      let rowDate = row[0];
      if (typeof rowDate === 'number' || /^\d+$/.test(rowDate)) {
        const excelDate = parseInt(rowDate);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        rowDate = jsDate.toISOString().split('T')[0];
      } else if (typeof rowDate === 'string') {
        rowDate = rowDate.replace(/^'/, '');
      }
      if (rowDate !== date) return;
      
      const usageQty = parseFloat(row[5]) || 0;
      if (usageQty <= 0) return;
      
      const itemCode = row[1] || '';
      let itemName = row[2] || '';
      
      // ★★★ 이원료(SF001~SF010): 고정된 원료명 사용 ★★★
      if (IWON_MATERIALS[itemCode]) {
        itemName = IWON_MATERIALS[itemCode];
      }
      
      usageMap.set(itemCode, {
        item_code: itemCode,
        item_name: itemName,
        usage_qty: usageQty,
        unit: row[7] || 'kg'
      });
    });
    
    // ★★★ 2. 로트매칭 시트에서 LOT/소비기한 조회 (이원료 제외) ★★★
    // 구조: A:생산일, B:제품LOT, C:원료코드, D:원료명, E:사용량, F:원료LOT, G:유통기한
    const lotMatchingData = await service.readSheet('로트매칭', 'A2:G');
    
    // ★★★ v3.5.96: 여러 LOT 사용 시 모두 저장 (배열) ★★★
    const lotMap = new Map<string, Array<{ lot_number: string; expiry_date: string; usage_qty: number }>>();
    
    lotMatchingData.forEach(row => {
      // 날짜 필터링
      let rowDate = row[0];
      if (typeof rowDate === 'number' || /^\d+$/.test(rowDate)) {
        const excelDate = parseInt(rowDate);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        rowDate = jsDate.toISOString().split('T')[0];
      } else if (typeof rowDate === 'string') {
        rowDate = rowDate.replace(/^'/, '');
      }
      if (rowDate !== date) return;
      
      const itemCode = row[2] || '';
      
      // ★★★ 이원료는 LOT 정보 저장 안함 ★★★
      if (IWON_MATERIALS[itemCode]) return;
      
      const lotNumber = row[5] || '-';
      let expiryDate = row[6] || '-';
      const lotUsageQty = parseFloat(row[4]) || 0;  // E열: 사용량
      
      // 유통기한 형식 변환 (엑셀 숫자 → YYYY-MM-DD)
      if (expiryDate && !isNaN(expiryDate as any) && parseInt(expiryDate) > 40000) {
        const d = new Date((parseInt(expiryDate) - 25569) * 86400 * 1000);
        expiryDate = d.toISOString().split('T')[0];
      }
      
      // ★★★ v3.5.96: 원료코드별 모든 LOT 정보 배열로 저장 ★★★
      if (!lotMap.has(itemCode)) {
        lotMap.set(itemCode, []);
      }
      // 같은 LOT는 합산
      const existingLot = lotMap.get(itemCode)!.find(l => l.lot_number === lotNumber);
      if (existingLot) {
        existingLot.usage_qty += lotUsageQty;
      } else {
        lotMap.get(itemCode)!.push({ lot_number: lotNumber, expiry_date: expiryDate, usage_qty: lotUsageQty });
      }
    });
    
    // ★★★ v3.5.99: 두 데이터 조합 - 여러 LOT 지원 (프론트에서 개별 행으로 표시) ★★★
    const records = Array.from(usageMap.values()).map(item => {
      // ★★★ 이원료(SF001~SF010): LOT/소비기한 표시 안함 ★★★
      const isIwon = !!IWON_MATERIALS[item.item_code];
      const lotInfoArray = isIwon ? [] : (lotMap.get(item.item_code) || []);
      
      // 단순 LOT 표시 (레거시 호환용) - 프론트에서는 lots 배열 직접 사용
      const lotDetails = lotInfoArray.map(l => 
        `${l.lot_number}(${l.usage_qty.toFixed(2)}kg)`
      ).join(', ') || '-';
      
      // 소비기한은 첫 번째 LOT (레거시 호환용)
      const firstExpiry = lotInfoArray.length > 0 ? lotInfoArray[0].expiry_date : '-';
      
      return {
        item_code: item.item_code,
        item_name: item.item_name,
        usage_qty: item.usage_qty,
        unit: item.unit,
        // 레거시 호환: 단일 문자열
        lot_number: isIwon ? '-' : lotDetails,
        expiry_date: isIwon ? '-' : firstExpiry,
        // ★★★ v3.5.99: 상세 LOT 배열 (프론트에서 개별 행 렌더링용) ★★★
        lots: isIwon ? [] : lotInfoArray,
        is_iwon: isIwon
      };
    });
    
    // 품목코드 기준 정렬
    records.sort((a, b) => a.item_code.localeCompare(b.item_code));
    
    // ★★★ v3.6.51: 반제품(SF) 사용현황 분리 추출 ★★★
    // BOM마스터에서 SF 원료 사용량 계산 (생산실적 × BOM 배합비)
    const productionData = await service.readSheet('생산실적', 'A2:H5000');
    const bomData = await service.readSheet('BOM마스터', 'A2:F2000');
    
    // BOM에서 SF 원료만 추출
    const sfBomMap: Record<string, Array<{ productCode: string; sfCode: string; sfName: string; usage: number }>> = {};
    for (const row of bomData) {
      const productCode = row[0]?.toString() || '';
      const materialCode = row[2]?.toString() || '';
      const materialName = row[3]?.toString() || '';
      const usage = parseFloat(row[4]?.toString() || '0') || 0;
      
      if (!productCode || !materialCode.startsWith('SF')) continue;
      
      if (!sfBomMap[productCode]) {
        sfBomMap[productCode] = [];
      }
      sfBomMap[productCode].push({ productCode, sfCode: materialCode, sfName: materialName, usage });
    }
    
    // 해당 날짜 생산실적에서 SF 사용량 집계
    const sfUsageMap = new Map<string, { sf_code: string; sf_name: string; total_usage: number; unit: string }>();
    
    for (const prod of productionData) {
      let prodDate = prod[0]?.toString().replace(/^'/, '') || '';
      if (prodDate !== date) continue;
      
      const productCode = prod[1]?.toString() || '';
      const quantity = parseFloat(prod[3]?.toString() || '0') || 0;
      
      const sfItems = sfBomMap[productCode] || [];
      for (const sf of sfItems) {
        const sfUsage = sf.usage * quantity;
        if (sfUsage <= 0) continue;
        
        const existing = sfUsageMap.get(sf.sfCode);
        if (existing) {
          existing.total_usage += sfUsage;
        } else {
          sfUsageMap.set(sf.sfCode, {
            sf_code: sf.sfCode,
            sf_name: IWON_MATERIALS[sf.sfCode] || sf.sfName,
            total_usage: sfUsage,
            unit: 'kg'
          });
        }
      }
    }
    
    // SF LOT 정보 생성 (제조일 기준)
    // SF LOT: {제조일}-{SF코드}-001 형식, 소비기한: 제조일 + 5일
    const sfRecords = Array.from(sfUsageMap.values()).map(sf => {
      const sfLot = `${date.replace(/-/g, '').slice(2)}-${sf.sf_code}-001`;  // 260618-SF001-001
      const expiryDate = new Date(date);
      expiryDate.setDate(expiryDate.getDate() + 5);  // 소비기한 5일
      const sfExpiry = expiryDate.toISOString().split('T')[0];
      
      return {
        sf_code: sf.sf_code,
        sf_name: sf.sf_name,
        total_usage: Math.round(sf.total_usage * 10000) / 10000,
        unit: sf.unit,
        sf_lot: sfLot,
        expiry_date: sfExpiry,
        // SF_BOM 전개 원료 정보는 로트매칭에서 [SF코드] 접두어로 확인 가능
        note: '생산실적 × BOM 배합비로 계산'
      };
    });
    
    sfRecords.sort((a, b) => a.sf_code.localeCompare(b.sf_code));
    
    // ★★★ v3.6.51: 원료 사용현황에서 SF 원료 제외 (중복 방지) ★★★
    const materialsOnly = records.filter(r => !r.is_iwon);
    
    return c.json({
      success: true,
      date,
      total_items: materialsOnly.length,
      total_usage: materialsOnly.reduce((sum, r) => sum + r.usage_qty, 0),
      data: materialsOnly,  // 원료만 (SF 제외)
      // ★★★ v3.6.51: 반제품 사용현황 별도 필드 ★★★
      sf_usage: {
        total_items: sfRecords.length,
        total_usage: sfRecords.reduce((sum, r) => sum + r.total_usage, 0),
        data: sfRecords
      },
      note: '★ v3.6.51: 원료(data) + 반제품(sf_usage) 분리. SF 원료는 SF_BOM 전개되어 원료로 변환됨'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// =====================================================
// 🚚 출고 자동화 API (v2/shipment/)
// 생산일보 기반 익일 출고 자동 생성
// =====================================================

/**
 * 출고일지 자동 생성 - 생산일보 기반 익일 출고
 * 
 * 워크플로우:
 * 1. 생산일 (N일): 생산실적 시트에 생산 완료 기록
 * 2. 출고일 (N+1일): 자동으로 출고일지 생성 + 제품 재고 차감
 * 
 * POST /api/sheets/v2/shipment/generate
 * Body: { production_date: "YYYY-MM-DD" }
 * → 생산일 기준으로 익일(N+1) 출고일지 자동 생성
 */
sheets.post('/v2/shipment/generate', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const { production_date } = body;

    if (!production_date) {
      return c.json({ success: false, error: 'production_date 필수 (YYYY-MM-DD)' }, 400);
    }

    // 1. 생산일 기준 생산실적 조회
    const productions = await service.getProductionRecords(production_date);
    
    if (!productions || productions.length === 0) {
      return c.json({ 
        success: true, 
        message: `${production_date} 생산실적이 없습니다.`,
        shipment_count: 0 
      });
    }

    // 2. 출고일 계산 (생산일 + 1일)
    const prodDateObj = new Date(production_date);
    prodDateObj.setDate(prodDateObj.getDate() + 1);
    const shipmentDate = prodDateObj.toISOString().split('T')[0];

    // 3. 출고일지 시트 헤더 확인/생성
    const shipmentHeaders = [
      '출고일', '생산일', '제품코드', '제품명', '수량', '단위', 
      '채널', '생산LOT', '출고상태', '비고'
    ];
    
    // 기존 출고일지 데이터 확인
    let existingData: any[][] = [];
    try {
      existingData = await service.readSheet('출고일지', 'A2:J');
    } catch (e) {
      // 시트가 없으면 헤더 생성
      await service.writeSheet('출고일지', 'A1:J1', [shipmentHeaders]);
    }

    // 4. 이미 생성된 출고건 확인 (중복 방지)
    const existingShipments = new Set<string>();
    for (const row of existingData) {
      const key = `${row[0]}|${row[2]}|${row[7]}`; // 출고일|제품코드|생산LOT
      existingShipments.add(key);
    }

    // ★★★ v3.6.34: 제품마스터에서 제품명 맵 조회 (생산실적에 제품명 없을 때 대비) ★★★
    const productMasterData = await service.readSheet('제품마스터', 'A2:B');
    const productNameMap = new Map<string, string>();
    for (const row of productMasterData) {
      const code = row[0]?.toString() || '';
      const name = row[1]?.toString() || '';
      if (code && name && !productNameMap.has(code)) {
        productNameMap.set(code, name);
      }
    }

    // 5. 출고일지 데이터 생성
    const shipmentRows: any[][] = [];
    let skippedCount = 0;

    for (const prod of productions) {
      const key = `${shipmentDate}|${prod.product_code}|${prod.lot_number}`;
      
      if (existingShipments.has(key)) {
        skippedCount++;
        continue;  // 이미 출고일지에 있으면 스킵
      }

      // ★ 제품명: 생산실적에 없으면 제품마스터에서 조회
      const productName = prod.product_name || productNameMap.get(prod.product_code) || '';

      shipmentRows.push([
        `'${shipmentDate}`,         // A: 출고일 (생산일+1)
        `'${production_date}`,      // B: 생산일
        prod.product_code,          // C: 제품코드
        productName,                // D: 제품명 (마스터에서 조회)
        prod.quantity,              // E: 수량
        'EA',                       // F: 단위
        prod.channel || '',         // G: 채널
        prod.lot_number || '',      // H: 생산LOT
        '출고예정',                 // I: 출고상태
        `${production_date} 생산분` // J: 비고
      ]);
    }

    // 6. 출고일지 시트에 추가
    if (shipmentRows.length > 0) {
      await service.appendSheet('출고일지', shipmentRows);
    }

    return c.json({
      success: true,
      production_date,
      shipment_date: shipmentDate,
      production_count: productions.length,
      shipment_created: shipmentRows.length,
      skipped_duplicates: skippedCount,
      message: `${production_date} 생산분 → ${shipmentDate} 출고일지 ${shipmentRows.length}건 생성`,
      sample: shipmentRows.slice(0, 3).map(row => ({
        shipment_date: row[0],
        product_code: row[2],
        product_name: row[3],
        quantity: row[4],
        channel: row[6],
        status: row[8]
      })),
      note: '★ 생산완료 = 익일 자동 출고. 재고 차감은 출고 확정 시 진행됩니다.'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * 출고 확정 및 제품 재고 차감
 * 
 * POST /api/sheets/v2/shipment/confirm
 * Body: { shipment_date: "YYYY-MM-DD" }
 * → 해당 출고일의 '출고예정' 건을 '출고완료'로 변경하고 제품재고 시트에서 차감
 */
sheets.post('/v2/shipment/confirm', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const { shipment_date } = body;

    if (!shipment_date) {
      return c.json({ success: false, error: 'shipment_date 필수' }, 400);
    }

    // 1. 출고일지에서 해당 날짜의 '출고예정' 건 조회
    const shipmentData = await service.readSheet('출고일지', 'A2:J');
    
    const pendingShipments: any[] = [];
    const pendingRowIndices: number[] = [];
    
    shipmentData.forEach((row, idx) => {
      let rowDate = row[0]?.toString().replace(/^'/, '');
      const status = row[8];
      
      if (rowDate === shipment_date && status === '출고예정') {
        pendingShipments.push({
          row_index: idx + 2,  // 헤더 제외, 1-indexed
          product_code: row[2],
          product_name: row[3],
          quantity: parseFloat(row[4]) || 0,
          channel: row[6]
        });
        pendingRowIndices.push(idx + 2);
      }
    });

    if (pendingShipments.length === 0) {
      return c.json({
        success: true,
        message: `${shipment_date} 출고예정 건이 없습니다.`,
        confirmed_count: 0
      });
    }

    // 2. 제품재고 시트에서 재고 차감
    let inventoryData: any[][] = [];
    try {
      inventoryData = await service.readSheet('제품재고', 'A2:E');
    } catch (e) {
      // 제품재고 시트가 없으면 생성
      await service.writeSheet('제품재고', 'A1:E1', [
        ['제품코드', '제품명', '현재고', '단위', '최종수정일']
      ]);
      inventoryData = [];
    }

    // 제품별 현재고 맵
    const inventoryMap = new Map<string, { row_index: number, qty: number }>();
    inventoryData.forEach((row, idx) => {
      inventoryMap.set(row[0], {
        row_index: idx + 2,
        qty: parseFloat(row[2]) || 0
      });
    });

    // 재고 차감 처리 (배치용 데이터 준비)
    const deductionResults: any[] = [];
    const batchUpdates: Array<{ sheetName: string; range: string; values: any[][] }> = [];

    for (const shipment of pendingShipments) {
      const inv = inventoryMap.get(shipment.product_code);
      
      if (inv) {
        // 기존 재고 차감
        const newQty = Math.max(0, inv.qty - shipment.quantity);
        batchUpdates.push({
          sheetName: '제품재고',
          range: `C${inv.row_index}:E${inv.row_index}`,
          values: [[newQty, 'EA', `'${shipment_date}`]]
        });
        deductionResults.push({
          product_code: shipment.product_code,
          prev_qty: inv.qty,
          deducted: shipment.quantity,
          new_qty: newQty
        });
        inv.qty = newQty;  // 다음 차감을 위해 업데이트
      } else {
        // 새 제품 (재고 없이 출고 - 경고)
        deductionResults.push({
          product_code: shipment.product_code,
          prev_qty: 0,
          deducted: shipment.quantity,
          new_qty: -shipment.quantity,
          warning: '재고 부족'
        });
      }
    }

    // 3. 출고일지 상태 업데이트 (출고예정 → 출고완료) - 배치에 추가
    for (const rowIdx of pendingRowIndices) {
      batchUpdates.push({
        sheetName: '출고일지',
        range: `I${rowIdx}`,
        values: [['출고완료']]
      });
    }

    // 4. 모든 업데이트를 한 번에 실행 (성능 최적화)
    if (batchUpdates.length > 0) {
      const batchSuccess = await service.batchWriteSheet(batchUpdates);
      if (!batchSuccess) {
        return c.json({ success: false, error: '배치 업데이트 실패' }, 500);
      }
    }

    return c.json({
      success: true,
      shipment_date,
      confirmed_count: pendingShipments.length,
      inventory_deductions: deductionResults.length,
      message: `${shipment_date} 출고 ${pendingShipments.length}건 확정, 재고 차감 완료`,
      deductions: deductionResults,
      note: '★ 출고확정과 동시에 제품재고가 차감되었습니다.'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * 출고일지 조회 - ★ 생산실적 시트 기반으로 조회 (SSOT)
 * 
 * GET /api/sheets/v2/shipment/list?date=YYYY-MM-DD&status=출고예정
 * 
 * 출고일 = 생산일 + 1일 (익일 출고)
 * 따라서 출고일로 조회 시 → 생산일(출고일-1)의 생산실적을 가져옴
 */
sheets.get('/v2/shipment/list', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const shipmentDate = c.req.query('date');  // 출고일
    const status = c.req.query('status');

    if (!shipmentDate) {
      return c.json({ success: false, error: 'date 파라미터 필수' }, 400);
    }

    // ★ 출고일 - 1일 = 생산일
    const shipDateObj = new Date(shipmentDate);
    shipDateObj.setDate(shipDateObj.getDate() - 1);
    const productionDate = shipDateObj.toISOString().split('T')[0];

    // ★ 생산실적 시트에서 직접 조회 (SSOT - Single Source of Truth)
    // 실제 시트 구조: A:생산일, B:제품코드, C:제품명, D:수량, E:LOT번호, F:채널, G:비고, H:생성일
    const productionData = await service.readSheet('생산실적', 'A2:H');
    
    // ★ 제품코드별 순번 카운터 (LOT 형식: 20260601-PR253-001)
    const lotCounters: Record<string, number> = {};
    
    let records = productionData
      .map(row => {
        // 날짜 처리
        let prodDate = row[0];
        if (typeof prodDate === 'number' || /^\d+$/.test(prodDate)) {
          const excelDate = parseInt(prodDate);
          const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
          prodDate = jsDate.toISOString().split('T')[0];
        } else if (typeof prodDate === 'string') {
          prodDate = prodDate.replace(/^'/, '');
        }
        
        const productCode = row[1]?.toString() || '';
        let lotNumber = row[4]?.toString() || '';
        
        // ★★★ 생산일보와 동일한 LOT 형식: 20260601-PR253-001 (날짜-제품코드-순번) ★★★
        if (!lotNumber || lotNumber.length < 10) {
          if (!lotCounters[productCode]) lotCounters[productCode] = 0;
          lotCounters[productCode]++;
          const dateStr = prodDate.replace(/-/g, '');
          lotNumber = `${dateStr}-${productCode}-${String(lotCounters[productCode]).padStart(3, '0')}`;
        }
        
        // ★ 실제 시트 구조: A:생산일, B:제품코드, C:제품명, D:수량, E:LOT번호, F:채널, G:비고, H:생성일
        return {
          shipment_date: shipmentDate,  // 출고일 (조회 기준일)
          production_date: prodDate,     // 생산일
          product_code: productCode,
          product_name: row[2]?.toString() || '',
          quantity: parseFloat(row[3]) || 0,
          unit: 'EA',
          lot_number: lotNumber,
          channel: row[5]?.toString() || '',
          status: '출고완료',  // ★★★ 출고완료로 표기 ★★★
          remark: row[6]?.toString() || `${prodDate} 생산분`
        };
      })
      .filter(r => r.production_date === productionDate);  // 생산일 기준 필터

    // 상태 필터링
    if (status) {
      records = records.filter(r => r.status === status);
    }

    // 요약 통계
    const summary = {
      total_count: records.length,
      total_quantity: records.reduce((sum, r) => sum + r.quantity, 0),
      production_date: productionDate,
      by_status: {} as Record<string, number>,
      by_channel: {} as Record<string, number>
    };

    for (const r of records) {
      const st = r.status || '출고예정';
      summary.by_status[st] = (summary.by_status[st] || 0) + 1;
      if (r.channel) {
        summary.by_channel[r.channel] = (summary.by_channel[r.channel] || 0) + r.quantity;
      }
    }

    return c.json({
      success: true,
      filters: { date: shipmentDate, production_date: productionDate, status },
      summary,
      data: records,
      note: `★ 출고일 ${shipmentDate} = 생산일 ${productionDate}의 생산실적 기반`
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * 제품재고 현황 조회
 * 
 * GET /api/sheets/v2/shipment/product-inventory?product_code=PR001
 */
sheets.get('/v2/shipment/product-inventory', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const productCode = c.req.query('product_code');

    let inventoryData: any[][] = [];
    try {
      inventoryData = await service.readSheet('제품재고', 'A2:E');
    } catch (e) {
      return c.json({
        success: true,
        message: '제품재고 시트가 없습니다.',
        data: []
      });
    }

    let records = inventoryData.map(row => ({
      product_code: row[0],
      product_name: row[1],
      current_stock: parseFloat(row[2]) || 0,
      unit: row[3] || 'EA',
      last_updated: row[4]?.toString().replace(/^'/, '')
    }));

    if (productCode) {
      records = records.filter(r => r.product_code === productCode);
    }

    return c.json({
      success: true,
      total_items: records.length,
      total_stock: records.reduce((sum, r) => sum + r.current_stock, 0),
      data: records
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * 생산 → 출고 자동화 워크플로우 (원클릭)
 * 
 * POST /api/sheets/v2/shipment/auto-process
 * Body: { production_date: "YYYY-MM-DD", auto_confirm: false }
 * 
 * 1. 생산일보 기준 출고일지 자동 생성 (생산일+1 = 출고일)
 * 2. auto_confirm=true 시 즉시 출고확정 및 재고차감
 */
sheets.post('/v2/shipment/auto-process', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const { production_date, auto_confirm = false } = body;

    if (!production_date) {
      return c.json({ success: false, error: 'production_date 필수' }, 400);
    }

    // Step 1: 출고일지 자동 생성
    const generateResult = await (async () => {
      const productions = await service.getProductionRecords(production_date);
      
      if (!productions || productions.length === 0) {
        return { success: true, shipment_count: 0, shipment_date: null };
      }

      const prodDateObj = new Date(production_date);
      prodDateObj.setDate(prodDateObj.getDate() + 1);
      const shipmentDate = prodDateObj.toISOString().split('T')[0];

      // 출고일지 헤더 확인
      const shipmentHeaders = [
        '출고일', '생산일', '제품코드', '제품명', '수량', '단위',
        '채널', '생산LOT', '출고상태', '비고'
      ];

      // 출고일지 시트 존재 확인 및 헤더 생성
      let existingData: any[][] = [];
      let needsHeader = false;
      
      try {
        // A1:J1 읽어서 헤더 확인
        const headerRow = await service.readSheet('출고일지', 'A1:J1');
        if (!headerRow || headerRow.length === 0 || !headerRow[0] || headerRow[0][0] !== '출고일') {
          needsHeader = true;
        }
        // 기존 데이터 읽기
        existingData = await service.readSheet('출고일지', 'A2:J');
      } catch (e: any) {
        // 시트가 없으면 생성
        console.log('출고일지 시트 없음, 시트 생성 시도');
        await service.createSheetIfNotExists('출고일지');
        needsHeader = true;
        existingData = [];
      }
      
      // 헤더가 없으면 추가
      if (needsHeader) {
        console.log('출고일지 헤더 추가');
        await service.writeSheet('출고일지', 'A1:J1', [shipmentHeaders]);
      }

      const existingKeys = new Set(
        existingData.map(row => `${row[0]?.toString().replace(/^'/, '')}|${row[2]}|${row[7]}`)
      );

      // ★★★ v3.6.34: 제품마스터에서 제품명 맵 조회 ★★★
      const productMasterData = await service.readSheet('제품마스터', 'A2:B');
      const productNameMap = new Map<string, string>();
      for (const row of productMasterData) {
        const code = row[0]?.toString() || '';
        const name = row[1]?.toString() || '';
        if (code && name && !productNameMap.has(code)) {
          productNameMap.set(code, name);
        }
      }

      const shipmentRows = productions
        .filter(prod => !existingKeys.has(`${shipmentDate}|${prod.product_code}|${prod.lot_number}`))
        .map(prod => [
          `'${shipmentDate}`,
          `'${production_date}`,
          prod.product_code,
          prod.product_name || productNameMap.get(prod.product_code) || '',  // ★ 마스터에서 조회
          prod.quantity,
          'EA',
          prod.channel || '',
          prod.lot_number || '',
          '출고예정',
          `${production_date} 생산분`
        ]);

      let appendDetails: any = null;
      if (shipmentRows.length > 0) {
        console.log(`[출고일지] ${shipmentRows.length}건 시트에 추가 시도`);
        console.log(`[출고일지] 첫 번째 행 데이터:`, shipmentRows[0]);
        const appendResult = await service.appendSheet('출고일지', shipmentRows);
        console.log(`[출고일지] appendSheet 결과:`, JSON.stringify(appendResult));
        appendDetails = appendResult;
        if (!appendResult.success) {
          console.error('[출고일지] appendSheet 실패:', appendResult.error);
        }
      }

      return {
        success: true,
        shipment_count: shipmentRows.length,
        shipment_date: shipmentDate,
        production_count: productions.length,
        append_result: appendDetails,
        first_row_sample: shipmentRows.length > 0 ? shipmentRows[0] : null
      };
    })();

    if (!generateResult.shipment_date) {
      return c.json({
        success: true,
        production_date,
        message: '생산실적이 없어 출고일지를 생성하지 않았습니다.',
        step1_generate: { count: 0 },
        step2_confirm: null
      });
    }

    // Step 2: 자동 확정 (옵션)
    let confirmResult = null;
    if (auto_confirm) {
      const shipmentDate = generateResult.shipment_date;
      const shipmentData = await service.readSheet('출고일지', 'A2:J');
      
      const pendingRows = shipmentData
        .map((row, idx) => ({ row, idx: idx + 2 }))
        .filter(({ row }) => 
          row[0]?.toString().replace(/^'/, '') === shipmentDate && 
          row[8] === '출고예정'
        );

      // 제품재고 차감
      let inventoryData: any[][] = [];
      try {
        inventoryData = await service.readSheet('제품재고', 'A2:E');
      } catch (e) {
        await service.writeSheet('제품재고', 'A1:E1', [
          ['제품코드', '제품명', '현재고', '단위', '최종수정일']
        ]);
      }

      const inventoryMap = new Map<string, { row_index: number, qty: number }>();
      inventoryData.forEach((row, idx) => {
        inventoryMap.set(row[0], { row_index: idx + 2, qty: parseFloat(row[2]) || 0 });
      });

      for (const { row, idx } of pendingRows) {
        const productCode = row[2];
        const qty = parseFloat(row[4]) || 0;
        const inv = inventoryMap.get(productCode);

        if (inv) {
          const newQty = Math.max(0, inv.qty - qty);
          await service.writeSheet('제품재고', `C${inv.row_index}:E${inv.row_index}`, [
            [newQty, 'EA', `'${shipmentDate}`]
          ]);
          inv.qty = newQty;
        }

        await service.writeSheet('출고일지', `I${idx}`, [['출고완료']]);
      }

      confirmResult = {
        confirmed_count: pendingRows.length,
        inventory_deducted: pendingRows.length
      };
    }

    return c.json({
      success: true,
      production_date,
      shipment_date: generateResult.shipment_date,
      workflow: auto_confirm ? '생성 + 확정 + 재고차감' : '생성만',
      step1_generate: {
        production_count: generateResult.production_count,
        shipment_created: generateResult.shipment_count,
        append_result: generateResult.append_result,
        first_row_sample: generateResult.first_row_sample
      },
      step2_confirm: confirmResult,
      message: auto_confirm 
        ? `${production_date} 생산 → ${generateResult.shipment_date} 출고 ${generateResult.shipment_count}건 자동 처리 완료`
        : `${production_date} 생산 → ${generateResult.shipment_date} 출고일지 ${generateResult.shipment_count}건 생성 (확정 대기)`,
      note: '★ 생산완료 = 익일 자동 출고. auto_confirm=true 시 즉시 재고 차감.'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// =====================================================
// 📊 기존 출력 레이어 API
// =====================================================

// [3단계] 출력 레이어: 생산일보 데이터 (PDF용)
// ★★★ v3.5.63: PDF용 경량화 - materials 제외 (별도 API로 조회) ★★★
sheets.get('/v2/output/production-report', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const date = c.req.query('date') || new Date().toISOString().split('T')[0];
    // ★ include_materials=true 일 때만 원료 매칭 데이터 포함 (기본값: false)
    const includeMaterials = c.req.query('include_materials') === 'true';
    
    // 1. 생산실적 조회
    const productions = await service.getProductionRecords(date);
    
    if (productions.length === 0) {
      return c.json({
        success: true,
        layer: 'OUTPUT',
        date,
        report: {
          title: `생산일보 - ${date}`,
          total_items: 0,
          total_quantity: 0,
          items: []
        }
      });
    }
    
    // 2. 로트매칭 정보 조회 - ★ include_materials=true 일 때만 ★
    let lotMatchingMap = new Map<string, any[]>();
    if (includeMaterials) {
      const lotMatchingData = await service.readSheet('로트매칭', 'A2:G');
      
      for (const row of lotMatchingData) {
        let rowDate = row[0]?.toString().replace(/^'/, '');
        if (/^\d{5}$/.test(rowDate)) {
          const excelDate = parseInt(rowDate);
          const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
          rowDate = jsDate.toISOString().split('T')[0];
        }
        
        if (rowDate === date) {
          const lotNumber = row[1]?.toString();
          const key = `${date}|${lotNumber}`;
          if (!lotMatchingMap.has(key)) {
            lotMatchingMap.set(key, []);
          }
          lotMatchingMap.get(key)!.push({
            item_code: row[2],
            item_name: row[3],
            usage_qty: parseFloat(row[4]) || 0,
            material_lot: row[5] || '',
            expiry_date: row[6] || ''
          });
        }
      }
    }
    
    // 3. 제품마스터에서 소비기한 정보 조회 (SSOT)
    const productMaster = await service.getProductMaster();
    const expiryMap = new Map<string, number>();
    
    for (const pm of productMaster) {
      const key = `${pm.product_code}|${pm.channel || ''}`;
      expiryMap.set(key, pm.expiry_days || 24);
      if (!expiryMap.has(pm.product_code)) {
        expiryMap.set(pm.product_code, pm.expiry_days || 24);
      }
    }
    
    // 4. 생산일보 데이터 구성 - ★ materials 선택적 포함 ★
    // ★★★ v3.6.03: 채널이 여러 개인 경우 (쿠팡, 오아시스) 개별 행으로 분리 ★★★
    const reportItems = [];
    
    for (const prod of productions) {
      // 채널이 ','로 구분된 경우 분리 (예: "쿠팡, 오아시스" → ["쿠팡", "오아시스"])
      const channels = prod.channel 
        ? prod.channel.split(',').map((c: string) => c.trim()).filter((c: string) => c)
        : [''];
      
      // 채널별로 개별 행 생성 (수량은 동일하게 표시 - 실제로는 별도 관리 필요)
      for (const channel of channels) {
        // 채널별 소비기한 조회
        const expiryDays = expiryMap.get(`${prod.product_code}|${channel}`) 
                        || expiryMap.get(prod.product_code) 
                        || 24;

        const item: any = {
          prod_date: prod.prod_date,
          product_code: prod.product_code,
          product_name: prod.product_name,
          quantity: prod.quantity,  // ★ 현재는 동일 수량 (추후 채널별 수량 분리 필요)
          lot_number: prod.lot_number,
          channel: channel,
          expiry_days: expiryDays,
          // ★ 원본 채널 (여러 채널 합쳐진 경우)
          original_channel: channels.length > 1 ? prod.channel : undefined
        };
        
        // ★ include_materials=true 일 때만 materials 추가
        if (includeMaterials) {
          const key = `${date}|${prod.lot_number}`;
          item.materials = lotMatchingMap.get(key) || [];
        }

        reportItems.push(item);
      }
    }

    return c.json({
      success: true,
      layer: 'OUTPUT',
      date,
      report: {
        title: `생산일보 - ${date}`,
        total_items: reportItems.length,
        total_quantity: productions.reduce((sum, p) => sum + p.quantity, 0),
        items: reportItems
      },
      note: includeMaterials 
        ? '★ 원료 매칭 데이터 포함'
        : '★ PDF용 경량 데이터. 원료는 /api/sheets/v2/output/material-usage 참조'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// =====================================================
// 📦 반제품(SF) 마스터 동기화 API
// =====================================================

/**
 * Google Sheets 품목마스터에서 반제품(SF) 데이터를 D1에 동기화
 * 
 * POST /api/sheets/sync/semi-finished
 * 
 * Google Sheets 품목마스터 시트에서 SF로 시작하는 반제품 코드를 
 * D1 master 테이블에 동기화합니다.
 */
sheets.post('/sync/semi-finished', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    // 1. Google Sheets 품목마스터에서 전체 데이터 읽기
    // 시트 구조: A=품목코드, B=품목명, C=카테고리, D=단위, E=안전재고, F=유통기한일수
    const masterData = await service.readSheet('품목마스터', 'A2:F');
    
    // 2. SF로 시작하는 반제품만 필터링
    const sfItems = masterData.filter(row => {
      const itemCode = row[0]?.toString().trim();
      return itemCode && itemCode.startsWith('SF');
    });

    if (sfItems.length === 0) {
      return c.json({
        success: true,
        message: '품목마스터에 반제품(SF) 데이터가 없습니다.',
        synced: 0
      });
    }

    // 3. D1에 upsert
    let insertedCount = 0;
    let updatedCount = 0;
    const errors: string[] = [];

    for (const row of sfItems) {
      const itemCode = row[0]?.toString().trim();
      const itemName = row[1]?.toString().trim() || itemCode;
      // Note: D1 master table has CHECK constraint (category IN ('원료', '제품'))
      // So we use '원료' category for semi-finished products (SF)
      const category = '원료'; // SF는 master 제약조건으로 '원료'로 저장
      const unit = row[3]?.toString().trim() || 'kg';
      const safetyStock = parseFloat(row[4]) || 0;
      const expiryDays = parseInt(row[5]) || 30;

      try {
        // 기존 데이터 확인
        const existing = await c.env.DB.prepare(
          'SELECT id FROM master WHERE item_code = ?'
        ).bind(itemCode).first();

        if (existing) {
          // UPDATE
          await c.env.DB.prepare(`
            UPDATE master 
            SET item_name = ?, unit = ?, safety_stock = ?, expiry_days = ?, updated_at = CURRENT_TIMESTAMP
            WHERE item_code = ?
          `).bind(itemName, unit, safetyStock, expiryDays, itemCode).run();
          updatedCount++;
        } else {
          // INSERT
          await c.env.DB.prepare(`
            INSERT INTO master (item_code, item_name, category, unit, current_stock, safety_stock, expiry_days)
            VALUES (?, ?, ?, ?, 0, ?, ?)
          `).bind(itemCode, itemName, category, unit, safetyStock, expiryDays).run();
          insertedCount++;
        }
      } catch (err: any) {
        errors.push(`${itemCode}: ${err.message}`);
      }
    }

    return c.json({
      success: true,
      message: `반제품(SF) 동기화 완료`,
      summary: {
        total_sf_in_sheets: sfItems.length,
        inserted: insertedCount,
        updated: updatedCount,
        errors: errors.length
      },
      errors: errors.length > 0 ? errors : undefined,
      synced_items: sfItems.map(r => ({
        item_code: r[0],
        item_name: r[1],
        unit: r[3] || 'kg'
      }))
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * D1 master 테이블에 반제품(SF) 직접 추가/업데이트
 * 
 * POST /api/sheets/sync/semi-finished/manual
 * Body: { items: [{ item_code, item_name, unit?, expiry_days? }] }
 * 
 * Google Sheets에 데이터가 없거나 수동으로 추가할 때 사용
 */
sheets.post('/sync/semi-finished/manual', async (c) => {
  try {
    const body = await c.req.json();
    const { items } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return c.json({ success: false, error: 'items 배열이 필요합니다.' }, 400);
    }

    let insertedCount = 0;
    let updatedCount = 0;
    const errors: string[] = [];

    for (const item of items) {
      const itemCode = item.item_code?.toString().trim();
      const itemName = item.item_name?.toString().trim() || itemCode;
      
      if (!itemCode || !itemCode.startsWith('SF')) {
        errors.push(`${itemCode || '(없음)'}: SF로 시작하는 코드만 가능`);
        continue;
      }

      const unit = item.unit || 'kg';
      const expiryDays = item.expiry_days || 30;

      try {
        const existing = await c.env.DB.prepare(
          'SELECT id FROM master WHERE item_code = ?'
        ).bind(itemCode).first();

        // Note: D1 master table has CHECK constraint (category IN ('원료', '제품'))
        // So we use '원료' category for semi-finished products (SF)
        // This is acceptable because BOM validation only checks item_code existence
        if (existing) {
          await c.env.DB.prepare(`
            UPDATE master 
            SET item_name = ?, unit = ?, expiry_days = ?, updated_at = CURRENT_TIMESTAMP
            WHERE item_code = ?
          `).bind(itemName, unit, expiryDays, itemCode).run();
          updatedCount++;
        } else {
          await c.env.DB.prepare(`
            INSERT INTO master (item_code, item_name, category, unit, current_stock, safety_stock, expiry_days)
            VALUES (?, ?, '원료', ?, 0, 0, ?)
          `).bind(itemCode, itemName, unit, expiryDays).run();
          insertedCount++;
        }
      } catch (err: any) {
        errors.push(`${itemCode}: ${err.message}`);
      }
    }

    return c.json({
      success: true,
      message: `반제품(SF) 수동 등록 완료`,
      summary: {
        requested: items.length,
        inserted: insertedCount,
        updated: updatedCount,
        errors: errors.length
      },
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// =====================================================
// 🗑️ 특정 날짜 데이터 삭제 API
// =====================================================

/**
 * 특정 날짜의 시트 데이터 삭제
 * 
 * POST /api/sheets/delete-by-date
 * Body: { dates: ["2026-06-01", "2026-06-02"], sheets: ["생산실적", "일별수불부", "로트매칭"] }
 */
sheets.post('/delete-by-date', async (c) => {
  // ★★★ v3.6.42: 데이터 삭제 방지 - API 비활성화 ★★★
  return c.json({ 
    success: false, 
    error: '🚫 데이터 보호: 이 API는 비활성화되었습니다. 시트 데이터를 삭제할 수 없습니다.',
    message: '데이터 무결성 보호를 위해 delete-by-date API가 비활성화되었습니다.'
  }, 403);

  // 아래 코드는 실행되지 않음 (데이터 보호)
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const { dates, sheets: targetSheets } = body;

    if (!dates || !Array.isArray(dates) || dates.length === 0) {
      return c.json({ success: false, error: 'dates 배열 필수' }, 400);
    }

    const sheetsToClean = targetSheets || ['생산실적', '일별수불부', '로트매칭'];
    const results: any[] = [];

    for (const sheetName of sheetsToClean) {
      try {
        // 시트 데이터 읽기
        const data = await service.readSheet(sheetName, 'A2:Z');
        
        if (!data || data.length === 0) {
          results.push({ sheet: sheetName, deleted: 0, message: '데이터 없음' });
          continue;
        }

        // 삭제할 행 번호 찾기 (역순으로 - 아래에서부터 삭제해야 행 번호가 밀리지 않음)
        const rowsToDelete: number[] = [];
        
        for (let i = 0; i < data.length; i++) {
          let rowDate = data[i][0];
          
          // 날짜 처리
          if (typeof rowDate === 'number' || /^\d+$/.test(rowDate)) {
            const excelDate = parseInt(rowDate);
            const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
            rowDate = jsDate.toISOString().split('T')[0];
          } else if (typeof rowDate === 'string') {
            rowDate = rowDate.replace(/^'/, '');
          }
          
          if (dates.includes(rowDate)) {
            rowsToDelete.push(i + 2);  // +2: 헤더(1) + 0-index 보정
          }
        }

        if (rowsToDelete.length === 0) {
          results.push({ sheet: sheetName, deleted: 0, message: '해당 날짜 데이터 없음' });
          continue;
        }

        // 역순으로 정렬 (아래에서부터 삭제)
        rowsToDelete.sort((a, b) => b - a);

        // 행 삭제 (batchUpdate 사용)
        const sheetId = await service.getSheetId(sheetName);
        if (sheetId === null) {
          results.push({ sheet: sheetName, deleted: 0, error: '시트 ID를 찾을 수 없음' });
          continue;
        }

        // 삭제 요청 생성
        const deleteRequests = rowsToDelete.map(rowNum => ({
          deleteDimension: {
            range: {
              sheetId: sheetId,
              dimension: 'ROWS',
              startIndex: rowNum - 1,  // 0-indexed
              endIndex: rowNum         // exclusive
            }
          }
        }));

        // batchUpdate로 삭제 실행
        await service.batchUpdate(deleteRequests);

        results.push({ 
          sheet: sheetName, 
          deleted: rowsToDelete.length, 
          message: `${rowsToDelete.length}행 삭제 완료` 
        });

      } catch (err: any) {
        results.push({ sheet: sheetName, deleted: 0, error: err.message });
      }
    }

    return c.json({
      success: true,
      dates,
      results,
      message: `${dates.join(', ')} 날짜 데이터 삭제 완료`
    });

  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.5.58: 기존 일별수불부 데이터를 수식 기반으로 변환 ★★★
// 전일재고 이월 구조: 전일 같은 원료코드의 현재고(G열)를 참조
sheets.post('/convert-daily-stock-to-formulas', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const confirm = body.confirm === true;
    
    if (!confirm) {
      return c.json({
        success: false,
        error: 'confirm: true를 전송해야 합니다',
        warning: '이 작업은 기존 일별수불부 데이터를 수식 기반으로 변환합니다. 기존 값은 수식으로 대체됩니다.'
      }, 400);
    }

    // 1. 기존 일별수불부 데이터 읽기
    const existingData = await service.readSheet('일별수불부', 'A2:H');
    
    if (existingData.length === 0) {
      return c.json({ success: true, message: '변환할 데이터가 없습니다', converted: 0 });
    }

    // 2. 기존 데이터 삭제 (헤더 제외)
    await service.clearSheetData('일별수불부', 2);

    // 3. 수식 기반 행 생성
    // ★ 전일재고 이월 구조:
    //   - 같은 원료코드의 전일(A열 날짜가 1일 전) 현재고(G열)를 참조
    //   - SUMPRODUCT + INDEX/MATCH 사용
    const formulaRows: any[][] = [];
    
    for (let i = 0; i < existingData.length; i++) {
      const row = existingData[i];
      const rowNum = i + 2; // 실제 시트 행 번호
      
      const date = row[0]?.toString().replace(/^'/, '') || '';
      const itemCode = row[1]?.toString() || '';
      
      if (!date || !itemCode) continue;
      
      formulaRows.push([
        `'${date}`,  // A: 일자 (문자열 강제)
        itemCode,    // B: 원료코드
        // C: 원료명 - 원료입고에서 VLOOKUP
        `=IFERROR(VLOOKUP(B${rowNum},원료입고!B:C,2,FALSE),"")`,
        // D: 전일재고 - 전일 같은 원료코드의 현재고(G열) 참조
        // SUMPRODUCT로 일자가 (당일-1)이고 원료코드가 같은 행의 G열 값 합산
        `=IFERROR(SUMPRODUCT((A$2:A$9999=A${rowNum}-1)*(B$2:B$9999=B${rowNum})*(G$2:G$9999)),0)`,
        // E: 입고량 - 당일 원료입고 합계
        `=IFERROR(SUMIFS(원료입고!E:E,원료입고!B:B,B${rowNum},원료입고!A:A,A${rowNum}),0)`,
        // F: 사용량 - 로트매칭 시트에서 해당 일자+원료코드 합계
        `=IFERROR(SUMIFS(로트매칭!E:E,로트매칭!C:C,B${rowNum},로트매칭!A:A,A${rowNum}),0)`,
        // G: 현재고 = 전일재고 + 입고 - 사용
        `=D${rowNum}+E${rowNum}-F${rowNum}`,
        'kg'  // H: 단위
      ]);
    }

    // 4. 수식 행 일괄 저장
    if (formulaRows.length > 0) {
      await service.appendSheetWithFormulas('일별수불부', formulaRows);
    }

    return c.json({
      success: true,
      message: `일별수불부 ${formulaRows.length}건을 수식 기반으로 변환 완료`,
      converted: formulaRows.length,
      formula_structure: {
        'D열(전일재고)': '전일 같은 원료코드의 현재고(G열) 참조',
        'E열(입고량)': '원료입고 시트에서 당일+원료코드 합계',
        'F열(사용량)': '로트매칭 시트에서 당일+원료코드 합계',
        'G열(현재고)': '전일재고 + 입고 - 사용'
      },
      note: '이제 구글시트에서 셀 클릭 시 수식이 보입니다'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.5.61: 일별수불부 6월 1일 데이터 초기화 (ERP 마감재고 기준) ★★★
sheets.post('/init-daily-stock', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const { date = '2026-06-01' } = body;

    // 1. ERP inbound 테이블에서 해당 날짜까지의 원료별 재고 계산
    // (잔여수량 기준 - remain_qty)
    const stockData = await c.env.DB.prepare(`
      SELECT 
        i.item_code,
        m.item_name,
        SUM(i.remain_qty) as stock,
        COALESCE(m.unit, 'kg') as unit
      FROM inbound i
      LEFT JOIN master m ON i.item_code = m.item_code
      WHERE i.inbound_date <= ? 
        AND i.item_code LIKE 'R%'
        AND i.remain_qty > 0
      GROUP BY i.item_code
      ORDER BY i.item_code
    `).bind(date).all();

    if (!stockData.results || stockData.results.length === 0) {
      return c.json({ success: false, error: '해당 날짜의 재고 데이터가 없습니다' }, 400);
    }

    // 2. 일별수불부 기존 데이터 지우기 (헤더 제외)
    // 먼저 기존 데이터 범위 확인
    const existingData = await service.readSheet('일별수불부', 'A2:H');
    if (existingData.length > 0) {
      // 기존 데이터가 있으면 지우기 (빈 배열로 덮어쓰기)
      const clearRows = existingData.map(() => ['', '', '', '', '', '', '', '']);
      await service.writeSheet('일별수불부', `A2:H${existingData.length + 1}`, clearRows);
    }

    // 3. 수식 기반 행 생성
    // ★★★ v3.5.61 수정: 6월 1일 전일재고에 ERP 잔여재고(시작재고) 직접 입력 ★★★
    const formulaRows: any[][] = [];
    let rowNum = 2;

    for (const item of stockData.results as any[]) {
      // 6월 1일은 전환 기준일이므로:
      // - 전일재고(D열) = ERP 잔여재고 (시작재고 역할)
      // - 입고량(E열) = 6월 1일 입고분만 합계
      // - 사용량(F열) = 6월 1일 로트매칭 사용량
      // - 현재고(G열) = 전일재고 + 입고 - 사용
      const startingStock = parseFloat(item.stock) || 0;
      
      formulaRows.push([
        `'${date}`,  // A: 일자 (문자열 강제)
        item.item_code,  // B: 원료코드
        `=IFERROR(VLOOKUP(B${rowNum},원료입고!B:C,2,FALSE),"")`,  // C: 원료명 (원료입고에서 참조)
        startingStock,  // D: 전일재고 = ★ ERP 시작 잔여재고 ★
        `=IFERROR(SUMIFS(원료입고!E:E,원료입고!B:B,B${rowNum},원료입고!A:A,A${rowNum}),0)`,  // E: 입고량
        `=IFERROR(SUMIFS(로트매칭!E:E,로트매칭!C:C,B${rowNum},로트매칭!A:A,A${rowNum}),0)`,  // F: 사용량
        `=D${rowNum}+E${rowNum}-F${rowNum}`,  // G: 현재고
        item.unit || 'kg'  // H: 단위
      ]);
      rowNum++;
    }

    // 4. 구글시트에 기록
    if (formulaRows.length > 0) {
      await service.writeSheet('일별수불부', `A2:H${formulaRows.length + 1}`, formulaRows);
    }

    return c.json({
      success: true,
      message: `일별수불부 ${date} 초기화 완료`,
      data: {
        date,
        items_count: formulaRows.length,
        items: (stockData.results as any[]).map(i => ({
          item_code: i.item_code,
          item_name: i.item_name,
          stock: i.stock
        }))
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.5.61: 로트매칭 기존 데이터 수정 (날짜 형식 + SF원료 공란 처리) ★★★
sheets.post('/fix-lot-matching', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    // 1. 기존 로트매칭 데이터 읽기
    const data = await service.readSheet('로트매칭', 'A2:G');
    if (data.length === 0) {
      return c.json({ success: false, error: '로트매칭 데이터 없음' }, 400);
    }

    // SF원료 목록
    const SF_ITEMS = ['SF001', 'SF002', 'SF003', 'SF004', 'SF005', 'SF006', 'SF007', 'SF008', 'SF009', 'SF010'];

    // 2. 데이터 수정
    const fixedRows: any[][] = [];
    let fixedCount = 0;

    for (const row of data) {
      let prodDate = row[0];
      const productLot = row[1];
      const itemCode = row[2];
      const itemName = row[3];
      const usage = row[4];
      let lotNumber = row[5];
      let expiryDate = row[6];

      // 날짜가 숫자면 변환 (엑셀 시리얼 번호)
      if (typeof prodDate === 'number' || /^\d{5}$/.test(prodDate?.toString())) {
        const excelDate = parseInt(prodDate);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        prodDate = `'${jsDate.toISOString().split('T')[0]}`;
        fixedCount++;
      } else if (prodDate && !prodDate.toString().startsWith("'")) {
        prodDate = `'${prodDate}`;
      }

      // 소비기한도 숫자면 변환
      if (typeof expiryDate === 'number' || /^\d{5}$/.test(expiryDate?.toString())) {
        const excelDate = parseInt(expiryDate);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        expiryDate = jsDate.toISOString().split('T')[0];
        fixedCount++;
      }

      // SF원료: '재고부족' → 공란
      if (SF_ITEMS.includes(itemCode) && lotNumber === '재고부족') {
        lotNumber = '';
        expiryDate = '';
        fixedCount++;
      }

      fixedRows.push([prodDate, productLot, itemCode, itemName, usage, lotNumber, expiryDate]);
    }

    // 3. 수정된 데이터로 덮어쓰기
    await service.writeSheet('로트매칭', `A2:G${fixedRows.length + 1}`, fixedRows);

    return c.json({
      success: true,
      message: `로트매칭 데이터 수정 완료`,
      data: {
        total_rows: fixedRows.length,
        fixed_count: fixedCount
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.5.62: 일별수불부 재구성 (잘못된 데이터 수정) ★★★
sheets.post('/rebuild-daily-stock', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const date = body.date;  // 필수: 추가할 날짜 (예: 2026-06-02)
    const clearInvalid = body.clear_invalid !== false;  // 기본 true: 잘못된 데이터 정리
    
    if (!date) {
      return c.json({ success: false, error: 'date 필수' }, 400);
    }

    // 1. 현재 일별수불부 전체 데이터 읽기
    const allData = await service.readSheet('일별수불부', 'A2:H');
    
    // 2. 6월 1일 데이터와 잘못된 6월 2일+ 데이터 분리
    const june1Data: any[][] = [];
    const invalidData: any[][] = [];
    
    for (const row of allData) {
      const rowDate = row[0]?.toString().replace(/^'/, '');
      if (rowDate === '2026-06-01') {
        june1Data.push(row);
      } else if (rowDate) {
        // 6월 1일 이후 데이터는 잘못된 것으로 간주 (수식이 값으로 저장됨)
        invalidData.push(row);
      }
    }

    // 3. ★★★ v3.5.69: 전일(6월1일)의 모든 원료를 기준으로 생성 ★★★
    // (사용량 0인 원료도 포함하여 완전한 일별수불부 유지)
    
    // SF원료, SM부자재, 정제수 제외 (원료만 일별수불부 대상)
    const EXCLUDE_ITEMS = ['RM184', 'SF001', 'SF002', 'SF003', 'SF004', 'SF005', 'SF006', 'SF007', 'SF008', 'SF009', 'SF010'];
    
    // 6월 1일 데이터에서 모든 품목코드 추출 (전일 재고가 있는 모든 원료)
    // ★ v3.5.72: Set으로 중복 제거 필수!
    // ★ v3.5.75: SM부자재 제외
    const allItemCodesSet = new Set(
      june1Data
        .map(row => row[1]?.toString())
        .filter(code => code && !EXCLUDE_ITEMS.includes(code) && !code.startsWith('SM'))
    );
    const allItemCodes = Array.from(allItemCodesSet);
    
    // ★ v3.5.68: 품목코드순 정렬 (관리자 재고 검토 편의를 위해 고정 순서)
    const itemCodes = allItemCodes.sort((a, b) => {
      // 숫자 부분 추출하여 자연스러운 정렬 (R002 < R012 < R102)
      const aMatch = a.match(/^([A-Z]+)(\d+)$/);
      const bMatch = b.match(/^([A-Z]+)(\d+)$/);
      if (aMatch && bMatch) {
        // 같은 접두사면 숫자로 비교
        if (aMatch[1] === bMatch[1]) {
          return parseInt(aMatch[2]) - parseInt(bMatch[2]);
        }
        // 다른 접두사면 알파벳 순서
        return aMatch[1].localeCompare(bMatch[1]);
      }
      return a.localeCompare(b);
    });

    if (itemCodes.length === 0) {
      return c.json({
        success: false,
        error: `전일(6월1일) 데이터에 원료 정보가 없습니다`
      }, 400);
    }

    // 5. 6월 1일 데이터의 현재고를 맵으로 만들기 (전일재고 참조용)
    const june1StockMap = new Map<string, number>();
    for (const row of june1Data) {
      const itemCode = row[1]?.toString();
      const currentStock = parseFloat(row[6]) || 0;  // G열: 현재고
      if (itemCode) june1StockMap.set(itemCode, currentStock);
    }

    // 6. 새 날짜의 수식 행 생성
    const startRow = june1Data.length + 2;  // 6월 1일 데이터 다음 행
    const newRows: any[][] = [];
    
    for (let i = 0; i < itemCodes.length; i++) {
      const itemCode = itemCodes[i];
      const rowNum = startRow + i;
      const prevStock = june1StockMap.get(itemCode) || 0;
      
      newRows.push([
        `'${date}`,  // A: 일자
        itemCode,    // B: 원료코드
        `=IFERROR(VLOOKUP(B${rowNum},원료입고!B:C,2,FALSE),"")`,  // C: 원료명
        prevStock,   // D: 전일재고 = 6월 1일 현재고
        `=IFERROR(SUMIFS(원료입고!E:E,원료입고!B:B,B${rowNum},원료입고!A:A,A${rowNum}),0)`,  // E: 입고량
        `=IFERROR(SUMIFS(로트매칭!E:E,로트매칭!C:C,B${rowNum},로트매칭!A:A,A${rowNum}),0)`,  // F: 사용량
        `=D${rowNum}+E${rowNum}-F${rowNum}`,  // G: 현재고
        'kg'  // H: 단위
      ]);
    }

    // 7. 잘못된 데이터 영역 클리어 후 새 데이터 쓰기
    if (clearInvalid && invalidData.length > 0) {
      // 6월 1일 데이터 이후 모든 행 클리어
      const clearRange = `A${startRow}:H${startRow + invalidData.length + 200}`;
      await service.clearRange('일별수불부', clearRange);
    }

    // 8. 새 데이터 쓰기 (특정 위치에 직접 쓰기)
    const writeRange = `A${startRow}:H${startRow + newRows.length - 1}`;
    await service.writeSheetWithFormulas('일별수불부', writeRange, newRows);

    return c.json({
      success: true,
      message: `${date} 일별수불부 재구성 완료`,
      data: {
        date,
        june1_rows: june1Data.length,
        invalid_rows_cleared: clearInvalid ? invalidData.length : 0,
        new_rows_created: newRows.length,
        start_row: startRow,
        sample_items: itemCodes.slice(0, 5)
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.5.62: 일별수불부 특정 일자 생성 API (디버그/수동 생성용) ★★★
sheets.post('/create-daily-stock', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const date = body.date;  // 필수: 생성할 날짜 (예: 2026-06-02)
    
    if (!date) {
      return c.json({ success: false, error: 'date 필수' }, 400);
    }

    // 1. 로트매칭에서 해당 날짜에 사용된 원료 조회
    const lotMatchingData = await service.readSheet('로트매칭', 'A2:E');
    const usedItems = new Set<string>();
    
    for (const row of lotMatchingData) {
      let rowDate = row[0]?.toString().replace(/^'/, '');
      // 엑셀 시리얼 번호 변환
      if (/^\d{5}$/.test(rowDate)) {
        const excelDate = parseInt(rowDate);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        rowDate = jsDate.toISOString().split('T')[0];
      }
      
      if (rowDate === date) {
        const itemCode = row[2]?.toString();
        if (itemCode) usedItems.add(itemCode);
      }
    }

    // 2. SF원료, SM부자재, 정제수 제외 (원료만 일별수불부 대상)
    const EXCLUDE_ITEMS = ['RM184', 'SF001', 'SF002', 'SF003', 'SF004', 'SF005', 'SF006', 'SF007', 'SF008', 'SF009', 'SF010'];
    const itemCodes = Array.from(usedItems).filter(code => !EXCLUDE_ITEMS.includes(code) && !code.startsWith('SM'));

    if (itemCodes.length === 0) {
      return c.json({
        success: false,
        error: `${date} 로트매칭에 해당 날짜 원료 사용 기록 없음`,
        debug: {
          total_lot_matching_rows: lotMatchingData.length,
          sample_dates: lotMatchingData.slice(0, 5).map(r => r[0])
        }
      }, 400);
    }

    // 3. 기존 일별수불부 데이터 확인
    const existingData = await service.readSheet('일별수불부', 'A2:B');
    const existingKeys = new Set(
      existingData
        .filter(row => row[0]?.toString().replace(/^'/, '') === date)
        .map(row => `${row[0]?.toString().replace(/^'/, '')}_${row[1]}`)
    );

    // 4. 새로 추가할 원료코드만 필터링
    const newItemCodes = itemCodes.filter(code => !existingKeys.has(`${date}_${code}`));

    if (newItemCodes.length === 0) {
      return c.json({
        success: true,
        message: `${date} 일자에 이미 모든 원료가 등록되어 있습니다.`,
        data: {
          requested_items: itemCodes.length,
          existing_items: existingKeys.size,
          new_items: 0
        }
      });
    }

    // 5. 수식이 적용된 행 생성
    const rows: any[][] = [];
    for (const itemCode of newItemCodes) {
      const rowNum = existingData.length + rows.length + 2;
      
      rows.push([
        `'${date}`,  // A: 일자 (문자열 강제)
        itemCode,    // B: 원료코드
        `=IFERROR(VLOOKUP(B${rowNum},원료입고!B:C,2,FALSE),"")`,  // C: 원료명
        `=IFERROR(SUMIFS(원료입고!I:I,원료입고!B:B,B${rowNum},원료입고!A:A,"<"&A${rowNum}),0)`,  // D: 전일재고
        `=IFERROR(SUMIFS(원료입고!E:E,원료입고!B:B,B${rowNum},원료입고!A:A,A${rowNum}),0)`,  // E: 입고량
        `=IFERROR(SUMIFS(로트매칭!E:E,로트매칭!C:C,B${rowNum},로트매칭!A:A,A${rowNum}),0)`,  // F: 사용량
        `=D${rowNum}+E${rowNum}-F${rowNum}`,  // G: 현재고
        'kg'  // H: 단위
      ]);
    }

    // 6. 시트에 추가
    if (rows.length > 0) {
      await service.appendSheetWithFormulas('일별수불부', rows);
    }

    return c.json({
      success: true,
      message: `${date} 일별수불부 ${rows.length}건 수식 행 생성 완료`,
      data: {
        date,
        requested_items: itemCodes.length,
        existing_items: existingKeys.size,
        new_items: rows.length,
        sample_items: newItemCodes.slice(0, 10)
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.5.65: 로트매칭 디버그 API - 특정 원료의 사용량 원본 데이터 조회 ★★★
sheets.get('/debug/lot-matching', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const date = c.req.query('date');  // 조회 날짜
    const itemCode = c.req.query('item_code');  // 원료코드

    // 1. 로트매칭 전체 데이터 읽기 (A:생산일, B:제품LOT, C:원료코드, D:원료명, E:사용량, F:원료LOT, G:유통기한)
    const lotMatchingData = await service.readSheet('로트매칭', 'A2:G');
    
    // 2. 날짜 변환 함수
    const parseDate = (val: any): string => {
      if (!val) return '';
      let dateStr = val.toString().replace(/^'/, '');
      
      // 엑셀 시리얼 번호 변환 (예: 46174 = 2026-06-01)
      if (/^\d{5}$/.test(dateStr)) {
        const excelDate = parseInt(dateStr);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        dateStr = jsDate.toISOString().split('T')[0];
      }
      return dateStr;
    };

    // 3. 필터링
    let filteredData = lotMatchingData.map(row => ({
      date: parseDate(row[0]),
      date_raw: row[0]?.toString() || '',
      product_lot: row[1]?.toString() || '',
      item_code: row[2]?.toString() || '',
      item_name: row[3]?.toString() || '',
      usage_qty: parseFloat(row[4]) || 0,
      material_lot: row[5]?.toString() || '',
      expiry_date: row[6]?.toString() || ''
    }));

    if (date) {
      filteredData = filteredData.filter(row => row.date === date);
    }
    if (itemCode) {
      filteredData = filteredData.filter(row => row.item_code === itemCode);
    }

    // 4. 통계 집계
    const totalUsage = filteredData.reduce((sum, row) => sum + row.usage_qty, 0);
    
    // 5. 제품별 집계
    const byProduct = new Map<string, { product_lot: string; qty: number; count: number }>();
    for (const row of filteredData) {
      const key = row.product_lot;
      if (!byProduct.has(key)) {
        byProduct.set(key, { product_lot: key, qty: 0, count: 0 });
      }
      const item = byProduct.get(key)!;
      item.qty += row.usage_qty;
      item.count++;
    }

    return c.json({
      success: true,
      filters: { date, item_code: itemCode },
      total_records: filteredData.length,
      total_usage_kg: totalUsage.toFixed(5),
      by_product: Array.from(byProduct.values()).sort((a, b) => b.qty - a.qty),
      data: filteredData,
      note: 'BOM 배합비 검증 - 각 행의 usage_qty가 제품당 배합비 * 생산수량과 일치해야 함'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.5.65: BOM 마스터 조회 API - 특정 원료의 배합비 확인 ★★★
sheets.get('/debug/bom', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const itemCode = c.req.query('item_code');  // 원료코드

    // BOM 마스터 조회 (A:제품코드, B:제품명, C:원료코드, D:원료명, E:배합비, F:단위)
    const bomData = await service.readSheet('BOM마스터', 'A2:F');
    
    let filteredData = bomData.map(row => ({
      product_code: row[0]?.toString() || '',
      product_name: row[1]?.toString() || '',
      item_code: row[2]?.toString() || '',
      item_name: row[3]?.toString() || '',
      quantity: parseFloat(row[4]) || 0,
      unit: row[5]?.toString() || 'g'
    }));

    if (itemCode) {
      filteredData = filteredData.filter(row => row.item_code === itemCode);
    }

    return c.json({
      success: true,
      filter: { item_code: itemCode },
      count: filteredData.length,
      data: filteredData,
      note: '배합비 단위 확인 - g/kg 단위에 따라 사용량 계산 달라짐'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.5.65: 생산실적 조회 API - 특정 날짜의 생산 수량 확인 ★★★
sheets.get('/debug/production', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const date = c.req.query('date');
    const productCode = c.req.query('product_code');

    // 생산실적 조회 (A:생산일, B:제품코드, C:제품명, D:수량, E:LOT번호, F:채널, G:상태, H:소비기한)
    const productionData = await service.readSheet('생산실적', 'A2:H');
    
    // 날짜 변환
    const parseDate = (val: any): string => {
      if (!val) return '';
      let dateStr = val.toString().replace(/^'/, '');
      if (/^\d{5}$/.test(dateStr)) {
        const excelDate = parseInt(dateStr);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        dateStr = jsDate.toISOString().split('T')[0];
      }
      return dateStr;
    };

    let filteredData = productionData.map(row => ({
      date: parseDate(row[0]),
      date_raw: row[0]?.toString() || '',
      product_code: row[1]?.toString() || '',
      product_name: row[2]?.toString() || '',
      quantity: parseFloat(row[3]) || 0,
      lot_number: row[4]?.toString() || '',
      channel: row[5]?.toString() || '',
      status: row[6]?.toString() || '',
      expiry_date: row[7]?.toString() || ''
    }));

    if (date) {
      filteredData = filteredData.filter(row => row.date === date);
    }
    if (productCode) {
      filteredData = filteredData.filter(row => row.product_code === productCode);
    }

    // 제품별 집계
    const byProduct = new Map<string, { product_code: string; product_name: string; total_qty: number; count: number }>();
    for (const row of filteredData) {
      const key = row.product_code;
      if (!byProduct.has(key)) {
        byProduct.set(key, { product_code: key, product_name: row.product_name, total_qty: 0, count: 0 });
      }
      const item = byProduct.get(key)!;
      item.total_qty += row.quantity;
      item.count++;
    }

    return c.json({
      success: true,
      filters: { date, product_code: productCode },
      total_records: filteredData.length,
      total_quantity: filteredData.reduce((sum, row) => sum + row.quantity, 0),
      by_product: Array.from(byProduct.values()).sort((a, b) => b.total_qty - a.total_qty),
      data: filteredData,
      note: '생산 수량과 BOM 배합비를 곱하면 원료 사용량이 됨'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.5.65: WPC(R002) 사용량 검증 API - BOM 배합비 * 생산수량 vs 로트매칭 사용량 비교 ★★★
sheets.get('/debug/verify-usage', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const date = c.req.query('date') || '2026-06-02';
    const itemCode = c.req.query('item_code') || 'R002';

    // 1. BOM 마스터에서 해당 원료 배합비 조회 - ★ v3.5.71: 단위 통일 (g → kg 변환)
    const bomData = await service.readSheet('BOM마스터', 'A2:F');
    const bomMap = new Map<string, { quantity_kg: number; original_qty: number; original_unit: string }>();
    for (const row of bomData) {
      if (row[2]?.toString() === itemCode) {
        const productCode = row[0]?.toString();
        const rawQty = parseFloat(row[4]) || 0;
        const unit = (row[5] || 'kg').toString().toLowerCase().trim();
        // g 단위면 /1000으로 kg 변환
        const quantity_kg = unit === 'g' ? rawQty / 1000 : rawQty;
        
        bomMap.set(productCode, {
          quantity_kg: quantity_kg,
          original_qty: rawQty,
          original_unit: unit
        });
      }
    }

    // 2. 생산실적 조회
    const parseDate = (val: any): string => {
      if (!val) return '';
      let dateStr = val.toString().replace(/^'/, '');
      if (/^\d{5}$/.test(dateStr)) {
        const excelDate = parseInt(dateStr);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        dateStr = jsDate.toISOString().split('T')[0];
      }
      return dateStr;
    };

    const productionData = await service.readSheet('생산실적', 'A2:E');
    const productionMap = new Map<string, { product_code: string; lot_number: string; quantity: number }[]>();
    
    for (const row of productionData) {
      if (parseDate(row[0]) === date) {
        const productCode = row[1]?.toString();
        if (bomMap.has(productCode)) {
          if (!productionMap.has(productCode)) {
            productionMap.set(productCode, []);
          }
          productionMap.get(productCode)!.push({
            product_code: productCode,
            lot_number: row[4]?.toString() || '',
            quantity: parseFloat(row[3]) || 0
          });
        }
      }
    }

    // 3. BOM 기반 예상 사용량 계산 - ★ v3.5.71: 단위 변환 이미 적용됨
    const expectedUsage: any[] = [];
    let totalExpectedKg = 0;
    
    for (const [productCode, productions] of productionMap) {
      const bom = bomMap.get(productCode)!;
      for (const prod of productions) {
        // ★ v3.5.71: BOM 읽을 때 이미 kg로 변환됨
        const usageKg = bom.quantity_kg * prod.quantity;
        
        totalExpectedKg += usageKg;
        expectedUsage.push({
          product_code: productCode,
          lot_number: prod.lot_number,
          production_qty: prod.quantity,
          bom_qty_original: bom.original_qty,
          bom_unit_original: bom.original_unit,
          bom_qty_kg: bom.quantity_kg,
          expected_usage_kg: usageKg.toFixed(5)
        });
      }
    }

    // 4. 로트매칭 실제 사용량 조회
    const lotMatchingData = await service.readSheet('로트매칭', 'A2:E');
    const actualUsage: any[] = [];
    let totalActualKg = 0;
    
    for (const row of lotMatchingData) {
      if (parseDate(row[0]) === date && row[2]?.toString() === itemCode) {
        const qty = parseFloat(row[4]) || 0;
        totalActualKg += qty;
        actualUsage.push({
          product_lot: row[1]?.toString(),
          usage_qty: qty
        });
      }
    }

    // 5. 비교 결과
    const difference = totalActualKg - totalExpectedKg;
    const isMatch = Math.abs(difference) < 0.001;

    return c.json({
      success: true,
      item_code: itemCode,
      date: date,
      expected_usage: {
        total_kg: totalExpectedKg.toFixed(5),
        details: expectedUsage
      },
      actual_usage: {
        total_kg: totalActualKg.toFixed(5),
        details: actualUsage
      },
      comparison: {
        expected_kg: totalExpectedKg.toFixed(5),
        actual_kg: totalActualKg.toFixed(5),
        difference_kg: difference.toFixed(5),
        is_match: isMatch,
        status: isMatch ? '✅ 일치' : '❌ 불일치'
      },
      bom_products_using_this_item: Array.from(bomMap.entries()).map(([code, bom]) => ({
        product_code: code,
        bom_qty: bom.quantity,
        bom_unit: bom.unit
      })),
      note: 'expected = BOM배합비 * 생산수량, actual = 로트매칭 E열 합계'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.5.66: 중복 데이터 정리 API ★★★
// 생산실적, 로트매칭 시트의 중복 데이터를 정리하고 일별수불부 재생성

// 1. 생산실적 중복 정리 API
sheets.post('/cleanup/production', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const date = body.date;  // 정리할 날짜
    const dryRun = body.dry_run !== false;  // 기본 true: 시뮬레이션만

    if (!date) {
      return c.json({ success: false, error: 'date 필수' }, 400);
    }

    // 날짜 변환 함수
    const parseDate = (val: any): string => {
      if (!val) return '';
      let dateStr = val.toString().replace(/^'/, '');
      if (/^\d{5}$/.test(dateStr)) {
        const excelDate = parseInt(dateStr);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        dateStr = jsDate.toISOString().split('T')[0];
      }
      return dateStr;
    };

    // 1. 생산실적 전체 읽기
    const allData = await service.readSheet('생산실적', 'A2:H');
    
    // 2. 해당 날짜 데이터와 다른 날짜 데이터 분리
    const targetDateRows: any[][] = [];
    const otherDateRows: any[][] = [];
    
    for (const row of allData) {
      const rowDate = parseDate(row[0]);
      if (rowDate === date) {
        targetDateRows.push(row);
      } else if (row[0]) {  // 빈 행 제외
        otherDateRows.push(row);
      }
    }

    // 3. 해당 날짜 중복 제거 (제품코드+LOT번호 기준)
    const uniqueMap = new Map<string, any[]>();
    for (const row of targetDateRows) {
      const key = `${row[1]}_${row[4]}`;  // 제품코드_LOT번호
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, row);
      }
    }
    const uniqueRows = Array.from(uniqueMap.values());

    const duplicatesRemoved = targetDateRows.length - uniqueRows.length;

    if (dryRun) {
      return c.json({
        success: true,
        mode: 'dry_run',
        message: '시뮬레이션 결과 (실제 변경 없음)',
        data: {
          date,
          before: targetDateRows.length,
          after: uniqueRows.length,
          duplicates_to_remove: duplicatesRemoved,
          other_dates_preserved: otherDateRows.length
        },
        note: 'dry_run: false로 설정하면 실제 정리 실행'
      });
    }

    // 4. 실제 정리 - 시트 전체 다시 쓰기
    // 4-1. 데이터 영역 클리어 (헤더 제외)
    const clearRange = `A2:H${allData.length + 10}`;
    await service.clearRange('생산실적', clearRange);

    // 4-2. 다른 날짜 데이터 + 정리된 해당 날짜 데이터 합치기
    const newData = [...otherDateRows, ...uniqueRows];
    
    if (newData.length > 0) {
      const writeRange = `A2:H${newData.length + 1}`;
      await service.writeSheet('생산실적', writeRange, newData);
    }

    return c.json({
      success: true,
      mode: 'executed',
      message: `생산실적 ${date} 중복 정리 완료`,
      data: {
        date,
        before: targetDateRows.length,
        after: uniqueRows.length,
        duplicates_removed: duplicatesRemoved,
        total_rows_now: newData.length
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 2. 로트매칭 중복 정리 API
sheets.post('/cleanup/lot-matching', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const date = body.date;
    const dryRun = body.dry_run !== false;

    if (!date) {
      return c.json({ success: false, error: 'date 필수' }, 400);
    }

    const parseDate = (val: any): string => {
      if (!val) return '';
      let dateStr = val.toString().replace(/^'/, '');
      if (/^\d{5}$/.test(dateStr)) {
        const excelDate = parseInt(dateStr);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        dateStr = jsDate.toISOString().split('T')[0];
      }
      return dateStr;
    };

    // 1. 로트매칭 전체 읽기 (A:생산일, B:제품LOT, C:원료코드, D:원료명, E:사용량, F:원료LOT, G:유통기한)
    const allData = await service.readSheet('로트매칭', 'A2:G');
    
    // 2. 해당 날짜와 다른 날짜 분리
    const targetDateRows: any[][] = [];
    const otherDateRows: any[][] = [];
    
    for (const row of allData) {
      const rowDate = parseDate(row[0]);
      if (rowDate === date) {
        targetDateRows.push(row);
      } else if (row[0]) {
        otherDateRows.push(row);
      }
    }

    // 3. 해당 날짜 중복 제거 (제품LOT + 원료코드 + 사용량(반올림) 기준)
    // ★ v3.5.67: 소수점 2자리 반올림하여 비교 (1.23048 vs 1.23 같은 중복 처리)
    const uniqueMap = new Map<string, any[]>();
    for (const row of targetDateRows) {
      const usageQty = parseFloat(row[4]) || 0;
      const roundedUsage = Math.round(usageQty * 100) / 100;  // 소수점 2자리 반올림
      const key = `${row[1]}_${row[2]}_${roundedUsage}`;  // 제품LOT_원료코드_사용량(반올림)
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, row);
      }
    }
    const uniqueRows = Array.from(uniqueMap.values());

    const duplicatesRemoved = targetDateRows.length - uniqueRows.length;

    // 4. 원료별 사용량 비교 (정리 전/후)
    const beforeUsage = new Map<string, number>();
    const afterUsage = new Map<string, number>();
    
    for (const row of targetDateRows) {
      const code = row[2]?.toString() || '';
      const qty = parseFloat(row[4]) || 0;
      beforeUsage.set(code, (beforeUsage.get(code) || 0) + qty);
    }
    for (const row of uniqueRows) {
      const code = row[2]?.toString() || '';
      const qty = parseFloat(row[4]) || 0;
      afterUsage.set(code, (afterUsage.get(code) || 0) + qty);
    }

    // 주요 원료 비교
    const usageComparison: any[] = [];
    for (const [code, before] of beforeUsage) {
      const after = afterUsage.get(code) || 0;
      if (before !== after) {
        usageComparison.push({
          item_code: code,
          before_kg: before.toFixed(3),
          after_kg: after.toFixed(3),
          reduction: (before - after).toFixed(3)
        });
      }
    }

    if (dryRun) {
      return c.json({
        success: true,
        mode: 'dry_run',
        message: '시뮬레이션 결과 (실제 변경 없음)',
        data: {
          date,
          before: targetDateRows.length,
          after: uniqueRows.length,
          duplicates_to_remove: duplicatesRemoved,
          other_dates_preserved: otherDateRows.length,
          usage_changes: usageComparison.slice(0, 20)  // 상위 20개만
        },
        note: 'dry_run: false로 설정하면 실제 정리 실행'
      });
    }

    // 5. 실제 정리
    const clearRange = `A2:G${allData.length + 10}`;
    await service.clearRange('로트매칭', clearRange);

    const newData = [...otherDateRows, ...uniqueRows];
    if (newData.length > 0) {
      const writeRange = `A2:G${newData.length + 1}`;
      await service.writeSheet('로트매칭', writeRange, newData);
    }

    return c.json({
      success: true,
      mode: 'executed',
      message: `로트매칭 ${date} 중복 정리 완료`,
      data: {
        date,
        before: targetDateRows.length,
        after: uniqueRows.length,
        duplicates_removed: duplicatesRemoved,
        total_rows_now: newData.length,
        usage_changes: usageComparison.slice(0, 20)
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 3. 전체 정리 API (생산실적 → 로트매칭 → 일별수불부 순서)
sheets.post('/cleanup/all', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const date = body.date;
    const dryRun = body.dry_run !== false;

    if (!date) {
      return c.json({ success: false, error: 'date 필수' }, 400);
    }

    const parseDate = (val: any): string => {
      if (!val) return '';
      let dateStr = val.toString().replace(/^'/, '');
      if (/^\d{5}$/.test(dateStr)) {
        const excelDate = parseInt(dateStr);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        dateStr = jsDate.toISOString().split('T')[0];
      }
      return dateStr;
    };

    const results: any = {
      date,
      mode: dryRun ? 'dry_run' : 'executed',
      production: {},
      lot_matching: {},
      daily_stock: {}
    };

    // ===== 1. 생산실적 정리 =====
    const prodData = await service.readSheet('생산실적', 'A2:H');
    const prodTargetRows: any[][] = [];
    const prodOtherRows: any[][] = [];
    
    for (const row of prodData) {
      const rowDate = parseDate(row[0]);
      if (rowDate === date) {
        prodTargetRows.push(row);
      } else if (row[0]) {
        prodOtherRows.push(row);
      }
    }

    const prodUniqueMap = new Map<string, any[]>();
    for (const row of prodTargetRows) {
      const key = `${row[1]}_${row[4]}`;
      if (!prodUniqueMap.has(key)) {
        prodUniqueMap.set(key, row);
      }
    }
    const prodUniqueRows = Array.from(prodUniqueMap.values());

    results.production = {
      before: prodTargetRows.length,
      after: prodUniqueRows.length,
      duplicates_removed: prodTargetRows.length - prodUniqueRows.length
    };

    // ===== 2. 로트매칭 정리 =====
    const lotData = await service.readSheet('로트매칭', 'A2:G');
    const lotTargetRows: any[][] = [];
    const lotOtherRows: any[][] = [];
    
    for (const row of lotData) {
      const rowDate = parseDate(row[0]);
      if (rowDate === date) {
        lotTargetRows.push(row);
      } else if (row[0]) {
        lotOtherRows.push(row);
      }
    }

    const lotUniqueMap = new Map<string, any[]>();
    for (const row of lotTargetRows) {
      const key = `${row[1]}_${row[2]}_${row[4]}`;
      if (!lotUniqueMap.has(key)) {
        lotUniqueMap.set(key, row);
      }
    }
    const lotUniqueRows = Array.from(lotUniqueMap.values());

    results.lot_matching = {
      before: lotTargetRows.length,
      after: lotUniqueRows.length,
      duplicates_removed: lotTargetRows.length - lotUniqueRows.length
    };

    // ===== 3. 일별수불부 정리 =====
    const dailyData = await service.readSheet('일별수불부', 'A2:H');
    const dailyTargetRows: any[][] = [];
    const dailyOtherRows: any[][] = [];
    
    for (const row of dailyData) {
      const rowDate = parseDate(row[0]);
      if (rowDate === date) {
        dailyTargetRows.push(row);
      } else if (row[0]) {
        dailyOtherRows.push(row);
      }
    }

    // 일별수불부 중복 제거 (날짜 + 원료코드 기준)
    const dailyUniqueMap = new Map<string, any[]>();
    for (const row of dailyTargetRows) {
      const key = `${row[0]}_${row[1]}`;  // 날짜_원료코드
      if (!dailyUniqueMap.has(key)) {
        dailyUniqueMap.set(key, row);
      }
    }
    const dailyUniqueRows = Array.from(dailyUniqueMap.values());

    results.daily_stock = {
      before: dailyTargetRows.length,
      after: dailyUniqueRows.length,
      duplicates_removed: dailyTargetRows.length - dailyUniqueRows.length
    };

    if (dryRun) {
      return c.json({
        success: true,
        message: '시뮬레이션 결과 (실제 변경 없음)',
        results,
        note: 'dry_run: false로 설정하면 실제 정리 실행'
      });
    }

    // ===== 실제 정리 실행 =====
    
    // 1. 생산실적 정리
    await service.clearRange('생산실적', `A2:H${prodData.length + 10}`);
    const newProdData = [...prodOtherRows, ...prodUniqueRows];
    if (newProdData.length > 0) {
      await service.writeSheet('생산실적', `A2:H${newProdData.length + 1}`, newProdData);
    }

    // 2. 로트매칭 정리
    await service.clearRange('로트매칭', `A2:G${lotData.length + 10}`);
    const newLotData = [...lotOtherRows, ...lotUniqueRows];
    if (newLotData.length > 0) {
      await service.writeSheet('로트매칭', `A2:G${newLotData.length + 1}`, newLotData);
    }

    // 3. 일별수불부 정리
    await service.clearRange('일별수불부', `A2:H${dailyData.length + 10}`);
    const newDailyData = [...dailyOtherRows, ...dailyUniqueRows];
    if (newDailyData.length > 0) {
      await service.writeSheet('일별수불부', `A2:H${newDailyData.length + 1}`, newDailyData);
    }

    return c.json({
      success: true,
      message: `${date} 전체 중복 정리 완료`,
      results,
      totals: {
        production_rows: newProdData.length,
        lot_matching_rows: newLotData.length,
        daily_stock_rows: newDailyData.length
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.5.70: 로트매칭 재계산 API - 기존 데이터 삭제 후 BOM 기반 재계산 ★★★
sheets.post('/recalculate-lot-matching', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const date = body.date;
    const dryRun = body.dry_run !== false;

    if (!date) {
      return c.json({ success: false, error: 'date 필수' }, 400);
    }

    const parseDate = (val: any): string => {
      if (!val) return '';
      let dateStr = val.toString().replace(/^'/, '');
      if (/^\d{5}$/.test(dateStr)) {
        const excelDate = parseInt(dateStr);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        dateStr = jsDate.toISOString().split('T')[0];
      }
      return dateStr;
    };

    // 1. 기존 로트매칭에서 해당 날짜 데이터 분리
    const lotData = await service.readSheet('로트매칭', 'A2:G');
    const otherDateRows: any[][] = [];
    let deletedCount = 0;
    
    for (const row of lotData) {
      const rowDate = parseDate(row[0]);
      if (rowDate === date) {
        deletedCount++;
      } else if (row[0]) {
        otherDateRows.push(row);
      }
    }

    // 2. 생산실적 조회
    const productions = await service.getProductionRecords(date);
    if (productions.length === 0) {
      return c.json({ 
        success: false, 
        error: `${date} 생산실적 없음. 먼저 생산실적을 등록해주세요.` 
      }, 400);
    }

    // 3. BOM 마스터 조회 (단위 변환 포함)
    const bomData = await service.readSheet('BOM마스터', 'A2:F');
    const bomMap = new Map<string, any[]>();
    for (const row of bomData) {
      const productCode = row[0]?.toString() || '';
      if (!productCode) continue;
      
      if (!bomMap.has(productCode)) bomMap.set(productCode, []);
      
      // ★ 단위 변환: g → kg
      const rawQty = parseFloat(row[4]) || 0;
      const unit = (row[5] || 'kg').toString().toLowerCase().trim();
      const quantity_kg = unit === 'g' ? rawQty / 1000 : rawQty;
      
      bomMap.get(productCode)!.push({
        item_code: row[2]?.toString() || '',
        item_name: row[3]?.toString() || '',
        quantity: quantity_kg,
        unit: 'kg'
      });
    }

    // 4. 원료입고 조회 (FEFO용)
    const inboundData = await service.readSheet('원료입고', 'A2:I');
    const inboundMap = new Map<string, any[]>();
    for (const row of inboundData) {
      const itemCode = row[1]?.toString() || '';
      const remainQty = parseFloat(row[8]) || 0;
      if (!itemCode || remainQty <= 0) continue;
      
      if (!inboundMap.has(itemCode)) inboundMap.set(itemCode, []);
      inboundMap.get(itemCode)!.push({
        lot_number: row[3]?.toString() || '',
        remain_qty: remainQty,
        // ★★★ v3.6.03 BUG FIX: 원료입고 시트 구조 - G열(6)=공급업체, H열(7)=소비기한 ★★★
        expiry_date: row[7]?.toString() || ''
      });
    }
    // FEFO 정렬
    for (const [, lots] of inboundMap) {
      lots.sort((a, b) => (a.expiry_date || '9999').localeCompare(b.expiry_date || '9999'));
    }

    // 5. 새 로트매칭 데이터 계산
    const EXCLUDE_STOCK = ['RM184'];
    const SF_ITEMS = ['SF001', 'SF002', 'SF003', 'SF004', 'SF005', 'SF006', 'SF007', 'SF008', 'SF009', 'SF010'];
    const newLotMatchingRows: any[][] = [];
    const usageSummary = new Map<string, number>();

    for (const prod of productions) {
      const bom = bomMap.get(prod.product_code) || [];
      // ★★★ v3.6.10: 제품LOT 형식 통일 (LOT번호-제품코드) ★★★
      const productLot = prod.lot_number.includes('-') 
        ? prod.lot_number  // 이미 제품코드 포함
        : `${prod.lot_number}-${prod.product_code}`;  // 제품코드 추가
      
      for (const material of bom) {
        const usageKg = material.quantity * prod.quantity;
        if (usageKg <= 0) continue;
        
        // 사용량 합계
        usageSummary.set(material.item_code, 
          (usageSummary.get(material.item_code) || 0) + usageKg);

        // 제외 원료 (정제수)
        if (EXCLUDE_STOCK.includes(material.item_code)) {
          newLotMatchingRows.push([
            `'${date}`, productLot, material.item_code, material.item_name,
            usageKg.toFixed(5), '-', '-'
          ]);
          continue;
        }
        
        // SF 원료 (자체 생산)
        if (SF_ITEMS.includes(material.item_code)) {
          newLotMatchingRows.push([
            `'${date}`, productLot, material.item_code, material.item_name,
            usageKg.toFixed(5), '', ''
          ]);
          continue;
        }

        // ★★★ v3.6.04: FEFO 로트 매칭 + 소비기한 만료 LOT 자동 제외 ★★★
        const lots = inboundMap.get(material.item_code) || [];
        let remaining = usageKg;
        
        for (const lot of lots) {
          if (remaining <= 0) break;
          if (lot.remain_qty <= 0) continue;
          
          // ★★★ v3.6.04: 소비기한이 생산일 이전인 LOT는 건너뛰기 ★★★
          if (lot.expiry_date && lot.expiry_date < date) {
            continue;  // 만료된 LOT 건너뛰기
          }
          
          const useFromLot = Math.min(remaining, lot.remain_qty);
          remaining -= useFromLot;
          lot.remain_qty -= useFromLot;  // 메모리상 차감
          
          newLotMatchingRows.push([
            `'${date}`, productLot, material.item_code, material.item_name,
            useFromLot.toFixed(5), lot.lot_number, lot.expiry_date
          ]);
        }
        
        // 재고 부족 시
        if (remaining > 0) {
          newLotMatchingRows.push([
            `'${date}`, productLot, material.item_code, material.item_name,
            remaining.toFixed(5), '재고부족', ''
          ]);
        }
      }
    }

    // 6. dry_run이면 시뮬레이션만
    if (dryRun) {
      // 주요 원료 사용량 비교
      const majorItems = ['R102', 'R101', 'R60', 'R070', 'R114', 'RM211'];
      const comparison: any[] = [];
      
      for (const item of majorItems) {
        const newUsage = usageSummary.get(item) || 0;
        comparison.push({
          item_code: item,
          new_usage_kg: newUsage.toFixed(3)
        });
      }

      return c.json({
        success: true,
        mode: 'dry_run',
        message: '시뮬레이션 결과 (실제 변경 없음)',
        data: {
          date,
          deleted_rows: deletedCount,
          new_rows: newLotMatchingRows.length,
          production_count: productions.length,
          major_items_usage: comparison
        },
        note: 'dry_run: false로 설정하면 실제 재계산 실행'
      });
    }

    // 7. 실제 실행
    // 기존 데이터 전체 클리어 후 다시 작성
    await service.clearRange('로트매칭', `A2:G${lotData.length + 100}`);
    
    const allNewData = [...otherDateRows, ...newLotMatchingRows];
    if (allNewData.length > 0) {
      await service.writeSheet('로트매칭', `A2:G${allNewData.length + 1}`, allNewData);
    }

    return c.json({
      success: true,
      mode: 'executed',
      message: `${date} 로트매칭 재계산 완료`,
      data: {
        date,
        deleted_rows: deletedCount,
        new_rows: newLotMatchingRows.length,
        production_count: productions.length,
        total_rows: allNewData.length
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.5.74: 시트 범위 클리어 API ★★★
sheets.post('/clear-range', async (c) => {
  // ★★★ v3.6.42: 데이터 삭제 방지 - API 비활성화 ★★★
  return c.json({ 
    success: false, 
    error: '🚫 데이터 보호: 이 API는 비활성화되었습니다. 시트 범위를 클리어할 수 없습니다.',
    message: '데이터 무결성 보호를 위해 clear-range API가 비활성화되었습니다.'
  }, 403);

  // 아래 코드는 실행되지 않음 (데이터 보호)
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const sheet = body.sheet;
    const range = body.range;
    
    if (!sheet || !range) {
      return c.json({ success: false, error: 'sheet와 range 필수' }, 400);
    }

    await service.clearRange(sheet, range);
    
    return c.json({
      success: true,
      message: `${sheet} 시트 ${range} 범위 클리어 완료`
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.5.74: 로트매칭 완전 재생성 API ★★★
// 특정 날짜들의 로트매칭을 완전히 삭제하고 새로 계산
sheets.post('/rebuild-lot-matching-dates', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const dates: string[] = body.dates || ['2026-06-01', '2026-06-02'];
    const dryRun = body.dry_run !== false;

    const parseDate = (val: any): string => {
      if (!val) return '';
      let dateStr = val.toString().replace(/^'/, '');
      if (/^\d{5}$/.test(dateStr)) {
        const excelDate = parseInt(dateStr);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        dateStr = jsDate.toISOString().split('T')[0];
      }
      return dateStr;
    };

    // 1. 기존 로트매칭에서 해당 날짜들 제외한 데이터만 분리
    const lotData = await service.readSheet('로트매칭', 'A2:G');
    const preservedRows: any[][] = [];
    let deletedCount = 0;
    
    for (const row of lotData) {
      const rowDate = parseDate(row[0]);
      if (dates.includes(rowDate)) {
        deletedCount++;
      } else if (row[0]) {
        preservedRows.push(row);
      }
    }

    // 2. BOM 마스터 조회
    const bomData = await service.readSheet('BOM마스터', 'A2:F');
    const bomMap = new Map<string, any[]>();
    for (const row of bomData) {
      const productCode = row[0]?.toString() || '';
      if (!productCode) continue;
      if (!bomMap.has(productCode)) bomMap.set(productCode, []);
      
      const rawQty = parseFloat(row[4]) || 0;
      const unit = (row[5] || 'kg').toString().toLowerCase().trim();
      const quantity_kg = unit === 'g' ? rawQty / 1000 : rawQty;
      
      bomMap.get(productCode)!.push({
        item_code: row[2]?.toString() || '',
        item_name: row[3]?.toString() || '',
        quantity: quantity_kg,
        unit: 'kg'
      });
    }

    // 3. 원료입고 조회 (최신 상태)
    const inboundData = await service.readSheet('원료입고', 'A2:I');
    
    // 4. 각 날짜별로 로트매칭 새로 계산
    const EXCLUDE_STOCK = ['RM184'];
    const SF_ITEMS = ['SF001', 'SF002', 'SF003', 'SF004', 'SF005', 'SF006', 'SF007', 'SF008', 'SF009', 'SF010'];
    const allNewRows: any[][] = [];
    const dateResults: any[] = [];
    
    // ★★★ v3.6.51: SF_BOM 데이터 로드 (반제품 → 원료 전개용) ★★★
    const sfBomMap = await service.getSfBom();
    console.log(`[rebuild-lot-matching-dates v3.6.51] SF_BOM 로드: ${Object.keys(sfBomMap).length}개 SF`);

    for (const date of dates) {
      // 원료입고 맵 초기화 (날짜별로 새로 시작)
      const inboundMap = new Map<string, any[]>();
      for (const row of inboundData) {
        const itemCode = row[1]?.toString() || '';
        const remainQty = parseFloat(row[8]) || 0;
        if (!itemCode || remainQty <= 0) continue;
        
        if (!inboundMap.has(itemCode)) inboundMap.set(itemCode, []);
        inboundMap.get(itemCode)!.push({
          lot_number: row[3]?.toString() || '',
          remain_qty: remainQty,
          // ★★★ v3.6.03 BUG FIX: 원료입고 시트 구조 - G열(6)=공급업체, H열(7)=소비기한 ★★★
          expiry_date: row[7]?.toString() || ''
        });
      }
      // FEFO 정렬
      for (const [, lots] of inboundMap) {
        lots.sort((a, b) => (a.expiry_date || '9999').localeCompare(b.expiry_date || '9999'));
      }

      // 생산실적 조회
      const productions = await service.getProductionRecords(date);
      if (productions.length === 0) {
        dateResults.push({ date, status: 'skipped', reason: '생산실적 없음' });
        continue;
      }

      // 로트매칭 계산
      const newRows: any[][] = [];
      
      for (const prod of productions) {
        const bom = bomMap.get(prod.product_code) || [];
        
        for (const material of bom) {
          if (EXCLUDE_STOCK.includes(material.item_code)) continue;
          
          const usageKg = material.quantity * prod.quantity;
          
          // ★★★ v3.6.51: SF 원료 → SF_BOM 전개 (반제품 → 실제 원료) ★★★
          if (SF_ITEMS.includes(material.item_code)) {
            const sfBomItems = sfBomMap[material.item_code] || [];
            
            if (sfBomItems.length === 0) {
              // SF_BOM에 정의되지 않은 SF → 기존처럼 SF 자체로 기록
              newRows.push([
                `'${date}`, prod.lot_number, material.item_code, material.item_name,
                usageKg.toFixed(5), 'SF_BOM미정의', ''
              ]);
              continue;
            }
            
            // SF 사용량 기준으로 실제 원료 전개 후 FEFO 매칭
            for (const sfItem of sfBomItems) {
              const realUsage = usageKg * sfItem.ratio;  // SF사용량 × 원료비율
              if (realUsage <= 0) continue;
              
              // 실제 원료에 대해 FEFO 매칭
              const lots = inboundMap.get(sfItem.materialCode) || [];
              let remaining = realUsage;
              
              for (const lot of lots) {
                if (remaining <= 0) break;
                if (lot.remain_qty <= 0) continue;
                
                // 소비기한이 생산일 이전인 LOT는 건너뛰기
                if (lot.expiry_date && lot.expiry_date < date) {
                  continue;
                }
                
                const useFromLot = Math.min(remaining, lot.remain_qty);
                remaining -= useFromLot;
                lot.remain_qty -= useFromLot;
                
                // [SF001]원료명 형태로 기록 (SF 전개 표시)
                newRows.push([
                  `'${date}`, prod.lot_number, sfItem.materialCode, 
                  `[${material.item_code}]${sfItem.materialName}`,
                  useFromLot.toFixed(5), lot.lot_number, lot.expiry_date
                ]);
              }
              
              if (remaining > 0) {
                newRows.push([
                  `'${date}`, prod.lot_number, sfItem.materialCode,
                  `[${material.item_code}]${sfItem.materialName}`,
                  remaining.toFixed(5), '재고부족', ''
                ]);
              }
            }
            continue;
          }

          // ★★★ v3.6.04: FEFO 로트 매칭 + 소비기한 만료 LOT 자동 제외 ★★★
          const lots = inboundMap.get(material.item_code) || [];
          let remaining = usageKg;
          
          for (const lot of lots) {
            if (remaining <= 0) break;
            if (lot.remain_qty <= 0) continue;
            
            // ★★★ v3.6.04: 소비기한이 생산일 이전인 LOT는 건너뛰기 ★★★
            if (lot.expiry_date && lot.expiry_date < date) {
              continue;  // 만료된 LOT 건너뛰기
            }
            
            const useFromLot = Math.min(remaining, lot.remain_qty);
            remaining -= useFromLot;
            lot.remain_qty -= useFromLot;
            
            newRows.push([
              `'${date}`, prod.lot_number, material.item_code, material.item_name,
              useFromLot.toFixed(5), lot.lot_number, lot.expiry_date
            ]);
          }
          
          if (remaining > 0) {
            newRows.push([
              `'${date}`, prod.lot_number, material.item_code, material.item_name,
              remaining.toFixed(5), '재고부족', ''
            ]);
          }
        }
      }
      
      allNewRows.push(...newRows);
      dateResults.push({ 
        date, 
        status: 'calculated', 
        production_count: productions.length,
        new_rows: newRows.length 
      });
    }

    if (dryRun) {
      return c.json({
        success: true,
        mode: 'dry_run',
        message: '시뮬레이션 결과 (실제 변경 없음)',
        data: {
          dates,
          deleted_rows: deletedCount,
          preserved_rows: preservedRows.length,
          new_rows: allNewRows.length,
          date_results: dateResults
        },
        note: 'dry_run: false로 설정하면 실제 재생성 실행'
      });
    }

    // 5. 실제 실행: 전체 클리어 후 다시 쓰기
    await service.clearRange('로트매칭', `A2:G${lotData.length + 500}`);
    
    const finalData = [...preservedRows, ...allNewRows];
    if (finalData.length > 0) {
      await service.writeSheet('로트매칭', `A2:G${finalData.length + 1}`, finalData);
    }

    return c.json({
      success: true,
      mode: 'executed',
      message: `로트매칭 ${dates.join(', ')} 완전 재생성 완료`,
      data: {
        dates,
        deleted_rows: deletedCount,
        preserved_rows: preservedRows.length,
        new_rows: allNewRows.length,
        total_rows: finalData.length,
        date_results: dateResults
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.5.73: 일별수불부 완전 초기화 및 재구성 API ★★★
// 구글시트 일별수불부 전체를 클리어하고 6월 1일부터 다시 생성
sheets.post('/reset-daily-stock-complete', async (c) => {
  // ★★★ v3.6.42: 데이터 삭제 방지 - API 비활성화 ★★★
  return c.json({ 
    success: false, 
    error: '🚫 데이터 보호: 이 API는 비활성화되었습니다. 일별수불부를 초기화할 수 없습니다.',
    message: '데이터 무결성 보호를 위해 reset-daily-stock-complete API가 비활성화되었습니다.'
  }, 403);

  // 아래 코드는 실행되지 않음 (데이터 보호)
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const dryRun = body.dry_run !== false;  // 기본 true: 시뮬레이션 모드
    
    // ★ R102 유기농 T55 초기재고 사용자 지정값 (기본 10000kg)
    const t55InitialStock = parseFloat(body.t55_initial_stock) || 10000;
    
    // 1. 원료입고 시트에서 6월 1일 이전 기준 초기재고 계산
    // (6월 1일 입고분은 포함하지 않음 - 전일재고 개념)
    const inboundData = await service.readSheet('원료입고', 'A2:I');
    
    // 6월 1일 이전(5월 31일까지)의 잔량 합계로 초기재고 계산
    const initialStockMap = new Map<string, { stock: number; name: string }>();
    
    for (const row of inboundData) {
      let inboundDate = row[0]?.toString().replace(/^'/, '');
      
      // 엑셀 시리얼 번호 변환
      if (/^\d{5}$/.test(inboundDate)) {
        const excelDate = parseInt(inboundDate);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        inboundDate = jsDate.toISOString().split('T')[0];
      }
      
      const itemCode = row[1]?.toString();
      const itemName = row[2]?.toString() || '';
      const remainQty = parseFloat(row[8]) || 0;  // I열: 잔량
      
      if (!itemCode) continue;
      
      // SF원료, SM부자재, 정제수 제외 (원료만 일별수불부 대상)
      if (itemCode.startsWith('SF') || itemCode.startsWith('SM') || itemCode === 'RM184') continue;
      
      // 기존 값에 누적
      const existing = initialStockMap.get(itemCode) || { stock: 0, name: itemName };
      existing.stock += remainQty;
      if (!existing.name && itemName) existing.name = itemName;
      initialStockMap.set(itemCode, existing);
    }
    
    // ★★★ R102 유기농 T55 사용자 지정 초기재고로 강제 설정 ★★★
    if (initialStockMap.has('R102')) {
      const existing = initialStockMap.get('R102')!;
      existing.stock = t55InitialStock;
      initialStockMap.set('R102', existing);
    } else {
      initialStockMap.set('R102', { stock: t55InitialStock, name: '유기농 T55' });
    }
    
    // 2. 품목코드 정렬 (자연스러운 숫자 정렬)
    const itemCodes = Array.from(initialStockMap.keys()).sort((a, b) => {
      const aMatch = a.match(/^([A-Z]+)(\d+)$/);
      const bMatch = b.match(/^([A-Z]+)(\d+)$/);
      if (aMatch && bMatch) {
        if (aMatch[1] === bMatch[1]) {
          return parseInt(aMatch[2]) - parseInt(bMatch[2]);
        }
        return aMatch[1].localeCompare(bMatch[1]);
      }
      return a.localeCompare(b);
    });
    
    // 3. 6월 1일 입고량 계산 (원료입고 시트에서)
    const june1InboundMap = new Map<string, number>();
    for (const row of inboundData) {
      let inboundDate = row[0]?.toString().replace(/^'/, '');
      if (/^\d{5}$/.test(inboundDate)) {
        const excelDate = parseInt(inboundDate);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        inboundDate = jsDate.toISOString().split('T')[0];
      }
      
      if (inboundDate === '2026-06-01') {
        const itemCode = row[1]?.toString();
        const originQty = parseFloat(row[4]) || 0;  // E열: 입고량
        if (itemCode) {
          june1InboundMap.set(itemCode, (june1InboundMap.get(itemCode) || 0) + originQty);
        }
      }
    }
    
    // 4. 6월 1일 사용량 계산 (로트매칭 시트에서, BOM 단위 변환 적용)
    const lotMatchingData = await service.readSheet('로트매칭', 'A2:E');
    const june1UsageMap = new Map<string, number>();
    
    for (const row of lotMatchingData) {
      let matchDate = row[0]?.toString().replace(/^'/, '');
      if (/^\d{5}$/.test(matchDate)) {
        const excelDate = parseInt(matchDate);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        matchDate = jsDate.toISOString().split('T')[0];
      }
      
      if (matchDate === '2026-06-01') {
        const itemCode = row[2]?.toString();
        const usageQty = parseFloat(row[4]) || 0;  // E열: 사용량 (이미 kg 단위로 저장됨)
        if (itemCode) {
          june1UsageMap.set(itemCode, (june1UsageMap.get(itemCode) || 0) + usageQty);
        }
      }
    }
    
    // 5. 6월 1일 일별수불부 행 생성 (값으로 직접 저장 - 수식 없음)
    const june1Rows: any[][] = [];
    
    for (const itemCode of itemCodes) {
      const itemInfo = initialStockMap.get(itemCode)!;
      const prevStock = itemInfo.stock;  // 전일재고 (5월 31일까지의 잔량 합계)
      const inboundQty = june1InboundMap.get(itemCode) || 0;  // 당일 입고량
      const usageQty = june1UsageMap.get(itemCode) || 0;  // 당일 사용량
      const currentStock = prevStock + inboundQty - usageQty;  // 현재고 계산
      
      june1Rows.push([
        "'2026-06-01",  // A: 일자
        itemCode,       // B: 원료코드
        itemInfo.name,  // C: 원료명
        Math.round(prevStock * 10000) / 10000,     // D: 전일재고
        Math.round(inboundQty * 10000) / 10000,    // E: 입고량
        Math.round(usageQty * 10000) / 10000,      // F: 사용량
        Math.round(currentStock * 10000) / 10000,  // G: 현재고
        'kg'            // H: 단위
      ]);
    }
    
    // 6. 6월 2일 입고량 계산
    const june2InboundMap = new Map<string, number>();
    for (const row of inboundData) {
      let inboundDate = row[0]?.toString().replace(/^'/, '');
      if (/^\d{5}$/.test(inboundDate)) {
        const excelDate = parseInt(inboundDate);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        inboundDate = jsDate.toISOString().split('T')[0];
      }
      
      if (inboundDate === '2026-06-02') {
        const itemCode = row[1]?.toString();
        const originQty = parseFloat(row[4]) || 0;
        if (itemCode) {
          june2InboundMap.set(itemCode, (june2InboundMap.get(itemCode) || 0) + originQty);
        }
      }
    }
    
    // 7. 6월 2일 사용량 계산
    const june2UsageMap = new Map<string, number>();
    for (const row of lotMatchingData) {
      let matchDate = row[0]?.toString().replace(/^'/, '');
      if (/^\d{5}$/.test(matchDate)) {
        const excelDate = parseInt(matchDate);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        matchDate = jsDate.toISOString().split('T')[0];
      }
      
      if (matchDate === '2026-06-02') {
        const itemCode = row[2]?.toString();
        const usageQty = parseFloat(row[4]) || 0;
        if (itemCode) {
          june2UsageMap.set(itemCode, (june2UsageMap.get(itemCode) || 0) + usageQty);
        }
      }
    }
    
    // 8. 6월 1일 마감재고 맵 생성
    const june1EndStockMap = new Map<string, number>();
    for (const row of june1Rows) {
      june1EndStockMap.set(row[1], row[6]);  // itemCode -> currentStock
    }
    
    // 9. 6월 2일 일별수불부 행 생성
    const june2Rows: any[][] = [];
    
    for (const itemCode of itemCodes) {
      const itemInfo = initialStockMap.get(itemCode)!;
      const prevStock = june1EndStockMap.get(itemCode) || 0;  // 6월 1일 마감재고
      const inboundQty = june2InboundMap.get(itemCode) || 0;  // 당일 입고량
      const usageQty = june2UsageMap.get(itemCode) || 0;  // 당일 사용량
      const currentStock = prevStock + inboundQty - usageQty;  // 현재고 계산
      
      june2Rows.push([
        "'2026-06-02",  // A: 일자
        itemCode,       // B: 원료코드
        itemInfo.name,  // C: 원료명
        Math.round(prevStock * 10000) / 10000,     // D: 전일재고
        Math.round(inboundQty * 10000) / 10000,    // E: 입고량
        Math.round(usageQty * 10000) / 10000,      // F: 사용량
        Math.round(currentStock * 10000) / 10000,  // G: 현재고
        'kg'            // H: 단위
      ]);
    }
    
    // dry_run 모드: 결과만 보여줌
    if (dryRun) {
      // R102 유기농 T55 확인
      const t55June1 = june1Rows.find(r => r[1] === 'R102');
      const t55June2 = june2Rows.find(r => r[1] === 'R102');
      
      // 난백/난황 확인
      const nanbaekJune1 = june1Rows.find(r => r[1] === 'R016');
      const nanhwangJune1 = june1Rows.find(r => r[1] === 'R017');
      
      return c.json({
        success: true,
        mode: 'dry_run',
        message: '시뮬레이션 결과 (실제 변경 없음)',
        data: {
          total_items: itemCodes.length,
          june1_rows: june1Rows.length,
          june2_rows: june2Rows.length,
          t55_initial_stock_setting: t55InitialStock,
          t55_june1: t55June1 ? {
            prev_stock: t55June1[3],
            inbound: t55June1[4],
            usage: t55June1[5],
            current_stock: t55June1[6]
          } : null,
          t55_june2: t55June2 ? {
            prev_stock: t55June2[3],
            inbound: t55June2[4],
            usage: t55June2[5],
            current_stock: t55June2[6]
          } : null,
          nanbaek_june1: nanbaekJune1 ? {
            item_name: nanbaekJune1[2],
            prev_stock: nanbaekJune1[3],
            usage: nanbaekJune1[5],
            current_stock: nanbaekJune1[6]
          } : null,
          nanhwang_june1: nanhwangJune1 ? {
            item_name: nanhwangJune1[2],
            prev_stock: nanhwangJune1[3],
            usage: nanhwangJune1[5],
            current_stock: nanhwangJune1[6]
          } : null,
          sample_june1: june1Rows.slice(0, 5).map(r => ({
            item_code: r[1],
            item_name: r[2],
            prev_stock: r[3],
            inbound: r[4],
            usage: r[5],
            current_stock: r[6]
          })),
          sample_june2: june2Rows.slice(0, 5).map(r => ({
            item_code: r[1],
            item_name: r[2],
            prev_stock: r[3],
            inbound: r[4],
            usage: r[5],
            current_stock: r[6]
          }))
        },
        note: 'dry_run: false로 설정하면 실제 시트 초기화 실행'
      });
    }
    
    // 10. 실제 실행: 일별수불부 시트 완전 클리어
    // A2부터 2000행까지 클리어 (헤더 제외)
    await service.clearRange('일별수불부', 'A2:H2000');
    
    // 11. 6월 1일 데이터 쓰기 (A2부터)
    const june1Range = `A2:H${1 + june1Rows.length}`;
    await service.writeSheet('일별수불부', june1Range, june1Rows);
    
    // 12. 6월 2일 데이터 쓰기 (6월 1일 다음부터)
    const june2StartRow = 2 + june1Rows.length;
    const june2Range = `A${june2StartRow}:H${june2StartRow + june2Rows.length - 1}`;
    await service.writeSheet('일별수불부', june2Range, june2Rows);
    
    // R102 유기농 T55 최종 확인
    const t55June1Final = june1Rows.find(r => r[1] === 'R102');
    const t55June2Final = june2Rows.find(r => r[1] === 'R102');
    
    return c.json({
      success: true,
      mode: 'executed',
      message: '일별수불부 완전 초기화 및 재구성 완료',
      data: {
        cleared_range: 'A2:H2000',
        june1_rows_written: june1Rows.length,
        june2_rows_written: june2Rows.length,
        total_rows: june1Rows.length + june2Rows.length,
        t55_initial_stock: t55InitialStock,
        t55_june1_result: t55June1Final ? {
          prev_stock: t55June1Final[3],
          inbound: t55June1Final[4],
          usage: t55June1Final[5],
          current_stock: t55June1Final[6]
        } : null,
        t55_june2_result: t55June2Final ? {
          prev_stock: t55June2Final[3],
          inbound: t55June2Final[4],
          usage: t55June2Final[5],
          current_stock: t55June2Final[6]
        } : null
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.40: 일별수불부 생성 디버그 API ★★★
sheets.get('/debug/daily-stock-calc', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const date = c.req.query('date') || new Date().toISOString().split('T')[0];
    const cleanDate = date.replace(/^'/, '');
    
    // 1. 로트매칭 시트에서 해당 날짜 데이터 확인
    const lotMatchingData = await service.readSheet('로트매칭', 'A2:G50000');
    const usageMap: Record<string, number> = {};
    let matchedRows = 0;
    let dateFormats: string[] = [];
    
    for (const row of lotMatchingData) {
      const lotDate = row[0]?.toString().replace(/^'/, '') || '';
      
      // 처음 10개 날짜 형식 기록
      if (dateFormats.length < 10 && lotDate && !dateFormats.includes(lotDate)) {
        dateFormats.push(lotDate);
      }
      
      if (lotDate !== cleanDate) continue;
      matchedRows++;
      
      const code = row[2]?.toString() || '';
      const usage = parseFloat(row[4]?.toString() || '0') || 0;
      
      if (code.startsWith('SF') || code.startsWith('SM') || code.startsWith('RT') || code === 'RM184' || code === 'RM1054') continue;
      
      usageMap[code] = (usageMap[code] || 0) + usage;
    }
    
    return c.json({
      success: true,
      date: cleanDate,
      lot_matching_total_rows: lotMatchingData.length,
      matched_rows_for_date: matchedRows,
      usage_items_count: Object.keys(usageMap).length,
      sample_date_formats: dateFormats,
      sample_usage: Object.entries(usageMap).slice(0, 10).map(([k, v]) => ({ code: k, usage: v }))
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.09: 일별수불부 새 날짜 추가 API - Service 함수로 일원화 ★★★
// GoogleSheetsService.addDailyStockDate() 호출로 로직 통일
sheets.post('/add-daily-stock-date', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const date = body.date;  // 추가할 날짜 (예: 2026-06-03)
    
    if (!date) {
      return c.json({ success: false, error: 'date 필수' }, 400);
    }

    // ★★★ Service 함수 호출로 일원화 (재귀 생성, 입고량 열 인덱스 등 일관성 보장) ★★★
    const result = await service.addDailyStockDate(date);
    
    return c.json({
      success: true,
      message: `${date} 일별수불부 생성 완료`,
      ...result
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ 테스트 데이터 삭제 (일회성 유틸리티) ★★★
sheets.post('/delete-test-production-data', async (c) => {
  // ★★★ v3.6.42: 데이터 삭제 방지 - API 비활성화 ★★★
  return c.json({ 
    success: false, 
    error: '🚫 데이터 보호: 이 API는 비활성화되었습니다. 생산 데이터를 삭제할 수 없습니다.',
    message: '데이터 무결성 보호를 위해 delete-test-production-data API가 비활성화되었습니다.'
  }, 403);

  // 아래 코드는 실행되지 않음 (데이터 보호)
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const dryRun = body.dry_run !== false;  // 기본값: true (시뮬레이션)

    // 1. 생산실적 데이터 읽기
    const data = await service.readSheet('생산실적', 'A2:H5000');
    
    // 2. 테스트 데이터 식별 (제품명이 "테스트" 또는 빈값이고 수량이 1인 것)
    const testRows: { row: number; data: any[] }[] = [];
    const keepRows: any[][] = [];
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const productName = row[2]?.toString() || '';
      const quantity = parseFloat(row[3]?.toString() || '0') || 0;
      const channel = row[5]?.toString() || '';
      
      // 테스트 데이터 조건: 제품명이 "테스트"이거나 빈값이고, 수량이 1이거나, 채널이 "테스트"
      const isTestData = (
        (productName === '테스트' || productName === '') && 
        quantity === 1
      ) || channel === '테스트';
      
      if (isTestData) {
        testRows.push({ row: i + 2, data: row });  // +2: 헤더(1행) + 0-index
      } else {
        keepRows.push(row);
      }
    }

    if (testRows.length === 0) {
      return c.json({ 
        success: true, 
        message: '삭제할 테스트 데이터 없음',
        deleted_count: 0
      });
    }

    if (dryRun) {
      return c.json({
        success: true,
        mode: 'dry_run',
        message: '시뮬레이션 결과 (실제 삭제 없음)',
        test_data_found: testRows.length,
        test_data: testRows.map(t => ({
          row: t.row,
          date: t.data[0],
          product_code: t.data[1],
          product_name: t.data[2],
          quantity: t.data[3],
          lot: t.data[4],
          channel: t.data[5]
        })),
        keep_rows: keepRows.length,
        note: 'dry_run: false로 설정하면 실제 삭제 실행'
      });
    }

    // 3. 실제 삭제 실행: 기존 데이터 클리어 후 정상 데이터만 다시 쓰기
    await service.clearRange('생산실적', 'A2:H5000');
    if (keepRows.length > 0) {
      await service.writeSheet('생산실적', 'A2', keepRows);
    }

    return c.json({
      success: true,
      mode: 'executed',
      message: `테스트 데이터 ${testRows.length}건 삭제 완료`,
      deleted_count: testRows.length,
      deleted_data: testRows.map(t => ({
        row: t.row,
        date: t.data[0],
        product_code: t.data[1],
        product_name: t.data[2],
        lot: t.data[4]
      })),
      remaining_rows: keepRows.length
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.32: 일별수불부 수식 복구 API ★★★
// #REF! 오류가 발생한 E/F/G열 수식을 올바르게 복구
sheets.post('/repair-daily-stock-formulas', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const targetDate = body.date;  // 특정 날짜만 복구 (선택)
    const dryRun = body.dry_run !== false;  // 기본값: true

    // 1. 일별수불부 시트 전체 읽기 (수식 모드)
    const data = await service.readSheetFormulas('일별수불부', 'A2:H');
    
    // 2. #REF! 오류가 있는 행 찾기
    const brokenRows: { row: number; date: any; code: string; name: string }[] = [];
    const fixedFormulas: { range: string; values: any[][] }[] = [];
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const sheetRow = i + 2;  // 실제 시트 행 번호 (1-indexed, 헤더 제외)
      
      // 날짜 확인 (숫자일 수 있음)
      const dateVal = row[0];
      let dateStr = '';
      if (typeof dateVal === 'number') {
        // 엑셀 시리얼 넘버를 날짜 문자열로 변환
        const excelDate = new Date((dateVal - 25569) * 86400 * 1000);
        dateStr = excelDate.toISOString().split('T')[0];
      } else {
        dateStr = dateVal?.toString().replace(/^'/, '') || '';
      }
      
      // 특정 날짜만 처리하는 경우
      if (targetDate && dateStr !== targetDate) continue;
      
      const code = row[1]?.toString() || '';
      const name = row[2]?.toString() || '';
      
      // E열(입고량), F열(사용량), G열(현재고) 수식 확인
      const eFormula = row[4]?.toString() || '';
      const fFormula = row[5]?.toString() || '';
      const gFormula = row[6]?.toString() || '';
      
      // ★★★ v3.6.36: #REF! 오류 또는 행 번호 불일치 감지 ★★★
      const hasRefError = eFormula.includes('#REF!') || fFormula.includes('#REF!') || gFormula.includes('#REF!');
      
      // 수식에서 참조하는 행 번호가 현재 행과 일치하는지 확인
      const expectedRowRef = `B${sheetRow}`;
      const hasWrongRowRef = (eFormula && !eFormula.includes(expectedRowRef)) || 
                              (fFormula && !fFormula.includes(expectedRowRef)) ||
                              (gFormula && !gFormula.includes(`D${sheetRow}`));
      
      // 수식이 아예 없는 경우 (숫자 0만 있음)
      const hasMissingFormula = (row[5] === 0 || row[5] === '0') && !fFormula.startsWith('=');
      
      if (hasRefError || hasWrongRowRef || hasMissingFormula) {
        brokenRows.push({ row: sheetRow, date: dateStr, code, name });
        
        // 올바른 수식 생성
        const correctFormulas = [
          // E열: 입고량 = 원료입고 시트에서 해당 날짜+원료코드 합계
          `=IFERROR(SUMIFS('원료입고'!E:E,'원료입고'!B:B,B${sheetRow},'원료입고'!A:A,A${sheetRow}),0)`,
          // F열: 사용량 = 로트매칭 시트에서 해당 날짜+원료코드 합계
          `=IFERROR(SUMIFS('로트매칭'!E:E,'로트매칭'!C:C,B${sheetRow},'로트매칭'!A:A,A${sheetRow}),0)`,
          // G열: 현재고 = 전일재고 + 입고 - 사용
          `=D${sheetRow}+E${sheetRow}-F${sheetRow}`
        ];
        
        fixedFormulas.push({
          range: `일별수불부!E${sheetRow}:G${sheetRow}`,
          values: [correctFormulas]
        });
      }
    }

    if (brokenRows.length === 0) {
      return c.json({
        success: true,
        message: targetDate 
          ? `${targetDate} 날짜에 복구할 수식이 없습니다.`
          : '복구할 수식이 없습니다. (모든 수식 정상)',
        broken_count: 0
      });
    }

    if (dryRun) {
      return c.json({
        success: true,
        mode: 'dry_run',
        message: `${brokenRows.length}개 행의 수식 복구 필요 (dry_run=false로 실제 복구)`,
        broken_count: brokenRows.length,
        sample_rows: brokenRows.slice(0, 10),
        sample_fix: fixedFormulas.slice(0, 3).map(f => ({
          range: f.range,
          formulas: f.values[0]
        }))
      });
    }

    // 3. 수식 일괄 업데이트 (USER_ENTERED 모드로 수식 적용)
    // batchWriteSheet 사용하여 일괄 처리
    const BATCH_SIZE = 50;  // API 제한 고려
    let fixedCount = 0;
    
    for (let i = 0; i < fixedFormulas.length; i += BATCH_SIZE) {
      const batch = fixedFormulas.slice(i, i + BATCH_SIZE);
      
      // batchWriteSheet용 형식으로 변환
      const updates = batch.map(f => {
        // range 형식: "일별수불부!E3352:G3352" -> sheetName: "일별수불부", range: "E3352:G3352"
        const parts = f.range.split('!');
        return {
          sheetName: parts[0],
          range: parts[1],
          values: f.values
        };
      });
      
      const success = await service.batchWriteSheet(updates);
      
      if (!success) {
        throw new Error(`배치 ${Math.floor(i/BATCH_SIZE) + 1} 업데이트 실패`);
      }
      
      fixedCount += batch.length;
    }

    return c.json({
      success: true,
      mode: 'executed',
      message: `${fixedCount}개 행의 수식 복구 완료`,
      fixed_count: fixedCount,
      target_date: targetDate || 'all',
      sample_rows: brokenRows.slice(0, 10)
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.37: 일별수불부에서 제외 대상 코드(RT, SF, SM, RM184, RM1054) 삭제 API ★★★
sheets.post('/cleanup-excluded-codes', async (c) => {
  try {
    const service = getSheetService(c);
    if (!service) {
      return c.json({ success: false, error: '구글 시트 인증 정보가 설정되지 않았습니다.' }, 400);
    }
    const body = await c.req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false;
    
    // 1. 기존 일별수불부 데이터 읽기
    console.log('[cleanup-excluded-codes v3.6.37] 일별수불부 읽기 시작...');
    let rawData: any[][];
    try {
      rawData = await service.readSheet('일별수불부', 'A2:H50000');
    } catch (readError: any) {
      return c.json({ success: false, error: `시트 읽기 실패: ${readError.message}` }, 500);
    }
    console.log(`[cleanup-excluded-codes v3.6.37] 총 ${rawData?.length ?? 0}행 읽음`);
    
    // ★★★ v3.6.37: 데이터 유효성 검증 ★★★
    const existingData = (rawData || []).filter(row => row && Array.isArray(row) && row.length > 0);
    console.log(`[cleanup-excluded-codes v3.6.37] 유효 데이터: ${existingData.length}행`);
    
    // 2. 제외 대상 코드 필터링 (v3.6.37: null check 강화)
    const excludedRows: any[] = [];
    const cleanedData = existingData.filter(row => {
      try {
        const code = String(row[1] || '').trim();
        const date = String(row[0] || '').replace(/^'/, '').trim();
        const name = String(row[2] || '').trim();
        
        // 빈 행 제외
        if (!code && !date) return false;
        
        // 제외 대상: RT(자재), SF(반제품), SM(반제품), RM184(정제수), RM1054(부자재)
        if (code.startsWith('RT') || code.startsWith('SF') || code.startsWith('SM') || code === 'RM184' || code === 'RM1054') {
          excludedRows.push({ date, code, name });
          return false;
        }
        return true;
      } catch (e) {
        console.error('[cleanup-excluded-codes] 행 처리 오류:', row, e);
        return false;
      }
    });
    
    console.log(`[cleanup-excluded-codes v3.6.37] 제외 대상: ${excludedRows.length}건, 유지: ${cleanedData.length}건`);
    
    if (excludedRows.length === 0) {
      return c.json({
        success: true,
        message: '제외 대상 코드가 없습니다.',
        excluded_count: 0
      });
    }
    
    if (dryRun) {
      // RT, SF, SM 각각 개수 세기
      const rtCount = excludedRows.filter(r => r.code.startsWith('RT')).length;
      const sfCount = excludedRows.filter(r => r.code.startsWith('SF')).length;
      const smCount = excludedRows.filter(r => r.code.startsWith('SM')).length;
      const rm184Count = excludedRows.filter(r => r.code === 'RM184').length;
      const rm1054Count = excludedRows.filter(r => r.code === 'RM1054').length;
      
      return c.json({
        success: true,
        mode: 'dry_run',
        message: `${excludedRows.length}개 행 삭제 예정 (dry_run=false로 실제 삭제)`,
        excluded_count: excludedRows.length,
        breakdown: {
          RT: rtCount,
          SF: sfCount,
          SM: smCount,
          RM184: rm184Count,
          RM1054: rm1054Count
        },
        remaining_count: cleanedData.length,
        sample_excluded: excludedRows.slice(0, 20)
      });
    }
    
    // 3. 날짜 + 품목코드 순 정렬 (v3.6.37: null check 강화)
    cleanedData.sort((a, b) => {
      try {
        const dateA = String(a?.[0] || '').replace(/^'/, '');
        const dateB = String(b?.[0] || '').replace(/^'/, '');
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        const codeA = String(a?.[1] || '');
        const codeB = String(b?.[1] || '');
        return codeA.localeCompare(codeB);
      } catch (e) {
        return 0;
      }
    });
    
    // 4. 클리어 후 정제된 데이터 쓰기
    await service.clearRange('일별수불부', 'A2:H50000');
    if (cleanedData.length > 0) {
      await service.writeSheet('일별수불부', 'A2', cleanedData);
    }
    
    console.log(`[cleanup-excluded-codes v3.6.37] ${excludedRows.length}개 행 삭제 완료`);
    
    return c.json({
      success: true,
      mode: 'executed',
      message: `${excludedRows.length}개 제외 대상 코드 삭제 완료`,
      excluded_count: excludedRows.length,
      remaining_count: cleanedData.length,
      sample_excluded: excludedRows.slice(0, 20)
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.38: 구글시트 원료입고 디버그 API ★★★
sheets.get('/debug/inbound-lots', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const itemCode = c.req.query('item_code') || '';
    
    // 구글시트 원료입고 시트 직접 읽기
    // A:입고일자, B:원료코드, C:원료명, D:로트번호, E:입고량, F:단위, G:공급업체, H:소비기한
    const inboundData = await service.readSheet('원료입고', 'A2:J5000');
    
    const filtered = inboundData
      .filter(row => !itemCode || row[1]?.toString() === itemCode)
      .map(row => ({
        inbound_date: row[0],
        item_code: row[1],
        item_name: row[2],
        lot_number: row[3],
        qty: row[4],
        unit: row[5],
        supplier: row[6],
        expiry_date: row[7],  // H열: 소비기한
        raw_row: row
      }));
    
    return c.json({
      success: true,
      item_code: itemCode || 'all',
      count: filtered.length,
      data: filtered.slice(0, 50),
      note: '구글시트 원료입고 시트 직접 조회 (H열=소비기한)'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default sheets;

// ★★★ v3.6.45: 일별수불부 수식 날짜형식 통일 (SUMPRODUCT 방식) ★★★
sheets.post('/fix-daily-stock-formula-date', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const date = body.date;  // 수정할 날짜 (예: 2026-06-18)
    const dryRun = body.dry_run !== false;  // 기본: dry_run
    
    if (!date) {
      return c.json({ success: false, error: 'date 필수' }, 400);
    }

    // 1. 일별수불부에서 해당 날짜 행 찾기
    const allData = await service.readSheet('일별수불부', 'A2:H');
    
    const targetRows: { rowNum: number; itemCode: string }[] = [];
    for (let i = 0; i < allData.length; i++) {
      const rowDate = allData[i][0]?.toString().replace(/^'/, '');
      if (rowDate === date) {
        targetRows.push({
          rowNum: i + 2,  // 시트 행 번호 (1-based + 헤더)
          itemCode: allData[i][1]?.toString() || ''
        });
      }
    }
    
    if (targetRows.length === 0) {
      return c.json({ success: false, error: `${date} 데이터 없음` }, 400);
    }

    // 2. 새 수식 생성 (SUMPRODUCT + TEXT)
    // F열 수식만 수정 (사용량)
    const updateRows: { range: string; formula: string }[] = [];
    
    for (const row of targetRows) {
      const rowNum = row.rowNum;
      // F열: 사용량 수식 (SUMPRODUCT로 날짜 형식 통일)
      const newFormula = `=IFERROR(SUMPRODUCT((TEXT(로트매칭!$A$2:$A$50000,"YYYY-MM-DD")=TEXT(A${rowNum},"YYYY-MM-DD"))*(로트매칭!$C$2:$C$50000=B${rowNum})*(로트매칭!$E$2:$E$50000)),0)`;
      updateRows.push({
        range: `일별수불부!F${rowNum}`,
        formula: newFormula
      });
    }

    if (dryRun) {
      return c.json({
        success: true,
        mode: 'dry_run',
        message: `${date} 수식 수정 시뮬레이션`,
        data: {
          date,
          rows_to_update: targetRows.length,
          sample_rows: targetRows.slice(0, 5),
          sample_formula: updateRows[0]?.formula
        }
      });
    }

    // 3. 실제 수식 업데이트 (batchUpdate)
    let updatedCount = 0;
    for (const update of updateRows) {
      await service.writeSheetWithFormulas('일별수불부', update.range.replace('일별수불부!', ''), [[update.formula]]);
      updatedCount++;
    }

    return c.json({
      success: true,
      message: `${date} 일별수불부 F열(사용량) 수식 ${updatedCount}건 수정 완료`,
      data: {
        date,
        updated_rows: updatedCount,
        formula_type: 'SUMPRODUCT + TEXT (날짜형식 통일)'
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.46: 날짜 형식 디버그 API - 로트매칭 vs 일별수불부 비교 ★★★
sheets.get('/debug/date-format-compare', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const date = c.req.query('date') || '2026-06-18';
    
    // 1. 로트매칭 시트에서 해당 날짜 샘플 (처음 5개)
    const lotData = await service.readSheet('로트매칭', 'A2:A50000');
    const lotSamples: any[] = [];
    for (let i = 0; i < lotData.length && lotSamples.length < 5; i++) {
      const rawVal = lotData[i][0];
      const strVal = rawVal?.toString() || '';
      // 날짜 파싱
      let parsedDate = strVal.replace(/^'/, '');
      if (/^\d{5}$/.test(parsedDate)) {
        const serial = parseInt(parsedDate);
        const jsDate = new Date((serial - 25569) * 86400 * 1000);
        parsedDate = jsDate.toISOString().split('T')[0];
      }
      if (parsedDate === date) {
        lotSamples.push({
          row: i + 2,
          raw_value: rawVal,
          raw_type: typeof rawVal,
          string_value: strVal,
          parsed_date: parsedDate,
          starts_with_quote: strVal.startsWith("'"),
          is_number: !isNaN(Number(rawVal))
        });
      }
    }

    // 2. 일별수불부에서 해당 날짜 샘플 (처음 5개)
    const stockData = await service.readSheet('일별수불부', 'A2:A10000');
    const stockSamples: any[] = [];
    for (let i = 0; i < stockData.length && stockSamples.length < 5; i++) {
      const rawVal = stockData[i][0];
      const strVal = rawVal?.toString() || '';
      let parsedDate = strVal.replace(/^'/, '');
      if (/^\d{5}$/.test(parsedDate)) {
        const serial = parseInt(parsedDate);
        const jsDate = new Date((serial - 25569) * 86400 * 1000);
        parsedDate = jsDate.toISOString().split('T')[0];
      }
      if (parsedDate === date) {
        stockSamples.push({
          row: i + 2,
          raw_value: rawVal,
          raw_type: typeof rawVal,
          string_value: strVal,
          parsed_date: parsedDate,
          starts_with_quote: strVal.startsWith("'"),
          is_number: !isNaN(Number(rawVal))
        });
      }
    }

    return c.json({
      success: true,
      date,
      comparison: {
        lot_matching: {
          count: lotSamples.length,
          samples: lotSamples
        },
        daily_stock: {
          count: stockSamples.length,
          samples: stockSamples
        }
      },
      diagnosis: lotSamples.length > 0 && stockSamples.length > 0 ? 
        (lotSamples[0].raw_value === stockSamples[0].raw_value ? 
          '✅ 날짜 형식 일치' : 
          '❌ 날짜 형식 불일치 - SUMIFS 매칭 실패 원인') :
        '데이터 부족'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.47: 일별수불부 공란 정리 + 특정 날짜 재생성 ★★★
sheets.post('/fix-daily-stock-gaps', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const targetDate = body.date || '2026-06-18';
    const dryRun = body.dry_run === true;

    // 1. 일별수불부 전체 읽기
    const allData = await service.readSheet('일별수불부', 'A1:H');
    console.log(`[fix-daily-stock-gaps] 전체 행 수: ${allData.length}`);

    // 2. 헤더 + 유효한 데이터만 필터링 (공란 제거)
    const header = allData[0];
    const validRows: any[][] = [];
    const emptyRows: number[] = [];
    
    for (let i = 1; i < allData.length; i++) {
      const row = allData[i];
      const dateVal = row[0]?.toString().trim();
      const itemCode = row[1]?.toString().trim();
      
      // 날짜와 품목코드가 모두 있는 행만 유효
      if (dateVal && itemCode && dateVal !== '' && itemCode !== '') {
        validRows.push(row);
      } else if (i < allData.length - 10) {  // 마지막 10행 제외 (자연스러운 공백)
        emptyRows.push(i + 1);  // 1-based row number
      }
    }

    // 3. targetDate 데이터 제거 (재생성할 것이므로)
    const cleanDate = targetDate.replace(/^'/, '');
    const filteredRows = validRows.filter(row => {
      const rowDate = row[0]?.toString().replace(/^'/, '');
      return rowDate !== cleanDate;
    });

    // 4. 마지막 날짜 확인 (전일 재고 계산용)
    const dates = [...new Set(filteredRows.map(r => r[0]?.toString().replace(/^'/, '')))].sort();
    const lastDate = dates[dates.length - 1];

    if (dryRun) {
      return c.json({
        success: true,
        mode: 'dry_run',
        message: '시뮬레이션 결과',
        data: {
          original_rows: allData.length - 1,
          valid_rows: validRows.length,
          empty_rows_found: emptyRows.length,
          empty_row_samples: emptyRows.slice(0, 10),
          rows_after_remove_target: filteredRows.length,
          target_date: targetDate,
          last_existing_date: lastDate,
          dates_found: dates.slice(-5)
        }
      });
    }

    // 5. 일별수불부 전체 클리어 후 재작성 (공란 없이)
    // 5-1. 전체 클리어
    await service.clearRange('일별수불부', `A2:H${allData.length + 100}`);
    
    // 5-2. 유효 데이터만 재작성
    if (filteredRows.length > 0) {
      await service.writeSheet('일별수불부', `A2:H${filteredRows.length + 1}`, filteredRows);
    }

    // 6. 새 날짜 추가 (addDailyStockDate 호출)
    const addResult = await service.addDailyStockDate(cleanDate);

    return c.json({
      success: true,
      message: `일별수불부 공란 정리 + ${targetDate} 재생성 완료`,
      data: {
        original_rows: allData.length - 1,
        empty_rows_removed: emptyRows.length,
        valid_rows_kept: filteredRows.length,
        new_date_added: addResult
      }
    });
  } catch (error: any) {
    console.error('[fix-daily-stock-gaps] 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.48: 일별수불부 특정 날짜 정확한 위치에 재생성 (공란 버그 수정) ★★★
sheets.post('/rebuild-daily-stock-date', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const targetDate = body.date;
    if (!targetDate) {
      return c.json({ success: false, error: 'date 필수' }, 400);
    }
    const cleanDate = targetDate.replace(/^'/, '');

    // 1. 일별수불부 전체 읽기
    const allData = await service.readSheet('일별수불부', 'A2:H');
    
    // 2. 유효한 데이터만 필터링 (공란 + targetDate 제거)
    const validRows: any[][] = [];
    for (const row of allData) {
      const dateVal = row[0]?.toString().replace(/^'/, '').trim();
      const itemCode = row[1]?.toString().trim();
      if (dateVal && itemCode && dateVal !== cleanDate) {
        validRows.push(row);
      }
    }

    // 3. 전일 데이터에서 품목 목록 + 현재고 가져오기
    const prevDate = cleanDate.replace(/-(\d{2})$/, (m, d) => `-${String(parseInt(d) - 1).padStart(2, '0')}`);
    const prevStockMap: Record<string, { name: string; current: number; unit: string }> = {};
    
    for (const row of validRows) {
      const rowDate = row[0]?.toString().replace(/^'/, '');
      if (rowDate === prevDate) {
        const code = row[1]?.toString();
        const name = row[2]?.toString() || '';
        const currentStock = parseFloat(row[6]) || 0;  // G열: 현재고
        const unit = row[7]?.toString() || 'kg';
        if (code) {
          prevStockMap[code] = { name, current: currentStock, unit };
        }
      }
    }

    if (Object.keys(prevStockMap).length === 0) {
      return c.json({ success: false, error: `전일(${prevDate}) 데이터 없음` }, 400);
    }

    // 4. 새 날짜 행 생성 - 정확한 행 번호로 수식 생성
    const startRowNum = validRows.length + 2;  // 헤더(1행) + 유효데이터 + 1
    const sortedCodes = Object.keys(prevStockMap).sort();
    const newRows: any[][] = [];

    for (let i = 0; i < sortedCodes.length; i++) {
      const code = sortedCodes[i];
      const { name, current, unit } = prevStockMap[code];
      const rowNum = startRowNum + i;

      newRows.push([
        `'${cleanDate}`,
        code,
        name,
        current,  // 전일재고 = 전일 현재고
        `=IFERROR(SUMIFS(원료입고!E:E,원료입고!B:B,B${rowNum},원료입고!A:A,A${rowNum}),0)`,
        `=IFERROR(SUMIFS(로트매칭!E:E,로트매칭!C:C,B${rowNum},로트매칭!A:A,A${rowNum}),0)`,
        `=D${rowNum}+E${rowNum}-F${rowNum}`,
        unit
      ]);
    }

    // 5. 시트 클리어 후 재작성 (공란 없이!)
    const totalRows = validRows.length + newRows.length;
    await service.clearRange('일별수불부', `A2:H${totalRows + 500}`);
    
    // 유효 데이터 + 새 데이터 합치기
    const allNewData = [...validRows, ...newRows];
    await service.writeSheetWithFormulas('일별수불부', `A2:H${allNewData.length + 1}`, allNewData);

    return c.json({
      success: true,
      message: `${cleanDate} 일별수불부 재생성 완료 (공란 없음)`,
      data: {
        prev_date: prevDate,
        valid_rows_kept: validRows.length,
        new_rows_added: newRows.length,
        total_rows: allNewData.length,
        start_row: startRowNum,
        items_count: sortedCodes.length
      }
    });
  } catch (error: any) {
    console.error('[rebuild-daily-stock-date] 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.50: SF_BOM 시트 생성 (반제품 BOM 마스터) ★★★
sheets.post('/create-sf-bom-sheet', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    // 1. SF_BOM 시트 생성 (없으면)
    const created = await service.createSheetIfNotExists('SF_BOM');
    
    if (!created) {
      return c.json({ success: false, error: 'SF_BOM 시트 생성 실패' }, 500);
    }

    // 2. 헤더 행 작성
    const headers = [
      ['SF코드', 'SF명', '원료코드', '원료명', '배합비', '단위', '비고']
    ];
    
    await service.writeSheet('SF_BOM', 'A1:G1', headers);

    // 3. 샘플 데이터 (사용자가 수정할 템플릿)
    const sampleData = [
      ['SF001', '르방종', 'R000', '(원료코드 입력)', 0, 'kg', '(배합비는 SF 1kg 기준)'],
      ['SF001', '르방종', '', '', 0, 'kg', ''],
      ['SF002', '사워종', 'R000', '(원료코드 입력)', 0, 'kg', ''],
      ['SF002', '사워종', '', '', 0, 'kg', ''],
    ];
    
    await service.writeSheet('SF_BOM', 'A2:G5', sampleData);

    return c.json({
      success: true,
      message: 'SF_BOM 시트 생성 완료',
      data: {
        sheet_name: 'SF_BOM',
        headers: headers[0],
        sample_rows: sampleData.length,
        note: '구글시트에서 SF별 원료 배합비를 입력해주세요. 배합비는 SF 1kg 제조 기준입니다.'
      }
    });
  } catch (error: any) {
    console.error('[create-sf-bom-sheet] 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.50: SF_BOM 데이터 입력 (비율 변환된 데이터) ★★★
sheets.post('/insert-sf-bom-data', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    // SF_BOM 데이터 (1kg 기준 비율로 변환됨)
    // [SF코드, SF명, 원료코드, 원료명, 배합비(1kg기준), 단위, 소비기한(일)]
    const sfBomData = [
      ['SF001', '발효종르방', 'R60', '강력(사조)', 0.5, 'kg', 5],
      ['SF001', '발효종르방', 'RM184', '정제수', 0.5, 'kg', 5],
      ['SF002', '통밀르방', 'RM211', '통밀(스테인메츠)', 0.5, 'kg', 5],
      ['SF002', '통밀르방', 'RM184', '정제수', 0.5, 'kg', 5],
      ['SF003', '폴리쉬', 'R76', '강력(사조)', 0.4995, 'kg', 5],
      ['SF003', '폴리쉬', 'RM184', '정제수', 0.4995, 'kg', 5],
      ['SF003', '폴리쉬', 'R068', '생이스트', 0.000999, 'kg', 5],
      ['SF004', '쌀르방', 'R005', '햇방아쌀가루', 0.416667, 'kg', 5],
      ['SF004', '쌀르방', 'R068', '생이스트', 0.166667, 'kg', 5],
      ['SF004', '쌀르방', 'RM184', '정제수', 0.416667, 'kg', 5],
      ['SF005', '쌀탕종', 'R071', '소금', 0.004975, 'kg', 5],
      ['SF005', '쌀탕종', 'R005', '햇방아쌀가루', 0.497512, 'kg', 5],
      ['SF005', '쌀탕종', 'RM184', '정제수', 0.497512, 'kg', 5],
      ['SF006', '탕종', 'R113', '강력(스테인메츠)', 0.67642, 'kg', 5],
      ['SF006', '탕종', 'RM184', '정제수', 0.319405, 'kg', 5],
      ['SF006', '탕종', 'R071', '소금', 0.004175, 'kg', 5],
      ['SF007', '통밀탕종', 'R114', '통밀(사조)', 0.321131, 'kg', 5],
      ['SF007', '통밀탕종', 'RM184', '정제수', 0.678869, 'kg', 5],
      ['SF008', '통밀폴리쉬', 'RM211', '통밀(스테인메츠)', 0.4995, 'kg', 5],
      ['SF008', '통밀폴리쉬', 'RM184', '정제수', 0.4995, 'kg', 5],
      ['SF008', '통밀폴리쉬', 'R068', '생이스트', 0.000999, 'kg', 5],
      ['SF009', '호밀르방', 'R60', '강력(사조)', 0.25, 'kg', 5],
      ['SF009', '호밀르방', 'RM184', '정제수', 0.5, 'kg', 5],
      ['SF009', '호밀르방', 'RM143', '호밀가루', 0.25, 'kg', 5],
      ['SF010', '솔트라이발효종르방', 'RM184', '정제수', 0.985197, 'kg', 5],
      ['SF010', '솔트라이발효종르방', 'R071', '소금', 0.002488, 'kg', 5],
      ['SF010', '솔트라이발효종르방', 'R60', '강력(사조)', 0.006157, 'kg', 5],
      ['SF010', '솔트라이발효종르방', 'RM143', '호밀가루', 0.006157, 'kg', 5],
    ];

    // 1. 헤더 작성
    const headers = [['SF코드', 'SF명', '원료코드', '원료명', '배합비(1kg기준)', '단위', '소비기한(일)']];
    await service.writeSheet('SF_BOM', 'A1:G1', headers);

    // 2. 데이터 작성
    const range = `A2:G${sfBomData.length + 1}`;
    await service.writeSheet('SF_BOM', range, sfBomData);

    return c.json({
      success: true,
      message: 'SF_BOM 데이터 입력 완료',
      data: {
        total_rows: sfBomData.length,
        sf_codes: [...new Set(sfBomData.map(r => r[0]))],
        note: '배합비는 SF 1kg 제조 기준입니다. 예: SF001 1kg = R60 0.5kg + RM184 0.5kg'
      }
    });
  } catch (error: any) {
    console.error('[insert-sf-bom-data] 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.51: SF_BOM 로드 테스트 API ★★★
sheets.get('/debug/sf-bom', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const sfBomMap = await service.getSfBom();
    const sfCodes = Object.keys(sfBomMap);
    
    return c.json({
      success: true,
      total_sf_codes: sfCodes.length,
      sf_codes: sfCodes,
      sample_data: {
        SF001: sfBomMap['SF001'] || [],
        SF003: sfBomMap['SF003'] || []
      },
      note: 'SF_BOM 데이터 로드 결과'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.52: 생산실적 채널 일괄 수정 (제품마스터 GS 채널 기준) ★★★
// 제품마스터에서 GS로 설정된 제품의 생산실적 채널을 GS로 수정
sheets.post('/fix-production-channel-gs', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    // 1. 제품마스터에서 GS 채널 제품코드 목록 조회
    const productMasterData = await service.readSheet('제품마스터', 'A2:E');
    const gsProductCodes: string[] = [];
    
    for (const row of productMasterData) {
      const productCode = row[0]?.toString() || '';
      const channel = row[4]?.toString() || '';  // E열 = 채널
      
      if (channel === 'GS' && productCode) {
        gsProductCodes.push(productCode);
      }
    }
    
    console.log(`[fix-production-channel-gs] GS 제품코드: ${gsProductCodes.join(', ')}`);
    
    if (gsProductCodes.length === 0) {
      return c.json({ 
        success: false, 
        error: '제품마스터에 GS 채널 제품이 없습니다.' 
      }, 400);
    }
    
    // 2. 생산실적 시트 읽기 (A:생산일, B:제품코드, C:제품명, D:수량, E:LOT번호, F:채널)
    const productionData = await service.readSheet('생산실적', 'A2:H');
    
    // 3. 수정이 필요한 행 찾기 (GS 제품인데 채널이 GS가 아닌 경우)
    const rowsToUpdate: { rowIndex: number; productCode: string; oldChannel: string }[] = [];
    
    for (let i = 0; i < productionData.length; i++) {
      const row = productionData[i];
      const productCode = row[1]?.toString() || '';
      const channel = row[5]?.toString() || '';  // F열 = 채널
      
      if (gsProductCodes.includes(productCode) && channel !== 'GS') {
        rowsToUpdate.push({
          rowIndex: i + 2,  // 시트 행번호 (헤더 제외, 1-based)
          productCode,
          oldChannel: channel
        });
      }
    }
    
    console.log(`[fix-production-channel-gs] 수정 필요 행: ${rowsToUpdate.length}건`);
    
    if (rowsToUpdate.length === 0) {
      return c.json({
        success: true,
        message: '수정할 항목이 없습니다. 이미 모든 GS 제품이 GS 채널로 설정되어 있습니다.',
        gs_products: gsProductCodes,
        updated_count: 0
      });
    }
    
    // 4. 채널 일괄 수정 (F열) - batchWriteSheet 사용
    const updates = rowsToUpdate.map(item => ({
      sheetName: '생산실적',
      range: `F${item.rowIndex}`,
      values: [['GS']]
    }));
    
    // 배치로 나눠서 처리 (Google API 제한 고려)
    const batchSize = 100;
    let updatedCount = 0;
    
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      await service.batchWriteSheet(batch);
      updatedCount += batch.length;
      
      // API 호출 간격 조절
      if (i + batchSize < updates.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    
    return c.json({
      success: true,
      message: `생산실적 채널 수정 완료`,
      gs_products: gsProductCodes,
      updated_count: updatedCount,
      updated_rows: rowsToUpdate.slice(0, 20),  // 샘플 20건만 반환
      note: '★ v3.6.52: 제품마스터 GS 제품의 생산실적 채널을 GS로 수정'
    });
  } catch (error: any) {
    console.error('[fix-production-channel-gs] 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.53: 일별수불부 재생성 (전일 현재고 기반) ★★★
// 특정 날짜들의 일별수불부를 전일 현재고를 기준으로 재생성
sheets.post('/regenerate-daily-stock', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const dates: string[] = body.dates || [];  // 재생성할 날짜들 (예: ["2026-06-26", "2026-06-27"])
    
    if (dates.length === 0) {
      return c.json({ success: false, error: 'dates 배열 필수' }, 400);
    }
    
    // 날짜 정렬 (오름차순)
    const sortedDates = [...dates].sort();
    console.log(`[regenerate-daily-stock] 재생성 날짜: ${sortedDates.join(', ')}`);
    
    // 1. 첫 번째 날짜의 전일 현재고 조회 (원료 목록도 여기서 가져옴)
    const firstDate = sortedDates[0];
    const prevDate = new Date(firstDate);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().split('T')[0];
    
    console.log(`[regenerate-daily-stock] 전일(${prevDateStr}) 현재고 조회`);
    
    const prevDayStock = await service.getDailyStockReport(prevDateStr);
    
    if (prevDayStock.length === 0) {
      return c.json({ 
        success: false, 
        error: `전일(${prevDateStr}) 일별수불부 데이터가 없습니다.` 
      }, 400);
    }
    
    // ★ 전일 일별수불부에서 원료 목록과 현재고 추출
    const materials: { code: string; name: string }[] = [];
    const prevStockMap = new Map<string, number>();
    
    for (const item of prevDayStock) {
      materials.push({ code: item.item_code, name: item.item_name });
      prevStockMap.set(item.item_code, item.current_stock || 0);
    }
    
    console.log(`[regenerate-daily-stock] 원료목록: ${materials.length}개, 전일재고 로드 완료`);
    
    // 3. 각 날짜별로 일별수불부 생성
    const results: any[] = [];
    let currentStockMap = new Map(prevStockMap);  // 누적 재고 (이전 날짜 현재고 → 다음 날짜 전일재고)
    
    for (const date of sortedDates) {
      console.log(`[regenerate-daily-stock] ${date} 처리 중...`);
      
      // 해당 날짜 입고량 조회
      const inboundData = await service.readSheet('원료입고', 'A2:E');
      const inboundMap = new Map<string, number>();
      
      for (const row of inboundData) {
        let inboundDate = row[0]?.toString().replace(/^'/, '') || '';
        if (/^\d{5}$/.test(inboundDate)) {
          const excelDate = parseInt(inboundDate);
          const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
          inboundDate = jsDate.toISOString().split('T')[0];
        }
        
        if (inboundDate === date) {
          const code = row[1]?.toString() || '';
          const qty = parseFloat(row[4]?.toString() || '0') || 0;
          inboundMap.set(code, (inboundMap.get(code) || 0) + qty);
        }
      }
      
      // 해당 날짜 사용량 조회 (로트매칭)
      const lotMatchingData = await service.readSheet('로트매칭', 'A2:E');
      const usageMap = new Map<string, number>();
      
      for (const row of lotMatchingData) {
        let matchDate = row[0]?.toString().replace(/^'/, '') || '';
        if (/^\d{5}$/.test(matchDate)) {
          const excelDate = parseInt(matchDate);
          const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
          matchDate = jsDate.toISOString().split('T')[0];
        }
        
        if (matchDate === date) {
          const code = row[2]?.toString() || '';
          const qty = parseFloat(row[4]?.toString() || '0') || 0;
          usageMap.set(code, (usageMap.get(code) || 0) + qty);
        }
      }
      
      // 일별수불부 행 생성
      const rows: any[][] = [];
      const nextStockMap = new Map<string, number>();
      
      for (const mat of materials) {
        const prevStock = currentStockMap.get(mat.code) || 0;
        const inbound = inboundMap.get(mat.code) || 0;
        const usage = usageMap.get(mat.code) || 0;
        const currentStock = prevStock + inbound - usage;
        
        // 다음 날짜를 위해 현재고 저장
        nextStockMap.set(mat.code, currentStock);
        
        // 행 번호는 나중에 결정 (수식에 사용)
        rows.push([
          `'${date}`,  // A: 일자
          mat.code,     // B: 원료코드
          mat.name,     // C: 원료명
          prevStock,    // D: 전일재고 (값)
          // E: 입고량 (수식)
          // F: 사용량 (수식)
          // G: 현재고 (수식)
          'kg'          // H: 단위
        ]);
      }
      
      // 현재고를 다음 날짜 전일재고로
      currentStockMap = nextStockMap;
      
      // 시트에 추가 (기존 데이터 끝에)
      const existingData = await service.readSheet('일별수불부', 'A:A');
      const startRow = existingData.length + 1;
      
      // 수식 포함 행 생성
      const fullRows: any[][] = [];
      for (let i = 0; i < rows.length; i++) {
        const rowNum = startRow + i;
        const row = rows[i];
        fullRows.push([
          row[0],  // A: 일자
          row[1],  // B: 원료코드
          row[2],  // C: 원료명
          row[3],  // D: 전일재고 (값)
          `=IFERROR(SUMIFS('원료입고'!E:E,'원료입고'!B:B,B${rowNum},'원료입고'!A:A,A${rowNum}),0)`,  // E: 입고량
          `=IFERROR(SUMIFS('로트매칭'!E:E,'로트매칭'!C:C,B${rowNum},'로트매칭'!A:A,A${rowNum}),0)`,  // F: 사용량
          `=D${rowNum}+E${rowNum}-F${rowNum}`,  // G: 현재고
          row[4]   // H: 단위
        ]);
      }
      
      // 시트에 쓰기
      await service.writeSheet('일별수불부', `A${startRow}:H${startRow + fullRows.length - 1}`, fullRows);
      
      results.push({
        date,
        rows_added: fullRows.length,
        start_row: startRow,
        sample_inbound: Array.from(inboundMap.entries()).slice(0, 3),
        sample_usage: Array.from(usageMap.entries()).slice(0, 3)
      });
      
      console.log(`[regenerate-daily-stock] ${date} 완료: ${fullRows.length}행 추가`);
    }
    
    return c.json({
      success: true,
      message: `일별수불부 재생성 완료`,
      prev_date: prevDateStr,
      prev_stock_count: prevStockMap.size,
      results,
      note: '★ v3.6.53: 전일 현재고 기반 일별수불부 재생성'
    });
  } catch (error: any) {
    console.error('[regenerate-daily-stock] 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.54: 생산실적 채널 일괄 복구 API (제품마스터 기준) ★★★
// 특정 날짜의 생산실적에서 채널이 잘못된(쿠팡으로 저장된) 데이터를 제품마스터 기준으로 수정
sheets.post('/fix-production-channel-by-date', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json();
    const targetDate = body.date;  // 수정할 날짜 (필수)
    const dryRun = body.dry_run !== false;  // 기본값: true (시뮬레이션)

    if (!targetDate) {
      return c.json({ success: false, error: 'date 필수' }, 400);
    }

    // 1. 제품마스터에서 채널 맵 조회
    // ★ 동일 제품코드에 여러 채널이 있으면 쿠팡이 아닌 채널 우선 (GS, 오아시스, 컬리, 배민 등)
    const productMasterData = await service.readSheet('제품마스터', 'A2:E');
    const channelMap = new Map<string, string>();
    
    for (const row of productMasterData) {
      const productCode = row[0]?.toString() || '';
      const channel = row[4]?.toString() || '';  // E열 = 채널
      if (productCode && channel) {
        const existingChannel = channelMap.get(productCode);
        // 이미 쿠팡이 아닌 채널이 있으면 유지, 없으면 새 채널 설정
        if (!existingChannel || existingChannel === '쿠팡') {
          channelMap.set(productCode, channel);
        }
      }
    }
    console.log(`[fix-production-channel-by-date] 제품마스터 ${channelMap.size}개 채널 정보 로드`);

    // 2. 생산실적에서 해당 날짜 데이터 조회
    const productionData = await service.readSheet('생산실적', 'A2:H');
    
    const rowsToUpdate: { rowIndex: number; productCode: string; currentChannel: string; correctChannel: string }[] = [];
    
    for (let i = 0; i < productionData.length; i++) {
      const row = productionData[i];
      let prodDate = row[0]?.toString().replace(/^'/, '') || '';
      
      // 엑셀 날짜 숫자 변환
      if (/^\d{5}$/.test(prodDate)) {
        const excelDate = parseInt(prodDate);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        prodDate = jsDate.toISOString().split('T')[0];
      }
      
      if (prodDate !== targetDate) continue;
      
      const productCode = row[1]?.toString() || '';
      const currentChannel = row[5]?.toString() || '';
      const correctChannel = channelMap.get(productCode);
      
      // ★ v3.6.54: 현재 채널이 "쿠팡"이고, 제품마스터에 쿠팡이 아닌 채널이 있는 경우만 수정
      // (쿠팡으로 잘못 저장된 데이터를 제품마스터 기준으로 복구)
      const shouldFix = currentChannel === '쿠팡' && correctChannel && correctChannel !== '쿠팡';
      
      if (shouldFix) {
        rowsToUpdate.push({
          rowIndex: i + 2,  // 실제 시트 행 (1-indexed, 헤더 제외)
          productCode,
          currentChannel,
          correctChannel
        });
      }
    }

    console.log(`[fix-production-channel-by-date] ${targetDate} 수정 대상: ${rowsToUpdate.length}건`);

    if (rowsToUpdate.length === 0) {
      return c.json({
        success: true,
        message: `${targetDate}에 수정할 데이터가 없습니다.`,
        updates: 0
      });
    }

    // 채널별 통계
    const channelStats: Record<string, { from: Record<string, number>; count: number }> = {};
    for (const item of rowsToUpdate) {
      if (!channelStats[item.correctChannel]) {
        channelStats[item.correctChannel] = { from: {}, count: 0 };
      }
      channelStats[item.correctChannel].count++;
      channelStats[item.correctChannel].from[item.currentChannel] = 
        (channelStats[item.correctChannel].from[item.currentChannel] || 0) + 1;
    }

    if (dryRun) {
      return c.json({
        success: true,
        mode: 'dry_run',
        date: targetDate,
        message: `${rowsToUpdate.length}건 수정 예정 (dry_run=false로 실제 수정)`,
        updates_preview: rowsToUpdate.length,
        channel_stats: channelStats,
        sample: rowsToUpdate.slice(0, 20).map(r => ({
          row: r.rowIndex,
          code: r.productCode,
          from: r.currentChannel,
          to: r.correctChannel
        }))
      });
    }

    // 3. 실제 수정 (개별 셀 업데이트)
    const updates = rowsToUpdate.map(item => ({
      sheetName: '생산실적',
      range: `F${item.rowIndex}`,
      values: [[item.correctChannel]]
    }));

    // batchWriteSheet 사용
    await service.batchWriteSheet(updates);

    return c.json({
      success: true,
      date: targetDate,
      message: `${rowsToUpdate.length}건 채널 수정 완료`,
      updates: rowsToUpdate.length,
      channel_stats: channelStats,
      note: '★ v3.6.54: 제품마스터 기준 채널 복구'
    });
  } catch (error: any) {
    console.error('[fix-production-channel-by-date] 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.55: 원료입고 시트 중복 행 삭제 API ★★★
sheets.post('/fix-inbound-duplicates', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json<{ 
      rowsToDelete?: number[];  // 삭제할 행 번호 배열 (1-indexed)
      dryRun?: boolean;         // true면 실제 삭제 안 함
    }>();
    
    const dryRun = body.dryRun ?? true;  // 기본값: 미리보기 모드
    const rowsToDelete = body.rowsToDelete || [919, 920, 921, 922, 923, 924, 925, 926, 927, 928, 929, 930];
    
    // 1. 현재 원료입고 데이터 조회
    const inboundData = await service.readSheet('원료입고', 'A1:I1000');
    
    if (!inboundData || inboundData.length === 0) {
      return c.json({ success: false, error: '원료입고 시트 데이터 없음' }, 400);
    }
    
    // 2. 삭제 대상 행 정보 수집
    const deletionInfo: { row: number; data: any[] }[] = [];
    for (const rowNum of rowsToDelete) {
      const idx = rowNum - 1;  // 0-indexed
      if (idx >= 0 && idx < inboundData.length) {
        deletionInfo.push({
          row: rowNum,
          data: inboundData[idx]
        });
      }
    }
    
    if (dryRun) {
      return c.json({
        success: true,
        mode: 'dry_run',
        message: `${deletionInfo.length}개 행 삭제 미리보기 (실제 삭제하려면 dryRun: false로 호출)`,
        rows_to_delete: deletionInfo.map(d => ({
          row: d.row,
          date: d.data[0],
          code: d.data[1],
          name: d.data[2],
          lot: d.data[3],
          qty: d.data[4],
          f_col: d.data[5],  // F열 (잘못된 경우 공급업체가 들어있음)
          g_col: d.data[6],
          h_col: d.data[7],
          i_col: d.data[8]
        }))
      });
    }
    
    // 3. 실제 삭제 - batchUpdate로 행 삭제
    // 구글 시트 API의 deleteRows 사용
    const spreadsheetId = '1VD3vL5ka-gVjkrxsT-dOEBMlKXFIn-SMj5jQ4ogv-x8';
    
    // 시트 ID 조회
    const sheetId = await service.getSheetId('원료입고');
    
    // 행 삭제 (뒤에서부터 삭제해야 인덱스가 밀리지 않음)
    const sortedRows = [...rowsToDelete].sort((a, b) => b - a);
    
    const deleteRequests = sortedRows.map(rowNum => ({
      deleteDimension: {
        range: {
          sheetId: sheetId,
          dimension: 'ROWS',
          startIndex: rowNum - 1,  // 0-indexed
          endIndex: rowNum         // 0-indexed, exclusive
        }
      }
    }));
    
    await service.batchUpdate(deleteRequests);
    
    return c.json({
      success: true,
      mode: 'executed',
      message: `${sortedRows.length}개 행 삭제 완료`,
      deleted_rows: sortedRows,
      note: '★ v3.6.55: 원료입고 중복 행 삭제'
    });
  } catch (error: any) {
    console.error('[fix-inbound-duplicates] 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// =====================================================================
// ★★★ v3.6.56: 월별수불부 API ★★★
// =====================================================================

// 월별수불부 시트 초기화 (시트 생성)
sheets.post('/monthly-stock/init', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    // 시트 생성
    const created = await service.createSheetIfNotExists('월별수불부');
    
    if (created) {
      // 헤더 추가
      const headers = [
        ['년월', '원료코드', '원료명', '단위', '기초재고', '당월입고량', '당월사용량', '기말재고(이론)', '실사재고', '차이', '비고/사유', '작성일', '작성자']
      ];
      await service.writeSheet('월별수불부', 'A1:M1', headers);
    }
    
    return c.json({
      success: true,
      message: created ? '월별수불부 시트가 생성되었습니다.' : '월별수불부 시트가 이미 존재합니다.',
      headers: ['년월', '원료코드', '원료명', '단위', '기초재고', '당월입고량', '당월사용량', '기말재고(이론)', '실사재고', '차이', '비고/사유', '작성일', '작성자']
    });
  } catch (error: any) {
    console.error('[monthly-stock/init] 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 월별수불부 데이터 조회
sheets.get('/monthly-stock', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const yearMonth = c.req.query('month');  // 예: 2026-07
    
    let data: any[] = [];
    try {
      data = await service.readSheet('월별수불부', 'A2:M1000') || [];
    } catch (sheetError: any) {
      console.log('[monthly-stock] 시트 조회 실패:', sheetError.message);
      data = [];
    }
    
    if (!data || data.length === 0) {
      return c.json({
        success: true,
        data: [],
        message: '월별수불부 데이터가 없습니다.'
      });
    }
    
    // 데이터 파싱
    let results = data.map((row: any[], idx: number) => ({
      row_number: idx + 2,
      year_month: row[0] || '',
      item_code: row[1] || '',
      item_name: row[2] || '',
      unit: row[3] || 'kg',
      opening_stock: parseFloat(row[4]) || 0,      // 기초재고
      monthly_inbound: parseFloat(row[5]) || 0,    // 당월입고량
      monthly_usage: parseFloat(row[6]) || 0,      // 당월사용량
      closing_stock_theory: parseFloat(row[7]) || 0, // 기말재고(이론)
      actual_stock: row[8] !== undefined && row[8] !== '' ? parseFloat(row[8]) : null,  // 실사재고
      difference: row[9] !== undefined && row[9] !== '' ? parseFloat(row[9]) : null,    // 차이
      remarks: row[10] || '',                      // 비고/사유
      created_date: row[11] || '',                 // 작성일
      created_by: row[12] || ''                    // 작성자
    }));
    
    // 특정 월 필터링
    if (yearMonth) {
      results = results.filter(r => r.year_month === yearMonth);
    }
    
    return c.json({
      success: true,
      data: results,
      total: results.length
    });
  } catch (error: any) {
    console.error('[monthly-stock] 조회 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 월별수불부 자동 생성 (일별 데이터 기반)
sheets.post('/monthly-stock/generate', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json<{ 
      year_month: string;  // 예: "2026-07"
      overwrite?: boolean; // 기존 데이터 덮어쓰기 여부
    }>();
    
    const { year_month, overwrite = false } = body;
    
    if (!year_month || !/^\d{4}-\d{2}$/.test(year_month)) {
      return c.json({ success: false, error: '년월 형식이 올바르지 않습니다. (예: 2026-07)' }, 400);
    }
    
    const [year, month] = year_month.split('-');
    const startDate = `${year}-${month}-01`;
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
    const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
    
    // 전월 계산
    const prevMonth = parseInt(month) === 1 ? 12 : parseInt(month) - 1;
    const prevYear = parseInt(month) === 1 ? parseInt(year) - 1 : parseInt(year);
    const prevYearMonth = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
    
    // 1. 기존 월별수불부에서 해당 월 데이터 확인
    const existingData = await service.readSheet('월별수불부', 'A2:M1000');
    const existingMonthData = existingData?.filter((row: any[]) => row[0] === year_month) || [];
    
    if (existingMonthData.length > 0 && !overwrite) {
      return c.json({
        success: false,
        error: `${year_month} 데이터가 이미 존재합니다. 덮어쓰려면 overwrite: true로 요청하세요.`,
        existing_count: existingMonthData.length
      });
    }
    
    // 2. 원료마스터에서 원료명/단위 조회 (★ 추가)
    const masterData = await service.readSheet('원료마스터', 'A2:E1000');
    const masterMap: Map<string, { name: string; unit: string }> = new Map();
    for (const row of masterData || []) {
      const itemCode = String(row[0] || '');
      const itemName = String(row[1] || '');
      const unit = String(row[3] || 'kg');
      if (itemCode && itemName) {
        masterMap.set(itemCode, { name: itemName, unit });
      }
    }
    
    // 3. 원료입고 데이터에서 당월 입고량 계산
    const inboundData = await service.readSheet('원료입고', 'A1:I5000');
    const monthlyInbound: Map<string, { name: string; unit: string; qty: number }> = new Map();
    
    for (const row of inboundData || []) {
      const inboundDate = String(row[0] || '').replace(/^'/, '');
      if (inboundDate >= startDate && inboundDate <= endDate) {
        const itemCode = String(row[1] || '');
        const itemName = String(row[2] || '');
        const qty = parseFloat(row[4]) || 0;
        const unit = String(row[5] || 'kg');
        
        if (itemCode) {
          const existing = monthlyInbound.get(itemCode) || { name: itemName, unit, qty: 0 };
          existing.qty += qty;
          if (!existing.name) existing.name = itemName;
          monthlyInbound.set(itemCode, existing);
        }
      }
    }
    
    // 3. 로트매칭에서 당월 사용량 계산
    const lotMatchData = await service.readSheet('로트매칭', 'A2:G10000');
    const monthlyUsage: Map<string, { name: string; qty: number }> = new Map();
    
    for (const row of lotMatchData || []) {
      const prodDate = String(row[0] || '').replace(/^'/, '');
      if (prodDate >= startDate && prodDate <= endDate) {
        const itemCode = String(row[2] || '');
        const itemName = String(row[3] || '');
        const usageQty = parseFloat(row[4]) || 0;
        
        if (itemCode) {
          const existing = monthlyUsage.get(itemCode) || { name: itemName, qty: 0 };
          existing.qty += usageQty;
          if (!existing.name) existing.name = itemName;
          monthlyUsage.set(itemCode, existing);
        }
      }
    }
    
    // 4. 전월 기말재고 = 이번 달 기초재고 (원료입고 잔량 기준으로 계산)
    // 또는 전월 월별수불부의 기말재고(이론) 또는 실사재고 사용
    const prevMonthData = existingData?.filter((row: any[]) => row[0] === prevYearMonth) || [];
    const openingStockMap: Map<string, number> = new Map();
    
    for (const row of prevMonthData) {
      const itemCode = String(row[1] || '');
      // 실사재고가 있으면 실사재고, 없으면 이론재고 사용
      const closingStock = row[8] !== undefined && row[8] !== '' ? parseFloat(row[8]) : parseFloat(row[7]) || 0;
      openingStockMap.set(itemCode, closingStock);
    }
    
    // 5. 전월 데이터가 없으면 원료입고 잔량에서 기초재고 계산
    if (prevMonthData.length === 0) {
      // 해당 월 시작일 기준으로 원료입고 잔량 합계
      for (const row of inboundData || []) {
        const inboundDate = String(row[0] || '').replace(/^'/, '');
        if (inboundDate < startDate) {
          const itemCode = String(row[1] || '');
          const remainQty = parseFloat(row[8]) || 0;  // I열: 잔량
          
          if (itemCode && remainQty > 0) {
            const existing = openingStockMap.get(itemCode) || 0;
            openingStockMap.set(itemCode, existing + remainQty);
          }
        }
      }
    }
    
    // 6. 모든 원료 코드 수집
    const allItemCodes = new Set<string>();
    monthlyInbound.forEach((_, code) => allItemCodes.add(code));
    monthlyUsage.forEach((_, code) => allItemCodes.add(code));
    openingStockMap.forEach((_, code) => allItemCodes.add(code));
    
    // 7. 월별수불부 데이터 생성
    const today = new Date().toISOString().split('T')[0];
    const newRows: any[][] = [];
    
    // 원료코드 자연 정렬 (R001, R002, ..., R010, R011 순서)
    const sortedItemCodes = Array.from(allItemCodes).sort((a, b) => {
      const aMatch = a.match(/^([A-Z]+)(\d+)$/);
      const bMatch = b.match(/^([A-Z]+)(\d+)$/);
      if (aMatch && bMatch) {
        if (aMatch[1] === bMatch[1]) {
          return parseInt(aMatch[2]) - parseInt(bMatch[2]);
        }
        return aMatch[1].localeCompare(bMatch[1]);
      }
      return a.localeCompare(b);
    });
    
    for (const itemCode of sortedItemCodes) {
      const inboundInfo = monthlyInbound.get(itemCode) || { name: '', unit: 'kg', qty: 0 };
      const usageInfo = monthlyUsage.get(itemCode) || { name: '', qty: 0 };
      // ★ 원료명/단위: 원료마스터 > 원료입고 > 로트매칭 > 코드 순서로 조회
      const masterInfo = masterMap.get(itemCode);
      const itemName = masterInfo?.name || inboundInfo.name || usageInfo.name || itemCode;
      const unit = masterInfo?.unit || inboundInfo.unit || 'kg';
      
      const openingStock = openingStockMap.get(itemCode) || 0;
      const monthlyIn = inboundInfo.qty;
      const monthlyUse = usageInfo.qty;
      const closingStockTheory = openingStock + monthlyIn - monthlyUse;
      
      newRows.push([
        year_month,           // A: 년월
        itemCode,             // B: 원료코드
        itemName,             // C: 원료명
        unit,                 // D: 단위
        openingStock.toFixed(2),  // E: 기초재고
        monthlyIn.toFixed(2),     // F: 당월입고량
        monthlyUse.toFixed(2),    // G: 당월사용량
        closingStockTheory.toFixed(2), // H: 기말재고(이론)
        '',                   // I: 실사재고 (수동 입력)
        '',                   // J: 차이 (수식으로 계산)
        '',                   // K: 비고/사유 (수동 입력)
        today,                // L: 작성일
        'SYSTEM'              // M: 작성자
      ]);
    }
    
    // 8. 기존 데이터 삭제 후 새 데이터 추가 (overwrite 모드)
    if (overwrite && existingMonthData.length > 0) {
      // 해당 월 데이터의 행 번호 찾기
      const rowsToDelete: number[] = [];
      for (let i = 0; i < (existingData?.length || 0); i++) {
        if (existingData[i][0] === year_month) {
          rowsToDelete.push(i + 2);  // 1-indexed, 헤더 제외
        }
      }
      
      // 뒤에서부터 삭제
      if (rowsToDelete.length > 0) {
        const sheetId = await service.getSheetId('월별수불부');
        const sortedRows = rowsToDelete.sort((a, b) => b - a);
        const deleteRequests = sortedRows.map(rowNum => ({
          deleteDimension: {
            range: {
              sheetId: sheetId,
              dimension: 'ROWS',
              startIndex: rowNum - 1,
              endIndex: rowNum
            }
          }
        }));
        await service.batchUpdate(deleteRequests);
      }
    }
    
    // 9. 새 데이터 추가
    if (newRows.length > 0) {
      await service.appendSheet('월별수불부', newRows);
    }
    
    return c.json({
      success: true,
      message: `${year_month} 월별수불부 ${newRows.length}건 생성 완료`,
      year_month,
      generated_count: newRows.length,
      summary: {
        total_items: newRows.length,
        with_inbound: monthlyInbound.size,
        with_usage: monthlyUsage.size,
        with_opening_stock: openingStockMap.size
      }
    });
  } catch (error: any) {
    console.error('[monthly-stock/generate] 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 월별수불부 실사재고 및 비고 수정
sheets.put('/monthly-stock/update', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json<{
      year_month: string;
      item_code: string;
      opening_stock?: number;        // 기초재고
      monthly_inbound?: number;      // 당월입고량
      monthly_usage?: number;        // 당월사용량
      closing_stock_theory?: number; // 기말재고(이론)
      actual_stock?: number;         // 실사재고
      remarks?: string;              // 비고/사유
      updated_by?: string;           // 수정자
    }>();
    
    const { year_month, item_code, opening_stock, monthly_inbound, monthly_usage, closing_stock_theory, actual_stock, remarks, updated_by = '' } = body;
    
    if (!year_month || !item_code) {
      return c.json({ success: false, error: '년월과 원료코드는 필수입니다.' }, 400);
    }
    
    // 해당 행 찾기
    const data = await service.readSheet('월별수불부', 'A2:M5000');
    let targetRowIndex = -1;
    let targetRow: any[] = [];
    
    for (let i = 0; i < (data?.length || 0); i++) {
      if (data[i][0] === year_month && data[i][1] === item_code) {
        targetRowIndex = i + 2;  // 1-indexed, 헤더 제외
        targetRow = data[i];
        break;
      }
    }
    
    if (targetRowIndex === -1) {
      return c.json({ success: false, error: `${year_month} ${item_code} 데이터를 찾을 수 없습니다.` }, 404);
    }
    
    // 업데이트할 값 준비
    const updates: { range: string; values: any[][] }[] = [];
    const today = new Date().toISOString().split('T')[0];
    
    // E열: 기초재고
    if (opening_stock !== undefined) {
      updates.push({
        range: `월별수불부!E${targetRowIndex}`,
        values: [[opening_stock]]
      });
    }
    
    // F열: 당월입고량
    if (monthly_inbound !== undefined) {
      updates.push({
        range: `월별수불부!F${targetRowIndex}`,
        values: [[monthly_inbound]]
      });
    }
    
    // G열: 당월사용량
    if (monthly_usage !== undefined) {
      updates.push({
        range: `월별수불부!G${targetRowIndex}`,
        values: [[monthly_usage]]
      });
    }
    
    // H열: 기말재고(이론)
    if (closing_stock_theory !== undefined) {
      updates.push({
        range: `월별수불부!H${targetRowIndex}`,
        values: [[closing_stock_theory]]
      });
    }
    
    // I열: 실사재고, J열: 차이
    if (actual_stock !== undefined) {
      // 기말재고(이론) 값 결정: 새로 입력된 값 또는 기존 값
      const theoryValue = closing_stock_theory !== undefined ? closing_stock_theory : (parseFloat(targetRow[7]) || 0);
      const difference = actual_stock - theoryValue;
      
      updates.push({
        range: `월별수불부!I${targetRowIndex}:J${targetRowIndex}`,
        values: [[actual_stock, difference.toFixed(2)]]
      });
    }
    
    // K열: 비고/사유
    if (remarks !== undefined) {
      updates.push({
        range: `월별수불부!K${targetRowIndex}`,
        values: [[remarks]]
      });
    }
    
    // 수정일/수정자 업데이트
    if (updates.length > 0) {
      updates.push({
        range: `월별수불부!L${targetRowIndex}:M${targetRowIndex}`,
        values: [[today, updated_by || 'USER']]
      });
    }
    
    // 일괄 업데이트
    for (const update of updates) {
      await service.writeSheet('월별수불부', update.range.replace('월별수불부!', ''), update.values);
    }
    
    return c.json({
      success: true,
      message: '월별수불부 업데이트 완료',
      updated: {
        year_month,
        item_code,
        actual_stock,
        remarks,
        row: targetRowIndex
      }
    });
  } catch (error: any) {
    console.error('[monthly-stock/update] 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 월별수불부 일괄 실사재고 입력
sheets.post('/monthly-stock/bulk-actual', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const body = await c.req.json<{
      year_month: string;
      items: Array<{
        item_code: string;
        actual_stock: number;
        remarks?: string;
      }>;
      updated_by?: string;
    }>();
    
    const { year_month, items, updated_by = 'USER' } = body;
    
    if (!year_month || !items || items.length === 0) {
      return c.json({ success: false, error: '년월과 항목 목록은 필수입니다.' }, 400);
    }
    
    // 현재 데이터 조회
    const data = await service.readSheet('월별수불부', 'A2:M5000');
    const rowMap: Map<string, { index: number; row: any[] }> = new Map();
    
    for (let i = 0; i < (data?.length || 0); i++) {
      if (data[i][0] === year_month) {
        rowMap.set(data[i][1], { index: i + 2, row: data[i] });
      }
    }
    
    const today = new Date().toISOString().split('T')[0];
    const updates: { sheetName: string; range: string; values: any[][] }[] = [];
    const results: any[] = [];
    
    for (const item of items) {
      const rowInfo = rowMap.get(item.item_code);
      if (!rowInfo) {
        results.push({ item_code: item.item_code, success: false, error: '데이터 없음' });
        continue;
      }
      
      const closingStockTheory = parseFloat(rowInfo.row[7]) || 0;
      const difference = item.actual_stock - closingStockTheory;
      
      // I열: 실사재고, J열: 차이, K열: 비고, L열: 작성일, M열: 작성자
      updates.push({
        sheetName: '월별수불부',
        range: `I${rowInfo.index}:M${rowInfo.index}`,
        values: [[item.actual_stock, difference.toFixed(2), item.remarks || '', today, updated_by]]
      });
      
      results.push({
        item_code: item.item_code,
        success: true,
        actual_stock: item.actual_stock,
        theory_stock: closingStockTheory,
        difference: difference.toFixed(2)
      });
    }
    
    // 일괄 쓰기
    if (updates.length > 0) {
      await service.batchWriteSheet(updates);
    }
    
    return c.json({
      success: true,
      message: `${updates.length}건 실사재고 입력 완료`,
      year_month,
      results,
      summary: {
        total: items.length,
        success: updates.length,
        failed: items.length - updates.length
      }
    });
  } catch (error: any) {
    console.error('[monthly-stock/bulk-actual] 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 월별수불부 요약 (월 목록 조회)
sheets.get('/monthly-stock/summary', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    let data: any[] = [];
    try {
      data = await service.readSheet('월별수불부', 'A2:M5000') || [];
    } catch (sheetError: any) {
      // 시트가 없는 경우 빈 배열 반환
      console.log('[monthly-stock/summary] 시트 조회 실패 (시트 없음 가능성):', sheetError.message);
      data = [];
    }
    
    if (!data || data.length === 0) {
      return c.json({
        success: true,
        months: [],
        message: '월별수불부 데이터가 없습니다.'
      });
    }
    
    // 월별 통계
    const monthStats: Map<string, { 
      total_items: number; 
      with_actual: number; 
      with_difference: number;
      total_difference: number;
    }> = new Map();
    
    for (const row of data) {
      const yearMonth = String(row[0] || '');
      if (!yearMonth) continue;
      
      const stats = monthStats.get(yearMonth) || { 
        total_items: 0, 
        with_actual: 0, 
        with_difference: 0,
        total_difference: 0
      };
      
      stats.total_items++;
      
      if (row[8] !== undefined && row[8] !== '') {
        stats.with_actual++;
      }
      
      const diff = parseFloat(row[9]) || 0;
      if (diff !== 0) {
        stats.with_difference++;
        stats.total_difference += diff;
      }
      
      monthStats.set(yearMonth, stats);
    }
    
    // 월 목록 정렬 (최신순)
    const months = Array.from(monthStats.entries())
      .map(([month, stats]) => ({
        year_month: month,
        ...stats,
        completion_rate: stats.total_items > 0 
          ? Math.round((stats.with_actual / stats.total_items) * 100) 
          : 0
      }))
      .sort((a, b) => b.year_month.localeCompare(a.year_month));
    
    return c.json({
      success: true,
      months,
      total_months: months.length
    });
  } catch (error: any) {
    console.error('[monthly-stock/summary] 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});
