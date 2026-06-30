// Google Sheets API 연동 서비스
// v1.0.0: 구글 시트 기반 생산관리 시스템

const SHEET_ID = '1aEvc4673J0wZoPuojwgrxVu7qhkR5VuymmlKPdHpNfU';

// 서비스 계정 정보 (환경변수에서 로드)
interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

// JWT 토큰 생성을 위한 Base64 URL 인코딩
function base64UrlEncode(str: string): string {
  const base64 = btoa(str);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// JWT 헤더/페이로드 생성
async function createJWT(credentials: ServiceAccountCredentials): Promise<string> {
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  // RSA-SHA256 서명
  const privateKey = credentials.private_key;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signatureInput)
  );

  const encodedSignature = base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));
  return `${signatureInput}.${encodedSignature}`;
}

// PEM 형식을 ArrayBuffer로 변환
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// 액세스 토큰 획득
async function getAccessToken(credentials: ServiceAccountCredentials): Promise<string> {
  const jwt = await createJWT(credentials);
  
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  const data = await response.json() as { access_token: string };
  return data.access_token;
}

// ===== 시트 작업 함수들 =====

export class GoogleSheetsService {
  private credentials: ServiceAccountCredentials;
  private accessToken: string | null = null;

  constructor(clientEmail: string, privateKey: string) {
    this.credentials = { client_email: clientEmail, private_key: privateKey };
  }

  // 토큰 획득 (캐싱)
  private async getToken(): Promise<string> {
    if (!this.accessToken) {
      this.accessToken = await getAccessToken(this.credentials);
    }
    return this.accessToken;
  }

