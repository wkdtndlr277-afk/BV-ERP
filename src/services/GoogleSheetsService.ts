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

  // 시트에 데이터 추가 (Append)
  async appendSheet(sheetName: string, values: any[][]): Promise<boolean> {
    const token = await this.getToken();

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values })
      }
    );

    return response.ok;
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
        '로트매칭'
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
        '로트매칭': ['생산일자', '제품로트', '원료코드', '원료명', '사용량', '원료로트', '유통기한']
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
  async getProductionRecords(date?: string): Promise<any[]> {
    const data = await this.readSheet('생산실적', 'A2:H');
    
    const records = data.map(row => ({
      prod_date: row[0],
      product_code: row[1],
      product_name: row[2],
      quantity: parseFloat(row[3]) || 0,
      lot_number: row[4],
      channel: row[5],
      memo: row[6],
      created_at: row[7]
    }));

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
}

export const GOOGLE_SHEET_ID = SHEET_ID;
