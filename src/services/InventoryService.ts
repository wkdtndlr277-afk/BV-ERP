/**
 * InventoryService - 재고 관리 서비스
 * 
 * v3.5.0: transactions 테이블 기반 Single Source of Truth
 * v3.5.1: 재고 조정(Adjustment) 메서드 추가, 모든 재고 변동은 트랜잭션으로 기록
 * v3.5.2: 정제수(RM184, RM267) 등 비관리 품목 제외
 * v3.5.4: 레거시 데이터 식별 헬퍼 함수 추가
 * 
 * 핵심 원칙:
 * 1. 모든 재고 계산은 transactions 테이블의 시계열 누적 합산으로 수행
 * 2. 특정 시점의 재고를 소급 조회 가능
 * 3. 수불부 = 전일재고 + 입고 - 사용 ± 조정 = 현재재고
 * 4. ★ 모든 재고 변동은 반드시 이 서비스를 통해서만 처리 ★
 */

// ===== 제외 품목 코드 (재고 관리 대상 아님) =====
// 정제수 등 실제 재고 관리가 필요 없는 품목
export const INVENTORY_EXCLUDE_CODES = [
  'RM184',  // 정제수
  'RM267',  // 2차정제수
];

// ===== v3.5.4: 레거시 데이터 구분 =====
// v3.5.3 로트 검증 강화 적용일 - 이 날짜 이전 데이터는 레거시로 분류
export const LOT_ENFORCEMENT_DATE = '2026-06-23';

/**
 * 트랜잭션이 레거시 데이터인지 확인
 * @param transDate 트랜잭션 날짜 (YYYY-MM-DD)
 * @returns 레거시 데이터 여부
 */
export function isLegacyTransaction(transDate: string): boolean {
  return transDate < LOT_ENFORCEMENT_DATE;
}

/**
 * 로트 번호 상태 분류
 * - 레거시 데이터의 로트 누락은 'LEGACY' (정상)
 * - 새 데이터의 로트 누락은 'ERROR' (비정상)
 * - 로트 있으면 'VALID'
 */
export type LotStatus = 'VALID' | 'LEGACY' | 'ERROR';

export function classifyLotStatus(
  lotNumber: string | null | undefined, 
  transDate: string
): LotStatus {
  const hasLot = lotNumber && lotNumber.trim() !== '';
  
  if (hasLot) {
    return 'VALID';
  }
  
  // 로트 없음 - 레거시 데이터면 정상, 아니면 에러
  return isLegacyTransaction(transDate) ? 'LEGACY' : 'ERROR';
}

/**
 * 로트 상태에 따른 표시 문자열
 */
export function getLotDisplayValue(
  lotNumber: string | null | undefined,
  transDate: string
): string {
  if (lotNumber && lotNumber.trim() !== '') {
    return lotNumber;
  }
  
  return isLegacyTransaction(transDate) ? '[레거시]' : '[누락-확인필요]';
}

// ===== 타입 정의 =====

export interface StockBalance {
  itemCode: string;
  itemName: string;
  unit: string;
  prevStock: number;      // 전일재고 (기준일 이전 누적)
  inboundQty: number;     // 당일 입고
  usedQty: number;        // 당일 사용
  adjustmentQty: number;  // 당일 조정
  currentStock: number;   // 현재재고 (기준일까지 누적)
  lotNumbers: string;     // 사용된 LOT 번호들
  isValid: boolean;       // 정합성 검증 결과
  difference: number;     // 계산값과 실제값 차이
}

export interface DailyStockReport {
  date: string;
  items: StockBalance[];
  summary: {
    totalItems: number;
    totalPrevStock: number;
    totalInbound: number;
    totalUsed: number;
    totalAdjustment: number;
    totalCurrentStock: number;
    integrityStatus: 'PASS' | 'FAIL';
    errorCount: number;
  };
  errors: Array<{
    itemCode: string;
    itemName: string;
    expected: number;
    actual: number;
    difference: number;
  }>;
}

export interface StockAtPoint {
  itemCode: string;
  itemName: string;
  unit: string;
  stock: number;
  asOfDate: string;
}

export interface IntegrityCheckResult {
  status: 'PASS' | 'FAIL' | 'WARNING';
  checkedAt: string;
  totalItems: number;
  matchCount: number;
  mismatchCount: number;
  mismatches: Array<{
    itemCode: string;
    itemName: string;
    masterStock: number;
    transactionSum: number;
    inboundSum: number;
    difference: number;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
  }>;
  recommendations: string[];
}