  // 시트 읽기
  async readSheet(sheetName: string, range: string = ''): Promise<any[][]> {
    const token = await this.getToken();
    const fullRange = range ? `${sheetName}!${range}` : sheetName;
    
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(fullRange)}`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    const data = await response.json() as { values?: any[][] };
    return data.values || [];
  }

  // ★★★ 수식 읽기 (valueRenderOption=FORMULA) ★★★
  async readSheetFormulas(sheetName: string, range: string = ''): Promise<any[][]> {
    const token = await this.getToken();
    const fullRange = range ? `${sheetName}!${range}` : sheetName;
    
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(fullRange)}?valueRenderOption=FORMULA`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    const data = await response.json() as { values?: any[][] };
    return data.values || [];
  }

  // 시트에 데이터 쓰기 (덮어쓰기)
  async writeSheet(sheetName: string, range: string, values: any[][]): Promise<boolean> {
    const token = await this.getToken();
    const fullRange = `${sheetName}!${range}`;

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(fullRange)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values })
      }
    );

    return response.ok;
  }

  // ★ 여러 범위 한 번에 쓰기 (batchUpdate) - 성능 최적화
  async batchWriteSheet(updates: Array<{ sheetName: string; range: string; values: any[][] }>): Promise<boolean> {
    const token = await this.getToken();
    
    const data = updates.map(u => ({
      range: `${u.sheetName}!${u.range}`,
      values: u.values
    }));

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data
        })
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('[batchWriteSheet] API 오류:', error);
    }

    return response.ok;
  }

  // 시트에 데이터 추가 (Append)
  async appendSheet(sheetName: string, values: any[][]): Promise<{ success: boolean; updates?: any; error?: string }> {
    const token = await this.getToken();

    // ★ Google Sheets API append는 범위 지정 필요 (시트명!A:Z 형태)
    const range = `${sheetName}!A:Z`;
    
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values })
      }
    );

    const result = await response.json() as any;
    
    if (!response.ok) {
      console.error('[appendSheet] API 오류:', result);
      return { success: false, error: result.error?.message || 'Unknown error' };
    }
    
    console.log('[appendSheet] 성공:', result.updates);
    return { success: true, updates: result.updates };
  }

  // 시트 생성 (없으면 생성)
  async createSheetIfNotExists(sheetName: string): Promise<boolean> {
    const token = await this.getToken();
    
    // 먼저 시트 존재 여부 확인
    const infoResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    
    if (!infoResponse.ok) return false;
    
    const info = await infoResponse.json();
    const existingSheets = info.sheets?.map((s: any) => s.properties?.title) || [];
    
    if (existingSheets.includes(sheetName)) {
      return true; // 이미 존재
    }
    
    // 시트 생성
    const createResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          requests: [{
            addSheet: {
              properties: { title: sheetName }
            }
          }]
        })
      }
    );
    
    return createResponse.ok;
  }

  // 시트 초기화 (헤더 포함)
  async initializeSheets(): Promise<{ success: boolean; message: string }> {
    try {
      const token = await this.getToken();

      // 1. 시트 목록 생성 요청
      const sheetsToCreate = [
        '원료입고',
        '발주서', 
        'BOM마스터',
        '생산실적',
        '일별수불부',
        '로트매칭',
        '출고일지',
        '제품재고',
        '제품마스터'  // ★ 바코드별 제품 정보 + 소비기한
      ];

      // 기존 시트 정보 조회
      const infoResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const sheetInfo = await infoResponse.json() as { sheets: { properties: { title: string; sheetId: number } }[] };
      const existingSheets = sheetInfo.sheets?.map((s: any) => s.properties.title) || [];

      // 새 시트 추가 요청
      const requests: any[] = [];
      for (const sheetName of sheetsToCreate) {
        if (!existingSheets.includes(sheetName)) {
          requests.push({
            addSheet: {
              properties: { title: sheetName }
            }
          });
        }
      }

      if (requests.length > 0) {
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ requests })
          }
        );
      }

      // 2. 각 시트에 헤더 설정
      const headers: Record<string, string[]> = {
        '원료입고': ['입고일자', '원료코드', '원료명', '로트번호', '입고량', '단위', '공급업체', '유통기한', '잔량'],
        '발주서': ['발주일자', '제품코드', '제품명', '주문수량', '납기일', '채널', '비고', '상태'],
        'BOM마스터': ['제품코드', '제품명', '원료코드', '원료명', '배합비(kg)', '단위'],
        '생산실적': ['생산일자', '제품코드', '제품명', '생산수량', '제품로트', '채널', '비고', '등록시간'],
        '일별수불부': ['일자', '원료코드', '원료명', '전일재고', '입고량', '사용량', '현재고', '단위'],
        '로트매칭': ['생산일자', '제품로트', '원료코드', '원료명', '사용량', '원료로트', '유통기한'],
        '제품마스터': ['제품코드', '제품명', '바코드', '발주상품명', '판매채널', '소비기한(일)', '박스수량', '등록일']
      };

      for (const [sheetName, headerRow] of Object.entries(headers)) {
        await this.writeSheet(sheetName, 'A1', [headerRow]);
      }

      return { success: true, message: `시트 초기화 완료: ${sheetsToCreate.join(', ')}` };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  // ===== ERP 연동 함수들 =====

  // 원료 입고 데이터 동기화 (ERP → 시트)
  async syncInboundData(inboundData: any[]): Promise<boolean> {
    const rows = inboundData.map(item => [
      item.inbound_date,
      item.item_code,
      item.item_name,
      item.lot_number,
      item.origin_qty,
      item.unit || 'kg',
      item.supplier || '',
      item.expiry_date || '',
      item.remain_qty
    ]);

    // 헤더 유지하고 데이터 덮어쓰기
    if (rows.length > 0) {
      await this.writeSheet('원료입고', 'A2', rows);
    }
    return true;
  }

  // 발주서 데이터 동기화 (ERP → 시트)
  async syncOrderData(orderData: any[]): Promise<boolean> {
    const rows = orderData.map(item => [
      item.order_date,
      item.product_code,
      item.product_name,
      item.quantity,
      item.delivery_date || '',
      item.channel || '',
      item.memo || '',
      item.status || '대기'
    ]);

    if (rows.length > 0) {
      await this.writeSheet('발주서', 'A2', rows);
    }
    return true;
  }

  // BOM 데이터 동기화 (ERP → 시트)
  async syncBomData(bomData: any[]): Promise<boolean> {
    const rows = bomData.map(item => [
      item.product_code,
      item.product_name,
      item.item_code,
      item.item_name,
      item.quantity,
      item.unit || 'kg'
    ]);

    if (rows.length > 0) {
      await this.writeSheet('BOM마스터', 'A2', rows);
    }
    return true;
  }

  // 생산 실적 추가 (앱 → 시트)
  async addProductionRecord(record: {
    prod_date: string;
    product_code: string;
    product_name: string;
    quantity: number;
    lot_number: string;
    channel?: string;
    memo?: string;
  }): Promise<boolean> {
    const row = [
      record.prod_date,
      record.product_code,
      record.product_name,
      record.quantity,
      record.lot_number,
      record.channel || '',
      record.memo || '',
      new Date().toISOString()
    ];

    return await this.appendSheet('생산실적', [row]);
  }

  // 생산 실적 조회 (시트 → ERP)
  // ★ 실제 생산실적 시트 구조: A:생산일, B:제품코드, C:제품명, D:수량, E:LOT번호, F:채널, G:비고, H:생성일
  async getProductionRecords(date?: string): Promise<any[]> {
    const data = await this.readSheet('생산실적', 'A2:H');
    
    const records = data.map(row => {
      // ★ 날짜 처리: 엑셀 숫자 또는 문자열 모두 지원
      let prodDate = row[0];
      if (typeof prodDate === 'number' || /^\d+$/.test(prodDate)) {
        // 엑셀 날짜 숫자를 YYYY-MM-DD로 변환
        const excelDate = parseInt(prodDate);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        prodDate = jsDate.toISOString().split('T')[0];
      } else if (typeof prodDate === 'string') {
        // 앞의 ' 제거 (문자열 강제 마커)
        prodDate = prodDate.replace(/^'/, '');
      }
      
      // ★ 실제 시트 구조에 맞춤 (단위 컬럼 없음)
      // A:생산일, B:제품코드, C:제품명, D:수량, E:LOT번호, F:채널, G:비고, H:생성일
      return {
        prod_date: prodDate,
        product_code: row[1]?.toString() || '',
        product_name: row[2]?.toString() || '',
        quantity: parseFloat(row[3]) || 0,
        lot_number: row[4]?.toString() || '',
        channel: row[5]?.toString() || '',
        memo: row[6]?.toString() || '',
        created_at: row[7]?.toString() || ''
      };
    });

    if (date) {
      return records.filter(r => r.prod_date === date);
    }
    return records;
  }

  // 일별수불부 조회 (시트에서 계산된 결과)
  async getDailyStockReport(date: string): Promise<any[]> {
    const data = await this.readSheet('일별수불부', 'A2:H');
    
    // ★ v3.5.68: 품목코드순 정렬 헬퍼 (R002 < R012 < R102 자연스러운 정렬)
    const sortByItemCode = (a: any, b: any) => {
      const aMatch = a.item_code?.match(/^([A-Z]+)(\d+)$/);
      const bMatch = b.item_code?.match(/^([A-Z]+)(\d+)$/);
      if (aMatch && bMatch) {
        if (aMatch[1] === bMatch[1]) {
          return parseInt(aMatch[2]) - parseInt(bMatch[2]);
        }
        return aMatch[1].localeCompare(bMatch[1]);
      }
      return (a.item_code || '').localeCompare(b.item_code || '');
    };
    
    // ★★★ v3.6.08: 날짜 앞 따옴표(') 제거하여 비교 ★★★
    const cleanDate = date.replace(/^'/, '');
    
    return data
      .filter(row => {
        const rowDate = row[0]?.toString().replace(/^'/, '') || '';
        return rowDate === cleanDate;
      })
      .map(row => ({
        date: row[0]?.toString().replace(/^'/, '') || '',
        item_code: row[1],
        item_name: row[2],
        prev_stock: parseFloat(row[3]) || 0,
        inbound_qty: parseFloat(row[4]) || 0,
        used_qty: parseFloat(row[5]) || 0,
        current_stock: parseFloat(row[6]) || 0,
        unit: row[7]
      }))
      .sort(sortByItemCode);  // 품목코드순 정렬
  }

  // 로트 매칭 결과 조회 (시트에서 FEFO 계산된 결과)
  // ★★★ v3.6.08: 날짜 앞 따옴표(') 제거하여 비교 ★★★
  async getLotMatching(prodDate: string, productLot: string): Promise<any[]> {
    const data = await this.readSheet('로트매칭', 'A2:G');
    const cleanProdDate = prodDate.replace(/^'/, '');
    
    return data
      .filter(row => {
        const rowDate = row[0]?.toString().replace(/^'/, '') || '';
        return rowDate === cleanProdDate && row[1] === productLot;
      })
      .map(row => ({
        prod_date: row[0]?.toString().replace(/^'/, '') || '',
        product_lot: row[1],
        item_code: row[2],
        item_name: row[3],
        used_qty: parseFloat(row[4]) || 0,
        material_lot: row[5],
        expiry_date: row[6]
      }));
  }

  // ===== v3.5.21: 고급 시트 작업 =====

  // 시트 ID 조회 (sheetId 필요한 작업용)
  async getSheetId(sheetName: string): Promise<number | null> {
    const token = await this.getToken();
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await response.json() as { sheets: { properties: { title: string; sheetId: number } }[] };
    const sheet = data.sheets?.find(s => s.properties.title === sheetName);
    return sheet?.properties.sheetId ?? null;
  }

  // batchUpdate 실행 (수식 설정, 셀 서식 등)
  async batchUpdate(requests: any[]): Promise<{ success: boolean; error?: string }> {
    const token = await this.getToken();
    
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ requests })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }
    return { success: true };
  }

  // 범위 데이터 삭제 (헤더 제외)
  async clearSheetData(sheetName: string, startRow: number = 2): Promise<boolean> {
    const token = await this.getToken();
    const range = `${sheetName}!A${startRow}:Z`;
    
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}:clear`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    
    return response.ok;
  }

  // 시트에 수식 포함 데이터 쓰기 (USER_ENTERED로 수식 해석)
  async writeWithFormulas(sheetName: string, range: string, values: any[][]): Promise<boolean> {
    const token = await this.getToken();
    const fullRange = `${sheetName}!${range}`;

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(fullRange)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values })
      }
    );

    return response.ok;
  }

  // 일별수불부 수식 설정 (v3.5.57 - 로트매칭 시트 기반으로 단순화)
  async setupDailyStockFormulas(): Promise<{ success: boolean; message: string }> {
    try {
      // 일별수불부 시트 구조:
      // A: 일자, B: 원료코드, C: 원료명, D: 전일재고, E: 입고량, F: 사용량, G: 현재고, H: 단위
      // 
      // ★ 핵심 원칙: 
      // - 입고량: 원료입고 시트에서 SUMIFS
      // - 사용량: 로트매칭 시트에서 SUMIFS (ERP가 생산등록 시 기록)
      // - 전일재고/현재고: 수식으로 자동 계산
      
      const sheetId = await this.getSheetId('일별수불부');
      if (sheetId === null) {
        return { success: false, message: '일별수불부 시트를 찾을 수 없습니다' };
      }

      // 헤더 행 설정
      const headerRow = [
        '일자', '원료코드', '원료명', 
        '전일재고', '입고량', '사용량', '현재고', '단위'
      ];
      await this.writeSheet('일별수불부', 'A1:H1', [headerRow]);

      // ★ 수식 행을 설정하지 않음 - 각 행에 개별 수식 적용 방식으로 변경
      // setupDailyStockWithFormulas() 함수에서 실제 데이터 행에 수식 적용

      return { 
        success: true, 
        message: '일별수불부 헤더 설정 완료. setupDailyStockWithFormulas()로 수식을 적용하세요.' 
      };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  // ★★★ v3.5.57: 일별수불부 수식 기반 데이터 생성 ★★★
  // 일자+원료코드 조합을 받아서 수식이 적용된 행 생성
  async setupDailyStockWithFormulas(
    date: string, 
    itemCodes: string[]
  ): Promise<{ success: boolean; message: string; rows_created: number }> {
    try {
      // 기존 해당 일자 데이터 확인 (중복 방지)
      const existingData = await this.readSheet('일별수불부', 'A2:B');
      const existingKeys = new Set(
        existingData
          .filter(row => row[0]?.toString().replace(/^'/, '') === date)
          .map(row => `${row[0]?.toString().replace(/^'/, '')}_${row[1]}`)
      );

      // 새로 추가할 원료코드만 필터링
      const newItemCodes = itemCodes.filter(code => !existingKeys.has(`${date}_${code}`));
      
      if (newItemCodes.length === 0) {
        return { 
          success: true, 
          message: `${date} 일자에 이미 모든 원료가 등록되어 있습니다.`,
          rows_created: 0
        };
      }

      // 수식이 적용된 행 생성
      const rows: any[][] = [];
      for (const itemCode of newItemCodes) {
        const rowNum = existingData.length + rows.length + 2; // 다음 행 번호
        
        rows.push([
          `'${date}`,  // A: 일자 (문자열 강제)
          itemCode,    // B: 원료코드
          // C: 원료명 - 원료입고에서 VLOOKUP
          `=IFERROR(VLOOKUP(B${rowNum},원료입고!B:C,2,FALSE),"")`,
          // D: 전일재고 - 전일 기준 원료입고 잔량 합계
          `=IFERROR(SUMIFS(원료입고!I:I,원료입고!B:B,B${rowNum},원료입고!A:A,"<"&A${rowNum}),0)`,
          // E: 입고량 - 당일 원료입고 합계
          `=IFERROR(SUMIFS(원료입고!E:E,원료입고!B:B,B${rowNum},원료입고!A:A,A${rowNum}),0)`,
          // F: 사용량 - 로트매칭 시트에서 해당 일자+원료코드 합계 ★핵심★
          `=IFERROR(SUMIFS(로트매칭!E:E,로트매칭!C:C,B${rowNum},로트매칭!A:A,A${rowNum}),0)`,
          // G: 현재고 = 전일재고 + 입고 - 사용
          `=D${rowNum}+E${rowNum}-F${rowNum}`,
          'kg'  // H: 단위
        ]);
      }

      // 일별수불부 시트에 수식 행 추가
      if (rows.length > 0) {
        await this.appendSheetWithFormulas('일별수불부', rows);
      }

      return { 
        success: true, 
        message: `${date} 일별수불부 ${rows.length}건 수식 행 생성 완료`,
        rows_created: rows.length
      };
    } catch (error: any) {
      return { success: false, message: error.message, rows_created: 0 };
    }
  }

  // 수식 포함 데이터 append (USER_ENTERED 모드)
  async appendSheetWithFormulas(sheetName: string, values: any[][]): Promise<{ success: boolean; updates?: any; error?: string }> {
    const token = await this.getToken();
    const range = `${sheetName}!A:Z`;
    
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values })
      }
    );

    const result = await response.json() as any;
    
    if (!response.ok) {
      console.error('[appendSheetWithFormulas] API 오류:', result);
      return { success: false, error: result.error?.message || 'Unknown error' };
    }
    
    return { success: true, updates: result.updates };
  }

  // ★★★ v3.5.62: 특정 범위에 수식 포함 데이터 쓰기 ★★★
  async writeSheetWithFormulas(sheetName: string, range: string, values: any[][]): Promise<{ success: boolean; updates?: any; error?: string }> {
    const token = await this.getToken();
    const fullRange = `${sheetName}!${range}`;
    
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(fullRange)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values })
      }
    );

    const result = await response.json() as any;
    
    if (!response.ok) {
      console.error('[writeSheetWithFormulas] API 오류:', result);
      return { success: false, error: result.error?.message || 'Unknown error' };
    }
    
    return { success: true, updates: result };
  }

  // ★★★ v3.5.62: 특정 범위 클리어 ★★★
  async clearRange(sheetName: string, range: string): Promise<{ success: boolean; error?: string }> {
    const token = await this.getToken();
    const fullRange = `${sheetName}!${range}`;
    
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(fullRange)}:clear`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const result = await response.json() as any;
    
    if (!response.ok) {
      console.error('[clearRange] API 오류:', result);
      return { success: false, error: result.error?.message || 'Unknown error' };
    }
    
    return { success: true };
  }

  // 로트매칭 자동화 시트 설정 (FEFO 기반)
  async setupLotMatchingFormulas(): Promise<{ success: boolean; message: string }> {
    try {
      const sheetId = await this.getSheetId('로트매칭');
      if (sheetId === null) {
        return { success: false, message: '로트매칭 시트를 찾을 수 없습니다' };
      }

      // 로트매칭 시트 구조:
      // A: 생산일자, B: 제품로트, C: 원료코드, D: 원료명, E: 사용량, F: 원료로트, G: 유통기한
      //
      // ★ FEFO 로직: 유통기한 빠른 로트부터 자동 매칭
      // ERP에서 생산실적 등록 시 → 로트매칭 시트에 자동 기록

      const headerRow = [
        '생산일자', '제품로트', '원료코드', '원료명', 
        '사용량(kg)', '원료로트(FEFO)', '유통기한'
      ];
      await this.writeSheet('로트매칭', 'A1:G1', [headerRow]);

      // 로트매칭은 ERP API(/test/calculate-usage)가 FEFO 로직으로 기록
      // 시트 수식으로는 복잡한 FEFO 구현 어려움 → API 방식 유지
      
      return { 
        success: true, 
        message: '로트매칭 헤더 설정 완료. FEFO 매칭은 생산 등록 시 자동 실행됩니다.' 
      };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  // ===== 제품마스터 관련 =====

  // 제품마스터 시트 초기화 (바코드별 1행)
  async initProductMaster(): Promise<{ success: boolean; message: string }> {
    try {
      // 시트 생성
      await this.createSheetIfNotExists('제품마스터');
      
      // 헤더 설정
      const headers = [
        '제품코드', '제품명', '바코드', '발주상품명', 
        '판매채널', '소비기한(일)', '박스수량', '등록일'
      ];
      await this.writeSheet('제품마스터', 'A1:H1', [headers]);
      
      return { success: true, message: '제품마스터 시트 초기화 완료' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  // 제품마스터 데이터 동기화 (D1 production_barcodes → 구글시트)
  async syncProductMaster(barcodeData: any[]): Promise<{ success: boolean; count: number; message?: string }> {
    try {
      // 시트가 없으면 생성
      await this.initProductMaster();
      
      // 데이터 변환 (바코드별 1행)
      const rows = barcodeData.map(item => [
        item.production_code || item.product_code || '',
        item.production_name || item.product_name || '',
        item.barcode || '',
        item.order_product_name || item.product_name || '',
        item.channel || '',
        item.expiry_days || 24,  // 기본값 24일
        item.box_quantity || 1,
        item.created_at || new Date().toISOString().split('T')[0]
      ]);

      if (rows.length > 0) {
        // 기존 데이터 삭제 후 새로 작성 (헤더 제외)
        await this.writeSheet('제품마스터', 'A2', rows);
      }
      
      return { success: true, count: rows.length };
    } catch (error: any) {
      return { success: false, count: 0, message: error.message };
    }
  }

  // 제품마스터 조회 (구글시트 → 앱)
  async getProductMaster(productCode?: string): Promise<any[]> {
    const data = await this.readSheet('제품마스터', 'A2:H');
    
    const products = data.map(row => ({
      product_code: row[0],
      product_name: row[1],
      barcode: row[2],
      order_product_name: row[3],
      channel: row[4],
      expiry_days: parseInt(row[5]) || 24,
      box_quantity: parseInt(row[6]) || 1,
      created_at: row[7]
    }));

    if (productCode) {
      return products.filter(p => p.product_code === productCode);
    }
    return products;
  }

  // 제품별 소비기한 조회 (생산일보용)
  async getProductExpiryDays(productCode: string, channel?: string): Promise<number> {
    const products = await this.getProductMaster(productCode);
    
    if (products.length === 0) {
      return 24; // 기본값
    }
    
    // 채널 일치하는 것 우선
    if (channel) {
      const matched = products.find(p => 
        p.channel && p.channel.toLowerCase().includes(channel.toLowerCase())
      );
      if (matched) return matched.expiry_days;
    }
    
    // 첫 번째 결과 반환
    return products[0].expiry_days;
  }

  // 원료별 현재고 조회 (시트 수식 기반)
  async getCurrentStock(itemCode?: string): Promise<any[]> {
    // 원료입고 시트에서 원료별 잔량 합계 계산
    const inboundData = await this.readSheet('원료입고', 'A2:I');
    
    const stockMap = new Map<string, { item_name: string; total_qty: number; lots: any[] }>();
    
    for (const row of inboundData) {
      const code = row[1];
      const remainQty = parseFloat(row[8]) || 0;
      
      if (remainQty <= 0) continue;
      if (itemCode && code !== itemCode) continue;
      
      if (!stockMap.has(code)) {
        stockMap.set(code, { item_name: row[2], total_qty: 0, lots: [] });
      }
      
      const stock = stockMap.get(code)!;
      stock.total_qty += remainQty;
      stock.lots.push({
        lot_number: row[3],
        remain_qty: remainQty,
        expiry_date: row[7],
        inbound_date: row[0]
      });
    }
    
    // FEFO 정렬 (유통기한 빠른 순)
    for (const [, stock] of stockMap) {
      stock.lots.sort((a, b) => (a.expiry_date || '9999').localeCompare(b.expiry_date || '9999'));
    }
    
    return Array.from(stockMap.entries()).map(([code, data]) => ({
      item_code: code,
      item_name: data.item_name,
      total_qty: data.total_qty,
      unit: 'kg',
      lots: data.lots
    }));
  }

  // ★ BOM(배합표) 조회 - 제품코드별 원료 목록
  // BOM마스터 시트 구조: A:제품코드, B:제품명, C:원료코드, D:원료명, E:배합비(kg), F:단위
  async getBOM(productCode: string): Promise<any[]> {
    const data = await this.readSheet('BOM마스터', 'A2:F');
    
    return data
      .filter(row => row[0] === productCode)
      .map(row => ({
        product_code: row[0],
        product_name: row[1],
        material_code: row[2],
        material_name: row[3],
        ratio_kg: parseFloat(row[4]) || 0,  // 제품 1개당 원료 사용량 (kg)
        unit: row[5] || 'kg'
      }));
  }

  // ★ 전체 BOM 조회 (캐싱용)
  async getAllBOM(): Promise<Map<string, any[]>> {
    const data = await this.readSheet('BOM마스터', 'A2:F');
    const bomMap = new Map<string, any[]>();
    
    for (const row of data) {
      const productCode = row[0]?.toString() || '';
      if (!productCode) continue;
      
      if (!bomMap.has(productCode)) {
        bomMap.set(productCode, []);
      }
      
      // ★ v3.5.70: BOM 단위 통일 - g → kg 변환
      const rawQty = parseFloat(row[4]) || 0;
      const unit = (row[5] || 'kg').toString().toLowerCase().trim();
      // g 단위면 /1000으로 kg 변환
      const ratio_kg = unit === 'g' ? rawQty / 1000 : rawQty;
      
      bomMap.get(productCode)!.push({
        product_code: row[0],
        product_name: row[1],
        material_code: row[2]?.toString() || '',
        material_name: row[3]?.toString() || '',
        ratio_kg: ratio_kg,  // 항상 kg 단위
        unit: 'kg'  // 통일
      });
    }
    
    return bomMap;
  }

  // ★ FEFO 기반 원료 LOT 자동 할당 (선입선출)
  // 필요한 원료량을 유통기한 빠른 순으로 차감
  async allocateMaterialLotsFEFO(
    materialCode: string, 
    requiredQty: number
  ): Promise<{ lot_number: string; used_qty: number; expiry_date: string }[]> {
    const inboundData = await this.readSheet('원료입고', 'A2:I');
    
    // 해당 원료의 LOT 목록 (잔량 > 0, 유통기한 빠른 순 정렬)
    const availableLots = inboundData
      .filter(row => row[1] === materialCode && (parseFloat(row[8]) || 0) > 0)
      .map(row => ({
        row_index: inboundData.indexOf(row),
        lot_number: row[3]?.toString() || '',
        remain_qty: parseFloat(row[8]) || 0,
        expiry_date: row[7]?.toString() || ''
      }))
      .sort((a, b) => (a.expiry_date || '9999').localeCompare(b.expiry_date || '9999'));
    
    const allocations: { lot_number: string; used_qty: number; expiry_date: string }[] = [];
    let remaining = requiredQty;
    
    for (const lot of availableLots) {
      if (remaining <= 0) break;
      
      const useQty = Math.min(lot.remain_qty, remaining);
      allocations.push({
        lot_number: lot.lot_number,
        used_qty: useQty,
        expiry_date: lot.expiry_date
      });
      remaining -= useQty;
    }
    
    return allocations;
  }

  // ★ 원료입고 잔량 차감 (생산 시 사용)
  async updateMaterialRemainQty(
    materialCode: string, 
    lotNumber: string, 
    usedQty: number
  ): Promise<boolean> {
    const inboundData = await this.readSheet('원료입고', 'A2:I');
    
    for (let i = 0; i < inboundData.length; i++) {
      const row = inboundData[i];
      if (row[1] === materialCode && row[3] === lotNumber) {
        const currentRemain = parseFloat(row[8]) || 0;
        const newRemain = Math.max(0, currentRemain - usedQty);
        
        // I열 (잔량) 업데이트
        await this.writeSheet('원료입고', `I${i + 2}`, [[newRemain]]);
        return true;
      }
    }
    return false;
  }

  // ★★★ v3.5.66: 중복 방지 - 생산실적 중복 체크 ★★★
  // 동일 날짜 + 제품코드 + LOT번호 조합이 이미 있으면 true
  async isProductionDuplicate(
    prodDate: string,
    productCode: string,
    lotNumber: string
  ): Promise<boolean> {
    const data = await this.readSheet('생산실적', 'A2:E');
    
    for (const row of data) {
      let rowDate = row[0]?.toString().replace(/^'/, '') || '';
      // 엑셀 시리얼 번호 변환
      if (/^\d{5}$/.test(rowDate)) {
        const excelDate = parseInt(rowDate);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        rowDate = jsDate.toISOString().split('T')[0];
      }
      
      const rowProductCode = row[1]?.toString() || '';
      const rowLotNumber = row[4]?.toString() || '';
      
      if (rowDate === prodDate && rowProductCode === productCode && rowLotNumber === lotNumber) {
        return true;  // 중복 있음
      }
    }
    return false;  // 중복 없음
  }

  // ★★★ v3.5.66: 중복 방지 - 생산실적 필터링 후 추가 ★★★
  // 중복 제거 후 새로운 행만 추가
  async appendProductionWithDedup(rows: any[][]): Promise<{ added: number; skipped: number }> {
    const existing = await this.readSheet('생산실적', 'A2:E');
    
    // 기존 키 세트 생성
    const existingKeys = new Set<string>();
    for (const row of existing) {
      let rowDate = row[0]?.toString().replace(/^'/, '') || '';
      if (/^\d{5}$/.test(rowDate)) {
        const excelDate = parseInt(rowDate);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        rowDate = jsDate.toISOString().split('T')[0];
      }
      const productCode = row[1]?.toString() || '';
      const lotNumber = row[4]?.toString() || '';
      existingKeys.add(`${rowDate}_${productCode}_${lotNumber}`);
    }
    
    // 새 행에서 중복 필터링
    const newRows: any[][] = [];
    let skipped = 0;
    
    for (const row of rows) {
      const date = row[0]?.toString().replace(/^'/, '') || '';
      const productCode = row[1]?.toString() || '';
      const lotNumber = row[4]?.toString() || '';
      const key = `${date}_${productCode}_${lotNumber}`;
      
      if (existingKeys.has(key)) {
        skipped++;
      } else {
        newRows.push(row);
        existingKeys.add(key);  // 새로 추가된 것도 중복 방지
      }
    }
    
    if (newRows.length > 0) {
      await this.appendSheet('생산실적', newRows);
    }
    
    return { added: newRows.length, skipped };
  }

  // ★★★ v3.5.66: 중복 방지 - 로트매칭 필터링 후 추가 ★★★
  async appendLotMatchingWithDedup(rows: any[][]): Promise<{ added: number; skipped: number }> {
    const existing = await this.readSheet('로트매칭', 'A2:E');
    
    // ★ v3.5.67: 소수점 2자리 반올림 헬퍼
    const roundUsage = (val: any): string => {
      const num = parseFloat(val?.toString() || '0');
      return (Math.round(num * 100) / 100).toString();
    };
    
    // 기존 키 세트 생성 (날짜_제품LOT_원료코드_사용량(반올림))
    const existingKeys = new Set<string>();
    for (const row of existing) {
      let rowDate = row[0]?.toString().replace(/^'/, '') || '';
      if (/^\d{5}$/.test(rowDate)) {
        const excelDate = parseInt(rowDate);
        const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
        rowDate = jsDate.toISOString().split('T')[0];
      }
      const productLot = row[1]?.toString() || '';
      const materialCode = row[2]?.toString() || '';
      const usage = roundUsage(row[4]);  // 소수점 2자리 반올림
      existingKeys.add(`${rowDate}_${productLot}_${materialCode}_${usage}`);
    }
    
    // 새 행에서 중복 필터링
    const newRows: any[][] = [];
    let skipped = 0;
    
    for (const row of rows) {
      const date = row[0]?.toString().replace(/^'/, '') || '';
      const productLot = row[1]?.toString() || '';
      const materialCode = row[2]?.toString() || '';
      const usage = roundUsage(row[4]);  // 소수점 2자리 반올림
      const key = `${date}_${productLot}_${materialCode}_${usage}`;
      
      if (existingKeys.has(key)) {
        skipped++;
      } else {
        newRows.push(row);
        existingKeys.add(key);
      }
    }
    
    if (newRows.length > 0) {
      await this.appendSheet('로트매칭', newRows);
    }
    
    return { added: newRows.length, skipped };
  }

  // ★ v3.5.77: LOT 매칭 재구축 (특정 날짜들)
  // ★★★ v3.5.95: 만료 LOT 정보 포함 반환 ★★★
  async rebuildLotMatchingForDates(dates: string[]): Promise<{ 
    totalRows: number; 
    dateResults: Record<string, number>;
    expiredLotsWarning?: string[];  // 만료로 건너뛴 LOT 경고 목록
  }> {
    // 1. 기존 로트매칭 데이터 읽기
    // ★★★ v3.6.11: 로트매칭 읽기 범위 확장 (10000 → 50000) ★★★
    const existingData = await this.readSheet('로트매칭', 'A2:G50000');
    
    // 2. 대상 날짜 제외한 기존 데이터 보존
    const dateSet = new Set(dates.map(d => d.replace(/^'/, '')));
    const preservedRows = existingData.filter(row => {
      const rowDate = row[0]?.toString().replace(/^'/, '') || '';
      return !dateSet.has(rowDate);
    });
    
    // 3. 원료입고 데이터 읽기 (FEFO용)
    const inboundData = await this.readSheet('원료입고', 'A2:J5000');
    const inboundByMaterial: Record<string, Array<{ lot: string; expiry: string; qty: number; remaining: number }>> = {};
    
    // ★★★ v3.5.88: 원료입고 시트 구조 매핑 수정 ★★★
    // A:입고일자, B:원료코드, C:원료명, D:로트번호, E:입고량, F:단위, G:공급업체, H:소비기한, I:잔량
    for (const row of inboundData) {
      const materialCode = row[1]?.toString() || '';  // B열: 원료코드
      const lot = row[3]?.toString() || '';           // D열: 로트번호
      const expiry = row[7]?.toString() || '';        // H열: 소비기한 (★수정: row[4]→row[7])
      const qty = parseFloat(row[4]?.toString() || '0') || 0;  // E열: 입고량 (★수정: row[5]→row[4])
      
      if (!materialCode || qty <= 0) continue;
      
      if (!inboundByMaterial[materialCode]) {
        inboundByMaterial[materialCode] = [];
      }
      inboundByMaterial[materialCode].push({ lot, expiry, qty, remaining: qty });
    }
    
    // FEFO 정렬 (소비기한 빠른 순)
    for (const code in inboundByMaterial) {
      inboundByMaterial[code].sort((a, b) => a.expiry.localeCompare(b.expiry));
    }
    
    // ★★★ v3.5.95: 소비기한 만료 LOT 필터링을 위한 기준일 ★★★
    const today = new Date().toISOString().split('T')[0];  // YYYY-MM-DD
    console.log(`[updateLotMatching] 소비기한 검증 기준일: ${today}`);
    
    // 4. 생산실적 데이터 읽기
    const productionData = await this.readSheet('생산실적', 'A2:H5000');
    
    // 5. BOM 데이터 읽기
    // ★★★ v3.5.88: 'BOM마스터' 시트명 수정 (이전 'BOM'은 잘못된 이름) ★★★
    const bomData = await this.readSheet('BOM마스터', 'A2:F2000');
    const bomMap: Record<string, Array<{ materialCode: string; materialName: string; usage: number }>> = {};
    
    // ★★★ v3.5.88: BOM마스터 시트 구조 매핑 ★★★
    // A:제품코드, B:제품명, C:원료코드, D:원료명, E:배합비(kg), F:단위
    for (const row of bomData) {
      const productCode = row[0]?.toString() || '';
      const materialCode = row[2]?.toString() || '';  // C열: 원료코드
      const materialName = row[3]?.toString() || '';  // D열: 원료명
      const usageRaw = parseFloat(row[4]?.toString() || '0') || 0;  // E열: 배합비(kg)
      // 이미 kg 단위이므로 변환 불필요
      const usage = usageRaw;
      
      if (!productCode || !materialCode) continue;
      
      if (!bomMap[productCode]) {
        bomMap[productCode] = [];
      }
      bomMap[productCode].push({ materialCode, materialName, usage });
    }
    
    // 6. 대상 날짜별 LOT 매칭 생성
    const newRows: any[][] = [];
    const dateResults: Record<string, number> = {};
    const allExpiredLotsWarnings: string[] = [];  // ★★★ v3.5.95: 만료 LOT 경고 수집 ★★★
    
    for (const targetDate of dates) {
      const cleanDate = targetDate.replace(/^'/, '');
      let dateRowCount = 0;
      
      // 해당 날짜 생산실적 필터
      const dayProduction = productionData.filter(row => {
        const prodDate = row[0]?.toString().replace(/^'/, '') || '';
        return prodDate === cleanDate;
      });
      
      for (const prod of dayProduction) {
        const productCode = prod[1]?.toString() || '';
        const productName = prod[2]?.toString() || '';
        const quantity = parseFloat(prod[3]?.toString() || '0') || 0;
        const rawLot = prod[4]?.toString() || '';
        // ★★★ v3.6.10: 제품LOT 형식 통일 (LOT번호-제품코드) ★★★
        const productLot = rawLot.includes('-') 
          ? rawLot  // 이미 제품코드 포함
          : `${rawLot}-${productCode}`;  // 제품코드 추가
        
        const bom = bomMap[productCode] || [];
        
        for (const item of bom) {
          const totalUsage = item.usage * quantity;
          if (totalUsage <= 0) continue;
          
          // ★★★ v3.5.95: FEFO + 소비기한 만료 검증 ★★★
          // 소비기한 빠른 LOT부터 차감하되, 만료된 LOT는 건너뜀
          let remainingUsage = totalUsage;
          const lots = inboundByMaterial[item.materialCode] || [];
          const skippedExpiredLots: string[] = [];  // 만료로 건너뛴 LOT 목록
          
          for (const lot of lots) {
            if (remainingUsage <= 0) break;
            if (lot.remaining <= 0) continue;
            
            // ★★★ 소비기한 만료 체크 (생산일 기준) ★★★
            const productionDateForCheck = cleanDate;  // 생산일
            if (lot.expiry && lot.expiry < productionDateForCheck) {
              // 만료된 LOT는 건너뛰기
              console.log(`[FEFO] 만료 LOT 건너뜀: ${item.materialCode} LOT:${lot.lot} 소비기한:${lot.expiry} < 생산일:${productionDateForCheck}`);
              skippedExpiredLots.push(`${lot.lot}(만료:${lot.expiry})`);
              continue;
            }
            
            const useQty = Math.min(lot.remaining, remainingUsage);
            lot.remaining -= useQty;
            remainingUsage -= useQty;
            
            // 로트매칭 행 추가
            newRows.push([
              `'${cleanDate}`,      // A: 날짜
              productLot,           // B: 제품로트
              item.materialCode,    // C: 원료코드
              item.materialName,    // D: 원료명
              Math.round(useQty * 10000) / 10000, // E: 사용량
              lot.lot,              // F: 원료로트
              lot.expiry            // G: 소비기한
            ]);
            dateRowCount++;
          }
          
          // 만료 LOT로 인한 재고 부족 경고 로깅 + 응답용 수집
          if (skippedExpiredLots.length > 0) {
            const warningMsg = `${cleanDate} ${item.materialCode}(${item.materialName}): 만료LOT ${skippedExpiredLots.length}건 제외 - ${skippedExpiredLots.join(', ')}`;
            console.warn(`[FEFO] ${warningMsg}`);
            allExpiredLotsWarnings.push(warningMsg);
          }
          
          // 재고 부족 시 로트 없이 기록
          if (remainingUsage > 0) {
            const expiredNote = skippedExpiredLots.length > 0 
              ? `재고부족(만료LOT제외)` 
              : 'N/A';
            newRows.push([
              `'${cleanDate}`,
              productLot,
              item.materialCode,
              item.materialName,
              Math.round(remainingUsage * 10000) / 10000,
              expiredNote,
              'N/A'
            ]);
            dateRowCount++;
          }
        }
      }
      
      dateResults[cleanDate] = dateRowCount;
    }
    
    // 7. 기존 데이터 + 새 데이터 합쳐서 저장
    const allRows = [...preservedRows, ...newRows];
    
    // 날짜순 정렬
    allRows.sort((a, b) => {
      const dateA = a[0]?.toString().replace(/^'/, '') || '';
      const dateB = b[0]?.toString().replace(/^'/, '') || '';
      return dateA.localeCompare(dateB);
    });
    
    // 클리어 후 다시 쓰기
    // ★★★ v3.6.11: 로트매칭 클리어 범위 확장 (10000 → 50000) ★★★
    await this.clearRange('로트매칭', 'A2:G50000');
    if (allRows.length > 0) {
      await this.writeSheet('로트매칭', 'A2', allRows);
    }
    
    // ★★★ v3.5.95: 만료 LOT 경고 포함 반환 ★★★
    return { 
      totalRows: newRows.length, 
      dateResults,
      expiredLotsWarning: allExpiredLotsWarnings.length > 0 ? allExpiredLotsWarnings : undefined
    };
  }

  // ★ v3.5.77: 일별수불부 날짜 추가 (연속성 보장)
  // ★★★ v3.6.15: APPEND 방식으로 완전 재작성 - 기존 데이터 보존 ★★★
  // 버그 수정: 전체 클리어/재작성 시 기존 날짜가 손상되는 문제 해결
  async addDailyStockDate(targetDate: string): Promise<{ date: string; prev_date: string; new_rows: number; total_rows: number }> {
    const cleanDate = targetDate.replace(/^'/, '');
    console.log(`[addDailyStockDate v3.6.21] ========== 시작: ${cleanDate} ==========`);
    
    // 1. 기존 일별수불부 데이터 읽기
    // ★★★ v3.6.21: 읽기 범위 확장 (5000 → 50000) ★★★
    const existingData = await this.readSheet('일별수불부', 'A2:H50000');
    
    // ★★★ v3.6.20: 해당 날짜 데이터가 있으면 삭제 후 재생성 ★★★
    const existingDateRows = existingData.filter(row => {
      const rowDate = row[0]?.toString().replace(/^'/, '') || '';
      return rowDate === cleanDate;
    });
    
    if (existingDateRows.length > 0) {
      console.log(`[addDailyStockDate v3.6.21] 이미 ${cleanDate} 데이터 ${existingDateRows.length}건 있음 - 삭제 후 재생성`);
      
      // 해당 날짜 제외한 데이터만 유지
      const remainingData = existingData.filter(row => {
        const rowDate = row[0]?.toString().replace(/^'/, '') || '';
        return rowDate !== cleanDate;
      });
      
      // 날짜 + 품목코드 순 정렬
      remainingData.sort((a, b) => {
        const dateA = a[0]?.toString().replace(/^'/, '') || '';
        const dateB = b[0]?.toString().replace(/^'/, '') || '';
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        const codeA = a[1]?.toString() || '';
        const codeB = b[1]?.toString() || '';
        return codeA.localeCompare(codeB);
      });
      
      // 클리어 후 남은 데이터 쓰기
      await this.clearRange('일별수불부', 'A2:H50000');
      if (remainingData.length > 0) {
        await this.writeSheet('일별수불부', 'A2', remainingData);
      }
      
      // existingData를 remainingData로 업데이트 (아래 로직에서 사용)
      existingData.length = 0;
      existingData.push(...remainingData);
      console.log(`[addDailyStockDate v3.6.21] ${cleanDate} 데이터 삭제 완료, ${remainingData.length}행 유지`);
    }
    
    // 3. 전날 날짜 계산
    const dateParts = cleanDate.split('-').map(Number);
    const prevDateObj = new Date(dateParts[0], dateParts[1] - 1, dateParts[2] - 1);
    const prevDate = prevDateObj.toISOString().split('T')[0];
    
    // 4. 전날 현재고 가져오기
    const prevDayData = existingData.filter(row => {
      const rowDate = row[0]?.toString().replace(/^'/, '') || '';
      return rowDate === prevDate;
    });
    
    const prevStockMap: Record<string, { name: string; current: number; unit: string }> = {};
    
    // ★★★ v3.6.15: 재귀 제거 - 전날 데이터 없으면 경고만 ★★★
    if (prevDayData.length === 0) {
      console.warn(`[addDailyStockDate v3.6.15] 전일(${prevDate}) 데이터 없음 - 원료마스터에서 품목 목록 가져옴`);
      
      // 전일 데이터가 없으면 원료마스터에서 품목 목록 조회
      const rawMaterialData = await this.readSheet('원료입고', 'B2:F5000');  // B:원료코드, C:원료명, F:단위
      const uniqueItems = new Map<string, { name: string; unit: string }>();
      
      for (const row of rawMaterialData) {
        const code = row[0]?.toString() || '';
        const name = row[1]?.toString() || '';
        const unit = row[4]?.toString() || 'kg';
        
        // ★★★ v3.6.17: RT(자재), SF(반제품), SM(반제품), RM184(정제수), RM1054(부자재) 제외 ★★★
        if (code && !code.startsWith('SF') && !code.startsWith('SM') && !code.startsWith('RT') && code !== 'RM184' && code !== 'RM1054') {
          if (!uniqueItems.has(code)) {
            uniqueItems.set(code, { name, unit });
          }
        }
      }
      
      // 전일재고 = 0으로 초기화
      for (const [code, info] of uniqueItems) {
        prevStockMap[code] = { name: info.name, current: 0, unit: info.unit };
      }
      console.log(`[addDailyStockDate v3.6.15] 원료마스터에서 ${uniqueItems.size}개 품목 조회`);
    } else {
      // 전일 데이터가 있는 경우 - prevStockMap 채우기
      for (const row of prevDayData) {
        const code = row[1]?.toString() || '';
        const name = row[2]?.toString() || '';
        const current = parseFloat(row[6]?.toString() || '0') || 0;
        const unit = row[7]?.toString() || 'kg';
        // ★★★ v3.6.17: RT(자재), RM1054(부자재) 제외 ★★★
        if (code.startsWith('RT') || code === 'RM1054') continue;
        prevStockMap[code] = { name, current, unit };
      }
      console.log(`[addDailyStockDate v3.6.16] 전일(${prevDate}) 데이터에서 ${Object.keys(prevStockMap).length}개 품목 조회 (RT 제외)`);
    }
    
    // 5. 당일 입고량 가져오기
    const inboundData = await this.readSheet('원료입고', 'A2:J5000');
    const inboundMap: Record<string, number> = {};
    for (const row of inboundData) {
      const inboundDate = row[0]?.toString().replace(/^'/, '') || '';
      if (inboundDate !== cleanDate) continue;
      
      const code = row[1]?.toString() || '';
      const qty = parseFloat(row[4]?.toString() || '0') || 0;
      // ★★★ v3.6.17: RT(자재), SF(반제품), SM(반제품), RM184(정제수), RM1054(부자재) 제외 ★★★
      if (code.startsWith('SF') || code.startsWith('SM') || code.startsWith('RT') || code === 'RM184' || code === 'RM1054') continue;
      
      inboundMap[code] = (inboundMap[code] || 0) + qty;
    }
    
    // ★★★ v3.6.18: 로트매칭에서 사용량 직접 계산 (수식 대신 값) ★★★
    const lotMatchingData = await this.readSheet('로트매칭', 'A2:G50000');
    const usageMap: Record<string, number> = {};
    for (const row of lotMatchingData) {
      const lotDate = row[0]?.toString().replace(/^'/, '') || '';
      if (lotDate !== cleanDate) continue;
      
      const code = row[2]?.toString() || '';  // C열: 원료코드
      const usage = parseFloat(row[4]?.toString() || '0') || 0;  // E열: 사용량
      
      // 제외 품목
      if (code.startsWith('SF') || code.startsWith('SM') || code.startsWith('RT') || code === 'RM184' || code === 'RM1054') continue;
      
      usageMap[code] = (usageMap[code] || 0) + usage;
    }
    console.log(`[addDailyStockDate v3.6.21] 로트매칭에서 ${Object.keys(usageMap).length}개 원료 사용량 계산`);
    
    // 6. 새 날짜 행 생성 - 품목코드 순 정렬
    const sortedCodes = Object.keys(prevStockMap).sort();
    const newRows: any[][] = [];
    
    for (const code of sortedCodes) {
      const { name, current: prevStock, unit } = prevStockMap[code];
      const inbound = inboundMap[code] || 0;
      const usage = usageMap[code] || 0;  // ★ 수식 대신 계산된 값
      const currentStock = Math.round((prevStock + inbound - usage) * 10000) / 10000;  // ★ 값으로 계산
      
      newRows.push([
        `'${cleanDate}`,   // A: 날짜 (문자열 강제)
        code,              // B: 품목코드
        name,              // C: 품목명
        prevStock,         // D: 전일재고
        inbound,           // E: 입고량
        usage,             // F: 사용량 (★ 값)
        currentStock,      // G: 현재고 (★ 값)
        unit               // H: 단위
      ]);
    }
    
    // ★★★ 7. APPEND 방식으로 추가 (기존 데이터 보존) ★★★
    if (newRows.length > 0) {
      await this.appendSheet('일별수불부', newRows);
      console.log(`[addDailyStockDate v3.6.21] ${newRows.length}건 APPEND 완료 (값 방식)`);
    } else {
      console.warn(`[addDailyStockDate v3.6.21] 경고: 새 행이 0건 - prevStockMap 크기: ${Object.keys(prevStockMap).length}`);
    }
    
    console.log(`[addDailyStockDate v3.6.21] ========== 완료: ${cleanDate}, 기존 ${existingData.length}행 + 신규 ${newRows.length}행 ==========`);
    
    return {
      date: cleanDate,
      prev_date: prevDate,
      new_rows: newRows.length,
      total_rows: existingData.length + newRows.length
    };
  }
}

export const GOOGLE_SHEET_ID = SHEET_ID;
