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
  let query = `
    SELECT p.*, 
           pi.production_name as production_name,
           COALESCE(pb.product_name, pi.alias1) as barcode_product_name,
           COALESCE(pb.channel, p.channel) as channel,
           COALESCE(m.unit, 'EA') as product_unit,
           COALESCE(pi.shelf_life_days, 7) as shelf_life_days,
           COALESCE(p.expiry_date, date(p.prod_date, '+' || COALESCE(pi.shelf_life_days, 7) || ' days')) as calculated_expiry_date
    FROM production p
    LEFT JOIN master m ON p.product_code = m.item_code
    LEFT JOIN production_items pi ON p.product_code = pi.production_code
    LEFT JOIN production_barcodes pb ON p.product_code = pb.production_code
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
  
  query += ' ORDER BY p.prod_date DESC, p.id DESC';
  
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
productionRoutes.post('/batch', async (c) => {
  const body = await c.req.json();
  const { items, prod_date, memo, channel: defaultChannel } = body;
  // items: [{ product_code, quantity, channel?, expiry_date? }]
  
  if (!items || items.length === 0) {
    return c.json({ success: false, error: '등록할 항목이 없습니다.' }, 400);
  }
  
  const productionDate = prod_date || new Date().toISOString().split('T')[0];
  const results: any[] = [];
  let successCount = 0;
  let failCount = 0;
  
  // 모든 제품 정보를 한 번에 조회 (master + production_items + production_barcodes)
  const productCodes = items.map((i: any) => i.product_code);
  const placeholders = productCodes.map(() => '?').join(',');
  
  // 1. master 테이블에서 조회
  const products = await c.env.DB.prepare(`
    SELECT item_code, item_name, expiry_days FROM master 
    WHERE item_code IN (${placeholders}) AND category = '제품'
  `).bind(...productCodes).all<any>();
  
  // 2. production_items 테이블에서 조회
  const productionItems = await c.env.DB.prepare(`
    SELECT production_code as item_code, production_name as item_name, shelf_life_days as expiry_days 
    FROM production_items 
    WHERE production_code IN (${placeholders})
  `).bind(...productCodes).all<any>();
  
  // 3. production_barcodes 테이블에서도 조회 (바코드 매핑된 경우)
  const barcodeItems = await c.env.DB.prepare(`
    SELECT pb.production_code as item_code, 
           pi.production_name as item_name,
           COALESCE(pi.shelf_life_days, 7) as expiry_days
    FROM production_barcodes pb
    LEFT JOIN production_items pi ON pb.production_code = pi.production_code
    WHERE pb.production_code IN (${placeholders})
  `).bind(...productCodes).all<any>();
  
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
    WHERE b.product_code IN (${placeholders})
  `).bind(...productCodes).all<any>();
  
  // production_bom 테이블에서도 조회
  const prodBom = await c.env.DB.prepare(`
    SELECT pb.production_code as product_code, pb.material_code as item_code, 
           pb.quantity, pb.unit, pb.material_code as matched_item_code, pb.material_name as item_name
    FROM production_bom pb
    WHERE pb.production_code IN (${placeholders})
  `).bind(...productCodes).all<any>();
  
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
  
  // 원재료 차감 누적 (한 번에 처리)
  const materialDeductions = new Map<string, { qty: number, itemName: string, memos: string[] }>();
  
  // 각 제품 등록
  for (const item of items) {
    const product = productMap.get(item.product_code);
    
    if (!product) {
      results.push({ product_code: item.product_code, success: false, error: '제품 없음' });
      failCount++;
      continue;
    }
    
    try {
      const productLot = `PRD-${productionDate.replace(/-/g, '')}-${item.product_code}-${String(Date.now()).slice(-4)}`;
      
      // 소비기한 계산 (item에서 받거나 shelf_life_days로 계산)
      const expiryDays = product.expiry_days || 7;
      const itemExpiryDate = item.expiry_date || (() => {
        const d = new Date(productionDate);
        d.setDate(d.getDate() + expiryDays);
        return d.toISOString().split('T')[0];
      })();
      
      // 판매처 (item에서 받거나 기본값 사용)
      const itemChannel = item.channel || defaultChannel || 'unknown';
      
      // 1. 생산 기록 등록 (소비기한, 판매처 포함)
      const prodResult = await c.env.DB.prepare(`
        INSERT INTO production (prod_date, product_code, quantity, lot_number, status, memo, expiry_date, channel)
        VALUES (?, ?, ?, ?, '완료', ?, ?, ?)
      `).bind(productionDate, item.product_code, item.quantity, productLot, memo || '발주서 일괄등록', itemExpiryDate, itemChannel).run();
      
      const productionId = prodResult.meta.last_row_id;
      
      // 2. BOM 기반 원재료 차감 누적
      const bomItems = bomMap.get(item.product_code) || [];
      for (const bom of bomItems) {
        const actualItemCode = bom.matched_item_code || bom.item_code;
        const requiredQty = bom.quantity * item.quantity;
        const requiredKg = bom.unit === 'g' ? requiredQty / 1000 : requiredQty;
        
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
        
        // 생산 자재 기록
        await c.env.DB.prepare(`
          INSERT INTO production_materials (production_id, item_code, planned_qty, actual_qty, unit)
          VALUES (?, ?, ?, ?, ?)
        `).bind(productionId, actualItemCode, requiredQty, requiredQty, bom.unit).run();
      }
      
      // 3. 제품 재고 증가 (production_items 테이블 사용)
      await c.env.DB.prepare(`
        UPDATE production_items SET current_stock = COALESCE(current_stock, 0) + ?, updated_at = CURRENT_TIMESTAMP
        WHERE production_code = ?
      `).bind(item.quantity, item.product_code).run();
      
      // 4. 제품 입고 기록 (production_inbound 테이블 사용)
      await c.env.DB.prepare(`
        INSERT INTO production_inbound (lot_number, production_code, inbound_date, expiry_date, origin_qty, remain_qty, quality_status, memo)
        VALUES (?, ?, ?, date(?, '+' || ? || ' days'), ?, ?, '합격', ?)
      `).bind(
        productLot,
        item.product_code,
        productionDate,
        productionDate,
        product.expiry_days || 30,
        item.quantity,
        item.quantity,
        `생산입고 (생산ID: ${productionId})`
      ).run();
      
      // 5. 제품 입고 트랜잭션 (production_transactions 테이블 사용)
      await c.env.DB.prepare(`
        INSERT INTO production_transactions (trans_date, production_code, trans_type, quantity, lot_number, memo)
        VALUES (?, ?, '생산입고', ?, ?, ?)
      `).bind(productionDate, item.product_code, item.quantity, productLot, `생산입고 (생산ID: ${productionId})`).run();
      
      // 6. HACCP 제품 수불부: 익일 자동 출고 트랜잭션 생성
      // 생산 후 다음날 출고 처리 (HACCP 요구사항)
      const nextDay = new Date(productionDate);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = nextDay.toISOString().split('T')[0];
      
      await c.env.DB.prepare(`
        INSERT INTO production_transactions (trans_date, production_code, trans_type, quantity, lot_number, memo)
        VALUES (?, ?, '출고', ?, ?, ?)
      `).bind(nextDayStr, item.product_code, item.quantity, productLot, `생산출고 (생산ID: ${productionId}, 생산일: ${productionDate})`).run();
      
      // 7. 익일 출고 시 production_inbound remain_qty 차감 및 재고 차감
      await c.env.DB.prepare(`
        UPDATE production_inbound SET remain_qty = remain_qty - ?, updated_at = CURRENT_TIMESTAMP
        WHERE lot_number = ? AND production_code = ?
      `).bind(item.quantity, productLot, item.product_code).run();
      
      await c.env.DB.prepare(`
        UPDATE production_items SET current_stock = COALESCE(current_stock, 0) - ?, updated_at = CURRENT_TIMESTAMP
        WHERE production_code = ?
      `).bind(item.quantity, item.product_code).run();
      
      results.push({ 
        product_code: item.product_code, 
        product_name: product.item_name,
        quantity: item.quantity,
        lot_number: productLot,
        success: true 
      });
      successCount++;
      
    } catch (error: any) {
      console.error('Batch production error:', item.product_code, error);
      results.push({ product_code: item.product_code, success: false, error: error.message });
      failCount++;
    }
  }
  
  // 원재료 일괄 차감 및 트랜잭션 기록
  for (const [itemCode, data] of materialDeductions) {
    try {
      // 정제수는 재고 차감 제외 (사용량 기록만)
      const isWater = data.itemName.includes('정제수');
      
      if (isWater) {
        // 정제수: 사용 트랜잭션만 기록 (재고 차감 안함)
        await c.env.DB.prepare(`
          INSERT INTO transactions (trans_date, item_code, trans_type, quantity, memo)
          VALUES (?, ?, '사용', ?, ?)
        `).bind(
          productionDate, 
          itemCode, 
          data.qty, 
          `생산사용(재고미차감): ${data.memos.slice(0, 3).join(', ')}${data.memos.length > 3 ? ` 외 ${data.memos.length - 3}건` : ''} - 정제수`
        ).run();
        continue; // 재고 차감 건너뛰기
      }
      
      // 마스터 재고 차감
      await c.env.DB.prepare(`
        UPDATE master SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP
        WHERE item_code = ?
      `).bind(data.qty, itemCode).run();
      
      // 사용 트랜잭션 기록
      await c.env.DB.prepare(`
        INSERT INTO transactions (trans_date, item_code, trans_type, quantity, memo)
        VALUES (?, ?, '사용', ?, ?)
      `).bind(
        productionDate, 
        itemCode, 
        data.qty, 
        `생산사용: ${data.memos.slice(0, 3).join(', ')}${data.memos.length > 3 ? ` 외 ${data.memos.length - 3}건` : ''}`
      ).run();
    } catch (e) {
      console.error('Material deduction error:', itemCode, e);
    }
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
