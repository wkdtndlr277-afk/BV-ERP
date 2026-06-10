// 바코드 재고관리 API
import { Hono } from 'hono';
import type { Bindings } from '../types';

const barcodeRoutes = new Hono<{ Bindings: Bindings }>();

// ★★★ v3.4.17: 한국 시간(KST) 헬퍼 함수 ★★★
function getKSTDateTime(): string {
  const now = new Date();
  // UTC+9 시간 추가
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace('T', ' ').substring(0, 19);
}

function getKSTDate(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split('T')[0];
}

// 바코드 스캔 - 품목 검색
// 바코드 또는 품목코드로 검색, LOT 목록 포함 (FIFO 순서)
barcodeRoutes.get('/scan', async (c) => {
  const barcode = c.req.query('barcode');
  
  if (!barcode) {
    return c.json({ success: false, error: '바코드를 입력해주세요.' }, 400);
  }
  
  try {
    let item: any = null;
    let source = '';
    let mappedBarcode: any = null;
    
    // 0. barcode_mapping 테이블에서 먼저 검색 (업체별 바코드)
    try {
      const mappingResult = await c.env.DB.prepare(`
        SELECT * FROM barcode_mapping WHERE barcode = ? AND is_active = 1
      `).bind(barcode).first();
      
      if (mappingResult) {
        mappedBarcode = mappingResult;
        // 매핑된 item_code로 품목 조회
        const masterResult = await c.env.DB.prepare(`
          SELECT item_code, item_name, category, unit, current_stock, safety_stock, expiry_days, barcode,
                 pack_unit, pack_unit_name
          FROM master WHERE item_code = ?
        `).bind(mappingResult.item_code).first();
        
        if (masterResult) {
          item = {
            ...masterResult,
            // 매핑 테이블의 pack_unit이 있으면 우선 사용
            pack_unit: mappingResult.pack_unit || masterResult.pack_unit,
            pack_unit_name: mappingResult.pack_unit_name || masterResult.pack_unit_name,
            mapped_supplier: mappingResult.supplier,
            mapped_barcode: mappingResult.barcode
          };
          source = 'barcode_mapping';
        } else {
          // supplies 테이블에서 검색
          const suppliesResult = await c.env.DB.prepare(`
            SELECT item_code, item_name, category, unit, current_stock, safety_stock, expiry_days, barcode,
                   pack_unit, pack_unit_name
            FROM supplies WHERE item_code = ?
          `).bind(mappingResult.item_code).first();
          
          if (suppliesResult) {
            item = {
              ...suppliesResult,
              pack_unit: mappingResult.pack_unit || suppliesResult.pack_unit,
              pack_unit_name: mappingResult.pack_unit_name || suppliesResult.pack_unit_name,
              mapped_supplier: mappingResult.supplier,
              mapped_barcode: mappingResult.barcode
            };
            source = 'barcode_mapping';
          }
        }
      }
    } catch (e) {
      // barcode_mapping 테이블이 없을 수 있음
      console.log('barcode_mapping table not found:', e);
    }
    
    // 1. production_barcodes 테이블에서 바코드 검색
    if (!item) {
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
        console.log('production_barcodes table not found or error:', e);
      }
    }
    
    // 2. master 테이블에서 바코드 또는 item_code로 검색 (pack_unit 포함)
    if (!item) {
      const masterResult = await c.env.DB.prepare(`
        SELECT item_code, item_name, category, unit, current_stock, safety_stock, expiry_days, barcode,
               pack_unit, pack_unit_name
        FROM master
        WHERE barcode = ? OR item_code = ? OR item_name LIKE ?
      `).bind(barcode, barcode, `%${barcode}%`).first();
      
      if (masterResult) {
        item = masterResult;
        source = 'master';
      }
    }
    
    // 3. supplies 테이블에서 검색 (부자재, pack_unit 포함)
    if (!item) {
      const suppliesResult = await c.env.DB.prepare(`
        SELECT item_code, item_name, category, unit, current_stock, safety_stock, expiry_days, barcode,
               pack_unit, pack_unit_name
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
          VALUES (?, ?, '출고', ?, ?, ?, '${getKSTDateTime()}')
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
          VALUES (?, ?, '사용', ?, ?, ?, '${getKSTDateTime()}')
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
        VALUES (?, ?, ?, ?, ?, ?, '합격', ?, '${getKSTDateTime()}')
      `).bind(lotNumber, item_code, today, calculatedExpiry, quantity, quantity, memo || '바코드 스캔 입고').run();
      
      // 트랜잭션 기록
      await c.env.DB.prepare(`
        INSERT INTO production_transactions 
        (trans_date, production_code, trans_type, quantity, lot_number, memo, created_at)
        VALUES (?, ?, '생산입고', ?, ?, ?, '${getKSTDateTime()}')
      `).bind(today, item_code, quantity, lotNumber, memo || '바코드 스캔 입고').run();
      
      // current_stock 업데이트
      await c.env.DB.prepare(`
        UPDATE production_items SET current_stock = current_stock + ? WHERE production_code = ?
      `).bind(quantity, item_code).run();
      
    } else {
      // 원료/부자재 입고 - inbound
      // ★★★ v3.4.6 Fix: inbound 테이블에 memo 컬럼 없음 - storage_location에 메모 저장 ★★★
      await c.env.DB.prepare(`
        INSERT INTO inbound 
        (lot_number, item_code, inbound_date, expiry_date, origin_qty, remain_qty, quality_status, storage_location, created_at)
        VALUES (?, ?, ?, ?, ?, ?, '합격', ?, '${getKSTDateTime()}')
      `).bind(lotNumber, item_code, today, calculatedExpiry, quantity, quantity, memo || '바코드 스캔 입고').run();
      
      // 트랜잭션 기록
      await c.env.DB.prepare(`
        INSERT INTO transactions 
        (trans_date, item_code, trans_type, quantity, lot_number, memo, created_at)
        VALUES (?, ?, '입고', ?, ?, ?, '${getKSTDateTime()}')
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

// ============================================
// 바코드 전용 재고 관리 시스템
// ============================================

// 마이그레이션 - 바코드 재고 테이블 생성
barcodeRoutes.post('/migrate', async (c) => {
  try {
    // 바코드 재고 테이블
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS barcode_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT NOT NULL,
        item_code TEXT NOT NULL,
        item_name TEXT NOT NULL,
        category TEXT DEFAULT '원료',
        unit TEXT DEFAULT 'kg',
        current_stock REAL DEFAULT 0,
        safety_stock REAL DEFAULT 0,
        location TEXT,
        table_type TEXT DEFAULT 'master',
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(barcode)
      )
    `).run();
    
    // 바코드 재고 이력 테이블
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS barcode_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT NOT NULL,
        item_code TEXT NOT NULL,
        transaction_type TEXT NOT NULL,
        quantity REAL NOT NULL,
        before_stock REAL,
        after_stock REAL,
        lot_number TEXT,
        expiry_date DATE,
        memo TEXT,
        user_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    // 인덱스 생성
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_barcode_inv_barcode ON barcode_inventory(barcode)`).run();
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_barcode_inv_item ON barcode_inventory(item_code)`).run();
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_barcode_trans_barcode ON barcode_transactions(barcode)`).run();
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_barcode_trans_date ON barcode_transactions(created_at)`).run();
    
    return c.json({ success: true, message: '바코드 재고 테이블 생성 완료' });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 바코드 재고 목록 조회
barcodeRoutes.get('/inventory', async (c) => {
  const search = c.req.query('search');
  const category = c.req.query('category');
  const lowStock = c.req.query('low_stock'); // 안전재고 미달 필터
  
  try {
    let query = `
      SELECT * FROM barcode_inventory 
      WHERE is_active = 1
    `;
    const params: any[] = [];
    
    if (search) {
      query += ` AND (barcode LIKE ? OR item_code LIKE ? OR item_name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    if (category) {
      query += ` AND category = ?`;
      params.push(category);
    }
    
    if (lowStock === 'true') {
      query += ` AND current_stock < safety_stock`;
    }
    
    query += ` ORDER BY item_name ASC`;
    
    const result = await c.env.DB.prepare(query).bind(...params).all();
    
    // 통계
    const stats = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as total_items,
        SUM(CASE WHEN current_stock < safety_stock THEN 1 ELSE 0 END) as low_stock_count,
        SUM(CASE WHEN current_stock = 0 THEN 1 ELSE 0 END) as zero_stock_count
      FROM barcode_inventory WHERE is_active = 1
    `).first();
    
    return c.json({
      success: true,
      data: result.results || [],
      stats
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 바코드 재고 상세 조회
barcodeRoutes.get('/inventory/:barcode', async (c) => {
  const barcode = c.req.param('barcode');
  
  try {
    const item = await c.env.DB.prepare(`
      SELECT * FROM barcode_inventory WHERE barcode = ? AND is_active = 1
    `).bind(barcode).first();
    
    if (!item) {
      return c.json({ success: false, error: '등록되지 않은 바코드입니다.' }, 404);
    }
    
    // 최근 거래 이력
    const history = await c.env.DB.prepare(`
      SELECT * FROM barcode_transactions 
      WHERE barcode = ?
      ORDER BY created_at DESC
      LIMIT 20
    `).bind(barcode).all();
    
    return c.json({
      success: true,
      data: {
        ...item,
        history: history.results || []
      }
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 바코드 재고 등록/추가
barcodeRoutes.post('/inventory', async (c) => {
  try {
    const body = await c.req.json();
    const { barcode, item_code, item_name, category, unit, initial_stock, safety_stock, location, table_type } = body;
    
    if (!barcode || !item_code || !item_name) {
      return c.json({ success: false, error: '바코드, 품목코드, 품목명은 필수입니다.' }, 400);
    }
    
    // 중복 체크
    const existing = await c.env.DB.prepare(
      'SELECT id FROM barcode_inventory WHERE barcode = ?'
    ).bind(barcode).first();
    
    if (existing) {
      return c.json({ success: false, error: '이미 등록된 바코드입니다.' }, 400);
    }
    
    const result = await c.env.DB.prepare(`
      INSERT INTO barcode_inventory 
      (barcode, item_code, item_name, category, unit, current_stock, safety_stock, location, table_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      barcode, 
      item_code, 
      item_name, 
      category || '원료', 
      unit || 'kg',
      initial_stock || 0,
      safety_stock || 0,
      location || '',
      table_type || 'master'
    ).run();
    
    // 초기 재고가 있으면 이력 기록
    if (initial_stock && initial_stock > 0) {
      await c.env.DB.prepare(`
        INSERT INTO barcode_transactions 
        (barcode, item_code, transaction_type, quantity, before_stock, after_stock, memo)
        VALUES (?, ?, '초기등록', ?, 0, ?, '초기 재고 등록')
      `).bind(barcode, item_code, initial_stock, initial_stock).run();
    }
    
    return c.json({ success: true, message: '바코드 재고가 등록되었습니다.', id: result.meta.last_row_id });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 바코드 재고 수정
barcodeRoutes.put('/inventory/:barcode', async (c) => {
  const barcode = c.req.param('barcode');
  
  try {
    const body = await c.req.json();
    const { item_name, category, unit, safety_stock, location } = body;
    
    await c.env.DB.prepare(`
      UPDATE barcode_inventory SET
        item_name = COALESCE(?, item_name),
        category = COALESCE(?, category),
        unit = COALESCE(?, unit),
        safety_stock = COALESCE(?, safety_stock),
        location = COALESCE(?, location),
        updated_at = CURRENT_TIMESTAMP
      WHERE barcode = ?
    `).bind(item_name, category, unit, safety_stock, location, barcode).run();
    
    return c.json({ success: true, message: '수정되었습니다.' });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 바코드 재고 삭제 (비활성화)
barcodeRoutes.delete('/inventory/:barcode', async (c) => {
  const barcode = c.req.param('barcode');
  
  try {
    await c.env.DB.prepare(`
      UPDATE barcode_inventory SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE barcode = ?
    `).bind(barcode).run();
    
    return c.json({ success: true, message: '삭제되었습니다.' });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 바코드 스캔 - 재고 조회 (바코드 재고 시스템용)
barcodeRoutes.get('/inventory-scan', async (c) => {
  const barcode = c.req.query('barcode');
  
  if (!barcode) {
    return c.json({ success: false, error: '바코드를 입력해주세요.' }, 400);
  }
  
  try {
    // 바코드 재고 테이블에서 먼저 검색
    let item = await c.env.DB.prepare(`
      SELECT * FROM barcode_inventory WHERE barcode = ? AND is_active = 1
    `).bind(barcode).first();
    
    if (item) {
      // 최근 이력
      const history = await c.env.DB.prepare(`
        SELECT * FROM barcode_transactions WHERE barcode = ?
        ORDER BY created_at DESC LIMIT 5
      `).bind(barcode).all();
      
      return c.json({
        success: true,
        data: {
          ...item,
          source: 'barcode_inventory',
          history: history.results || []
        }
      });
    }
    
    // 바코드 재고에 없으면 기존 master/supplies에서 검색 후 자동 등록 제안
    let masterItem = await c.env.DB.prepare(`
      SELECT item_code, item_name, category, unit, current_stock, barcode
      FROM master WHERE barcode = ? OR item_code = ?
    `).bind(barcode, barcode).first();
    
    if (!masterItem) {
      masterItem = await c.env.DB.prepare(`
        SELECT item_code, item_name, category, unit, current_stock, barcode
        FROM supplies WHERE barcode = ? OR item_code = ?
      `).bind(barcode, barcode).first();
    }
    
    if (masterItem) {
      return c.json({
        success: true,
        data: {
          ...masterItem,
          source: 'master_not_registered',
          message: '바코드 재고에 등록되지 않은 품목입니다. 등록 후 사용해주세요.'
        }
      });
    }
    
    return c.json({ success: false, error: '등록되지 않은 바코드입니다.', barcode });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 바코드 재고 입고
barcodeRoutes.post('/inventory-inbound', async (c) => {
  try {
    const body = await c.req.json();
    const { barcode, quantity, lot_number, expiry_date, memo, user_name } = body;
    
    if (!barcode || !quantity || quantity <= 0) {
      return c.json({ success: false, error: '바코드와 수량을 입력해주세요.' }, 400);
    }
    
    // 재고 확인
    const item = await c.env.DB.prepare(
      'SELECT * FROM barcode_inventory WHERE barcode = ? AND is_active = 1'
    ).bind(barcode).first<any>();
    
    if (!item) {
      return c.json({ success: false, error: '등록되지 않은 바코드입니다.' }, 404);
    }
    
    const beforeStock = item.current_stock || 0;
    const afterStock = beforeStock + quantity;
    
    // 재고 업데이트
    await c.env.DB.prepare(`
      UPDATE barcode_inventory SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE barcode = ?
    `).bind(afterStock, barcode).run();
    
    // 이력 기록
    await c.env.DB.prepare(`
      INSERT INTO barcode_transactions 
      (barcode, item_code, transaction_type, quantity, before_stock, after_stock, lot_number, expiry_date, memo, user_name)
      VALUES (?, ?, '입고', ?, ?, ?, ?, ?, ?, ?)
    `).bind(barcode, item.item_code, quantity, beforeStock, afterStock, lot_number || '', expiry_date || '', memo || '', user_name || '').run();
    
    return c.json({
      success: true,
      message: '입고 완료',
      data: {
        barcode,
        item_name: item.item_name,
        before_stock: beforeStock,
        quantity,
        after_stock: afterStock
      }
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 바코드 재고 출고 (사용)
barcodeRoutes.post('/inventory-usage', async (c) => {
  try {
    const body = await c.req.json();
    const { barcode, quantity, memo, user_name } = body;
    
    if (!barcode || !quantity || quantity <= 0) {
      return c.json({ success: false, error: '바코드와 수량을 입력해주세요.' }, 400);
    }
    
    // 재고 확인
    const item = await c.env.DB.prepare(
      'SELECT * FROM barcode_inventory WHERE barcode = ? AND is_active = 1'
    ).bind(barcode).first<any>();
    
    if (!item) {
      return c.json({ success: false, error: '등록되지 않은 바코드입니다.' }, 404);
    }
    
    const beforeStock = item.current_stock || 0;
    
    if (beforeStock < quantity) {
      return c.json({ 
        success: false, 
        error: `재고 부족! 현재 재고: ${beforeStock} ${item.unit}`,
        current_stock: beforeStock
      }, 400);
    }
    
    const afterStock = beforeStock - quantity;
    
    // 재고 업데이트
    await c.env.DB.prepare(`
      UPDATE barcode_inventory SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE barcode = ?
    `).bind(afterStock, barcode).run();
    
    // 이력 기록
    await c.env.DB.prepare(`
      INSERT INTO barcode_transactions 
      (barcode, item_code, transaction_type, quantity, before_stock, after_stock, memo, user_name)
      VALUES (?, ?, '출고', ?, ?, ?, ?, ?)
    `).bind(barcode, item.item_code, quantity, beforeStock, afterStock, memo || '', user_name || '').run();
    
    return c.json({
      success: true,
      message: '출고 완료',
      data: {
        barcode,
        item_name: item.item_name,
        before_stock: beforeStock,
        quantity,
        after_stock: afterStock,
        is_low_stock: afterStock < (item.safety_stock || 0)
      }
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 바코드 재고 조정 (실사)
barcodeRoutes.post('/inventory-adjust', async (c) => {
  try {
    const body = await c.req.json();
    const { barcode, new_stock, memo, user_name } = body;
    
    if (!barcode || new_stock === undefined || new_stock < 0) {
      return c.json({ success: false, error: '바코드와 조정 재고를 입력해주세요.' }, 400);
    }
    
    const item = await c.env.DB.prepare(
      'SELECT * FROM barcode_inventory WHERE barcode = ? AND is_active = 1'
    ).bind(barcode).first<any>();
    
    if (!item) {
      return c.json({ success: false, error: '등록되지 않은 바코드입니다.' }, 404);
    }
    
    const beforeStock = item.current_stock || 0;
    const difference = new_stock - beforeStock;
    
    // 재고 업데이트
    await c.env.DB.prepare(`
      UPDATE barcode_inventory SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE barcode = ?
    `).bind(new_stock, barcode).run();
    
    // 이력 기록
    await c.env.DB.prepare(`
      INSERT INTO barcode_transactions 
      (barcode, item_code, transaction_type, quantity, before_stock, after_stock, memo, user_name)
      VALUES (?, ?, '재고조정', ?, ?, ?, ?, ?)
    `).bind(barcode, item.item_code, difference, beforeStock, new_stock, memo || '실사 조정', user_name || '').run();
    
    return c.json({
      success: true,
      message: '재고 조정 완료',
      data: {
        barcode,
        item_name: item.item_name,
        before_stock: beforeStock,
        new_stock,
        difference
      }
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 바코드 거래 이력 조회
barcodeRoutes.get('/inventory-history', async (c) => {
  const barcode = c.req.query('barcode');
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  const transactionType = c.req.query('type');
  const limit = parseInt(c.req.query('limit') || '50');
  
  try {
    let query = `
      SELECT bt.*, bi.item_name
      FROM barcode_transactions bt
      LEFT JOIN barcode_inventory bi ON bt.barcode = bi.barcode
      WHERE 1=1
    `;
    const params: any[] = [];
    
    if (barcode) {
      query += ` AND bt.barcode = ?`;
      params.push(barcode);
    }
    
    if (startDate) {
      query += ` AND DATE(bt.created_at) >= ?`;
      params.push(startDate);
    }
    
    if (endDate) {
      query += ` AND DATE(bt.created_at) <= ?`;
      params.push(endDate);
    }
    
    if (transactionType) {
      query += ` AND bt.transaction_type = ?`;
      params.push(transactionType);
    }
    
    query += ` ORDER BY bt.created_at DESC LIMIT ?`;
    params.push(limit);
    
    const result = await c.env.DB.prepare(query).bind(...params).all();
    
    return c.json({ success: true, data: result.results || [] });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 기존 품목을 바코드 재고로 일괄 등록
barcodeRoutes.post('/inventory-sync', async (c) => {
  try {
    const body = await c.req.json();
    const { source } = body; // 'master' | 'supplies' | 'all'
    
    let count = 0;
    
    if (source === 'master' || source === 'all') {
      // master 테이블에서 바코드가 있는 품목 동기화
      const masterItems = await c.env.DB.prepare(`
        SELECT item_code, item_name, category, unit, current_stock, safety_stock, barcode
        FROM master WHERE barcode IS NOT NULL AND barcode != ''
      `).all();
      
      for (const item of (masterItems.results || []) as any[]) {
        try {
          await c.env.DB.prepare(`
            INSERT OR IGNORE INTO barcode_inventory 
            (barcode, item_code, item_name, category, unit, current_stock, safety_stock, table_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'master')
          `).bind(item.barcode, item.item_code, item.item_name, item.category || '원료', item.unit || 'kg', item.current_stock || 0, item.safety_stock || 0).run();
          count++;
        } catch {}
      }
    }
    
    if (source === 'supplies' || source === 'all') {
      // supplies 테이블에서 바코드가 있는 품목 동기화
      const suppliesItems = await c.env.DB.prepare(`
        SELECT item_code, item_name, category, unit, current_stock, safety_stock, barcode
        FROM supplies WHERE barcode IS NOT NULL AND barcode != ''
      `).all();
      
      for (const item of (suppliesItems.results || []) as any[]) {
        try {
          await c.env.DB.prepare(`
            INSERT OR IGNORE INTO barcode_inventory 
            (barcode, item_code, item_name, category, unit, current_stock, safety_stock, table_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'supplies')
          `).bind(item.barcode, item.item_code, item.item_name, item.category || '부자재', item.unit || 'EA', item.current_stock || 0, item.safety_stock || 0).run();
          count++;
        } catch {}
      }
    }
    
    return c.json({ success: true, message: `${count}개 품목이 동기화되었습니다.` });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ===== 바코드 매핑 API (품목당 여러 바코드 지원) =====

// 바코드 매핑 목록 조회
barcodeRoutes.get('/mapping', async (c) => {
  const item_code = c.req.query('item_code');
  const search = c.req.query('search');
  
  try {
    // barcode_mapping 테이블 존재 확인
    try {
      await c.env.DB.prepare("SELECT 1 FROM barcode_mapping LIMIT 1").first();
    } catch {
      // 테이블이 없으면 생성
      await c.env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS barcode_mapping (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_code TEXT NOT NULL,
          barcode TEXT NOT NULL,
          supplier TEXT,
          pack_unit REAL,
          pack_unit_name TEXT,
          memo TEXT,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(barcode)
        )
      `).run();
    }
    
    let query = `
      SELECT bm.*, 
             COALESCE(m.item_name, s.item_name) as item_name,
             COALESCE(m.unit, s.unit) as unit,
             COALESCE(m.category, s.category) as category
      FROM barcode_mapping bm
      LEFT JOIN master m ON bm.item_code = m.item_code
      LEFT JOIN supplies s ON bm.item_code = s.item_code
      WHERE bm.is_active = 1
    `;
    const params: any[] = [];
    
    if (item_code) {
      query += ' AND bm.item_code = ?';
      params.push(item_code);
    }
    
    if (search) {
      query += ' AND (bm.barcode LIKE ? OR bm.supplier LIKE ? OR m.item_name LIKE ? OR s.item_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    query += ' ORDER BY bm.created_at DESC';
    
    const result = await c.env.DB.prepare(query).bind(...params).all();
    
    return c.json({ success: true, data: result.results || [] });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 바코드 매핑 등록
barcodeRoutes.post('/mapping', async (c) => {
  try {
    const body = await c.req.json();
    const { item_code, barcode, supplier, pack_unit, pack_unit_name, memo } = body;
    
    if (!item_code || !barcode) {
      return c.json({ success: false, error: '품목코드와 바코드는 필수입니다.' }, 400);
    }
    
    // 테이블 존재 확인 및 생성
    try {
      await c.env.DB.prepare("SELECT 1 FROM barcode_mapping LIMIT 1").first();
    } catch {
      await c.env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS barcode_mapping (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_code TEXT NOT NULL,
          barcode TEXT NOT NULL,
          supplier TEXT,
          pack_unit REAL,
          pack_unit_name TEXT,
          memo TEXT,
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(barcode)
        )
      `).run();
    }
    
    // 중복 바코드 체크
    const existing = await c.env.DB.prepare(`
      SELECT * FROM barcode_mapping WHERE barcode = ? AND is_active = 1
    `).bind(barcode).first();
    
    if (existing) {
      return c.json({ success: false, error: '이미 등록된 바코드입니다.' }, 400);
    }
    
    await c.env.DB.prepare(`
      INSERT INTO barcode_mapping (item_code, barcode, supplier, pack_unit, pack_unit_name, memo)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(item_code, barcode, supplier || null, pack_unit || null, pack_unit_name || null, memo || null).run();
    
    return c.json({ success: true, message: '바코드가 등록되었습니다.' });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 바코드 매핑 수정
barcodeRoutes.put('/mapping/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    const body = await c.req.json();
    const { supplier, pack_unit, pack_unit_name, memo, is_active } = body;
    
    await c.env.DB.prepare(`
      UPDATE barcode_mapping 
      SET supplier = ?, pack_unit = ?, pack_unit_name = ?, memo = ?, is_active = ?, updated_at = '${getKSTDateTime()}'
      WHERE id = ?
    `).bind(
      supplier || null, 
      pack_unit || null, 
      pack_unit_name || null, 
      memo || null,
      is_active !== undefined ? is_active : 1,
      id
    ).run();
    
    return c.json({ success: true, message: '바코드 정보가 수정되었습니다.' });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 바코드 매핑 삭제 (비활성화)
barcodeRoutes.delete('/mapping/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    await c.env.DB.prepare(`
      UPDATE barcode_mapping SET is_active = 0, updated_at = '${getKSTDateTime()}' WHERE id = ?
    `).bind(id).run();
    
    return c.json({ success: true, message: '바코드가 삭제되었습니다.' });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ★★★ v3.4.7: 원료 재고 현황 (바코드 재고관리 전용) ★★★
// 일별/월별 수불부와 완전 분리 - inbound 테이블 기반 독립 계산
barcodeRoutes.get('/material-inventory', async (c) => {
  try {
    const search = c.req.query('search') || '';
    
    // ★★★ v3.4.9: 날짜 파라미터 지원 및 계산 로직 수정 ★★★
    const dateParam = c.req.query('date');
    const targetDate = dateParam || new Date().toISOString().split('T')[0];
    const realToday = new Date().toISOString().split('T')[0];
    const isHistorical = targetDate !== realToday;
    
    // R169-R172 구형 코드 제외
    const EXCLUDE_CODES = ['R169', 'R170', 'R171', 'R172'];
    const excludePlaceholders = EXCLUDE_CODES.map(() => '?').join(',');
    
    // 원료만 조회 (category='원료')
    let query = `
      SELECT 
        m.item_code,
        m.item_name,
        m.unit,
        m.barcode,
        -- 현재고: inbound 테이블의 remain_qty SUM (실시간)
        COALESCE(
          (SELECT SUM(remain_qty) FROM inbound WHERE item_code = m.item_code AND remain_qty > 0),
          0
        ) as current_stock,
        -- 당일입고: 선택 날짜에 입고된 origin_qty SUM
        COALESCE(
          (SELECT SUM(origin_qty) FROM inbound WHERE item_code = m.item_code AND inbound_date = ?),
          0
        ) as today_inbound,
        -- 당일사용: 선택 날짜의 transactions에서 사용량 SUM (음수값의 절대값)
        COALESCE(
          (SELECT SUM(CASE WHEN quantity < 0 THEN ABS(quantity) ELSE 0 END) 
           FROM transactions 
           WHERE item_code = m.item_code AND trans_date = ? 
             AND trans_type IN ('사용', '출고', '바코드사용', '바코드조정(-)')),
          0
        ) as today_usage
      FROM master m
      WHERE m.category = '원료'
        AND m.item_code NOT IN (${excludePlaceholders})
    `;
    
    const params: any[] = [targetDate, targetDate, ...EXCLUDE_CODES];
    
    if (search) {
      query += ` AND (m.item_code LIKE ? OR m.item_name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    
    query += ` ORDER BY m.item_name`;
    
    const result = await c.env.DB.prepare(query).bind(...params).all<any>();
    
    // 데이터 후처리
    const materials = (result.results || []).map((item: any) => {
      const currentStock = parseFloat(item.current_stock) || 0;
      const todayInbound = parseFloat(item.today_inbound) || 0;
      const todayUsage = Math.abs(parseFloat(item.today_usage) || 0);  // 항상 양수로 변환
      
      // 전일재고 = 현재고 - 당일입고 + 당일사용
      // (현재고에서 오늘 입고를 빼고, 오늘 사용한 양을 더하면 어제 마감 재고)
      const prevStock = currentStock - todayInbound + todayUsage;
      
      return {
        item_code: item.item_code,
        item_name: item.item_name,
        unit: item.unit || 'kg',
        barcode: item.barcode,
        prev_stock: Math.max(0, prevStock),
        today_inbound: todayInbound,
        today_usage: todayUsage,  // 양수값
        current_stock: currentStock
      };
    });
    
    return c.json({
      success: true,
      date: targetDate,
      isHistorical,
      data: materials,
      count: materials.length,
      summary: {
        total_items: materials.length,
        total_prev_stock: materials.reduce((sum, m) => sum + m.prev_stock, 0),
        total_inbound: materials.reduce((sum, m) => sum + m.today_inbound, 0),
        total_usage: materials.reduce((sum, m) => sum + m.today_usage, 0),
        total_current_stock: materials.reduce((sum, m) => sum + m.current_stock, 0)
      }
    });
    
  } catch (error: any) {
    console.error('[barcode/material-inventory] Error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.4.7: 원료 재고 직접 수정 (바코드 재고관리 전용) ★★★
// 일별/월별 수불부에 영향 없음 - inbound 테이블만 조정
barcodeRoutes.post('/adjust-stock', async (c) => {
  try {
    const body = await c.req.json();
    const { item_code, new_stock, reason, memo, adjust_type } = body;
    
    if (!item_code || new_stock === undefined || new_stock === null) {
      return c.json({ success: false, error: '품목코드와 수정할 재고량을 입력해주세요.' }, 400);
    }
    
    if (new_stock < 0) {
      return c.json({ success: false, error: '재고량은 0 이상이어야 합니다.' }, 400);
    }
    
    // ★★★ v3.4.17: 한국 시간 기준 오늘/어제 계산 ★★★
    const today = getKSTDate();
    const timestamp = getKSTDateTime();
    
    // 전일재고 수정 시 어제 날짜 사용
    const yesterday = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    // 조정 유형에 따라 적용 날짜 결정
    const adjustDate = adjust_type === 'previous' ? yesterdayStr : today;
    
    // 품목 정보 확인 (원료만)
    const itemInfo = await c.env.DB.prepare(`
      SELECT item_code, item_name, unit FROM master WHERE item_code = ? AND category = '원료'
    `).bind(item_code).first<any>();
    
    if (!itemInfo) {
      return c.json({ success: false, error: '원료 품목을 찾을 수 없습니다.' }, 404);
    }
    
    // 현재 재고 계산 (inbound remain_qty SUM)
    const stockResult = await c.env.DB.prepare(`
      SELECT COALESCE(SUM(remain_qty), 0) as current_stock FROM inbound WHERE item_code = ? AND remain_qty > 0
    `).bind(item_code).first<any>();
    
    const currentStock = parseFloat(stockResult?.current_stock) || 0;
    const adjustQty = new_stock - currentStock;
    
    if (Math.abs(adjustQty) < 0.001) {
      return c.json({ success: true, message: '재고 변동이 없습니다.', adjusted: false });
    }
    
    // 조정 사유 텍스트
    const reasonText = reason || '바코드 재고관리 조정';
    const fullMemo = memo ? `${reasonText}: ${memo}` : reasonText;
    
    // ★★★ v3.4.17: 전일재고/현재재고에 따라 다른 trans_type 사용 ★★★
    const transType = adjust_type === 'previous' 
      ? (adjustQty > 0 ? '전일조정(+)' : '전일조정(-)') 
      : (adjustQty > 0 ? '바코드조정(+)' : '바코드조정(-)');
    
    if (adjustQty > 0) {
      // 재고 증가: 새 LOT으로 입고 처리
      const lotNumber = `ADJ-${adjustDate.replace(/-/g, '')}-${Date.now().toString().slice(-6)}`;
      
      await c.env.DB.prepare(`
        INSERT INTO inbound (lot_number, item_code, inbound_date, origin_qty, remain_qty, quality_status, storage_location, created_at)
        VALUES (?, ?, ?, ?, ?, '합격', ?, '${getKSTDateTime()}')
      `).bind(lotNumber, item_code, adjustDate, adjustQty, adjustQty, fullMemo).run();
      
      // 조정 거래 기록
      await c.env.DB.prepare(`
        INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, memo, created_at)
        VALUES (?, ?, ?, ?, ?, ?, '${getKSTDateTime()}')
      `).bind(adjustDate, item_code, transType, adjustQty, lotNumber, fullMemo).run();
      
    } else {
      // 재고 감소: 기존 LOT에서 FIFO 차감
      let remainingDeduct = Math.abs(adjustQty);
      
      const lots = await c.env.DB.prepare(`
        SELECT id, lot_number, remain_qty FROM inbound 
        WHERE item_code = ? AND remain_qty > 0 
        ORDER BY expiry_date ASC, inbound_date ASC
      `).bind(item_code).all<any>();
      
      for (const lot of lots.results || []) {
        if (remainingDeduct <= 0) break;
        
        const deductQty = Math.min(remainingDeduct, lot.remain_qty);
        
        await c.env.DB.prepare(`
          UPDATE inbound SET remain_qty = remain_qty - ?, updated_at = '${getKSTDateTime()}' WHERE id = ?
        `).bind(deductQty, lot.id).run();
        
        remainingDeduct -= deductQty;
      }
      
      // 조정 거래 기록
      await c.env.DB.prepare(`
        INSERT INTO transactions (trans_date, item_code, trans_type, quantity, memo, created_at)
        VALUES (?, ?, ?, ?, ?, '${getKSTDateTime()}')
      `).bind(adjustDate, item_code, transType, adjustQty, fullMemo).run();
    }
    
    // master 테이블 current_stock도 업데이트 (동기화)
    await c.env.DB.prepare(`
      UPDATE master SET current_stock = ?, updated_at = '${getKSTDateTime()}' WHERE item_code = ?
    `).bind(new_stock, item_code).run();
    
    // ★★★ v3.4.17: 조정 유형에 따른 메시지 ★★★
    const adjustTypeText = adjust_type === 'previous' ? '전일재고' : '현재재고';
    
    return c.json({
      success: true,
      message: `${itemInfo.item_name} ${adjustTypeText}가 ${currentStock.toFixed(2)} → ${new_stock.toFixed(2)} ${itemInfo.unit}로 조정되었습니다. (${adjustDate})`,
      data: {
        item_code,
        item_name: itemInfo.item_name,
        previous_stock: currentStock,
        new_stock: new_stock,
        adjusted_qty: adjustQty,
        adjust_type: adjust_type || 'current',
        adjust_date: adjustDate,
        reason: reasonText,
        adjusted_at: timestamp
      }
    });
    
  } catch (error: any) {
    console.error('[barcode/adjust-stock] Error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default barcodeRoutes;

// ★★★ v3.4.14: 바코드 사용/출고 거래 삭제 (재고 복원) - rowid 사용 ★★★
barcodeRoutes.delete('/transaction/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  
  if (!id || isNaN(id)) {
    return c.json({ success: false, error: '유효한 거래 ID가 필요합니다.' }, 400);
  }
  
  try {
    // 1. 거래 정보 조회 (rowid 사용)
    const transaction: any = await c.env.DB.prepare(`
      SELECT rowid as id, trans_date, item_code, trans_type, quantity, lot_number, memo
      FROM transactions WHERE rowid = ?
    `).bind(id).first();
    
    if (!transaction) {
      return c.json({ success: false, error: '거래 내역을 찾을 수 없습니다.' }, 404);
    }
    
    const { item_code, trans_type, quantity, lot_number } = transaction;
    const absQty = Math.abs(quantity);
    
    // 2. 사용/출고 거래만 삭제 가능 (입고는 별도 처리 필요)
    if (!['사용', '출고', '바코드사용', '바코드조정(-)'].includes(trans_type)) {
      return c.json({ 
        success: false, 
        error: `'${trans_type}' 타입의 거래는 이 기능으로 삭제할 수 없습니다. 사용/출고 거래만 삭제 가능합니다.` 
      }, 400);
    }
    
    // 3. 해당 LOT의 inbound 찾아서 remain_qty 복원
    if (lot_number) {
      const inbound: any = await c.env.DB.prepare(`
        SELECT id, remain_qty, origin_qty FROM inbound 
        WHERE item_code = ? AND lot_number = ?
      `).bind(item_code, lot_number).first();
      
      if (inbound) {
        // remain_qty 복원 (origin_qty 초과하지 않도록)
        const newRemainQty = Math.min(inbound.remain_qty + absQty, inbound.origin_qty);
        await c.env.DB.prepare(`
          UPDATE inbound SET remain_qty = ? WHERE id = ?
        `).bind(newRemainQty, inbound.id).run();
      }
    }
    
    // 4. master 테이블의 current_stock 복원
    await c.env.DB.prepare(`
      UPDATE master SET current_stock = COALESCE(current_stock, 0) + ? WHERE item_code = ?
    `).bind(absQty, item_code).run();
    
    // 5. 거래 레코드 삭제 (rowid 사용)
    await c.env.DB.prepare(`DELETE FROM transactions WHERE rowid = ?`).bind(id).run();
    
    // 6. 복원 후 현재 재고 조회
    const updatedStock: any = await c.env.DB.prepare(`
      SELECT current_stock FROM master WHERE item_code = ?
    `).bind(item_code).first();
    
    return c.json({
      success: true,
      message: `거래 삭제 완료. ${absQty} 재고가 복원되었습니다.`,
      data: {
        deleted_transaction: transaction,
        restored_qty: absQty,
        current_stock: updatedStock?.current_stock || 0
      }
    });
    
  } catch (error: any) {
    console.error('[barcode/transaction DELETE] Error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.4.10: 제품 거래 삭제 (production_transactions) ★★★
barcodeRoutes.delete('/product-transaction/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  
  if (!id || isNaN(id)) {
    return c.json({ success: false, error: '유효한 거래 ID가 필요합니다.' }, 400);
  }
  
  try {
    // 1. 거래 정보 조회
    const transaction: any = await c.env.DB.prepare(`
      SELECT id, trans_date, production_code, trans_type, quantity, lot_number, memo
      FROM production_transactions WHERE id = ?
    `).bind(id).first();
    
    if (!transaction) {
      return c.json({ success: false, error: '거래 내역을 찾을 수 없습니다.' }, 404);
    }
    
    const { production_code, trans_type, quantity, lot_number } = transaction;
    const absQty = Math.abs(quantity);
    
    // 2. 출고 거래만 삭제 가능
    if (!['출고', '바코드출고'].includes(trans_type)) {
      return c.json({ 
        success: false, 
        error: `'${trans_type}' 타입의 거래는 삭제할 수 없습니다.` 
      }, 400);
    }
    
    // 3. 해당 LOT의 production_inbound 찾아서 remain_qty 복원
    if (lot_number) {
      const inbound: any = await c.env.DB.prepare(`
        SELECT id, remain_qty, origin_qty FROM production_inbound 
        WHERE production_code = ? AND lot_number = ?
      `).bind(production_code, lot_number).first();
      
      if (inbound) {
        const newRemainQty = Math.min(inbound.remain_qty + absQty, inbound.origin_qty);
        await c.env.DB.prepare(`
          UPDATE production_inbound SET remain_qty = ? WHERE id = ?
        `).bind(newRemainQty, inbound.id).run();
      }
    }
    
    // 4. production_items의 current_stock 복원
    await c.env.DB.prepare(`
      UPDATE production_items SET current_stock = COALESCE(current_stock, 0) + ? WHERE production_code = ?
    `).bind(absQty, production_code).run();
    
    // 5. 거래 레코드 삭제
    await c.env.DB.prepare(`DELETE FROM production_transactions WHERE id = ?`).bind(id).run();
    
    return c.json({
      success: true,
      message: `거래 삭제 완료. ${absQty} 재고가 복원되었습니다.`,
      data: {
        deleted_transaction: transaction,
        restored_qty: absQty
      }
    });
    
  } catch (error: any) {
    console.error('[barcode/product-transaction DELETE] Error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.4.10: 오늘 날짜의 사용/출고 내역 조회 (삭제용) ★★★
barcodeRoutes.get('/today-transactions', async (c) => {
  try {
    const dateParam = c.req.query('date');
    const targetDate = dateParam || new Date().toISOString().split('T')[0];
    const item_code = c.req.query('item_code');
    
    // ★★★ v3.4.14: rowid를 명시적으로 가져옴 (D1 호환성) ★★★
    let query = `
      SELECT 
        t.rowid as id,
        t.trans_date,
        t.item_code,
        COALESCE(m.item_name, t.item_code) as item_name,
        t.trans_type,
        t.quantity,
        t.lot_number,
        t.memo,
        t.created_at,
        m.unit
      FROM transactions t
      LEFT JOIN master m ON t.item_code = m.item_code
      WHERE t.trans_date = ?
        AND t.trans_type IN ('사용', '출고', '바코드사용', '바코드조정(-)')
    `;
    
    const params: any[] = [targetDate];
    
    if (item_code) {
      query += ` AND t.item_code = ?`;
      params.push(item_code);
    }
    
    query += ` ORDER BY t.created_at DESC, t.rowid DESC LIMIT 100`;
    
    const result = await c.env.DB.prepare(query).bind(...params).all<any>();
    
    return c.json({
      success: true,
      date: targetDate,
      data: result.results || [],
      count: result.results?.length || 0
    });
    
  } catch (error: any) {
    console.error('[barcode/today-transactions] Error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.4.10: 디버깅용 - 특정 품목의 당일 transactions 확인 ★★★
barcodeRoutes.get('/debug-transactions', async (c) => {
  try {
    const item_code = c.req.query('item_code') || 'R001';
    const date = c.req.query('date') || new Date().toISOString().split('T')[0];
    
    // 1. transactions 테이블에서 해당 품목/날짜 전체 조회
    const allTrans = await c.env.DB.prepare(`
      SELECT * FROM transactions 
      WHERE item_code = ? AND trans_date = ?
      ORDER BY created_at DESC
    `).bind(item_code, date).all();
    
    // 2. 사용/출고 타입만 조회
    const usageTrans = await c.env.DB.prepare(`
      SELECT * FROM transactions 
      WHERE item_code = ? AND trans_date = ?
        AND trans_type IN ('사용', '출고', '바코드사용', '바코드조정(-)')
      ORDER BY created_at DESC
    `).bind(item_code, date).all();
    
    // 3. 당일사용 SUM 계산
    const usageSum = await c.env.DB.prepare(`
      SELECT 
        SUM(CASE WHEN quantity < 0 THEN ABS(quantity) ELSE 0 END) as negative_sum,
        SUM(ABS(quantity)) as total_abs_sum,
        SUM(quantity) as raw_sum,
        COUNT(*) as count
      FROM transactions 
      WHERE item_code = ? AND trans_date = ?
        AND trans_type IN ('사용', '출고', '바코드사용', '바코드조정(-)')
    `).bind(item_code, date).first();
    
    // 4. master 테이블 정보
    const masterInfo = await c.env.DB.prepare(`
      SELECT item_code, item_name, category, current_stock FROM master WHERE item_code = ?
    `).bind(item_code).first();
    
    // 5. inbound 테이블 정보
    const inboundInfo = await c.env.DB.prepare(`
      SELECT SUM(remain_qty) as total_remain, SUM(origin_qty) as total_origin
      FROM inbound WHERE item_code = ? AND remain_qty > 0
    `).bind(item_code).first();
    
    return c.json({
      success: true,
      item_code,
      date,
      master_info: masterInfo,
      inbound_summary: inboundInfo,
      usage_summary: usageSum,
      all_transactions: allTrans.results,
      usage_transactions: usageTrans.results
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});
