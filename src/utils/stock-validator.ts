/**
 * ★★★ v3.4.27: 재고 무결성 검증 시스템 ★★★
 * 
 * 이카운트 수준의 정확한 재고 관리를 위한 핵심 유틸리티
 * 
 * 원칙:
 * 1. 모든 재고 조회는 LOT 잔량 합계(inbound.remain_qty) 기반
 * 2. master.current_stock은 참고용 (LOT 합계와 동기화 필요)
 * 3. 불일치 발견 시 즉시 알림 및 로그
 * 4. AI 추론 없이 DB 실제 데이터만 사용
 */

// ===== 타입 정의 =====
export interface StockInfo {
  item_code: string;
  item_name: string;
  lot_stock: number;      // LOT 잔량 합계 (신뢰할 값)
  master_stock: number;   // 마스터 재고 (참고용)
  unit: string;
  category: 'raw' | 'product' | 'semi';
  is_consistent: boolean; // LOT와 마스터 일치 여부
  difference: number;     // 차이값
  source: 'lot' | 'master' | 'not_found';
}

export interface StockValidationResult {
  success: boolean;
  total_items: number;
  consistent_count: number;
  inconsistent_count: number;
  not_found_count: number;
  items: StockInfo[];
  inconsistent_items: StockInfo[];
}

export interface MaterialRequirement {
  item_code: string;
  item_name: string;
  required_qty: number;
  available_qty: number;
  unit: string;
  is_sufficient: boolean;
  shortage: number;
  source: string;
}

// ===== 핵심 재고 조회 함수 =====

/**
 * 단일 원료 재고 조회 (LOT 기반)
 * - inbound.remain_qty 합계를 우선 사용
 * - SF 계열은 semi_finished_lots 사용
 */
export async function getVerifiedStock(
  db: D1Database,
  itemCode: string
): Promise<StockInfo> {
  const isSF = itemCode.startsWith('SF');
  
  // 1. LOT 잔량 합계 조회
  let lotStock = 0;
  let source: 'lot' | 'master' | 'not_found' = 'not_found';
  
  if (isSF) {
    const lotResult = await db.prepare(`
      SELECT COALESCE(SUM(remain_qty), 0) as total
      FROM semi_finished_lots 
      WHERE item_code = ? AND remain_qty > 0
    `).bind(itemCode).first<{ total: number }>();
    lotStock = lotResult?.total || 0;
    if (lotStock > 0) source = 'lot';
  } else {
    const lotResult = await db.prepare(`
      SELECT COALESCE(SUM(remain_qty), 0) as total
      FROM inbound 
      WHERE item_code = ? AND remain_qty > 0
    `).bind(itemCode).first<{ total: number }>();
    lotStock = lotResult?.total || 0;
    if (lotStock > 0) source = 'lot';
  }
  
  // 2. 마스터 정보 조회
  let masterInfo;
  if (isSF) {
    // semi_finished_items에는 별도 마스터 재고 컬럼이 없음 (LOT 합계만 사용)
    masterInfo = await db.prepare(`
      SELECT item_code, item_name, unit
      FROM semi_finished_items WHERE item_code = ?
    `).bind(itemCode).first<any>();
  } else {
    masterInfo = await db.prepare(`
      SELECT item_code, item_name, current_stock, unit, category
      FROM master WHERE item_code = ?
    `).bind(itemCode).first<any>();
  }
  
  const masterStock = isSF ? lotStock : (masterInfo?.current_stock || 0);
  
  // LOT에 없으면 마스터 사용
  if (source === 'not_found' && masterStock > 0) {
    source = 'master';
  }
  
  // 3. 일치 여부 확인 (허용 오차: 0.01)
  const difference = Math.abs(lotStock - masterStock);
  const isConsistent = difference < 0.01 || (lotStock === 0 && masterStock === 0);
  
  return {
    item_code: itemCode,
    item_name: masterInfo?.item_name || itemCode,
    lot_stock: lotStock,
    master_stock: masterStock,
    unit: masterInfo?.unit || 'kg',
    category: isSF ? 'semi' : (masterInfo?.category === '제품' ? 'product' : 'raw'),
    is_consistent: isConsistent,
    difference: difference,
    source: source
  };
}

/**
 * 여러 원료 재고 일괄 조회 (성능 최적화)
 */
