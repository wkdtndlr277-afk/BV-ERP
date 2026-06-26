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
    
    return data
      .filter(row => row[0] === date)
      .map(row => ({
        date: row[0],
        item_code: row[1],
        item_name: row[2],
        prev_stock: parseFloat(row[3]) || 0,
        inbound_qty: parseFloat(row[4]) || 0,
        used_qty: parseFloat(row[5]) || 0,
        current_stock: parseFloat(row[6]) || 0,
        unit: row[7]
      }));
  }

  // 로트 매칭 결과 조회 (시트에서 FEFO 계산된 결과)
  async getLotMatching(prodDate: string, productLot: string): Promise<any[]> {
    const data = await this.readSheet('로트매칭', 'A2:G');
    
    return data
      .filter(row => row[0] === prodDate && row[1] === productLot)
      .map(row => ({
        prod_date: row[0],
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
      
      bomMap.get(productCode)!.push({
        product_code: row[0],
        product_name: row[1],
        material_code: row[2]?.toString() || '',
        material_name: row[3]?.toString() || '',
        ratio_kg: parseFloat(row[4]) || 0,
        unit: row[5] || 'kg'
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
}

export const GOOGLE_SHEET_ID = SHEET_ID;
