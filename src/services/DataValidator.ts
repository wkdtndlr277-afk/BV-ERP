/**
 * ============================================================
 * 🛡️ 데이터 정합성 검증 시스템 v1.0
 * ============================================================
 * 
 * 100% 오류 없는 데이터를 위한 검증 로직
 * 
 * 검증 항목:
 * 1. BOM 정합성 - 제품별 BOM 존재, 배합비 단위, 합계 검증
 * 2. 재고 정합성 - 전일재고+입고-사용=현재고 공식 검증
 * 3. 발주서 검증 - 필수값, 포맷, 제품코드 존재 여부
 * 4. FEFO 검증 - 음수 잔량 방지, 재고 부족 경고
 * 5. 이월 재고 검증 - 일별 재고 연속성 검증
 * ============================================================
 */

// =============== 타입 정의 ===============

export interface ValidationError {
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  field: string;
  message: string;
  expected?: any;
  actual?: any;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  summary: {
    total_checks: number;
    passed: number;
    failed: number;
    warnings: number;
  };
}

export interface BOMRecord {
  product_code: string;
  product_name: string;
  material_code: string;
  material_name: string;
  quantity: number;
  unit: string;
}

export interface InboundRecord {
  lot_number: string;
  item_code: string;
  item_name: string;
  inbound_date: string;
  origin_qty: number;
  remain_qty: number;
  expiry_date: string;
}

export interface DailyStockRecord {
  date: string;
  item_code: string;
  item_name: string;
  prev_stock: number;
  inbound_qty: number;
  usage_qty: number;
  current_stock: number;
}

export interface ProductionRecord {
  prod_date: string;
  product_code: string;
  product_name: string;
  quantity: number;
  lot_number: string;
  channel: string;
}

export interface OrderRecord {
  order_date: string;
  product_code: string;
  product_name: string;
  quantity: number;
  delivery_date: string;
  channel: string;
}

// =============== 검증 클래스 ===============

export class DataValidator {
  
  // ==========================================
  // 1. BOM 정합성 검증
  // ==========================================
  
