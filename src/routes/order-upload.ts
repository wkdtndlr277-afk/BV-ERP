// 발주서 자동 업로드 API
// 엑셀(쿠팡, 컬리) / PDF(배민, 오아시스) 자동 감지 및 파싱
// v3.5.18: DB 저장 + 발주→생산실적 자동 연동
import { Hono } from 'hono';
import { GoogleSheetsService } from '../services/GoogleSheetsService';

type Bindings = {
  DB: D1Database;
  GOOGLE_CLIENT_EMAIL?: string;
  GOOGLE_PRIVATE_KEY?: string;
};

const orderUpload = new Hono<{ Bindings: Bindings }>();

// 서비스 인스턴스 생성 헬퍼
function getSheetService(c: any): GoogleSheetsService | null {
  const clientEmail = c.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = c.env.GOOGLE_PRIVATE_KEY;
  if (!clientEmail || !privateKey) return null;
  const formattedKey = privateKey.replace(/\\n/g, '\n');
  return new GoogleSheetsService(clientEmail, formattedKey);
}

// ===== 테이블 초기화 =====
orderUpload.post('/init-table', async (c) => {
  try {
    // orders 테이블 생성
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_date TEXT NOT NULL,
        channel TEXT NOT NULL,
        product_code TEXT NOT NULL,
        product_name TEXT,
        quantity INTEGER NOT NULL,
        delivery_date TEXT,
        status TEXT DEFAULT '대기',
        remark TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    // 인덱스 생성
    await c.env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date)
    `).run();
    await c.env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_orders_channel ON orders(channel)
    `).run();
    await c.env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)
    `).run();
    
    return c.json({ success: true, message: 'orders 테이블 생성 완료' });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 엑셀 파싱 (CSV/TSV 형태) =====
function parseExcelData(data: string, channel: string): { product_name: string; quantity: number }[] {
  const lines = data.split('\n').filter(line => line.trim());
  const results: { product_name: string; quantity: number }[] = [];
  
  // 탭 또는 쉼표로 구분
  const delimiter = data.includes('\t') ? '\t' : ',';
  
  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(delimiter);
    if (cols.length < 2) continue;
    
    let productName = cols[0]?.trim() || '';
    let quantity = 0;
    
    // 수량 찾기 (숫자가 있는 컬럼)
    for (let j = 1; j < cols.length; j++) {
      const num = parseInt(cols[j]?.trim().replace(/,/g, '') || '0');
      if (num > 0) {
        quantity = num;
        break;
      }
    }
    
    // 헤더 스킵 (제품명이 "제품", "상품", "품명" 등이면 스킵)
    if (productName && quantity > 0 && 
        !['제품', '상품', '품명', '제품명', '상품명', 'product', 'name'].includes(productName.toLowerCase())) {
      results.push({ product_name: productName, quantity });
    }
  }
  
  return results;
}

// ===== PDF 텍스트에서 제품/수량 추출 =====
function parsePdfText(text: string, channel: string): { product_name: string; quantity: number }[] {
  const results: { product_name: string; quantity: number }[] = [];
  const lines = text.split('\n').filter(line => line.trim());
  
  // 숫자 패턴 (수량)
  const qtyPattern = /(\d+)\s*(개|ea|EA|박스|box|팩|pack)?/;
  
  for (const line of lines) {
    const match = line.match(qtyPattern);
    if (match) {
      const quantity = parseInt(match[1]) || 0;
      const productName = line.replace(qtyPattern, '').trim();
      
      if (productName && quantity > 0 && productName.length > 2) {
        results.push({ product_name: productName, quantity });
      }
    }
  }
  
  return results;
}

// ===== 제품명 → 제품코드 매칭 =====
async function matchProductCodes(
  db: D1Database, 
  items: { product_name: string; quantity: number }[]
): Promise<{
  matched: { product_code: string; product_name: string; quantity: number; matched_name: string }[];
  unmatched: { product_name: string; quantity: number }[];
}> {
  const matched: any[] = [];
  const unmatched: any[] = [];
  
  for (const item of items) {
    const searchName = item.product_name;
    
    // 1. production_items에서 검색 (production_name, alias1, alias2, external_name)
    const result = await db.prepare(`
      SELECT production_code, production_name
      FROM production_items
      WHERE production_name LIKE ?
         OR alias1 LIKE ?
         OR alias2 LIKE ?
         OR external_name LIKE ?
      LIMIT 1
    `).bind(`%${searchName}%`, `%${searchName}%`, `%${searchName}%`, `%${searchName}%`).first<any>();
    
    if (result) {
      matched.push({
        product_code: result.production_code,
        product_name: result.production_name,
        quantity: item.quantity,
        matched_name: searchName
      });
    } else {
      // 2. production_barcodes에서 검색
      const barcodeResult = await db.prepare(`
        SELECT pb.production_code, pi.production_name
        FROM production_barcodes pb
        LEFT JOIN production_items pi ON pb.production_code = pi.production_code
        WHERE pb.product_name LIKE ?
        LIMIT 1
      `).bind(`%${searchName}%`).first<any>();
      
      if (barcodeResult) {
        matched.push({
          product_code: barcodeResult.production_code,
          product_name: barcodeResult.production_name,
          quantity: item.quantity,
          matched_name: searchName
        });
      } else {
        unmatched.push(item);
      }
    }
  }
  
  return { matched, unmatched };
}

// ===== DB에 발주 저장 =====
async function saveOrdersToDB(
  db: D1Database,
  orderDate: string,
  channel: string,
  items: { product_code: string; product_name: string; quantity: number }[]
): Promise<number> {
  let savedCount = 0;
  
  for (const item of items) {
    try {
      await db.prepare(`
        INSERT INTO orders (order_date, channel, product_code, product_name, quantity, delivery_date, status)
        VALUES (?, ?, ?, ?, ?, ?, '대기')
      `).bind(orderDate, channel, item.product_code, item.product_name, item.quantity, orderDate).run();
      savedCount++;
    } catch (e) {
      console.error('발주 저장 실패:', e);
    }
  }
  
  return savedCount;
}

// ===== 메인 업로드 API (엑셀) =====
orderUpload.post('/upload', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File;
    const channel = (formData.get('channel') as string) || '기타';
    const orderDate = (formData.get('order_date') as string) || new Date().toISOString().split('T')[0];
    
    if (!file) {
      return c.json({ success: false, error: '파일이 없습니다' }, 400);
    }
    
    const fileName = file.name.toLowerCase();
    const fileType = fileName.endsWith('.pdf') ? 'pdf' : 
                     (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv') || fileName.endsWith('.txt')) ? 'excel' : 
                     'unknown';
    
    if (fileType === 'unknown') {
      return c.json({ success: false, error: '지원하지 않는 파일 형식입니다 (엑셀/CSV/TXT 또는 PDF만 가능)' }, 400);
    }
    
    if (fileType === 'pdf') {
      return c.json({ 
        success: false, 
        error: 'PDF 파일은 텍스트 복사 후 /upload-text API를 사용하세요',
        hint: '배민/오아시스 PDF에서 텍스트를 복사하세요'
      }, 400);
    }
    
    // 엑셀/CSV 파일 처리
    const text = await file.text();
    const parsedItems = parseExcelData(text, channel);
    
    if (parsedItems.length === 0) {
      return c.json({ success: false, error: '파싱된 데이터가 없습니다. 파일 형식을 확인하세요.' }, 400);
    }
    
    // 제품코드 매칭
    const { matched, unmatched } = await matchProductCodes(c.env.DB, parsedItems);
    
    // DB에 저장
    let dbSaved = 0;
    if (matched.length > 0) {
      dbSaved = await saveOrdersToDB(c.env.DB, orderDate, channel, matched);
    }
    
    // 구글 시트에도 추가 (선택적)
    const service = getSheetService(c);
    if (service && matched.length > 0) {
      const rows = matched.map(item => [
        orderDate,
        item.product_code,
        item.product_name,
        item.quantity,
        orderDate,
        channel,
        '',
        '대기'
      ]);
      await service.appendSheet('발주서', rows);
    }
    
    return c.json({
      success: true,
      file_type: fileType,
      channel,
      order_date: orderDate,
      summary: {
        total_parsed: parsedItems.length,
        matched: matched.length,
        unmatched: unmatched.length,
        db_saved: dbSaved
      },
      matched_items: matched,
      unmatched_items: unmatched,
      message: `${matched.length}건 발주서 등록 완료, ${unmatched.length}건 미매칭`
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 텍스트 직접 입력 (PDF 복사 붙여넣기용) =====
orderUpload.post('/upload-text', async (c) => {
  try {
    const body = await c.req.json();
    const { text, channel = '기타', order_date } = body;
    const orderDate = order_date || new Date().toISOString().split('T')[0];
    
    if (!text) {
      return c.json({ success: false, error: '텍스트가 없습니다' }, 400);
    }
    
    const parsedItems = parsePdfText(text, channel);
    
    if (parsedItems.length === 0) {
      return c.json({ success: false, error: '파싱된 데이터가 없습니다' }, 400);
    }
    
    const { matched, unmatched } = await matchProductCodes(c.env.DB, parsedItems);
    
    // DB에 저장
    let dbSaved = 0;
    if (matched.length > 0) {
      dbSaved = await saveOrdersToDB(c.env.DB, orderDate, channel, matched);
    }
    
    // 구글 시트에도 추가
    const service = getSheetService(c);
    if (service && matched.length > 0) {
      const rows = matched.map(item => [
        orderDate,
        item.product_code,
        item.product_name,
        item.quantity,
        orderDate,
        channel,
        '',
        '대기'
      ]);
      await service.appendSheet('발주서', rows);
    }
    
    return c.json({
      success: true,
      channel,
      order_date: orderDate,
      summary: {
        total_parsed: parsedItems.length,
        matched: matched.length,
        unmatched: unmatched.length,
        db_saved: dbSaved
      },
      matched_items: matched,
      unmatched_items: unmatched,
      message: `${matched.length}건 발주서 등록 완료`
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== JSON 직접 입력 (제품코드 + 수량) =====
orderUpload.post('/upload-json', async (c) => {
  try {
    const body = await c.req.json();
    const { items, channel = '기타', order_date } = body;
    const orderDate = order_date || new Date().toISOString().split('T')[0];
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return c.json({ success: false, error: 'items 배열이 없습니다' }, 400);
    }
    
    const directItems: any[] = [];
    const needMatch: { product_name: string; quantity: number }[] = [];
    
    for (const item of items) {
      if (item.product_code) {
        const prodInfo = await c.env.DB.prepare(`
          SELECT production_code, production_name
          FROM production_items
          WHERE production_code = ?
        `).bind(item.product_code).first<any>();
        
        directItems.push({
          product_code: item.product_code,
          product_name: prodInfo?.production_name || item.product_name || item.product_code,
          quantity: item.quantity
        });
      } else if (item.product_name) {
        needMatch.push({ product_name: item.product_name, quantity: item.quantity });
      }
    }
    
    const { matched, unmatched } = await matchProductCodes(c.env.DB, needMatch);
    const allMatched = [...directItems, ...matched];
    
    // DB에 저장
    let dbSaved = 0;
    if (allMatched.length > 0) {
      dbSaved = await saveOrdersToDB(c.env.DB, orderDate, channel, allMatched);
    }
    
    // 구글 시트에도 추가
    const service = getSheetService(c);
    if (service && allMatched.length > 0) {
      const rows = allMatched.map(item => [
        orderDate,
        item.product_code,
        item.product_name,
        item.quantity,
        orderDate,
        channel,
        '',
        '대기'
      ]);
      await service.appendSheet('발주서', rows);
    }
    
    return c.json({
      success: true,
      channel,
      order_date: orderDate,
      summary: {
        total: items.length,
        registered: allMatched.length,
        unmatched: unmatched.length,
        db_saved: dbSaved
      },
      registered_items: allMatched,
      unmatched_items: unmatched,
      message: `${allMatched.length}건 발주서 등록 완료`
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ========================================
// 발주 목록 조회 API
// ========================================

// ===== 발주 목록 조회 (날짜별/채널별) =====
orderUpload.get('/list', async (c) => {
  try {
    const orderDate = c.req.query('order_date');
    const channel = c.req.query('channel');
    const status = c.req.query('status');
    
    let query = `
      SELECT id, order_date, channel, product_code, product_name, quantity, 
             delivery_date, status, remark, created_at
      FROM orders
      WHERE 1=1
    `;
    const params: any[] = [];
    
    if (orderDate) {
      query += ' AND order_date = ?';
      params.push(orderDate);
    }
    if (channel) {
      query += ' AND channel = ?';
      params.push(channel);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY order_date DESC, channel, product_code';
    
    const result = await c.env.DB.prepare(query).bind(...params).all<any>();
    
    return c.json({
      success: true,
      count: result.results?.length || 0,
      orders: result.results || []
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 발주 집계 (날짜별 제품 합산) =====
orderUpload.get('/summary', async (c) => {
  try {
    const orderDate = c.req.query('order_date') || new Date().toISOString().split('T')[0];
    
    // 채널별 + 제품별 집계
    const byChannel = await c.env.DB.prepare(`
      SELECT channel, product_code, product_name, SUM(quantity) as total_qty
      FROM orders
      WHERE order_date = ? AND status = '대기'
      GROUP BY channel, product_code
      ORDER BY channel, product_code
    `).bind(orderDate).all<any>();
    
    // 제품별 전체 합계 (생산실적용)
    const totalByProduct = await c.env.DB.prepare(`
      SELECT product_code, product_name, SUM(quantity) as total_qty,
             GROUP_CONCAT(DISTINCT channel) as channels
      FROM orders
      WHERE order_date = ? AND status = '대기'
      GROUP BY product_code
      ORDER BY product_code
    `).bind(orderDate).all<any>();
    
    // 채널별 건수
    const channelStats = await c.env.DB.prepare(`
      SELECT channel, COUNT(*) as count, SUM(quantity) as total_qty
      FROM orders
      WHERE order_date = ? AND status = '대기'
      GROUP BY channel
    `).bind(orderDate).all<any>();
    
    return c.json({
      success: true,
      order_date: orderDate,
      channel_stats: channelStats.results || [],
      by_channel: byChannel.results || [],
      total_by_product: totalByProduct.results || [],
      total_products: totalByProduct.results?.length || 0,
      total_quantity: totalByProduct.results?.reduce((sum: number, item: any) => sum + item.total_qty, 0) || 0
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 발주 상태 변경 =====
orderUpload.post('/update-status', async (c) => {
  try {
    const body = await c.req.json();
    const { ids, status, order_date, channel } = body;
    
    if (!status) {
      return c.json({ success: false, error: 'status 필수' }, 400);
    }
    
    let updateCount = 0;
    
    if (ids && Array.isArray(ids) && ids.length > 0) {
      // 특정 ID들만 업데이트
      for (const id of ids) {
        await c.env.DB.prepare(`
          UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).bind(status, id).run();
        updateCount++;
      }
    } else if (order_date) {
      // 날짜 기준 일괄 업데이트
      let query = `UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE order_date = ?`;
      const params: any[] = [status, order_date];
      
      if (channel) {
        query += ' AND channel = ?';
        params.push(channel);
      }
      
      const result = await c.env.DB.prepare(query).bind(...params).run();
      updateCount = result.meta?.changes || 0;
    }
    
    return c.json({
      success: true,
      updated: updateCount,
      new_status: status
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 발주 삭제 =====
orderUpload.delete('/delete', async (c) => {
  try {
    const body = await c.req.json();
    const { ids, order_date, channel } = body;
    
    let deleteCount = 0;
    
    if (ids && Array.isArray(ids) && ids.length > 0) {
      for (const id of ids) {
        await c.env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(id).run();
        deleteCount++;
      }
    } else if (order_date) {
      let query = 'DELETE FROM orders WHERE order_date = ?';
      const params: any[] = [order_date];
      
      if (channel) {
        query += ' AND channel = ?';
        params.push(channel);
      }
      
      const result = await c.env.DB.prepare(query).bind(...params).run();
      deleteCount = result.meta?.changes || 0;
    }
    
    return c.json({
      success: true,
      deleted: deleteCount
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ========================================
// 발주 → 생산실적 연동 API
// ========================================

// ===== 발주 → 생산실적 자동 입력 =====
orderUpload.post('/to-production', async (c) => {
  try {
    const body = await c.req.json();
    const { order_date, production_date, lot_number } = body;
    
    const prodDate = production_date || order_date || new Date().toISOString().split('T')[0];
    const lotNum = lot_number || prodDate.replace(/-/g, '').slice(2); // YYMMDD
    
    if (!order_date) {
      return c.json({ success: false, error: 'order_date 필수' }, 400);
    }
    
    // 발주 데이터 조회 (대기 상태만)
    const orders = await c.env.DB.prepare(`
      SELECT product_code, product_name, SUM(quantity) as total_qty,
             GROUP_CONCAT(DISTINCT channel) as channels
      FROM orders
      WHERE order_date = ? AND status = '대기'
      GROUP BY product_code
      ORDER BY product_code
    `).bind(order_date).all<any>();
    
    if (!orders.results || orders.results.length === 0) {
      return c.json({ 
        success: false, 
        error: '해당 날짜에 대기 중인 발주가 없습니다',
        order_date 
      }, 400);
    }
    
    // 생산실적용 데이터 포맷
    const productionItems = orders.results.map((item: any) => ({
      product_code: item.product_code,
      product_name: item.product_name,
      order_qty: item.total_qty,
      production_qty: item.total_qty, // 기본값 = 발주수량
      channels: item.channels,
      lot_number: lotNum
    }));
    
    return c.json({
      success: true,
      order_date,
      production_date: prodDate,
      lot_number: lotNum,
      total_products: productionItems.length,
      total_quantity: productionItems.reduce((sum: number, item: any) => sum + item.order_qty, 0),
      items: productionItems,
      message: `${productionItems.length}개 제품이 생산실적에 준비되었습니다. 수량 확인 후 등록하세요.`
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 생산 완료 처리 (발주 상태 변경 + 생산실적 등록 + 시트 전송) =====
orderUpload.post('/complete-production', async (c) => {
  try {
    const body = await c.req.json();
    const { order_date, production_date, lot_number, items } = body;
    
    if (!order_date || !items || !Array.isArray(items)) {
      return c.json({ success: false, error: 'order_date, items 필수' }, 400);
    }
    
    const prodDate = production_date || order_date;
    const lotNum = lot_number || prodDate.replace(/-/g, '').slice(2);
    
    // 1. 발주 상태를 '완료'로 변경
    await c.env.DB.prepare(`
      UPDATE orders 
      SET status = '완료', updated_at = CURRENT_TIMESTAMP 
      WHERE order_date = ? AND status = '대기'
    `).bind(order_date).run();
    
    // 2. 구글 시트에 생산실적 전송
    const service = getSheetService(c);
    if (service && items.length > 0) {
      // 생산실적 시트에 추가
      const productionRows = items.map((item: any) => [
        prodDate,
        lotNum,
        item.product_code,
        item.product_name || '',
        item.production_qty || item.order_qty || 0,
        item.channels || ''
      ]);
      await service.appendSheet('생산실적', productionRows);
      
      // BOM 기반 원료 사용량 계산 요청
      // (시트에서 수식으로 자동 계산됨)
    }
    
    // 3. 결과 반환
    const totalProduced = items.reduce((sum: number, item: any) => 
      sum + (item.production_qty || item.order_qty || 0), 0);
    
    return c.json({
      success: true,
      order_date,
      production_date: prodDate,
      lot_number: lotNum,
      completed_products: items.length,
      total_quantity: totalProduced,
      message: `${items.length}개 제품 생산완료 처리됨. 구글시트에서 원료 사용량을 확인하세요.`
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 날짜별 발주 현황 (대시보드용) =====
orderUpload.get('/dashboard', async (c) => {
  try {
    // 최근 7일 발주 현황
    const recent = await c.env.DB.prepare(`
      SELECT order_date, 
             COUNT(DISTINCT product_code) as product_count,
             SUM(quantity) as total_qty,
             SUM(CASE WHEN status = '대기' THEN 1 ELSE 0 END) as pending_count,
             SUM(CASE WHEN status = '완료' THEN 1 ELSE 0 END) as completed_count
      FROM orders
      WHERE order_date >= date('now', '-7 days')
      GROUP BY order_date
      ORDER BY order_date DESC
    `).all<any>();
    
    // 오늘 대기 중인 발주
    const today = new Date().toISOString().split('T')[0];
    const todayPending = await c.env.DB.prepare(`
      SELECT channel, COUNT(*) as count, SUM(quantity) as total_qty
      FROM orders
      WHERE order_date = ? AND status = '대기'
      GROUP BY channel
    `).bind(today).all<any>();
    
    return c.json({
      success: true,
      today,
      recent_7days: recent.results || [],
      today_pending: {
        channels: todayPending.results || [],
        total_count: todayPending.results?.reduce((sum: number, item: any) => sum + item.count, 0) || 0,
        total_qty: todayPending.results?.reduce((sum: number, item: any) => sum + item.total_qty, 0) || 0
      }
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default orderUpload;
