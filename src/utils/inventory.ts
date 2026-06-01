/**
 * 재고 관리 유틸리티 함수
 * 
 * 핵심 규칙:
 * 1. FEFO (First Expired, First Out): 소비기한 빠른 LOT 우선 사용
 * 2. Atomic Transaction: 모든 재고 업데이트는 batch()로 원자적 처리
 * 3. 음수 재고 방지: MAX(0, current_stock - deduction)
 * 4. 재고 부족 방어: 차감 전 가용 재고 검증, 부족 시 작업 중단
 */

// ===== 상수 정의 =====
export const FEFO_QUERY = {
  // 원료 LOT 조회 (FEFO): 잔량 있고, 합격 상태이며, 유통기한이 아직 남은 LOT
  INBOUND: `
    SELECT * FROM inbound 
    WHERE item_code = ? AND remain_qty > 0 AND quality_status = '합격' AND expiry_date >= ?
    ORDER BY expiry_date ASC, inbound_date ASC, id ASC
  `,
  // 반제품 LOT 조회 (FEFO)
  SEMI_FINISHED: `
    SELECT * FROM semi_finished_lots 
    WHERE item_code = ? AND remain_qty > 0 AND (expiry_date >= ? OR expiry_date IS NULL)
    ORDER BY expiry_date ASC, prod_date ASC, id ASC
  `,
  // 제품 LOT 조회 (FEFO)
  PRODUCTION: `
    SELECT * FROM production_inbound 
    WHERE production_code = ? AND remain_qty > 0 AND quality_status = '합격' AND expiry_date >= ?
    ORDER BY expiry_date ASC, inbound_date ASC, id ASC
  `
};

// ===== 타입 정의 =====
export interface StockDeductionResult {
  success: boolean;
  error?: string;
  errorCode?: 'INSUFFICIENT_STOCK' | 'NO_LOT_AVAILABLE' | 'ITEM_NOT_FOUND' | 'DB_ERROR';
  deductions?: LotDeduction[];
  totalDeducted?: number;
  remainingRequired?: number;
}

export interface LotDeduction {
  lot_number: string;
  item_code: string;
  deducted_qty: number;
  remain_qty_after: number;
  expiry_date?: string;
}

export interface StockCheckResult {
  available: boolean;
  totalAvailable: number;
  required: number;
  shortage: number;
  lots: Array<{
    lot_number: string;
    remain_qty: number;
    expiry_date: string;
  }>;
}

// ===== 재고 검증 함수 =====

/**
 * 재고 가용성 확인 (차감 전 검증)
 * FEFO 순서대로 LOT를 확인하여 필요 수량 충족 여부 판단
 */
export async function checkStockAvailability(
  db: D1Database,
  itemCode: string,
  requiredQty: number,
  referenceDate: string // 기준일 (생산일 등)
): Promise<StockCheckResult> {
  // FEFO 쿼리로 가용 LOT 조회
  const lots = await db.prepare(FEFO_QUERY.INBOUND).bind(itemCode, referenceDate).all<{
    lot_number: string;
    remain_qty: number;
    expiry_date: string;
  }>();

  const lotList = lots.results || [];
  const totalAvailable = lotList.reduce((sum, lot) => sum + lot.remain_qty, 0);
  const shortage = Math.max(0, requiredQty - totalAvailable);

  return {
    available: totalAvailable >= requiredQty,
    totalAvailable,
    required: requiredQty,
    shortage,
    lots: lotList
  };
}

/**
 * 반제품 재고 가용성 확인
 */
export async function checkSemiFinishedAvailability(
  db: D1Database,
  itemCode: string,
  requiredQty: number,
  referenceDate: string
): Promise<StockCheckResult> {
  const lots = await db.prepare(FEFO_QUERY.SEMI_FINISHED).bind(itemCode, referenceDate).all<{
    lot_number: string;
    remain_qty: number;
    expiry_date: string;
  }>();

  const lotList = lots.results || [];
  const totalAvailable = lotList.reduce((sum, lot) => sum + lot.remain_qty, 0);
  const shortage = Math.max(0, requiredQty - totalAvailable);

  return {
    available: totalAvailable >= requiredQty,
    totalAvailable,
    required: requiredQty,
    shortage,
    lots: lotList
  };
}

// ===== FEFO 기반 재고 차감 함수 =====

/**
 * FEFO 방식으로 원료 LOT에서 재고 차감 (Atomic Transaction)
 * 
 * @returns batch() 실행용 D1PreparedStatement 배열과 차감 내역
 */
