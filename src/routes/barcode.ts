// 바코드 재고관리 API
import { Hono } from 'hono';
import type { Bindings } from '../types';
import { GoogleSheetsService } from '../services/GoogleSheetsService';

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
    
    // ★★★ v3.4.20: 원료 재고 현황과 동일한 재고 계산 (transactions 기반) ★★★
    // 전일재고 = 현재고 - 당일입고(transactions) + 당일사용(transactions)
    if (item.category === '원료' && (source === 'master' || source === 'barcode_mapping')) {
      const today = getKSTDate();
      
      // 현재고: inbound remain_qty SUM (0인 LOT도 포함)
      const inboundStock = await c.env.DB.prepare(`
        SELECT COALESCE(SUM(remain_qty), 0) as total 
        FROM inbound WHERE item_code = ?
      `).bind(item.item_code).first<{total: number}>();
      const currentStock = inboundStock?.total || 0;
      
      // 당일 입고량 (transactions 기반)
      const todayInbound = await c.env.DB.prepare(`
        SELECT COALESCE(SUM(CASE WHEN quantity > 0 THEN quantity ELSE 0 END), 0) as total
        FROM transactions 
        WHERE item_code = ? AND trans_date = ? 
          AND trans_type IN ('입고', '바코드입고', '바코드조정(+)', '전일조정(+)')
      `).bind(item.item_code, today).first<{total: number}>();
      const todayInboundQty = todayInbound?.total || 0;
      
      // 당일 사용량 (transactions 기반)
      const todayUsage = await c.env.DB.prepare(`
        SELECT COALESCE(SUM(CASE WHEN quantity < 0 THEN ABS(quantity) ELSE 0 END), 0) as total
        FROM transactions 
        WHERE item_code = ? AND trans_date = ? 
          AND trans_type IN ('사용', '출고', '바코드사용', '바코드조정(-)', '전일조정(-)')
      `).bind(item.item_code, today).first<{total: number}>();
      const todayUsageQty = todayUsage?.total || 0;
      
      // 전일재고 = 현재고 - 당일입고 + 당일사용
      const prevStock = currentStock - todayInboundQty + todayUsageQty;
      
      // 아이템에 계산된 재고 정보 추가
      item.current_stock = currentStock;
      item.prev_stock = Math.max(0, prevStock);
      item.today_inbound = todayInboundQty;
      item.today_usage = todayUsageQty;
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

// ★★★ v3.6.62: 연속 스캔 중복 방지 + 고속 차감 ★★★
// 메모리 기반 요청 중복 체크 (1초 이내 동일 요청 방지)
const recentRequests = new Map<string, number>();

barcodeRoutes.post('/usage', async (c) => {
  try {
    const body = await c.req.json();
    const { item_code, quantity, lot_number, memo, request_id, trans_date } = body;
    
    if (!item_code || !quantity || quantity <= 0) {
      return c.json({ success: false, error: '품목 코드와 수량을 입력해주세요.' }, 400);
    }
    
    // ★★★ 연속 스캔 중복 방지 (동일 품목+수량 1초 이내 재요청 차단) ★★★
    const requestKey = `${item_code}_${quantity}_${request_id || ''}`;
    const now_ms = Date.now();
    const lastRequest = recentRequests.get(requestKey);
    
    if (lastRequest && (now_ms - lastRequest) < 1000) {
      return c.json({ 
        success: false, 
        error: '연속 스캔 감지 - 잠시 후 다시 시도하세요',
        duplicate: true 
      }, 429);
    }
    recentRequests.set(requestKey, now_ms);
    
    // 오래된 요청 정리 (5초 이상)
    for (const [key, time] of recentRequests.entries()) {
      if (now_ms - time > 5000) recentRequests.delete(key);
    }
    
    // ★★★ v3.6.82: trans_date 지원 (수기등록 날짜 선택) ★★★
    const today = trans_date || getKSTDate();
    const now = getKSTDateTime();
    
    // ★ 1단계: 품목정보 + LOT정보 병렬 조회 ★
    const [masterResult, suppliesResult, productResult, inboundLots, productionLots] = await Promise.all([
      c.env.DB.prepare('SELECT item_code, item_name, category, unit FROM master WHERE item_code = ?').bind(item_code).first(),
      c.env.DB.prepare('SELECT item_code, item_name, category, unit FROM supplies WHERE item_code = ?').bind(item_code).first(),
      c.env.DB.prepare(`SELECT production_code as item_code, COALESCE(alias1, production_name) as item_name, '제품' as category, COALESCE(unit, 'EA') as unit FROM production_items WHERE production_code = ?`).bind(item_code).first(),
      lot_number 
        ? c.env.DB.prepare(`SELECT id, lot_number, remain_qty FROM inbound WHERE item_code = ? AND lot_number = ? AND remain_qty > 0 AND quality_status = '합격'`).bind(item_code, lot_number).all()
        : c.env.DB.prepare(`SELECT id, lot_number, remain_qty FROM inbound WHERE item_code = ? AND remain_qty > 0 AND quality_status = '합격' ORDER BY expiry_date ASC, inbound_date ASC LIMIT 10`).bind(item_code).all(),
      lot_number
        ? c.env.DB.prepare(`SELECT id, lot_number, remain_qty FROM production_inbound WHERE production_code = ? AND lot_number = ? AND remain_qty > 0 AND quality_status = '합격'`).bind(item_code, lot_number).all()
        : c.env.DB.prepare(`SELECT id, lot_number, remain_qty FROM production_inbound WHERE production_code = ? AND remain_qty > 0 AND quality_status = '합격' ORDER BY expiry_date ASC, inbound_date ASC LIMIT 10`).bind(item_code).all()
    ]);
    
    // 품목 정보 결정
    let itemInfo: any = masterResult || suppliesResult || productResult;
    const isProduct = !masterResult && !suppliesResult && !!productResult;
    
    if (!itemInfo) {
      return c.json({ success: false, error: '품목을 찾을 수 없습니다.' }, 404);
    }
    
    // ★ 2단계: LOT 차감 계산 (메모리에서) ★
    const lotsToUse = isProduct ? (productionLots.results || []) : (inboundLots.results || []);
    let remainingQty = quantity;
    const usedLots: any[] = [];
    const batchStatements: any[] = [];
    
    for (const lot of lotsToUse) {
      if (remainingQty <= 0) break;
      const useQty = Math.min(remainingQty, lot.remain_qty as number);
      usedLots.push({ id: lot.id, lot_number: lot.lot_number, used_qty: useQty });
      remainingQty -= useQty;
    }
    
    const actualUsed = quantity - remainingQty;
    if (actualUsed <= 0) {
      return c.json({ success: false, error: '차감 가능한 재고가 없습니다.' }, 400);
    }
    
    // ★ 3단계: 모든 UPDATE/INSERT를 Batch로 한 번에 실행 ★
    const lotInfo = usedLots.map(l => `${l.lot_number}(${l.used_qty})`).join(', ');
    
    if (isProduct) {
      // 제품: LOT 차감 + 재고 차감 + 트랜잭션
      for (const lot of usedLots) {
        batchStatements.push(
          c.env.DB.prepare(`UPDATE production_inbound SET remain_qty = remain_qty - ? WHERE id = ?`).bind(lot.used_qty, lot.id)
        );
      }
      batchStatements.push(
        c.env.DB.prepare(`UPDATE production_items SET current_stock = current_stock - ? WHERE production_code = ?`).bind(actualUsed, item_code)
      );
      batchStatements.push(
        c.env.DB.prepare(`INSERT INTO production_transactions (trans_date, production_code, trans_type, quantity, lot_number, memo, created_at) VALUES (?, ?, '출고', ?, ?, ?, ?)`).bind(today, item_code, -actualUsed, lotInfo, memo || '바코드 스캔', now)
      );
    } else {
      // 원료/부자재: LOT 차감 + 재고 차감 + 트랜잭션
      for (const lot of usedLots) {
        batchStatements.push(
          c.env.DB.prepare(`UPDATE inbound SET remain_qty = remain_qty - ? WHERE id = ?`).bind(lot.used_qty, lot.id)
        );
      }
      batchStatements.push(
        c.env.DB.prepare(`UPDATE master SET current_stock = current_stock - ? WHERE item_code = ?`).bind(actualUsed, item_code)
      );
      batchStatements.push(
        c.env.DB.prepare(`UPDATE supplies SET current_stock = current_stock - ? WHERE item_code = ?`).bind(actualUsed, item_code)
      );
      batchStatements.push(
        c.env.DB.prepare(`INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, memo, created_at) VALUES (?, ?, '사용', ?, ?, ?, ?)`).bind(today, item_code, -actualUsed, lotInfo, memo || '바코드 스캔', now)
      );
    }
    
    // ★ Batch 실행 (1회 DB 호출로 모든 쿼리 처리) ★
    await c.env.DB.batch(batchStatements);
    
    if (remainingQty > 0) {
      return c.json({
        success: true,
        message: `부분 차감: ${actualUsed}${itemInfo.unit} (재고부족 ${remainingQty} 미차감)`,
        used_qty: actualUsed,
        remaining_qty: remainingQty,
        used_lots: usedLots.map(l => ({ lot_number: l.lot_number, used_qty: l.used_qty }))
      });
    }
    
    return c.json({
      success: true,
      message: `${itemInfo.item_name} ${quantity}${itemInfo.unit} 차감 완료`,
      used_qty: quantity,
      used_lots: usedLots.map(l => ({ lot_number: l.lot_number, used_qty: l.used_qty }))
    });
    
  } catch (error: any) {
    console.error('Usage error:', error);
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

// ★★★ v3.6.73: 바코드 재고 목록 조회 - inbound.remain_qty SUM 기반 실재고 ★★★
barcodeRoutes.get('/inventory', async (c) => {
  const search = c.req.query('search');
  const category = c.req.query('category');
  const lowStock = c.req.query('low_stock'); // 안전재고 미달 필터
  
  try {
    // barcode_inventory와 inbound를 JOIN하여 실재고(remain_qty SUM) 반환
    let query = `
      SELECT 
        bi.id,
        bi.barcode,
        bi.item_code,
        bi.item_name,
        bi.category,
        bi.unit,
        COALESCE(inb.real_stock, 0) as current_stock,
        bi.safety_stock,
        bi.location,
        bi.table_type,
        bi.is_active,
        bi.created_at,
        bi.updated_at
      FROM barcode_inventory bi
      LEFT JOIN (
        SELECT item_code, SUM(remain_qty) as real_stock
        FROM inbound
        WHERE remain_qty > 0 AND quality_status = '합격'
        GROUP BY item_code
      ) inb ON bi.item_code = inb.item_code
      WHERE bi.is_active = 1
    `;
    const params: any[] = [];
    
    if (search) {
      query += ` AND (bi.barcode LIKE ? OR bi.item_code LIKE ? OR bi.item_name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    if (category) {
      query += ` AND bi.category = ?`;
      params.push(category);
    }
    
    if (lowStock === 'true') {
      query += ` AND COALESCE(inb.real_stock, 0) < bi.safety_stock`;
    }
    
    query += ` ORDER BY bi.item_name ASC`;
    
    const result = await c.env.DB.prepare(query).bind(...params).all();
    
    // 통계 - inbound.remain_qty SUM 기반
    const stats = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as total_items,
        SUM(CASE WHEN COALESCE(inb.real_stock, 0) < bi.safety_stock THEN 1 ELSE 0 END) as low_stock_count,
        SUM(CASE WHEN COALESCE(inb.real_stock, 0) = 0 THEN 1 ELSE 0 END) as zero_stock_count
      FROM barcode_inventory bi
      LEFT JOIN (
        SELECT item_code, SUM(remain_qty) as real_stock
        FROM inbound
        WHERE remain_qty > 0 AND quality_status = '합격'
        GROUP BY item_code
      ) inb ON bi.item_code = inb.item_code
      WHERE bi.is_active = 1
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

// ★★★ v3.5.12: 원료 재고 현황 - transactions 테이블 기반 (Single Source of Truth) ★★★
// 모든 재고 계산이 transactions 테이블에서 일관되게 수행됨
// ★★★ v3.6.85: 바코드 재고관리 - 날짜별 정확한 재고 계산 ★★★
// 핵심: 전일재고 = 기준일 이전까지의 누적 재고 (입고 - 사용)
// 당일 기준: 실재고 = inbound remain_qty SUM
// 과거 기준: 해당 날짜까지의 누적 계산
barcodeRoutes.get('/material-inventory', async (c) => {
  try {
    const search = c.req.query('search') || '';
    
    const dateParam = c.req.query('date');
    const targetDate = dateParam || getKSTDate();
    const realToday = getKSTDate();
    const isHistorical = targetDate < realToday;
    const isFuture = targetDate > realToday;
    
    // R169-R172, RM266 구형/무효 코드 제외
    const EXCLUDE_CODES = ['R169', 'R170', 'R171', 'R172', 'RM266'];
    const excludePlaceholders = EXCLUDE_CODES.map(() => '?').join(',');
    
    // ★★★ v3.6.85: 날짜별 재고 계산 로직 (역산 방식) ★★★
    // - 오늘/미래: 현재 inbound remain_qty 합계 사용
    // - 과거: 현재 재고에서 역산 (현재잔량 + 이후사용 - 이후입고)
    
    let query = `
      SELECT 
        m.item_code,
        m.item_name,
        COALESCE(m.unit, 'kg') as unit,
        -- 현재 실재고 (inbound remain_qty SUM) - 기준점
        COALESCE(
          (SELECT SUM(remain_qty) 
           FROM inbound 
           WHERE item_code = m.item_code AND remain_qty > 0 AND quality_status = '합격'),
          0
        ) as real_current_stock,
        -- 기준일 이후 입고량 (기준일 다음날부터 오늘까지) - 역산용 (재고조정 LOT 제외)
        COALESCE(
          (SELECT SUM(origin_qty) 
           FROM inbound 
           WHERE item_code = m.item_code AND inbound_date > ? AND quality_status = '합격'
             AND lot_number NOT LIKE 'STADJ%' AND lot_number NOT LIKE 'PADJ%' AND lot_number NOT LIKE 'BADJ%'),
          0
        ) as after_inbound,
        -- 기준일 이후 사용량 (기준일 다음날부터 오늘까지) - 역산용
        COALESCE(
          (SELECT ABS(SUM(quantity)) 
           FROM transactions 
           WHERE item_code = m.item_code AND trans_date > ? AND trans_type = '사용'),
          0
        ) as after_usage,
        -- 당일입고: inbound_date = 기준일의 입고량 (재고조정 LOT 제외)
        COALESCE(
          (SELECT SUM(origin_qty) 
           FROM inbound 
           WHERE item_code = m.item_code AND inbound_date = ? AND quality_status = '합격'
             AND lot_number NOT LIKE 'STADJ%' AND lot_number NOT LIKE 'PADJ%' AND lot_number NOT LIKE 'BADJ%'),
          0
        ) as today_inbound,
        -- 당일사용: transactions의 사용 기록
        COALESCE(
          (SELECT ABS(SUM(quantity)) 
           FROM transactions 
           WHERE item_code = m.item_code AND trans_date = ? AND trans_type = '사용'),
          0
        ) as today_usage,
        -- ★★★ v3.6.115: 당일 재고조정량 (전일재고 계산용) ★★★
        COALESCE(
          (SELECT SUM(adjust_qty) 
           FROM barcode_adjustments 
           WHERE item_code = m.item_code AND adjust_date = ?),
          0
        ) as today_adjustment,
        -- LOT 수 (현재 기준)
        (SELECT COUNT(*) FROM inbound WHERE item_code = m.item_code AND remain_qty > 0 AND quality_status = '합격') as lot_count
      FROM master m
      WHERE m.category = '원료'
        AND (m.item_code LIKE 'R%' OR m.item_code LIKE 'RM%')
        AND m.item_code NOT LIKE 'RT%'
        AND m.item_code NOT IN (${excludePlaceholders})
        AND COALESCE(m.is_active, 1) = 1
    `;
    
    // 파라미터: 기준일(5개), 제외코드  ★★★ v3.6.115: 조정량 쿼리 추가 ★★★
    const params: any[] = [targetDate, targetDate, targetDate, targetDate, targetDate, ...EXCLUDE_CODES];
    
    if (search) {
      query += ` AND (m.item_code LIKE ? OR m.item_name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    
    query += ` ORDER BY m.item_name`;
    
    const result = await c.env.DB.prepare(query).bind(...params).all<any>();
    
    // ★★★ v3.6.85: 역산 방식 데이터 후처리 ★★★
    const materials = (result.results || []).map((item: any) => {
      const realCurrentStock = parseFloat(item.real_current_stock) || 0;
      const afterInbound = parseFloat(item.after_inbound) || 0;  // 기준일 이후 입고량
      const afterUsage = parseFloat(item.after_usage) || 0;      // 기준일 이후 사용량
      const todayInbound = parseFloat(item.today_inbound) || 0;
      const todayUsage = parseFloat(item.today_usage) || 0;
      const todayAdjustment = parseFloat(item.today_adjustment) || 0;  // ★★★ v3.6.115: 당일 재고조정량
      const lotCount = parseInt(item.lot_count) || 0;
      
      // ★★★ v3.6.85: 역산 방식 핵심 로직 ★★★
      // 현재 실재고(inbound remain_qty SUM)를 기준으로 과거 재고 역산
      // 
      // 공식: 과거재고 = 현재잔량 + 이후사용량 - 이후입고량
      // 예시: 현재 260kg, 7/16에 20kg 입고, 10kg 사용 → 7/15 재고 = 260 + 10 - 20 = 250kg
      
      let currentStock: number;
      let prevStock: number;
      
      if (isHistorical) {
        // ★ 과거 날짜: 역산 방식 ★
        // 해당 날짜 재고 = 현재잔량 + (기준일 이후 사용량) - (기준일 이후 입고량)
        currentStock = realCurrentStock + afterUsage - afterInbound;
        // 전일재고 = 해당날짜 재고 + 당일사용 - 당일입고
        prevStock = currentStock + todayUsage - todayInbound;
      } else {
        // ★ 오늘/미래: 현재 inbound remain_qty 직접 사용 ★
        currentStock = realCurrentStock;
        // ★★★ v3.6.117: 전일재고 = 현재재고 + 당일사용 - 당일입고 (조정량 제외) ★★★
        // 재고 조정은 "전일재고를 맞추기 위한 것"이므로, 전일재고 계산에서 제외
        // 조정 전 현재재고(=전일재고+입고-사용)에서 조정으로 현재재고만 변경됨
        prevStock = currentStock + todayUsage - todayInbound;
        
        // ★★★ v3.6.117: 당일 조정이 있으면, 조정 전 재고 기준으로 전일재고 계산 ★★★
        // 조정 전 현재재고 = 현재재고 - 조정량 (조정량이 음수면 차감이므로 빼면 원래 값)
        if (Math.abs(todayAdjustment) > 0.001) {
          const stockBeforeAdjust = currentStock - todayAdjustment;
          prevStock = stockBeforeAdjust + todayUsage - todayInbound;
        }
      }
      
      // 음수 방지
      currentStock = Math.max(0, currentStock);
      prevStock = Math.max(0, prevStock);
      
      return {
        item_code: item.item_code,
        item_name: item.item_name,
        unit: item.unit || 'kg',
        barcode: '',
        prev_stock: Math.round(prevStock * 1000) / 1000,
        today_inbound: todayInbound,
        today_usage: todayUsage,
        today_adjustment: Math.round(todayAdjustment * 1000) / 1000,  // ★★★ v3.6.115: 실제 조정량 표시
        current_stock: Math.round(currentStock * 1000) / 1000,
        lot_count: lotCount,
        calculated_stock: Math.round(currentStock * 1000) / 1000,
        integrity_valid: true
      };
    });
    
    // 검색어가 없을 때는 재고가 있거나 당일 활동이 있는 품목만 필터링
    const filteredMaterials = search 
      ? materials 
      : materials.filter(m => m.current_stock > 0 || m.today_inbound > 0 || m.today_usage > 0 || m.prev_stock > 0);
    
    return c.json({
      success: true,
      version: 'v3.6.85',
      date: targetDate,
      isHistorical,
      data: filteredMaterials,
      count: filteredMaterials.length,
      summary: {
        total_items: filteredMaterials.length,
        total_prev_stock: Math.round(filteredMaterials.reduce((sum, m) => sum + m.prev_stock, 0) * 100) / 100,
        total_inbound: Math.round(filteredMaterials.reduce((sum, m) => sum + m.today_inbound, 0) * 100) / 100,
        total_usage: Math.round(filteredMaterials.reduce((sum, m) => sum + m.today_usage, 0) * 100) / 100,
        total_current_stock: Math.round(filteredMaterials.reduce((sum, m) => sum + m.current_stock, 0) * 100) / 100
      },
      metadata: {
        data_source: isHistorical ? 'reverse_calculation' : 'inbound_remain_qty',
        calculation_method: isHistorical ? 'historical_reverse' : 'lot_based_sum',
        note: isHistorical 
          ? '과거 날짜: 역산 (현재잔량 + 이후사용 - 이후입고)' 
          : '오늘: 실재고=inbound remain_qty SUM'
      }
    });
    
  } catch (error: any) {
    console.error('[barcode/material-inventory] Error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.62: 바코드 재고 직접 수정 (일별수불부 영향 없음!) ★★★
// transactions 테이블에 기록하지 않고 inbound만 조정 → 일별수불부 계산에 포함 안됨
// ★★★ v3.6.86: 전일재고 수정 API ★★★
// 전일재고 수정 = 현재 실재고를 직접 조정 (inbound remain_qty)
// - inbound에 조정 LOT 추가/기존 LOT 차감
// - transactions에 기록하지 않음 → 당일입고/사용에 표시 안됨
// - 결과적으로 현재재고가 변하면 역산 시 전일재고도 함께 변함
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
    
    const today = getKSTDate();
    const timestamp = getKSTDateTime();
    
    // 품목 정보 확인 (원료/부자재)
    const itemInfo = await c.env.DB.prepare(`
      SELECT item_code, item_name, unit, category FROM master WHERE item_code = ?
    `).bind(item_code).first<any>();
    
    if (!itemInfo) {
      return c.json({ success: false, error: '품목을 찾을 수 없습니다.' }, 404);
    }
    
    // 현재 실재고 계산 (inbound remain_qty SUM)
    const stockResult = await c.env.DB.prepare(`
      SELECT COALESCE(SUM(remain_qty), 0) as current_stock FROM inbound 
      WHERE item_code = ? AND remain_qty > 0 AND quality_status = '합격'
    `).bind(item_code).first<any>();
    
    const currentStock = parseFloat(stockResult?.current_stock) || 0;
    const adjustQty = new_stock - currentStock;
    
    if (Math.abs(adjustQty) < 0.001) {
      return c.json({ success: true, message: '재고 변동이 없습니다.', adjusted: false });
    }
    
    const reasonText = reason || '전일재고 정정';
    const fullMemo = memo ? `${reasonText}: ${memo}` : reasonText;
    
    const batchStatements: any[] = [];
    
    // ★★★ v3.6.86 핵심: inbound만 조정, transactions 기록 안함 ★★★
    // 이렇게 하면:
    // - 현재재고(inbound remain_qty SUM)가 변함
    // - today_inbound 계산에서 제외됨 (inbound_date가 과거 또는 조정 LOT이므로)
    // - 역산 시 전일재고도 함께 조정됨
    
    if (adjustQty > 0) {
      // 재고 증가: 조정용 LOT 생성 (과거 날짜로 - 당일입고에 포함되지 않도록)
      // inbound_date를 1년 전으로 설정하여 어떤 날짜 조회에서도 당일입고에 포함 안됨
      const adjustDate = '2020-01-01';  // 고정된 과거 날짜
      const lotNumber = `STADJ-${today.replace(/-/g, '')}-${Date.now().toString().slice(-6)}`;
      
      batchStatements.push(
        c.env.DB.prepare(`
          INSERT INTO inbound (lot_number, item_code, inbound_date, origin_qty, remain_qty, quality_status, storage_location, created_at)
          VALUES (?, ?, ?, ?, ?, '합격', ?, ?)
        `).bind(lotNumber, item_code, adjustDate, adjustQty, adjustQty, `[재고조정] ${fullMemo}`, timestamp)
      );
      
    } else {
      // 재고 감소: 기존 LOT에서 FIFO 차감
      const lots = await c.env.DB.prepare(`
        SELECT id, lot_number, remain_qty FROM inbound 
        WHERE item_code = ? AND remain_qty > 0 AND quality_status = '합격'
        ORDER BY expiry_date ASC, inbound_date ASC
      `).bind(item_code).all<any>();
      
      let remainingDeduct = Math.abs(adjustQty);
      
      for (const lot of lots.results || []) {
        if (remainingDeduct <= 0) break;
        const deductQty = Math.min(remainingDeduct, lot.remain_qty);
        
        batchStatements.push(
          c.env.DB.prepare(`UPDATE inbound SET remain_qty = remain_qty - ? WHERE id = ?`).bind(deductQty, lot.id)
        );
        
        remainingDeduct -= deductQty;
      }
    }
    
    // 조정 이력 테이블에 기록 (추적용)
    try {
      await c.env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS barcode_adjustments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          adjust_date TEXT NOT NULL,
          item_code TEXT NOT NULL,
          item_name TEXT,
          previous_stock REAL,
          new_stock REAL,
          adjust_qty REAL,
          reason TEXT,
          memo TEXT,
          created_at TEXT
        )
      `).run();
    } catch (e) { /* 테이블 이미 존재 */ }
    
    batchStatements.push(
      c.env.DB.prepare(`
        INSERT INTO barcode_adjustments (adjust_date, item_code, item_name, previous_stock, new_stock, adjust_qty, reason, memo, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(today, item_code, itemInfo.item_name, currentStock, new_stock, adjustQty, reasonText, memo || '', timestamp)
    );
    
    // master current_stock 동기화
    batchStatements.push(
      c.env.DB.prepare(`UPDATE master SET current_stock = ? WHERE item_code = ?`).bind(new_stock, item_code)
    );
    
    // Batch 실행
    console.log('[adjust-stock] Batch 실행 시작:', batchStatements.length, '개 쿼리');
    const batchResult = await c.env.DB.batch(batchStatements);
    console.log('[adjust-stock] Batch 실행 완료:', JSON.stringify(batchResult));
    
    // ★★★ v3.6.116: 실제 반영 확인 ★★★
    const verifyStock = await c.env.DB.prepare(`
      SELECT COALESCE(SUM(remain_qty), 0) as verified_stock FROM inbound 
      WHERE item_code = ? AND remain_qty > 0 AND quality_status = '합격'
    `).bind(item_code).first<any>();
    console.log('[adjust-stock] 반영 확인:', item_code, '→', verifyStock?.verified_stock);
    
    return c.json({
      success: true,
      message: `${itemInfo.item_name} 재고가 ${currentStock.toFixed(2)} → ${new_stock.toFixed(2)} ${itemInfo.unit}로 조정되었습니다. (전일재고에 반영)`,
      verified_stock: verifyStock?.verified_stock,  // ★ 실제 반영된 재고
      data: {
        item_code,
        item_name: itemInfo.item_name,
        adjust_date: today,
        previous_stock: currentStock,
        new_stock: new_stock,
        adjusted_qty: adjustQty,
        reason: reasonText,
        adjusted_at: timestamp,
        note: '재고 조정은 당일 입고/사용에 표시되지 않고 전일재고에 반영됩니다.'
      }
    });
    
  } catch (error: any) {
    console.error('[barcode/adjust-stock] Error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.65: 구글시트 원료입고 → D1 inbound 동기화 ★★★
// 구글시트에서 입고된 데이터를 바코드 재고관리(D1 inbound)에 반영
barcodeRoutes.post('/sync-sheets-inbound', async (c) => {
  try {
    const body = await c.req.json<{ preview?: boolean }>().catch(() => ({}));
    const isPreview = body?.preview !== false; // 기본값 preview 모드
    
    // 구글시트 서비스 초기화
    const clientEmail = c.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = c.env.GOOGLE_PRIVATE_KEY;
    
    if (!clientEmail || !privateKey) {
      return c.json({ success: false, error: '구글 API 인증 정보가 없습니다.' }, 400);
    }
    
    const formattedKey = privateKey.replace(/\\n/g, '\n');
    const sheetsService = new GoogleSheetsService(clientEmail, formattedKey);
    
    // 구글시트 원료입고 시트 조회
    // 컬럼: A:입고일, B:원료코드, C:원료명, D:LOT번호, E:수량, F:단위, G:공급업체, H:소비기한, I:잔량
    const sheetData = await sheetsService.readSheet('원료입고', 'A2:I10000');
    
    if (!sheetData || sheetData.length === 0) {
      return c.json({ success: true, message: '구글시트에 입고 데이터가 없습니다.', synced: 0 });
    }
    
    // 기존 D1 inbound LOT 목록 조회 (중복 방지)
    const existingLots = await c.env.DB.prepare(`
      SELECT lot_number FROM inbound WHERE lot_number IS NOT NULL
    `).all<{ lot_number: string }>();
    
    const existingLotSet = new Set((existingLots.results || []).map(r => r.lot_number));
    
    // 동기화할 데이터 필터링
    const toSync: any[] = [];
    const skipped: any[] = [];
    const today = getKSTDate();
    const timestamp = getKSTDateTime();
    
    for (const row of sheetData) {
      const inboundDate = String(row[0] || '').trim().replace(/^'/, '');
      const itemCode = String(row[1] || '').trim();
      const itemName = String(row[2] || '').trim();
      const lotNumber = String(row[3] || '').trim();
      const originQty = parseFloat(row[4]) || 0;
      const unit = String(row[5] || 'kg').trim();
      const supplier = String(row[6] || '').trim();
      const expiryDate = String(row[7] || '').trim().replace(/^'/, '');
      const remainQty = parseFloat(row[8]) || 0;
      
      // 필수 데이터 검증
      if (!itemCode || !lotNumber || originQty <= 0) continue;
      
      // 잔량이 0 이하면 스킵 (이미 소진된 LOT)
      if (remainQty <= 0) continue;
      
      // 원료 코드만 처리 (R*, RM* 시작)
      if (!itemCode.startsWith('R')) continue;
      
      // 이미 존재하는 LOT는 스킵
      if (existingLotSet.has(lotNumber)) {
        skipped.push({ lot_number: lotNumber, item_code: itemCode, reason: '이미 존재' });
        continue;
      }
      
      toSync.push({
        lot_number: lotNumber,
        item_code: itemCode,
        item_name: itemName,
        inbound_date: inboundDate || today,
        expiry_date: expiryDate || null,
        origin_qty: originQty,
        remain_qty: remainQty,
        supplier: supplier,
        unit: unit
      });
    }
    
    // 미리보기 모드
    if (isPreview) {
      return c.json({
        success: true,
        preview: true,
        message: `${toSync.length}개 LOT를 동기화할 수 있습니다.`,
        to_sync: toSync.slice(0, 50), // 최대 50개만 미리보기
        to_sync_count: toSync.length,
        skipped_count: skipped.length,
        skipped_sample: skipped.slice(0, 10)
      });
    }
    
    // 실제 동기화 실행
    let syncedCount = 0;
    const errors: string[] = [];
    
    for (const item of toSync) {
      try {
        // inbound 테이블에 INSERT
        await c.env.DB.prepare(`
          INSERT INTO inbound (lot_number, item_code, inbound_date, expiry_date, origin_qty, remain_qty, quality_status, supplier, storage_location, created_at)
          VALUES (?, ?, ?, ?, ?, ?, '합격', ?, '구글시트동기화', ?)
        `).bind(
          item.lot_number,
          item.item_code,
          item.inbound_date,
          item.expiry_date,
          item.origin_qty,
          item.remain_qty,
          item.supplier,
          timestamp
        ).run();
        
        syncedCount++;
      } catch (err: any) {
        errors.push(`${item.lot_number}: ${err.message}`);
      }
    }
    
    return c.json({
      success: true,
      message: `${syncedCount}개 LOT 동기화 완료`,
      synced: syncedCount,
      skipped: skipped.length,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined
    });
    
  } catch (error: any) {
    console.error('[barcode/sync-sheets-inbound] Error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 구글시트 동기화 상태 조회
barcodeRoutes.get('/sync-sheets-status', async (c) => {
  try {
    // D1 inbound에서 구글시트 동기화된 LOT 수 조회
    const syncedCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM inbound WHERE storage_location = '구글시트동기화'
    `).first<{ count: number }>();
    
    // 전체 LOT 수
    const totalCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM inbound WHERE remain_qty > 0
    `).first<{ count: number }>();
    
    // 최근 동기화 시간
    const lastSync = await c.env.DB.prepare(`
      SELECT created_at FROM inbound WHERE storage_location = '구글시트동기화' ORDER BY created_at DESC LIMIT 1
    `).first<{ created_at: string }>();
    
    return c.json({
      success: true,
      data: {
        synced_lots: syncedCount?.count || 0,
        total_lots: totalCount?.count || 0,
        last_sync: lastSync?.created_at || null
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.67: 입고 패턴 기반 안전재고 자동 설정 ★★★
// 평균 입고량(사용량)과 입고 주기를 분석하여 적정 안전재고 계산
barcodeRoutes.post('/set-safety-stock-from-inbound', async (c) => {
  try {
    const body = await c.req.json<{ 
      preview?: boolean;
      days_stock?: number;  // 며칠치 재고를 안전재고로? (기본 7일 = 1주일)
    }>().catch(() => ({}));
    
    const isPreview = body?.preview !== false;
    const daysStock = Math.max(1, Math.min(90, body?.days_stock || 7)); // 1~90일 범위
    
    // 품목별 입고 패턴 분석
    // - 첫 입고일 ~ 마지막 입고일 기간
    // - 총 입고량 / 기간(일) = 일평균 입고량(≈사용량)
    // - 일평균 × 안전재고 일수 = 적정 안전재고
    const inboundAnalysis = await c.env.DB.prepare(`
      SELECT 
        i.item_code,
        m.item_name,
        COALESCE(m.unit, 'kg') as unit,
        SUM(i.origin_qty) as total_inbound,
        COUNT(*) as inbound_count,
        MIN(i.inbound_date) as first_inbound,
        MAX(i.inbound_date) as last_inbound,
        COALESCE(m.safety_stock, 0) as current_safety_stock
      FROM inbound i
      LEFT JOIN master m ON i.item_code = m.item_code
      WHERE i.item_code IS NOT NULL 
        AND i.item_code LIKE 'R%'
        AND i.origin_qty > 0
      GROUP BY i.item_code
      HAVING SUM(i.origin_qty) > 0
      ORDER BY SUM(i.origin_qty) DESC
    `).all<{
      item_code: string;
      item_name: string | null;
      unit: string;
      total_inbound: number;
      inbound_count: number;
      first_inbound: string;
      last_inbound: string;
      current_safety_stock: number;
    }>();
    
    const results = (inboundAnalysis.results || []).map(item => {
      // 기간 계산 (일 단위)
      const firstDate = new Date(item.first_inbound);
      const lastDate = new Date(item.last_inbound);
      const periodDays = Math.max(1, Math.ceil((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
      
      // 일평균 입고량 (≈ 일평균 사용량)
      const dailyAvg = item.total_inbound / periodDays;
      
      // 입고 주기 (평균 며칠에 한번 입고?)
      const avgInboundCycle = periodDays / item.inbound_count;
      
      // 적정 안전재고 = 일평균 × 안전재고 일수
      const newSafetyStock = Math.round(dailyAvg * daysStock * 10) / 10;
      
      return {
        ...item,
        period_days: periodDays,
        daily_avg: Math.round(dailyAvg * 100) / 100,
        avg_cycle: Math.round(avgInboundCycle * 10) / 10,
        new_safety_stock: newSafetyStock
      };
    });
    
    // 변경될 항목만 필터링
    const toUpdate = results.filter(r => 
      Math.abs(r.new_safety_stock - r.current_safety_stock) >= 0.1
    );
    
    // 미리보기 모드
    if (isPreview) {
      return c.json({
        success: true,
        preview: true,
        days_stock: daysStock,
        message: `총 ${results.length}개 품목 중 ${toUpdate.length}개 품목의 안전재고가 변경됩니다. (${daysStock}일치 기준)`,
        total_items: results.length,
        to_update_count: toUpdate.length,
        to_update: toUpdate.slice(0, 50),
        summary: {
          total_inbound_sum: results.reduce((sum, r) => sum + r.total_inbound, 0),
          avg_daily_total: Math.round(results.reduce((sum, r) => sum + r.daily_avg, 0) * 100) / 100,
          new_safety_stock_sum: Math.round(results.reduce((sum, r) => sum + r.new_safety_stock, 0) * 10) / 10
        }
      });
    }
    
    // 실제 업데이트 실행
    let updatedCount = 0;
    const errors: string[] = [];
    const timestamp = getKSTDateTime();
    
    for (const item of toUpdate) {
      try {
        const exists = await c.env.DB.prepare(`
          SELECT item_code FROM master WHERE item_code = ?
        `).bind(item.item_code).first();
        
        if (exists) {
          await c.env.DB.prepare(`
            UPDATE master SET safety_stock = ?, updated_at = ? WHERE item_code = ?
          `).bind(item.new_safety_stock, timestamp, item.item_code).run();
        } else {
          await c.env.DB.prepare(`
            INSERT INTO master (item_code, item_name, item_type, unit, safety_stock, created_at, updated_at)
            VALUES (?, ?, '원료', ?, ?, ?, ?)
          `).bind(
            item.item_code, 
            item.item_name || item.item_code,
            item.unit,
            item.new_safety_stock, 
            timestamp, 
            timestamp
          ).run();
        }
        
        updatedCount++;
      } catch (err: any) {
        errors.push(`${item.item_code}: ${err.message}`);
      }
    }
    
    return c.json({
      success: true,
      message: `${updatedCount}개 품목의 안전재고가 설정되었습니다. (${daysStock}일치 기준)`,
      updated: updatedCount,
      days_stock: daysStock,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined
    });
    
  } catch (error: any) {
    console.error('[barcode/set-safety-stock-from-inbound] Error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.74: 통계 기반 안전재고 분석 (표준편차 + 서비스 수준) ★★★
// 공식: 안전재고 = Z × σ × √(리드타임)
// Z값: A등급(1.96, 98%), B등급(1.645, 95%), C등급(1.28, 90%)
barcodeRoutes.get('/safety-stock-analysis', async (c) => {
  try {
    const leadDays = parseInt(c.req.query('lead_days') || '3');
    const months = parseInt(c.req.query('months') || '3');
    
    // 분석 기간 계산 (최근 N개월)
    const today = getKSTDate();
    const startDate = new Date(today);
    startDate.setMonth(startDate.getMonth() - months);
    const startDateStr = startDate.toISOString().split('T')[0];
    
    // 1. 일별 사용량 데이터 조회 (transactions 테이블)
    const dailyUsageData = await c.env.DB.prepare(`
      SELECT 
        item_code,
        trans_date,
        SUM(ABS(quantity)) as daily_usage
      FROM transactions
      WHERE trans_date >= ?
        AND trans_type IN ('사용', '출고', '바코드사용', '생산사용')
        AND item_code LIKE 'R%'
        AND quantity < 0
      GROUP BY item_code, trans_date
      ORDER BY item_code, trans_date
    `).bind(startDateStr).all<{
      item_code: string;
      trans_date: string;
      daily_usage: number;
    }>();
    
    // 2. 품목별 통계 계산
    const itemStats = new Map<string, {
      usages: number[];
      dates: string[];
    }>();
    
    for (const row of dailyUsageData.results || []) {
      if (!itemStats.has(row.item_code)) {
        itemStats.set(row.item_code, { usages: [], dates: [] });
      }
      const stat = itemStats.get(row.item_code)!;
      stat.usages.push(row.daily_usage);
      stat.dates.push(row.trans_date);
    }
    
    // 3. 품목 정보 + 현재 재고 조회
    const itemInfos = await c.env.DB.prepare(`
      SELECT 
        m.item_code,
        m.item_name,
        COALESCE(m.unit, 'kg') as unit,
        COALESCE(m.safety_stock, 0) as current_safety_stock,
        COALESCE(inb.total_remain, 0) as current_stock,
        COALESCE(inb.inbound_count, 0) as inbound_count,
        COALESCE(inb.avg_inbound_qty, 0) as avg_inbound_qty
      FROM master m
      LEFT JOIN (
        SELECT 
          item_code, 
          SUM(remain_qty) as total_remain,
          COUNT(*) as inbound_count,
          AVG(origin_qty) as avg_inbound_qty
        FROM inbound 
        WHERE quality_status = '합격'
        GROUP BY item_code
      ) inb ON m.item_code = inb.item_code
      WHERE m.item_code LIKE 'R%'
    `).all<{
      item_code: string;
      item_name: string;
      unit: string;
      current_safety_stock: number;
      current_stock: number;
      inbound_count: number;
      avg_inbound_qty: number;
    }>();
    
    const itemMap = new Map<string, any>();
    for (const item of itemInfos.results || []) {
      itemMap.set(item.item_code, item);
    }
    
    // 4. 통계 계산 (이상치 제거 + 표준편차)
    const results: any[] = [];
    const processedItems = new Set<string>();  // ★★★ v3.6.106: 처리된 품목 추적
    
    for (const [itemCode, stat] of itemStats.entries()) {
      const itemInfo = itemMap.get(itemCode);
      if (!itemInfo || stat.usages.length < 5) continue; // 최소 5일 데이터 필요
      processedItems.add(itemCode);  // ★★★ v3.6.106: 처리 표시
      
      // 이상치 제거 (IQR 방식)
      const sorted = [...stat.usages].sort((a, b) => a - b);
      const q1 = sorted[Math.floor(sorted.length * 0.25)];
      const q3 = sorted[Math.floor(sorted.length * 0.75)];
      const iqr = q3 - q1;
      const lowerBound = q1 - 1.5 * iqr;
      const upperBound = q3 + 1.5 * iqr;
      
      const cleanUsages = stat.usages.filter(u => u >= lowerBound && u <= upperBound);
      if (cleanUsages.length < 3) continue;
      
      // 평균 계산
      const mean = cleanUsages.reduce((a, b) => a + b, 0) / cleanUsages.length;
      
      // 표준편차 계산
      const squaredDiffs = cleanUsages.map(u => Math.pow(u - mean, 2));
      const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
      const stdDev = Math.sqrt(avgSquaredDiff);
      
      // 변동계수(CV) 계산 - 등급 결정 기준
      const cv = mean > 0 ? stdDev / mean : 0;
      
      // 등급 결정 (변동계수 + 사용빈도 기반)
      // A등급: 고가/핵심 원료, B등급: 일반 원료, C등급: 저가/대체 가능
      let grade: string;
      let zValue: number;
      
      if (cv < 0.3 && mean > 50) {
        grade = 'A';
        zValue = 1.96; // 98% 서비스 수준
      } else if (cv < 0.5 && mean > 10) {
        grade = 'B';
        zValue = 1.645; // 95% 서비스 수준
      } else {
        grade = 'C';
        zValue = 1.28; // 90% 서비스 수준
      }
      
      // 안전재고 계산: Z × σ × √(리드타임)
      const safetyStock = zValue * stdDev * Math.sqrt(leadDays);
      
      // 발주점 = 평균 일사용량 × 리드타임 + 안전재고
      const reorderPoint = mean * leadDays + safetyStock;
      
      // 재고일수 계산
      const daysOfStock = mean > 0 ? Math.round(itemInfo.current_stock / mean) : 999;
      
      // 발주 필요 여부
      const needOrder = itemInfo.current_stock < reorderPoint;
      
      // ★★★ v3.6.106: status_color 결정 (잔여일 기준) ★★★
      let statusColor = 'green';
      if (daysOfStock <= 3) {
        statusColor = 'red';    // 긴급: 0~3일
      } else if (daysOfStock <= 10) {
        statusColor = 'yellow'; // 주의: 4~10일
      }
      
      results.push({
        item_code: itemCode,
        item_name: itemInfo.item_name,
        unit: itemInfo.unit,
        grade,
        grade_reason: `CV=${cv.toFixed(2)}, 일평균=${mean.toFixed(1)}`,  // ★★★ v3.6.106
        z_value: zValue,
        current_stock: Math.round(itemInfo.current_stock * 10) / 10,
        daily_avg: Math.round(mean * 100) / 100,
        std_dev: Math.round(stdDev * 100) / 100,
        cv: Math.round(cv * 1000) / 1000,
        safety_stock: Math.round(safetyStock * 10) / 10,
        reorder_point: Math.round(reorderPoint * 10) / 10,
        days_of_stock: daysOfStock,
        status: needOrder ? '🔴 발주필요' : '🟢 정상',
        status_color: statusColor,  // ★★★ v3.6.106
        need_order: needOrder,
        data_points: cleanUsages.length,
        outliers_removed: stat.usages.length - cleanUsages.length
      });
    }
    
    // ★★★ v3.6.106: 사용 기록 없지만 안전재고 설정 + 재고 부족인 품목 추가 ★★★
    for (const [itemCode, itemInfo] of itemMap.entries()) {
      // 이미 처리된 품목은 건너뛰기
      if (processedItems.has(itemCode)) continue;
      
      // 안전재고가 설정되어 있고, 현재고가 안전재고 미만인 품목
      if (itemInfo.current_safety_stock > 0 && itemInfo.current_stock < itemInfo.current_safety_stock) {
        results.push({
          item_code: itemCode,
          item_name: itemInfo.item_name,
          unit: itemInfo.unit,
          grade: '-',  // 등급 미산정
          grade_reason: '사용기록 부족',
          z_value: 0,
          current_stock: Math.round(itemInfo.current_stock * 10) / 10,
          daily_avg: 0,
          std_dev: 0,
          cv: 0,
          safety_stock: itemInfo.current_safety_stock,
          reorder_point: itemInfo.current_safety_stock,  // 안전재고를 발주점으로 사용
          days_of_stock: 0,  // 일평균 사용량 없으므로 0
          status: '🔴 발주필요',
          status_color: 'red',  // ★★★ 긴급 표시
          need_order: true,
          data_points: 0,
          outliers_removed: 0
        });
      }
    }
    
    // 발주 필요 순으로 정렬 (재고일수 오름차순)
    results.sort((a, b) => {
      if (a.need_order !== b.need_order) return a.need_order ? -1 : 1;
      return a.days_of_stock - b.days_of_stock;
    });
    
    // 통계 요약
    const summary = {
      analysis_period: `${startDateStr} ~ ${today}`,
      lead_days: leadDays,
      total_items: results.length,
      need_order_count: results.filter(r => r.need_order).length,
      grade_a_count: results.filter(r => r.grade === 'A').length,
      grade_b_count: results.filter(r => r.grade === 'B').length,
      grade_c_count: results.filter(r => r.grade === 'C').length,
      no_usage_data_count: results.filter(r => r.grade === '-').length  // ★★★ v3.6.106
    };
    
    return c.json({
      success: true,
      summary,
      items: results
    });
    
  } catch (error: any) {
    console.error('[barcode/safety-stock-analysis] Error:', error);
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
