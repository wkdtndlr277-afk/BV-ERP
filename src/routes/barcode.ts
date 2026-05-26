// 바코드 재고관리 API
import { Hono } from 'hono';
import type { Bindings } from '../types';

const barcodeRoutes = new Hono<{ Bindings: Bindings }>();

// 바코드 스캔 - 품목 검색
// 바코드 또는 품목코드로 검색, LOT 목록 포함 (FIFO 순서)
barcodeRoutes.get('/scan', async (c) => {
  const barcode = c.req.query('barcode');
  
  if (!barcode) {
    return c.json({ success: false, error: '바코드를 입력해주세요.' }, 400);
  }
  
  try {
    // 1. production_barcodes 테이블에서 바코드 검색 (먼저)
    let item: any = null;
    let source = '';
    
    // production_barcodes 테이블 존재 확인 및 검색
    try {
      const barcodeResult = await c.env.DB.prepare(`
        SELECT pb.*, pi.production_name as item_name, pi.production_code as item_code,
               '제품' as category, COALESCE(pi.unit, 'EA') as unit, pi.current_stock
        FROM production_barcodes pb
        JOIN production_items pi ON pb.production_code = pi.production_code
        WHERE pb.barcode = ?
      `).bind(barcode).first();
      
      if (barcodeResult) {
        item = barcodeResult;
        source = 'production_barcodes';
      }
    } catch (e) {
      // production_barcodes 테이블이 없을 수 있음
      console.log('production_barcodes table not found or error:', e);
    }
    
    // 2. master 테이블에서 바코드 또는 item_code로 검색
    if (!item) {
      const masterResult = await c.env.DB.prepare(`
        SELECT item_code, item_name, category, unit, current_stock, safety_stock, expiry_days, barcode
        FROM master
        WHERE barcode = ? OR item_code = ? OR item_name LIKE ?
      `).bind(barcode, barcode, `%${barcode}%`).first();
      
      if (masterResult) {
        item = masterResult;
        source = 'master';
      }
    }
    
    // 3. supplies 테이블에서 검색 (부자재)
    if (!item) {
      const suppliesResult = await c.env.DB.prepare(`
        SELECT item_code, item_name, category, unit, current_stock, safety_stock, expiry_days, barcode
        FROM supplies
        WHERE barcode = ? OR item_code = ? OR item_name LIKE ?
      `).bind(barcode, barcode, `%${barcode}%`).first();
      
      if (suppliesResult) {
        item = suppliesResult;
        source = 'supplies';
      }
    }
    
    // 4. production_items 테이블에서 검색 (제품)
    if (!item) {
      const productResult = await c.env.DB.prepare(`
        SELECT production_code as item_code, 
               COALESCE(alias1, production_name) as item_name,
               '제품' as category, 
               COALESCE(unit, 'EA') as unit, 
               current_stock
        FROM production_items
        WHERE production_code = ? OR production_name LIKE ? OR alias1 LIKE ?
      `).bind(barcode, `%${barcode}%`, `%${barcode}%`).first();
      
      if (productResult) {
        item = productResult;
        source = 'production_items';
      }
    }
    
    if (!item) {
      return c.json({ success: false, error: '등록되지 않은 바코드입니다.', barcode });
    }
    
    // LOT 목록 조회 (FIFO 순서: 유통기한 → 입고일 오름차순)
    let lots: any[] = [];
    
    if (source === 'production_items' || item.category === '제품') {
      // 제품 LOT (production_inbound)
      const lotResult = await c.env.DB.prepare(`
        SELECT lot_number, inbound_date, expiry_date, origin_qty, remain_qty, quality_status
        FROM production_inbound
        WHERE production_code = ? AND remain_qty > 0 AND quality_status = '합격'
        ORDER BY expiry_date ASC, inbound_date ASC
      `).bind(item.item_code).all();
      lots = lotResult.results || [];
    } else {
      // 원료/부자재 LOT (inbound)
      const lotResult = await c.env.DB.prepare(`
        SELECT lot_number, inbound_date, expiry_date, origin_qty, remain_qty, quality_status, supplier
        FROM inbound
        WHERE item_code = ? AND remain_qty > 0 AND quality_status = '합격'
        ORDER BY expiry_date ASC, inbound_date ASC
      `).bind(item.item_code).all();
      lots = lotResult.results || [];
    }
    
    return c.json({
      success: true,
      data: {
        ...item,
        barcode,
        source,
        lots,
        lot_count: lots.length
      }
    });
    
  } catch (error: any) {
    console.error('Barcode scan error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 사용 등록 (재고 차감) - FIFO 기반
barcodeRoutes.post('/usage', async (c) => {
  try {
    const body = await c.req.json();
    const { item_code, quantity, lot_number, memo } = body;
    
    if (!item_code || !quantity || quantity <= 0) {
      return c.json({ success: false, error: '품목 코드와 수량을 입력해주세요.' }, 400);
    }
    
    const today = new Date().toISOString().split('T')[0];
    
    // 품목 정보 조회 (원료/부자재 또는 제품 구분)
    let itemInfo: any = await c.env.DB.prepare(
      'SELECT item_code, item_name, category, unit FROM master WHERE item_code = ?'
    ).bind(item_code).first();
    
    let isProduct = false;
    
    if (!itemInfo) {
      itemInfo = await c.env.DB.prepare(
        'SELECT item_code, item_name, category, unit FROM supplies WHERE item_code = ?'
      ).bind(item_code).first();
    }
    
    if (!itemInfo) {
      itemInfo = await c.env.DB.prepare(`
        SELECT production_code as item_code, 
               COALESCE(alias1, production_name) as item_name,
               '제품' as category, 
               COALESCE(unit, 'EA') as unit
        FROM production_items WHERE production_code = ?
      `).bind(item_code).first();
      isProduct = !!itemInfo;
    }
    
    if (!itemInfo) {
      return c.json({ success: false, error: '품목을 찾을 수 없습니다.' }, 404);
    }
    
    let remainingQty = quantity;
    const usedLots: any[] = [];
    
    if (isProduct) {
      // 제품 사용 - production_inbound에서 차감
      let lotsToUse: any[];
      
      if (lot_number) {
        // 특정 LOT 지정
        const lot = await c.env.DB.prepare(`
          SELECT * FROM production_inbound 
          WHERE production_code = ? AND lot_number = ? AND remain_qty > 0 AND quality_status = '합격'
        `).bind(item_code, lot_number).first();
        lotsToUse = lot ? [lot] : [];
      } else {
        // FIFO 순서로 LOT 선택
        const lotResult = await c.env.DB.prepare(`
          SELECT * FROM production_inbound 
          WHERE production_code = ? AND remain_qty > 0 AND quality_status = '합격'
          ORDER BY expiry_date ASC, inbound_date ASC
        `).bind(item_code).all();
        lotsToUse = lotResult.results || [];
      }
      
      for (const lot of lotsToUse) {
        if (remainingQty <= 0) break;
        
        const useQty = Math.min(remainingQty, lot.remain_qty);
        
        // LOT 잔량 차감
        await c.env.DB.prepare(`
          UPDATE production_inbound SET remain_qty = remain_qty - ? WHERE id = ?
        `).bind(useQty, lot.id).run();
        
        // 트랜잭션 기록
        await c.env.DB.prepare(`
          INSERT INTO production_transactions 
          (trans_date, production_code, trans_type, quantity, lot_number, memo, created_at)
          VALUES (?, ?, '출고', ?, ?, ?, datetime('now'))
        `).bind(today, item_code, -useQty, lot.lot_number, memo || '바코드 스캔 사용등록').run();
        
        usedLots.push({ lot_number: lot.lot_number, used_qty: useQty });
        remainingQty -= useQty;
      }
      
      // production_items current_stock 업데이트
      await c.env.DB.prepare(`
        UPDATE production_items SET current_stock = current_stock - ? WHERE production_code = ?
      `).bind(quantity - remainingQty, item_code).run();
      
    } else {
      // 원료/부자재 사용 - inbound에서 차감
      let lotsToUse: any[];
      
      if (lot_number) {
        // 특정 LOT 지정
        const lot = await c.env.DB.prepare(`
          SELECT * FROM inbound 
          WHERE item_code = ? AND lot_number = ? AND remain_qty > 0 AND quality_status = '합격'
        `).bind(item_code, lot_number).first();
        lotsToUse = lot ? [lot] : [];
      } else {
        // FIFO 순서로 LOT 선택
        const lotResult = await c.env.DB.prepare(`
          SELECT * FROM inbound 
          WHERE item_code = ? AND remain_qty > 0 AND quality_status = '합격'
          ORDER BY expiry_date ASC, inbound_date ASC
        `).bind(item_code).all();
        lotsToUse = lotResult.results || [];
      }
      
      for (const lot of lotsToUse) {
        if (remainingQty <= 0) break;
        
        const useQty = Math.min(remainingQty, lot.remain_qty);
        
        // LOT 잔량 차감
        await c.env.DB.prepare(`
          UPDATE inbound SET remain_qty = remain_qty - ? WHERE id = ?
        `).bind(useQty, lot.id).run();
        
        // 트랜잭션 기록
        await c.env.DB.prepare(`
          INSERT INTO transactions 
          (trans_date, item_code, trans_type, quantity, lot_number, memo, created_at)
          VALUES (?, ?, '사용', ?, ?, ?, datetime('now'))
        `).bind(today, item_code, -useQty, lot.lot_number, memo || '바코드 스캔 사용등록').run();
        
        usedLots.push({ lot_number: lot.lot_number, used_qty: useQty });
        remainingQty -= useQty;
      }
      
      // master/supplies current_stock 업데이트
      const actualUsed = quantity - remainingQty;
      await c.env.DB.prepare(`
        UPDATE master SET current_stock = current_stock - ? WHERE item_code = ?
      `).bind(actualUsed, item_code).run();
      
      await c.env.DB.prepare(`
        UPDATE supplies SET current_stock = current_stock - ? WHERE item_code = ?
      `).bind(actualUsed, item_code).run();
    }
    
    if (remainingQty > 0) {
      return c.json({
        success: true,
        message: `부분 차감 완료: ${quantity - remainingQty} 사용됨 (재고 부족으로 ${remainingQty} 미차감)`,
        used_qty: quantity - remainingQty,
        remaining_qty: remainingQty,
        used_lots: usedLots
      });
    }
    
    return c.json({
      success: true,
      message: `${itemInfo.item_name} ${quantity}${itemInfo.unit} 사용 등록 완료`,
      used_qty: quantity,
      used_lots: usedLots
    });
    
  } catch (error: any) {
    console.error('Usage registration error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 입고 등록 (간이 입고 - 바코드 스캔용)
barcodeRoutes.post('/inbound', async (c) => {
  try {
    const body = await c.req.json();
    const { item_code, quantity, memo, expiry_date } = body;
    
    if (!item_code || !quantity || quantity <= 0) {
      return c.json({ success: false, error: '품목 코드와 수량을 입력해주세요.' }, 400);
    }
    
    const today = new Date().toISOString().split('T')[0];
    
    // 품목 정보 조회
    let itemInfo: any = await c.env.DB.prepare(
      'SELECT item_code, item_name, category, unit, expiry_days FROM master WHERE item_code = ?'
    ).bind(item_code).first();
    
    let isProduct = false;
    let isSupply = false;
    
    if (!itemInfo) {
      itemInfo = await c.env.DB.prepare(
        'SELECT item_code, item_name, category, unit, expiry_days FROM supplies WHERE item_code = ?'
      ).bind(item_code).first();
      isSupply = !!itemInfo;
    }
    
    if (!itemInfo) {
      itemInfo = await c.env.DB.prepare(`
        SELECT production_code as item_code, 
               COALESCE(alias1, production_name) as item_name,
               '제품' as category, 
               COALESCE(unit, 'EA') as unit,
               shelf_life_days as expiry_days
        FROM production_items WHERE production_code = ?
      `).bind(item_code).first();
      isProduct = !!itemInfo;
    }
    
    if (!itemInfo) {
      return c.json({ success: false, error: '품목을 찾을 수 없습니다.' }, 404);
    }
    
    // LOT 번호 생성 (BCSCAN-YYYYMMDD-HHMMSS)
    const now = new Date();
    const lotNumber = `BCSCAN-${now.toISOString().slice(0,10).replace(/-/g, '')}-${now.toTimeString().slice(0,8).replace(/:/g, '')}`;
    
    // 유통기한 계산
    let calculatedExpiry = expiry_date;
    if (!calculatedExpiry && itemInfo.expiry_days) {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + (itemInfo.expiry_days || 365));
      calculatedExpiry = expiryDate.toISOString().split('T')[0];
    }
    
    if (isProduct) {
      // 제품 입고 - production_inbound
      await c.env.DB.prepare(`
        INSERT INTO production_inbound 
        (lot_number, production_code, inbound_date, expiry_date, origin_qty, remain_qty, quality_status, memo, created_at)
        VALUES (?, ?, ?, ?, ?, ?, '합격', ?, datetime('now'))
      `).bind(lotNumber, item_code, today, calculatedExpiry, quantity, quantity, memo || '바코드 스캔 입고').run();
      
      // 트랜잭션 기록
      await c.env.DB.prepare(`
        INSERT INTO production_transactions 
        (trans_date, production_code, trans_type, quantity, lot_number, memo, created_at)
        VALUES (?, ?, '생산입고', ?, ?, ?, datetime('now'))
      `).bind(today, item_code, quantity, lotNumber, memo || '바코드 스캔 입고').run();
      
      // current_stock 업데이트
      await c.env.DB.prepare(`
        UPDATE production_items SET current_stock = current_stock + ? WHERE production_code = ?
      `).bind(quantity, item_code).run();
      
    } else {
      // 원료/부자재 입고 - inbound
      await c.env.DB.prepare(`
        INSERT INTO inbound 
        (lot_number, item_code, inbound_date, expiry_date, origin_qty, remain_qty, quality_status, memo, created_at)
        VALUES (?, ?, ?, ?, ?, ?, '합격', ?, datetime('now'))
      `).bind(lotNumber, item_code, today, calculatedExpiry, quantity, quantity, memo || '바코드 스캔 입고').run();
      
      // 트랜잭션 기록
      await c.env.DB.prepare(`
        INSERT INTO transactions 
        (trans_date, item_code, trans_type, quantity, lot_number, memo, created_at)
        VALUES (?, ?, '입고', ?, ?, ?, datetime('now'))
      `).bind(today, item_code, quantity, lotNumber, memo || '바코드 스캔 입고').run();
      
      // current_stock 업데이트
      if (isSupply) {
        await c.env.DB.prepare(`
          UPDATE supplies SET current_stock = current_stock + ? WHERE item_code = ?
        `).bind(quantity, item_code).run();
      } else {
        await c.env.DB.prepare(`
          UPDATE master SET current_stock = current_stock + ? WHERE item_code = ?
        `).bind(quantity, item_code).run();
      }
    }
    
    return c.json({
      success: true,
      message: `${itemInfo.item_name} ${quantity}${itemInfo.unit} 입고 등록 완료`,
      lot_number: lotNumber,
      expiry_date: calculatedExpiry
    });
    
  } catch (error: any) {
    console.error('Inbound registration error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 품목별 거래 이력 조회
barcodeRoutes.get('/history', async (c) => {
  const item_code = c.req.query('item_code');
  const limit = parseInt(c.req.query('limit') || '50');
  
  if (!item_code) {
    return c.json({ success: false, error: '품목 코드를 입력해주세요.' }, 400);
  }
  
  try {
    // 품목 정보 조회
    let itemInfo: any = await c.env.DB.prepare(
      'SELECT item_code, item_name, category, unit, current_stock FROM master WHERE item_code = ?'
    ).bind(item_code).first();
    
    let isProduct = false;
    
    if (!itemInfo) {
      itemInfo = await c.env.DB.prepare(
        'SELECT item_code, item_name, category, unit, current_stock FROM supplies WHERE item_code = ?'
      ).bind(item_code).first();
    }
    
    if (!itemInfo) {
      itemInfo = await c.env.DB.prepare(`
        SELECT production_code as item_code, 
               COALESCE(alias1, production_name) as item_name,
               '제품' as category, 
               COALESCE(unit, 'EA') as unit,
               current_stock
        FROM production_items WHERE production_code = ?
      `).bind(item_code).first();
      isProduct = !!itemInfo;
    }
    
    if (!itemInfo) {
      return c.json({ success: false, error: '품목을 찾을 수 없습니다.' }, 404);
    }
    
    // 거래 이력 조회
    let transactions: any[] = [];
    
    if (isProduct) {
      const result = await c.env.DB.prepare(`
        SELECT id, trans_date, trans_type, quantity, lot_number, memo, created_at
        FROM production_transactions
        WHERE production_code = ?
        ORDER BY trans_date DESC, id DESC
        LIMIT ?
      `).bind(item_code, limit).all();
      transactions = result.results || [];
    } else {
      const result = await c.env.DB.prepare(`
        SELECT id, trans_date, trans_type, quantity, lot_number, memo, created_at
        FROM transactions
        WHERE item_code = ?
        ORDER BY trans_date DESC, id DESC
        LIMIT ?
      `).bind(item_code, limit).all();
      transactions = result.results || [];
    }
    
    // 요약 통계
    const summary = transactions.reduce((acc: any, t: any) => {
      if (t.trans_type === '입고' || t.trans_type === '생산입고') {
        acc.total_inbound += Math.abs(t.quantity);
      } else if (t.trans_type === '사용') {
        acc.total_usage += Math.abs(t.quantity);
      } else if (t.trans_type === '출고') {
        acc.total_outbound += Math.abs(t.quantity);
      }
      return acc;
    }, { total_inbound: 0, total_usage: 0, total_outbound: 0 });
    
    return c.json({
      success: true,
      data: {
        item: itemInfo,
        transactions,
        summary,
        count: transactions.length
      }
    });
    
  } catch (error: any) {
    console.error('History query error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 바코드 미등록 품목 목록 (원료/부자재 중 바코드 미등록)
barcodeRoutes.get('/unregistered', async (c) => {
  const search = c.req.query('search') || '';
  
  try {
    // master 테이블 (원료) - barcode 필드가 null이거나 빈 문자열인 품목
    const masterItems = await c.env.DB.prepare(`
      SELECT item_code, item_name, category, unit, 'master' as table_type
      FROM master
      WHERE (barcode IS NULL OR barcode = '')
      ${search ? `AND (item_code LIKE ? OR item_name LIKE ?)` : ''}
      ORDER BY item_name
      LIMIT 100
    `).bind(...(search ? [`%${search}%`, `%${search}%`] : [])).all();
    
    // supplies 테이블 (부자재) - barcode 필드가 null이거나 빈 문자열인 품목
    const suppliesItems = await c.env.DB.prepare(`
      SELECT item_code, item_name, category, unit, 'supplies' as table_type
      FROM supplies
      WHERE (barcode IS NULL OR barcode = '')
      ${search ? `AND (item_code LIKE ? OR item_name LIKE ?)` : ''}
      ORDER BY item_name
      LIMIT 100
    `).bind(...(search ? [`%${search}%`, `%${search}%`] : [])).all();
    
    // 두 결과 합치기
    const allItems = [
      ...(masterItems.results || []),
      ...(suppliesItems.results || [])
    ];
    
    return c.json({
      success: true,
      data: allItems,
      count: allItems.length
    });
    
  } catch (error: any) {
    console.error('Unregistered items error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 바코드 등록 (원료/부자재에 바코드 할당)
barcodeRoutes.post('/register', async (c) => {
  try {
    const body = await c.req.json();
    const { item_code, barcode, table_type } = body;
    
    if (!item_code || !barcode) {
      return c.json({ success: false, error: '품목 코드와 바코드를 입력해주세요.' }, 400);
    }
    
    // 바코드 중복 체크 (master, supplies 모두)
    const existingMaster = await c.env.DB.prepare(
      'SELECT item_code, item_name FROM master WHERE barcode = ?'
    ).bind(barcode).first();
    
    const existingSupplies = await c.env.DB.prepare(
      'SELECT item_code, item_name FROM supplies WHERE barcode = ?'
    ).bind(barcode).first();
    
    if (existingMaster || existingSupplies) {
      const existing = existingMaster || existingSupplies;
      return c.json({ 
        success: false, 
        error: `이미 등록된 바코드입니다: ${(existing as any).item_name} (${(existing as any).item_code})` 
      }, 400);
    }
    
    // 해당 테이블에 바코드 업데이트
    if (table_type === 'master') {
      await c.env.DB.prepare(
        'UPDATE master SET barcode = ? WHERE item_code = ?'
      ).bind(barcode, item_code).run();
    } else if (table_type === 'supplies') {
      await c.env.DB.prepare(
        'UPDATE supplies SET barcode = ? WHERE item_code = ?'
      ).bind(barcode, item_code).run();
    } else {
      return c.json({ success: false, error: '잘못된 테이블 유형입니다.' }, 400);
    }
    
    return c.json({
      success: true,
      message: '바코드가 등록되었습니다.'
    });
    
  } catch (error: any) {
    console.error('Barcode register error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 등록된 바코드 목록 조회
barcodeRoutes.get('/registered', async (c) => {
  const search = c.req.query('search') || '';
  
  try {
    // master 테이블 - 바코드가 있는 품목
    const masterItems = await c.env.DB.prepare(`
      SELECT item_code, item_name, category, unit, barcode, 'master' as table_type
      FROM master
      WHERE barcode IS NOT NULL AND barcode != ''
      ${search ? `AND (item_code LIKE ? OR item_name LIKE ? OR barcode LIKE ?)` : ''}
      ORDER BY item_name
      LIMIT 100
    `).bind(...(search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [])).all();
    
    // supplies 테이블 - 바코드가 있는 품목
    const suppliesItems = await c.env.DB.prepare(`
      SELECT item_code, item_name, category, unit, barcode, 'supplies' as table_type
      FROM supplies
      WHERE barcode IS NOT NULL AND barcode != ''
      ${search ? `AND (item_code LIKE ? OR item_name LIKE ? OR barcode LIKE ?)` : ''}
      ORDER BY item_name
      LIMIT 100
    `).bind(...(search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [])).all();
    
    const allItems = [
      ...(masterItems.results || []),
      ...(suppliesItems.results || [])
    ];
    
    return c.json({
      success: true,
      data: allItems,
      count: allItems.length
    });
    
  } catch (error: any) {
    console.error('Registered items error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 바코드 삭제 (등록 해제)
barcodeRoutes.delete('/registered/:item_code', async (c) => {
  const item_code = c.req.param('item_code');
  const table_type = c.req.query('table_type');
  
  try {
    if (table_type === 'master') {
      await c.env.DB.prepare(
        'UPDATE master SET barcode = NULL WHERE item_code = ?'
      ).bind(item_code).run();
    } else if (table_type === 'supplies') {
      await c.env.DB.prepare(
        'UPDATE supplies SET barcode = NULL WHERE item_code = ?'
      ).bind(item_code).run();
    } else {
      return c.json({ success: false, error: '잘못된 테이블 유형입니다.' }, 400);
    }
    
    return c.json({
      success: true,
      message: '바코드가 삭제되었습니다.'
    });
    
  } catch (error: any) {
    console.error('Barcode delete error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default barcodeRoutes;
