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

    // RAW 시트에 저장
    if (validRows.length > 0) {
      await service.appendSheet('생산실적', validRows);
    }

    return c.json({
      success: true,
      layer: 'INPUT',
      lot_number: lotNum,
      message: `생산 ${results.success}건 저장, ${results.failed}건 실패`,
      validation_errors: results.errors.length > 0 ? results.errors : undefined,
      note: '★ 무결성 검증 통과 데이터만 저장됨. 원료사용량은 자동 계산됩니다.'
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
    
    // 2. BOM 데이터 조회
    const bomData = await service.readSheet('BOM마스터', 'A2:F');
    const bomMap = new Map<string, any[]>();
    for (const row of bomData) {
      const productCode = row[0];
      if (!bomMap.has(productCode)) bomMap.set(productCode, []);
      bomMap.get(productCode)!.push({
        item_code: row[2],
        item_name: row[3],
        quantity: parseFloat(row[4]) || 0,  // g 단위
        unit: row[5] || 'g'
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
        
        // BOM g → kg 변환
        const usageKg = (material.quantity * prod.quantity) / 1000;
        
        if (!usageMap.has(material.item_code)) {
          usageMap.set(material.item_code, { name: material.item_name, usage: 0 });
        }
        usageMap.get(material.item_code)!.usage += usageKg;
      }
    }

    // 5. 일별수불부 데이터 생성
    const dailyStockRows: any[][] = [];
    
    for (const [itemCode, usageData] of usageMap) {
      const stock = stockMap.get(itemCode);
      const prevStock = stock?.qty || 0;
      const inboundQty = 0;  // TODO: 당일 입고량 조회
      const currentStock = prevStock - usageData.usage;
      
      dailyStockRows.push([
        `'${date}`,           // A: 일자
        itemCode,             // B: 품목코드
        usageData.name,       // C: 품목명
        prevStock.toFixed(3), // D: 전일재고
        inboundQty.toFixed(3),// E: 입고(+)
        usageData.usage.toFixed(3), // F: 출고/사용(-)  ★ 핵심!
        currentStock.toFixed(3),    // G: 현재고
        'kg'                  // H: 단위
      ]);
    }

    // 6. 일별수불부 시트에 저장
    if (dailyStockRows.length > 0) {
      await service.appendSheet('일별수불부', dailyStockRows);
    }

    return c.json({
      success: true,
      layer: 'PROCESSING',
      date,
      production_count: productions.length,
      items_calculated: dailyStockRows.length,
      message: `${date} 일별수불부 ${dailyStockRows.length}건 계산 완료`,
      sample: dailyStockRows.slice(0, 3).map(row => ({
        item_code: row[1],
        item_name: row[2],
        prev_stock: row[3],
        inbound: row[4],
        usage: row[5],
        current: row[6]
      })),
      note: '★ 출고/사용(-) 컬럼에 BOM 기반 원료 사용량이 계산되었습니다.'
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
        item_code: row[1],
        item_name: row[2],
        prev_stock: parseFloat(row[3]) || 0,
        inbound_qty: parseFloat(row[4]) || 0,
        usage_qty: parseFloat(row[5]) || 0,
        current_stock: parseFloat(row[6]) || 0,
        unit: row[7] || 'kg'
      }));

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

// [3단계] 출력 레이어: 생산일보 데이터 (PDF용)
sheets.get('/v2/output/production-report', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }

  try {
    const date = c.req.query('date') || new Date().toISOString().split('T')[0];
    
    // 1. 생산실적 조회
    const productions = await service.getProductionRecords(date);
    
    // 2. 로트매칭 정보 조회
    const lotMatchingData = await service.readSheet('로트매칭', 'A2:G');
    
    // 3. 생산일보 데이터 구성
    const reportItems = [];
    
    for (const prod of productions) {
      const materials = lotMatchingData
        .filter(row => row[0]?.toString().replace(/^'/, '') === date && row[1] === prod.lot_number)
        .map(row => ({
          item_code: row[2],
          item_name: row[3],
          usage_qty: parseFloat(row[4]) || 0,
          material_lot: row[5],
          expiry_date: row[6]
        }));

      reportItems.push({
        prod_date: prod.prod_date,
        product_code: prod.product_code,
        product_name: prod.product_name,
        quantity: prod.quantity,
        lot_number: prod.lot_number,
        channel: prod.channel,
        materials
      });
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
      note: '★ PDF 생성용 정리된 데이터입니다.'
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default sheets;
