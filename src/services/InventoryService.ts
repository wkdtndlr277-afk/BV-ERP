/**
 * InventoryService - 재고 조회 서비스 (수불부 전용)
 * 
 * v3.5.0: transactions 테이블 기반 Single Source of Truth
 * 
 * 핵심 원칙:
 * 1. 모든 재고 계산은 transactions 테이블의 시계열 누적 합산으로 수행
 * 2. 특정 시점의 재고를 소급 조회 가능
 * 3. 수불부 = 전일재고 + 입고 - 사용 ± 조정 = 현재재고
 */

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

// ===== 수불부 조회 함수 (transactions 기반) =====

/**
 * 일일 수불부 조회 - transactions 테이블 기반
 */
export async function getDailyStockReport(
  db: D1Database,
  date: string,
  excludeCodes: string[] = ['R169', 'R170', 'R171', 'R172']
): Promise<DailyStockReport> {
  
  const excludeClause = excludeCodes.length > 0 
    ? `AND t.item_code NOT IN (${excludeCodes.map(() => '?').join(',')})` 
    : '';
  
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
    WHERE 1=1 ${excludeClause}
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
    
    const item: StockBalance = {
      itemCode: row.item_code,
      itemName: row.item_name,
      unit: row.unit,
      prevStock,
      inboundQty,
      usedQty,
      adjustmentQty,
      currentStock,
      lotNumbers: row.lot_numbers || '',
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
 * 반제품 일일 수불부 조회 
 * 주의: semi_finished_transactions 테이블 스키마가 다르므로 빈 결과 반환
 */
export async function getSemiFinishedDailyReport(
  db: D1Database,
  date: string
): Promise<DailyStockReport> {
  // semi_finished_transactions 테이블 스키마가 다름 (trans_date 없음)
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
      AND (
        ABS(m.current_stock - COALESCE(t.trans_sum, 0)) > 0.01
        OR ABS(m.current_stock - COALESCE(i.inbound_sum, 0)) > 0.01
      )
    ORDER BY diff_trans DESC
  `;
  
  const mismatches = await db.prepare(comparisonQuery).all<{
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
