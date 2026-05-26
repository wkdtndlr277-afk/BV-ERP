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
             p.channel,
             (SELECT channel FROM production_barcodes WHERE production_code = p.product_code LIMIT 1)
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

// LOT 수량 수정 (관련 테이블 모두 업데이트)
productionRoutes.put('/lot/:lotNumber', async (c) => {
  const lotNumber = decodeURIComponent(c.req.param('lotNumber'));
  const { quantity, remain_qty } = await c.req.json();
  
  if (!quantity || quantity <= 0) {
    return c.json({ success: false, error: '유효한 수량을 입력하세요' }, 400);
  }
  
  // 기존 생산 기록 조회
  const production = await c.env.DB.prepare(`
    SELECT * FROM production WHERE lot_number = ?
  `).bind(lotNumber).first<any>();
  
  if (!production) {
    return c.json({ success: false, error: '해당 LOT를 찾을 수 없습니다' }, 404);
  }
  
  const oldQuantity = production.quantity;
  
  try {
    // 1. production 테이블 수량 수정
    await c.env.DB.prepare(`
      UPDATE production SET quantity = ? WHERE lot_number = ?
    `).bind(quantity, lotNumber).run();
    
    // 2. production_inbound 수정 (origin_qty, remain_qty 별도 지정 가능)
    try {
      if (remain_qty !== undefined) {
        await c.env.DB.prepare(`
          UPDATE production_inbound 
          SET origin_qty = ?, remain_qty = ?
          WHERE lot_number = ? AND production_code = ?
        `).bind(quantity, remain_qty, lotNumber, production.product_code).run();
      } else {
        await c.env.DB.prepare(`
          UPDATE production_inbound 
          SET origin_qty = ?
          WHERE lot_number = ? AND production_code = ?
        `).bind(quantity, lotNumber, production.product_code).run();
      }
    } catch (e) {
      console.log('production_inbound 업데이트 스킵:', e);
    }
    
    // 3. production_transactions 수량 수정 (생산입고, 출고)
    try {
      await c.env.DB.prepare(`
        UPDATE production_transactions 
        SET quantity = ?
        WHERE lot_number = ? AND production_code = ?
      `).bind(quantity, lotNumber, production.product_code).run();
    } catch (e) {
      console.log('production_transactions 업데이트 스킵:', e);
    }
    
    // 4. production_daily_items 수량은 수정하지 않음 (PDF 원본 수량 유지)
    // 생산일보 수량과 LOT 수량은 별개
    
    return c.json({ 
      success: true, 
      message: `LOT ${lotNumber} 수량이 ${oldQuantity} → ${quantity}로 변경되었습니다`,
      data: { lot_number: lotNumber, old_quantity: oldQuantity, new_quantity: quantity }
    });
    
  } catch (error: any) {
    console.error('LOT 수량 수정 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 생산 원료 LOT 수정
productionRoutes.put('/lot/:lotNumber/material', async (c) => {
  const lotNumber = decodeURIComponent(c.req.param('lotNumber'));
  const { item_code, new_lot_number } = await c.req.json();
  
  if (!item_code || !new_lot_number) {
    return c.json({ success: false, error: '원료코드와 새 LOT번호를 입력하세요' }, 400);
  }
  
  // 생산 기록 조회
  const production = await c.env.DB.prepare(`
    SELECT id FROM production WHERE lot_number = ?
  `).bind(lotNumber).first<any>();
  
  if (!production) {
    return c.json({ success: false, error: '해당 LOT를 찾을 수 없습니다' }, 404);
  }
  
  // 원료 LOT 수정
  const result = await c.env.DB.prepare(`
    UPDATE production_materials 
    SET lot_number = ?
    WHERE production_id = ? AND item_code = ?
  `).bind(new_lot_number, production.id, item_code).run();
  
  return c.json({ 
    success: true, 
    message: `원료 ${item_code} LOT가 ${new_lot_number}로 변경되었습니다`,
    changes: result.meta.changes
  });
});

// 생산 원료 삭제
productionRoutes.delete('/lot/:lotNumber/material/:itemCode', async (c) => {
  const lotNumber = decodeURIComponent(c.req.param('lotNumber'));
  const itemCode = decodeURIComponent(c.req.param('itemCode'));
  
  const production = await c.env.DB.prepare(`
    SELECT id FROM production WHERE lot_number = ?
  `).bind(lotNumber).first<any>();
  
  if (!production) {
    return c.json({ success: false, error: '해당 LOT를 찾을 수 없습니다' }, 404);
  }
  
  const result = await c.env.DB.prepare(`
    DELETE FROM production_materials 
    WHERE production_id = ? AND item_code = ?
  `).bind(production.id, itemCode).run();
  
  return c.json({ 
    success: true, 
    message: `원료 ${itemCode}가 삭제되었습니다`,
    changes: result.meta.changes
  });
});

// 생산 원료 추가
productionRoutes.post('/lot/:lotNumber/material', async (c) => {
  const lotNumber = decodeURIComponent(c.req.param('lotNumber'));
  const { item_code, quantity, unit, lot_number } = await c.req.json();
  
  if (!item_code || !quantity) {
    return c.json({ success: false, error: '원료코드와 수량은 필수입니다' }, 400);
  }
  
  const production = await c.env.DB.prepare(`
    SELECT id FROM production WHERE lot_number = ?
  `).bind(lotNumber).first<any>();
  
  if (!production) {
    return c.json({ success: false, error: '해당 LOT를 찾을 수 없습니다' }, 404);
  }
  
  const result = await c.env.DB.prepare(`
    INSERT INTO production_materials (production_id, item_code, lot_number, planned_qty, actual_qty, unit)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(production.id, item_code, lot_number || null, quantity, quantity, unit || 'g').run();
  
  return c.json({ 
    success: true, 
    message: `원료 ${item_code}가 추가되었습니다`
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
  try {
    const body = await c.req.json();
    const { items, prod_date, production_date, memo, channel: defaultChannel } = body;
    // items: [{ product_code, quantity, channel?, expiry_date?, barcode?, box_quantity? }]
    
    if (!items || items.length === 0) {
      return c.json({ success: false, error: '등록할 항목이 없습니다.' }, 400);
    }
    
    // 배치 크기 제한 (D1 batch() 사용으로 최적화됨)
    // batch()는 여러 쿼리를 단일 네트워크 요청으로 처리
    // D1의 batch() 성능 개선으로 170개까지 처리 가능
    const MAX_BATCH_SIZE = 170;
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
  
  // 중복 등록 방지: 해당 날짜+채널에 이미 등록된 제품 확인
  // 채널별로 별도 등록 가능 (쿠팡, 오아시스 등 다른 채널이면 허용)
  // SQLite는 바인딩 변수가 최대 999개이므로 배치로 나눠서 조회
  const productCodes = items.map((i: any) => i.product_code);
  const existingSet = new Set<string>(); // "product_code|channel" 형태로 저장
  
  const QUERY_BATCH_SIZE = 50; // 안전하게 50개씩 배치 처리
  for (let i = 0; i < productCodes.length; i += QUERY_BATCH_SIZE) {
    const batch = productCodes.slice(i, i + QUERY_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const existingProductions = await c.env.DB.prepare(`
      SELECT product_code, channel FROM production 
      WHERE prod_date = ? AND product_code IN (${placeholders})
    `).bind(productionDate, ...batch).all<any>();
    
    for (const p of existingProductions.results || []) {
      // 채널 정규화: oasis_paste → 오아시스, 쿠팡 → 쿠팡 등
      const normalizedChannel = (p.channel || 'unknown').toLowerCase().replace('_paste', '');
      existingSet.add(`${p.product_code}|${normalizedChannel}`);
    }
  }
  
  // 이미 등록된 제품 필터링 (동일 채널만 필터)
  const newItems = items.filter((i: any) => {
    const itemChannel = (i.channel || defaultChannel || 'unknown').toLowerCase().replace('_paste', '');
    return !existingSet.has(`${i.product_code}|${itemChannel}`);
  });
  
  if (newItems.length === 0) {
    return c.json({ 
      success: false, 
      error: `해당 날짜(${productionDate})와 채널에 모든 제품이 이미 등록되어 있습니다.`,
      already_registered: items.length
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
  
  // 모든 제품 정보를 배치로 조회 (master + production_items + production_barcodes)
  // 1. master 테이블에서 조회 (배치 처리)
  let allMasterProducts: any[] = [];
  for (let i = 0; i < newProductCodes.length; i += QUERY_BATCH_SIZE) {
    const batch = newProductCodes.slice(i, i + QUERY_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const products = await c.env.DB.prepare(`
      SELECT item_code, item_name, expiry_days FROM master 
      WHERE item_code IN (${placeholders}) AND category = '제품'
    `).bind(...batch).all<any>();
    allMasterProducts = allMasterProducts.concat(products.results || []);
  }
  const products = { results: allMasterProducts };
  
  // 2. production_items 테이블에서 조회 (배치 처리)
  let allProductionItems: any[] = [];
  for (let i = 0; i < newProductCodes.length; i += QUERY_BATCH_SIZE) {
    const batch = newProductCodes.slice(i, i + QUERY_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const productionItemsBatch = await c.env.DB.prepare(`
      SELECT production_code as item_code, production_name as item_name, shelf_life_days as expiry_days 
      FROM production_items 
      WHERE production_code IN (${placeholders})
    `).bind(...batch).all<any>();
    allProductionItems = allProductionItems.concat(productionItemsBatch.results || []);
  }
  const productionItems = { results: allProductionItems };
  
  // 3. production_barcodes 테이블에서도 조회 (배치 처리)
  // 참고: expiry_days 우선순위 - 1) 바코드별 expiry_days → 2) production_items.shelf_life_days → 3) 7일
  let allBarcodeItems: any[] = [];
  for (let i = 0; i < newProductCodes.length; i += QUERY_BATCH_SIZE) {
    const batch = newProductCodes.slice(i, i + QUERY_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const barcodeItemsBatch = await c.env.DB.prepare(`
      SELECT pb.production_code as item_code, 
             pi.production_name as item_name,
             COALESCE(pi.shelf_life_days, 7) as default_expiry_days,
             pb.expiry_days as barcode_expiry_days,
             pb.box_quantity,
             pb.barcode,
             pb.channel
      FROM production_barcodes pb
      LEFT JOIN production_items pi ON pb.production_code = pi.production_code
      WHERE pb.production_code IN (${placeholders})
    `).bind(...batch).all<any>();
    allBarcodeItems = allBarcodeItems.concat(barcodeItemsBatch.results || []);
  }
  const barcodeItems = { results: allBarcodeItems };
  
  // production_code별 box_quantity 맵 (채널별로 다를 수 있으므로 대표값 사용)
  const boxQuantityMap = new Map<string, number>();
  // production_code별 기본 소비기한 맵 (production_items.shelf_life_days 기반)
  const productionExpiryMap = new Map<string, number>();
  // 바코드별 소비기한 맵 (production_code + channel 조합으로 관리)
  const barcodeExpiryMap = new Map<string, number>();
  
  for (const b of barcodeItems.results || []) {
    // 여러 바코드가 있을 경우, 가장 큰 box_quantity 사용 (안전하게)
    const current = boxQuantityMap.get(b.item_code) || 1;
    boxQuantityMap.set(b.item_code, Math.max(current, b.box_quantity || 1));
    
    // production_code별 기본 소비기한 저장 (production_items.shelf_life_days)
    if (b.default_expiry_days && !productionExpiryMap.has(b.item_code)) {
      productionExpiryMap.set(b.item_code, b.default_expiry_days);
    }
    
    // 바코드별 소비기한 저장 (채널별로 다를 수 있음)
    // 키: production_code|channel (예: PR078|오아시스)
    if (b.barcode_expiry_days) {
      const key = `${b.item_code}|${b.channel || ''}`;
      barcodeExpiryMap.set(key, b.barcode_expiry_days);
      
      // 채널 무관 기본값도 저장 (채널 매칭 실패 시 사용)
      // 이미 설정된 값이 없을 때만 저장
      const defaultKey = `${b.item_code}|__default__`;
      if (!barcodeExpiryMap.has(defaultKey)) {
        barcodeExpiryMap.set(defaultKey, b.barcode_expiry_days);
      }
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
  
  // 모든 BOM 정보를 배치로 조회 (기존 bom 테이블 + production_bom 테이블)
  let allBomResults: any[] = [];
  for (let i = 0; i < newProductCodes.length; i += QUERY_BATCH_SIZE) {
    const batch = newProductCodes.slice(i, i + QUERY_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const bomBatch = await c.env.DB.prepare(`
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
    `).bind(...batch).all<any>();
    allBomResults = allBomResults.concat(bomBatch.results || []);
  }
  const allBom = { results: allBomResults };
  
  // production_bom 테이블에서도 배치 조회
  let allProdBomResults: any[] = [];
  for (let i = 0; i < newProductCodes.length; i += QUERY_BATCH_SIZE) {
    const batch = newProductCodes.slice(i, i + QUERY_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const prodBomBatch = await c.env.DB.prepare(`
      SELECT pb.production_code as product_code, pb.material_code as item_code, 
             pb.quantity, pb.unit, pb.material_code as matched_item_code, pb.material_name as item_name
      FROM production_bom pb
      WHERE pb.production_code IN (${placeholders})
    `).bind(...batch).all<any>();
    allProdBomResults = allProdBomResults.concat(prodBomBatch.results || []);
  }
  const prodBom = { results: allProdBomResults };
  
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
  
  // 디버그: BOM 맵 상태 로깅
  console.log(`[production/batch] BOM 조회 결과: bom 테이블 ${allBom.results?.length || 0}건, production_bom 테이블 ${prodBom.results?.length || 0}건`);
  console.log(`[production/batch] bomMap 키 목록 (처음 10개): ${Array.from(bomMap.keys()).slice(0, 10).join(', ')}`);
  
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
    
    // 소비기한 우선순위: 
    // 1) 바코드별 expiry_days (채널 일치) → 2) 바코드별 expiry_days (채널 무관)
    // 3) production_items.shelf_life_days → 4) master.expiry_days → 5) 7일
    const itemChannel = item.channel || defaultChannel || '';
    
    // 바코드별 소비기한 확인 (채널 일치 우선)
    let expiryDays = barcodeExpiryMap.get(`${item.product_code}|${itemChannel}`) ||  // 채널 일치
                     barcodeExpiryMap.get(`${item.product_code}|`) ||                 // 채널 없는 바코드
                     barcodeExpiryMap.get(`${item.product_code}|__default__`) ||      // 바코드에 설정된 기본값 (채널 무관)
                     productionExpiryMap.get(item.product_code) ||                    // production_items.shelf_life_days
                     product.expiry_days ||                                            // master.expiry_days
                     7;
    
    console.log(`[production/batch] ${item.product_code} 소비기한: barcodeExpiry=${barcodeExpiryMap.get(`${item.product_code}|${itemChannel}`)}, productionExpiry=${productionExpiryMap.get(item.product_code)}, final=${expiryDays}일`);
    
    const itemExpiryDate = item.expiry_date || (() => {
      const d = new Date(productionDate);
      d.setDate(d.getDate() + expiryDays);
      return d.toISOString().split('T')[0];
    })();
    // itemChannel은 위에서 이미 선언됨
    const boxQuantity = item.box_quantity || boxQuantityMap.get(item.product_code) || 1;
    const actualItemCount = item.quantity * boxQuantity;
    
    console.log(`[production/batch] ${item.product_code}: channel=${itemChannel}, item.channel=${item.channel}, defaultChannel=${defaultChannel}, expiry_date=${itemExpiryDate}`);
    
    preparedItems.push({
      item, product, productLot, itemExpiryDate, itemChannel, expiryDays, actualItemCount
    });
    
    // BOM 처리 (메모리에서만)
    const bomItems = bomMap.get(item.product_code) || [];
    console.log(`[production/batch] ${item.product_code}: BOM ${bomItems.length}건 (bomMap에서 조회)`);
    for (const bom of bomItems) {
      const actualItemCode = bom.matched_item_code || bom.item_code;
      const requiredQty = bom.quantity * actualItemCount;
      const requiredKg = bom.unit === 'g' ? requiredQty / 1000 : requiredQty;
      
      // FEFO 방식으로 원료 LOT 조회 (잔량이 있는 가장 오래된 LOT)
      let materialLot = null;
      try {
        const lotResult = await c.env.DB.prepare(`
          SELECT lot_number FROM inbound 
          WHERE item_code = ? AND remain_qty > 0 
          ORDER BY expiry_date ASC, inbound_date ASC, id ASC 
          LIMIT 1
        `).bind(actualItemCode).first<{lot_number: string}>();
        materialLot = lotResult?.lot_number || null;
      } catch (e) {
        // LOT 조회 실패해도 계속 진행
      }
      
      materialRecords.push({
        productLot, actualItemCode, requiredQty, unit: bom.unit, materialLot
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
    
    // 2-1단계: 생산 ID 조회 및 production_materials INSERT (원료 추적을 위해)
    // LOT 번호로 방금 INSERT된 production ID 조회
    const productionIdMap = new Map<string, number>();
    for (const p of preparedItems) {
      const prod = await c.env.DB.prepare(`
        SELECT id FROM production WHERE lot_number = ? LIMIT 1
      `).bind(p.productLot).first<{id: number}>();
      if (prod) {
        productionIdMap.set(p.productLot, prod.id);
      }
    }
    
    // BOM 기반 원료 정보를 production_materials에 INSERT (LOT 번호 포함)
    const materialInserts: any[] = [];
    for (const rec of materialRecords) {
      const productionId = productionIdMap.get(rec.productLot);
      if (productionId) {
        materialInserts.push(
          c.env.DB.prepare(`
            INSERT INTO production_materials (production_id, item_code, lot_number, planned_qty, actual_qty, unit)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(productionId, rec.actualItemCode, rec.materialLot, rec.requiredQty, rec.requiredQty, rec.unit)
        );
      }
    }
    
    if (materialInserts.length > 0) {
      console.log(`[production/batch] production_materials INSERT ${materialInserts.length}건`);
      await c.env.DB.batch(materialInserts);
    }
    
    // 3단계: 입고 기록 일괄 INSERT (PDF에서 추출한 소비기한 우선 사용)
    const inboundInserts = preparedItems.map(p =>
      c.env.DB.prepare(`
        INSERT INTO production_inbound (lot_number, production_code, inbound_date, expiry_date, origin_qty, remain_qty, quality_status, memo)
        VALUES (?, ?, ?, ?, ?, ?, '합격', ?)
      `).bind(p.productLot, p.item.product_code, productionDate, p.itemExpiryDate, p.item.quantity, p.item.quantity, '생산입고')
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
    
    // 7단계: 생산일보 품목에 LOT 업데이트 (해당 날짜의 생산일보 품목)
    try {
      const dailyItemUpdates = preparedItems.map(p =>
        c.env.DB.prepare(`
          UPDATE production_daily_items 
          SET lot_number = ?
          WHERE production_code = ? 
            AND quantity = ?
            AND (lot_number IS NULL OR lot_number = '')
            AND report_id IN (
              SELECT id FROM production_daily_report WHERE report_date = ?
            )
        `).bind(p.productLot, p.item.product_code, p.item.quantity, productionDate)
      );
      
      if (dailyItemUpdates.length > 0) {
        await c.env.DB.batch(dailyItemUpdates);
      }
    } catch (e) {
      console.error('Daily item LOT update error:', e);
      // 실패해도 생산 등록은 계속 진행
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
    // created_at 명시적 지정 (D1 batch에서 DEFAULT 값이 누락되는 문제 방지)
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    
    if (isSemiFinished) {
      materialTransactions.push(
        c.env.DB.prepare(`INSERT INTO semi_finished_transactions (trans_date, item_code, trans_type, quantity, memo, created_at) VALUES (?, ?, '사용', ?, ?, ?)`)
          .bind(productionDate, itemCode, -data.qty, memoText, now)
      );
    } else {
      // 일반 원료: transactions 테이블에 기록 (사용은 음수로 저장)
      materialTransactions.push(
        c.env.DB.prepare(`INSERT INTO transactions (trans_date, item_code, trans_type, quantity, memo, created_at) VALUES (?, ?, '사용', ?, ?, ?)`)
          .bind(productionDate, itemCode, -data.qty, memoText, now)
      );
    }
  }
  
  console.log(`[production/batch] 원료 차감 시작: materialUpdates=${materialUpdates.length}, semiFinishedUpdates=${semiFinishedUpdates.length}, materialTransactions=${materialTransactions.length}`);
  
  let materialDeductionSuccess = true;
  let transactionRecordSuccess = true;
  let transactionError = '';
  
  try {
    if (materialUpdates.length > 0) {
      console.log(`[production/batch] master 재고 차감 ${materialUpdates.length}건 실행`);
      await c.env.DB.batch(materialUpdates);
    }
    if (semiFinishedUpdates.length > 0) {
      console.log(`[production/batch] 반제품 차감 ${semiFinishedUpdates.length}건 실행`);
      await c.env.DB.batch(semiFinishedUpdates);
    }
    console.log(`[production/batch] 재고 차감 완료`);
  } catch (e: any) {
    materialDeductionSuccess = false;
    console.error('Material deduction batch error:', e);
    console.error('Error details:', e.message, e.cause);
  }
  
  // 트랜잭션 기록은 별도로 처리 (재고 차감이 실패해도 기록 시도)
  // D1 batch()에서 AUTOINCREMENT가 작동하지 않는 문제로 인해 개별 INSERT 실행
  let txSuccessCount = 0;
  let txFailCount = 0;
  
  if (materialTransactions.length > 0) {
    console.log(`[production/batch] transactions 기록 ${materialTransactions.length}건 실행 (개별)`);
    
    for (const txStatement of materialTransactions) {
      try {
        await txStatement.run();
        txSuccessCount++;
      } catch (e: any) {
        txFailCount++;
        console.error('Transaction insert error:', e.message);
      }
    }
    
    console.log(`[production/batch] transactions 기록 완료: 성공=${txSuccessCount}, 실패=${txFailCount}`);
    
    if (txFailCount > 0) {
      transactionRecordSuccess = false;
      transactionError = `${txFailCount}/${materialTransactions.length} 트랜잭션 기록 실패`;
    }
  }
  
  return c.json({
    success: true,
    data: {
      total: items.length,
      success: successCount,
      fail: failCount,
      materials_deducted: materialDeductions.size,
      material_deduction_success: materialDeductionSuccess,
      transaction_record_success: transactionRecordSuccess,
      transaction_error: transactionError || null,
      results
    }
  });
  
  } catch (error: any) {
    console.error('Production batch API error:', error);
    return c.json({ 
      success: false, 
      error: '생산 등록 중 오류가 발생했습니다.',
      detail: error.message || String(error)
    }, 500);
  }
});

// 소비기한 일괄 수정 API (특정 날짜의 배민/비마트 생산 데이터)
productionRoutes.post('/fix-expiry-dates', async (c) => {
  try {
    const { prod_date, items } = await c.req.json<{
      prod_date: string;
      items: Array<{ barcode: string; expiry_date: string }>;
    }>();
    
    if (!prod_date || !items || items.length === 0) {
      return c.json({ success: false, error: 'prod_date와 items가 필요합니다.' }, 400);
    }
    
    console.log(`[fix-expiry-dates] ${prod_date} 날짜의 소비기한 수정 시작: ${items.length}건`);
    
    // 바코드 → 생산코드 매핑 조회
    const barcodeList = items.map(i => i.barcode);
    const placeholders = barcodeList.map(() => '?').join(',');
    
    const barcodeMapping = await c.env.DB.prepare(`
      SELECT barcode, production_code FROM production_barcodes WHERE barcode IN (${placeholders})
    `).bind(...barcodeList).all<{ barcode: string; production_code: string }>();
    
    const barcodeToCode = new Map<string, string>();
    for (const row of barcodeMapping.results || []) {
      barcodeToCode.set(row.barcode, row.production_code);
    }
    
    let successCount = 0;
    let failCount = 0;
    
    for (const item of items) {
      const productCode = barcodeToCode.get(item.barcode);
      if (!productCode) {
        console.log(`[fix-expiry-dates] 바코드 ${item.barcode}: 매핑 없음`);
        failCount++;
        continue;
      }
      
      // production 테이블 업데이트
      await c.env.DB.prepare(`
        UPDATE production SET expiry_date = ? WHERE prod_date = ? AND product_code = ?
      `).bind(item.expiry_date, prod_date, productCode).run();
      
      // production_inbound 테이블 업데이트
      await c.env.DB.prepare(`
        UPDATE production_inbound SET expiry_date = ? 
        WHERE production_code = ? AND inbound_date = ?
      `).bind(item.expiry_date, productCode, prod_date).run();
      
      console.log(`[fix-expiry-dates] ${productCode} → ${item.expiry_date} 업데이트 완료`);
      successCount++;
    }
    
    return c.json({
      success: true,
      data: { total: items.length, success: successCount, fail: failCount }
    });
    
  } catch (error: any) {
    console.error('fix-expiry-dates error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 바코드 소비기한 기준으로 기존 생산 데이터 일괄 수정
productionRoutes.post('/recalculate-expiry', async (c) => {
  try {
    const { production_code } = await c.req.json<{ production_code?: string }>();
    
    // 바코드별 소비기한 조회
    let barcodeQuery = `
      SELECT production_code, expiry_days, channel 
      FROM production_barcodes 
      WHERE expiry_days IS NOT NULL
    `;
    if (production_code) {
      barcodeQuery += ` AND production_code = ?`;
    }
    
    const barcodeExpiry = production_code 
      ? await c.env.DB.prepare(barcodeQuery).bind(production_code).all<any>()
      : await c.env.DB.prepare(barcodeQuery).all<any>();
    
    // production_code별 기본 소비기한 맵 (첫 번째 값 사용)
    const expiryMap = new Map<string, number>();
    for (const b of barcodeExpiry.results || []) {
      if (!expiryMap.has(b.production_code)) {
        expiryMap.set(b.production_code, b.expiry_days);
      }
    }
    
    if (expiryMap.size === 0) {
      return c.json({ success: false, error: '바코드 소비기한 설정이 없습니다.' }, 400);
    }
    
    let totalUpdated = 0;
    
    // 각 production_code별로 업데이트
    for (const [code, days] of expiryMap) {
      // production 테이블 업데이트 (expiry_date = prod_date + days)
      const result1 = await c.env.DB.prepare(`
        UPDATE production 
        SET expiry_date = date(prod_date, '+' || ? || ' days')
        WHERE product_code = ?
      `).bind(days, code).run();
      
      // production_inbound 테이블 업데이트
      const result2 = await c.env.DB.prepare(`
        UPDATE production_inbound 
        SET expiry_date = date(inbound_date, '+' || ? || ' days')
        WHERE production_code = ?
      `).bind(days, code).run();
      
      // production_daily_items 테이블 업데이트 (생산일보 품목)
      // report_id로 report_date를 조회해서 계산
      const result3 = await c.env.DB.prepare(`
        UPDATE production_daily_items 
        SET expiry_date = date(
          (SELECT report_date FROM production_daily_report WHERE id = production_daily_items.report_id),
          '+' || ? || ' days'
        )
        WHERE production_code = ?
      `).bind(days, code).run();
      
      totalUpdated += (result1.meta?.changes || 0) + (result2.meta?.changes || 0) + (result3.meta?.changes || 0);
      console.log(`[recalculate-expiry] ${code}: ${days}일로 업데이트 (production: ${result1.meta?.changes || 0}, inbound: ${result2.meta?.changes || 0}, daily_items: ${result3.meta?.changes || 0}건)`);
    }
    
    return c.json({
      success: true,
      message: `${expiryMap.size}개 생산코드의 소비기한을 바코드 설정에 맞게 재계산했습니다.`,
      data: { 
        production_codes: expiryMap.size,
        total_updated: totalUpdated,
        details: Object.fromEntries(expiryMap)
      }
    });
    
  } catch (error: any) {
    console.error('recalculate-expiry error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
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

// 기존 생산 데이터에 BOM 기반 원료 정보 일괄 추가 (마이그레이션)
productionRoutes.post('/migrate-materials', async (c) => {
  const dryRun = c.req.query('dry_run') === 'true';
  
  try {
    // 1-1. 기존 bom 테이블에서 BOM 조회 (PD 코드)
    const allBom = await c.env.DB.prepare(`
      SELECT b.*, m.item_name, 
             COALESCE(
               (SELECT item_code FROM master WHERE item_code = b.item_code LIMIT 1),
               (SELECT item_code FROM master WHERE item_code = 'RM' || SUBSTR(b.item_code, 2) LIMIT 1),
               (SELECT item_code FROM master WHERE item_code = 'R' || SUBSTR(b.item_code, 3) LIMIT 1),
               b.item_code
             ) as matched_item_code
      FROM bom b
      LEFT JOIN master m ON b.item_code = m.item_code OR m.item_code = 'RM' || SUBSTR(b.item_code, 2) OR m.item_code = 'R' || SUBSTR(b.item_code, 3)
    `).all<any>();
    
    // 1-2. production_bom 테이블에서 BOM 조회 (PR 코드)
    const productionBom = await c.env.DB.prepare(`
      SELECT pb.production_code as product_code, pb.material_code as item_code, 
             pb.material_name as item_name, pb.quantity, pb.unit,
             COALESCE(
               (SELECT item_code FROM master WHERE item_code = pb.material_code LIMIT 1),
               (SELECT item_code FROM master WHERE item_code = 'RM' || SUBSTR(pb.material_code, 2) LIMIT 1),
               (SELECT item_code FROM master WHERE item_code = 'R' || SUBSTR(pb.material_code, 3) LIMIT 1),
               pb.material_code
             ) as matched_item_code
      FROM production_bom pb
    `).all<any>();
    
    // BOM을 product_code별로 그룹화
    const bomMap = new Map<string, any[]>();
    
    // 기존 bom 테이블 데이터
    for (const bom of allBom.results || []) {
      if (!bomMap.has(bom.product_code)) {
        bomMap.set(bom.product_code, []);
      }
      bomMap.get(bom.product_code)!.push(bom);
    }
    
    // production_bom 테이블 데이터 (PR 코드)
    for (const bom of productionBom.results || []) {
      if (!bomMap.has(bom.product_code)) {
        bomMap.set(bom.product_code, []);
      }
      bomMap.get(bom.product_code)!.push(bom);
    }
    
    console.log(`[migrate-materials] BOM 로드 완료: ${bomMap.size}개 제품 (bom: ${allBom.results?.length || 0}, production_bom: ${productionBom.results?.length || 0})`);
    
    // 2. production_materials가 없는 생산 기록 조회
    const productions = await c.env.DB.prepare(`
      SELECT p.id, p.product_code, p.quantity, p.lot_number, p.prod_date
      FROM production p
      WHERE NOT EXISTS (
        SELECT 1 FROM production_materials pm WHERE pm.production_id = p.id
      )
      ORDER BY p.id
    `).all<any>();
    
    console.log(`[migrate-materials] 원료 정보 없는 생산 기록: ${productions.results?.length || 0}건`);
    
    if (dryRun) {
      // 드라이런: 처리할 건수만 반환
      const withBom = (productions.results || []).filter(p => bomMap.has(p.product_code));
      return c.json({
        success: true,
        dry_run: true,
        total_productions: productions.results?.length || 0,
        with_bom: withBom.length,
        without_bom: (productions.results?.length || 0) - withBom.length,
        sample: withBom.slice(0, 5).map(p => ({
          id: p.id,
          product_code: p.product_code,
          lot_number: p.lot_number,
          bom_items: bomMap.get(p.product_code)?.length || 0
        }))
      });
    }
    
    // 3. 각 생산 기록에 대해 원료 정보 추가 (LOT 조회 생략으로 성능 최적화)
    let insertedCount = 0;
    let skippedCount = 0;
    const batchSize = 20; // 배치 크기 축소 (API 한도 방지)
    const productionList = productions.results || [];
    
    for (let i = 0; i < productionList.length; i += batchSize) {
      const batch = productionList.slice(i, i + batchSize);
      const inserts: any[] = [];
      
      for (const prod of batch) {
        const bomItems = bomMap.get(prod.product_code);
        if (!bomItems || bomItems.length === 0) {
          skippedCount++;
          continue;
        }
        
        // 단위수량은 기본 1 사용 (생산수량 = 실제 개수)
        const actualCount = prod.quantity;
        
        for (const bom of bomItems) {
          const actualItemCode = bom.matched_item_code || bom.item_code;
          const requiredQty = bom.quantity * actualCount;
          
          // LOT는 null로 설정 (성능 최적화, 나중에 별도 업데이트 가능)
          inserts.push(
            c.env.DB.prepare(`
              INSERT INTO production_materials (production_id, item_code, lot_number, planned_qty, actual_qty, unit)
              VALUES (?, ?, NULL, ?, ?, ?)
            `).bind(prod.id, actualItemCode, requiredQty, requiredQty, bom.unit || 'g')
          );
        }
      }
      
      if (inserts.length > 0) {
        await c.env.DB.batch(inserts);
        insertedCount += inserts.length;
      }
    }
    
    return c.json({
      success: true,
      message: `원료 정보 마이그레이션 완료`,
      inserted: insertedCount,
      skipped_no_bom: skippedCount,
      total_processed: productionList.length
    });
    
  } catch (error: any) {
    console.error('Migration error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default productionRoutes;
