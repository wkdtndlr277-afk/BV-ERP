/**
 * 수불부 재고 계산 유틸리티
 * 
 * 핵심 규칙:
 * 1. AI 추론 완전 배제 - DB 실제 잔량만 사용
 * 2. current_stock은 SUM(remain_qty) 쿼리 결과만 신뢰
 * 3. 입고/출고 데이터 불일치 시 '데이터 불일치 오류' 반환
 * 4. 예측값이 아닌 DB 합계만 사용
 * 
 * @version 1.0.0
 * @lastUpdated 2026-06-01
 */

// ===== 데이터 불일치 에러 =====

export class DataInconsistencyError extends Error {
  constructor(
    message: string,
    public code: 'DATA_MISMATCH' | 'CALCULATION_BLOCKED' | 'STOCK_VERIFICATION_FAILED',
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'DataInconsistencyError';
  }
}

// ===== 재고 계산 쿼리 (AI 추론 배제) =====

/**
 * 원료 실제 재고 조회 (DB SUM만 사용)
 * AI 추론 배제: current_stock 계산하지 않음
 */
export async function getActualRawMaterialStock(
  db: D1Database,
  itemCode: string
): Promise<{
  success: boolean;
  inbound_sum: number;
  master_stock: number;
  is_consistent: boolean;
  error?: string;
}> {
  try {
    // 1. inbound 테이블에서 실제 잔량 합계 조회 (신뢰할 값)
    const inboundResult = await db.prepare(`
      SELECT COALESCE(SUM(remain_qty), 0) as total_remain
      FROM inbound 
      WHERE item_code = ? AND quality_status = '합격'
    `).bind(itemCode).first<{ total_remain: number }>();

    const inboundSum = inboundResult?.total_remain || 0;

    // 2. master 테이블의 current_stock 조회 (비교용)
    const masterResult = await db.prepare(`
      SELECT current_stock FROM master WHERE item_code = ?
    `).bind(itemCode).first<{ current_stock: number }>();

    const masterStock = masterResult?.current_stock || 0;

    // 3. 일치 여부 확인 (허용 오차: 0.001)
    const difference = Math.abs(inboundSum - masterStock);
    const isConsistent = difference <= 0.001;

    return {
      success: true,
      inbound_sum: inboundSum,
      master_stock: masterStock,
      is_consistent: isConsistent
    };
  } catch (error: any) {
    return {
      success: false,
      inbound_sum: 0,
      master_stock: 0,
      is_consistent: false,
      error: error.message
    };
  }
}

/**
 * 제품 실제 재고 조회 (DB SUM만 사용)
 */
export async function getActualProductStock(
  db: D1Database,
  productCode: string
): Promise<{
  success: boolean;
  production_inbound_sum: number;
  master_stock: number;
  is_consistent: boolean;
  error?: string;
}> {
  try {
    // production_inbound 테이블에서 실제 잔량 합계
    const inboundResult = await db.prepare(`
      SELECT COALESCE(SUM(remain_qty), 0) as total_remain
      FROM production_inbound 
      WHERE production_code = ? AND quality_status = '합격'
    `).bind(productCode).first<{ total_remain: number }>();

    const inboundSum = inboundResult?.total_remain || 0;

    // master 테이블의 current_stock
    const masterResult = await db.prepare(`
      SELECT current_stock FROM master WHERE item_code = ?
    `).bind(productCode).first<{ current_stock: number }>();

    const masterStock = masterResult?.current_stock || 0;

    const difference = Math.abs(inboundSum - masterStock);
    const isConsistent = difference <= 0.001;

    return {
      success: true,
      production_inbound_sum: inboundSum,
      master_stock: masterStock,
      is_consistent: isConsistent
    };
  } catch (error: any) {
    return {
      success: false,
      production_inbound_sum: 0,
      master_stock: 0,
      is_consistent: false,
      error: error.message
    };
  }
}

/**
 * 반제품 실제 재고 조회 (DB SUM만 사용)
 */
export async function getActualSemiFinishedStock(
  db: D1Database,
  itemCode: string
): Promise<{
  success: boolean;
  lots_sum: number;
  master_stock: number;
  is_consistent: boolean;
  error?: string;
}> {
  try {
    // semi_finished_lots 테이블에서 실제 잔량 합계
    const lotsResult = await db.prepare(`
      SELECT COALESCE(SUM(remain_qty), 0) as total_remain
      FROM semi_finished_lots 
      WHERE item_code = ?
    `).bind(itemCode).first<{ total_remain: number }>();

    const lotsSum = lotsResult?.total_remain || 0;

    // semi_finished_items 테이블의 current_stock
    const masterResult = await db.prepare(`
      SELECT current_stock FROM semi_finished_items WHERE item_code = ?
    `).bind(itemCode).first<{ current_stock: number }>();

    const masterStock = masterResult?.current_stock || 0;

    const difference = Math.abs(lotsSum - masterStock);
    const isConsistent = difference <= 0.001;

    return {
      success: true,
      lots_sum: lotsSum,
      master_stock: masterStock,
      is_consistent: isConsistent
    };
  } catch (error: any) {
    return {
      success: false,
      lots_sum: 0,
      master_stock: 0,
      is_consistent: false,
      error: error.message
    };
  }
}