export async function getBulkVerifiedStock(
  db: D1Database,
  itemCodes: string[]
): Promise<Map<string, StockInfo>> {
  const results = new Map<string, StockInfo>();
  
  if (itemCodes.length === 0) return results;
  
  // SF와 일반 원료 분리
  const sfCodes = itemCodes.filter(c => c.startsWith('SF'));
  const rawCodes = itemCodes.filter(c => !c.startsWith('SF'));
  
  // 일반 원료 LOT 합계 일괄 조회
  if (rawCodes.length > 0) {
    const placeholders = rawCodes.map(() => '?').join(',');
    const lotSums = await db.prepare(`
      SELECT item_code, COALESCE(SUM(remain_qty), 0) as total
      FROM inbound 
      WHERE item_code IN (${placeholders}) AND remain_qty > 0
      GROUP BY item_code
    `).bind(...rawCodes).all<{ item_code: string; total: number }>();
    
    const masterData = await db.prepare(`
      SELECT item_code, item_name, current_stock, unit, category
      FROM master WHERE item_code IN (${placeholders})
    `).bind(...rawCodes).all<any>();
    
    const lotMap = new Map((lotSums.results || []).map(r => [r.item_code, r.total]));
    const masterMap = new Map((masterData.results || []).map(r => [r.item_code, r]));
    
    for (const code of rawCodes) {
      const lotStock = lotMap.get(code) || 0;
      const master = masterMap.get(code);
      const masterStock = master?.current_stock || 0;
      const difference = Math.abs(lotStock - masterStock);
      
      results.set(code, {
        item_code: code,
        item_name: master?.item_name || code,
        lot_stock: lotStock,
        master_stock: masterStock,
        unit: master?.unit || 'kg',
        category: master?.category === '제품' ? 'product' : 'raw',
        is_consistent: difference < 0.01,
        difference: difference,
        source: lotStock > 0 ? 'lot' : (masterStock > 0 ? 'master' : 'not_found')
      });
    }
  }
  
  // SF 원료 LOT 합계 일괄 조회
  if (sfCodes.length > 0) {
    const placeholders = sfCodes.map(() => '?').join(',');
    const lotSums = await db.prepare(`
      SELECT item_code, COALESCE(SUM(remain_qty), 0) as total
      FROM semi_finished_lots 
      WHERE item_code IN (${placeholders}) AND remain_qty > 0
      GROUP BY item_code
    `).bind(...sfCodes).all<{ item_code: string; total: number }>();
    
    const sfData = await db.prepare(`
      SELECT item_code, item_name, unit
      FROM semi_finished_items WHERE item_code IN (${placeholders})
    `).bind(...sfCodes).all<any>();
    
    const lotMap = new Map((lotSums.results || []).map(r => [r.item_code, r.total]));
    const sfMap = new Map((sfData.results || []).map(r => [r.item_code, r]));
    
    for (const code of sfCodes) {
      const lotStock = lotMap.get(code) || 0;
      const sf = sfMap.get(code);
      const masterStock = lotStock; // SF 재고는 항상 LOT 합계 = 마스터값 (별도 컬럼 없음)
      const difference = Math.abs(lotStock - masterStock);
      
      results.set(code, {
        item_code: code,
        item_name: sf?.item_name || code,
        lot_stock: lotStock,
        master_stock: masterStock,
        unit: sf?.unit || 'kg',
        category: 'semi',
        is_consistent: difference < 0.01,
        difference: difference,
        source: lotStock > 0 ? 'lot' : (masterStock > 0 ? 'master' : 'not_found')
      });
    }
  }
  
  return results;
}

/**
 * 전체 원료 재고 일관성 검증
 */
