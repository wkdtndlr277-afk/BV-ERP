// 생산 관리 API
// v3.5.0: Service Layer 도입 - 재고 차감/트랜잭션 기록 원자적 처리
// v3.5.1: 재고 정합성 보정 API 추가
// v3.5.20: 단순화 API 추가 - 계산은 구글시트에서, ERP는 입력/출력만
// 최적화: Atomic Transaction, FEFO 강제, MAX(0,...) 적용, 재고 부족 방어
import { Hono } from 'hono';
import type { Bindings } from '../types';
import { GoogleSheetsService } from '../services/GoogleSheetsService';
import { 
  checkStockAvailability, 
  checkSemiFinishedAvailability,
  prepareFEFODeduction,
  prepareSemiFinishedDeduction,
  prepareMasterDeduction,
  prepareMasterIncrease,
  FEFO_QUERY,
  StockError,
  createInsufficientStockError
} from '../utils/inventory';
import {
  validateProductionItem,
  validateProductionDate,
  planFEFODeduction,
  executeAtomicDeduction,
  generateProductionLotNumber,
  getMaterialLotNumber,
  calculateExpiryDate,
  registerProduction,
  EXCLUDE_CODES as SERVICE_EXCLUDE_CODES
} from '../services/ProductionService';
import {
  getDailyStockReport,
  getSemiFinishedDailyReport,
  checkInventoryIntegrity,
  getItemTransactionHistory,
  // v3.5.1: 재고 조정 관련
  adjustInventory,
  bulkAdjustInventory,
  recordTransaction
} from '../services/InventoryService';

const productionRoutes = new Hono<{ Bindings: Bindings }>();

// ===== GoogleSheetsService 헬퍼 함수 =====
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

// ===== 채널명 정규화 함수 =====
// 생산일보 채널(영문) ↔ 바코드 채널(한글) 매핑
const CHANNEL_MAP: Record<string, string[]> = {
  '배민': ['bmart', '배민', 'baemin'],
  '쿠팡': ['coupang', '쿠팡'],
  '쿠팡냉동': ['coupang_frozen', '쿠팡냉동', 'coupang_paste'],
  '컬리': ['kurly', '컬리', 'kurly_room'],
  '컬리냉동': ['kurly_frozen', '컬리냉동', 'kurly_paste'],
  '오아시스': ['oasis', '오아시스'],
  'GS': ['gs', 'GS', 'gs25'],
  '네이버': ['naver', '네이버', 'smartstore'],
  '자사몰': ['direct', '자사몰', 'own'],
};

// 채널명을 바코드 테이블 기준(한글)으로 정규화
function normalizeChannel(channel: string): string {
  if (!channel) return '';
  const lowerChannel = channel.toLowerCase();
  
  for (const [normalized, aliases] of Object.entries(CHANNEL_MAP)) {
    if (aliases.some(alias => alias.toLowerCase() === lowerChannel || alias === channel)) {
      return normalized;
    }
  }
  return channel; // 매핑 없으면 원본 반환
}

// 가능한 모든 채널 변형 반환 (바코드 검색용)
function getChannelVariants(channel: string): string[] {
  if (!channel) return [''];
  const normalized = normalizeChannel(channel);
  const variants = CHANNEL_MAP[normalized] || [channel];
  return [...new Set([normalized, ...variants, channel])];
}