// ===== 수불부 계산 (AI 추론 배제) =====

/**
 * 수불부 재고 계산 (AI 추론 완전 배제)
 * - current_stock을 AI가 계산하지 않음
 * - SUM(remain_qty) 쿼리 결과만 사용
 * - 불일치 시 에러 반환
 * 
 * @throws DataInconsistencyError 데이터 불일치 시
 */
export async function calculateStockFromDB(
  db: D1Database,
  itemCode: string,
  category: 'raw' | 'product' | 'semi'
): Promise<{
  current_stock: number;
  source: 'inbound_sum' | 'production_inbound_sum' | 'lots_sum';
  verified: boolean;
}> {
  let result;

  switch (category) {
    case 'raw':
      result = await getActualRawMaterialStock(db, itemCode);
      if (!result.success) {
        throw new DataInconsistencyError(
          `데이터 불일치 오류: 관리자 확인 필요 (${itemCode})`,
          'DATA_MISMATCH',
          { itemCode, error: result.error }
        );
      }
      if (!result.is_consistent) {
        throw new DataInconsistencyError(
          `데이터 불일치 오류: 관리자 확인 필요 - inbound 합계(${result.inbound_sum})와 master(${result.master_stock}) 불일치`,
          'DATA_MISMATCH',
          { itemCode, inbound_sum: result.inbound_sum, master_stock: result.master_stock }
        );
      }
      return {
        current_stock: result.inbound_sum,  // DB SUM만 사용
        source: 'inbound_sum',
        verified: true
      };

    case 'product':
      result = await getActualProductStock(db, itemCode);
      if (!result.success) {
        throw new DataInconsistencyError(
          `데이터 불일치 오류: 관리자 확인 필요 (${itemCode})`,
          'DATA_MISMATCH',
          { itemCode, error: result.error }
        );
      }
      if (!result.is_consistent) {
        throw new DataInconsistencyError(
          `데이터 불일치 오류: 관리자 확인 필요 - production_inbound 합계(${result.production_inbound_sum})와 master(${result.master_stock}) 불일치`,
          'DATA_MISMATCH',
          { itemCode, production_inbound_sum: result.production_inbound_sum, master_stock: result.master_stock }
        );
      }
      return {
        current_stock: result.production_inbound_sum,  // DB SUM만 사용
        source: 'production_inbound_sum',
        verified: true
      };

    case 'semi':
      result = await getActualSemiFinishedStock(db, itemCode);
      if (!result.success) {
        throw new DataInconsistencyError(
          `데이터 불일치 오류: 관리자 확인 필요 (${itemCode})`,
          'DATA_MISMATCH',
          { itemCode, error: result.error }
        );
      }
      if (!result.is_consistent) {
        throw new DataInconsistencyError(
          `데이터 불일치 오류: 관리자 확인 필요 - lots 합계(${result.lots_sum})와 semi_finished_items(${result.master_stock}) 불일치`,
          'DATA_MISMATCH',
          { itemCode, lots_sum: result.lots_sum, master_stock: result.master_stock }
        );
      }
      return {
        current_stock: result.lots_sum,  // DB SUM만 사용
        source: 'lots_sum',
        verified: true
      };

    default:
      throw new DataInconsistencyError(
        '데이터 불일치 오류: 알 수 없는 카테고리',
        'CALCULATION_BLOCKED',
        { itemCode, category }
      );
  }
}

// ===== 수불부 일별 계산 (AI 추론 배제) =====

/**
 * 일별 수불부 계산 (DB 쿼리만 사용)
 * AI 예측값 없이 transactions 테이블의 실제 데이터만 집계
 */
