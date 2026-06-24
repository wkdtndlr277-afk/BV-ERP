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

// ===== ERP → 시트 동기화 =====

// 원료 입고 데이터 동기화 (원료 R/RM만, 부자재/제품 제외)
sheets.post('/sync/inbound', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    // ERP DB에서 입고 데이터 조회 (R, RM 원료만, 잔량 있는 것만)
    const inboundData = await c.env.DB.prepare(`
      SELECT i.inbound_date, i.item_code, m.item_name, i.lot_number, 
             i.origin_qty, COALESCE(m.unit, 'kg') as unit, 
             i.supplier, i.expiry_date, i.remain_qty
      FROM inbound i
      LEFT JOIN master m ON i.item_code = m.item_code
      WHERE (i.item_code LIKE 'R%' OR i.item_code LIKE 'RM%')
        AND i.item_code NOT LIKE 'SM%'
        AND i.item_code NOT LIKE 'SF%'
        AND i.item_code NOT LIKE 'PD%'
        AND i.item_code NOT LIKE 'PR%'
        AND i.remain_qty > 0
      ORDER BY i.item_code, i.expiry_date ASC, i.inbound_date DESC
    `).all<any>();

    await service.syncInboundData(inboundData.results || []);
    
    return c.json({ 
      success: true, 
      message: `원료 입고 ${inboundData.results?.length || 0}건 동기화 완료 (R/RM 원료만)` 
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
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

    // 1. 입고 동기화 (R/RM 원료만, 잔량 있는 것만)
    const inboundData = await c.env.DB.prepare(`
      SELECT i.inbound_date, i.item_code, m.item_name, i.lot_number, 
             i.origin_qty, COALESCE(m.unit, 'kg') as unit, 
             i.supplier, i.expiry_date, i.remain_qty
      FROM inbound i
      LEFT JOIN master m ON i.item_code = m.item_code
      WHERE (i.item_code LIKE 'R%' OR i.item_code LIKE 'RM%')
        AND i.item_code NOT LIKE 'SM%'
        AND i.item_code NOT LIKE 'SF%'
        AND i.item_code NOT LIKE 'PD%'
        AND i.item_code NOT LIKE 'PR%'
        AND i.remain_qty > 0
      ORDER BY i.item_code, i.expiry_date ASC, i.inbound_date DESC
    `).all<any>();
    await service.syncInboundData(inboundData.results || []);
    results.push(`입고 ${inboundData.results?.length || 0}건`);

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

    await service.appendSheet('생산실적', [row]);

    return c.json({
      success: true,
      message: '생산 실적 추가 완료',
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

    // 1. 생산실적 조회
    const productions = await service.getProductionRecords(prod_date);
    if (productions.length === 0) {
      return c.json({ success: false, error: '해당 날짜 생산 실적 없음' }, 400);
    }

    // 2. BOM 마스터 조회
    const bomData = await service.readSheet('BOM마스터', 'A2:F');
    const bomMap = new Map<string, any[]>();
    for (const row of bomData) {
      const productCode = row[0];
      if (!bomMap.has(productCode)) bomMap.set(productCode, []);
      bomMap.get(productCode)!.push({
        item_code: row[2],
        item_name: row[3],
        quantity: parseFloat(row[4]) || 0,
        unit: row[5] || 'g'
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
        
        // BOM 단위가 g면 kg로 변환
        let usageKg = material.unit === 'g' 
          ? (material.quantity * prod.quantity) / 1000 
          : material.quantity * prod.quantity;

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
            prod_date,
            prod.lot_number,
            material.item_code,
            material.item_name,
            usageKg.toFixed(3),
            '-',  // 로트 없음
            '-'   // 유통기한 없음
          ]);
          continue;
        }

        // FEFO 로트 매칭
        const lots = inboundMap.get(material.item_code) || [];
        let remaining = usageKg;
        for (const lot of lots) {
          if (remaining <= 0) break;
          if (lot.remain_qty <= 0) continue;

          const useFromLot = Math.min(remaining, lot.remain_qty);
          remaining -= useFromLot;

          // 로트매칭 시트에 기록
          lotMatchingRows.push([
            prod_date,
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
            prod_date,
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

    // 6. 일별수불부 데이터 생성 (★ 정제수 등 제외 원료는 수불부에서 제외)
    const dailyStockRows: any[][] = [];
    for (const [itemCode, usage] of usageByItem) {
      // ★ 정제수 등 제외 원료는 수불부에서 제외
      if (usage.isExcluded) continue;
      
      // 전일재고 = 원료입고 시트의 잔량 합계 (단순화)
      const lots = inboundMap.get(itemCode) || [];
      const totalRemain = lots.reduce((sum, lot) => sum + lot.remain_qty, 0);
      
      dailyStockRows.push([
        prod_date,
        itemCode,
        usage.item_name,
        totalRemain.toFixed(3),  // 전일재고 (실제로는 전일 기준 계산 필요)
        0,  // 당일 입고 (별도 계산 필요)
        usage.total.toFixed(3),  // 사용량
        (totalRemain - usage.total).toFixed(3),  // 현재고
        'kg'
      ]);
    }

    if (dailyStockRows.length > 0) {
      await service.appendSheet('일별수불부', dailyStockRows);
    }

    return c.json({
      success: true,
      message: '원료 사용량 계산 및 로트 매칭 완료',
      summary: {
        production_count: productions.length,
        lot_matching_count: lotMatchingRows.length,
        daily_stock_count: dailyStockRows.length,
        excluded_items: EXCLUDE_STOCK,
        usage_items: Array.from(usageByItem.entries()).map(([code, data]) => ({
          item_code: code,
          item_name: data.item_name,
          total_usage_kg: data.total.toFixed(3),
          excluded: data.isExcluded
        }))
      }
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

export default sheets;