// ===== v3.5.1: 재고 변동 타입 =====

export type TransactionType = '입고' | '사용' | '재고조정' | 'INBOUND' | 'USAGE' | 'ADJUST';

export interface StockTransaction {
  itemCode: string;
  transType: TransactionType;
  quantity: number;      // 입고/조정증가: 양수, 사용/조정감소: 음수
  transDate: string;     // YYYY-MM-DD
  lotNumber?: string;
  memo?: string;
}

export interface AdjustmentRequest {
  itemCode: string;
  itemName: string;
  currentMasterStock: number;   // master.current_stock 현재값
  targetStock: number;          // 목표 재고 (보정 후)
  adjustmentQty: number;        // 조정량 (targetStock - transactionSum)
  reason: string;               // 조정 사유
}

export interface AdjustmentResult {
  success: boolean;
  itemCode: string;
  beforeTransactionSum: number;
  adjustmentQty: number;
  afterTransactionSum: number;
  transactionId?: number;
  error?: string;
}

export interface BulkAdjustmentResult {
  success: boolean;
  totalItems: number;
  successCount: number;
  failCount: number;
  results: AdjustmentResult[];
  executedAt: string;
}

// ===== v3.5.1: 재고 변동 기록 함수 =====

/**
 * 트랜잭션 기록 (Single Source of Truth)
 * ★ 모든 재고 변동은 반드시 이 함수를 통해서만 기록 ★
 */