  /**
   * BOM 전체 정합성 검증
   */
  static validateBOM(
    bomRecords: BOMRecord[],
    productCodes: string[],
    materialCodes: string[]
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    let totalChecks = 0;
    
    // 1-1. 모든 제품에 BOM이 있는지 검증
    const bomProductCodes = new Set(bomRecords.map(b => b.product_code));
    for (const productCode of productCodes) {
      totalChecks++;
      if (!bomProductCodes.has(productCode)) {
        errors.push({
          code: 'BOM_MISSING',
          severity: 'ERROR',
          field: 'product_code',
          message: `제품 ${productCode}에 BOM이 없습니다`,
          actual: productCode,
          suggestion: 'BOM마스터에 해당 제품의 배합표를 등록하세요'
        });
      }
    }
    
    // 1-2. BOM의 원료코드가 마스터에 있는지 검증
    const materialCodeSet = new Set(materialCodes);
    for (const bom of bomRecords) {
      totalChecks++;
      if (!materialCodeSet.has(bom.material_code)) {
        errors.push({
          code: 'BOM_INVALID_MATERIAL',
          severity: 'ERROR',
          field: 'material_code',
          message: `BOM의 원료 ${bom.material_code}가 마스터에 없습니다`,
          actual: bom.material_code,
          suggestion: '품목 마스터에 해당 원료를 등록하세요'
        });
      }
    }
    
    // 1-3. 배합비 단위 검증 (g 단위여야 함)
    for (const bom of bomRecords) {
      totalChecks++;
      if (bom.unit && bom.unit.toLowerCase() !== 'g') {
        warnings.push({
          code: 'BOM_UNIT_WARNING',
          severity: 'WARNING',
          field: 'unit',
          message: `${bom.product_code}의 ${bom.material_code} 배합비 단위가 'g'가 아닙니다`,
          expected: 'g',
          actual: bom.unit,
          suggestion: '배합비 단위를 g로 통일하세요 (kg × 1000 = g)'
        });
      }
      
      // 1-4. 배합비가 비정상적으로 큰지 검증 (10kg = 10000g 초과)
      totalChecks++;
      if (bom.quantity > 10000) {
        warnings.push({
          code: 'BOM_QUANTITY_WARNING',
          severity: 'WARNING',
          field: 'quantity',
          message: `${bom.product_code}의 ${bom.material_code} 배합비가 비정상적으로 큽니다 (${bom.quantity}g)`,
          actual: bom.quantity,
          suggestion: '단위가 g인지 확인하세요. kg로 입력했다면 ×1000 필요'
        });
      }
      
      // 1-5. 배합비가 0 또는 음수인지 검증
      totalChecks++;
      if (bom.quantity <= 0) {
        errors.push({
          code: 'BOM_INVALID_QUANTITY',
          severity: 'ERROR',
          field: 'quantity',
          message: `${bom.product_code}의 ${bom.material_code} 배합비가 0 이하입니다`,
          actual: bom.quantity,
          suggestion: '배합비는 0보다 커야 합니다'
        });
      }
    }
    
    // 1-6. 제품별 BOM 배합비 합계 검증 (정상 범위: 100g ~ 50000g)
    const productBOMTotals = new Map<string, number>();
    for (const bom of bomRecords) {
      const current = productBOMTotals.get(bom.product_code) || 0;
      productBOMTotals.set(bom.product_code, current + bom.quantity);
    }
    
    for (const [productCode, total] of productBOMTotals) {
      totalChecks++;
      if (total < 100) {
        warnings.push({
          code: 'BOM_TOTAL_LOW',
          severity: 'WARNING',
          field: 'total_quantity',
          message: `${productCode} BOM 총 배합량이 너무 적습니다 (${total}g)`,
          actual: total,
          suggestion: '배합비 단위를 확인하세요'
        });
      }
      if (total > 50000) {
        warnings.push({
          code: 'BOM_TOTAL_HIGH',
          severity: 'WARNING',
          field: 'total_quantity',
          message: `${productCode} BOM 총 배합량이 너무 큽니다 (${total}g = ${(total/1000).toFixed(1)}kg)`,
          actual: total,
          suggestion: '배합비 단위를 확인하세요'
        });
      }
    }
    
    const passed = totalChecks - errors.length - warnings.length;
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      summary: {
        total_checks: totalChecks,
        passed,
        failed: errors.length,
        warnings: warnings.length
      }
    };
  }
  
  // ==========================================
  // 2. 재고 정합성 검증
  // ==========================================
  
  /**
   * 일별 재고 정합성 검증
   * 공식: 현재고 = 전일재고 + 입고 - 사용
   */
  static validateDailyStock(records: DailyStockRecord[]): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    let totalChecks = 0;
    
    for (const record of records) {
      // 2-1. 현재고 공식 검증
      totalChecks++;
      const expectedCurrent = record.prev_stock + record.inbound_qty - record.usage_qty;
      const diff = Math.abs(expectedCurrent - record.current_stock);
      
      if (diff > 0.001) { // 소수점 오차 허용
        errors.push({
          code: 'STOCK_FORMULA_ERROR',
          severity: 'ERROR',
          field: 'current_stock',
          message: `${record.date} ${record.item_code} 재고 계산 오류`,
          expected: expectedCurrent.toFixed(3),
          actual: record.current_stock.toFixed(3),
          suggestion: `전일재고(${record.prev_stock}) + 입고(${record.inbound_qty}) - 사용(${record.usage_qty}) = ${expectedCurrent.toFixed(3)}`
        });
      }
      
      // 2-2. 음수 재고 검증
      totalChecks++;
      if (record.current_stock < 0) {
        errors.push({
          code: 'STOCK_NEGATIVE',
          severity: 'ERROR',
          field: 'current_stock',
          message: `${record.date} ${record.item_code} 재고가 음수입니다`,
          actual: record.current_stock,
          suggestion: '입고 누락 또는 사용량 과다 입력 확인'
        });
      }
      
      // 2-3. 사용량이 전일재고+입고보다 큰지 검증
      totalChecks++;
      const available = record.prev_stock + record.inbound_qty;
      if (record.usage_qty > available + 0.001) {
        errors.push({
          code: 'STOCK_OVERDRAW',
          severity: 'ERROR',
          field: 'usage_qty',
          message: `${record.date} ${record.item_code} 사용량이 가용재고를 초과`,
          expected: `<= ${available.toFixed(3)}`,
          actual: record.usage_qty.toFixed(3),
          suggestion: '재고 부족 상태에서 생산 불가'
        });
      }
      
      // 2-4. 비정상적으로 큰 사용량 경고
      totalChecks++;
      if (record.usage_qty > 1000) { // 1000kg 초과
        warnings.push({
          code: 'STOCK_USAGE_HIGH',
          severity: 'WARNING',
          field: 'usage_qty',
          message: `${record.date} ${record.item_code} 사용량이 매우 큽니다`,
          actual: record.usage_qty,
          suggestion: '단위(kg)와 수량을 확인하세요'
        });
      }
    }
    
    const passed = totalChecks - errors.length - warnings.length;
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      summary: {
        total_checks: totalChecks,
        passed,
        failed: errors.length,
        warnings: warnings.length
      }
    };
  }
  
  /**
   * 이월 재고 연속성 검증
   * 전일 현재고 = 금일 전일재고
   */
  static validateStockContinuity(
    records: DailyStockRecord[]
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    let totalChecks = 0;
    
    // 품목별, 날짜별 정렬
    const byItem = new Map<string, DailyStockRecord[]>();
    for (const r of records) {
      if (!byItem.has(r.item_code)) byItem.set(r.item_code, []);
      byItem.get(r.item_code)!.push(r);
    }
    
    for (const [itemCode, itemRecords] of byItem) {
      // 날짜순 정렬
      itemRecords.sort((a, b) => a.date.localeCompare(b.date));
      
      for (let i = 1; i < itemRecords.length; i++) {
        const prev = itemRecords[i - 1];
        const curr = itemRecords[i];
        
        totalChecks++;
        const diff = Math.abs(prev.current_stock - curr.prev_stock);
        
        if (diff > 0.001) {
          errors.push({
            code: 'STOCK_CONTINUITY_ERROR',
            severity: 'ERROR',
            field: 'prev_stock',
            message: `${itemCode} 이월재고 불일치: ${prev.date} → ${curr.date}`,
            expected: prev.current_stock.toFixed(3),
            actual: curr.prev_stock.toFixed(3),
            suggestion: `${prev.date} 현재고(${prev.current_stock})가 ${curr.date} 전일재고(${curr.prev_stock})와 다릅니다`
          });
        }
      }
    }
    
    const passed = totalChecks - errors.length;
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      summary: {
        total_checks: totalChecks,
        passed,
        failed: errors.length,
        warnings: warnings.length
      }
    };
  }
  
  // ==========================================
  // 3. 발주서 업로드 검증
  // ==========================================
  
  /**
   * 발주서 데이터 검증
   */
  static validateOrders(
    orders: OrderRecord[],
    validProductCodes: Set<string>
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    let totalChecks = 0;
    
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      const rowNum = i + 2; // 헤더 제외, 1-indexed
      
      // 3-1. 필수값 검증
      totalChecks++;
      if (!order.product_code || order.product_code.trim() === '') {
        errors.push({
          code: 'ORDER_MISSING_PRODUCT_CODE',
          severity: 'ERROR',
          field: 'product_code',
          message: `${rowNum}행: 제품코드가 없습니다`,
          suggestion: '제품코드는 필수입니다'
        });
        continue; // 제품코드 없으면 나머지 검증 스킵
      }
      
      // 3-2. 제품코드 존재 여부 검증
      totalChecks++;
      const cleanCode = order.product_code.trim().toUpperCase();
      if (!validProductCodes.has(cleanCode)) {
        errors.push({
          code: 'ORDER_INVALID_PRODUCT_CODE',
          severity: 'ERROR',
          field: 'product_code',
          message: `${rowNum}행: 제품코드 '${order.product_code}'가 마스터에 없습니다`,
          actual: order.product_code,
          suggestion: '제품 마스터에 등록된 코드인지 확인하세요'
        });
      }
      
      // 3-3. 수량 검증
      totalChecks++;
      if (!order.quantity || order.quantity <= 0) {
        errors.push({
          code: 'ORDER_INVALID_QUANTITY',
          severity: 'ERROR',
          field: 'quantity',
          message: `${rowNum}행: 수량이 유효하지 않습니다`,
          actual: order.quantity,
          suggestion: '수량은 0보다 커야 합니다'
        });
      }
      
      // 3-4. 수량이 비정상적으로 큰지 검증
      totalChecks++;
      if (order.quantity > 10000) {
        warnings.push({
          code: 'ORDER_QUANTITY_HIGH',
          severity: 'WARNING',
          field: 'quantity',
          message: `${rowNum}행: 수량이 매우 큽니다 (${order.quantity})`,
          actual: order.quantity,
          suggestion: '수량 단위를 확인하세요'
        });
      }
      
      // 3-5. 날짜 형식 검증
      totalChecks++;
      if (order.order_date && !/^\d{4}-\d{2}-\d{2}$/.test(order.order_date)) {
        errors.push({
          code: 'ORDER_INVALID_DATE',
          severity: 'ERROR',
          field: 'order_date',
          message: `${rowNum}행: 날짜 형식이 잘못되었습니다`,
          expected: 'YYYY-MM-DD',
          actual: order.order_date,
          suggestion: '날짜 형식을 YYYY-MM-DD로 변환하세요'
        });
      }
      
      // 3-6. 배송일이 주문일보다 앞서는지 검증
      totalChecks++;
      if (order.order_date && order.delivery_date) {
        if (order.delivery_date < order.order_date) {
          errors.push({
            code: 'ORDER_DATE_LOGIC',
            severity: 'ERROR',
            field: 'delivery_date',
            message: `${rowNum}행: 배송일이 주문일보다 앞섭니다`,
            expected: `>= ${order.order_date}`,
            actual: order.delivery_date,
            suggestion: '배송일은 주문일 이후여야 합니다'
          });
        }
      }
    }
    
    // 3-7. 중복 검증
    const seen = new Set<string>();
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      const key = `${order.order_date}|${order.product_code}|${order.quantity}|${order.channel}`;
      
      totalChecks++;
      if (seen.has(key)) {
        warnings.push({
          code: 'ORDER_DUPLICATE',
          severity: 'WARNING',
          field: 'row',
          message: `${i + 2}행: 중복된 발주 데이터`,
          actual: key,
          suggestion: '같은 날짜, 제품, 수량, 채널의 발주가 이미 있습니다'
        });
      }
      seen.add(key);
    }
    
    const passed = totalChecks - errors.length - warnings.length;
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      summary: {
        total_checks: totalChecks,
        passed,
        failed: errors.length,
        warnings: warnings.length
      }
    };
  }
  
  // ==========================================
  // 4. FEFO 차감 검증
  // ==========================================
  
  /**
   * FEFO 차감 전 재고 충분 여부 검증
   */
  static validateFEFOAvailability(
    materialCode: string,
    requiredQty: number,
    inboundRecords: InboundRecord[]
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    let totalChecks = 0;
    
    // 해당 원료의 가용 재고 계산
    const materialLots = inboundRecords.filter(r => 
      r.item_code === materialCode && r.remain_qty > 0
    );
    
    const totalAvailable = materialLots.reduce((sum, lot) => sum + lot.remain_qty, 0);
    
    // 4-1. 재고 충분 여부
    totalChecks++;
    if (totalAvailable < requiredQty) {
      errors.push({
        code: 'FEFO_INSUFFICIENT_STOCK',
        severity: 'ERROR',
        field: 'remain_qty',
        message: `${materialCode} 재고 부족`,
        expected: requiredQty.toFixed(3),
        actual: totalAvailable.toFixed(3),
        suggestion: `필요량 ${requiredQty.toFixed(3)}kg, 가용재고 ${totalAvailable.toFixed(3)}kg, 부족량 ${(requiredQty - totalAvailable).toFixed(3)}kg`
      });
    }
    
    // 4-2. 유통기한 임박 LOT 경고
    const today = new Date();
    const warningDays = 30;
    
    for (const lot of materialLots) {
      totalChecks++;
      if (lot.expiry_date) {
        const expiryDate = new Date(lot.expiry_date);
        const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysUntilExpiry < 0) {
          errors.push({
            code: 'FEFO_EXPIRED_LOT',
            severity: 'ERROR',
            field: 'expiry_date',
            message: `${materialCode} LOT ${lot.lot_number} 유통기한 만료`,
            actual: lot.expiry_date,
            suggestion: '만료된 LOT는 사용할 수 없습니다'
          });
        } else if (daysUntilExpiry <= warningDays) {
          warnings.push({
            code: 'FEFO_EXPIRY_WARNING',
            severity: 'WARNING',
            field: 'expiry_date',
            message: `${materialCode} LOT ${lot.lot_number} 유통기한 ${daysUntilExpiry}일 남음`,
            actual: lot.expiry_date,
            suggestion: '우선 사용 권장'
          });
        }
      }
    }
    
    // 4-3. 음수 잔량 LOT 검증
    for (const lot of inboundRecords.filter(r => r.item_code === materialCode)) {
      totalChecks++;
      if (lot.remain_qty < 0) {
        errors.push({
          code: 'FEFO_NEGATIVE_REMAIN',
          severity: 'ERROR',
          field: 'remain_qty',
          message: `${materialCode} LOT ${lot.lot_number} 잔량이 음수`,
          actual: lot.remain_qty,
          suggestion: '데이터 오류입니다. 잔량을 확인하세요'
        });
      }
    }
    
    const passed = totalChecks - errors.length - warnings.length;
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      summary: {
        total_checks: totalChecks,
        passed,
        failed: errors.length,
        warnings: warnings.length
      }
    };
  }
  
  // ==========================================
  // 5. 생산 데이터 검증
  // ==========================================
  
  /**
   * 생산 실적 검증
   */
  static validateProduction(
    production: ProductionRecord,
    bomRecords: BOMRecord[],
    inboundRecords: InboundRecord[]
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    let totalChecks = 0;
    
    // 5-1. BOM 존재 여부
    totalChecks++;
    const productBOM = bomRecords.filter(b => b.product_code === production.product_code);
    if (productBOM.length === 0) {
      errors.push({
        code: 'PROD_NO_BOM',
        severity: 'ERROR',
        field: 'product_code',
        message: `${production.product_code}에 BOM이 없습니다`,
        suggestion: 'BOM 없이 생산하면 원료 사용량이 계산되지 않습니다'
      });
      
      return {
        valid: false,
        errors,
        warnings,
        summary: { total_checks: totalChecks, passed: 0, failed: 1, warnings: 0 }
      };
    }
    
    // 5-2. 각 원료별 재고 충분 여부
    for (const bom of productBOM) {
      const requiredKg = (bom.quantity * production.quantity) / 1000;
      
      const fefoResult = this.validateFEFOAvailability(
        bom.material_code,
        requiredKg,
        inboundRecords
      );
      
      totalChecks += fefoResult.summary.total_checks;
      errors.push(...fefoResult.errors);
      warnings.push(...fefoResult.warnings);
    }
    
    // 5-3. 생산 수량 검증
    totalChecks++;
    if (production.quantity <= 0) {
      errors.push({
        code: 'PROD_INVALID_QUANTITY',
        severity: 'ERROR',
        field: 'quantity',
        message: '생산 수량이 0 이하입니다',
        actual: production.quantity
      });
    }
    
    // 5-4. 비정상 생산량 경고
    totalChecks++;
    if (production.quantity > 1000) {
      warnings.push({
        code: 'PROD_HIGH_QUANTITY',
        severity: 'WARNING',
        field: 'quantity',
        message: `생산 수량이 매우 큽니다 (${production.quantity})`,
        actual: production.quantity,
        suggestion: '단위를 확인하세요'
      });
    }
    
    const passed = totalChecks - errors.length - warnings.length;
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      summary: {
        total_checks: totalChecks,
        passed,
        failed: errors.length,
        warnings: warnings.length
      }
    };
  }
  
  // ==========================================
  // 6. 종합 정합성 리포트
  // ==========================================
  
  /**
   * 전체 시스템 정합성 검증
   */
  static generateFullReport(
    bomRecords: BOMRecord[],
    productCodes: string[],
    materialCodes: string[],
    dailyStockRecords: DailyStockRecord[],
    inboundRecords: InboundRecord[]
  ): {
    overall_valid: boolean;
    bom_validation: ValidationResult;
    stock_validation: ValidationResult;
    continuity_validation: ValidationResult;
    fefo_warnings: ValidationError[];
    summary: {
      total_errors: number;
      total_warnings: number;
      critical_issues: string[];
    };
  } {
    // 각 검증 실행
    const bomResult = this.validateBOM(bomRecords, productCodes, materialCodes);
    const stockResult = this.validateDailyStock(dailyStockRecords);
    const continuityResult = this.validateStockContinuity(dailyStockRecords);
    
    // FEFO 전체 경고 수집
    const fefoWarnings: ValidationError[] = [];
    const uniqueMaterials = [...new Set(inboundRecords.map(r => r.item_code))];
    for (const materialCode of uniqueMaterials) {
      const fefoResult = this.validateFEFOAvailability(materialCode, 0, inboundRecords);
      fefoWarnings.push(...fefoResult.warnings);
    }
    
    // 총합 계산
    const totalErrors = bomResult.summary.failed + stockResult.summary.failed + continuityResult.summary.failed;
    const totalWarnings = bomResult.summary.warnings + stockResult.summary.warnings + continuityResult.summary.warnings + fefoWarnings.length;
    
    // 심각한 문제 목록
    const criticalIssues: string[] = [];
    if (bomResult.summary.failed > 0) criticalIssues.push(`BOM 오류 ${bomResult.summary.failed}건`);
    if (stockResult.summary.failed > 0) criticalIssues.push(`재고 계산 오류 ${stockResult.summary.failed}건`);
    if (continuityResult.summary.failed > 0) criticalIssues.push(`이월재고 불일치 ${continuityResult.summary.failed}건`);
    
    return {
      overall_valid: totalErrors === 0,
      bom_validation: bomResult,
      stock_validation: stockResult,
      continuity_validation: continuityResult,
      fefo_warnings: fefoWarnings,
      summary: {
        total_errors: totalErrors,
        total_warnings: totalWarnings,
        critical_issues: criticalIssues
      }
    };
  }
}

export default DataValidator;