export async function validateAllStock(
  db: D1Database
): Promise<StockValidationResult> {
  // 1. 모든 원료의 LOT 합계와 마스터 비교
  const rawMaterialCheck = await db.prepare(`
    SELECT 
      m.item_code,
      m.item_name,
      m.current_stock as master_stock,
      m.unit,
      COALESCE(SUM(i.remain_qty), 0) as lot_stock,
      ABS(m.current_stock - COALESCE(SUM(i.remain_qty), 0)) as difference
    FROM master m
    LEFT JOIN inbound i ON m.item_code = i.item_code AND i.remain_qty > 0
    WHERE m.category = '원료'
    GROUP BY m.item_code
  `).all<any>();
  
  // 2. SF 원료 검증 (별도 마스터 재고 컬럼 없음 -> LOT 합계를 그대로 사용, 항상 일치)
  const sfCheck = await db.prepare(`
    SELECT 
      sf.item_code,
      sf.item_name,
      COALESCE(SUM(sfl.remain_qty), 0) as master_stock,
      sf.unit,
      COALESCE(SUM(sfl.remain_qty), 0) as lot_stock,
      0 as difference
    FROM semi_finished_items sf
    LEFT JOIN semi_finished_lots sfl ON sf.item_code = sfl.item_code AND sfl.remain_qty > 0
    WHERE sf.is_active = 1
    GROUP BY sf.item_code
  `).all<any>();
  
  const allItems: StockInfo[] = [];
  const inconsistentItems: StockInfo[] = [];
  
  // 원료 처리
  for (const item of rawMaterialCheck.results || []) {
    const isConsistent = item.difference < 0.01;
    const stockInfo: StockInfo = {
      item_code: item.item_code,
      item_name: item.item_name,
      lot_stock: item.lot_stock,
      master_stock: item.master_stock,
      unit: item.unit,
      category: 'raw',
      is_consistent: isConsistent,
      difference: item.difference,
      source: item.lot_stock > 0 ? 'lot' : 'master'
    };
    allItems.push(stockInfo);
    if (!isConsistent) inconsistentItems.push(stockInfo);
  }
  
  // SF 원료 처리
  for (const item of sfCheck.results || []) {
    const isConsistent = item.difference < 0.01;
    const stockInfo: StockInfo = {
      item_code: item.item_code,
      item_name: item.item_name,
      lot_stock: item.lot_stock,
      master_stock: item.master_stock,
      unit: item.unit,
      category: 'semi',
      is_consistent: isConsistent,
      difference: item.difference,
      source: item.lot_stock > 0 ? 'lot' : 'master'
    };
    allItems.push(stockInfo);
    if (!isConsistent) inconsistentItems.push(stockInfo);
  }
  
  return {
    success: inconsistentItems.length === 0,
    total_items: allItems.length,
    consistent_count: allItems.length - inconsistentItems.length,
    inconsistent_count: inconsistentItems.length,
    not_found_count: allItems.filter(i => i.source === 'not_found').length,
    items: allItems,
    inconsistent_items: inconsistentItems
  };
}

// ===== 재고 동기화 함수 =====

/**
 * 마스터 재고를 LOT 합계로 동기화
 */
