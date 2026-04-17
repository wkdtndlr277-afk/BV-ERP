// 생산 관리 API
import { Hono } from 'hono';
import type { Bindings } from '../types';

const productionRoutes = new Hono<{ Bindings: Bindings }>();

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
             (SELECT channel FROM production_barcodes WHERE production_code = p.product_code LIMIT 1),
             p.channel
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

// 생산 등록 (BOM 기반 원료 자동 차감)
productionRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const { prod_date, product_code, quantity, lot_number, memo, created_by } = body;
  
  if (!prod_date || !product_code || !quantity) {
    return c.json({ success: false, error: '생산일, 제품, 수량은 필수입니다.' }, 400);
  }
  
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
  
  const bomItems = bomResult.results || [];
  
  // 재고 확인 (BOM이 있는 경우만)
  const stockErrors: string[] = [];
  for (const bom of bomItems) {
    // 매칭된 실제 아이템 코드 사용 (RM/R 코드 자동 매칭)
    const actualItemCode = bom.matched_item_code || bom.item_code;
    const requiredQty = bom.quantity * quantity;
    // 단위 변환: BOM은 g 기준, 재고는 kg 기준일 수 있음
    const requiredKg = bom.unit === 'g' ? requiredQty / 1000 : requiredQty;
    
    if (bom.current_stock < requiredKg) {
      stockErrors.push(`${bom.item_name || actualItemCode}: 필요 ${requiredKg.toFixed(2)}kg, 재고 ${bom.current_stock.toFixed(2)}kg`);
    }
    // 매칭된 코드를 BOM 객체에 저장하여 나중에 사용
    bom.actualItemCode = actualItemCode;
  }
  
  if (stockErrors.length > 0) {
    return c.json({ 
      success: false, 
      error: '원재료 재고가 부족합니다.',
      details: stockErrors
    }, 400);
  }
  
  // 제품 LOT 자동 생성 (없으면)
  const productLot = lot_number || `PRD-${prod_date.replace(/-/g, '')}-${product_code}-${String(Date.now()).slice(-4)}`;
  
  try {
    // 1. 생산 기록 등록
    const prodResult = await c.env.DB.prepare(`
      INSERT INTO production (prod_date, product_code, quantity, lot_number, status, memo, created_by)
      VALUES (?, ?, ?, ?, '완료', ?, ?)
    `).bind(prod_date, product_code, quantity, productLot, memo || null, created_by || null).run();
    
    const productionId = prodResult.meta.last_row_id;
    
    // 2. 원재료 차감 (BOM 기반, FEFO)
    for (const bom of bomItems) {
      const requiredQty = bom.quantity * quantity;
      const requiredKg = bom.unit === 'g' ? requiredQty / 1000 : requiredQty;
      
      // 매칭된 실제 아이템 코드
      const actualItemCode = bom.actualItemCode || bom.matched_item_code || bom.item_code;
      
      // 정제수는 재고 차감 제외 (사용량 기록만)
      const itemName = bom.item_name || '';
      const isWater = itemName.includes('정제수');
      
      if (isWater) {
        // 정제수: 사용 기록만 남기고 재고 차감 안함
        await c.env.DB.prepare(`
          INSERT INTO production_materials (production_id, item_code, lot_number, planned_qty, actual_qty, unit)
          VALUES (?, ?, NULL, ?, ?, ?)
        `).bind(productionId, actualItemCode, requiredQty, requiredQty, bom.unit).run();
        
        // 사용 트랜잭션 기록 (재고 차감 없이 기록만)
        await c.env.DB.prepare(`
          INSERT INTO transactions (trans_date, item_code, trans_type, quantity, memo)
          VALUES (?, ?, '사용', ?, ?)
        `).bind(prod_date, actualItemCode, requiredKg, 
          `생산사용(재고미차감): ${product.item_name} ${quantity}개 - 정제수`).run();
        
        continue; // 다음 원재료로
      }
      
      // FEFO 방식으로 LOT에서 차감
      let remainingToDeduct = requiredKg;
      const usedLots: string[] = [];
      let lots = await c.env.DB.prepare(`
        SELECT * FROM inbound 
        WHERE item_code = ? AND remain_qty > 0 AND quality_status = '합격'
        ORDER BY expiry_date ASC, inbound_date ASC
      `).bind(actualItemCode).all<any>();
      
      // LOT이 없으면 다른 형식의 코드로 재시도
      if (!lots.results || lots.results.length === 0) {
        let altCode = '';
        if (actualItemCode.startsWith('RM')) {
          altCode = 'R' + actualItemCode.substring(2);
        } else if (actualItemCode.startsWith('R') && !actualItemCode.startsWith('RM')) {
          altCode = 'RM' + actualItemCode.substring(1);
        }
        if (altCode) {
          lots = await c.env.DB.prepare(`
            SELECT * FROM inbound 
            WHERE item_code = ? AND remain_qty > 0 AND quality_status = '합격'
            ORDER BY expiry_date ASC, inbound_date ASC
          `).bind(altCode).all<any>();
        }
      }
      
      for (const lot of lots.results || []) {
        if (remainingToDeduct <= 0) break;
        
        const deductQty = Math.min(lot.remain_qty, remainingToDeduct);
        usedLots.push(lot.lot_number);
        
        // LOT 잔량 차감
        await c.env.DB.prepare(`
          UPDATE inbound SET remain_qty = remain_qty - ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(deductQty, lot.id).run();
        
        // 거래 이력 기록 (생산사용) - 실제 LOT의 item_code 사용
        await c.env.DB.prepare(`
          INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, remain_qty, memo)
          VALUES (?, ?, '사용', ?, ?, ?, ?)
        `).bind(
          prod_date,
          lot.item_code, // 실제 LOT의 item_code 사용
          deductQty,
          lot.lot_number,
          lot.remain_qty - deductQty,
          `생산사용: ${product.item_name} ${quantity}개 (생산ID: ${productionId})`
        ).run();
        
        remainingToDeduct -= deductQty;
      }
      
      // LOT이 없는 경우 마스터 재고에서 직접 차감
      if (remainingToDeduct > 0) {
        await c.env.DB.prepare(`
          INSERT INTO transactions (trans_date, item_code, trans_type, quantity, memo)
          VALUES (?, ?, '사용', ?, ?)
        `).bind(
          prod_date,
          actualItemCode, // 매칭된 실제 코드 사용
          remainingToDeduct,
          `생산사용: ${product.item_name} ${quantity}개 (생산ID: ${productionId}) - LOT 없음`
        ).run();
      }
      
      // 원재료 사용 기록 (사용된 LOT 번호 포함)
      await c.env.DB.prepare(`
        INSERT INTO production_materials (production_id, item_code, lot_number, planned_qty, actual_qty, unit)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        productionId, 
        actualItemCode, // 매칭된 실제 코드 사용
        usedLots.length > 0 ? usedLots.join(', ') : null,
        requiredQty, 
        requiredQty, 
        bom.unit
      ).run();
      
      // 마스터 재고 업데이트 - 매칭된 실제 코드로 업데이트
      await c.env.DB.prepare(`
        UPDATE master SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP
        WHERE item_code = ?
      `).bind(requiredKg, actualItemCode).run();
    }
    
    // 3. 제품 재고 증가
    await c.env.DB.prepare(`
      UPDATE master SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP
      WHERE item_code = ?
    `).bind(quantity, product_code).run();
    
    // 4. 제품 입고 기록 (생산입고)
    await c.env.DB.prepare(`
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
    ).run();
    
    // 5. 거래 이력 (생산입고)
    await c.env.DB.prepare(`
      INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, remain_qty, memo)
      VALUES (?, ?, '입고', ?, ?, ?, ?)
    `).bind(
      prod_date,
      product_code,
      quantity,
      productLot,
      quantity,
      `생산입고 (생산ID: ${productionId})`
    ).run();
    
    return c.json({ 
      success: true, 
      message: '생산이 등록되었습니다.',
      data: {
        production_id: productionId,
        lot_number: productLot,
        materials_used: bomItems.length
      }
    });
    
  } catch (error: any) {
    console.error('Production error:', error);
    return c.json({ success: false, error: '생산 등록 중 오류가 발생했습니다.' }, 500);
  }
});

// 빠른 일괄 생산 등록 (발주서 업로드용 - 원재료 차감 포함)
// 주의: Cloudflare Workers CPU 제한으로 인해 한 번에 최대 30개까지만 처리
productionRoutes.post('/batch', async (c) => {
  const body = await c.req.json();
  const { items, prod_date, production_date, memo, channel: defaultChannel } = body;
  // items: [{ product_code, quantity, channel?, expiry_date?, barcode?, box_quantity? }]
  
  if (!items || items.length === 0) {
    return c.json({ success: false, error: '등록할 항목이 없습니다.' }, 400);
  }
  
  // 배치 크기 제한 (D1 batch() 사용으로 최적화됨)
  // batch()는 여러 쿼리를 단일 네트워크 요청으로 처리
  const MAX_BATCH_SIZE = 30;
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
  
  // 중복 등록 방지: 해당 날짜에 이미 등록된 제품 확인
  const productCodes = items.map((i: any) => i.product_code);
  const placeholders = productCodes.map(() => '?').join(',');
  
  const existingProductions = await c.env.DB.prepare(`
    SELECT product_code FROM production 
    WHERE prod_date = ? AND product_code IN (${placeholders})
  `).bind(productionDate, ...productCodes).all<any>();
  
  const existingSet = new Set((existingProductions.results || []).map((p: any) => p.product_code));
  
  // 이미 등록된 제품 필터링
  const newItems = items.filter((i: any) => !existingSet.has(i.product_code));
  
  if (newItems.length === 0) {
    return c.json({ 
      success: false, 
      error: `해당 날짜(${productionDate})에 모든 제품이 이미 등록되어 있습니다.`,
      already_registered: existingSet.size
    }, 400);
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
  
  // 모든 제품 정보를 한 번에 조회 (master + production_items + production_barcodes)
  const newPlaceholders = newProductCodes.map(() => '?').join(',');
  
  // 1. master 테이블에서 조회
  const products = await c.env.DB.prepare(`
    SELECT item_code, item_name, expiry_days FROM master 
    WHERE item_code IN (${newPlaceholders}) AND category = '제품'
  `).bind(...newProductCodes).all<any>();
  
  // 2. production_items 테이블에서 조회
  const productionItems = await c.env.DB.prepare(`
    SELECT production_code as item_code, production_name as item_name, shelf_life_days as expiry_days 
    FROM production_items 
    WHERE production_code IN (${newPlaceholders})
  `).bind(...newProductCodes).all<any>();
  
  // 3. production_barcodes 테이블에서도 조회 (바코드 매핑된 경우, box_quantity 및 expiry_days 포함)
  const barcodeItems = await c.env.DB.prepare(`
    SELECT pb.production_code as item_code, 
           pi.production_name as item_name,
           COALESCE(pi.shelf_life_days, 7) as default_expiry_days,
           pb.box_quantity,
           pb.barcode,
           pb.expiry_days as barcode_expiry_days,
           pb.channel
    FROM production_barcodes pb
    LEFT JOIN production_items pi ON pb.production_code = pi.production_code
    WHERE pb.production_code IN (${newPlaceholders})
  `).bind(...newProductCodes).all<any>();
  
  // production_code별 box_quantity 맵 (채널별로 다를 수 있으므로 대표값 사용)
  const boxQuantityMap = new Map<string, number>();
  // 바코드별 소비기한 맵 (바코드 → expiry_days)
  const barcodeExpiryMap = new Map<string, number>();
  for (const b of barcodeItems.results || []) {
    // 여러 바코드가 있을 경우, 가장 큰 box_quantity 사용 (안전하게)
    const current = boxQuantityMap.get(b.item_code) || 1;
    boxQuantityMap.set(b.item_code, Math.max(current, b.box_quantity || 1));
    
    // 바코드별 소비기한 저장 (barcode_expiry_days가 설정된 경우만)
    if (b.barcode && b.barcode_expiry_days) {
      barcodeExpiryMap.set(b.barcode, b.barcode_expiry_days);
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
  
  // 모든 BOM 정보를 한 번에 조회 (기존 bom 테이블 + production_bom 테이블)
  const allBom = await c.env.DB.prepare(`
    SELECT b.product_code, b.item_code, b.quantity, b.unit,
           COALESCE(m1.item_code, m2.item_code) as matched_item_code,
           COALESCE(m1.item_name, m2.item_name) as item_name
    FROM bom b
    LEFT JOIN master m1 ON b.item_code = m1.item_code
    LEFT JOIN master m2 ON (
      (b.item_code LIKE 'RM%' AND m2.item_code = 'R' || SUBSTR(b.item_code, 3)) OR
      (b.item_code LIKE 'R%' AND b.item_code NOT LIKE 'RM%' AND m2.item_code = 'RM' || SUBSTR(b.item_code, 2))
    )
    WHERE b.product_code IN (${newPlaceholders})
  `).bind(...newProductCodes).all<any>();
  
  // production_bom 테이블에서도 조회
  const prodBom = await c.env.DB.prepare(`
    SELECT pb.production_code as product_code, pb.material_code as item_code, 
           pb.quantity, pb.unit, pb.material_code as matched_item_code, pb.material_name as item_name
    FROM production_bom pb
    WHERE pb.production_code IN (${newPlaceholders})
  `).bind(...newProductCodes).all<any>();
  
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
    
    // 소비기한 우선순위: 1) 바코드별 설정 → 2) 생산명 기본값 → 3) 7일
    let expiryDays = product.expiry_days || 7;
    if (item.barcode && barcodeExpiryMap.has(item.barcode)) {
      expiryDays = barcodeExpiryMap.get(item.barcode)!;
    }
    
    const itemExpiryDate = item.expiry_date || (() => {
      const d = new Date(productionDate);
      d.setDate(d.getDate() + expiryDays);
      return d.toISOString().split('T')[0];
    })();
    const itemChannel = item.channel || defaultChannel || 'unknown';
    const boxQuantity = item.box_quantity || boxQuantityMap.get(item.product_code) || 1;
    const actualItemCount = item.quantity * boxQuantity;
    
    preparedItems.push({
      item, product, productLot, itemExpiryDate, itemChannel, expiryDays, actualItemCount
    });
    
    // BOM 처리 (메모리에서만)
    const bomItems = bomMap.get(item.product_code) || [];
    for (const bom of bomItems) {
      const actualItemCode = bom.matched_item_code || bom.item_code;
      const requiredQty = bom.quantity * actualItemCount;
      const requiredKg = bom.unit === 'g' ? requiredQty / 1000 : requiredQty;
      
      materialRecords.push({
        productLot, actualItemCode, requiredQty, unit: bom.unit
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
    
    // 3단계: 입고 기록 일괄 INSERT
    const inboundInserts = preparedItems.map(p =>
      c.env.DB.prepare(`
        INSERT INTO production_inbound (lot_number, production_code, inbound_date, expiry_date, origin_qty, remain_qty, quality_status, memo)
        VALUES (?, ?, ?, date(?, '+' || ? || ' days'), ?, ?, '합격', ?)
      `).bind(p.productLot, p.item.product_code, productionDate, productionDate, p.expiryDays, p.item.quantity, p.item.quantity, '생산입고')
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
    if (isSemiFinished) {
      materialTransactions.push(
        c.env.DB.prepare(`INSERT INTO semi_finished_transactions (trans_date, item_code, trans_type, quantity, memo) VALUES (?, ?, '사용', ?, ?)`)
          .bind(productionDate, itemCode, -data.qty, memoText)
      );
    } else {
      materialTransactions.push(
        c.env.DB.prepare(`INSERT INTO transactions (trans_date, item_code, trans_type, quantity, memo) VALUES (?, ?, '사용', ?, ?)`)
          .bind(productionDate, itemCode, data.qty, memoText)
      );
    }
  }
  
  try {
    if (materialUpdates.length > 0) {
      await c.env.DB.batch(materialUpdates);
    }
    if (semiFinishedUpdates.length > 0) {
      await c.env.DB.batch(semiFinishedUpdates);
    }
    if (materialTransactions.length > 0) {
      await c.env.DB.batch(materialTransactions);
    }
  } catch (e) {
    console.error('Material deduction batch error:', e);
  }
  
  return c.json({
    success: true,
    data: {
      total: items.length,
      success: successCount,
      fail: failCount,
      materials_deducted: materialDeductions.size,
      results
    }
  });
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
      const qtyKg = mat.unit === 'g' ? qty / 1000 : qty;
      
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
    const requiredKg = bom.unit === 'g' ? requiredQty / 1000 : requiredQty;
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

export default productionRoutes;
