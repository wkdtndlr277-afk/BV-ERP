// 발주서 자동 업로드 API
// 엑셀(쿠팡, 컬리) / PDF(배민, 오아시스) 자동 감지 및 파싱
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

// ===== 엑셀 파싱 (간단한 CSV 형태로 변환된 데이터 처리) =====
function parseExcelData(data: string, channel: string): { product_name: string; quantity: number }[] {
  const lines = data.split('\n').filter(line => line.trim());
  const results: { product_name: string; quantity: number }[] = [];
  
  // 헤더 스킵하고 데이터 파싱
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (cols.length < 2) continue;
    
    // 채널별 컬럼 위치가 다를 수 있음
    let productName = '';
    let quantity = 0;
    
    if (channel === '쿠팡') {
      // 쿠팡: 보통 제품명, 수량 순서
      productName = cols[0]?.trim() || '';
      quantity = parseInt(cols[1]?.trim() || '0') || 0;
    } else if (channel === '컬리') {
      // 컬리: 제품명, 수량
      productName = cols[0]?.trim() || '';
      quantity = parseInt(cols[1]?.trim() || '0') || 0;
    } else {
      // 기본
      productName = cols[0]?.trim() || '';
      quantity = parseInt(cols[1]?.trim() || '0') || 0;
    }
    
    if (productName && quantity > 0) {
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
  const qtyPattern = /(\d+)\s*(개|ea|EA|박스|box)/;
  
  for (const line of lines) {
    // 제품명과 수량이 포함된 라인 찾기
    const match = line.match(qtyPattern);
    if (match) {
      const quantity = parseInt(match[1]) || 0;
      // 수량 부분 제거하고 제품명 추출
      const productName = line.replace(qtyPattern, '').trim();
      
      if (productName && quantity > 0) {
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
  
  // production_items + production_barcodes에서 매칭
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

// ===== 메인 업로드 API =====
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
                     (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv')) ? 'excel' : 
                     'unknown';
    
    if (fileType === 'unknown') {
      return c.json({ success: false, error: '지원하지 않는 파일 형식입니다 (엑셀 또는 PDF만 가능)' }, 400);
    }
    
    let parsedItems: { product_name: string; quantity: number }[] = [];
    
    if (fileType === 'excel') {
      // 엑셀 파일 처리 (텍스트로 읽기)
      const text = await file.text();
      parsedItems = parseExcelData(text, channel);
    } else if (fileType === 'pdf') {
      // PDF는 별도 OCR 처리 필요 - 일단 텍스트 추출 시도
      const arrayBuffer = await file.arrayBuffer();
      // PDF 텍스트 추출은 별도 라이브러리 필요
      // 여기서는 AI 분석 API 호출로 대체
      return c.json({ 
        success: false, 
        error: 'PDF 파일은 /upload-pdf API를 사용하세요',
        hint: 'PDF OCR 처리가 필요합니다'
      }, 400);
    }
    
    if (parsedItems.length === 0) {
      return c.json({ success: false, error: '파싱된 데이터가 없습니다. 파일 형식을 확인하세요.' }, 400);
    }
    
    // 제품코드 매칭
    const { matched, unmatched } = await matchProductCodes(c.env.DB, parsedItems);
    
    // 구글 시트에 발주서 추가
    const service = getSheetService(c);
    if (service && matched.length > 0) {
      const rows = matched.map(item => [
        orderDate,
        item.product_code,
        item.product_name,
        item.quantity,
        orderDate,  // 납기일 = 발주일
        channel,
        '',  // 비고
        '대기'  // 상태
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
        unmatched: unmatched.length
      },
      matched_items: matched,
      unmatched_items: unmatched,
      message: `${matched.length}건 발주서 등록 완료, ${unmatched.length}건 미매칭`
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== PDF 업로드 (AI OCR) =====
orderUpload.post('/upload-pdf', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File;
    const channel = (formData.get('channel') as string) || '기타';
    const orderDate = (formData.get('order_date') as string) || new Date().toISOString().split('T')[0];
    
    if (!file) {
      return c.json({ success: false, error: '파일이 없습니다' }, 400);
    }
    
    // PDF를 Base64로 변환
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    
    // PDF 내용을 텍스트로 반환 (실제로는 AI OCR 서비스 호출 필요)
    // 여기서는 사용자가 텍스트를 직접 입력하도록 안내
    return c.json({
      success: false,
      error: 'PDF OCR 기능은 준비 중입니다',
      hint: '배민/오아시스 PDF는 텍스트 복사 후 /upload-text API를 사용하세요',
      file_size: arrayBuffer.byteLength
    }, 400);
    
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
    
    // 텍스트에서 제품/수량 추출
    const parsedItems = parsePdfText(text, channel);
    
    if (parsedItems.length === 0) {
      return c.json({ success: false, error: '파싱된 데이터가 없습니다' }, 400);
    }
    
    // 제품코드 매칭
    const { matched, unmatched } = await matchProductCodes(c.env.DB, parsedItems);
    
    // 구글 시트에 발주서 추가
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
        unmatched: unmatched.length
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
    
    // 제품코드가 있으면 바로 사용, 없으면 제품명으로 매칭
    const directItems: any[] = [];
    const needMatch: { product_name: string; quantity: number }[] = [];
    
    for (const item of items) {
      if (item.product_code) {
        // 제품코드 있으면 제품명 조회
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
    
    // 제품명으로 매칭 필요한 것들
    const { matched, unmatched } = await matchProductCodes(c.env.DB, needMatch);
    const allMatched = [...directItems, ...matched];
    
    // 구글 시트에 발주서 추가
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
        unmatched: unmatched.length
      },
      registered_items: allMatched,
      unmatched_items: unmatched,
      message: `${allMatched.length}건 발주서 등록 완료`
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 기존 생산일보 데이터 → 발주서로 변환 =====
orderUpload.post('/import-from-report', async (c) => {
  try {
    const body = await c.req.json();
    const { report_date, channel } = body;
    
    if (!report_date) {
      return c.json({ success: false, error: 'report_date 필수' }, 400);
    }
    
    // production_report에서 데이터 조회
    const reportData = await c.env.DB.prepare(`
      SELECT pr.product_code, 
             COALESCE(pi.production_name, pr.product_code) as product_name,
             SUM(pr.quantity) as quantity,
             pr.channel
      FROM production_report pr
      LEFT JOIN production_items pi ON pr.product_code = pi.production_code
      WHERE pr.report_date = ?
      ${channel ? 'AND pr.channel = ?' : ''}
      GROUP BY pr.product_code, pr.channel
      ORDER BY pr.product_code
    `).bind(...(channel ? [report_date, channel] : [report_date])).all<any>();
    
    if (!reportData.results || reportData.results.length === 0) {
      return c.json({ success: false, error: '해당 날짜 생산일보 데이터가 없습니다' }, 400);
    }
    
    // 구글 시트에 발주서 추가
    const service = getSheetService(c);
    if (service) {
      const rows = reportData.results.map((item: any) => [
        report_date,
        item.product_code,
        item.product_name,
        item.quantity,
        report_date,
        item.channel || '기타',
        '생산일보에서 가져옴',
        '대기'
      ]);
      
      await service.appendSheet('발주서', rows);
    }
    
    return c.json({
      success: true,
      report_date,
      count: reportData.results.length,
      items: reportData.results,
      message: `${reportData.results.length}건 발주서 등록 완료 (생산일보에서 가져옴)`
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default orderUpload;