export async function prepareFEFODeduction(
  db: D1Database,
  itemCode: string,
  requiredQty: number,
  referenceDate: string,
  memo?: string
): Promise<{
  statements: D1PreparedStatement[];
  deductions: LotDeduction[];
  success: boolean;
  error?: string;
}> {
  const statements: D1PreparedStatement[] = [];
  const deductions: LotDeduction[] = [];

  // 1. FEFO 순서로 가용 LOT 조회
  const lots = await db.prepare(FEFO_QUERY.INBOUND).bind(itemCode, referenceDate).all<{
    id: number;
    lot_number: string;
    item_code: string;
    remain_qty: number;
    expiry_date: string;
  }>();

  if (!lots.results || lots.results.length === 0) {
    // RM/R 코드 변환 후 재시도
    let altCode = '';
    if (itemCode.startsWith('RM')) {
      altCode = 'R' + itemCode.substring(2);
    } else if (itemCode.startsWith('R') && !itemCode.startsWith('RM')) {
      altCode = 'RM' + itemCode.substring(1);
    }

    if (altCode) {
      const altLots = await db.prepare(FEFO_QUERY.INBOUND).bind(altCode, referenceDate).all<any>();
      if (altLots.results && altLots.results.length > 0) {
        lots.results = altLots.results;
      }
    }
  }

  const lotList = lots.results || [];
  const totalAvailable = lotList.reduce((sum, lot) => sum + lot.remain_qty, 0);

  // 2. 재고 부족 검증
  if (totalAvailable < requiredQty) {
    return {
      statements: [],
      deductions: [],
      success: false,
      error: `재고 부족: ${itemCode} (필요: ${requiredQty.toFixed(2)}kg, 가용: ${totalAvailable.toFixed(2)}kg)`
    };
  }

  // 3. FEFO 순서로 차감 준비
  let remainingToDeduct = requiredQty;

  for (const lot of lotList) {
    if (remainingToDeduct <= 0) break;

    const deductQty = Math.min(lot.remain_qty, remainingToDeduct);
    const newRemainQty = lot.remain_qty - deductQty;

    // LOT 잔량 업데이트 (음수 방지)
    statements.push(
      db.prepare(`
        UPDATE inbound 
        SET remain_qty = MAX(0, remain_qty - ?), updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND remain_qty >= ?
      `).bind(deductQty, lot.id, deductQty)
    );

    // 거래 이력 기록
    statements.push(
      db.prepare(`
        INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, remain_qty, memo)
        VALUES (?, ?, '사용', ?, ?, ?, ?)
      `).bind(
        referenceDate,
        lot.item_code,
        -deductQty,
        lot.lot_number,
        newRemainQty,
        memo || '생산사용'
      )
    );

    deductions.push({
      lot_number: lot.lot_number,
      item_code: lot.item_code,
      deducted_qty: deductQty,
      remain_qty_after: newRemainQty,
      expiry_date: lot.expiry_date
    });

    remainingToDeduct -= deductQty;
  }

  return {
    statements,
    deductions,
    success: true
  };
}

/**
 * 반제품 FEFO 차감 준비
 */