export async function syncMasterStockFromLots(
  db: D1Database,
  itemCode?: string
): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;
  
  try {
    if (itemCode) {
      // 단일 품목 동기화
      const stock = await getVerifiedStock(db, itemCode);
      if (!stock.is_consistent && stock.source === 'lot') {
        if (itemCode.startsWith('SF')) {
          await db.prepare(`
            UPDATE semi_finished_items 
            SET current_stock = ?, updated_at = CURRENT_TIMESTAMP
            WHERE item_code = ?
          `).bind(stock.lot_stock, itemCode).run();
        } else {
          await db.prepare(`
            UPDATE master 
            SET current_stock = ?, updated_at = CURRENT_TIMESTAMP
            WHERE item_code = ?
          `).bind(stock.lot_stock, itemCode).run();
        }
        synced = 1;
      }
    } else {
      // 전체 동기화
      // 원료
      await db.prepare(`
        UPDATE master 
        SET current_stock = COALESCE((
          SELECT SUM(remain_qty) FROM inbound 
          WHERE item_code = master.item_code AND remain_qty > 0
        ), 0),
        updated_at = CURRENT_TIMESTAMP
        WHERE category = '원료'
      `).run();
      
      // SF 원료
      await db.prepare(`
        UPDATE semi_finished_items 
        SET current_stock = COALESCE((
          SELECT SUM(remain_qty) FROM semi_finished_lots 
          WHERE item_code = semi_finished_items.item_code AND remain_qty > 0
        ), 0),
        updated_at = CURRENT_TIMESTAMP
      `).run();
      
      // 동기화된 항목 수 조회
      const countResult = await db.prepare(`
        SELECT COUNT(*) as cnt FROM master WHERE category = '원료'
      `).first<{ cnt: number }>();
      const sfCountResult = await db.prepare(`
        SELECT COUNT(*) as cnt FROM semi_finished_items WHERE is_active = 1
      `).first<{ cnt: number }>();
      
      synced = (countResult?.cnt || 0) + (sfCountResult?.cnt || 0);
    }
    
    // 감사 로그 기록
    await db.prepare(`
      INSERT INTO stock_audit_log (action, item_code, details, created_at)
      VALUES ('SYNC', ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      itemCode || 'ALL',
      JSON.stringify({ synced, timestamp: new Date().toISOString() })
    ).run();
    
  } catch (error: any) {
    errors.push(error.message);
  }
  
  return { synced, errors };
}

// ===== BOM 기반 원료 소요량 계산 =====

/**
 * 생산 예정 품목에 대한 원료 소요량 및 재고 확인
 */
export async function calculateMaterialRequirements(
  db: D1Database,
  items: Array<{ product_code: string; quantity: number }>
): Promise<{
  requirements: MaterialRequirement[];
  has_shortage: boolean;
  shortage_count: number;
}> {
  // 모든 제품의 BOM 조회
  const productCodes = items.map(i => i.product_code);
  const placeholders = productCodes.map(() => '?').join(',');
  
  const bomData = await db.prepare(`
    SELECT b.product_code, b.item_code, b.quantity, b.unit,
           COALESCE(m.item_name, sf.item_name, b.item_code) as item_name
    FROM bom b
    LEFT JOIN master m ON b.item_code = m.item_code
    LEFT JOIN semi_finished_items sf ON b.item_code = sf.item_code
    WHERE b.product_code IN (${placeholders})
  `).bind(...productCodes).all<any>();
  
  // 제품별 수량 맵
  const qtyMap = new Map(items.map(i => [i.product_code, i.quantity]));
  
  // 원료별 소요량 합계
  const requirementMap = new Map<string, { 
    item_name: string; 
    required: number; 
    unit: string 
  }>();
  
  for (const bom of bomData.results || []) {
    const prodQty = qtyMap.get(bom.product_code) || 0;
    const required = bom.quantity * prodQty;
    
    if (requirementMap.has(bom.item_code)) {
      const existing = requirementMap.get(bom.item_code)!;
      existing.required += required;
    } else {
      requirementMap.set(bom.item_code, {
        item_name: bom.item_name,
        required: required,
        unit: bom.unit || 'g'
      });
    }
  }
  
  // 재고 일괄 조회
  const itemCodes = Array.from(requirementMap.keys());
  const stockMap = await getBulkVerifiedStock(db, itemCodes);
  
  // 결과 생성
  const requirements: MaterialRequirement[] = [];
  let shortageCount = 0;
  
  for (const [itemCode, req] of requirementMap.entries()) {
    const stock = stockMap.get(itemCode);
    const available = stock?.lot_stock || stock?.master_stock || 0;
    const isSufficient = available >= req.required;
    
    if (!isSufficient) shortageCount++;
    
    requirements.push({
      item_code: itemCode,
      item_name: req.item_name,
      required_qty: req.required,
      available_qty: available,
      unit: req.unit,
      is_sufficient: isSufficient,
      shortage: Math.max(0, req.required - available),
      source: stock?.source || 'not_found'
    });
  }
  
  // 부족량 기준 내림차순 정렬
  requirements.sort((a, b) => b.shortage - a.shortage);
  
  return {
    requirements,
    has_shortage: shortageCount > 0,
    shortage_count: shortageCount
  };
}

// ===== 불일치 감지 및 알림 =====

/**
 * 재고 불일치 감지 및 로그 기록
 */
export async function detectAndLogInconsistencies(
  db: D1Database
): Promise<{ detected: number; logged: number }> {
  const validation = await validateAllStock(db);
  
  if (validation.inconsistent_count === 0) {
    return { detected: 0, logged: 0 };
  }
  
  // 불일치 항목 로그 기록
  for (const item of validation.inconsistent_items) {
    await db.prepare(`
      INSERT INTO stock_audit_log (action, item_code, details, created_at)
      VALUES ('INCONSISTENCY_DETECTED', ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      item.item_code,
      JSON.stringify({
        item_name: item.item_name,
        lot_stock: item.lot_stock,
        master_stock: item.master_stock,
        difference: item.difference,
        detected_at: new Date().toISOString()
      })
    ).run();
  }
  
  return {
    detected: validation.inconsistent_count,
    logged: validation.inconsistent_count
  };
}

export default {
  getVerifiedStock,
  getBulkVerifiedStock,
  validateAllStock,
  syncMasterStockFromLots,
  calculateMaterialRequirements,
  detectAndLogInconsistencies
};