export async function recordTransaction(
  db: D1Database,
  transaction: StockTransaction
): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    
    // trans_type 정규화 (영문 → 한글)
    let normalizedType = transaction.transType;
    if (normalizedType === 'INBOUND') normalizedType = '입고';
    if (normalizedType === 'USAGE') normalizedType = '사용';
    if (normalizedType === 'ADJUST') normalizedType = '재고조정';
    
    const result = await db.prepare(`
      INSERT INTO transactions (item_code, trans_type, quantity, trans_date, lot_number, memo, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      transaction.itemCode,
      normalizedType,
      transaction.quantity,
      transaction.transDate,
      transaction.lotNumber || null,
      transaction.memo || null,
      now
    ).run();
    
    return { 
      success: true, 
      id: result.meta?.last_row_id as number | undefined
    };
  } catch (error: any) {
    console.error('[recordTransaction] Error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 재고 조정 (단일 품목)
 * master.current_stock을 기준으로 transactions 합계를 맞추는 조정 트랜잭션 생성
 */
export async function adjustInventory(
  db: D1Database,
  request: AdjustmentRequest
): Promise<AdjustmentResult> {
  try {
    // 현재 transactions 합계 조회
    const currentSum = await db.prepare(`
      SELECT COALESCE(SUM(quantity), 0) as total
      FROM transactions
      WHERE item_code = ?
    `).bind(request.itemCode).first<{ total: number }>();
    
    const beforeSum = Number(currentSum?.total) || 0;
    const adjustmentQty = request.targetStock - beforeSum;
    
    // 조정량이 0이면 스킵
    if (Math.abs(adjustmentQty) < 0.001) {
      return {
        success: true,
        itemCode: request.itemCode,
        beforeTransactionSum: beforeSum,
        adjustmentQty: 0,
        afterTransactionSum: beforeSum
      };
    }
    
    const today = new Date().toISOString().split('T')[0];
    
    // 재고조정 트랜잭션 기록
    const result = await recordTransaction(db, {
      itemCode: request.itemCode,
      transType: '재고조정',
      quantity: adjustmentQty,
      transDate: today,
      memo: `[시스템 보정] ${request.reason} | 목표: ${request.targetStock.toFixed(4)}kg`
    });
    
    if (!result.success) {
      return {
        success: false,
        itemCode: request.itemCode,
        beforeTransactionSum: beforeSum,
        adjustmentQty: adjustmentQty,
        afterTransactionSum: beforeSum,
        error: result.error
      };
    }
    
    return {
      success: true,
      itemCode: request.itemCode,
      beforeTransactionSum: beforeSum,
      adjustmentQty: adjustmentQty,
      afterTransactionSum: beforeSum + adjustmentQty,
      transactionId: result.id
    };
    
  } catch (error: any) {
    console.error('[adjustInventory] Error:', error);
    return {
      success: false,
      itemCode: request.itemCode,
      beforeTransactionSum: 0,
      adjustmentQty: 0,
      afterTransactionSum: 0,
      error: error.message
    };
  }
}

/**
 * 대량 재고 조정 (전체 정합성 보정)
 * master.current_stock을 기준으로 모든 불일치 품목의 transactions를 보정
 */
export async function bulkAdjustInventory(
  db: D1Database,
  options: {
    dryRun?: boolean;
    reason?: string;
    itemCodes?: string[];  // 특정 품목만 보정 (미지정시 전체)
  } = {}
): Promise<BulkAdjustmentResult> {
  const { dryRun = true, reason = 'v3.5.1 재고 정합성 일괄 보정', itemCodes } = options;
  const executedAt = new Date().toISOString();
  
  try {
    // 제외 품목 WHERE 절 생성
    const excludeClause = INVENTORY_EXCLUDE_CODES.length > 0
      ? `AND m.item_code NOT IN (${INVENTORY_EXCLUDE_CODES.map(() => '?').join(',')})`
      : '';
    
    // 불일치 품목 조회
    let query = `
      SELECT 
        m.item_code,
        m.item_name,
        m.current_stock as master_stock,
        COALESCE(t.trans_sum, 0) as transaction_sum,
        m.current_stock - COALESCE(t.trans_sum, 0) as adjustment_needed
      FROM master m
      LEFT JOIN (
        SELECT item_code, SUM(quantity) as trans_sum
        FROM transactions
        GROUP BY item_code
      ) t ON m.item_code = t.item_code
      WHERE m.category = '원료'
        ${excludeClause}
        AND ABS(m.current_stock - COALESCE(t.trans_sum, 0)) > 0.01
    `;
    
    const params: any[] = [...INVENTORY_EXCLUDE_CODES];
    if (itemCodes && itemCodes.length > 0) {
      query += ` AND m.item_code IN (${itemCodes.map(() => '?').join(',')})`;
      params.push(...itemCodes);
    }
    
    query += ' ORDER BY ABS(m.current_stock - COALESCE(t.trans_sum, 0)) DESC';
    
    const mismatches = await db.prepare(query).bind(...params).all<{
      item_code: string;
      item_name: string;
      master_stock: number;
      transaction_sum: number;
      adjustment_needed: number;
    }>();
    
    const items = mismatches.results || [];
    const results: AdjustmentResult[] = [];
    let successCount = 0;
    let failCount = 0;
    
    for (const item of items) {
      if (dryRun) {
        // Dry run: 실제 실행 없이 결과만 반환
        results.push({
          success: true,
          itemCode: item.item_code,
          beforeTransactionSum: Number(item.transaction_sum) || 0,
          adjustmentQty: Number(item.adjustment_needed) || 0,
          afterTransactionSum: Number(item.master_stock) || 0
        });
        successCount++;
      } else {
        // 실제 보정 실행
        const result = await adjustInventory(db, {
          itemCode: item.item_code,
          itemName: item.item_name,
          currentMasterStock: Number(item.master_stock) || 0,
          targetStock: Number(item.master_stock) || 0,  // master.current_stock에 맞춤
          adjustmentQty: Number(item.adjustment_needed) || 0,
          reason
        });
        
        results.push(result);
        if (result.success) successCount++;
        else failCount++;
      }
    }
    
    return {
      success: failCount === 0,
      totalItems: items.length,
      successCount,
      failCount,
      results,
      executedAt
    };
    
  } catch (error: any) {
    console.error('[bulkAdjustInventory] Error:', error);
    return {
      success: false,
      totalItems: 0,
      successCount: 0,
      failCount: 1,
      results: [],
      executedAt
    };
  }
}

/**
 * 입고 트랜잭션 기록 (편의 함수)
 */
export async function recordInbound(
  db: D1Database,
  itemCode: string,
  quantity: number,
  transDate: string,
  lotNumber?: string,
  memo?: string
): Promise<{ success: boolean; id?: number; error?: string }> {
  return recordTransaction(db, {
    itemCode,
    transType: '입고',
    quantity: Math.abs(quantity),  // 입고는 항상 양수
    transDate,
    lotNumber,
    memo: memo || '입고'
  });
}

/**
 * 사용(출고) 트랜잭션 기록 (편의 함수)
 * ★ v3.5.3: lot_number 필수 - 없으면 오류 반환 ★
 */
export async function recordUsage(
  db: D1Database,
  itemCode: string,
  quantity: number,
  transDate: string,
  lotNumber: string,  // ★ 필수 파라미터로 변경
  memo?: string
): Promise<{ success: boolean; id?: number; error?: string }> {
  // ★★★ v3.5.3: lot_number 필수 검증 ★★★
  if (!lotNumber || lotNumber.trim() === '') {
    console.error(`[recordUsage] lot_number 누락: itemCode=${itemCode}, quantity=${quantity}`);
    return {
      success: false,
      error: `사용 트랜잭션 거부: lot_number는 필수입니다. (품목: ${itemCode})`
    };
  }
  
  return recordTransaction(db, {
    itemCode,
    transType: '사용',
    quantity: -Math.abs(quantity),  // 사용은 항상 음수
    transDate,
    lotNumber,
    memo: memo || '생산 사용'
  });
}

// ===== 수불부 조회 함수 (transactions 기반) =====

/**
 * 일일 수불부 조회 - transactions 테이블 기반
 */
export async function getDailyStockReport(
  db: D1Database,
  date: string,
  excludeCodes: string[] = ['R169', 'R170', 'R171', 'R172', 'RM266']
): Promise<DailyStockReport> {
  
  const excludeClause = excludeCodes.length > 0 
    ? `AND t.item_code NOT IN (${excludeCodes.map(() => '?').join(',')})` 
    : '';
  
  // ★★★ v3.5.5: 원료만 필터링 - R*, RM* 코드 패턴만 포함 ★★★
  // SF*(반제품), SM*(부자재), RT*(기타), PD*(제품), PR*(제품) 제외
  const rawMaterialFilter = `AND (t.item_code LIKE 'R%' OR t.item_code LIKE 'RM%') 
                             AND t.item_code NOT LIKE 'RT%'`;
  
  // transactions 테이블 기반 수불부 쿼리 (CTE 없이)
  const query = `
    SELECT 
      t.item_code,
      COALESCE(m.item_name, t.item_code) as item_name,
      COALESCE(m.unit, 'kg') as unit,
      SUM(CASE WHEN t.trans_date < ? THEN t.quantity ELSE 0 END) as prev_stock,
      SUM(CASE WHEN t.trans_date = ? AND t.trans_type = '입고' THEN t.quantity ELSE 0 END) as inbound_qty,
      SUM(CASE WHEN t.trans_date = ? AND t.trans_type = '사용' THEN ABS(t.quantity) ELSE 0 END) as used_qty,
      SUM(CASE WHEN t.trans_date = ? AND t.trans_type = '재고조정' THEN t.quantity ELSE 0 END) as adjustment_qty,
      SUM(CASE WHEN t.trans_date <= ? THEN t.quantity ELSE 0 END) as current_stock,
      GROUP_CONCAT(DISTINCT CASE WHEN t.trans_date = ? AND t.trans_type = '사용' THEN t.lot_number ELSE NULL END) as lot_numbers
    FROM transactions t
    LEFT JOIN master m ON t.item_code = m.item_code
    WHERE 1=1 ${excludeClause} ${rawMaterialFilter}
    GROUP BY t.item_code
    HAVING SUM(CASE WHEN t.trans_date < ? THEN t.quantity ELSE 0 END) != 0 
        OR SUM(CASE WHEN t.trans_date = ? AND t.trans_type = '입고' THEN t.quantity ELSE 0 END) != 0 
        OR SUM(CASE WHEN t.trans_date = ? AND t.trans_type = '사용' THEN ABS(t.quantity) ELSE 0 END) != 0 
        OR SUM(CASE WHEN t.trans_date = ? AND t.trans_type = '재고조정' THEN t.quantity ELSE 0 END) != 0 
        OR SUM(CASE WHEN t.trans_date <= ? THEN t.quantity ELSE 0 END) != 0
    ORDER BY SUM(CASE WHEN t.trans_date = ? AND t.trans_type = '사용' THEN ABS(t.quantity) ELSE 0 END) DESC, t.item_code ASC
  `;
  
  const params = [date, date, date, date, date, date, ...excludeCodes, date, date, date, date, date, date];
  const result = await db.prepare(query).bind(...params).all<{
    item_code: string;
    item_name: string;
    unit: string;
    prev_stock: number;
    inbound_qty: number;
    used_qty: number;
    adjustment_qty: number;
    current_stock: number;
    lot_numbers: string | null;
  }>();
  
  // ★★★ v3.5.7: LOT null인 품목의 사용량 수집 (FEFO 기반 LOT 매칭용) ★★★
  const itemsNeedingLot: { item_code: string; used_qty: number }[] = [];
  for (const row of result.results || []) {
    const usedQty = Number(row.used_qty) || 0;
    const lotNumbers = row.lot_numbers?.trim();
    // 사용량이 있는데 LOT가 없는 경우
    if (usedQty > 0 && (!lotNumbers || lotNumbers === '' || lotNumbers === 'null')) {
      itemsNeedingLot.push({ item_code: row.item_code, used_qty: usedQty });
    }
  }
  
  // ★★★ v3.5.7: FEFO 기반 LOT 매칭 - 사용량에 맞게 필요한 LOT만 순차적으로 선택 ★★★
  const fefoLotMap: Record<string, string> = {};
  if (itemsNeedingLot.length > 0) {
    // 각 품목별로 FEFO 순서(유통기한 빠른 순)로 LOT 조회
    const fefoQuery = `
      SELECT 
        i.item_code,
        i.lot_number,
        i.remain_qty,
        i.expiry_date
      FROM inbound i
      WHERE i.item_code IN (${itemsNeedingLot.map(() => '?').join(',')})
        AND i.quality_status = '합격'
        AND i.inbound_date <= ?
        AND i.remain_qty > 0
      ORDER BY i.item_code, i.expiry_date ASC, i.inbound_date ASC
    `;
    const fefoResult = await db.prepare(fefoQuery).bind(
      ...itemsNeedingLot.map(i => i.item_code), 
      date
    ).all<{
      item_code: string;
      lot_number: string;
      remain_qty: number;
      expiry_date: string;
    }>();
    
    // 품목별로 그룹화
    const lotsByItem: Record<string, Array<{ lot: string; qty: number }>> = {};
    for (const row of fefoResult.results || []) {
      if (!lotsByItem[row.item_code]) {
        lotsByItem[row.item_code] = [];
      }
      lotsByItem[row.item_code].push({ lot: row.lot_number, qty: row.remain_qty });
    }
    
    // 사용량에 맞게 필요한 LOT만 선택 (FEFO 순서)
    for (const item of itemsNeedingLot) {
      const lots = lotsByItem[item.item_code] || [];
      let remainingUsage = item.used_qty;
      const usedLots: string[] = [];
      
      for (const lot of lots) {
        if (remainingUsage <= 0) break;
        usedLots.push(lot.lot);
        remainingUsage -= lot.qty;
      }
      
      // 중복 제거 후 저장
      const uniqueLots = [...new Set(usedLots)];
      if (uniqueLots.length > 0) {
        fefoLotMap[item.item_code] = uniqueLots.join(',');
      }
    }
  }
  
  // 정합성 검증 및 변환
  const items: StockBalance[] = [];
  const errors: Array<{ itemCode: string; itemName: string; expected: number; actual: number; difference: number }> = [];
  
  for (const row of result.results || []) {
    const prevStock = Number(row.prev_stock) || 0;
    const inboundQty = Number(row.inbound_qty) || 0;
    const usedQty = Number(row.used_qty) || 0;
    const adjustmentQty = Number(row.adjustment_qty) || 0;
    const currentStock = Number(row.current_stock) || 0;
    
    // 검증: 전일 + 입고 - 사용 + 조정 = 현재
    const expected = prevStock + inboundQty - usedQty + adjustmentQty;
    const difference = Math.abs(expected - currentStock);
    const isValid = difference < 0.01; // 부동소수점 오차 허용
    
    // ★★★ LOT 결정: transactions에 있으면 사용, 없으면 FEFO 기반 LOT 사용 ★★★
    let lotNumbers = row.lot_numbers?.trim() || '';
    if ((!lotNumbers || lotNumbers === 'null') && usedQty > 0) {
      // FEFO 기반 LOT 매핑 (기존 데이터 변경 없이 조회 시점에만 적용)
      lotNumbers = fefoLotMap[row.item_code] || '';
    }
    
    const item: StockBalance = {
      itemCode: row.item_code,
      itemName: row.item_name,
      unit: row.unit,
      prevStock,
      inboundQty,
      usedQty,
      adjustmentQty,
      currentStock,
      lotNumbers,
      isValid,
      difference
    };
    
    items.push(item);
    
    if (!isValid) {
      errors.push({
        itemCode: row.item_code,
        itemName: row.item_name,
        expected,
        actual: currentStock,
        difference
      });
    }
  }
  
  // 요약 계산
  const summary = {
    totalItems: items.length,
    totalPrevStock: items.reduce((sum, i) => sum + i.prevStock, 0),
    totalInbound: items.reduce((sum, i) => sum + i.inboundQty, 0),
    totalUsed: items.reduce((sum, i) => sum + i.usedQty, 0),
    totalAdjustment: items.reduce((sum, i) => sum + i.adjustmentQty, 0),
    totalCurrentStock: items.reduce((sum, i) => sum + i.currentStock, 0),
    integrityStatus: errors.length === 0 ? 'PASS' as const : 'FAIL' as const,
    errorCount: errors.length
  };
  
  return {
    date,
    items,
    summary,
    errors
  };
}

/**
 * [DEPRECATED] 반제품 일일 수불부 조회 
 * 
 * ⚠️ v3.5.1: 반제품 테이블(semi_finished_transactions)은 스키마가 다르므로 
 *    현재 작업에서 완전히 배제됨. 향후 별도 리팩토링 필요.
 * 
 * 문제점:
 * - semi_finished_transactions 테이블에 trans_date 컬럼 없음
 * - transaction_type 사용 (trans_type 아님)
 * - 시계열 조회 불가능
 * 
 * @deprecated 반제품 수불부는 별도 구현 필요
 */
export async function getSemiFinishedDailyReport(
  db: D1Database,
  date: string
): Promise<DailyStockReport> {
  // ⚠️ 반제품 테이블은 현재 지원하지 않음
  // TODO: semi_finished_transactions 테이블 스키마 마이그레이션 후 재구현
  console.warn('[getSemiFinishedDailyReport] 반제품 수불부는 현재 지원되지 않습니다. 빈 결과 반환.');
  
  return {
    date,
    items: [],
    summary: {
      totalItems: 0,
      totalPrevStock: 0,
      totalInbound: 0,
      totalUsed: 0,
      totalAdjustment: 0,
      totalCurrentStock: 0,
      integrityStatus: 'PASS',
      errorCount: 0
    },
    errors: []
  };
}

/**
 * 특정 시점의 재고 조회 (소급 조회)
 */
export async function getStockAtPoint(
  db: D1Database,
  itemCode: string,
  asOfDate: string
): Promise<StockAtPoint | null> {
  const result = await db.prepare(`
    SELECT 
      t.item_code,
      COALESCE(m.item_name, t.item_code) as item_name,
      COALESCE(m.unit, 'kg') as unit,
      SUM(t.quantity) as stock
    FROM transactions t
    LEFT JOIN master m ON t.item_code = m.item_code
    WHERE t.item_code = ? AND t.trans_date <= ?
    GROUP BY t.item_code
  `).bind(itemCode, asOfDate).first<{
    item_code: string;
    item_name: string;
    unit: string;
    stock: number;
  }>();
  
  if (!result) return null;
  
  return {
    itemCode: result.item_code,
    itemName: result.item_name,
    unit: result.unit,
    stock: Number(result.stock) || 0,
    asOfDate
  };
}

// ===== 정합성 체크 (Sanity Check) =====

/**
 * Master.current_stock vs Transactions SUM 정합성 검증
 */
export async function checkInventoryIntegrity(
  db: D1Database
): Promise<IntegrityCheckResult> {
  const checkedAt = new Date().toISOString();
  
  // 제외 품목 WHERE 절 생성
  const excludeClause = INVENTORY_EXCLUDE_CODES.length > 0
    ? `AND m.item_code NOT IN (${INVENTORY_EXCLUDE_CODES.map(() => '?').join(',')})`
    : '';
  
  // Master 재고 vs Transactions 합계 비교
  const comparisonQuery = `
    SELECT 
      m.item_code,
      m.item_name,
      m.current_stock as master_stock,
      COALESCE(t.trans_sum, 0) as transaction_sum,
      COALESCE(i.inbound_sum, 0) as inbound_sum,
      ABS(m.current_stock - COALESCE(t.trans_sum, 0)) as diff_trans,
      ABS(m.current_stock - COALESCE(i.inbound_sum, 0)) as diff_inbound
    FROM master m
    LEFT JOIN (
      SELECT item_code, SUM(quantity) as trans_sum
      FROM transactions
      GROUP BY item_code
    ) t ON m.item_code = t.item_code
    LEFT JOIN (
      SELECT item_code, SUM(remain_qty) as inbound_sum
      FROM inbound
      GROUP BY item_code
    ) i ON m.item_code = i.item_code
    WHERE m.category = '원료'
      ${excludeClause}
      AND (
        ABS(m.current_stock - COALESCE(t.trans_sum, 0)) > 0.01
        OR ABS(m.current_stock - COALESCE(i.inbound_sum, 0)) > 0.01
      )
    ORDER BY diff_trans DESC
  `;
  
  const mismatches = await db.prepare(comparisonQuery).bind(...INVENTORY_EXCLUDE_CODES).all<{
    item_code: string;
    item_name: string;
    master_stock: number;
    transaction_sum: number;
    inbound_sum: number;
    diff_trans: number;
    diff_inbound: number;
  }>();
  
  // 전체 원료 수
  const totalResult = await db.prepare(`
    SELECT COUNT(*) as total FROM master WHERE category = '원료'
  `).first<{ total: number }>();
  const totalItems = totalResult?.total || 0;
  
  const mismatchList = (mismatches.results || []).map(row => {
    const diff = Math.abs(Number(row.master_stock) - Number(row.transaction_sum));
    let severity: 'HIGH' | 'MEDIUM' | 'LOW';
    if (diff > 100) severity = 'HIGH';
    else if (diff > 10) severity = 'MEDIUM';
    else severity = 'LOW';
    
    return {
      itemCode: row.item_code,
      itemName: row.item_name,
      masterStock: Number(row.master_stock) || 0,
      transactionSum: Number(row.transaction_sum) || 0,
      inboundSum: Number(row.inbound_sum) || 0,
      difference: diff,
      severity
    };
  });
  
  const mismatchCount = mismatchList.length;
  const matchCount = totalItems - mismatchCount;
  
  // 권장 조치 생성
  const recommendations: string[] = [];
  if (mismatchCount > 0) {
    recommendations.push(`${mismatchCount}개 품목의 재고 불일치가 발견되었습니다.`);
    
    const highSeverity = mismatchList.filter(m => m.severity === 'HIGH');
    if (highSeverity.length > 0) {
      recommendations.push(`긴급: ${highSeverity.length}개 품목이 100kg 이상 차이납니다. 즉시 확인 필요.`);
    }
    
    recommendations.push('불일치 원인: 1) /production/confirm에서 transactions 기록 누락, 2) 수동 재고 조정 미반영');
    recommendations.push('해결 방법: 백필 스크립트 실행 또는 재고조정 트랜잭션 추가');
  }
  
  let status: 'PASS' | 'FAIL' | 'WARNING';
  if (mismatchCount === 0) status = 'PASS';
  else if (mismatchList.some(m => m.severity === 'HIGH')) status = 'FAIL';
  else status = 'WARNING';
  
  return {
    status,
    checkedAt,
    totalItems,
    matchCount,
    mismatchCount,
    mismatches: mismatchList,
    recommendations
  };
}

/**
 * 특정 품목의 트랜잭션 이력 조회 (디버깅/감사용)
 */
export async function getItemTransactionHistory(
  db: D1Database,
  itemCode: string,
  startDate?: string,
  endDate?: string,
  limit: number = 100
): Promise<Array<{
  id: number;
  transDate: string;
  transType: string;
  quantity: number;
  lotNumber: string | null;
  memo: string | null;
  runningTotal: number;
}>> {
  let query = `
    SELECT 
      id, trans_date, trans_type, quantity, lot_number, memo,
      SUM(quantity) OVER (ORDER BY trans_date, id) as running_total
    FROM transactions
    WHERE item_code = ?
  `;
  const params: any[] = [itemCode];
  
  if (startDate) {
    query += ' AND trans_date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND trans_date <= ?';
    params.push(endDate);
  }
  
  query += ` ORDER BY trans_date DESC, id DESC LIMIT ?`;
  params.push(limit);
  
  const result = await db.prepare(query).bind(...params).all<{
    id: number;
    trans_date: string;
    trans_type: string;
    quantity: number;
    lot_number: string | null;
    memo: string | null;
    running_total: number;
  }>();
  
  return (result.results || []).map(row => ({
    id: row.id,
    transDate: row.trans_date,
    transType: row.trans_type,
    quantity: row.quantity,
    lotNumber: row.lot_number,
    memo: row.memo,
    runningTotal: row.running_total
  }));
}
