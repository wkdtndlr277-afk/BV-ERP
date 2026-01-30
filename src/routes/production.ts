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
  
  let query = `
    SELECT p.*, 
           m.item_name as product_name,
           m.unit as product_unit
    FROM production p
    LEFT JOIN master m ON p.product_code = m.item_code
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
  
  // 사용된 원재료 목록
  const materials = await c.env.DB.prepare(`
    SELECT pm.*, 
           m.item_name,
           m.unit as item_unit
    FROM production_materials pm
    LEFT JOIN master m ON pm.item_code = m.item_code
    WHERE pm.production_id = ?
    ORDER BY pm.id
  `).bind(id).all();
  
  return c.json({ 
    success: true, 
    data: {
      ...production,
      materials: materials.results
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
  
  // BOM 조회
  const bomResult = await c.env.DB.prepare(`
    SELECT b.*, m.item_name, m.current_stock
    FROM bom b
    LEFT JOIN master m ON b.item_code = m.item_code
    WHERE b.product_code = ?
    ORDER BY b.sort_order
  `).bind(product_code).all<any>();
  
  const bomItems = bomResult.results || [];
  
  // 재고 확인 (BOM이 있는 경우만)
  const stockErrors: string[] = [];
  for (const bom of bomItems) {
    const requiredQty = bom.quantity * quantity;
    // 단위 변환: BOM은 g 기준, 재고는 kg 기준일 수 있음
    const requiredKg = bom.unit === 'g' ? requiredQty / 1000 : requiredQty;
    
    if (bom.current_stock < requiredKg) {
      stockErrors.push(`${bom.item_name}: 필요 ${requiredKg.toFixed(2)}kg, 재고 ${bom.current_stock.toFixed(2)}kg`);
    }
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
      
      // 원재료 사용 기록
      await c.env.DB.prepare(`
        INSERT INTO production_materials (production_id, item_code, planned_qty, actual_qty, unit)
        VALUES (?, ?, ?, ?, ?)
      `).bind(productionId, bom.item_code, requiredQty, requiredQty, bom.unit).run();
      
      // FEFO 방식으로 LOT에서 차감
      let remainingToDeduct = requiredKg;
      
      const lots = await c.env.DB.prepare(`
        SELECT * FROM inbound 
        WHERE item_code = ? AND remain_qty > 0 AND quality_status = '합격'
        ORDER BY expiry_date ASC, inbound_date ASC
      `).bind(bom.item_code).all<any>();
      
      for (const lot of lots.results || []) {
        if (remainingToDeduct <= 0) break;
        
        const deductQty = Math.min(lot.remain_qty, remainingToDeduct);
        
        // LOT 잔량 차감
        await c.env.DB.prepare(`
          UPDATE inbound SET remain_qty = remain_qty - ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(deductQty, lot.id).run();
        
        // 거래 이력 기록 (생산사용)
        await c.env.DB.prepare(`
          INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, remain_qty, memo)
          VALUES (?, ?, '사용', ?, ?, ?, ?)
        `).bind(
          prod_date,
          bom.item_code,
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
          bom.item_code,
          remainingToDeduct,
          `생산사용: ${product.item_name} ${quantity}개 (생산ID: ${productionId}) - LOT 없음`
        ).run();
      }
      
      // 마스터 재고 업데이트
      await c.env.DB.prepare(`
        UPDATE master SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP
        WHERE item_code = ?
      `).bind(requiredKg, bom.item_code).run();
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

export default productionRoutes;