export async function prepareSemiFinishedDeduction(
  db: D1Database,
  itemCode: string,
  requiredQty: number,
  referenceDate: string,
  memo?: string
): Promise<{
  statements: D1PreparedStatement[];
  deductions: LotDeduction[];
  success: boolean;
  error?: string;
}> {
  const statements: D1PreparedStatement[] = [];
  const deductions: LotDeduction[] = [];

  const lots = await db.prepare(FEFO_QUERY.SEMI_FINISHED).bind(itemCode, referenceDate).all<{
    id: number;
    lot_number: string;
    item_code: string;
    remain_qty: number;
    expiry_date: string;
  }>();

  const lotList = lots.results || [];
  const totalAvailable = lotList.reduce((sum, lot) => sum + lot.remain_qty, 0);

  if (totalAvailable < requiredQty) {
    return {
      statements: [],
      deductions: [],
      success: false,
      error: `반제품 재고 부족: ${itemCode} (필요: ${requiredQty.toFixed(2)}kg, 가용: ${totalAvailable.toFixed(2)}kg)`
    };
  }

  let remainingToDeduct = requiredQty;

  for (const lot of lotList) {
    if (remainingToDeduct <= 0) break;

    const deductQty = Math.min(lot.remain_qty, remainingToDeduct);
    const newRemainQty = lot.remain_qty - deductQty;

    statements.push(
      db.prepare(`
        UPDATE semi_finished_lots 
        SET remain_qty = MAX(0, remain_qty - ?), updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND remain_qty >= ?
      `).bind(deductQty, lot.id, deductQty)
    );

    statements.push(
      db.prepare(`
        INSERT INTO semi_finished_transactions (trans_date, item_code, trans_type, quantity, lot_number, memo, created_at)
        VALUES (?, ?, '사용', ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(referenceDate, itemCode, -deductQty, lot.lot_number, memo || '생산사용')
    );

    deductions.push({
      lot_number: lot.lot_number,
      item_code: lot.item_code,
      deducted_qty: deductQty,
      remain_qty_after: newRemainQty,
      expiry_date: lot.expiry_date
    });

    remainingToDeduct -= deductQty;
  }

  return {
    statements,
    deductions,
    success: true
  };
}

// ===== 마스터 재고 업데이트 함수 =====

/**
 * Master 테이블 재고 차감 준비 (음수 방지)
 */
export function prepareMasterDeduction(
  db: D1Database,
  itemCode: string,
  deductQty: number
): D1PreparedStatement {
  return db.prepare(`
    UPDATE master 
    SET current_stock = MAX(0, current_stock - ?), updated_at = CURRENT_TIMESTAMP
    WHERE item_code = ?
  `).bind(deductQty, itemCode);
}

/**
 * Master 테이블 재고 증가 준비
 */
export function prepareMasterIncrease(
  db: D1Database,
  itemCode: string,
  increaseQty: number
): D1PreparedStatement {
  return db.prepare(`
    UPDATE master 
    SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP
    WHERE item_code = ?
  `).bind(increaseQty, itemCode);
}

/**
 * Supplies 테이블 재고 차감 준비 (음수 방지)
 */
export function prepareSuppliesDeduction(
  db: D1Database,
  itemCode: string,
  deductQty: number
): D1PreparedStatement {
  return db.prepare(`
    UPDATE supplies 
    SET current_stock = MAX(0, current_stock - ?), updated_at = CURRENT_TIMESTAMP
    WHERE item_code = ?
  `).bind(deductQty, itemCode);
}

// ===== 재고 불일치 검사 함수 =====

/**
 * inbound.remain_qty 합계 vs master.current_stock 일치 여부 검사
 * 감사(Audit) 용도
 */
export async function auditStockConsistency(
  db: D1Database
): Promise<{
  success: boolean;
  mismatches: Array<{
    item_code: string;
    item_name: string;
    master_stock: number;
    inbound_sum: number;
    difference: number;
  }>;
  total_checked: number;
  mismatch_count: number;
}> {
  const result = await db.prepare(`
    SELECT 
      m.item_code,
      m.item_name,
      m.current_stock as master_stock,
      COALESCE(SUM(i.remain_qty), 0) as inbound_sum,
      m.current_stock - COALESCE(SUM(i.remain_qty), 0) as difference
    FROM master m
    LEFT JOIN inbound i ON m.item_code = i.item_code AND i.quality_status = '합격'
    WHERE m.category = '원료'
    GROUP BY m.item_code, m.item_name, m.current_stock
    HAVING ABS(m.current_stock - COALESCE(SUM(i.remain_qty), 0)) > 0.001
    ORDER BY ABS(difference) DESC
  `).all<{
    item_code: string;
    item_name: string;
    master_stock: number;
    inbound_sum: number;
    difference: number;
  }>();

  const mismatches = result.results || [];
  
  // 전체 품목 수 조회
  const totalCount = await db.prepare(`
    SELECT COUNT(*) as cnt FROM master WHERE category = '원료'
  `).first<{ cnt: number }>();

  return {
    success: mismatches.length === 0,
    mismatches,
    total_checked: totalCount?.cnt || 0,
    mismatch_count: mismatches.length
  };
}

// ===== 에러 생성 유틸리티 =====

export class StockError extends Error {
  constructor(
    message: string,
    public code: 'INSUFFICIENT_STOCK' | 'NO_LOT_AVAILABLE' | 'ITEM_NOT_FOUND' | 'DB_ERROR',
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'StockError';
  }
}

/**
 * 재고 부족 에러 생성
 */
export function createInsufficientStockError(
  itemCode: string,
  required: number,
  available: number
): StockError {
  return new StockError(
    `재고 부족: ${itemCode} (필요: ${required.toFixed(2)}, 가용: ${available.toFixed(2)})`,
    'INSUFFICIENT_STOCK',
    { itemCode, required, available, shortage: required - available }
  );
}