// 생산 목록 조회
productionRoutes.get('/', async (c) => {
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  const productCode = c.req.query('product_code');
  const status = c.req.query('status');
  
  // production_barcodes에서 제품명(product_name)과 판매처(channel) 가져오기
  // production_items에서 생산명(production_name)과 소비기한일수(shelf_life_days) 가져오기
  // barcode_product_name이 없으면 alias1(제품명)을 대체로 사용
  // 바코드가 여러 개인 경우 중복 방지를 위해 서브쿼리로 첫 번째 바코드만 가져옴
  let query = `
    SELECT p.*, 
           pi.production_name as production_name,
           COALESCE(
             (SELECT product_name FROM production_barcodes WHERE production_code = p.product_code LIMIT 1),
             pi.alias1
           ) as barcode_product_name,
           COALESCE(
             p.channel,
             (SELECT channel FROM production_barcodes WHERE production_code = p.product_code LIMIT 1)
           ) as channel,
           COALESCE(m.unit, 'EA') as product_unit,
           COALESCE(pi.shelf_life_days, 7) as shelf_life_days,
           COALESCE(p.expiry_date, date(p.prod_date, '+' || COALESCE(pi.shelf_life_days, 7) || ' days')) as calculated_expiry_date
    FROM production p
    LEFT JOIN master m ON p.product_code = m.item_code
    LEFT JOIN production_items pi ON p.product_code = pi.production_code
    WHERE 1=1
  `;
  const params: any[] = [];
  
  if (startDate) {
    query += ' AND p.prod_date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND p.prod_date <= ?';
    params.push(endDate);
  }
  if (productCode) {
    query += ' AND p.product_code = ?';
    params.push(productCode);
  }
  if (status) {
    query += ' AND p.status = ?';
    params.push(status);
  }
  
  query += ' GROUP BY p.id ORDER BY p.prod_date DESC, p.id DESC';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// ★★★ v3.4.1 디버그: 재고 매칭 진단 API ★★★
productionRoutes.get('/debug-stock', async (c) => {
  try {
    const itemCode = c.req.query('item_code') || '';
    
    // 1. BOM에서 해당 원료코드 확인
    const bomItems = await c.env.DB.prepare(`
      SELECT product_code, item_code, quantity, unit FROM bom
      WHERE item_code LIKE ?
      UNION ALL
      SELECT production_code as product_code, material_code as item_code, 
             quantity, unit FROM production_bom
      WHERE material_code LIKE ?
    `).bind(`%${itemCode}%`, `%${itemCode}%`).all<any>();
    
    // 2. inbound 테이블에서 해당 코드 재고 확인 (필터 완화 - 모든 재고)
    const inboundStock = await c.env.DB.prepare(`
      SELECT item_code, lot_number, inbound_date, origin_qty, remain_qty, quality_status, expiry_date
      FROM inbound
      WHERE item_code LIKE ?
      ORDER BY remain_qty DESC, expiry_date ASC
    `).bind(`%${itemCode}%`).all<any>();
    
    // 3. master 테이블에서 확인
    const masterData = await c.env.DB.prepare(`
      SELECT item_code, item_name, current_stock, unit, category
      FROM master
      WHERE item_code LIKE ?
    `).bind(`%${itemCode}%`).all<any>();
    
    // 4. semi_finished_items/lots에서 확인
    const sfData = await c.env.DB.prepare(`
      SELECT sf.item_code, sf.item_name, sf.unit, 
             COALESCE(SUM(sfl.remain_qty), 0) as available_stock
      FROM semi_finished_items sf
      LEFT JOIN semi_finished_lots sfl ON sf.item_code = sfl.item_code AND sfl.remain_qty > 0
      WHERE sf.item_code LIKE ?
      GROUP BY sf.item_code
    `).bind(`%${itemCode}%`).all<any>();
    
    // 5. 전체 재고 요약 (필터 완화)
    const allInbound = await c.env.DB.prepare(`
      SELECT item_code, SUM(remain_qty) as total_remain, COUNT(*) as lot_count
      FROM inbound
      WHERE remain_qty > 0
      GROUP BY item_code
      ORDER BY item_code
      LIMIT 100
    `).all<any>();
    
    return c.json({
      success: true,
      search_term: itemCode,
      bom_references: bomItems.results,
      inbound_stock: inboundStock.results,
      master_data: masterData.results,
      sf_data: sfData.results,
      all_inbound_summary: allInbound.results,
      diagnosis: {
        bom_count: bomItems.results?.length || 0,
        inbound_count: inboundStock.results?.length || 0,
        master_count: masterData.results?.length || 0,
        sf_count: sfData.results?.length || 0,
        hint: (bomItems.results?.length || 0) > 0 && (inboundStock.results?.length || 0) === 0 
          ? 'BOM에는 있지만 inbound에 재고가 없음 - 입고 등록 필요' 
          : 'OK'
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.47: closing-status - 생산 데이터는 구글시트에서 조회 ★★★
// 핵심 개선:
// 1. 생산 데이터는 구글시트 '생산실적' 시트에서 조회 (SSOT)
// 2. 수불부 데이터는 기존 transactions 테이블 기반 유지
// 3. 채널별 집계 정상 표시
productionRoutes.get('/closing-status', async (c) => {
  try {
    const date = c.req.query('date') || new Date().toISOString().split('T')[0];
    
    // ★ 구형 코드 및 없는 원료 제외 (영구 필터)
    const EXCLUDE_CODES = ['R169', 'R170', 'R171', 'R172', 'RM266'];
    const excludeClause = EXCLUDE_CODES.map(() => '?').join(',');
    
    // ★★★ 1. 당일 생산 현황 - 구글시트에서 조회 (SSOT) ★★★
    let productionItems: any[] = [];
    const service = getSheetService(c);
    
    if (service) {
      try {
        const spreadsheetId = c.env.GOOGLE_SHEET_ID;
        if (spreadsheetId) {
          service.setSpreadsheetId(spreadsheetId);
        }
        
        // 구글시트 생산실적에서 데이터 조회
        const sheetRecords = await service.getProductionRecords(date);
        
        // API 응답 형식으로 변환
        productionItems = sheetRecords.map((record: any, index: number) => ({
          id: `sheet-${index + 1}`,
          prod_date: record.prod_date,
          product_code: record.product_code,
          product_name: record.product_name || record.product_code,
          quantity: record.quantity || 0,
          lot_number: record.lot_number || '',
          channel: record.channel || '',
          expiry_date: '',
          status: 'completed',
          created_at: record.created_at || '',
          material_count: 0,
          source: 'google_sheets'
        }));
        
        console.log(`[closing-status/v3.6.47] 구글시트에서 ${productionItems.length}건 조회 (날짜: ${date})`);
      } catch (sheetError: any) {
        console.error('[closing-status/v3.6.47] 구글시트 조회 실패:', sheetError.message);
        // 구글시트 실패 시 D1 폴백
        const productionData = await c.env.DB.prepare(`
          SELECT p.id, p.prod_date, p.product_code, p.quantity, p.lot_number, 
                 p.channel, p.expiry_date, p.status, p.created_at,
                 COALESCE(pi.production_name, m.item_name, p.product_code) as product_name,
                 (SELECT COUNT(*) FROM production_materials WHERE production_id = p.id) as material_count
          FROM production p
          LEFT JOIN production_items pi ON p.product_code = pi.production_code
          LEFT JOIN master m ON p.product_code = m.item_code
          WHERE p.prod_date = ?
          ORDER BY p.created_at DESC
        `).bind(date).all<any>();
        productionItems = (productionData.results || []).map((p: any) => ({ ...p, source: 'd1_fallback' }));
      }
    } else {
      // 구글시트 서비스 없으면 D1에서 조회
      const productionData = await c.env.DB.prepare(`
        SELECT p.id, p.prod_date, p.product_code, p.quantity, p.lot_number, 
               p.channel, p.expiry_date, p.status, p.created_at,
               COALESCE(pi.production_name, m.item_name, p.product_code) as product_name,
               (SELECT COUNT(*) FROM production_materials WHERE production_id = p.id) as material_count
        FROM production p
        LEFT JOIN production_items pi ON p.product_code = pi.production_code
        LEFT JOIN master m ON p.product_code = m.item_code
        WHERE p.prod_date = ?
        ORDER BY p.created_at DESC
      `).bind(date).all<any>();
      productionItems = (productionData.results || []).map((p: any) => ({ ...p, source: 'd1' }));
    }
    
    // ★★★ 2. transactions 테이블 기반 수불부 데이터 (Single Source of Truth) ★★★
    const stockReport = await getDailyStockReport(c.env.DB, date, EXCLUDE_CODES);
    
    // ★★★ v3.5.10: SF 원료 사용량 계산 - 생산내역 + BOM 기반 ★★★
    // SF 원료는 입고가 아닌 자체 생산이므로, 당일 생산 내역의 BOM에서 SF 사용량을 계산
    const sfUsageMap: Record<string, { item_code: string; item_name: string; used_qty: number }> = {};
    
    // 당일 생산된 제품들의 BOM에서 SF 원료 사용량 집계
    for (const prod of productionItems) {
      const productCode = prod.product_code;
      const quantity = prod.quantity || 0;
      
      // production_bom에서 해당 제품의 SF 원료 조회
      const bomResult = await c.env.DB.prepare(`
        SELECT pb.material_code, pb.material_name, pb.quantity as bom_qty, pb.unit,
               COALESCE(sf.item_name, pb.material_name) as sf_name
        FROM production_bom pb
        LEFT JOIN semi_finished_items sf ON pb.material_code = sf.item_code
        WHERE pb.production_code = ?
          AND pb.material_code LIKE 'SF%'
      `).bind(productCode).all<any>();
      
      for (const bom of bomResult.results || []) {
        const sfCode = bom.material_code;
        const sfName = bom.sf_name || bom.material_name || sfCode;
        const bomQty = bom.bom_qty || 0;
        const bomUnit = (bom.unit || 'g').toLowerCase();
        
        // ★★★ v3.5.10: 단위에 따른 변환 - 최종 결과는 kg ★★★
        // BOM quantity * 생산수량 = 총 사용량
        let usedQtyKg: number;
        if (bomUnit === 'kg') {
          // BOM이 kg 단위면 그대로 사용
          usedQtyKg = bomQty * quantity;
        } else {
          // BOM이 g 단위면 kg로 변환 (g * 수량 / 1000)
          usedQtyKg = (bomQty * quantity) / 1000;
        }
        
        if (!sfUsageMap[sfCode]) {
          sfUsageMap[sfCode] = { item_code: sfCode, item_name: sfName, used_qty: 0 };
        }
        sfUsageMap[sfCode].used_qty += usedQtyKg;
      }
    }
    
    // SF 사용량 배열로 변환
    const sfUsageItems = Object.values(sfUsageMap).filter(sf => sf.used_qty > 0);
    
    // sfReport 형식으로 변환 (기존 API 호환)
    const sfReport = { 
      items: sfUsageItems.map(sf => ({
        itemCode: sf.item_code,
        itemName: sf.item_name,
        unit: 'kg',
        prevStock: 0,  // SF는 수불부 개념이 아님
        inboundQty: 0,
        usedQty: sf.used_qty,
        adjustmentQty: 0,
        currentStock: 0,
        lotNumbers: '',  // SF는 LOT 추적 안함 (자체생산)
        isValid: true,
        difference: 0
      })),
      summary: { 
        totalItems: sfUsageItems.length, 
        totalPrevStock: 0, 
        totalInbound: 0, 
        totalUsed: sfUsageItems.reduce((sum, sf) => sum + sf.used_qty, 0),
        totalAdjustment: 0, 
        totalCurrentStock: 0,
        errorCount: 0
      },
      errors: []
    };
    
    // 4. 당일 입고 현황 (참고용 - 원천은 transactions)
    const inboundData = await c.env.DB.prepare(`
      SELECT i.item_code, 
             COALESCE(m.item_name, i.item_code) as item_name, 
             SUM(i.origin_qty) as total_inbound, 
             COALESCE(m.unit, 'kg') as unit
      FROM inbound i
      LEFT JOIN master m ON i.item_code = m.item_code
      WHERE i.inbound_date = ?
        AND i.item_code NOT IN (${excludeClause})
      GROUP BY i.item_code
      ORDER BY total_inbound DESC
    `).bind(date, ...EXCLUDE_CODES).all<any>();
    
    // 5. 채널별 집계 - 구글시트 데이터 기반
    const channelSummary: Record<string, { count: number, quantity: number }> = {};
    for (const p of productionItems) {
      const ch = p.channel || '기타';
      if (!channelSummary[ch]) channelSummary[ch] = { count: 0, quantity: 0 };
      channelSummary[ch].count++;
      channelSummary[ch].quantity += p.quantity || 0;
    }
    
    // 6. 요약 계산
    const totalProducts = productionItems.length;
    const totalQuantity = productionItems.reduce((sum: number, p: any) => sum + (p.quantity || 0), 0);
    
    // ★★★ v3.5.10: 일반 원료(SF 제외) + 반제품(SF) 합산 ★★★
    // stockReport에서 SF 코드 제외 (sfReport에서 BOM 기반으로 계산)
    const rawMaterialItems = stockReport.items.filter(i => !i.itemCode.startsWith('SF'));
    
    const allMaterials = [
      ...rawMaterialItems.map(i => ({ ...i, type: '원료' })),
      ...sfReport.items.map(i => ({ ...i, type: '반제품' }))
    ];
    
    // 수불부 형식으로 변환 (기존 API 호환)
    const usageWithIntegrity = allMaterials.map(item => ({
      item_code: item.itemCode,
      item_name: item.itemName,
      unit: item.unit,
      total_used: item.usedQty,
      lot_numbers: item.lotNumbers || '',
      current_stock: item.currentStock,
      inbound_qty: item.inboundQty,
      prev_stock: item.prevStock,
      adjustment: item.adjustmentQty,
      calculated_stock: item.prevStock + item.inboundQty - item.usedQty + item.adjustmentQty,
      integrity_valid: item.isValid,
      integrity_diff: item.difference,
      type: (item as any).type
    }));
    
    return c.json({
      success: true,
      version: 'v3.6.47',
      date,
      production: {
        items: productionItems,
        summary: { 
          total_products: totalProducts, 
          total_quantity: totalQuantity, 
          by_channel: channelSummary 
        }
      },
      materials: {
        usage: usageWithIntegrity,
        inbound: inboundData.results || [],
        summary: { 
          total_types: allMaterials.length, 
          total_used_kg: stockReport.summary.totalUsed + sfReport.summary.totalUsed,
          total_prev_stock: stockReport.summary.totalPrevStock + sfReport.summary.totalPrevStock,
          total_inbound: stockReport.summary.totalInbound + sfReport.summary.totalInbound,
          total_current_stock: stockReport.summary.totalCurrentStock + sfReport.summary.totalCurrentStock,
          integrity_errors: stockReport.summary.errorCount + sfReport.summary.errorCount,
          integrity_status: (stockReport.summary.errorCount + sfReport.summary.errorCount) === 0 ? 'VALID' : 'INVALID'
        }
      },
      integrity: {
        status: (stockReport.summary.errorCount + sfReport.summary.errorCount) === 0 ? 'PASS' : 'FAIL',
        error_count: stockReport.summary.errorCount + sfReport.summary.errorCount,
        errors: [
          ...stockReport.errors.map(e => ({ ...e, type: '원료' })),
          ...sfReport.errors.map(e => ({ ...e, type: '반제품' }))
        ]
      },
      // 추가 메타데이터
      metadata: {
        production_source: 'google_sheets',
        material_source: 'transactions_table',
        calculation_method: 'time_series_accumulation',
        note: '생산데이터=구글시트 생산실적, 수불부=D1 transactions 테이블'
      }
    });
    
  } catch (error: any) {
    console.error('[closing-status/v3.6.47] ERROR:', error);
    return c.json({ success: false, error: `ERROR: ${error.message}`, errorCode: 'CLOSING_STATUS_ERROR' }, 500);
  }
});

// ★★★ v3.5.0: 정합성 체크 API (Sanity Check) ★★★
// Master.current_stock vs Transactions SUM 비교
// IMPORTANT: 이 라우트는 /:id 보다 먼저 정의되어야 함
productionRoutes.get('/integrity-check', async (c) => {
  try {
    const result = await checkInventoryIntegrity(c.env.DB);
    
    return c.json({
      success: true,
      version: 'v3.5.0',
      ...result
    });
    
  } catch (error: any) {
    console.error('[integrity-check] Error:', error);
    return c.json({ 
      success: false, 
      error: error.message,
      errorCode: 'INTEGRITY_CHECK_ERROR'
    }, 500);
  }
});

// ★★★ v3.5.0: 품목별 트랜잭션 이력 조회 (디버깅/감사용) ★★★
// IMPORTANT: 이 라우트는 /:id 보다 먼저 정의되어야 함
productionRoutes.get('/transaction-history/:itemCode', async (c) => {
  try {
    const itemCode = decodeURIComponent(c.req.param('itemCode'));
    const startDate = c.req.query('start_date');
    const endDate = c.req.query('end_date');
    const limit = parseInt(c.req.query('limit') || '100');
    
    const history = await getItemTransactionHistory(c.env.DB, itemCode, startDate, endDate, limit);
    
    // 현재 재고 상태
    const masterStock = await c.env.DB.prepare(`
      SELECT current_stock FROM master WHERE item_code = ?
    `).bind(itemCode).first<{ current_stock: number }>();
    
    const inboundSum = await c.env.DB.prepare(`
      SELECT SUM(remain_qty) as total FROM inbound WHERE item_code = ?
    `).bind(itemCode).first<{ total: number }>();
    
    const transactionSum = await c.env.DB.prepare(`
      SELECT SUM(quantity) as total FROM transactions WHERE item_code = ?
    `).bind(itemCode).first<{ total: number }>();
    
    return c.json({
      success: true,
      itemCode,
      currentStatus: {
        masterStock: masterStock?.current_stock || 0,
        inboundRemainSum: inboundSum?.total || 0,
        transactionSum: transactionSum?.total || 0
      },
      history,
      historyCount: history.length
    });
    
  } catch (error: any) {
    console.error('[transaction-history] Error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.5.3: 로트 누락 데이터 모니터링 API ★★★
// v3.5.4: Cut-off date 적용 - 2026-06-23 이전은 레거시 데이터로 분류
// 로트 번호가 없는 트랜잭션을 감지하여 무결성 확인
const LOT_ENFORCEMENT_DATE = '2026-06-23'; // v3.5.3 로트 검증 강화 적용일

productionRoutes.get('/lot-integrity-check', async (c) => {
  try {
    const { days = '30', trans_type, include_legacy = 'false' } = c.req.query();
    const daysNum = parseInt(days) || 30;
    const showLegacy = include_legacy === 'true';
    
    // 최근 N일 기준 날짜 계산
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);
    let startDateStr = startDate.toISOString().split('T')[0];
    
    // ★ Cut-off: 레거시 데이터 제외 시 LOT_ENFORCEMENT_DATE 이후만 검사
    const effectiveStartDate = showLegacy 
      ? startDateStr 
      : (startDateStr < LOT_ENFORCEMENT_DATE ? LOT_ENFORCEMENT_DATE : startDateStr);
    
    // 1. 로트 번호 누락된 '사용' 트랜잭션 조회 (LOT_ENFORCEMENT_DATE 이후만)
    let usageQuery = `
      SELECT 
        id, item_code, trans_type, quantity, trans_date, lot_number, memo, created_at
      FROM transactions
      WHERE (lot_number IS NULL OR lot_number = '')
        AND trans_date >= ?
    `;
    const usageParams: any[] = [effectiveStartDate];
    
    if (trans_type) {
      usageQuery += ` AND trans_type = ?`;
      usageParams.push(trans_type);
    }
    
    usageQuery += ` ORDER BY trans_date DESC, id DESC LIMIT 100`;
    
    const missingLotTransactions = await c.env.DB.prepare(usageQuery)
      .bind(...usageParams)
      .all<{
        id: number;
        item_code: string;
        trans_type: string;
        quantity: number;
        trans_date: string;
        lot_number: string | null;
        memo: string | null;
        created_at: string;
      }>();
    
    // 2. 트랜잭션 유형별 통계 (새 데이터 기준)
    const statsQuery = `
      SELECT 
        trans_type,
        COUNT(*) as total_count,
        SUM(CASE WHEN lot_number IS NULL OR lot_number = '' THEN 1 ELSE 0 END) as missing_lot_count,
        SUM(CASE WHEN lot_number IS NOT NULL AND lot_number != '' THEN 1 ELSE 0 END) as with_lot_count
      FROM transactions
      WHERE trans_date >= ?
      GROUP BY trans_type
      ORDER BY total_count DESC
    `;
    
    const stats = await c.env.DB.prepare(statsQuery)
      .bind(effectiveStartDate)
      .all<{
        trans_type: string;
        total_count: number;
        missing_lot_count: number;
        with_lot_count: number;
      }>();
    
    // 3. 레거시 데이터 통계 (별도 집계)
    const legacyStatsQuery = `
      SELECT 
        trans_type,
        COUNT(*) as total_count,
        SUM(CASE WHEN lot_number IS NULL OR lot_number = '' THEN 1 ELSE 0 END) as missing_lot_count
      FROM transactions
      WHERE trans_date < ?
      GROUP BY trans_type
    `;
    
    const legacyStats = await c.env.DB.prepare(legacyStatsQuery)
      .bind(LOT_ENFORCEMENT_DATE)
      .all<{
        trans_type: string;
        total_count: number;
        missing_lot_count: number;
      }>();
    
    // 4. 품목별 로트 누락 현황 (새 데이터만)
    const byItemQuery = `
      SELECT 
        t.item_code,
        COALESCE(m.item_name, t.item_code) as item_name,
        COUNT(*) as missing_count,
        SUM(ABS(t.quantity)) as total_qty
      FROM transactions t
      LEFT JOIN master m ON t.item_code = m.item_code
      WHERE (t.lot_number IS NULL OR t.lot_number = '')
        AND t.trans_date >= ?
        AND t.trans_type = '사용'
      GROUP BY t.item_code
      ORDER BY missing_count DESC
      LIMIT 20
    `;
    
    const byItem = await c.env.DB.prepare(byItemQuery)
      .bind(effectiveStartDate)
      .all<{
        item_code: string;
        item_name: string;
        missing_count: number;
        total_qty: number;
      }>();
    
    // 5. 전체 무결성 상태 판정 (새 데이터 기준으로만 판정)
    const totalMissing = (stats.results || [])
      .filter(s => s.trans_type === '사용')
      .reduce((sum, s) => sum + (s.missing_lot_count || 0), 0);
    
    // 레거시 데이터 누락 합계
    const legacyMissing = (legacyStats.results || [])
      .filter(s => s.trans_type === '사용')
      .reduce((sum, s) => sum + (s.missing_lot_count || 0), 0);
    
    // ★ 새 데이터 기준으로만 상태 판정 (레거시 데이터는 무시)
    const status = totalMissing === 0 ? 'PASS' : totalMissing < 10 ? 'WARNING' : 'FAIL';
    
    return c.json({
      success: true,
      version: 'v3.5.4',
      status,
      enforcement: {
        cutoffDate: LOT_ENFORCEMENT_DATE,
        description: '이 날짜 이후의 트랜잭션만 무결성 검사 대상',
        includeLegacy: showLegacy
      },
      period: {
        requested: { start: startDateStr, days: daysNum },
        effective: { start: effectiveStartDate, end: new Date().toISOString().split('T')[0] }
      },
      summary: {
        newDataMissingLot: totalMissing,
        legacyDataMissingLot: legacyMissing,
        message: totalMissing === 0 
          ? `✅ ${LOT_ENFORCEMENT_DATE} 이후 모든 사용 트랜잭션에 로트 번호가 정상 기록되어 있습니다.`
          : `⚠️ ${LOT_ENFORCEMENT_DATE} 이후 ${totalMissing}건의 사용 트랜잭션에 로트 번호가 누락되어 있습니다.`,
        legacyNote: legacyMissing > 0 
          ? `ℹ️ 레거시 데이터(${LOT_ENFORCEMENT_DATE} 이전): ${legacyMissing}건 로트 누락 (정상 - 시스템 적용 전 데이터)`
          : null
      },
      statsByType: stats.results || [],
      legacyStatsByType: legacyStats.results || [],
      missingLotByItem: byItem.results || [],
      recentMissingTransactions: (missingLotTransactions.results || []).slice(0, 20).map(t => ({
        id: t.id,
        itemCode: t.item_code,
        transType: t.trans_type,
        quantity: t.quantity,
        transDate: t.trans_date,
        isLegacy: t.trans_date < LOT_ENFORCEMENT_DATE,
        dataCategory: t.trans_date < LOT_ENFORCEMENT_DATE ? 'LEGACY' : 'NEW',
        memo: t.memo,
        createdAt: t.created_at
      }))
    });
    
  } catch (error: any) {
    console.error('[lot-integrity-check] Error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.5.0: transactions 테이블 백필 API ★★★
// 생산 기록 기반으로 누락된 transactions 데이터 복구
productionRoutes.post('/backfill-transactions', async (c) => {
  try {
    const { item_code, start_date, end_date, dry_run = true } = await c.req.json<{
      item_code?: string;
      start_date?: string;
      end_date?: string;
      dry_run?: boolean;
    }>();
    
    // 날짜 범위 설정 (기본: 최근 30일)
    const endDate = end_date || new Date().toISOString().split('T')[0];
    const startDate = start_date || (() => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return d.toISOString().split('T')[0];
    })();
    
    console.log(`[backfill-transactions] Range: ${startDate} ~ ${endDate}, item_code: ${item_code || 'ALL'}, dry_run: ${dry_run}`);
    
    // 1. 해당 기간의 생산 기록 조회
    let productionQuery = `
      SELECT id, product_code, quantity, prod_date, lot_number
      FROM production 
      WHERE prod_date BETWEEN ? AND ?
    `;
    const productionParams: any[] = [startDate, endDate];
    
    const productionResult = await c.env.DB.prepare(productionQuery).bind(...productionParams).all();
    const productions = productionResult.results || [];
    
    if (productions.length === 0) {
      return c.json({
        success: true,
        dry_run,
        message: `${startDate} ~ ${endDate} 기간에 생산 기록이 없습니다.`,
        backfill_candidates: []
      });
    }
    
    // 2. 제품별 BOM 조회
    const productCodes = [...new Set((productions as any[]).map(p => p.product_code))];
    const BATCH_SIZE = 50;
    let bomData: any[] = [];
    
    for (let i = 0; i < productCodes.length; i += BATCH_SIZE) {
      const batch = productCodes.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => '?').join(',');
      const bomResult = await c.env.DB.prepare(`
        SELECT production_code, material_code, material_name, quantity as bom_qty
        FROM production_bom 
        WHERE production_code IN (${placeholders})
      `).bind(...batch).all();
      bomData = bomData.concat(bomResult.results || []);
    }
    
    // 제품별 BOM 맵
    const bomMap = new Map<string, any[]>();
    for (const bom of bomData as any[]) {
      if (!bomMap.has(bom.production_code)) {
        bomMap.set(bom.production_code, []);
      }
      bomMap.get(bom.production_code)!.push(bom);
    }
    
    // 3. 날짜+품목별 사용량 집계
    type UsageKey = string; // "YYYY-MM-DD|item_code"
    const usageMap = new Map<UsageKey, {
      trans_date: string;
      item_code: string;
      item_name: string;
      quantity: number;
      lot_numbers: Set<string>;
    }>();
    
    for (const prod of productions as any[]) {
      const boms = bomMap.get(prod.product_code) || [];
      for (const bom of boms) {
        // 특정 품목 필터링
        if (item_code && bom.material_code !== item_code) continue;
        
        const usedQty = bom.bom_qty * prod.quantity;
        const key = `${prod.prod_date}|${bom.material_code}`;
        
        if (usageMap.has(key)) {
          const entry = usageMap.get(key)!;
          entry.quantity += usedQty;
          if (prod.lot_number) entry.lot_numbers.add(prod.lot_number);
        } else {
          usageMap.set(key, {
            trans_date: prod.prod_date,
            item_code: bom.material_code,
            item_name: bom.material_name,
            quantity: usedQty,
            lot_numbers: new Set(prod.lot_number ? [prod.lot_number] : [])
          });
        }
      }
    }
    
    // 4. 기존 transactions 확인 (이미 있는 데이터 제외)
    const candidates: any[] = [];
    const alreadyExists: any[] = [];
    
    for (const [key, usage] of usageMap) {
      // 해당 날짜+품목의 USAGE 트랜잭션이 있는지 확인
      const existing = await c.env.DB.prepare(`
        SELECT SUM(quantity) as total_qty
        FROM transactions
        WHERE item_code = ? AND trans_date = ? AND trans_type = 'USAGE'
      `).bind(usage.item_code, usage.trans_date).first<any>();
      
      const existingQty = existing?.total_qty || 0;
      // ★ USAGE는 음수여야 함. 계산된 사용량과 절대값 비교
      const expectedQty = -Math.abs(usage.quantity);  // 음수
      const diff = Math.abs(expectedQty - existingQty);
      
      if (diff > 0.001) { // 차이가 있으면 백필 대상
        candidates.push({
          trans_date: usage.trans_date,
          item_code: usage.item_code,
          item_name: usage.item_name,
          calculated_usage: usage.quantity,
          expected_qty: expectedQty,
          existing_usage: existingQty,
          difference: expectedQty - existingQty,
          lot_numbers: Array.from(usage.lot_numbers).join(',')
        });
      } else {
        alreadyExists.push({
          trans_date: usage.trans_date,
          item_code: usage.item_code,
          quantity: existingQty
        });
      }
    }
    
    // 5. dry_run이면 여기서 반환
    if (dry_run) {
      return c.json({
        success: true,
        dry_run: true,
        period: { start: startDate, end: endDate },
        filter_item_code: item_code || null,
        productions_count: productions.length,
        products_with_bom: bomMap.size,
        backfill_candidates: candidates.length,
        already_correct: alreadyExists.length,
        samples: candidates.slice(0, 20)
      });
    }
    
    // 6. 실제 백필 실행
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    let insertCount = 0;
    let errorCount = 0;
    const errors: any[] = [];
    
    for (const candidate of candidates) {
      try {
        // 기존 USAGE 트랜잭션 삭제 (해당 날짜+품목)
        await c.env.DB.prepare(`
          DELETE FROM transactions
          WHERE item_code = ? AND trans_date = ? AND trans_type = 'USAGE'
        `).bind(candidate.item_code, candidate.trans_date).run();
        
        // 새 트랜잭션 INSERT (USAGE는 음수로 저장)
        await c.env.DB.prepare(`
          INSERT INTO transactions (item_code, trans_type, quantity, trans_date, lot_number, memo, created_at)
          VALUES (?, 'USAGE', ?, ?, ?, ?, ?)
        `).bind(
          candidate.item_code,
          -Math.abs(candidate.calculated_usage),  // ★ USAGE는 음수
          candidate.trans_date,
          candidate.lot_numbers || null,
          '백필 복구 (v3.5.0)',
          now
        ).run();
        
        insertCount++;
      } catch (e: any) {
        errorCount++;
        errors.push({ item_code: candidate.item_code, date: candidate.trans_date, error: e.message });
      }
    }
    
    return c.json({
      success: true,
      dry_run: false,
      period: { start: startDate, end: endDate },
      filter_item_code: item_code || null,
      total_candidates: candidates.length,
      inserted: insertCount,
      errors: errorCount,
      error_details: errors.slice(0, 10)
    });
    
  } catch (error: any) {
    console.error('[backfill-transactions] Error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ 잘못된 백필 데이터 삭제 API ★★★
// 양수 USAGE 트랜잭션 삭제 (잘못된 백필 데이터)
productionRoutes.delete('/cleanup-invalid-backfill', async (c) => {
  try {
    const { item_code, dry_run = true } = await c.req.json<{
      item_code?: string;
      dry_run?: boolean;
    }>();
    
    // 양수 USAGE 트랜잭션 조회 (잘못된 데이터)
    let query = `
      SELECT id, item_code, trans_date, quantity, memo
      FROM transactions
      WHERE trans_type = 'USAGE' AND quantity > 0
    `;
    const params: any[] = [];
    
    if (item_code) {
      query += ` AND item_code = ?`;
      params.push(item_code);
    }
    
    const invalidData = await c.env.DB.prepare(query).bind(...params).all();
    const invalidRecords = invalidData.results || [];
    
    if (dry_run) {
      return c.json({
        success: true,
        dry_run: true,
        invalid_count: invalidRecords.length,
        samples: (invalidRecords as any[]).slice(0, 20).map(r => ({
          id: r.id,
          item_code: r.item_code,
          trans_date: r.trans_date,
          quantity: r.quantity,
          memo: r.memo
        }))
      });
    }
    
    // 삭제 실행
    let deleteQuery = `
      DELETE FROM transactions
      WHERE trans_type = 'USAGE' AND quantity > 0
    `;
    if (item_code) {
      deleteQuery += ` AND item_code = ?`;
      await c.env.DB.prepare(deleteQuery).bind(item_code).run();
    } else {
      await c.env.DB.prepare(deleteQuery).run();
    }
    
    return c.json({
      success: true,
      dry_run: false,
      deleted_count: invalidRecords.length,
      message: `${invalidRecords.length}건의 잘못된 백필 데이터 삭제 완료`
    });
    
  } catch (error: any) {
    console.error('[cleanup-invalid-backfill] Error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.5.1: 재고 정합성 일괄 보정 API ★★★
// master.current_stock을 기준으로 transactions 합계를 맞추는 조정 트랜잭션 생성
productionRoutes.post('/inventory-adjustment', async (c) => {
  try {
    const { 
      dry_run = true, 
      item_codes,
      reason = 'v3.5.1 시스템 오픈 시점 재고 보정'
    } = await c.req.json<{
      dry_run?: boolean;
      item_codes?: string[];
      reason?: string;
    }>();
    
    console.log(`[inventory-adjustment] dry_run: ${dry_run}, item_codes: ${item_codes?.join(',') || 'ALL'}`);
    
    const result = await bulkAdjustInventory(c.env.DB, {
      dryRun: dry_run,
      reason,
      itemCodes: item_codes
    });
    
    // 결과 요약
    const summary = {
      totalAdjustmentQty: result.results.reduce((sum, r) => sum + Math.abs(r.adjustmentQty), 0),
      positiveAdjustments: result.results.filter(r => r.adjustmentQty > 0).length,
      negativeAdjustments: result.results.filter(r => r.adjustmentQty < 0).length,
      topAdjustments: result.results
        .sort((a, b) => Math.abs(b.adjustmentQty) - Math.abs(a.adjustmentQty))
        .slice(0, 20)
        .map(r => ({
          itemCode: r.itemCode,
          before: r.beforeTransactionSum.toFixed(4),
          adjustment: r.adjustmentQty.toFixed(4),
          after: r.afterTransactionSum.toFixed(4)
        }))
    };
    
    return c.json({
      success: result.success,
      version: 'v3.5.1',
      dry_run,
      message: dry_run 
        ? `${result.totalItems}개 품목 보정 예정 (dry_run 모드)` 
        : `${result.successCount}개 품목 보정 완료, ${result.failCount}개 실패`,
      executedAt: result.executedAt,
      totalItems: result.totalItems,
      successCount: result.successCount,
      failCount: result.failCount,
      summary,
      // dry_run일 때만 전체 결과 반환
      results: dry_run ? result.results : undefined
    });
    
  } catch (error: any) {
    console.error('[inventory-adjustment] Error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.5.1: 단일 품목 재고 조정 API ★★★
productionRoutes.post('/inventory-adjustment/:itemCode', async (c) => {
  try {
    const itemCode = c.req.param('itemCode');
    const { 
      target_stock,
      reason = '수동 재고 조정'
    } = await c.req.json<{
      target_stock: number;
      reason?: string;
    }>();
    
    if (typeof target_stock !== 'number') {
      return c.json({ success: false, error: 'target_stock은 필수입니다.' }, 400);
    }
    
    // 품목 정보 조회
    const item = await c.env.DB.prepare(`
      SELECT item_code, item_name, current_stock FROM master WHERE item_code = ?
    `).bind(itemCode).first<{ item_code: string; item_name: string; current_stock: number }>();
    
    if (!item) {
      return c.json({ success: false, error: '품목을 찾을 수 없습니다.' }, 404);
    }
    
    const result = await adjustInventory(c.env.DB, {
      itemCode: item.item_code,
      itemName: item.item_name,
      currentMasterStock: Number(item.current_stock) || 0,
      targetStock: target_stock,
      adjustmentQty: 0,  // 함수 내에서 계산됨
      reason
    });
    
    return c.json({
      success: result.success,
      version: 'v3.5.1',
      itemCode: result.itemCode,
      before: result.beforeTransactionSum,
      adjustment: result.adjustmentQty,
      after: result.afterTransactionSum,
      transactionId: result.transactionId,
      error: result.error
    });
    
  } catch (error: any) {
    console.error('[inventory-adjustment/:itemCode] Error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 생산 상세 조회 (사용 원재료 포함)
productionRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  
  // 생산 정보
  const production = await c.env.DB.prepare(`
    SELECT p.*, 
           m.item_name as product_name,
           m.unit as product_unit
    FROM production p
    LEFT JOIN master m ON p.product_code = m.item_code
    WHERE p.id = ?
  `).bind(id).first();
  
  if (!production) {
    return c.json({ success: false, error: '생산 기록을 찾을 수 없습니다.' }, 404);
  }
  
  // 사용된 원재료 목록 조회
  const materialsRaw = await c.env.DB.prepare(`
    SELECT pm.* FROM production_materials pm
    WHERE pm.production_id = ?
    ORDER BY pm.id
  `).bind(id).all<any>();
  
  // 각 원재료에 대해 마스터 정보 조회 (RM/R 코드 자동 매칭)
  const materials: any[] = [];
  for (const pm of materialsRaw.results || []) {
    let master = await c.env.DB.prepare(`
      SELECT item_name, unit FROM master WHERE item_code = ?
    `).bind(pm.item_code).first<any>();
    
    // 매칭되지 않으면 변환된 코드로 시도
    if (!master) {
      let altCode = '';
      if (pm.item_code.startsWith('RM')) {
        altCode = 'R' + pm.item_code.substring(2);
      } else if (pm.item_code.startsWith('R') && !pm.item_code.startsWith('RM')) {
        altCode = 'RM' + pm.item_code.substring(1);
      }
      if (altCode) {
        master = await c.env.DB.prepare(`
          SELECT item_name, unit FROM master WHERE item_code = ?
        `).bind(altCode).first<any>();
      }
    }
    
    materials.push({
      ...pm,
      item_name: master?.item_name || null,
      item_unit: master?.unit || pm.unit
    });
  }
  
  return c.json({ 
    success: true, 
    data: {
      ...production,
      materials
    }
  });
});

// LOT 수량 수정 (관련 테이블 모두 업데이트)
productionRoutes.put('/lot/:lotNumber', async (c) => {
  const lotNumber = decodeURIComponent(c.req.param('lotNumber'));
  const { quantity, remain_qty } = await c.req.json();
  
  if (!quantity || quantity <= 0) {
    return c.json({ success: false, error: '유효한 수량을 입력하세요' }, 400);
  }
  
  // 기존 생산 기록 조회
  const production = await c.env.DB.prepare(`
    SELECT * FROM production WHERE lot_number = ?
  `).bind(lotNumber).first<any>();
  
  if (!production) {
    return c.json({ success: false, error: '해당 LOT를 찾을 수 없습니다' }, 404);
  }
  
  const oldQuantity = production.quantity;
  
  try {
    // 1. production 테이블 수량 수정
    await c.env.DB.prepare(`
      UPDATE production SET quantity = ? WHERE lot_number = ?
    `).bind(quantity, lotNumber).run();
    
    // 2. production_inbound 수정 (origin_qty, remain_qty 별도 지정 가능)
    try {
      if (remain_qty !== undefined) {
        await c.env.DB.prepare(`
          UPDATE production_inbound 
          SET origin_qty = ?, remain_qty = ?
          WHERE lot_number = ? AND production_code = ?
        `).bind(quantity, remain_qty, lotNumber, production.product_code).run();
      } else {
        await c.env.DB.prepare(`
          UPDATE production_inbound 
          SET origin_qty = ?
          WHERE lot_number = ? AND production_code = ?
        `).bind(quantity, lotNumber, production.product_code).run();
      }
    } catch (e) {
      console.log('production_inbound 업데이트 스킵:', e);
    }
    
    // 3. production_transactions 수량 수정 (생산입고, 출고)
    try {
      await c.env.DB.prepare(`
        UPDATE production_transactions 
        SET quantity = ?
        WHERE lot_number = ? AND production_code = ?
      `).bind(quantity, lotNumber, production.product_code).run();
    } catch (e) {
      console.log('production_transactions 업데이트 스킵:', e);
    }
    
    // 4. production_daily_items 수량은 수정하지 않음 (PDF 원본 수량 유지)
    // 생산일보 수량과 LOT 수량은 별개
    
    return c.json({ 
      success: true, 
      message: `LOT ${lotNumber} 수량이 ${oldQuantity} → ${quantity}로 변경되었습니다`,
      data: { lot_number: lotNumber, old_quantity: oldQuantity, new_quantity: quantity }
    });
    
  } catch (error: any) {
    console.error('LOT 수량 수정 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 생산 원료 LOT 수정
productionRoutes.put('/lot/:lotNumber/material', async (c) => {
  const lotNumber = decodeURIComponent(c.req.param('lotNumber'));
  const { item_code, new_lot_number } = await c.req.json();
  
  if (!item_code || !new_lot_number) {
    return c.json({ success: false, error: '원료코드와 새 LOT번호를 입력하세요' }, 400);
  }
  
  // 생산 기록 조회
  const production = await c.env.DB.prepare(`
    SELECT id FROM production WHERE lot_number = ?
  `).bind(lotNumber).first<any>();
  
  if (!production) {
    return c.json({ success: false, error: '해당 LOT를 찾을 수 없습니다' }, 404);
  }
  
  // 원료 LOT 수정
  const result = await c.env.DB.prepare(`
    UPDATE production_materials 
    SET lot_number = ?
    WHERE production_id = ? AND item_code = ?
  `).bind(new_lot_number, production.id, item_code).run();
  
  return c.json({ 
    success: true, 
    message: `원료 ${item_code} LOT가 ${new_lot_number}로 변경되었습니다`,
    changes: result.meta.changes
  });
});

// 생산 원료 삭제
productionRoutes.delete('/lot/:lotNumber/material/:itemCode', async (c) => {
  const lotNumber = decodeURIComponent(c.req.param('lotNumber'));
  const itemCode = decodeURIComponent(c.req.param('itemCode'));
  
  const production = await c.env.DB.prepare(`
    SELECT id FROM production WHERE lot_number = ?
  `).bind(lotNumber).first<any>();
  
  if (!production) {
    return c.json({ success: false, error: '해당 LOT를 찾을 수 없습니다' }, 404);
  }
  
  const result = await c.env.DB.prepare(`
    DELETE FROM production_materials 
    WHERE production_id = ? AND item_code = ?
  `).bind(production.id, itemCode).run();
  
  return c.json({ 
    success: true, 
    message: `원료 ${itemCode}가 삭제되었습니다`,
    changes: result.meta.changes
  });
});

// 생산 원료 추가
productionRoutes.post('/lot/:lotNumber/material', async (c) => {
  const lotNumber = decodeURIComponent(c.req.param('lotNumber'));
  const { item_code, quantity, unit, lot_number } = await c.req.json();
  
  if (!item_code || !quantity) {
    return c.json({ success: false, error: '원료코드와 수량은 필수입니다' }, 400);
  }
  
  const production = await c.env.DB.prepare(`
    SELECT id FROM production WHERE lot_number = ?
  `).bind(lotNumber).first<any>();
  
  if (!production) {
    return c.json({ success: false, error: '해당 LOT를 찾을 수 없습니다' }, 404);
  }
  
  const result = await c.env.DB.prepare(`
    INSERT INTO production_materials (production_id, item_code, lot_number, planned_qty, actual_qty, unit)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(production.id, item_code, lot_number || null, quantity, quantity, unit || 'g').run();
  
  return c.json({ 
    success: true, 
    message: `원료 ${item_code}가 추가되었습니다`
  });
});

// LOT 번호로 생산 조회 (이력추적용)
productionRoutes.get('/lot/:lotNumber', async (c) => {
  const lotNumber = decodeURIComponent(c.req.param('lotNumber'));
  
  // 생산 정보 조회
  const production = await c.env.DB.prepare(`
    SELECT p.*, 
           m.item_name as product_name,
           m.unit as product_unit
    FROM production p
    LEFT JOIN master m ON p.product_code = m.item_code
    WHERE p.lot_number = ?
  `).bind(lotNumber).first<any>();
  
  if (!production) {
    return c.json({ success: false, error: '해당 LOT의 생산 기록을 찾을 수 없습니다.' }, 404);
  }
  
  // 사용된 원재료 목록 조회
  const materialsRaw = await c.env.DB.prepare(`
    SELECT pm.* FROM production_materials pm
    WHERE pm.production_id = ?
    ORDER BY pm.id
  `).bind(production.id).all<any>();
  
  // 각 원재료에 대해 마스터 정보 및 입고 정보 조회
  const materials: any[] = [];
  for (const pm of materialsRaw.results || []) {
    let master = await c.env.DB.prepare(`
      SELECT item_name, unit FROM master WHERE item_code = ?
    `).bind(pm.item_code).first<any>();
    
    // 매칭되지 않으면 변환된 코드로 시도
    if (!master) {
      let altCode = '';
      if (pm.item_code.startsWith('RM')) {
        altCode = 'R' + pm.item_code.substring(2);
      } else if (pm.item_code.startsWith('R') && !pm.item_code.startsWith('RM')) {
        altCode = 'RM' + pm.item_code.substring(1);
      }
      if (altCode) {
        master = await c.env.DB.prepare(`
          SELECT item_name, unit FROM master WHERE item_code = ?
        `).bind(altCode).first<any>();
      }
    }
    
    // 원료 LOT의 입고 정보 조회 (거래처, 입고일, 유통기한)
    let inboundInfo = null;
    if (pm.lot_number) {
      inboundInfo = await c.env.DB.prepare(`
        SELECT supplier, inbound_date, expiry_date, origin_qty
        FROM inbound WHERE lot_number = ?
      `).bind(pm.lot_number).first<any>();
    }
    
    materials.push({
      ...pm,
      item_name: master?.item_name || null,
      item_unit: master?.unit || pm.unit,
      supplier: inboundInfo?.supplier || null,
      inbound_date: inboundInfo?.inbound_date || null,
      expiry_date: inboundInfo?.expiry_date || null
    });
  }
  
  return c.json({ 
    success: true, 
    data: {
      ...production,
      materials
    }
  });
});

// ★★★ v3.5.21: 기존 복잡한 생산 등록 API 비활성화 ★★★
// 이유: ERP에서 BOM 계산/재고 차감하면 구글시트와 데이터 불일치 발생
// 대안: /api/production/simple 또는 /api/sheets/add-production-simple 사용
productionRoutes.post('/', async (c) => {
  return c.json({
    success: false,
    error: '⚠️ 이 API는 비활성화되었습니다 (v3.5.21)',
    reason: 'ERP 계산 로직 완전 분리 - 계산은 구글 시트에서만 수행',
    alternative: {
      simple: 'POST /api/production/simple - 단순 생산 등록 (시트 전송만)',
      sheets: 'POST /api/sheets/add-production-simple - 시트 기반 생산 등록',
      batch: 'POST /api/production/simple-batch - 일괄 등록 (발주 기반)'
    },
    migration_guide: '프론트엔드에서 /api/production/simple API를 사용하세요'
  }, 410);  // 410 Gone - 더 이상 지원하지 않음

  /* ===== 아래는 기존 코드 (비활성화됨) =====
  const body = await c.req.json();
  const { prod_date, product_code, quantity, lot_number, memo, created_by, force_approve } = body;
  
  if (!prod_date || !product_code || !quantity) {
    return c.json({ success: false, error: '생산일, 제품, 수량은 필수입니다.' }, 400);
  }
  
  // ★ R169-R172 구형 코드 필터 (BOM에서 참조 시 제외)
  const EXCLUDE_CODES = ['R169', 'R170', 'R171', 'R172'];
  
  // 제품 확인
  const product = await c.env.DB.prepare(
    'SELECT * FROM master WHERE item_code = ? AND category = ?'
  ).bind(product_code, '제품').first<any>();
  
  if (!product) {
    return c.json({ success: false, error: '제품을 찾을 수 없습니다.' }, 404);
  }
  
  // BOM 조회 (RM코드와 R코드 모두 매칭)
  const bomResult = await c.env.DB.prepare(`
    SELECT b.*, 
           COALESCE(m1.item_name, m2.item_name) as item_name, 
           COALESCE(m1.current_stock, m2.current_stock, 0) as current_stock,
           COALESCE(m1.item_code, m2.item_code) as matched_item_code
    FROM bom b
    LEFT JOIN master m1 ON b.item_code = m1.item_code
    LEFT JOIN master m2 ON (
      (b.item_code LIKE 'RM%' AND m2.item_code = 'R' || SUBSTR(b.item_code, 3)) OR
      (b.item_code LIKE 'R%' AND b.item_code NOT LIKE 'RM%' AND m2.item_code = 'RM' || SUBSTR(b.item_code, 2))
    )
    WHERE b.product_code = ?
    ORDER BY b.sort_order
  `).bind(product_code).all<any>();
  
  // ★ R169-R172 구형 코드 필터링
  const bomItems = (bomResult.results || []).filter((bom: any) => {
    const code = (bom.item_code || '').toUpperCase();
    return !EXCLUDE_CODES.includes(code);
  });
  
  // ===== ★★★ v3.4.5: 재고 검증 강화 - 재고 0 품목 강제 차단 ★★★ =====
  const stockErrors: Array<{
    item_code: string;
    item_name: string;
    required_kg: number;
    available_kg: number;
    shortage_kg: number;
    reason: string;
  }> = [];
  const stockWarnings: string[] = [];
  const zeroStockItems: string[] = []; // 재고 0 품목 목록
  
  for (const bom of bomItems) {
    const actualItemCode = bom.matched_item_code || bom.item_code;
    const requiredQty = bom.quantity * quantity;
    const requiredKg = requiredQty; // BOM.quantity는 kg 단위
    
    // 정제수는 재고 확인 제외
    const itemName = bom.item_name || actualItemCode;
    const isWater = itemName.includes('정제수');
    
    if (!isWater) {
      // ★ LOT 기반 실시간 재고 확인 (Inbound remain_qty SUM)
      const stockCheck = await checkStockAvailability(c.env.DB, actualItemCode, requiredKg, prod_date);
      
      // ★★★ 재고 0 품목: 강제 차단 (유령 생산 방지) ★★★
      if (stockCheck.totalAvailable === 0) {
        zeroStockItems.push(itemName);
        stockErrors.push({
          item_code: actualItemCode,
          item_name: itemName,
          required_kg: requiredKg,
          available_kg: 0,
          shortage_kg: requiredKg,
          reason: '재고 데이터 없음 - 입고 등록 필요'
        });
      } else if (!stockCheck.available) {
        stockErrors.push({
          item_code: actualItemCode,
          item_name: itemName,
          required_kg: requiredKg,
          available_kg: stockCheck.totalAvailable,
          shortage_kg: stockCheck.shortage,
          reason: `재고 부족 (현재고 ${stockCheck.totalAvailable.toFixed(2)}kg, 필요량 ${requiredKg.toFixed(2)}kg)`
        });
      } else if (stockCheck.totalAvailable < requiredKg * 1.1) {
        stockWarnings.push(`${itemName}: 재고 여유 부족 (가용: ${stockCheck.totalAvailable.toFixed(2)}kg)`);
      }
    }
    
    bom.actualItemCode = actualItemCode;
  }
  
  // ===== ★★★ 재고 부족 시 생산 강제 차단 (상세 사유 포함) ★★★ =====
  if (stockErrors.length > 0 && !force_approve) {
    // 로그 기록 (추적용)
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [생산차단] 제품: ${product_code}, 사유: 재고 부족`);
    for (const err of stockErrors) {
      console.error(`  - ${err.item_name} (${err.item_code}): ${err.reason}`);
    }
    
    // ★ 상세 사유를 포함한 에러 응답
    return c.json({ 
      success: false, 
      error: '재고 부족으로 생산을 진행할 수 없습니다.',
      errorCode: 'INSUFFICIENT_STOCK',
      blocked_at: timestamp,
      product_code: product_code,
      zero_stock_count: zeroStockItems.length,
      details: stockErrors.map(err => ({
        item_code: err.item_code,
        item_name: err.item_name,
        required: `${err.required_kg.toFixed(2)}kg`,
        available: `${err.available_kg.toFixed(2)}kg`,
        shortage: `${err.shortage_kg.toFixed(2)}kg`,
        reason: err.reason
      })),
      message_for_user: stockErrors.map(err => 
        `⚠️ ${err.item_name}: 현재고 ${err.available_kg.toFixed(2)}kg, 필요량 ${err.required_kg.toFixed(2)}kg (${err.reason})`
      ).join('\n')
    }, 400);
  }
  
  // 강제 승인으로 진행하는 경우 경고 로그
  if (stockErrors.length > 0 && force_approve) {
    console.warn(`[생산등록] 강제 승인으로 진행 - ${product_code}, 재고부족 ${stockErrors.length}건`);
  }
  
  // 경고만 있는 경우 로깅
  if (stockWarnings.length > 0) {
    console.log(`[생산등록] 재고 경고 - ${product_code}: ${stockWarnings.join(', ')}`);
  }
  
  // 제품 LOT 자동 생성 (없으면)
  const productLot = lot_number || `PRD-${prod_date.replace(/-/g, '')}-${product_code}-${String(Date.now()).slice(-4)}`;
  
  try {
    // ===== Atomic Transaction: 모든 DB 작업을 batch()로 묶어서 실행 =====
    const batchStatements: D1PreparedStatement[] = [];
    const deductionRecords: Array<{itemCode: string; deductions: any[]}> = [];
    
    // 1. 생산 기록 등록 준비 (ID는 나중에 조회)
    batchStatements.push(
      c.env.DB.prepare(`
        INSERT INTO production (prod_date, product_code, quantity, lot_number, status, memo, created_by)
        VALUES (?, ?, ?, ?, '완료', ?, ?)
      `).bind(prod_date, product_code, quantity, productLot, memo || null, created_by || null)
    );
    
    // 2. BOM 기반 원재료 FEFO 차감 준비
    for (const bom of bomItems) {
      const requiredQty = bom.quantity * quantity;
      // v2.3.1: BOM 단위가 kg으로 통일됨 - 변환 로직 제거
    const requiredKg = requiredQty; // BOM.quantity는 이제 kg 단위
      const actualItemCode = bom.actualItemCode || bom.matched_item_code || bom.item_code;
      const itemName = bom.item_name || '';
      const isWater = itemName.includes('정제수');
      const isSemiFinished = actualItemCode.startsWith('SF');
      
      if (isWater) {
        // 정제수: 사용 기록만 (재고 차감 없음)
        batchStatements.push(
          c.env.DB.prepare(`
            INSERT INTO transactions (trans_date, item_code, trans_type, quantity, memo)
            VALUES (?, ?, '사용', ?, ?)
          `).bind(prod_date, actualItemCode, requiredKg, 
            `생산사용(재고미차감): ${product.item_name} ${quantity}개 - 정제수`)
        );
        continue;
      }
      
      // FEFO 차감 준비 (반제품 또는 원료)
      let deductResult;
      if (isSemiFinished) {
        deductResult = await prepareSemiFinishedDeduction(
          c.env.DB, actualItemCode, requiredKg, prod_date,
          `생산사용: ${product.item_name} ${quantity}개`
        );
      } else {
        deductResult = await prepareFEFODeduction(
          c.env.DB, actualItemCode, requiredKg, prod_date,
          `생산사용: ${product.item_name} ${quantity}개`
        );
      }
      
      if (!deductResult.success) {
        // 재고 부족 발생 - 전체 작업 중단
        return c.json({
          success: false,
          error: deductResult.error,
          errorCode: 'INSUFFICIENT_STOCK'
        }, 400);
      }
      
      // 차감 statements 추가
      batchStatements.push(...deductResult.statements);
      deductionRecords.push({ itemCode: actualItemCode, deductions: deductResult.deductions });
      
      // 마스터 재고 차감 (MAX(0, ...) 적용)
      if (!isSemiFinished) {
        batchStatements.push(prepareMasterDeduction(c.env.DB, actualItemCode, requiredKg));
      }
    }
    
    // 3. 제품 재고 증가
    batchStatements.push(prepareMasterIncrease(c.env.DB, product_code, quantity));
    
    // 4. 제품 입고 기록 (생산입고)
    batchStatements.push(
      c.env.DB.prepare(`
        INSERT INTO inbound (lot_number, item_code, inbound_date, expiry_date, origin_qty, remain_qty, quality_status, supplier)
        VALUES (?, ?, ?, date(?, '+' || ? || ' days'), ?, ?, '합격', '자체생산')
      `).bind(
        productLot,
        product_code,
        prod_date,
        prod_date,
        product.expiry_days || 30,
        quantity,
        quantity
      )
    );
    
    // 5. 거래 이력 (생산입고)
    batchStatements.push(
      c.env.DB.prepare(`
        INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, remain_qty, memo)
        VALUES (?, ?, '입고', ?, ?, ?, ?)
      `).bind(
        prod_date,
        product_code,
        quantity,
        productLot,
        quantity,
        `생산입고`
      )
    );
    
    // ===== Atomic 실행: batch()로 모든 작업 한 번에 실행 =====
    await c.env.DB.batch(batchStatements);
    
    // 6. 생산 ID 조회 (batch 실행 후)
    const prodRecord = await c.env.DB.prepare(
      'SELECT id FROM production WHERE lot_number = ? LIMIT 1'
    ).bind(productLot).first<{id: number}>();
    const productionId = prodRecord?.id || 0;
    
    // 7. production_materials 기록 (별도 batch - 선택적)
    const materialStatements: D1PreparedStatement[] = [];
    for (const bom of bomItems) {
      const requiredQty = bom.quantity * quantity;
      const actualItemCode = bom.actualItemCode || bom.matched_item_code || bom.item_code;
      const record = deductionRecords.find(r => r.itemCode === actualItemCode);
      const usedLots = record?.deductions.map(d => d.lot_number).join(', ') || null;
      
      materialStatements.push(
        c.env.DB.prepare(`
          INSERT INTO production_materials (production_id, item_code, lot_number, planned_qty, actual_qty, unit)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(productionId, actualItemCode, usedLots, requiredQty, requiredQty, bom.unit)
      );
    }
    if (materialStatements.length > 0) {
      await c.env.DB.batch(materialStatements);
    }
    
    return c.json({ 
      success: true, 
      message: stockWarnings.length > 0 
        ? `생산이 등록되었습니다. (재고 부족 경고: ${stockWarnings.length}건)`
        : '생산이 등록되었습니다.',
      data: {
        production_id: productionId,
        lot_number: productLot,
        materials_used: bomItems.length,
        stock_warnings: stockWarnings.length > 0 ? stockWarnings : undefined
      }
    });
    
  } catch (error: any) {
    console.error('Production error:', error);
    return c.json({ success: false, error: '생산 등록 중 오류가 발생했습니다.' }, 500);
  }
  ===== 기존 코드 끝 (비활성화됨) ===== */
});

// ★★★ v3.5.21: 기존 복잡한 일괄 등록 API 비활성화 ★★★
// 이유: ERP에서 BOM 계산/재고 차감하면 구글시트와 데이터 불일치 발생
// 대안: /api/production/simple-batch 사용
productionRoutes.post('/batch', async (c) => {
  return c.json({
    success: false,
    error: '⚠️ 이 API는 비활성화되었습니다 (v3.5.21)',
    reason: 'ERP 계산 로직 완전 분리 - 계산은 구글 시트에서만 수행',
    alternative: {
      simple_batch: 'POST /api/production/simple-batch - 단순 일괄 등록',
      sheets: 'POST /api/sheets/add-production-batch - 시트 기반 일괄 등록'
    }
  }, 410);

  /* ===== 아래는 기존 코드 (비활성화됨) =====
  try {
    const body = await c.req.json();
    const { items, prod_date, production_date, memo, channel: defaultChannel } = body;
    // items: [{ product_code, quantity, channel?, expiry_date?, barcode?, box_quantity? }]
    
    if (!items || items.length === 0) {
      return c.json({ success: false, error: '등록할 항목이 없습니다.' }, 400);
    }
    
    // 배치 크기 제한 (D1 batch() 사용으로 최적화됨)
    // batch()는 여러 쿼리를 단일 네트워크 요청으로 처리
    // D1의 batch() 성능 개선으로 170개까지 처리 가능
    const MAX_BATCH_SIZE = 170;
    if (items.length > MAX_BATCH_SIZE) {
      return c.json({ 
        success: false, 
        error: `한 번에 최대 ${MAX_BATCH_SIZE}개까지만 등록할 수 있습니다. (요청: ${items.length}개)`,
        max_batch_size: MAX_BATCH_SIZE,
        requested_count: items.length
      }, 400);
    }
    
    // prod_date 또는 production_date 둘 다 지원
    const productionDate = prod_date || production_date || new Date().toISOString().split('T')[0];
  
  // 중복 등록 방지: 해당 날짜+채널에 이미 등록된 제품 확인
  // 채널별로 별도 등록 가능 (쿠팡, 오아시스 등 다른 채널이면 허용)
  // SQLite는 바인딩 변수가 최대 999개이므로 배치로 나눠서 조회
  const productCodes = items.map((i: any) => i.product_code);
  const existingSet = new Set<string>(); // "product_code|channel" 형태로 저장
  
  const QUERY_BATCH_SIZE = 50; // 안전하게 50개씩 배치 처리
  for (let i = 0; i < productCodes.length; i += QUERY_BATCH_SIZE) {
    const batch = productCodes.slice(i, i + QUERY_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const existingProductions = await c.env.DB.prepare(`
      SELECT product_code, channel FROM production 
      WHERE prod_date = ? AND product_code IN (${placeholders})
    `).bind(productionDate, ...batch).all<any>();
    
    for (const p of existingProductions.results || []) {
      // 채널 정규화: oasis_paste → 오아시스, 쿠팡 → 쿠팡 등
      const normalizedChannel = (p.channel || 'unknown').toLowerCase().replace('_paste', '');
      existingSet.add(`${p.product_code}|${normalizedChannel}`);
    }
  }
  
  // 이미 등록된 제품 필터링 (동일 채널만 필터)
  const newItems = items.filter((i: any) => {
    const itemChannel = (i.channel || defaultChannel || 'unknown').toLowerCase().replace('_paste', '');
    return !existingSet.has(`${i.product_code}|${itemChannel}`);
  });
  
  if (newItems.length === 0) {
    // ★ 모든 품목이 이미 등록된 경우에도 생산일보 LOT 업데이트 수행
    try {
      const skippedCodes = items.map((i: any) => i.product_code);
      const uniqueSkippedCodes = [...new Set(skippedCodes)];
      
      if (uniqueSkippedCodes.length > 0) {
        // 기존 LOT 조회
        const lotByCode = new Map<string, string>();
        const QUERY_BATCH = 50;
        for (let i = 0; i < uniqueSkippedCodes.length; i += QUERY_BATCH) {
          const batch = uniqueSkippedCodes.slice(i, i + QUERY_BATCH);
          const placeholders = batch.map(() => '?').join(',');
          const existingLots = await c.env.DB.prepare(`
            SELECT product_code, lot_number FROM production 
            WHERE prod_date = ? AND product_code IN (${placeholders})
            ORDER BY id DESC
          `).bind(productionDate, ...batch).all<{product_code: string, lot_number: string}>();
          
          for (const row of existingLots.results || []) {
            if (!lotByCode.has(row.product_code)) {
              lotByCode.set(row.product_code, row.lot_number);
            }
          }
        }
        
        // 생산일보 LOT 업데이트
        const productCodes = Array.from(lotByCode.keys());
        const BATCH_SIZE = 10;
        for (let i = 0; i < productCodes.length; i += BATCH_SIZE) {
          const batch = productCodes.slice(i, i + BATCH_SIZE);
          const updates = batch.map(code => {
            const lotNumber = lotByCode.get(code)!;
            return c.env.DB.prepare(`
              UPDATE production_daily_items 
              SET lot_number = ?
              WHERE production_code = ?
                AND (lot_number IS NULL OR lot_number = '')
                AND report_id IN (
                  SELECT id FROM production_daily_report WHERE report_date = ?
                )
            `).bind(lotNumber, code, productionDate);
          });
          if (updates.length > 0) {
            await c.env.DB.batch(updates);
          }
        }
        console.log(`[production/batch] 스킵된 품목 LOT 업데이트: ${productCodes.length}개`);
      }
    } catch (e) {
      console.error('LOT update error for skipped items:', e);
    }
    
    return c.json({ 
      success: true, 
      message: `해당 날짜(${productionDate})와 채널에 모든 제품이 이미 등록되어 있습니다. (LOT 업데이트 완료)`,
      already_registered: items.length,
      data: { total: items.length, success: 0, fail: 0, skipped: items.length }
    });
  }
  
  const skippedCount = items.length - newItems.length;
  
  const results: any[] = [];
  let successCount = 0;
  let failCount = 0;
  
  // 새로 등록할 제품 코드들
  const newProductCodes = newItems.map((i: any) => i.product_code);
  
  // 새로 등록할 제품이 없으면 조기 반환
  if (newProductCodes.length === 0) {
    return c.json({ 
      success: true, 
      message: '모든 항목이 이미 등록되어 스킵되었습니다.',
      summary: { total: items.length, success: 0, fail: 0, skipped: skippedCount, materials_deducted: 0 },
      results: []
    });
  }
  
  // 모든 제품 정보를 배치로 조회 (master + production_items + production_barcodes)
  // 1. master 테이블에서 조회 (배치 처리)
  let allMasterProducts: any[] = [];
  for (let i = 0; i < newProductCodes.length; i += QUERY_BATCH_SIZE) {
    const batch = newProductCodes.slice(i, i + QUERY_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const products = await c.env.DB.prepare(`
      SELECT item_code, item_name, expiry_days FROM master 
      WHERE item_code IN (${placeholders}) AND category = '제품'
    `).bind(...batch).all<any>();
    allMasterProducts = allMasterProducts.concat(products.results || []);
  }
  const products = { results: allMasterProducts };
  
  // 2. production_items 테이블에서 조회 (배치 처리)
  let allProductionItems: any[] = [];
  for (let i = 0; i < newProductCodes.length; i += QUERY_BATCH_SIZE) {
    const batch = newProductCodes.slice(i, i + QUERY_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const productionItemsBatch = await c.env.DB.prepare(`
      SELECT production_code as item_code, production_name as item_name, shelf_life_days as expiry_days 
      FROM production_items 
      WHERE production_code IN (${placeholders})
    `).bind(...batch).all<any>();
    allProductionItems = allProductionItems.concat(productionItemsBatch.results || []);
  }
  const productionItems = { results: allProductionItems };
  
  // 3. production_barcodes 테이블에서도 조회 (배치 처리)
  // 참고: expiry_days 우선순위 - 1) 바코드별 expiry_days → 2) production_items.shelf_life_days → 3) 7일
  let allBarcodeItems: any[] = [];
  for (let i = 0; i < newProductCodes.length; i += QUERY_BATCH_SIZE) {
    const batch = newProductCodes.slice(i, i + QUERY_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const barcodeItemsBatch = await c.env.DB.prepare(`
      SELECT pb.production_code as item_code, 
             pi.production_name as item_name,
             COALESCE(pi.shelf_life_days, 7) as default_expiry_days,
             pb.expiry_days as barcode_expiry_days,
             pb.box_quantity,
             pb.barcode,
             pb.channel
      FROM production_barcodes pb
      LEFT JOIN production_items pi ON pb.production_code = pi.production_code
      WHERE pb.production_code IN (${placeholders})
    `).bind(...batch).all<any>();
    allBarcodeItems = allBarcodeItems.concat(barcodeItemsBatch.results || []);
  }
  const barcodeItems = { results: allBarcodeItems };
  
  // production_code별 box_quantity 맵 (채널별로 다를 수 있으므로 대표값 사용)
  const boxQuantityMap = new Map<string, number>();
  // production_code별 기본 소비기한 맵 (production_items.shelf_life_days 기반)
  const productionExpiryMap = new Map<string, number>();
  // 바코드별 소비기한 맵 (production_code + channel 조합으로 관리)
  const barcodeExpiryMap = new Map<string, number>();
  
  for (const b of barcodeItems.results || []) {
    // 여러 바코드가 있을 경우, 가장 큰 box_quantity 사용 (안전하게)
    const current = boxQuantityMap.get(b.item_code) || 1;
    boxQuantityMap.set(b.item_code, Math.max(current, b.box_quantity || 1));
    
    // production_code별 기본 소비기한 저장 (production_items.shelf_life_days)
    if (b.default_expiry_days && !productionExpiryMap.has(b.item_code)) {
      productionExpiryMap.set(b.item_code, b.default_expiry_days);
    }
    
    // 바코드별 소비기한 저장 (채널별로 다를 수 있음)
    // 키: production_code|channel (예: PR078|배민)
    // ★ v2.2.5: 채널 정규화 적용 - bmart → 배민, coupang → 쿠팡 등
    if (b.barcode_expiry_days) {
      const normalizedChannel = normalizeChannel(b.channel || '');
      const key = `${b.item_code}|${normalizedChannel}`;
      barcodeExpiryMap.set(key, b.barcode_expiry_days);
      
      // 모든 채널 변형에 대해서도 저장 (역방향 매핑)
      const variants = getChannelVariants(b.channel || '');
      for (const variant of variants) {
        const variantKey = `${b.item_code}|${variant}`;
        if (!barcodeExpiryMap.has(variantKey)) {
          barcodeExpiryMap.set(variantKey, b.barcode_expiry_days);
        }
      }
      
      // 채널 무관 기본값도 저장 (채널 매칭 실패 시 사용)
      const defaultKey = `${b.item_code}|__default__`;
      if (!barcodeExpiryMap.has(defaultKey)) {
        barcodeExpiryMap.set(defaultKey, b.barcode_expiry_days);
      }
    }
  }
  
  const productMap = new Map();
  // master 테이블 결과 먼저 추가
  for (const p of products.results || []) {
    productMap.set(p.item_code, { ...p, source: 'master' });
  }
  // production_items 테이블 결과 추가
  for (const p of productionItems.results || []) {
    if (!productMap.has(p.item_code)) {
      productMap.set(p.item_code, { ...p, source: 'production' });
    }
  }
  // production_barcodes 테이블 결과 추가 (아직 없는 경우만)
  for (const p of barcodeItems.results || []) {
    if (!productMap.has(p.item_code)) {
      productMap.set(p.item_code, { ...p, source: 'barcode' });
    }
  }
  
  // 모든 BOM 정보를 배치로 조회 (기존 bom 테이블 + production_bom 테이블)
  let allBomResults: any[] = [];
  for (let i = 0; i < newProductCodes.length; i += QUERY_BATCH_SIZE) {
    const batch = newProductCodes.slice(i, i + QUERY_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const bomBatch = await c.env.DB.prepare(`
      SELECT b.product_code, b.item_code, b.quantity, b.unit,
             COALESCE(m1.item_code, m2.item_code) as matched_item_code,
             COALESCE(m1.item_name, m2.item_name) as item_name
      FROM bom b
      LEFT JOIN master m1 ON b.item_code = m1.item_code
      LEFT JOIN master m2 ON (
        (b.item_code LIKE 'RM%' AND m2.item_code = 'R' || SUBSTR(b.item_code, 3)) OR
        (b.item_code LIKE 'R%' AND b.item_code NOT LIKE 'RM%' AND m2.item_code = 'RM' || SUBSTR(b.item_code, 2))
      )
      WHERE b.product_code IN (${placeholders})
    `).bind(...batch).all<any>();
    allBomResults = allBomResults.concat(bomBatch.results || []);
  }
  const allBom = { results: allBomResults };
  
  // production_bom 테이블에서도 배치 조회
  let allProdBomResults: any[] = [];
  for (let i = 0; i < newProductCodes.length; i += QUERY_BATCH_SIZE) {
    const batch = newProductCodes.slice(i, i + QUERY_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const prodBomBatch = await c.env.DB.prepare(`
      SELECT pb.production_code as product_code, pb.material_code as item_code, 
             pb.quantity, pb.unit, pb.material_code as matched_item_code, pb.material_name as item_name
      FROM production_bom pb
      WHERE pb.production_code IN (${placeholders})
    `).bind(...batch).all<any>();
    allProdBomResults = allProdBomResults.concat(prodBomBatch.results || []);
  }
  const prodBom = { results: allProdBomResults };
  
  // BOM을 제품별로 그룹핑
  const bomMap = new Map<string, any[]>();
  for (const bom of allBom.results || []) {
    if (!bomMap.has(bom.product_code)) {
      bomMap.set(bom.product_code, []);
    }
    bomMap.get(bom.product_code)!.push(bom);
  }
  // production_bom 결과도 추가
  for (const bom of prodBom.results || []) {
    if (!bomMap.has(bom.product_code)) {
      bomMap.set(bom.product_code, []);
    }
    // 중복 방지
    const existing = bomMap.get(bom.product_code)!;
    if (!existing.some((e: any) => e.item_code === bom.item_code)) {
      existing.push(bom);
    }
  }
  
  // ============================================
  // 최적화: 모든 데이터를 먼저 준비한 후 병렬 배치 처리
  // ============================================
  
  // 디버그: BOM 맵 상태 로깅
  console.log(`[production/batch] BOM 조회 결과: bom 테이블 ${allBom.results?.length || 0}건, production_bom 테이블 ${prodBom.results?.length || 0}건`);
  console.log(`[production/batch] bomMap 키 목록 (처음 10개): ${Array.from(bomMap.keys()).slice(0, 10).join(', ')}`);
  
  const materialDeductions = new Map<string, { qty: number, itemName: string, memos: string[] }>();
  const nextDayStr = (() => {
    const d = new Date(productionDate);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  })();
  
  // 1단계: 모든 데이터 준비 (DB 호출 없음)
  const preparedItems: any[] = [];
  const materialRecords: any[] = [];
  
  for (const item of newItems) {
    const product = productMap.get(item.product_code);
    if (!product) {
      results.push({ product_code: item.product_code, success: false, error: '제품 없음' });
      failCount++;
      continue;
    }
    
    const productLot = `PRD-${productionDate.replace(/-/g, '')}-${item.product_code}-${String(Date.now()).slice(-4)}`;
    
    // 소비기한 우선순위: 
    // 1) 바코드별 expiry_days (채널 일치) → 2) 바코드별 expiry_days (채널 무관)
    // 3) production_items.shelf_life_days → 4) master.expiry_days → 5) 7일
    const itemChannel = item.channel || defaultChannel || '';
    // ★ v2.2.5: 채널 정규화 적용
    const normalizedItemChannel = normalizeChannel(itemChannel);
    
    // 바코드별 소비기한 확인 (채널 일치 우선 - 정규화된 채널명 및 원본 모두 확인)
    let expiryDays = barcodeExpiryMap.get(`${item.product_code}|${normalizedItemChannel}`) ||  // 정규화된 채널 일치
                     barcodeExpiryMap.get(`${item.product_code}|${itemChannel}`) ||             // 원본 채널 일치
                     barcodeExpiryMap.get(`${item.product_code}|`) ||                           // 채널 없는 바코드
                     barcodeExpiryMap.get(`${item.product_code}|__default__`) ||                // 바코드에 설정된 기본값 (채널 무관)
                     productionExpiryMap.get(item.product_code) ||                              // production_items.shelf_life_days
                     product.expiry_days ||                                                      // master.expiry_days
                     7;
    
    console.log(`[production/batch] ${item.product_code} 소비기한: channel=${itemChannel}→${normalizedItemChannel}, barcodeExpiry=${barcodeExpiryMap.get(`${item.product_code}|${normalizedItemChannel}`)}, productionExpiry=${productionExpiryMap.get(item.product_code)}, final=${expiryDays}일`);
    
    const itemExpiryDate = item.expiry_date || (() => {
      const d = new Date(productionDate);
      d.setDate(d.getDate() + expiryDays);
      return d.toISOString().split('T')[0];
    })();
    // itemChannel은 위에서 이미 선언됨
    const boxQuantity = item.box_quantity || boxQuantityMap.get(item.product_code) || 1;
    const actualItemCount = item.quantity * boxQuantity;
    
    console.log(`[production/batch] ${item.product_code}: channel=${itemChannel}, item.channel=${item.channel}, defaultChannel=${defaultChannel}, expiry_date=${itemExpiryDate}`);
    
    preparedItems.push({
      item, product, productLot, itemExpiryDate, itemChannel, expiryDays, actualItemCount
    });
    
    // BOM 처리 (메모리에서만 - LOT 조회는 나중에 배치로)
    const bomItems = bomMap.get(item.product_code) || [];
    for (const bom of bomItems) {
      const actualItemCode = bom.matched_item_code || bom.item_code;
      const requiredQty = bom.quantity * actualItemCount;
      const requiredKg = requiredQty;
      
      // ★ v3.5.4: LOT 조회를 여기서 하지 않고 나중에 배치로 처리
      materialRecords.push({
        productLot, actualItemCode, requiredQty, unit: bom.unit, materialLot: null // 나중에 채움
      });
      
      if (materialDeductions.has(actualItemCode)) {
        const existing = materialDeductions.get(actualItemCode)!;
        existing.qty += requiredKg;
        existing.memos.push(`${product.item_name} ${item.quantity}개`);
      } else {
        materialDeductions.set(actualItemCode, {
          qty: requiredKg,
          itemName: bom.item_name || actualItemCode,
          memos: [`${product.item_name} ${item.quantity}개`]
        });
      }
    }
  }
  
  // ★★★ v3.5.4: 원료 LOT 배치 조회 (성능 최적화) ★★★
  // 개별 쿼리 대신 한 번에 모든 원료의 LOT를 조회
  const uniqueMaterialCodes = [...new Set(materialRecords.map(r => r.actualItemCode))];
  const materialLotMap = new Map<string, string>(); // item_code → lot_number
  
  if (uniqueMaterialCodes.length > 0) {
    console.log(`[production/batch] 원료 LOT 배치 조회: ${uniqueMaterialCodes.length}개 품목`);
    
    // 50개씩 배치 처리
    for (let i = 0; i < uniqueMaterialCodes.length; i += 50) {
      const batch = uniqueMaterialCodes.slice(i, i + 50);
      const placeholders = batch.map(() => '?').join(',');
      
      // FEFO 방식: 소비기한 빠른 순서로 LOT 조회
      // v3.5.5: remain_qty 조건 제거 - 재고 0이어도 LOT 기록 필요 (추적성)
      // GROUP BY 대신 ROW_NUMBER로 품목별 첫 번째 LOT 선택
      const lotResults = await c.env.DB.prepare(`
        SELECT item_code, lot_number FROM (
          SELECT item_code, lot_number,
                 ROW_NUMBER() OVER (PARTITION BY item_code ORDER BY expiry_date ASC, inbound_date ASC) as rn
          FROM inbound 
          WHERE item_code IN (${placeholders})
        ) WHERE rn = 1
      `).bind(...batch).all<{item_code: string; lot_number: string}>();
      
      for (const row of lotResults.results || []) {
        if (!materialLotMap.has(row.item_code)) {
          materialLotMap.set(row.item_code, row.lot_number);
        }
      }
      
      // RM/R 코드 변환 조회 (없는 품목만)
      const missingCodes = batch.filter(code => !materialLotMap.has(code));
      if (missingCodes.length > 0) {
        const altCodes = missingCodes.map(code => {
          if (code.startsWith('RM')) return 'R' + code.substring(2);
          if (code.startsWith('R') && !code.startsWith('RM')) return 'RM' + code.substring(1);
          return null;
        }).filter(Boolean) as string[];
        
        if (altCodes.length > 0) {
          const altPlaceholders = altCodes.map(() => '?').join(',');
          // v3.5.5: remain_qty 조건 제거, ROW_NUMBER로 변경
          const altResults = await c.env.DB.prepare(`
            SELECT item_code, lot_number FROM (
              SELECT item_code, lot_number,
                     ROW_NUMBER() OVER (PARTITION BY item_code ORDER BY expiry_date ASC, inbound_date ASC) as rn
              FROM inbound 
              WHERE item_code IN (${altPlaceholders})
            ) WHERE rn = 1
          `).bind(...altCodes).all<{item_code: string; lot_number: string}>();
          
          for (const row of altResults.results || []) {
            // 원래 코드로 매핑
            let originalCode = row.item_code;
            if (row.item_code.startsWith('RM')) {
              originalCode = 'R' + row.item_code.substring(2);
            } else if (row.item_code.startsWith('R')) {
              originalCode = 'RM' + row.item_code.substring(1);
            }
            if (missingCodes.includes(originalCode) && !materialLotMap.has(originalCode)) {
              materialLotMap.set(originalCode, row.lot_number);
            }
          }
        }
      }
    }
    
    // materialRecords에 LOT 번호 채우기
    for (const rec of materialRecords) {
      rec.materialLot = materialLotMap.get(rec.actualItemCode) || null;
    }
    
    console.log(`[production/batch] LOT 매핑 완료: ${materialLotMap.size}/${uniqueMaterialCodes.length}개`);
  }
  
  // 2단계: 생산 기록 일괄 INSERT (핵심 최적화)
  // D1은 batch() 지원 - 여러 쿼리를 한 번에 실행
  try {
    const productionInserts = preparedItems.map(p => 
      c.env.DB.prepare(`
        INSERT INTO production (prod_date, product_code, quantity, lot_number, status, memo, expiry_date, channel)
        VALUES (?, ?, ?, ?, '완료', ?, ?, ?)
      `).bind(productionDate, p.item.product_code, p.item.quantity, p.productLot, memo || '발주서 일괄등록', p.itemExpiryDate, p.itemChannel)
    );
    
    // 배치 실행 (한 번의 네트워크 요청)
    if (productionInserts.length > 0) {
      await c.env.DB.batch(productionInserts);
    }
    
    // 2-1단계: 생산 ID 조회 및 production_materials INSERT (원료 추적을 위해)
    // ★ v3.5.4: LOT 번호로 방금 INSERT된 production ID 배치 조회 (성능 최적화)
    const productionIdMap = new Map<string, number>();
    const allLotNumbers = preparedItems.map(p => p.productLot);
    
    // 50개씩 배치 처리
    for (let i = 0; i < allLotNumbers.length; i += 50) {
      const batchLots = allLotNumbers.slice(i, i + 50);
      const placeholders = batchLots.map(() => '?').join(',');
      const prodResults = await c.env.DB.prepare(`
        SELECT id, lot_number FROM production WHERE lot_number IN (${placeholders})
      `).bind(...batchLots).all<{id: number; lot_number: string}>();
      
      for (const prod of prodResults.results || []) {
        productionIdMap.set(prod.lot_number, prod.id);
      }
    }
    console.log(`[production/batch] 생산 ID 조회: ${productionIdMap.size}/${preparedItems.length}개`);
    
    // BOM 기반 원료 정보를 production_materials에 INSERT (LOT 번호 포함)
    const materialInserts: any[] = [];
    for (const rec of materialRecords) {
      const productionId = productionIdMap.get(rec.productLot);
      if (productionId) {
        materialInserts.push(
          c.env.DB.prepare(`
            INSERT INTO production_materials (production_id, item_code, lot_number, planned_qty, actual_qty, unit)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(productionId, rec.actualItemCode, rec.materialLot, rec.requiredQty, rec.requiredQty, rec.unit)
        );
      }
    }
    
    if (materialInserts.length > 0) {
      console.log(`[production/batch] production_materials INSERT ${materialInserts.length}건`);
      await c.env.DB.batch(materialInserts);
    }
    
    // 3단계: 입고 기록 일괄 INSERT (PDF에서 추출한 소비기한 우선 사용)
    const inboundInserts = preparedItems.map(p =>
      c.env.DB.prepare(`
        INSERT INTO production_inbound (lot_number, production_code, inbound_date, expiry_date, origin_qty, remain_qty, quality_status, memo)
        VALUES (?, ?, ?, ?, ?, ?, '합격', ?)
      `).bind(p.productLot, p.item.product_code, productionDate, p.itemExpiryDate, p.item.quantity, p.item.quantity, '생산입고')
    );
    
    if (inboundInserts.length > 0) {
      await c.env.DB.batch(inboundInserts);
    }
    
    // 4단계: 입고/출고 트랜잭션 일괄 INSERT
    const transactionInserts = preparedItems.flatMap(p => [
      c.env.DB.prepare(`
        INSERT INTO production_transactions (trans_date, production_code, trans_type, quantity, lot_number, memo)
        VALUES (?, ?, '생산입고', ?, ?, ?)
      `).bind(productionDate, p.item.product_code, p.item.quantity, p.productLot, '생산입고'),
      c.env.DB.prepare(`
        INSERT INTO production_transactions (trans_date, production_code, trans_type, quantity, lot_number, memo)
        VALUES (?, ?, '출고', ?, ?, ?)
      `).bind(nextDayStr, p.item.product_code, p.item.quantity, p.productLot, '생산출고')
    ]);
    
    if (transactionInserts.length > 0) {
      await c.env.DB.batch(transactionInserts);
    }
    
    // 5단계: remain_qty 업데이트 일괄 처리
    const remainUpdates = preparedItems.map(p =>
      c.env.DB.prepare(`
        UPDATE production_inbound SET remain_qty = remain_qty - ?, updated_at = CURRENT_TIMESTAMP
        WHERE lot_number = ? AND production_code = ?
      `).bind(p.item.quantity, p.productLot, p.item.product_code)
    );
    
    if (remainUpdates.length > 0) {
      await c.env.DB.batch(remainUpdates);
    }
    
    // 결과 기록
    for (const p of preparedItems) {
      results.push({
        product_code: p.item.product_code,
        product_name: p.product.item_name,
        quantity: p.item.quantity,
        lot_number: p.productLot,
        success: true
      });
      successCount++;
    }
    
    // 7단계: 생산일보 품목에 LOT 업데이트 (해당 날짜의 생산일보 품목)
    // ★ 핵심 수정: 새로 등록된 품목 + 이미 등록되어 스킵된 품목 모두 LOT 업데이트
    try {
      // 1) 새로 등록된 품목의 LOT
      const lotByCode = new Map<string, string>();
      for (const p of preparedItems) {
        lotByCode.set(p.item.product_code, p.productLot);
      }
      
      // 2) 스킵된 품목 (이미 등록된 품목)의 LOT를 production 테이블에서 조회
      // existingSet에 있는 품목들이 스킵된 것들
      const skippedCodes = Array.from(existingSet).map(key => key.split('|')[0]);
      const uniqueSkippedCodes = [...new Set(skippedCodes)].filter(code => !lotByCode.has(code));
      
      if (uniqueSkippedCodes.length > 0) {
        // 스킵된 품목들의 LOT를 production 테이블에서 조회
        const QUERY_BATCH = 50;
        for (let i = 0; i < uniqueSkippedCodes.length; i += QUERY_BATCH) {
          const batch = uniqueSkippedCodes.slice(i, i + QUERY_BATCH);
          const placeholders = batch.map(() => '?').join(',');
          const existingLots = await c.env.DB.prepare(`
            SELECT product_code, lot_number FROM production 
            WHERE prod_date = ? AND product_code IN (${placeholders})
            ORDER BY id DESC
          `).bind(productionDate, ...batch).all<{product_code: string, lot_number: string}>();
          
          for (const row of existingLots.results || []) {
            if (!lotByCode.has(row.product_code)) {
              lotByCode.set(row.product_code, row.lot_number);
            }
          }
        }
        console.log(`[production/batch] 스킵된 품목 LOT 조회: ${uniqueSkippedCodes.length}개`);
      }
      
      // 3) 해당 날짜의 모든 생산일보 품목 중 LOT가 없는 것들을 제품코드 기준으로 업데이트
      const productCodes = Array.from(lotByCode.keys());
      if (productCodes.length > 0) {
        const BATCH_SIZE = 10;
        for (let i = 0; i < productCodes.length; i += BATCH_SIZE) {
          const batch = productCodes.slice(i, i + BATCH_SIZE);
          const updates = batch.map(code => {
            const lotNumber = lotByCode.get(code)!;
            return c.env.DB.prepare(`
              UPDATE production_daily_items 
              SET lot_number = ?
              WHERE production_code = ?
                AND (lot_number IS NULL OR lot_number = '')
                AND report_id IN (
                  SELECT id FROM production_daily_report WHERE report_date = ?
                )
            `).bind(lotNumber, code, productionDate);
          });
          
          if (updates.length > 0) {
            await c.env.DB.batch(updates);
          }
        }
        console.log(`[production/batch] LOT 업데이트: ${productCodes.length}개 제품코드 (신규+스킵)`);
      }
    } catch (e) {
      console.error('Daily item LOT update error:', e);
      // 실패해도 생산 등록은 계속 진행
    }
    
  } catch (error: any) {
    console.error('Batch production error:', error);
    // 실패 시 모든 항목 실패 처리
    for (const p of preparedItems) {
      results.push({ product_code: p.item.product_code, success: false, error: error.message });
      failCount++;
    }
  }
  
  // 6단계: 원재료 차감 일괄 처리 (반제품 SF 코드 포함)
  const materialUpdates: any[] = [];
  const semiFinishedUpdates: any[] = [];  // 반제품 차감
  const materialTransactions: any[] = [];
  const productionUsageInserts: any[] = [];  // 일별/월별 수불부 문서용
  
  for (const [itemCode, data] of materialDeductions) {
    const isWater = data.itemName.includes('정제수');
    const isSemiFinished = itemCode.startsWith('SF');  // 반제품 여부
    const memoText = `생산사용${isWater ? '(재고미차감)' : ''}: ${data.memos.slice(0, 3).join(', ')}${data.memos.length > 3 ? ` 외 ${data.memos.length - 3}건` : ''}`;
    
    if (!isWater) {
      if (isSemiFinished) {
        // 반제품: semi_finished_lots 테이블에서 FEFO 차감 (가장 오래된 LOT부터)
        // 먼저 가용 LOT 확인 후 차감
        semiFinishedUpdates.push(
          c.env.DB.prepare(`
            UPDATE semi_finished_lots 
            SET remain_qty = remain_qty - ?
            WHERE item_code = ? AND remain_qty > 0
            AND id = (SELECT id FROM semi_finished_lots WHERE item_code = ? AND remain_qty > 0 ORDER BY expiry_date ASC, id ASC LIMIT 1)
          `).bind(data.qty, itemCode, itemCode)
        );
      } else {
        // 일반 원료: master 테이블에서 차감
        materialUpdates.push(
          c.env.DB.prepare(`UPDATE master SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP WHERE item_code = ?`)
            .bind(data.qty, itemCode)
        );
      }
    }
    
    // 트랜잭션 기록 (반제품도 포함)
    // created_at 명시적 지정 (D1 batch에서 DEFAULT 값이 누락되는 문제 방지)
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    
    if (isSemiFinished) {
      materialTransactions.push(
        c.env.DB.prepare(`INSERT INTO semi_finished_transactions (trans_date, item_code, trans_type, quantity, memo, created_at) VALUES (?, ?, '사용', ?, ?, ?)`)
          .bind(productionDate, itemCode, -data.qty, memoText, now)
      );
    } else {
      // 일반 원료: transactions 테이블에 기록 (사용은 음수로 저장)
      materialTransactions.push(
        c.env.DB.prepare(`INSERT INTO transactions (trans_date, item_code, trans_type, quantity, memo, created_at) VALUES (?, ?, '사용', ?, ?, ?)`)
          .bind(productionDate, itemCode, -data.qty, memoText, now)
      );
    }
    
    // 일별/월별 수불부 문서용 기록 (production_usage 테이블)
    productionUsageInserts.push(
      c.env.DB.prepare(`
        INSERT INTO production_usage (usage_date, item_code, item_name, quantity, unit, memo, created_at)
        VALUES (?, ?, ?, ?, 'kg', ?, ?)
      `).bind(productionDate, itemCode, data.itemName, data.qty, memoText, now)
    );
  }
  
  console.log(`[production/batch] 원료 차감 시작: materialUpdates=${materialUpdates.length}, semiFinishedUpdates=${semiFinishedUpdates.length}, materialTransactions=${materialTransactions.length}`);
  
  let materialDeductionSuccess = true;
  let transactionRecordSuccess = true;
  let transactionError = '';
  
  try {
    if (materialUpdates.length > 0) {
      console.log(`[production/batch] master 재고 차감 ${materialUpdates.length}건 실행`);
      await c.env.DB.batch(materialUpdates);
    }
    if (semiFinishedUpdates.length > 0) {
      console.log(`[production/batch] 반제품 차감 ${semiFinishedUpdates.length}건 실행`);
      await c.env.DB.batch(semiFinishedUpdates);
    }
    console.log(`[production/batch] 재고 차감 완료`);
  } catch (e: any) {
    materialDeductionSuccess = false;
    console.error('Material deduction batch error:', e);
    console.error('Error details:', e.message, e.cause);
  }
  
  // 트랜잭션 기록은 별도로 처리 (재고 차감이 실패해도 기록 시도)
  // D1 batch()에서 AUTOINCREMENT가 작동하지 않는 문제로 인해 개별 INSERT 실행
  let txSuccessCount = 0;
  let txFailCount = 0;
  
  if (materialTransactions.length > 0) {
    console.log(`[production/batch] transactions 기록 ${materialTransactions.length}건 실행 (개별)`);
    
    for (const txStatement of materialTransactions) {
      try {
        await txStatement.run();
        txSuccessCount++;
      } catch (e: any) {
        txFailCount++;
        console.error('Transaction insert error:', e.message);
      }
    }
    
    console.log(`[production/batch] transactions 기록 완료: 성공=${txSuccessCount}, 실패=${txFailCount}`);
    
    if (txFailCount > 0) {
      transactionRecordSuccess = false;
      transactionError = `${txFailCount}/${materialTransactions.length} 트랜잭션 기록 실패`;
    }
  }
  
  // 7단계: 일별/월별 수불부 문서용 기록 (production_usage 테이블)
  let usageInsertSuccess = 0;
  let usageInsertFail = 0;
  let usageInsertError = '';
  
  if (productionUsageInserts.length > 0) {
    console.log(`[production/batch] production_usage 기록 ${productionUsageInserts.length}건 실행`);
    for (const stmt of productionUsageInserts) {
      try {
        await stmt.run();
        usageInsertSuccess++;
      } catch (e: any) {
        usageInsertFail++;
        if (!usageInsertError) {
          usageInsertError = e.message || String(e);
        }
        console.log('production_usage insert error:', e.message);
      }
    }
    console.log(`[production/batch] production_usage 기록 완료: 성공=${usageInsertSuccess}, 실패=${usageInsertFail}`);
  }
  
  return c.json({
    success: true,
    data: {
      total: items.length,
      success: successCount,
      fail: failCount,
      materials_deducted: materialDeductions.size,
      material_deduction_success: materialDeductionSuccess,
      transaction_record_success: transactionRecordSuccess,
      transaction_error: transactionError || null,
      usage_insert_success: usageInsertSuccess,
      usage_insert_fail: usageInsertFail,
      usage_insert_error: usageInsertError || null,
      results
    }
  });
  
  } catch (error: any) {
    console.error('Production batch API error:', error);
    return c.json({ 
      success: false, 
      error: '생산 등록 중 오류가 발생했습니다.',
      detail: error.message || String(error)
    }, 500);
  }
  ===== 기존 코드 끝 (비활성화됨) ===== */
});

// production_usage 백필 API (기존 생산 데이터에서 BOM 기반으로 사용량 복구)
productionRoutes.post('/backfill-usage', async (c) => {
  try {
    const { date, dry_run } = await c.req.json<{ date?: string; dry_run?: boolean }>();
    
    if (!date) {
      return c.json({ success: false, error: 'date 파라미터가 필요합니다.' }, 400);
    }
    
    // 해당 날짜의 생산 기록 조회
    const productionResult = await c.env.DB.prepare(`
      SELECT id, product_code, quantity FROM production WHERE prod_date = ?
    `).bind(date).all();
    const productions = productionResult.results || [];
    
    if (productions.length === 0) {
      return c.json({ success: false, error: `${date}에 생산 기록이 없습니다.` });
    }
    
    // 제품별 BOM 조회 (배치로 나눠서 처리)
    const productCodes = [...new Set((productions as any[]).map(p => p.product_code))];
    
    // production_bom 테이블에서 BOM 조회 (50개씩 배치)
    const BATCH_SIZE = 50;
    let bomData: any[] = [];
    
    for (let i = 0; i < productCodes.length; i += BATCH_SIZE) {
      const batch = productCodes.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => '?').join(',');
      const bomResult = await c.env.DB.prepare(`
        SELECT production_code, material_code, material_name, quantity as bom_qty
        FROM production_bom 
        WHERE production_code IN (${placeholders})
      `).bind(...batch).all();
      bomData = bomData.concat(bomResult.results || []);
    }
    
    // 제품별 BOM 맵
    const bomMap = new Map<string, any[]>();
    for (const bom of bomData as any[]) {
      if (!bomMap.has(bom.production_code)) {
        bomMap.set(bom.production_code, []);
      }
      bomMap.get(bom.production_code)!.push(bom);
    }
    
    // 원료별 사용량 집계
    const usageMap = new Map<string, { item_code: string; item_name: string; quantity: number }>();
    
    for (const prod of productions as any[]) {
      const boms = bomMap.get(prod.product_code) || [];
      for (const bom of boms) {
        // v2.3.1: BOM이 이미 kg 단위 - 변환 불필요
        const usedQty = bom.bom_qty * prod.quantity; // BOM.bom_qty는 이제 kg 단위
        const key = bom.material_code;
        
        if (usageMap.has(key)) {
          usageMap.get(key)!.quantity += usedQty;
        } else {
          usageMap.set(key, {
            item_code: bom.material_code,
            item_name: bom.material_name,
            quantity: usedQty
          });
        }
      }
    }
    
    const materials = Array.from(usageMap.values());
    
    if (dry_run) {
      return c.json({
        success: true,
        dry_run: true,
        message: `${materials.length}건의 사용량 데이터가 복구 대상입니다.`,
        productions_count: productions.length,
        products_with_bom: bomMap.size,
        sample: materials.slice(0, 10)
      });
    }
    
    // production_usage에 INSERT (기존 데이터 삭제 후)
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    let insertCount = 0;
    let errorCount = 0;
    
    // 해당 날짜의 기존 데이터 삭제
    await c.env.DB.prepare(`DELETE FROM production_usage WHERE usage_date = ?`).bind(date).run();
    
    for (const mat of materials) {
      try {
        await c.env.DB.prepare(`
          INSERT INTO production_usage (usage_date, item_code, item_name, quantity, unit, memo, created_at)
          VALUES (?, ?, ?, ?, 'kg', '백필 복구', ?)
        `).bind(date, mat.item_code, mat.item_name, mat.quantity, now).run();
        insertCount++;
      } catch (e: any) {
        errorCount++;
        console.log('backfill error:', mat.item_code, e.message);
      }
    }
    
    return c.json({
      success: true,
      message: `백필 완료: ${insertCount}건 성공, ${errorCount}건 실패`,
      date,
      productions_count: productions.length,
      total: materials.length,
      inserted: insertCount,
      errors: errorCount
    });
    
  } catch (error: any) {
    console.error('Backfill usage error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== v2.2.5: 소비기한 검증 API =====
// 입고확인서 소비기한 vs 시스템 계산 소비기한 비교
productionRoutes.post('/validate-expiry', async (c) => {
  const body = await c.req.json();
  const { items, prod_date } = body;
  // items: [{ barcode, expiry_date, quantity?, product_name? }]
  
  if (!items || items.length === 0) {
    return c.json({ success: false, error: '검증할 항목이 없습니다.' }, 400);
  }
  
  const productionDate = prod_date || new Date().toISOString().split('T')[0];
  const results: any[] = [];
  let matchCount = 0;
  let mismatchCount = 0;
  
  try {
    for (const item of items) {
      if (!item.barcode || !item.expiry_date) continue;
      
      // 바코드로 생산코드 및 등록된 소비기한 조회
      const barcodeInfo = await c.env.DB.prepare(`
        SELECT pb.production_code, pb.product_name, pb.channel, pb.expiry_days,
               pi.production_name, pi.shelf_life_days
        FROM production_barcodes pb
        LEFT JOIN production_items pi ON pb.production_code = pi.production_code
        WHERE pb.barcode = ?
      `).bind(item.barcode).first<any>();
      
      if (!barcodeInfo) {
        results.push({
          barcode: item.barcode,
          product_name: item.product_name || '알 수 없음',
          status: 'not_found',
          message: '바코드 미등록'
        });
        continue;
      }
      
      // 시스템 소비기한 계산
      const systemExpiryDays = barcodeInfo.expiry_days || barcodeInfo.shelf_life_days || 7;
      const systemExpiryDate = (() => {
        const d = new Date(productionDate);
        d.setDate(d.getDate() + systemExpiryDays);
        return d.toISOString().split('T')[0];
      })();
      
      // 입고확인서 소비기한과 비교
      const inputExpiryDate = item.expiry_date;
      const daysDiff = Math.round((new Date(inputExpiryDate).getTime() - new Date(systemExpiryDate).getTime()) / (1000 * 60 * 60 * 24));
      
      const isMatch = Math.abs(daysDiff) <= 1; // 1일 오차 허용
      
      if (isMatch) {
        matchCount++;
      } else {
        mismatchCount++;
      }
      
      results.push({
        barcode: item.barcode,
        production_code: barcodeInfo.production_code,
        product_name: barcodeInfo.product_name || barcodeInfo.production_name || item.product_name,
        channel: barcodeInfo.channel,
        input_expiry_date: inputExpiryDate,
        system_expiry_date: systemExpiryDate,
        system_expiry_days: systemExpiryDays,
        days_diff: daysDiff,
        status: isMatch ? 'match' : 'mismatch',
        message: isMatch ? '일치' : `${Math.abs(daysDiff)}일 차이`
      });
    }
    
    return c.json({
      success: true,
      summary: {
        total: results.length,
        match: matchCount,
        mismatch: mismatchCount,
        not_found: results.filter(r => r.status === 'not_found').length
      },
      prod_date: productionDate,
      items: results
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 소비기한 불일치 자동 수정 API
productionRoutes.post('/fix-expiry-mismatch', async (c) => {
  const body = await c.req.json();
  const { items, prod_date, fix_type } = body;
  // fix_type: 'use_input' (입고확인서 기준) | 'use_system' (시스템 기준) | 'update_barcode' (바코드 소비기한 업데이트)
  
  if (!items || items.length === 0) {
    return c.json({ success: false, error: '수정할 항목이 없습니다.' }, 400);
  }
  
  const productionDate = prod_date || new Date().toISOString().split('T')[0];
  let fixedCount = 0;
  let errorCount = 0;
  const results: any[] = [];
  
  try {
    for (const item of items) {
      if (!item.barcode) continue;
      
      try {
        if (fix_type === 'update_barcode' && item.new_expiry_days) {
          // 바코드 테이블의 expiry_days 업데이트
          await c.env.DB.prepare(`
            UPDATE production_barcodes SET expiry_days = ? WHERE barcode = ?
          `).bind(item.new_expiry_days, item.barcode).run();
          
          results.push({ barcode: item.barcode, action: 'barcode_updated', new_expiry_days: item.new_expiry_days });
          fixedCount++;
        } else if (fix_type === 'use_input' && item.expiry_date) {
          // 생산 테이블의 expiry_date 업데이트 (입고확인서 기준)
          const barcodeInfo = await c.env.DB.prepare(`
            SELECT production_code FROM production_barcodes WHERE barcode = ?
          `).bind(item.barcode).first<any>();
          
          if (barcodeInfo) {
            await c.env.DB.prepare(`
              UPDATE production SET expiry_date = ? 
              WHERE prod_date = ? AND product_code = ?
            `).bind(item.expiry_date, productionDate, barcodeInfo.production_code).run();
            
            results.push({ barcode: item.barcode, action: 'production_updated', new_expiry_date: item.expiry_date });
            fixedCount++;
          }
        }
      } catch (e: any) {
        errorCount++;
        results.push({ barcode: item.barcode, error: e.message });
      }
    }
    
    return c.json({
      success: true,
      message: `${fixedCount}건 수정 완료, ${errorCount}건 실패`,
      fixed: fixedCount,
      errors: errorCount,
      results
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 소비기한 일괄 수정 API (특정 날짜의 배민/비마트 생산 데이터)
productionRoutes.post('/fix-expiry-dates', async (c) => {
  try {
    const { prod_date, items } = await c.req.json<{
      prod_date: string;
      items: Array<{ barcode: string; expiry_date: string }>;
    }>();
    
    if (!prod_date || !items || items.length === 0) {
      return c.json({ success: false, error: 'prod_date와 items가 필요합니다.' }, 400);
    }
    
    console.log(`[fix-expiry-dates] ${prod_date} 날짜의 소비기한 수정 시작: ${items.length}건`);
    
    // 바코드 → 생산코드 매핑 조회
    const barcodeList = items.map(i => i.barcode);
    const placeholders = barcodeList.map(() => '?').join(',');
    
    const barcodeMapping = await c.env.DB.prepare(`
      SELECT barcode, production_code FROM production_barcodes WHERE barcode IN (${placeholders})
    `).bind(...barcodeList).all<{ barcode: string; production_code: string }>();
    
    const barcodeToCode = new Map<string, string>();
    for (const row of barcodeMapping.results || []) {
      barcodeToCode.set(row.barcode, row.production_code);
    }
    
    let successCount = 0;
    let failCount = 0;
    
    for (const item of items) {
      const productCode = barcodeToCode.get(item.barcode);
      if (!productCode) {
        console.log(`[fix-expiry-dates] 바코드 ${item.barcode}: 매핑 없음`);
        failCount++;
        continue;
      }
      
      // production 테이블 업데이트
      await c.env.DB.prepare(`
        UPDATE production SET expiry_date = ? WHERE prod_date = ? AND product_code = ?
      `).bind(item.expiry_date, prod_date, productCode).run();
      
      // production_inbound 테이블 업데이트
      await c.env.DB.prepare(`
        UPDATE production_inbound SET expiry_date = ? 
        WHERE production_code = ? AND inbound_date = ?
      `).bind(item.expiry_date, productCode, prod_date).run();
      
      console.log(`[fix-expiry-dates] ${productCode} → ${item.expiry_date} 업데이트 완료`);
      successCount++;
    }
    
    return c.json({
      success: true,
      data: { total: items.length, success: successCount, fail: failCount }
    });
    
  } catch (error: any) {
    console.error('fix-expiry-dates error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 바코드 소비기한 기준으로 기존 생산 데이터 일괄 수정
productionRoutes.post('/recalculate-expiry', async (c) => {
  try {
    const { production_code } = await c.req.json<{ production_code?: string }>();
    
    // 바코드별 소비기한 조회
    let barcodeQuery = `
      SELECT production_code, expiry_days, channel 
      FROM production_barcodes 
      WHERE expiry_days IS NOT NULL
    `;
    if (production_code) {
      barcodeQuery += ` AND production_code = ?`;
    }
    
    const barcodeExpiry = production_code 
      ? await c.env.DB.prepare(barcodeQuery).bind(production_code).all<any>()
      : await c.env.DB.prepare(barcodeQuery).all<any>();
    
    // production_code별 기본 소비기한 맵 (첫 번째 값 사용)
    const expiryMap = new Map<string, number>();
    for (const b of barcodeExpiry.results || []) {
      if (!expiryMap.has(b.production_code)) {
        expiryMap.set(b.production_code, b.expiry_days);
      }
    }
    
    if (expiryMap.size === 0) {
      return c.json({ success: false, error: '바코드 소비기한 설정이 없습니다.' }, 400);
    }
    
    let totalUpdated = 0;
    
    // 각 production_code별로 업데이트
    for (const [code, days] of expiryMap) {
      // production 테이블 업데이트 (expiry_date = prod_date + days)
      const result1 = await c.env.DB.prepare(`
        UPDATE production 
        SET expiry_date = date(prod_date, '+' || ? || ' days')
        WHERE product_code = ?
      `).bind(days, code).run();
      
      // production_inbound 테이블 업데이트
      const result2 = await c.env.DB.prepare(`
        UPDATE production_inbound 
        SET expiry_date = date(inbound_date, '+' || ? || ' days')
        WHERE production_code = ?
      `).bind(days, code).run();
      
      // production_daily_items 테이블 업데이트 (생산일보 품목)
      // report_id로 report_date를 조회해서 계산
      const result3 = await c.env.DB.prepare(`
        UPDATE production_daily_items 
        SET expiry_date = date(
          (SELECT report_date FROM production_daily_report WHERE id = production_daily_items.report_id),
          '+' || ? || ' days'
        )
        WHERE production_code = ?
      `).bind(days, code).run();
      
      totalUpdated += (result1.meta?.changes || 0) + (result2.meta?.changes || 0) + (result3.meta?.changes || 0);
      console.log(`[recalculate-expiry] ${code}: ${days}일로 업데이트 (production: ${result1.meta?.changes || 0}, inbound: ${result2.meta?.changes || 0}, daily_items: ${result3.meta?.changes || 0}건)`);
    }
    
    return c.json({
      success: true,
      message: `${expiryMap.size}개 생산코드의 소비기한을 바코드 설정에 맞게 재계산했습니다.`,
      data: { 
        production_codes: expiryMap.size,
        total_updated: totalUpdated,
        details: Object.fromEntries(expiryMap)
      }
    });
    
  } catch (error: any) {
    console.error('recalculate-expiry error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 생산 취소 (원복)
productionRoutes.post('/:id/cancel', async (c) => {
  const id = c.req.param('id');
  
  // 생산 정보 조회
  const production = await c.env.DB.prepare(`
    SELECT * FROM production WHERE id = ? AND status = '완료'
  `).bind(id).first<any>();
  
  if (!production) {
    return c.json({ success: false, error: '취소할 수 없는 생산 기록입니다.' }, 400);
  }
  
  try {
    // 1. 사용된 원재료 복구
    const materials = await c.env.DB.prepare(`
      SELECT * FROM production_materials WHERE production_id = ?
    `).bind(id).all<any>();
    
    for (const mat of materials.results || []) {
      const qty = mat.actual_qty || mat.planned_qty;
      // v2.3.1: production_materials도 kg 단위로 통일됨
      const qtyKg = qty; // mat.unit은 이제 항상 'kg'
      
      // 마스터 재고 복구
      await c.env.DB.prepare(`
        UPDATE master SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP
        WHERE item_code = ?
      `).bind(qtyKg, mat.item_code).run();
      
      // 취소 거래 기록
      await c.env.DB.prepare(`
        INSERT INTO transactions (trans_date, item_code, trans_type, quantity, memo)
        VALUES (date('now'), ?, '재고조정', ?, ?)
      `).bind(mat.item_code, qtyKg, `생산취소 복구 (생산ID: ${id})`).run();
    }
    
    // 2. 제품 재고 차감
    await c.env.DB.prepare(`
      UPDATE master SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP
      WHERE item_code = ?
    `).bind(production.quantity, production.product_code).run();
    
    // 3. 제품 LOT 삭제 또는 잔량 0 처리
    await c.env.DB.prepare(`
      UPDATE inbound SET remain_qty = 0, updated_at = CURRENT_TIMESTAMP
      WHERE lot_number = ?
    `).bind(production.lot_number).run();
    
    // 4. 생산 상태 업데이트
    await c.env.DB.prepare(`
      UPDATE production SET status = '취소', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(id).run();
    
    // 5. 취소 거래 기록 (제품)
    await c.env.DB.prepare(`
      INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, memo)
      VALUES (date('now'), ?, '재고조정', ?, ?, ?)
    `).bind(
      production.product_code,
      -production.quantity,
      production.lot_number,
      `생산취소 (생산ID: ${id})`
    ).run();
    
    return c.json({ success: true, message: '생산이 취소되었습니다.' });
    
  } catch (error: any) {
    console.error('Production cancel error:', error);
    return c.json({ success: false, error: '생산 취소 중 오류가 발생했습니다.' }, 500);
  }
});

// 생산일 일괄 변경
productionRoutes.put('/batch/update-date', async (c) => {
  const { from_date, to_date } = await c.req.json();
  
  if (!from_date || !to_date) {
    return c.json({ success: false, error: 'from_date와 to_date가 필요합니다.' }, 400);
  }
  
  const result = await c.env.DB.prepare(`
    UPDATE production SET prod_date = ? WHERE prod_date = ?
  `).bind(to_date, from_date).run();
  
  return c.json({ 
    success: true, 
    message: `${result.meta.changes}건의 생산일이 ${from_date}에서 ${to_date}로 변경되었습니다.`,
    updated: result.meta.changes
  });
});

// 생산 통계
productionRoutes.get('/stats/summary', async (c) => {
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  
  let dateFilter = '';
  const params: string[] = [];
  
  if (startDate && endDate) {
    dateFilter = 'WHERE prod_date BETWEEN ? AND ? AND status = ?';
    params.push(startDate, endDate, '완료');
  } else {
    dateFilter = "WHERE status = '완료'";
  }
  
  // 제품별 생산 통계
  const byProduct = await c.env.DB.prepare(`
    SELECT p.product_code, 
           m.item_name as product_name,
           COUNT(*) as production_count,
           SUM(p.quantity) as total_quantity
    FROM production p
    LEFT JOIN master m ON p.product_code = m.item_code
    ${dateFilter}
    GROUP BY p.product_code
    ORDER BY total_quantity DESC
  `).bind(...params).all();
  
  // 일별 생산 통계
  const byDate = await c.env.DB.prepare(`
    SELECT prod_date,
           COUNT(*) as production_count,
           SUM(quantity) as total_quantity
    FROM production
    ${dateFilter}
    GROUP BY prod_date
    ORDER BY prod_date DESC
    LIMIT 30
  `).bind(...params).all();
  
  return c.json({ 
    success: true, 
    data: {
      by_product: byProduct.results,
      by_date: byDate.results
    }
  });
});

// 생산 시뮬레이션 (원재료 소요량 미리보기)
productionRoutes.post('/simulate', async (c) => {
  const { product_code, quantity } = await c.req.json();
  
  if (!product_code || !quantity) {
    return c.json({ success: false, error: '제품과 수량을 입력해주세요.' }, 400);
  }
  
  // 제품 정보
  const product = await c.env.DB.prepare(`
    SELECT * FROM master WHERE item_code = ? AND category = '제품'
  `).bind(product_code).first();
  
  if (!product) {
    return c.json({ success: false, error: '제품을 찾을 수 없습니다.' }, 404);
  }
  
  // BOM 조회
  const bomResult = await c.env.DB.prepare(`
    SELECT b.*, m.item_name, m.current_stock, m.unit as stock_unit
    FROM bom b
    LEFT JOIN master m ON b.item_code = m.item_code
    WHERE b.product_code = ?
    ORDER BY b.sort_order
  `).bind(product_code).all<any>();
  
  const materials = (bomResult.results || []).map((bom: any) => {
    const requiredQty = bom.quantity * quantity;
    // v2.3.1: BOM 단위가 kg으로 통일됨 - 변환 로직 제거
    const requiredKg = requiredQty; // BOM.quantity는 이제 kg 단위
    const isAvailable = bom.current_stock >= requiredKg;
    const shortage = isAvailable ? 0 : requiredKg - bom.current_stock;
    
    return {
      item_code: bom.item_code,
      item_name: bom.item_name,
      unit_qty: bom.quantity,
      bom_unit: bom.unit,
      required_qty: requiredQty,
      required_kg: requiredKg,
      current_stock: bom.current_stock,
      stock_unit: bom.stock_unit,
      is_available: isAvailable,
      shortage: shortage
    };
  });
  
  const canProduce = materials.every((m: any) => m.is_available);
  
  return c.json({
    success: true,
    data: {
      product,
      quantity,
      materials,
      can_produce: canProduce,
      shortage_items: materials.filter((m: any) => !m.is_available)
    }
  });
});

// 생산 삭제 (강제 삭제)
productionRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const force = c.req.query('force') === 'true';
  
  const production = await c.env.DB.prepare(
    'SELECT * FROM production WHERE id = ?'
  ).bind(id).first<any>();
  
  if (!production) {
    return c.json({ success: false, error: '생산 기록을 찾을 수 없습니다.' }, 404);
  }
  
  try {
    // 1. production_materials 먼저 삭제
    await c.env.DB.prepare('DELETE FROM production_materials WHERE production_id = ?').bind(id).run();
    
    // 2. 관련 거래 내역 삭제 (force 옵션 시)
    if (force) {
      await c.env.DB.prepare(
        "DELETE FROM transactions WHERE memo LIKE ?"
      ).bind(`%생산ID: ${id}%`).run();
      
      // 3. 관련 입고 삭제
      await c.env.DB.prepare(
        'DELETE FROM inbound WHERE lot_number = ?'
      ).bind(production.lot_number).run();
    }
    
    // 4. 생산 삭제
    await c.env.DB.prepare('DELETE FROM production WHERE id = ?').bind(id).run();
    
    return c.json({ 
      success: true, 
      message: '생산 기록이 삭제되었습니다.',
      deleted: { id, lot_number: production.lot_number }
    });
  } catch (error: any) {
    console.error('Production delete error:', error);
    return c.json({ success: false, error: `삭제 실패: ${error.message}` }, 500);
  }
});

// 생산 전체 삭제
productionRoutes.delete('/all/clear', async (c) => {
  const confirm = c.req.query('confirm');
  const restoreStock = c.req.query('restore_stock') === 'true';
  
  if (confirm !== 'DELETE_ALL') {
    const count = await c.env.DB.prepare('SELECT COUNT(*) as count FROM production').first<{count:number}>();
    return c.json({ 
      success: false, 
      error: `${count?.count || 0}건의 생산 기록을 삭제하려면 ?confirm=DELETE_ALL을 추가하세요.`,
      count: count?.count || 0
    }, 400);
  }
  
  try {
    // 1. production_materials 먼저 삭제
    await c.env.DB.prepare('DELETE FROM production_materials').run();
    
    // 2. 생산 관련 거래 삭제
    await c.env.DB.prepare("DELETE FROM transactions WHERE memo LIKE '%생산%'").run();
    
    // 3. 생산 입고 삭제
    await c.env.DB.prepare("DELETE FROM inbound WHERE supplier = '자체생산'").run();
    
    // 4. 생산 삭제
    const result = await c.env.DB.prepare('DELETE FROM production').run();
    
    return c.json({ 
      success: true, 
      message: `모든 생산 기록이 삭제되었습니다.`,
      deleted: result.meta.changes
    });
  } catch (error: any) {
    console.error('Production clear error:', error);
    return c.json({ success: false, error: `삭제 실패: ${error.message}` }, 500);
  }
});

// 기존 생산 데이터에 BOM 기반 원료 정보 일괄 추가 (마이그레이션)
productionRoutes.post('/migrate-materials', async (c) => {
  const dryRun = c.req.query('dry_run') === 'true';
  
  try {
    // 1-1. 기존 bom 테이블에서 BOM 조회 (PD 코드)
    const allBom = await c.env.DB.prepare(`
      SELECT b.*, m.item_name, 
             COALESCE(
               (SELECT item_code FROM master WHERE item_code = b.item_code LIMIT 1),
               (SELECT item_code FROM master WHERE item_code = 'RM' || SUBSTR(b.item_code, 2) LIMIT 1),
               (SELECT item_code FROM master WHERE item_code = 'R' || SUBSTR(b.item_code, 3) LIMIT 1),
               b.item_code
             ) as matched_item_code
      FROM bom b
      LEFT JOIN master m ON b.item_code = m.item_code OR m.item_code = 'RM' || SUBSTR(b.item_code, 2) OR m.item_code = 'R' || SUBSTR(b.item_code, 3)
    `).all<any>();
    
    // 1-2. production_bom 테이블에서 BOM 조회 (PR 코드)
    const productionBom = await c.env.DB.prepare(`
      SELECT pb.production_code as product_code, pb.material_code as item_code, 
             pb.material_name as item_name, pb.quantity, pb.unit,
             COALESCE(
               (SELECT item_code FROM master WHERE item_code = pb.material_code LIMIT 1),
               (SELECT item_code FROM master WHERE item_code = 'RM' || SUBSTR(pb.material_code, 2) LIMIT 1),
               (SELECT item_code FROM master WHERE item_code = 'R' || SUBSTR(pb.material_code, 3) LIMIT 1),
               pb.material_code
             ) as matched_item_code
      FROM production_bom pb
    `).all<any>();
    
    // BOM을 product_code별로 그룹화
    const bomMap = new Map<string, any[]>();
    
    // 기존 bom 테이블 데이터
    for (const bom of allBom.results || []) {
      if (!bomMap.has(bom.product_code)) {
        bomMap.set(bom.product_code, []);
      }
      bomMap.get(bom.product_code)!.push(bom);
    }
    
    // production_bom 테이블 데이터 (PR 코드)
    for (const bom of productionBom.results || []) {
      if (!bomMap.has(bom.product_code)) {
        bomMap.set(bom.product_code, []);
      }
      bomMap.get(bom.product_code)!.push(bom);
    }
    
    console.log(`[migrate-materials] BOM 로드 완료: ${bomMap.size}개 제품 (bom: ${allBom.results?.length || 0}, production_bom: ${productionBom.results?.length || 0})`);
    
    // 2. production_materials가 없는 생산 기록 조회
    const productions = await c.env.DB.prepare(`
      SELECT p.id, p.product_code, p.quantity, p.lot_number, p.prod_date
      FROM production p
      WHERE NOT EXISTS (
        SELECT 1 FROM production_materials pm WHERE pm.production_id = p.id
      )
      ORDER BY p.id
    `).all<any>();
    
    console.log(`[migrate-materials] 원료 정보 없는 생산 기록: ${productions.results?.length || 0}건`);
    
    if (dryRun) {
      // 드라이런: 처리할 건수만 반환
      const withBom = (productions.results || []).filter(p => bomMap.has(p.product_code));
      return c.json({
        success: true,
        dry_run: true,
        total_productions: productions.results?.length || 0,
        with_bom: withBom.length,
        without_bom: (productions.results?.length || 0) - withBom.length,
        sample: withBom.slice(0, 5).map(p => ({
          id: p.id,
          product_code: p.product_code,
          lot_number: p.lot_number,
          bom_items: bomMap.get(p.product_code)?.length || 0
        }))
      });
    }
    
    // 3. 각 생산 기록에 대해 원료 정보 추가 (LOT 조회 생략으로 성능 최적화)
    let insertedCount = 0;
    let skippedCount = 0;
    const batchSize = 20; // 배치 크기 축소 (API 한도 방지)
    const productionList = productions.results || [];
    
    for (let i = 0; i < productionList.length; i += batchSize) {
      const batch = productionList.slice(i, i + batchSize);
      const inserts: any[] = [];
      
      for (const prod of batch) {
        const bomItems = bomMap.get(prod.product_code);
        if (!bomItems || bomItems.length === 0) {
          skippedCount++;
          continue;
        }
        
        // 단위수량은 기본 1 사용 (생산수량 = 실제 개수)
        const actualCount = prod.quantity;
        
        for (const bom of bomItems) {
          const actualItemCode = bom.matched_item_code || bom.item_code;
          const requiredQty = bom.quantity * actualCount;
          
          // LOT는 null로 설정 (성능 최적화, 나중에 별도 업데이트 가능)
          inserts.push(
            c.env.DB.prepare(`
              INSERT INTO production_materials (production_id, item_code, lot_number, planned_qty, actual_qty, unit)
              VALUES (?, ?, NULL, ?, ?, ?)
            `).bind(prod.id, actualItemCode, requiredQty, requiredQty, bom.unit || 'g')
          );
        }
      }
      
      if (inserts.length > 0) {
        await c.env.DB.batch(inserts);
        insertedCount += inserts.length;
      }
    }
    
    return c.json({
      success: true,
      message: `원료 정보 마이그레이션 완료`,
      inserted: insertedCount,
      skipped_no_bom: skippedCount,
      total_processed: productionList.length
    });
    
  } catch (error: any) {
    console.error('Migration error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});


// 2. preview: 생산 등록 프리뷰 - 정식 DB JOIN만 사용, 가상 데이터 절대 금지
productionRoutes.post('/preview', async (c) => {
  try {
    const body = await c.req.json();
    const { items, prod_date, channel } = body;
    
    if (!items || items.length === 0) {
      return c.json({ success: false, error: '검증할 항목이 없습니다.', errorCode: 'EMPTY_ITEMS' }, 400);
    }
    
    const productionDate = prod_date || new Date().toISOString().split('T')[0];
    
    // ★★★ v3.5.17: 재고 검증 제외 원료 - 물 등 무한 공급 원료 ★★★
    const STOCK_CHECK_EXCLUDE = ['RM184'];  // 정제수(물)
    
    // ===== 1단계: 모든 데이터를 실제 DB에서 JOIN으로 조회 =====
    
    // 바코드 → 생산코드 매핑 (실제 DB JOIN)
    const barcodeData = await c.env.DB.prepare(`
      SELECT pb.barcode, pb.production_code, pb.box_quantity, pb.expiry_days, pb.channel,
             pi.production_name, pi.shelf_life_days
      FROM production_barcodes pb
      JOIN production_items pi ON pb.production_code = pi.production_code
    `).all<any>();
    
    // 생산 품목 목록 (실제 DB)
    const productionItemsData = await c.env.DB.prepare(`
      SELECT production_code, production_name, shelf_life_days FROM production_items
    `).all<any>();
    
    // BOM 데이터 (실제 DB JOIN) - bom 테이블 + master 테이블 JOIN
    const bomData = await c.env.DB.prepare(`
      SELECT b.product_code, b.item_code, b.quantity, b.unit,
             m.item_name, m.current_stock
      FROM bom b
      LEFT JOIN master m ON b.item_code = m.item_code
    `).all<any>();
    
    // production_bom (PR 코드용) - 실제 DB
    const productionBomData = await c.env.DB.prepare(`
      SELECT production_code as product_code, material_code as item_code, 
             material_name as item_name, quantity, unit
      FROM production_bom
    `).all<any>();
    
    // ★★★ v3.5.16: transactions 기반 재고 조회 (SSOT - Single Source of Truth) ★★★
    // 해당 생산일 기준으로 재고 계산 = SUM(quantity) WHERE trans_date <= 생산일
    const transactionsStockData = await c.env.DB.prepare(`
      SELECT 
        t.item_code, 
        COALESCE(SUM(t.quantity), 0) as available_stock,
        m.item_name,
        COALESCE(m.unit, 'kg') as unit
      FROM transactions t
      LEFT JOIN master m ON t.item_code = m.item_code
      WHERE t.trans_date <= ?
      GROUP BY t.item_code
    `).bind(productionDate).all<any>();
    
    // SF계열 재고 - semi_finished_lots 테이블 (반제품은 별도 관리)
    const sfStockData = await c.env.DB.prepare(`
      SELECT sf.item_code, sf.item_name, sf.unit,
             COALESCE(SUM(sfl.remain_qty), 0) as available_stock
      FROM semi_finished_items sf
      LEFT JOIN semi_finished_lots sfl ON sf.item_code = sfl.item_code AND sfl.remain_qty > 0
      WHERE sf.is_active = 1
      GROUP BY sf.item_code
    `).all<any>();
    
    // ===== 2단계: 룩업 맵 생성 (실제 DB 데이터만 사용) =====
    const barcodeMap = new Map<string, any>();
    for (const row of barcodeData.results || []) {
      barcodeMap.set(row.barcode, row);
    }
    
    const productionNameMap = new Map<string, any>();
    for (const row of productionItemsData.results || []) {
      productionNameMap.set(row.production_code, row);
      productionNameMap.set(row.production_name, row);
    }
    
    // BOM 맵 (실제 DB 데이터)
    const bomMap = new Map<string, any[]>();
    for (const row of bomData.results || []) {
      if (!bomMap.has(row.product_code)) bomMap.set(row.product_code, []);
      bomMap.get(row.product_code)!.push(row);
    }
    for (const row of productionBomData.results || []) {
      if (!bomMap.has(row.product_code)) bomMap.set(row.product_code, []);
      const existing = bomMap.get(row.product_code)!;
      if (!existing.some(e => e.item_code === row.item_code)) {
        existing.push(row);
      }
    }
    
    // ★★★ v3.5.16: 재고 맵 - transactions 기반 (SSOT) ★★★
    const stockMap = new Map<string, { available: number, source: string, item_name: string, unit: string }>();
    
    // 1차: transactions 기반 재고 (해당 날짜까지의 입고-사용 합계)
    for (const row of transactionsStockData.results || []) {
      stockMap.set(row.item_code, { 
        available: row.available_stock || 0, 
        source: 'transactions',
        item_name: row.item_name || row.item_code,
        unit: row.unit || 'kg'
      });
    }
    
    // 2차: SF계열 재고 (반제품은 semi_finished_lots 사용)
    for (const row of sfStockData.results || []) {
      stockMap.set(row.item_code, { 
        available: row.available_stock || 0, 
        source: 'semi_finished_lots',
        item_name: row.item_name,
        unit: row.unit || 'kg'
      });
    }
    
    // ===== 3단계: 각 항목 검증 (실제 DB 데이터만 사용) =====
    const validatedItems: any[] = [];
    const errors: any[] = [];
    const warnings: any[] = [];
    const totalMaterialRequirements = new Map<string, any>();
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rowIndex = i + 1;
      
      let productCode = item.product_code;
      let productName = item.product_name || '';
      let matched = false;
      let hasBom = false;
      let bomMaterials: any[] = [];
      let shelfLifeDays = 7;
      
      // 바코드 매칭 (실제 DB)
      if (item.barcode && barcodeMap.has(item.barcode)) {
        const barcodeInfo = barcodeMap.get(item.barcode);
        productCode = barcodeInfo.production_code;
        productName = barcodeInfo.production_name;
        shelfLifeDays = barcodeInfo.expiry_days || barcodeInfo.shelf_life_days || 7;
        matched = true;
      }
      // 생산코드 매칭 (실제 DB)
      else if (productCode && productionNameMap.has(productCode)) {
        const prodInfo = productionNameMap.get(productCode);
        productName = prodInfo.production_name;
        shelfLifeDays = prodInfo.shelf_life_days || 7;
        matched = true;
      }
      
      // BOM 확인 (실제 DB)
      if (productCode && bomMap.has(productCode)) {
        bomMaterials = bomMap.get(productCode) || [];
        hasBom = bomMaterials.length > 0;
      }
      
      // 원재료 소요량 계산 (실제 DB 재고만 사용!)
      const materialDetails: any[] = [];
      if (hasBom && item.quantity > 0) {
        for (const bom of bomMaterials) {
          const requiredQty = bom.quantity * item.quantity;
          const itemCode = bom.item_code;
          const stockInfo = stockMap.get(itemCode);
          
          // ★ 가상 데이터 금지: stockInfo가 없으면 0으로 처리하고 경고 발생
          const availableStock = stockInfo?.available || 0;
          const itemName = stockInfo?.item_name || bom.item_name || itemCode;
          // ★★★ v3.5.9: BOM unit 우선 사용 - 필요량과 재고 비교 시 단위 통일 ★★★
          const bomUnit = bom.unit || 'g';  // BOM 단위 (보통 g)
          const stockUnit = stockInfo?.unit || 'kg';  // 재고 단위 (보통 kg)
          const stockSource = stockInfo?.source || 'NOT_FOUND';
          
          // 필요량을 kg으로 변환 (BOM이 g 단위인 경우)
          const requiredQtyInKg = bomUnit === 'g' ? requiredQty / 1000 : requiredQty;
          
          // DB에 재고 출처가 없으면 상세 경고 표시
          if (!stockInfo) {
            warnings.push({
              row: rowIndex,
              item_code: itemCode,
              type: 'DB_MAPPING_ERROR',
              message: `[미등록원료] ${itemCode}: 마스터/입고 테이블에 등록되지 않음. 원료 마스터에서 등록 후 입고해주세요.`
            });
          }
          
          const isSF = itemCode.startsWith('SF');
          // ★★★ v3.5.17: 재고 검증 제외 원료 (정제수 등 무한 공급) ★★★
          const isExcluded = STOCK_CHECK_EXCLUDE.includes(itemCode);
          // ★★★ v3.4.28: SF 원료는 자동생산이므로 항상 충분한 것으로 처리 ★★★
          // ★★★ v3.5.9: 재고 비교는 kg 단위로 통일 ★★★
          // ★★★ v3.5.17: 제외 원료는 항상 충분한 것으로 처리 ★★★
          const isSufficient = isSF || isExcluded ? true : (availableStock >= requiredQtyInKg);
          
          materialDetails.push({
            item_code: itemCode,
            item_name: itemName,
            // ★★★ v3.5.9: 필요량을 kg 단위로 저장 (표시 통일) ★★★
            required_qty: requiredQtyInKg,
            // SF 원료는 필요량을 가용량으로 표시 (자동생산)
            // ★★★ v3.5.17: 제외 원료는 무한(∞)으로 표시 ★★★
            available_stock: isSF ? requiredQtyInKg : (isExcluded ? 999999 : availableStock),
            unit: 'kg',  // 항상 kg 단위로 통일
            is_sufficient: isSufficient,
            is_sf: isSF,
            is_excluded: isExcluded,  // v3.5.17: 제외 원료 표시
            stock_source: isSF ? 'auto_production' : (isExcluded ? 'unlimited' : stockSource)
          });
          
          // 총 소요량 누적 (kg 단위로 통일)
          if (totalMaterialRequirements.has(itemCode)) {
            const existing = totalMaterialRequirements.get(itemCode)!;
            existing.required += requiredQtyInKg;
          } else {
            totalMaterialRequirements.set(itemCode, {
              item_name: itemName,
              required: requiredQtyInKg,
              // ★★★ v3.5.17: 제외 원료는 무한(∞)으로 표시 ★★★
              available: isExcluded ? 999999 : availableStock,
              unit: 'kg',  // 항상 kg 단위로 통일
              is_sf: isSF,
              is_excluded: isExcluded,  // v3.5.17: 제외 원료 표시
              stock_source: isExcluded ? 'unlimited' : stockSource
            });
          }
        }
      }
      
      // 검증 결과 생성
      const validationResult: any = {
        row_index: rowIndex,
        original: item,
        product_code: productCode,
        product_name: productName,
        quantity: item.quantity || 0,
        channel: item.channel || channel || '',
        is_matched: matched,
        has_bom: hasBom,
        shelf_life_days: shelfLifeDays,
        materials: materialDetails,
        material_count: bomMaterials.length,
        issues: [] as string[],
        can_proceed: true
      };
      
      // 문제 체크
      if (!matched) {
        validationResult.issues.push('UNMATCHED');
        validationResult.can_proceed = false;
        errors.push({
          row: rowIndex,
          type: 'UNMATCHED',
          message: `미매칭 제품: ${item.product_name || item.barcode || '알 수 없음'}`
        });
      }
      
      if (matched && !hasBom) {
        validationResult.issues.push('NO_BOM');
        warnings.push({
          row: rowIndex,
          type: 'NO_BOM',
          message: `BOM 미등록: ${productName} (원재료 차감 없이 제품 재고만 증가)`
        });
      }
      
      // 재고 부족 체크 (실제 DB 데이터 기준!)
      const insufficientMaterials = materialDetails.filter(m => !m.is_sufficient);
      if (insufficientMaterials.length > 0) {
        validationResult.issues.push('STOCK_SHORTAGE');
        for (const mat of insufficientMaterials) {
          warnings.push({
            row: rowIndex,
            type: 'STOCK_SHORTAGE',
            message: `재고 부족: ${mat.item_name} (필요: ${mat.required_qty.toFixed(2)}${mat.unit}, 가용: ${mat.available_stock.toFixed(2)}${mat.unit}, 출처: ${mat.stock_source})`
          });
        }
      }
      
      validatedItems.push(validationResult);
    }
    
    // ===== 4단계: 총 원재료 소요량 요약 =====
    const materialSummary = Array.from(totalMaterialRequirements.entries()).map(([code, data]: [string, any]) => {
      const isSF = data.is_sf || code.startsWith('SF');
      return {
        item_code: code,
        item_name: data.item_name,
        total_required: data.required,
        // ★ SF 원료는 필요량을 가용량으로 표시 (자동생산)
        available: isSF ? data.required : data.available,
        unit: data.unit,
        // ★ SF 원료는 항상 충분
        is_sufficient: isSF ? true : (data.available >= data.required),
        shortage: isSF ? 0 : Math.max(0, data.required - data.available),
        is_sf: isSF,
        stock_source: isSF ? 'auto_production' : data.stock_source  // SF는 자동생산으로 표시
      };
    }).sort((a, b) => b.shortage - a.shortage);
    
    // 결과 요약 - SF 원료는 부족 카운트에서 제외
    const matchedCount = validatedItems.filter(v => v.is_matched).length;
    const unmatchedCount = validatedItems.filter(v => !v.is_matched).length;
    const withBomCount = validatedItems.filter(v => v.has_bom).length;
    const stockIssueCount = materialSummary.filter(m => !m.is_sufficient && !m.is_sf).length;
    
    return c.json({
      success: true,
      preview: true,
      production_date: productionDate,
      summary: {
        total_items: items.length,
        matched: matchedCount,
        unmatched: unmatchedCount,
        with_bom: withBomCount,
        without_bom: matchedCount - withBomCount,
        material_types: totalMaterialRequirements.size,
        stock_issues: stockIssueCount
      },
      items: validatedItems,
      material_summary: materialSummary,
      errors,
      warnings,
      can_auto_proceed: unmatchedCount === 0,
      requires_confirmation: stockIssueCount > 0 || unmatchedCount > 0
    });
    
  } catch (error: any) {
    console.error('[production/preview] D1_TRANSACTION_ERROR:', error);
    return c.json({ 
      success: false, 
      error: `D1_TRANSACTION_ERROR: ${error.message}`,
      errorCode: 'D1_TRANSACTION_ERROR',
      hint: 'DB 트랜잭션 오류 - 테이블/컬럼 매핑을 확인하세요.'
    }, 500);
  }
});

// 3. confirm: 생산 등록 확정 - v3.4.31: 무결성 검사 완전 제거, 바로 DB 반영
// ★★★ v3.5.0: /production/confirm API - Service Layer 적용 완전 재작성 ★★★
// 핵심 개선: 
// 1. 엄격한 유효성 검증 (Validation Layer)
// 2. FEFO 재고 차감 + inbound.remain_qty 업데이트
// 3. transactions INSERT (Single Source of Truth)
// 4. 원자적 트랜잭션 (D1 batch)
productionRoutes.post('/confirm', async (c) => {
  try {
    const body = await c.req.json();
    const { items, prod_date, channel, force_stock_shortage } = body;
    
    console.log('[confirm/v3.5.0] 요청:', JSON.stringify({ itemCount: items?.length, prod_date, channel }));
    
    // ===== 1단계: 기본 유효성 검증 =====
    if (!items || !Array.isArray(items) || items.length === 0) {
      return c.json({ 
        success: false, 
        error: '등록할 항목이 없습니다.', 
        errorCode: 'EMPTY_ITEMS' 
      }, 400);
    }
    
    // 생산일 검증
    const productionDate = prod_date || new Date().toISOString().split('T')[0];
    const dateValidation = validateProductionDate(productionDate);
    if (!dateValidation.valid) {
      return c.json({
        success: false,
        error: dateValidation.errors.map(e => e.message).join(', '),
        errorCode: 'INVALID_DATE'
      }, 400);
    }
    
    // ===== 2단계: 각 항목 유효성 검증 =====
    const validationErrors: Array<{ index: number; errors: string[] }> = [];
    const allWarnings: string[] = [];
    
    for (let i = 0; i < items.length; i++) {
      const validation = validateProductionItem(items[i], i);
      if (!validation.valid) {
        validationErrors.push({
          index: i,
          errors: validation.errors.map(e => e.message)
        });
      }
      if (validation.warnings.length > 0) {
        allWarnings.push(...validation.warnings);
      }
    }
    
    if (validationErrors.length > 0 && !force_stock_shortage) {
      return c.json({
        success: false,
        error: '유효성 검증 실패',
        errorCode: 'VALIDATION_ERROR',
        validationErrors,
        warnings: allWarnings
      }, 400);
    }
    
    // ===== 3단계: 재고 사전 검증 (모든 항목) =====
    const stockShortages: Array<{
      productCode: string;
      itemCode: string;
      itemName: string;
      required: number;
      available: number;
      shortage: number;
    }> = [];
    
    for (const item of items) {
      if (!item.materials || !Array.isArray(item.materials)) continue;
      
      for (const mat of item.materials) {
        const itemCode = mat.item_code?.trim();
        if (!itemCode) continue;
        if (SERVICE_EXCLUDE_CODES.includes(itemCode.toUpperCase())) continue;
        
        const plan = await planFEFODeduction(c.env.DB, itemCode, mat.required_qty || 0, productionDate);
        
        if (!plan.isWater && plan.shortage > 0) {
          stockShortages.push({
            productCode: item.product_code,
            itemCode: plan.itemCode,
            itemName: plan.itemName,
            required: plan.requiredQty,
            available: plan.totalAvailable,
            shortage: plan.shortage
          });
        }
      }
    }
    
    // 재고 부족 시 경고 (force_stock_shortage가 아니면 중단)
    if (stockShortages.length > 0 && !force_stock_shortage) {
      return c.json({
        success: false,
        error: `재고 부족: ${stockShortages.length}개 원료`,
        errorCode: 'INSUFFICIENT_STOCK',
        stockShortages,
        hint: 'force_stock_shortage: true로 강제 진행 가능'
      }, 400);
    }
    
    // ===== 4단계: 생산 등록 (원자적 처리) =====
    let successCount = 0;
    let failCount = 0;
    const results: any[] = [];
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    
    for (const item of items) {
      try {
        const safeProductCode = (item.product_code || '').trim();
        const safeQuantity = Number(item.quantity) || 0;
        const safeChannel = (item.channel || channel || '').trim();
        
        if (!safeProductCode || safeQuantity <= 0) {
          failCount++;
          results.push({ 
            product_code: safeProductCode || 'UNKNOWN', 
            status: 'FAILED', 
            error: 'product_code 또는 quantity 누락' 
          });
          continue;
        }
        
        // LOT 번호 생성
        const lotNumber = await generateProductionLotNumber(c.env.DB, safeProductCode, productionDate);
        
        // 소비기한 계산
        const expiryDateStr = calculateExpiryDate(
          productionDate,
          item.expiry_date,
          item.shelf_life_days
        );
        
        // ===== production INSERT =====
        const insertResult = await c.env.DB.prepare(`
          INSERT INTO production (prod_date, product_code, quantity, lot_number, channel, expiry_date, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, '완료', ?)
        `).bind(productionDate, safeProductCode, safeQuantity, lotNumber, safeChannel, expiryDateStr, now).run();
        
        const productionId = insertResult.meta?.last_row_id;
        if (!productionId) {
          failCount++;
          results.push({ product_code: safeProductCode, status: 'FAILED', error: 'production INSERT 실패' });
          continue;
        }
        
        // ===== 원료 처리: FEFO 차감 + production_materials + transactions =====
        const deductionPlans: any[] = [];
        const statements: D1PreparedStatement[] = [];
        
        if (item.materials && Array.isArray(item.materials) && item.materials.length > 0) {
          for (const mat of item.materials) {
            const safeItemCode = (mat.item_code || '').trim();
            if (!safeItemCode) continue;
            if (SERVICE_EXCLUDE_CODES.includes(safeItemCode.toUpperCase())) continue;
            
            const safeRequiredQty = Number(mat.required_qty) || 0;
            if (safeRequiredQty <= 0) continue;
            
            const safeUnit = mat.unit || 'kg';
            
            // FEFO 차감 계획 수립
            const plan = await planFEFODeduction(c.env.DB, safeItemCode, safeRequiredQty, productionDate);
            deductionPlans.push(plan);
            
            // 원료 LOT 번호 결정
            let materialLotNumber: string | null = null;
            if (plan.lots && plan.lots.length > 0) {
              materialLotNumber = plan.lots[0].lotNumber;
            } else {
              materialLotNumber = await getMaterialLotNumber(c.env.DB, safeItemCode, productionDate);
              if (!materialLotNumber) {
                const lotDate = productionDate.replace(/-/g, '');
                materialLotNumber = `${lotDate}-${safeItemCode}-001`;
              }
            }
            
            // production_materials INSERT
            statements.push(
              c.env.DB.prepare(`
                INSERT INTO production_materials (production_id, item_code, lot_number, planned_qty, actual_qty, unit)
                VALUES (?, ?, ?, ?, ?, ?)
              `).bind(productionId, safeItemCode, materialLotNumber, safeRequiredQty, safeRequiredQty, safeUnit)
            );
            
            // ★★★ 핵심: 재고 차감 + transactions INSERT ★★★
            if (!plan.isWater && plan.lots && plan.lots.length > 0) {
              // 각 LOT에서 차감
              for (const lot of plan.lots) {
                if (plan.isSemiFinished) {
                  // 반제품: semi_finished_lots 차감
                  statements.push(
                    c.env.DB.prepare(`
                      UPDATE semi_finished_lots 
                      SET remain_qty = MAX(0, remain_qty - ?), updated_at = ?
                      WHERE lot_number = ? AND item_code = ?
                    `).bind(lot.deductQty, now, lot.lotNumber, safeItemCode)
                  );
                } else {
                  // 일반 원료: inbound 차감
                  statements.push(
                    c.env.DB.prepare(`
                      UPDATE inbound 
                      SET remain_qty = MAX(0, remain_qty - ?), updated_at = ?
                      WHERE lot_number = ? AND item_code = ?
                    `).bind(lot.deductQty, now, lot.lotNumber, safeItemCode)
                  );
                }
              }
              
              // master.current_stock 차감 (일반 원료만)
              if (!plan.isSemiFinished) {
                statements.push(
                  c.env.DB.prepare(`
                    UPDATE master 
                    SET current_stock = MAX(0, current_stock - ?), updated_at = ?
                    WHERE item_code = ?
                  `).bind(safeRequiredQty, now, safeItemCode)
                );
              }
              
              // ★★★ transactions INSERT - Single Source of Truth ★★★
              const memoText = `생산사용: ${safeProductCode} (생산ID:${productionId})`;
              const lotNumbers = plan.lots.map((l: any) => l.lotNumber).join(',');
              
              if (plan.isSemiFinished) {
                statements.push(
                  c.env.DB.prepare(`
                    INSERT INTO semi_finished_transactions 
                    (trans_date, item_code, trans_type, quantity, lot_number, memo, created_at)
                    VALUES (?, ?, '사용', ?, ?, ?, ?)
                  `).bind(productionDate, safeItemCode, -safeRequiredQty, lotNumbers, memoText, now)
                );
              } else {
                statements.push(
                  c.env.DB.prepare(`
                    INSERT INTO transactions 
                    (trans_date, item_code, trans_type, quantity, lot_number, memo, created_at)
                    VALUES (?, ?, '사용', ?, ?, ?, ?)
                  `).bind(productionDate, safeItemCode, -safeRequiredQty, lotNumbers, memoText, now)
                );
              }
            }
          }
        }
        
        // ===== 원자적 실행 (D1 batch) =====
        if (statements.length > 0) {
          try {
            await c.env.DB.batch(statements);
            console.log(`[confirm/v3.5.0] ${safeProductCode}: ${statements.length}개 쿼리 원자적 실행 완료`);
          } catch (batchError: any) {
            console.error(`[confirm/v3.5.0] batch 실패:`, batchError);
            // 생산은 등록되었으나 재고 차감 실패 - 상태 업데이트
            await c.env.DB.prepare(`
              UPDATE production SET status = '재고차감실패', memo = ? WHERE id = ?
            `).bind(`재고 차감 중 오류: ${batchError.message}`, productionId).run();
            
            failCount++;
            results.push({ 
              product_code: safeProductCode, 
              lot_number: lotNumber,
              production_id: productionId,
              status: 'PARTIAL_FAIL', 
              error: `생산 등록됨, 재고 차감 실패: ${batchError.message}`,
              deductions: deductionPlans
            });
            continue;
          }
        }
        
        successCount++;
        results.push({ 
          product_code: safeProductCode, 
          lot_number: lotNumber,
          production_id: productionId,
          expiry_date: expiryDateStr,
          status: 'SUCCESS',
          materials_processed: deductionPlans.length,
          transactions_created: statements.length > 0
        });
        
      } catch (itemError: any) {
        failCount++;
        results.push({ 
          product_code: item.product_code, 
          status: 'FAILED', 
          error: itemError.message 
        });
        console.error(`[confirm/v3.5.0] 항목 처리 오류:`, itemError);
      }
    }
    
    return c.json({
      success: failCount === 0,
      message: `생산 등록 완료: 성공 ${successCount}건, 실패 ${failCount}건`,
      version: 'v3.5.0',
      results,
      production_date: productionDate,
      warnings: allWarnings.length > 0 ? allWarnings : undefined,
      stockShortages: stockShortages.length > 0 ? stockShortages : undefined
    });
    
  } catch (error: any) {
    console.error('[confirm/v3.5.0] D1_TRANSACTION_ERROR:', error);
    return c.json({
      success: false,
      error: `D1_TRANSACTION_ERROR: ${error.message}`,
      errorCode: 'D1_TRANSACTION_ERROR'
    }, 500);
  }
});
export default productionRoutes;

// v2.2.8: 개별 바코드 소비기한(expiry_days) 수정 API
productionRoutes.post('/update-barcode-expiry', async (c) => {
  try {
    const { barcode, expiry_days } = await c.req.json<{ barcode: string; expiry_days: number }>();
    
    if (!barcode) {
      return c.json({ success: false, error: '바코드가 필요합니다.' }, 400);
    }
    
    if (expiry_days === undefined || expiry_days === null) {
      return c.json({ success: false, error: '소비기한(일수)이 필요합니다.' }, 400);
    }
    
    // 바코드 존재 확인
    const existing = await c.env.DB.prepare(
      'SELECT barcode, production_code, channel, expiry_days FROM production_barcodes WHERE barcode = ?'
    ).bind(barcode).first<any>();
    
    if (!existing) {
      return c.json({ success: false, error: `바코드 ${barcode}가 존재하지 않습니다.` }, 404);
    }
    
    const oldExpiryDays = existing.expiry_days;
    
    // expiry_days 업데이트
    await c.env.DB.prepare(
      'UPDATE production_barcodes SET expiry_days = ? WHERE barcode = ?'
    ).bind(expiry_days, barcode).run();
    
    return c.json({
      success: true,
      message: `바코드 ${barcode} 소비기한이 ${oldExpiryDays}일 → ${expiry_days}일로 수정되었습니다.`,
      barcode,
      production_code: existing.production_code,
      channel: existing.channel,
      old_expiry_days: oldExpiryDays,
      new_expiry_days: expiry_days
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ========================================
// ★★★ v3.5.20: 단순화된 생산 등록 API ★★★
// 계산은 구글시트에서, ERP는 입력/기록만
// ========================================

// 구글시트 서비스 헬퍼
function getSheetServiceForProduction(c: any): any {
  const clientEmail = c.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = c.env.GOOGLE_PRIVATE_KEY;
  if (!clientEmail || !privateKey) return null;
  const formattedKey = privateKey.replace(/\\n/g, '\n');
  return new GoogleSheetsService(clientEmail, formattedKey);
}

// ===== 단순 생산 등록 (시트 전송만, 계산 없음) =====
productionRoutes.post('/simple', async (c) => {
  try {
    const body = await c.req.json();
    const { 
      prod_date,
      lot_number,
      product_code,
      product_name,
      quantity,
      channel,
      memo
    } = body;
    
    // ★★★ v3.6.28: 단일 객체도 items 배열로 변환 (프론트엔드 호환성) ★★★
    let items = body.items;
    if (!items && product_code) {
      // 단일 객체로 전달된 경우 배열로 변환
      items = [{
        product_code,
        product_name: product_name || '',
        quantity: quantity || 0,
        channel: channel || '',
        memo: memo || ''
      }];
    }
    
    if (!prod_date || !items || !Array.isArray(items) || items.length === 0) {
      return c.json({ success: false, error: 'prod_date, items 또는 product_code 필수' }, 400);
    }
    
    const lotNum = lot_number || prod_date.replace(/-/g, '').slice(2);
    
    // 1. 구글 시트에 생산실적 전송
    const service = getSheetServiceForProduction(c);
    let sheetSent = false;
    
    if (service) {
      try {
        // ★ v3.5.22: 시트 헤더 순서에 맞춤
        // 헤더: 생산일자, 제품코드, 제품명, 생산수량, 제품로트, 채널, 비고, 등록시간
        // ★ 날짜는 문자열로 명시 (시트가 숫자로 변환하지 않도록)
        const rows = items.map((item: any) => [
          `'${prod_date}`,              // A: 생산일자 (앞에 '로 문자열 강제)
          item.product_code,            // B: 제품코드
          item.product_name || '',      // C: 제품명
          item.quantity || 0,           // D: 생산수량
          `${lotNum}-${item.product_code}`, // E: 제품로트
          item.channel || '',           // F: 채널
          '',                           // G: 비고
          new Date().toISOString()      // H: 등록시간
        ]);
        // ★ v3.5.67: 중복 방지 함수 사용
        const prodResult = await service.appendProductionWithDedup(rows);
        sheetSent = true;
        console.log(`[production/simple] 생산실적 추가: ${prodResult.added}건 추가, ${prodResult.skipped}건 중복 스킵`);
      } catch (sheetError: any) {
        console.error('[production/simple] 시트 전송 실패:', sheetError.message);
      }
    }
    
    // 2. DB에 간단한 기록만 저장
    let dbSaved = 0;
    for (const item of items) {
      try {
        await c.env.DB.prepare(`
          INSERT INTO production (product_code, quantity, prod_date, lot_number, channel, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `).bind(
          item.product_code,
          item.quantity || 0,
          prod_date,
          lotNum,
          item.channel || ''
        ).run();
        dbSaved++;
      } catch (e: any) {
        console.error('[production/simple] DB 저장 실패:', e.message);
      }
    }
    
    // ★★★ v3.6.26: LOT 매칭 + 일별수불부 자동 갱신 추가 (simple-batch와 동일하게) ★★★
    let lotMatchingResult: any = null;
    let dailyStockResult: any = null;
    let autoUpdateError: string | null = null;
    
    console.log(`[production/simple] 자동 갱신 조건: service=${!!service}`);
    
    if (service) {
      try {
        // LOT 매칭 자동 생성 (해당 날짜만)
        console.log(`[production/simple] LOT 매칭 생성 시작: ${prod_date}`);
        lotMatchingResult = await service.rebuildLotMatchingForDates([prod_date]);
        console.log(`[production/simple] LOT 매칭 완료: ${lotMatchingResult?.totalRows || 0}행`);
      } catch (lotError: any) {
        console.error('[production/simple] LOT 매칭 실패:', lotError.message);
        autoUpdateError = `LOT매칭 실패: ${lotError.message}`;
      }
      
      try {
        // 일별수불부 자동 추가
        console.log(`[production/simple] 일별수불부 추가 시작: ${prod_date}`);
        dailyStockResult = await service.addDailyStockDate(prod_date);
        console.log(`[production/simple] 일별수불부 완료: ${dailyStockResult?.new_rows || 0}행`);
      } catch (stockError: any) {
        console.error('[production/simple] 일별수불부 실패:', stockError.message);
        autoUpdateError = (autoUpdateError ? autoUpdateError + ' / ' : '') + `일별수불부 실패: ${stockError.message}`;
      }
    } else {
      console.warn(`[production/simple] 자동 갱신 건너뜀: service 없음`);
      autoUpdateError = 'Google Sheets 서비스 없음';
    }
    
    return c.json({
      success: true,
      prod_date,
      lot_number: lotNum,
      items_count: items.length,
      db_saved: dbSaved,
      sheet_sent: sheetSent,
      lot_matching: lotMatchingResult ? { success: true, rows: lotMatchingResult.totalRows } : { success: false, error: autoUpdateError },
      daily_stock: dailyStockResult ? { success: true, rows: dailyStockResult.new_rows } : { success: false, error: autoUpdateError },
      auto_update_error: autoUpdateError,
      message: `${items.length}건 생산 등록 완료${lotMatchingResult ? ' + LOT매칭' : ''}${dailyStockResult ? ' + 일별수불부' : ''}`,
      note: autoUpdateError ? `자동 갱신 오류: ${autoUpdateError}` : '생산 등록 시 LOT 매칭과 일별수불부가 자동으로 갱신됩니다.'
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 단순 일괄 생산 등록 (발주 기반, 계산 없음) =====
productionRoutes.post('/simple-batch', async (c) => {
  try {
    const body = await c.req.json();
    // ★★★ v3.6.06: production_date도 지원 (프론트엔드 호환성) ★★★
    const { prod_date, production_date, lot_number, items, order_date } = body;
    const actualProdDate = prod_date || production_date;  // 둘 다 지원
    
    if (!actualProdDate || !items || !Array.isArray(items) || items.length === 0) {
      return c.json({ success: false, error: 'prod_date 또는 production_date, items 필수' }, 400);
    }
    
    const lotNum = lot_number || actualProdDate.replace(/-/g, '').slice(2);
    
    // 1. 구글 시트에 생산실적 전송
    const service = getSheetServiceForProduction(c);
    let sheetSent = false;
    
    if (service) {
      try {
        // ★ v3.5.22: 시트 헤더 순서에 맞춤
        // 헤더: 생산일자, 제품코드, 제품명, 생산수량, 제품로트, 채널, 비고, 등록시간
        // ★ 날짜는 문자열로 명시 (시트가 숫자로 변환하지 않도록)
        const rows = items.map((item: any) => [
          `'${actualProdDate}`,              // A: 생산일자 (앞에 '로 문자열 강제)
          item.product_code,            // B: 제품코드
          item.product_name || '',      // C: 제품명
          item.quantity || 0,           // D: 생산수량
          `${lotNum}-${item.product_code}`, // E: 제품로트
          item.channel || item.channels || '', // F: 채널
          '',                           // G: 비고
          new Date().toISOString()      // H: 등록시간
        ]);
        // ★ v3.5.67: 중복 방지 함수 사용
        const prodResult = await service.appendProductionWithDedup(rows);
        sheetSent = true;
        console.log(`[production/simple-batch] 생산실적 추가: ${prodResult.added}건 추가, ${prodResult.skipped}건 중복 스킵`);
      } catch (sheetError: any) {
        console.error('[production/simple-batch] 시트 전송 실패:', sheetError.message);
      }
    }
    
    // 2. DB에 간단한 기록만 저장
    let dbSaved = 0;
    for (const item of items) {
      try {
        await c.env.DB.prepare(`
          INSERT INTO production (product_code, quantity, prod_date, lot_number, channel, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `).bind(
          item.product_code,
          item.quantity || 0,
          actualProdDate,
          lotNum,
          item.channel || item.channels || ''
        ).run();
        dbSaved++;
      } catch (e: any) {
        console.error('[production/simple-batch] DB 저장 실패:', e.message);
      }
    }
    
    // 3. 발주 상태 업데이트
    let ordersUpdated = 0;
    if (order_date) {
      try {
        const result = await c.env.DB.prepare(`
          UPDATE orders SET status = '완료', updated_at = CURRENT_TIMESTAMP 
          WHERE order_date = ? AND status = '대기'
        `).bind(order_date).run();
        ordersUpdated = result.meta?.changes || 0;
      } catch (e: any) {
        console.error('[production/simple-batch] 발주 상태 업데이트 실패:', e.message);
      }
    }
    
    // ★★★ v3.6.25: LOT 매칭 + 일별수불부 자동 갱신 (시트 전송 실패해도 실행) ★★★
    // 근본 수정: sheetSent 실패해도 service가 있으면 자동 갱신 시도
    let lotMatchingResult: any = null;
    let dailyStockResult: any = null;
    let autoUpdateError: string | null = null;
    
    console.log(`[production/simple-batch] 자동 갱신 조건: service=${!!service}, sheetSent=${sheetSent}`);
    
    // ★ v3.6.25: service만 있으면 자동 갱신 시도 (sheetSent 조건 제거)
    if (service) {
      try {
        // 4-1. LOT 매칭 자동 생성 (해당 날짜만)
        console.log(`[production/simple-batch] LOT 매칭 생성 시작: ${actualProdDate}`);
        lotMatchingResult = await service.rebuildLotMatchingForDates([actualProdDate]);
        console.log(`[production/simple-batch] LOT 매칭 완료: ${lotMatchingResult?.totalRows || 0}행`);
      } catch (lotError: any) {
        console.error('[production/simple-batch] LOT 매칭 실패:', lotError.message, lotError.stack);
        autoUpdateError = `LOT매칭 실패: ${lotError.message}`;
      }
      
      try {
        // 4-2. 일별수불부 자동 추가 (전일 현재고 → 당일 전일재고 연속성 유지)
        console.log(`[production/simple-batch] 일별수불부 추가 시작: ${actualProdDate}`);
        dailyStockResult = await service.addDailyStockDate(actualProdDate);
        console.log(`[production/simple-batch] 일별수불부 완료: ${dailyStockResult?.new_rows || 0}행`);
      } catch (stockError: any) {
        console.error('[production/simple-batch] 일별수불부 실패:', stockError.message, stockError.stack);
        autoUpdateError = (autoUpdateError ? autoUpdateError + ' / ' : '') + `일별수불부 실패: ${stockError.message}`;
      }
    } else {
      console.warn(`[production/simple-batch] 자동 갱신 건너뜀: service=${!!service}`);
      autoUpdateError = 'Google Sheets 서비스 없음 (환경변수 확인 필요)';
    }
    
    return c.json({
      success: true,
      prod_date: actualProdDate,
      lot_number: lotNum,
      items_count: items.length,
      db_saved: dbSaved,
      sheet_sent: sheetSent,
      orders_updated: ordersUpdated,
      lot_matching: lotMatchingResult ? { success: true, rows: lotMatchingResult.totalRows } : { success: false, error: autoUpdateError },
      daily_stock: dailyStockResult ? { success: true, rows: dailyStockResult.new_rows } : { success: false, error: autoUpdateError },
      auto_update_error: autoUpdateError,
      // ★★★ v3.5.95: 만료 LOT 경고 추가 ★★★
      expired_lots_warning: lotMatchingResult?.expiredLotsWarning || null,
      message: `${items.length}건 생산 등록 완료${lotMatchingResult ? ' + LOT매칭 자동생성' : ''}${dailyStockResult ? ' + 일별수불부 자동추가' : ''}`,
      note: autoUpdateError ? `자동 갱신 오류: ${autoUpdateError}` : '생산 등록 시 LOT 매칭과 일별수불부가 자동으로 연속성 있게 갱신됩니다.'
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 생산 현황 조회 (단순) =====
productionRoutes.get('/simple-list', async (c) => {
  try {
    const prod_date = c.req.query('prod_date');
    const lot_number = c.req.query('lot_number');
    
    let query = `
      SELECT p.id, p.product_code, p.quantity, p.prod_date, p.lot_number, p.channel, p.created_at,
             COALESCE(pi.production_name, p.product_code) as product_name
      FROM production p
      LEFT JOIN production_items pi ON p.product_code = pi.production_code
      WHERE 1=1
    `;
    const params: any[] = [];
    
    if (prod_date) {
      query += ' AND p.prod_date = ?';
      params.push(prod_date);
    }
    if (lot_number) {
      query += ' AND p.lot_number = ?';
      params.push(lot_number);
    }
    
    query += ' ORDER BY p.created_at DESC LIMIT 500';
    
    const result = await c.env.DB.prepare(query).bind(...params).all<any>();
    
    return c.json({
      success: true,
      total_items: result.results?.length || 0,
      total_quantity: result.results?.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0) || 0,
      items: result.results || []
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});
