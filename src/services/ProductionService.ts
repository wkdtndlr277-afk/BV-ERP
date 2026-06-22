/**
 * ProductionService - 생산 관련 비즈니스 로직 Service Layer
 * 
 * v3.5.0: 근본적 시스템 개선
 * 
 * 핵심 원칙:
 * 1. Single Source of Truth: transactions 테이블이 모든 재고 변동의 원천
 * 2. Atomic Transaction: 모든 재고 차감 + 트랜잭션 기록은 하나의 DB 트랜잭션으로 처리
 * 3. FEFO (First Expired First Out): 소비기한 빠른 LOT 우선 사용
 * 4. Validation First: 모든 작업 전 엄격한 유효성 검증
 */

// ===== 타입 정의 =====

export interface ProductionItem {
  product_code: string;
  quantity: number;
  channel?: string;
  expiry_date?: string;
  shelf_life_days?: number;
  materials?: MaterialItem[];
}

export interface MaterialItem {
  item_code: string;
  required_qty: number;
  unit?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface ValidationError {
  field: string;
  code: string;
  message: string;
}

export interface DeductionPlan {
  itemCode: string;
  itemName: string;
  requiredQty: number;
  unit: string;
  isSemiFinished: boolean;
  isWater: boolean;
  lots: LotDeduction[];
  totalAvailable: number;
  shortage: number;
}

export interface LotDeduction {
  lotNumber: string;
  deductQty: number;
  remainAfter: number;
  expiryDate?: string;
}

export interface ProductionResult {
  success: boolean;
  productionId?: number;
  lotNumber?: string;
  error?: string;
  errorCode?: string;
  deductions?: DeductionPlan[];
  transactionIds?: number[];
}

export interface BatchProductionResult {
  success: boolean;
  total: number;
  successCount: number;
  failCount: number;
  results: ProductionResult[];
  materialDeductions: Map<string, { qty: number; itemName: string; lots: string[] }>;
}

// ===== 상수 정의 =====

const EXCLUDE_CODES = ['R169', 'R170', 'R171', 'R172']; // 구형 코드 제외

// ===== 유효성 검증 함수 =====

/**
 * 생산 항목 유효성 검증 (Validation Layer)
 * confirm API에서 사용 - 사용자 입력이므로 더 엄격하게 검증
 */
export function validateProductionItem(item: ProductionItem, index: number): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  // 필수 필드 검증
  if (!item.product_code || item.product_code.trim() === '') {
    errors.push({
      field: `items[${index}].product_code`,
      code: 'REQUIRED',
      message: '제품코드는 필수입니다.'
    });
  }

  if (item.quantity === undefined || item.quantity === null) {
    errors.push({
      field: `items[${index}].quantity`,
      code: 'REQUIRED',
      message: '수량은 필수입니다.'
    });
  } else if (typeof item.quantity !== 'number' || isNaN(item.quantity)) {
    errors.push({
      field: `items[${index}].quantity`,
      code: 'INVALID_TYPE',
      message: '수량은 숫자여야 합니다.'
    });
  } else if (item.quantity <= 0) {
    errors.push({
      field: `items[${index}].quantity`,
      code: 'INVALID_VALUE',
      message: '수량은 0보다 커야 합니다.'
    });
  } else if (item.quantity > 100000) {
    errors.push({
      field: `items[${index}].quantity`,
      code: 'INVALID_VALUE',
      message: '수량이 비정상적으로 큽니다 (최대 100,000).'
    });
  }

