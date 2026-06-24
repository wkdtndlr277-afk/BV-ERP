/**
 * 🛡️ 데이터 정합성 검증 API
 * 
 * /api/validate/* - 100% 오류 없는 데이터를 위한 검증 엔드포인트
 */

import { Hono } from 'hono';
import { DataValidator, ValidationResult, ValidationError } from '../services/DataValidator';
import { GoogleSheetsService } from '../services/GoogleSheetsService';

type Bindings = {
  DB: D1Database;
  GOOGLE_CLIENT_EMAIL?: string;
  GOOGLE_PRIVATE_KEY?: string;
};

const validateRoutes = new Hono<{ Bindings: Bindings }>();

// 서비스 인스턴스 생성 헬퍼
function getSheetService(c: any): GoogleSheetsService | null {
  const clientEmail = c.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = c.env.GOOGLE_PRIVATE_KEY;
  
  if (!clientEmail || !privateKey) return null;
  
  const formattedKey = privateKey.replace(/\\n/g, '\n');
  return new GoogleSheetsService(clientEmail, formattedKey);
}

// ==========================================
// 1. BOM 정합성 검증
// ==========================================

/**
 * GET /api/validate/bom
 * BOM 전체 정합성 검증
 */
validateRoutes.get('/bom', async (c) => {
  try {
    // DB에서 데이터 조회
    const bomData = await c.env.DB.prepare(`
      SELECT 
        pb.production_code as product_code,
        COALESCE(pi.production_name, pb.production_code) as product_name,
        pb.material_code,
        COALESCE(pb.material_name, m.item_name) as material_name,
        pb.quantity,
        COALESCE(pb.unit, 'g') as unit
      FROM production_bom pb
      LEFT JOIN production_items pi ON pb.production_code = pi.production_code
      LEFT JOIN master m ON pb.material_code = m.item_code
    `).all<any>();
    
    const productData = await c.env.DB.prepare(`
      SELECT production_code FROM production_items
    `).all<any>();
    
    const materialData = await c.env.DB.prepare(`
      SELECT item_code FROM master WHERE category = '원료' OR item_code LIKE 'R%' OR item_code LIKE 'RM%'
    `).all<any>();
    
    const bomRecords = (bomData.results || []).map(r => ({
      product_code: r.product_code,
      product_name: r.product_name,
      material_code: r.material_code,
      material_name: r.material_name,
      quantity: parseFloat(r.quantity) || 0,
      unit: r.unit || 'g'
    }));
    
    const productCodes = (productData.results || []).map(r => r.production_code);
    const materialCodes = (materialData.results || []).map(r => r.item_code);
    
    const result = DataValidator.validateBOM(bomRecords, productCodes, materialCodes);
    
    return c.json({
      success: true,
      validation_type: 'BOM',
      ...result,
      message: result.valid 
        ? '✅ BOM 정합성 검증 통과' 
        : `❌ BOM 오류 ${result.summary.failed}건 발견`
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ==========================================
// 2. 재고 정합성 검증
// ==========================================

/**
 * GET /api/validate/daily-stock?date=YYYY-MM-DD
 * 일별 재고 정합성 검증
 */
validateRoutes.get('/daily-stock', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }
  
  try {
    const date = c.req.query('date');
    
    // 구글 시트에서 일별수불부 조회
    const sheetData = await service.readSheet('일별수불부', 'A2:H');
    
    let records = sheetData.map(row => ({
      date: row[0]?.toString().replace(/^'/, '') || '',
      item_code: row[1] || '',
      item_name: row[2] || '',
      prev_stock: parseFloat(row[3]) || 0,
      inbound_qty: parseFloat(row[4]) || 0,
      usage_qty: parseFloat(row[5]) || 0,
      current_stock: parseFloat(row[6]) || 0
    }));
    
    if (date) {
      records = records.filter(r => r.date === date);
    }
    
    const result = DataValidator.validateDailyStock(records);
    
    return c.json({
      success: true,
      validation_type: 'DAILY_STOCK',
      date: date || 'ALL',
      records_checked: records.length,
      ...result,
      message: result.valid 
        ? '✅ 일별 재고 정합성 검증 통과' 
        : `❌ 재고 계산 오류 ${result.summary.failed}건 발견`
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * GET /api/validate/stock-continuity
 * 이월 재고 연속성 검증
 */
validateRoutes.get('/stock-continuity', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }
  
  try {
    const sheetData = await service.readSheet('일별수불부', 'A2:H');
    
    const records = sheetData.map(row => ({
      date: row[0]?.toString().replace(/^'/, '') || '',
      item_code: row[1] || '',
      item_name: row[2] || '',
      prev_stock: parseFloat(row[3]) || 0,
      inbound_qty: parseFloat(row[4]) || 0,
      usage_qty: parseFloat(row[5]) || 0,
      current_stock: parseFloat(row[6]) || 0
    }));
    
    const result = DataValidator.validateStockContinuity(records);
    
    return c.json({
      success: true,
      validation_type: 'STOCK_CONTINUITY',
      records_checked: records.length,
      ...result,
      message: result.valid 
        ? '✅ 이월 재고 연속성 검증 통과' 
        : `❌ 이월 불일치 ${result.summary.failed}건 발견`
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ==========================================
// 3. 발주서 업로드 검증
// ==========================================

/**
 * POST /api/validate/orders
 * 발주서 데이터 검증 (업로드 전 검증)
 */
validateRoutes.post('/orders', async (c) => {
  try {
    const body = await c.req.json();
    const { orders } = body;
    
    if (!orders || !Array.isArray(orders)) {
      return c.json({ success: false, error: 'orders 배열 필수' }, 400);
    }
    
    // 유효한 제품코드 조회
    const productData = await c.env.DB.prepare(`
      SELECT production_code FROM production_items
      UNION
      SELECT item_code FROM master WHERE category = '제품'
    `).all<any>();
    
    const validProductCodes = new Set(
      (productData.results || []).map(r => 
        (r.production_code || r.item_code || '').toUpperCase()
      )
    );
    
    const orderRecords = orders.map((o: any) => ({
      order_date: o.order_date || o.날짜 || '',
      product_code: o.product_code || o.제품코드 || '',
      product_name: o.product_name || o.제품명 || '',
      quantity: parseInt(o.quantity || o.수량) || 0,
      delivery_date: o.delivery_date || o.배송일 || '',
      channel: o.channel || o.채널 || ''
    }));
    
    const result = DataValidator.validateOrders(orderRecords, validProductCodes);
    
    return c.json({
      success: true,
      validation_type: 'ORDERS',
      records_checked: orderRecords.length,
      ...result,
      message: result.valid 
        ? `✅ 발주서 ${orderRecords.length}건 검증 통과` 
        : `❌ 발주서 오류 ${result.summary.failed}건 발견`,
      can_upload: result.valid
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ==========================================
// 4. FEFO 재고 검증
// ==========================================

/**
 * GET /api/validate/fefo?material_code=RM001&required_qty=10
 * FEFO 차감 가능 여부 검증
 */
validateRoutes.get('/fefo', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }
  
  try {
    const materialCode = c.req.query('material_code');
    const requiredQty = parseFloat(c.req.query('required_qty') || '0');
    
    if (!materialCode) {
      return c.json({ success: false, error: 'material_code 필수' }, 400);
    }
    
    // 원료입고 데이터 조회
    const inboundData = await service.readSheet('원료입고', 'A2:I');
    
    const inboundRecords = inboundData.map(row => ({
      lot_number: row[3] || '',
      item_code: row[1] || '',
      item_name: row[2] || '',
      inbound_date: row[0]?.toString().replace(/^'/, '') || '',
      origin_qty: parseFloat(row[4]) || 0,
      remain_qty: parseFloat(row[8]) || 0,
      expiry_date: row[7]?.toString().replace(/^'/, '') || ''
    }));
    
    const result = DataValidator.validateFEFOAvailability(
      materialCode,
      requiredQty,
      inboundRecords
    );
    
    // 가용 재고 계산
    const materialLots = inboundRecords.filter(r => 
      r.item_code === materialCode && r.remain_qty > 0
    ).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
    
    const totalAvailable = materialLots.reduce((sum, lot) => sum + lot.remain_qty, 0);
    
    return c.json({
      success: true,
      validation_type: 'FEFO',
      material_code: materialCode,
      required_qty: requiredQty,
      available_qty: totalAvailable,
      shortage: Math.max(0, requiredQty - totalAvailable),
      lots: materialLots.map(lot => ({
        lot_number: lot.lot_number,
        remain_qty: lot.remain_qty,
        expiry_date: lot.expiry_date
      })),
      ...result,
      message: result.valid 
        ? `✅ ${materialCode} 재고 충분 (가용: ${totalAvailable.toFixed(2)}kg)` 
        : `❌ ${materialCode} 재고 부족 (필요: ${requiredQty}kg, 가용: ${totalAvailable.toFixed(2)}kg)`
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ==========================================
// 5. 생산 전 검증
// ==========================================

/**
 * POST /api/validate/production
 * 생산 실적 입력 전 검증
 */
validateRoutes.post('/production', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }
  
  try {
    const body = await c.req.json();
    const { product_code, quantity, prod_date } = body;
    
    if (!product_code || !quantity) {
      return c.json({ success: false, error: 'product_code, quantity 필수' }, 400);
    }
    
    // BOM 조회
    const bomData = await c.env.DB.prepare(`
      SELECT 
        production_code as product_code,
        material_code,
        material_name,
        quantity,
        unit
      FROM production_bom
      WHERE production_code = ?
    `).bind(product_code).all<any>();
    
    const bomRecords = (bomData.results || []).map(r => ({
      product_code: r.product_code,
      product_name: '',
      material_code: r.material_code,
      material_name: r.material_name,
      quantity: parseFloat(r.quantity) || 0,
      unit: r.unit || 'g'
    }));
    
    // 원료입고 데이터 조회
    const inboundData = await service.readSheet('원료입고', 'A2:I');
    
    const inboundRecords = inboundData.map(row => ({
      lot_number: row[3] || '',
      item_code: row[1] || '',
      item_name: row[2] || '',
      inbound_date: row[0]?.toString().replace(/^'/, '') || '',
      origin_qty: parseFloat(row[4]) || 0,
      remain_qty: parseFloat(row[8]) || 0,
      expiry_date: row[7]?.toString().replace(/^'/, '') || ''
    }));
    
    const production = {
      prod_date: prod_date || new Date().toISOString().split('T')[0],
      product_code,
      product_name: '',
      quantity: parseInt(quantity),
      lot_number: '',
      channel: ''
    };
    
    const result = DataValidator.validateProduction(production, bomRecords, inboundRecords);
    
    // 필요 원료량 계산
    const materialRequirements = bomRecords.map(bom => {
      const requiredKg = (bom.quantity * quantity) / 1000;
      const available = inboundRecords
        .filter(r => r.item_code === bom.material_code && r.remain_qty > 0)
        .reduce((sum, r) => sum + r.remain_qty, 0);
      
      return {
        material_code: bom.material_code,
        material_name: bom.material_name,
        required_kg: requiredKg,
        available_kg: available,
        sufficient: available >= requiredKg
      };
    });
    
    return c.json({
      success: true,
      validation_type: 'PRODUCTION',
      product_code,
      quantity,
      bom_count: bomRecords.length,
      material_requirements: materialRequirements,
      ...result,
      message: result.valid 
        ? `✅ ${product_code} x ${quantity} 생산 가능` 
        : `❌ 생산 불가 - ${result.errors.map(e => e.message).join(', ')}`,
      can_produce: result.valid
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ==========================================
// 6. 종합 정합성 리포트
// ==========================================

/**
 * GET /api/validate/full-report
 * 전체 시스템 정합성 리포트
 */
validateRoutes.get('/full-report', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }
  
  try {
    // 1. BOM 데이터
    const bomData = await c.env.DB.prepare(`
      SELECT 
        pb.production_code as product_code,
        COALESCE(pi.production_name, pb.production_code) as product_name,
        pb.material_code,
        COALESCE(pb.material_name, m.item_name) as material_name,
        pb.quantity,
        COALESCE(pb.unit, 'g') as unit
      FROM production_bom pb
      LEFT JOIN production_items pi ON pb.production_code = pi.production_code
      LEFT JOIN master m ON pb.material_code = m.item_code
    `).all<any>();
    
    const bomRecords = (bomData.results || []).map(r => ({
      product_code: r.product_code,
      product_name: r.product_name,
      material_code: r.material_code,
      material_name: r.material_name,
      quantity: parseFloat(r.quantity) || 0,
      unit: r.unit || 'g'
    }));
    
    // 2. 제품/원료 코드
    const productData = await c.env.DB.prepare(`SELECT production_code FROM production_items`).all<any>();
    const materialData = await c.env.DB.prepare(`SELECT item_code FROM master WHERE item_code LIKE 'R%'`).all<any>();
    
    const productCodes = (productData.results || []).map(r => r.production_code);
    const materialCodes = (materialData.results || []).map(r => r.item_code);
    
    // 3. 일별수불부
    const dailyStockData = await service.readSheet('일별수불부', 'A2:H');
    const dailyStockRecords = dailyStockData.map(row => ({
      date: row[0]?.toString().replace(/^'/, '') || '',
      item_code: row[1] || '',
      item_name: row[2] || '',
      prev_stock: parseFloat(row[3]) || 0,
      inbound_qty: parseFloat(row[4]) || 0,
      usage_qty: parseFloat(row[5]) || 0,
      current_stock: parseFloat(row[6]) || 0
    }));
    
    // 4. 원료입고
    const inboundData = await service.readSheet('원료입고', 'A2:I');
    const inboundRecords = inboundData.map(row => ({
      lot_number: row[3] || '',
      item_code: row[1] || '',
      item_name: row[2] || '',
      inbound_date: row[0]?.toString().replace(/^'/, '') || '',
      origin_qty: parseFloat(row[4]) || 0,
      remain_qty: parseFloat(row[8]) || 0,
      expiry_date: row[7]?.toString().replace(/^'/, '') || ''
    }));
    
    // 5. 종합 리포트 생성
    const report = DataValidator.generateFullReport(
      bomRecords,
      productCodes,
      materialCodes,
      dailyStockRecords,
      inboundRecords
    );
    
    return c.json({
      success: true,
      validation_type: 'FULL_REPORT',
      generated_at: new Date().toISOString(),
      data_counts: {
        bom_records: bomRecords.length,
        products: productCodes.length,
        materials: materialCodes.length,
        daily_stock_records: dailyStockRecords.length,
        inbound_lots: inboundRecords.length
      },
      ...report,
      message: report.overall_valid 
        ? '✅ 전체 시스템 정합성 검증 통과' 
        : `❌ 시스템 오류 발견: ${report.summary.critical_issues.join(', ')}`
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ==========================================
// 7. 실시간 검증 (생산 시 자동 호출)
// ==========================================

/**
 * POST /api/validate/realtime
 * 생산실적 입력 시 실시간 검증 (GAS에서 호출)
 */
validateRoutes.post('/realtime', async (c) => {
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }
  
  try {
    const body = await c.req.json();
    const { prod_date, product_code, quantity } = body;
    
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    
    // 1. BOM 존재 확인
    const bomCheck = await c.env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM production_bom WHERE production_code = ?
    `).bind(product_code).first<any>();
    
    if (!bomCheck || bomCheck.cnt === 0) {
      errors.push({
        code: 'REALTIME_NO_BOM',
        severity: 'ERROR',
        field: 'product_code',
        message: `${product_code}에 BOM이 없습니다. 원료 사용량이 계산되지 않습니다!`,
        suggestion: 'BOM마스터에 먼저 등록하세요'
      });
    }
    
    // 2. 원료별 재고 확인
    const bomData = await c.env.DB.prepare(`
      SELECT material_code, material_name, quantity, unit
      FROM production_bom WHERE production_code = ?
    `).bind(product_code).all<any>();
    
    const inboundData = await service.readSheet('원료입고', 'A2:I');
    const inboundMap = new Map<string, number>();
    
    for (const row of inboundData) {
      const itemCode = row[1];
      const remainQty = parseFloat(row[8]) || 0;
      if (remainQty > 0) {
        inboundMap.set(itemCode, (inboundMap.get(itemCode) || 0) + remainQty);
      }
    }
    
    const EXCLUDE = ['RM184']; // 정제수 제외
    
    for (const bom of (bomData.results || [])) {
      if (EXCLUDE.includes(bom.material_code)) continue;
      
      const requiredKg = (parseFloat(bom.quantity) * quantity) / 1000;
      const availableKg = inboundMap.get(bom.material_code) || 0;
      
      if (availableKg < requiredKg) {
        errors.push({
          code: 'REALTIME_STOCK_SHORTAGE',
          severity: 'ERROR',
          field: bom.material_code,
          message: `${bom.material_name}(${bom.material_code}) 재고 부족`,
          expected: requiredKg.toFixed(3),
          actual: availableKg.toFixed(3),
          suggestion: `필요: ${requiredKg.toFixed(3)}kg, 가용: ${availableKg.toFixed(3)}kg, 부족: ${(requiredKg - availableKg).toFixed(3)}kg`
        });
      }
    }
    
    const valid = errors.length === 0;
    
    return c.json({
      success: true,
      validation_type: 'REALTIME',
      prod_date,
      product_code,
      quantity,
      valid,
      errors,
      warnings,
      message: valid 
        ? `✅ 검증 통과: ${product_code} x ${quantity} 생산 가능`
        : `❌ 검증 실패: ${errors.map(e => e.message).join(' | ')}`,
      can_proceed: valid
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default validateRoutes;