export async function getDailyTransactionSummary(
  db: D1Database,
  itemCode: string,
  date: string
): Promise<{
  success: boolean;
  data?: {
    inbound: number;
    usage: number;
    outbound: number;
    adjustment: number;
    net_change: number;
  };
  error?: string;
}> {
  try {
    const result = await db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN trans_type = '입고' THEN quantity ELSE 0 END), 0) as inbound,
        COALESCE(SUM(CASE WHEN trans_type = '사용' THEN ABS(quantity) ELSE 0 END), 0) as usage,
        COALESCE(SUM(CASE WHEN trans_type = '출고' THEN ABS(quantity) ELSE 0 END), 0) as outbound,
        COALESCE(SUM(CASE WHEN trans_type = '재고조정' THEN quantity ELSE 0 END), 0) as adjustment
      FROM transactions
      WHERE item_code = ? AND trans_date = ?
    `).bind(itemCode, date).first<{
      inbound: number;
      usage: number;
      outbound: number;
      adjustment: number;
    }>();

    if (!result) {
      return {
        success: true,
        data: { inbound: 0, usage: 0, outbound: 0, adjustment: 0, net_change: 0 }
      };
    }

    // 순변동 계산 (AI 추론 없이 단순 합계)
    const netChange = result.inbound - result.usage - result.outbound + result.adjustment;

    return {
      success: true,
      data: {
        inbound: result.inbound,
        usage: result.usage,
        outbound: result.outbound,
        adjustment: result.adjustment,
        net_change: netChange
      }
    };
  } catch (error: any) {
    return {
      success: false,
      error: `데이터 불일치 오류: 관리자 확인 필요 - ${error.message}`
    };
  }
}

// ===== 재고 검증 함수 =====

/**
 * 재고 데이터 검증 (표시 전 필수 호출)
 * 불일치 시 에러 메시지 반환, 계산 결과 표시 차단
 */
export async function verifyStockBeforeDisplay(
  db: D1Database,
  itemCode: string,
  category: 'raw' | 'product' | 'semi'
): Promise<{
  canDisplay: boolean;
  stock?: number;
  errorMessage?: string;
}> {
  try {
    const result = await calculateStockFromDB(db, itemCode, category);
    return {
      canDisplay: true,
      stock: result.current_stock
    };
  } catch (error: any) {
    if (error instanceof DataInconsistencyError) {
      return {
        canDisplay: false,
        errorMessage: error.message
      };
    }
    return {
      canDisplay: false,
      errorMessage: `데이터 불일치 오류: 관리자 확인 필요 - ${error.message}`
    };
  }
}

// ===== 일괄 검증 =====

/**
 * 전체 품목 재고 일관성 검증
 */
export async function verifyAllStockConsistency(
  db: D1Database
): Promise<{
  success: boolean;
  total_items: number;
  consistent_items: number;
  inconsistent_items: Array<{
    item_code: string;
    item_name: string;
    category: string;
    db_sum: number;
    master_stock: number;
    difference: number;
  }>;
}> {
  // 원료 검증
  const rawMaterialResult = await db.prepare(`
    SELECT 
      m.item_code,
      m.item_name,
      m.category,
      m.current_stock as master_stock,
      COALESCE(SUM(i.remain_qty), 0) as db_sum,
      m.current_stock - COALESCE(SUM(i.remain_qty), 0) as difference
    FROM master m
    LEFT JOIN inbound i ON m.item_code = i.item_code AND i.quality_status = '합격'
    WHERE m.category = '원료'
    GROUP BY m.item_code
    HAVING ABS(difference) > 0.001
  `).all<{
    item_code: string;
    item_name: string;
    category: string;
    master_stock: number;
    db_sum: number;
    difference: number;
  }>();

  // 제품 검증
  const productResult = await db.prepare(`
    SELECT 
      m.item_code,
      m.item_name,
      m.category,
      m.current_stock as master_stock,
      COALESCE(SUM(pi.remain_qty), 0) as db_sum,
      m.current_stock - COALESCE(SUM(pi.remain_qty), 0) as difference
    FROM master m
    LEFT JOIN production_inbound pi ON m.item_code = pi.production_code AND pi.quality_status = '합격'
    WHERE m.category = '제품'
    GROUP BY m.item_code
    HAVING ABS(difference) > 0.001
  `).all<{
    item_code: string;
    item_name: string;
    category: string;
    master_stock: number;
    db_sum: number;
    difference: number;
  }>();

  const allInconsistent = [
    ...(rawMaterialResult.results || []),
    ...(productResult.results || [])
  ];

  const totalResult = await db.prepare(`
    SELECT COUNT(*) as cnt FROM master WHERE category IN ('원료', '제품')
  `).first<{ cnt: number }>();

  return {
    success: allInconsistent.length === 0,
    total_items: totalResult?.cnt || 0,
    consistent_items: (totalResult?.cnt || 0) - allInconsistent.length,
    inconsistent_items: allInconsistent
  };
}

export default {
  DataInconsistencyError,
  getActualRawMaterialStock,
  getActualProductStock,
  getActualSemiFinishedStock,
  calculateStockFromDB,
  getDailyTransactionSummary,
  verifyStockBeforeDisplay,
  verifyAllStockConsistency
};