  // 소비기한 형식 검증
  if (item.expiry_date) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(item.expiry_date)) {
      errors.push({
        field: `items[${index}].expiry_date`,
        code: 'INVALID_FORMAT',
        message: '소비기한 형식이 올바르지 않습니다 (YYYY-MM-DD).'
      });
    } else {
      const expiryDate = new Date(item.expiry_date);
      if (isNaN(expiryDate.getTime())) {
        errors.push({
          field: `items[${index}].expiry_date`,
          code: 'INVALID_DATE',
          message: '유효하지 않은 날짜입니다.'
        });
      }
    }
  }

  // shelf_life_days 검증
  if (item.shelf_life_days !== undefined) {
    if (typeof item.shelf_life_days !== 'number' || item.shelf_life_days < 1 || item.shelf_life_days > 365) {
      warnings.push(`items[${index}].shelf_life_days: 소비기한 일수가 비정상적입니다 (1-365 권장).`);
    }
  }

  // 원료 목록 검증
  if (item.materials && Array.isArray(item.materials)) {
    for (let i = 0; i < item.materials.length; i++) {
      const mat = item.materials[i];
      if (!mat.item_code || mat.item_code.trim() === '') {
        errors.push({
          field: `items[${index}].materials[${i}].item_code`,
          code: 'REQUIRED',
          message: '원료코드는 필수입니다.'
        });
      }
      if (mat.required_qty === undefined || mat.required_qty <= 0) {
        errors.push({
          field: `items[${index}].materials[${i}].required_qty`,
          code: 'INVALID_VALUE',
          message: '원료 수량은 0보다 커야 합니다.'
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * 생산일 유효성 검증
 */
export function validateProductionDate(dateStr: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  if (!dateStr) {
    errors.push({
      field: 'production_date',
      code: 'REQUIRED',
      message: '생산일은 필수입니다.'
    });
    return { valid: false, errors, warnings };
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) {
    errors.push({
      field: 'production_date',
      code: 'INVALID_FORMAT',
      message: '생산일 형식이 올바르지 않습니다 (YYYY-MM-DD).'
    });
    return { valid: false, errors, warnings };
  }

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    errors.push({
      field: 'production_date',
      code: 'INVALID_DATE',
      message: '유효하지 않은 날짜입니다.'
    });
    return { valid: false, errors, warnings };
  }

  // 미래 날짜 경고
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date > today) {
    warnings.push('생산일이 오늘 이후입니다. 확인해주세요.');
  }

  // 너무 오래된 날짜 경고
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  if (date < thirtyDaysAgo) {
    warnings.push('생산일이 30일 이상 지난 날짜입니다. 확인해주세요.');
  }

  return { valid: true, errors, warnings };
}

// ===== FEFO 재고 차감 계획 수립 =====

/**
 * FEFO 방식으로 재고 차감 계획 수립
 * 실제 차감 전에 어떤 LOT에서 얼마나 차감할지 계획
 */
export async function planFEFODeduction(
  db: D1Database,
  itemCode: string,
  requiredQty: number,
  referenceDate: string
): Promise<DeductionPlan> {
  const isSemiFinished = itemCode.startsWith('SF');
  
  // 마스터 정보 조회
  let itemName = itemCode;
  let unit = 'kg';
  
  if (isSemiFinished) {
    const sfInfo = await db.prepare(`
      SELECT item_name, unit FROM semi_finished_items WHERE item_code = ?
    `).bind(itemCode).first<{ item_name: string; unit: string }>();
    if (sfInfo) {
      itemName = sfInfo.item_name;
      unit = sfInfo.unit || 'kg';
    }
  } else {
    const masterInfo = await db.prepare(`
      SELECT item_name, unit FROM master WHERE item_code = ?
    `).bind(itemCode).first<{ item_name: string; unit: string }>();
    if (masterInfo) {
      itemName = masterInfo.item_name;
      unit = masterInfo.unit || 'kg';
    }
  }
  
  const isWater = itemName.toLowerCase().includes('정제수');
  
  // 정제수는 재고 차감 제외
  if (isWater) {
    return {
      itemCode,
      itemName,
      requiredQty,
      unit,
      isSemiFinished,
      isWater: true,
      lots: [],
      totalAvailable: Infinity,
      shortage: 0
    };
  }

  // FEFO 쿼리로 가용 LOT 조회
  let lots: Array<{ lot_number: string; remain_qty: number; expiry_date: string }> = [];
  
  if (isSemiFinished) {
    const result = await db.prepare(`
      SELECT lot_number, remain_qty, expiry_date 
      FROM semi_finished_lots 
      WHERE item_code = ? AND remain_qty > 0
      ORDER BY expiry_date ASC, prod_date ASC, id ASC
    `).bind(itemCode).all<{ lot_number: string; remain_qty: number; expiry_date: string }>();
    lots = result.results || [];
  } else {
    const result = await db.prepare(`
      SELECT lot_number, remain_qty, expiry_date 
      FROM inbound 
      WHERE item_code = ? AND remain_qty > 0 AND quality_status = '합격'
      ORDER BY expiry_date ASC, inbound_date ASC, id ASC
    `).bind(itemCode).all<{ lot_number: string; remain_qty: number; expiry_date: string }>();
    lots = result.results || [];
  }

  // 차감 계획 수립
  const deductions: LotDeduction[] = [];
  let remainingRequired = requiredQty;
  let totalAvailable = 0;

  for (const lot of lots) {
    totalAvailable += lot.remain_qty;
    
    if (remainingRequired <= 0) continue;
    
    const deductQty = Math.min(lot.remain_qty, remainingRequired);
    deductions.push({
      lotNumber: lot.lot_number,
      deductQty,
      remainAfter: lot.remain_qty - deductQty,
      expiryDate: lot.expiry_date
    });
    
    remainingRequired -= deductQty;
  }

  return {
    itemCode,
    itemName,
    requiredQty,
    unit,
    isSemiFinished,
    isWater: false,
    lots: deductions,
    totalAvailable,
    shortage: Math.max(0, requiredQty - totalAvailable)
  };
}

// ===== 원자적 재고 차감 및 트랜잭션 기록 =====

/**
 * 원자적 재고 차감 실행
 * D1의 batch()를 사용하여 모든 업데이트를 하나의 트랜잭션으로 처리
 * 
 * 실행 순서:
 * 1. inbound/semi_finished_lots의 remain_qty 차감
 * 2. master.current_stock 차감 (일반 원료만)
 * 3. transactions 테이블에 사용 기록 INSERT
 */
export async function executeAtomicDeduction(
  db: D1Database,
  plans: DeductionPlan[],
  productionDate: string,
  productionId: number,
  productCode: string
): Promise<{ success: boolean; error?: string; transactionIds?: number[] }> {
  const statements: D1PreparedStatement[] = [];
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  
  for (const plan of plans) {
    // 정제수는 스킵
    if (plan.isWater) continue;
    
    // 재고 부족 체크
    if (plan.shortage > 0) {
      return {
        success: false,
        error: `재고 부족: ${plan.itemName}(${plan.itemCode}) - 필요: ${plan.requiredQty}${plan.unit}, 가용: ${plan.totalAvailable}${plan.unit}, 부족: ${plan.shortage}${plan.unit}`
      };
    }
    
    // 각 LOT에서 차감
    for (const lot of plan.lots) {
      if (plan.isSemiFinished) {
        // 반제품: semi_finished_lots 차감
        statements.push(
          db.prepare(`
            UPDATE semi_finished_lots 
            SET remain_qty = remain_qty - ?, updated_at = ?
            WHERE lot_number = ? AND item_code = ?
          `).bind(lot.deductQty, now, lot.lotNumber, plan.itemCode)
        );
      } else {
        // 일반 원료: inbound 차감
        statements.push(
          db.prepare(`
            UPDATE inbound 
            SET remain_qty = remain_qty - ?, updated_at = ?
            WHERE lot_number = ? AND item_code = ?
          `).bind(lot.deductQty, now, lot.lotNumber, plan.itemCode)
        );
      }
    }
    
    // master.current_stock 차감 (일반 원료만)
    if (!plan.isSemiFinished) {
      statements.push(
        db.prepare(`
          UPDATE master 
          SET current_stock = MAX(0, current_stock - ?), updated_at = ?
          WHERE item_code = ?
        `).bind(plan.requiredQty, now, plan.itemCode)
      );
    }
    
    // transactions 테이블에 사용 기록 INSERT
    // ★★★ 핵심: 이것이 수불부의 Single Source of Truth ★★★
    const memoText = `생산사용: ${productCode} (생산ID:${productionId})`;
    const lotNumbers = plan.lots.map(l => l.lotNumber).join(',');
    
    if (plan.isSemiFinished) {
      // 반제품: semi_finished_transactions에 기록
      statements.push(
        db.prepare(`
          INSERT INTO semi_finished_transactions 
          (trans_date, item_code, trans_type, quantity, lot_number, memo, created_at)
          VALUES (?, ?, '사용', ?, ?, ?, ?)
        `).bind(productionDate, plan.itemCode, -plan.requiredQty, lotNumbers, memoText, now)
      );
    } else {
      // 일반 원료: transactions에 기록
      statements.push(
        db.prepare(`
          INSERT INTO transactions 
          (trans_date, item_code, trans_type, quantity, lot_number, memo, created_at)
          VALUES (?, ?, '사용', ?, ?, ?, ?)
        `).bind(productionDate, plan.itemCode, -plan.requiredQty, lotNumbers, memoText, now)
      );
    }
  }
  
  // 원자적 실행
  if (statements.length > 0) {
    try {
      await db.batch(statements);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: `DB 트랜잭션 실패: ${error.message}`
      };
    }
  }
  
  return { success: true };
}

// ===== LOT 번호 생성 =====

/**
 * 생산 LOT 번호 생성
 * 형식: {제품코드}-{YYYYMMDD}-{순번3자리}
 */
export async function generateProductionLotNumber(
  db: D1Database,
  productCode: string,
  productionDate: string
): Promise<string> {
  const lotDate = productionDate.replace(/-/g, '');
  
  const countResult = await db.prepare(`
    SELECT COUNT(*) as cnt FROM production 
    WHERE prod_date = ? AND product_code = ?
  `).bind(productionDate, productCode).first<{ cnt: number }>();
  
  const seq = String((countResult?.cnt || 0) + 1).padStart(3, '0');
  return `${productCode}-${lotDate}-${seq}`;
}

/**
 * 원료 LOT 번호 조회 (FEFO)
 */
export async function getMaterialLotNumber(
  db: D1Database,
  itemCode: string,
  productionDate: string
): Promise<string | null> {
  const isSemiFinished = itemCode.startsWith('SF');
  
  if (isSemiFinished) {
    // 반제품: semi_finished_lots에서 FEFO 조회
    const lot = await db.prepare(`
      SELECT lot_number FROM semi_finished_lots 
      WHERE item_code = ? AND remain_qty > 0
      ORDER BY expiry_date ASC, prod_date ASC, id ASC LIMIT 1
    `).bind(itemCode).first<{ lot_number: string }>();
    
    if (lot?.lot_number) return lot.lot_number;
    
    // 폴백: remain_qty 조건 없이 최신
    const fallback = await db.prepare(`
      SELECT lot_number FROM semi_finished_lots 
      WHERE item_code = ?
      ORDER BY prod_date DESC, id DESC LIMIT 1
    `).bind(itemCode).first<{ lot_number: string }>();
    
    return fallback?.lot_number || null;
  } else {
    // 일반 원료: inbound에서 FEFO 조회
    const lot = await db.prepare(`
      SELECT lot_number FROM inbound 
      WHERE item_code = ? AND remain_qty > 0 AND quality_status = '합격'
      ORDER BY expiry_date ASC, inbound_date ASC, id ASC LIMIT 1
    `).bind(itemCode).first<{ lot_number: string }>();
    
    if (lot?.lot_number) return lot.lot_number;
    
    // 폴백: 조건 없이 최신
    const fallback = await db.prepare(`
      SELECT lot_number FROM inbound 
      WHERE item_code = ?
      ORDER BY inbound_date DESC, id DESC LIMIT 1
    `).bind(itemCode).first<{ lot_number: string }>();
    
    return fallback?.lot_number || null;
  }
}

// ===== 소비기한 계산 =====

/**
 * 소비기한 계산
 * 우선순위: 사용자 입력 > 바코드 설정 > production_items 설정 > 기본값(7일)
 */
export function calculateExpiryDate(
  productionDate: string,
  userExpiryDate?: string,
  shelfLifeDays?: number
): string {
  if (userExpiryDate) {
    return userExpiryDate;
  }
  
  const days = shelfLifeDays || 7;
  const date = new Date(productionDate);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

// ===== 단일 생산 등록 (confirm용) =====

/**
 * 단일 생산 항목 등록 - confirm API용
 * 
 * 처리 순서:
 * 1. 유효성 검증
 * 2. LOT 번호 생성
 * 3. 재고 차감 계획 수립 (FEFO)
 * 4. production INSERT
 * 5. production_materials INSERT
 * 6. 원자적 재고 차감 + transactions INSERT
 */
export async function registerProduction(
  db: D1Database,
  productionDate: string,
  item: ProductionItem,
  channel?: string
): Promise<ProductionResult> {
  // 1. 유효성 검증
  const validation = validateProductionItem(item, 0);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.errors.map(e => e.message).join(', '),
      errorCode: 'VALIDATION_ERROR'
    };
  }
  
  const safeProductCode = item.product_code.trim();
  const safeQuantity = Number(item.quantity);
  const safeChannel = item.channel || channel || '';
  
  try {
    // 2. LOT 번호 생성
    const lotNumber = await generateProductionLotNumber(db, safeProductCode, productionDate);
    
    // 3. 소비기한 계산
    const expiryDate = calculateExpiryDate(
      productionDate,
      item.expiry_date,
      item.shelf_life_days
    );
    
    // 4. production INSERT
    const insertResult = await db.prepare(`
      INSERT INTO production (prod_date, product_code, quantity, lot_number, channel, expiry_date, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, '완료', datetime('now'))
    `).bind(
      productionDate,
      safeProductCode,
      safeQuantity,
      lotNumber,
      safeChannel,
      expiryDate
    ).run();
    
    const productionId = insertResult.meta?.last_row_id;
    if (!productionId) {
      return {
        success: false,
        error: 'production INSERT 실패',
        errorCode: 'DB_ERROR'
      };
    }
    
    // 5. 원료 처리 - 재고 차감 계획 수립 및 production_materials INSERT
    const deductionPlans: DeductionPlan[] = [];
    
    if (item.materials && Array.isArray(item.materials) && item.materials.length > 0) {
      for (const mat of item.materials) {
        const safeItemCode = mat.item_code?.trim();
        if (!safeItemCode) continue;
        
        // 구형 코드 필터
        if (EXCLUDE_CODES.includes(safeItemCode.toUpperCase())) continue;
        
        const safeRequiredQty = Number(mat.required_qty) || 0;
        if (safeRequiredQty <= 0) continue;
        
        // FEFO 차감 계획 수립
        const plan = await planFEFODeduction(db, safeItemCode, safeRequiredQty, productionDate);
        deductionPlans.push(plan);
        
        // 원료 LOT 번호 결정
        let materialLotNumber: string | null = null;
        if (plan.lots.length > 0) {
          materialLotNumber = plan.lots[0].lotNumber;
        } else if (!plan.isWater) {
          // LOT 없으면 자동 생성
          const lotDate = productionDate.replace(/-/g, '');
          materialLotNumber = `${lotDate}-${safeItemCode}-001`;
        }
        
        // production_materials INSERT
        await db.prepare(`
          INSERT INTO production_materials (production_id, item_code, lot_number, planned_qty, actual_qty, unit)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          productionId,
          safeItemCode,
          materialLotNumber,
          safeRequiredQty,
          safeRequiredQty,
          mat.unit || 'kg'
        ).run();
      }
    }
    
    // 6. 원자적 재고 차감 + transactions INSERT
    // ★★★ 이 부분이 기존 confirm API에 누락되어 있던 핵심 로직 ★★★
    if (deductionPlans.length > 0) {
      const deductionResult = await executeAtomicDeduction(
        db,
        deductionPlans,
        productionDate,
        productionId,
        safeProductCode
      );
      
      if (!deductionResult.success) {
        // 재고 차감 실패 시 production은 이미 등록되었으므로 상태를 '재고부족'으로 변경
        await db.prepare(`
          UPDATE production SET status = '재고부족', memo = ? WHERE id = ?
        `).bind(deductionResult.error, productionId).run();
        
        return {
          success: false,
          productionId,
          lotNumber,
          error: deductionResult.error,
          errorCode: 'INSUFFICIENT_STOCK',
          deductions: deductionPlans
        };
      }
    }
    
    return {
      success: true,
      productionId,
      lotNumber,
      deductions: deductionPlans
    };
    
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      errorCode: 'DB_ERROR'
    };
  }
}

// ===== Exports =====
export {
  EXCLUDE_CODES
};
