// 발주서 자동 업로드 API
// 엑셀(쿠팡, 컬리) / PDF(배민, 오아시스) 자동 감지 및 파싱
// v3.5.19: Google Sheets SSOT + D1 특수문자 이스케이프 최적화
import { Hono } from 'hono';
import { GoogleSheetsService } from '../services/GoogleSheetsService';

type Bindings = {
  DB: D1Database;
  GOOGLE_CLIENT_EMAIL?: string;
  GOOGLE_PRIVATE_KEY?: string;
  GEMINI_API_KEY?: string;  // AI PDF 파싱용
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

// ★ LIKE 패턴 특수문자 이스케이프
function escapeLikePattern(str: string): string {
  // SQLite LIKE 특수문자: % _ 
  // 그리고 기타 문제가 될 수 있는 문자들 제거
  return str
    .replace(/[%_]/g, '')  // LIKE 와일드카드 제거
    .replace(/[\[\]\\]/g, '')  // 대괄호, 백슬래시 제거
    .replace(/'/g, "''")  // 작은따옴표 이스케이프
    .trim();
}

// ★ 제품명에서 검색 키워드 추출 (공백, 숫자, 특수문자 정리)
function extractSearchKeywords(productName: string): string[] {
  const cleaned = productName
    .replace(/\d+[gGmMlLkKpPeEaA개입박스]+/g, ' ')  // 용량 정보 제거
    .replace(/[^\w\sㄱ-ㅎㅏ-ㅣ가-힣]/g, ' ')  // 특수문자 제거 (한글, 영문, 숫자만 유지)
    .replace(/\s+/g, ' ')
    .trim();
  
  // 주요 키워드만 추출 (2글자 이상)
  return cleaned.split(' ').filter(w => w.length >= 2).slice(0, 3);
}

// ===== 테이블 초기화 =====
orderUpload.post('/init-table', async (c) => {
  try {
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
    
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date)`).run();
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_channel ON orders(channel)`).run();
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`).run();
    
    return c.json({ success: true, message: 'orders 테이블 생성 완료' });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 엑셀 파싱 (CSV/TSV 형태) =====
function parseExcelData(data: string, channel: string): { product_name: string; quantity: number }[] {
  const lines = data.split('\n').filter(line => line.trim());
  const results: { product_name: string; quantity: number }[] = [];
  const delimiter = data.includes('\t') ? '\t' : ',';
  
  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(delimiter);
    if (cols.length < 2) continue;
    
    let productName = cols[0]?.trim() || '';
    let quantity = 0;
    
    for (let j = 1; j < cols.length; j++) {
      const num = parseInt(cols[j]?.trim().replace(/,/g, '') || '0');
      if (num > 0) {
        quantity = num;
        break;
      }
    }
    
    if (productName && quantity > 0 && 
        !['제품', '상품', '품명', '제품명', '상품명', 'product', 'name'].includes(productName.toLowerCase())) {
      results.push({ product_name: productName, quantity });
    }
  }
  
  return results;
}

// ===== PDF/텍스트에서 제품/수량 추출 (개선된 버전) =====
// 형식: "제품명 24개" 또는 "제품명 24" 또는 "제품명\t24"
function parsePdfText(text: string, channel: string): { product_name: string; quantity: number }[] {
  const results: { product_name: string; quantity: number }[] = [];
  const lines = text.split('\n').filter(line => line.trim());
  
  console.log('[parsePdfText] 입력 라인 수:', lines.length);
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    
    console.log('[parsePdfText] 파싱:', trimmedLine);
    
    let productName = '';
    let quantity = 0;
    
    // 패턴 1: "제품명 숫자개" 또는 "제품명 숫자ea" (맨 끝에 수량+단위)
    // 예: "쿠팡카카오크런치빵(230g)40g토핑 24개"
    const endQtyPattern = /^(.+?)\s+(\d+)\s*(개|ea|EA|박스|box|팩|pack|EA|Ea)?$/;
    let match = trimmedLine.match(endQtyPattern);
    
    if (match) {
      productName = match[1].trim();
      quantity = parseInt(match[2]) || 0;
      console.log('[parsePdfText] 패턴1 매칭 - 제품명:', productName, '수량:', quantity);
    }
    
    // 패턴 2: 탭으로 구분된 형식 "제품명\t숫자"
    if (!match && trimmedLine.includes('\t')) {
      const parts = trimmedLine.split('\t');
      if (parts.length >= 2) {
        // 마지막 탭 뒤의 숫자가 수량
        const lastPart = parts[parts.length - 1].trim();
        const numMatch = lastPart.match(/^(\d+)\s*(개|ea|EA|박스|box|팩|pack)?$/);
        if (numMatch) {
          productName = parts.slice(0, -1).join(' ').trim();
          quantity = parseInt(numMatch[1]) || 0;
          console.log('[parsePdfText] 패턴2(탭) 매칭 - 제품명:', productName, '수량:', quantity);
        }
      }
    }
    
    // 패턴 3: 공백으로 구분, 맨 마지막이 숫자만
    // 예: "플틴플러스 300g 50"
    if (!productName && quantity === 0) {
      const parts = trimmedLine.split(/\s+/);
      if (parts.length >= 2) {
        const lastPart = parts[parts.length - 1];
        // 순수 숫자인지 확인 (단위 없이)
        if (/^\d+$/.test(lastPart)) {
          const potentialQty = parseInt(lastPart);
          // 합리적인 수량인지 확인 (1~9999, 그리고 230g 같은 용량이 아닌지)
          if (potentialQty >= 1 && potentialQty <= 9999) {
            // 앞 부분이 제품명으로 의미 있는지 확인
            const namePart = parts.slice(0, -1).join(' ');
            if (namePart.length > 2 && /[가-힣a-zA-Z]/.test(namePart)) {
              productName = namePart;
              quantity = potentialQty;
              console.log('[parsePdfText] 패턴3(공백) 매칭 - 제품명:', productName, '수량:', quantity);
            }
          }
        }
      }
    }
    
    // 유효한 데이터만 추가
    if (productName && productName.length > 2 && quantity > 0 && quantity <= 99999) {
      // 제품명에서 용량 정보는 유지하되, 숫자만 있는 건 제외
      if (!/^\d+$/.test(productName)) {
        results.push({ product_name: productName, quantity });
        console.log('[parsePdfText] 추가됨:', productName, quantity);
      }
    } else {
      console.log('[parsePdfText] 스킵 (유효하지 않음):', trimmedLine);
    }
  }
  
  console.log('[parsePdfText] 최종 파싱 결과:', results.length, '건');
  return results;
}

// ★ Google Sheets 제품마스터 기반 매칭 (SSOT) - SKU코드/바코드 우선 매칭
async function matchProductCodesFromSheets(
  service: GoogleSheetsService,
  items: { product_name: string; quantity: number; barcode?: string; sku_code?: string }[]
): Promise<{
  matched: { product_code: string; product_name: string; quantity: number; matched_name: string; match_type: string }[];
  unmatched: { product_name: string; quantity: number; fail_reason: string; similar_products: string[] }[];
}> {
  const matched: any[] = [];
  const unmatched: any[] = [];
  
  // 제품마스터 시트에서 전체 데이터 로드
  // ★ 실제 시트 구조 (2026년 확인):
  // A=제품코드(PR003), B=제품명, C=바코드(SKU코드), D=발주상품명, E=판매채널, F=소비기한, G=박스수량, H=등록일
  // ★ 배민 SKU코드: C컬럼에 S0015619, A21017171 등 저장됨
  let productMaster: any[][] = [];
  try {
    productMaster = await service.readSheet('제품마스터', 'A2:H');
  } catch (e) {
    console.error('제품마스터 시트 읽기 실패:', e);
    for (const item of items) {
      unmatched.push({
        product_name: item.product_name,
        quantity: item.quantity,
        fail_reason: '제품마스터 시트 읽기 실패',
        similar_products: []
      });
    }
    return { matched, unmatched };
  }
  
  console.log('[매칭] 제품마스터 로드 완료:', productMaster.length, '개 제품');
  
  // ★ 디버깅: 처음 5개 행 출력
  console.log('[매칭] 제품마스터 샘플 (처음 5개):');
  for (let i = 0; i < Math.min(5, productMaster.length); i++) {
    const row = productMaster[i];
    console.log(`  [${i}] A=${row[0]}, B=${row[1]}, C=${row[2]}, D=${row[3]}`);
  }
  
  // 매칭용 맵 생성
  const barcodeToProduct = new Map<string, { code: string; name: string }>();  // 바코드 → 제품
  const skuCodeToProduct = new Map<string, { code: string; name: string }>();  // ★ SKU코드 → 제품 (배민용)
  const orderNameToProduct = new Map<string, { code: string; name: string }>();  // 발주상품명 → 제품
  const productNameToProduct = new Map<string, { code: string; name: string }>();  // 제품명 → 제품
  const allProductNames: string[] = [];
  const allOrderNames: string[] = [];
  
  for (const row of productMaster) {
    // ★ 실제 시트 구조 (2026년 확인):
    // A=제품코드(PR003), B=제품명, C=바코드(SKU코드), D=발주상품명, E=판매채널, F=소비기한, G=박스수량, H=등록일
    const productCode = row[0]?.toString().trim() || '';       // A컬럼: 제품코드 (PR003, PR004...)
    const productName = row[1]?.toString().trim() || '';       // B컬럼: 제품명
    const barcode = row[2]?.toString().trim() || '';           // C컬럼: 바코드/SKU코드 (S0015619, A21017171...)
    const orderProductName = row[3]?.toString().trim() || '';  // D컬럼: 발주상품명
    const channel = row[4]?.toString().trim() || '';           // E컬럼: 판매채널
    
    if (!productCode && !productName) continue;
    
    const finalProductCode = productCode || productName;
    
    allProductNames.push(productName);
    
    // ★ SKU코드/바코드 매핑 (C컬럼) - 배민 SKU코드 포함
    if (barcode) {
      // SKU코드 (S 또는 A로 시작)
      if (/^[SA]\d+/.test(barcode)) {
        skuCodeToProduct.set(barcode, { code: finalProductCode, name: productName });
        console.log('[매핑] SKU코드 등록:', barcode, '→', finalProductCode, productName);
      }
      // 숫자 바코드 (8~14자리)
      if (/^\d{8,14}$/.test(barcode)) {
        barcodeToProduct.set(barcode, { code: finalProductCode, name: productName });
      }
    }
    
    // 발주상품명 매핑 - D컬럼
    if (orderProductName) {
      allOrderNames.push(orderProductName);
      orderNameToProduct.set(orderProductName.toLowerCase(), { code: finalProductCode, name: productName });
    }
    
    // 제품명 매핑 - B컬럼
    if (productName) {
      productNameToProduct.set(productName.toLowerCase(), { code: finalProductCode, name: productName });
    }
  }
  
  console.log('[매칭] 바코드 등록:', barcodeToProduct.size, '개, SKU코드 등록:', skuCodeToProduct.size, '개, 발주상품명 등록:', orderNameToProduct.size, '개');
  
  // ★ 디버깅: 등록된 SKU코드 전체 확인
  const registeredSkus = Array.from(skuCodeToProduct.keys());
  console.log('[매칭] 등록된 SKU코드 전체:', registeredSkus.length, '개');
  console.log('[매칭] SKU코드 목록:', registeredSkus.join(', '));
  
  // ★ 특정 SKU 검색 테스트
  console.log('[매칭] S0009835 등록여부:', skuCodeToProduct.has('S0009835'));
  console.log('[매칭] S0009837 등록여부:', skuCodeToProduct.has('S0009837'));
  
  // 아이템 매칭
  for (const item of items) {
    const searchName = item.product_name.toLowerCase().trim();
    let found: { code: string; name: string } | undefined;
    let matchType = '';
    
    console.log('[매칭] === 아이템 매칭 시작 ===');
    console.log('[매칭] product_name:', item.product_name);
    console.log('[매칭] sku_code:', item.sku_code);
    console.log('[매칭] searchName:', searchName);
    
    // ★ 0. SKU코드 매칭 (배민용 - 최우선)
    if (item.sku_code) {
      console.log('[매칭] SKU코드 검색 시도:', item.sku_code, ', 등록여부:', skuCodeToProduct.has(item.sku_code));
      if (skuCodeToProduct.has(item.sku_code)) {
        found = skuCodeToProduct.get(item.sku_code);
        matchType = 'SKU코드매칭(' + item.sku_code + ')';
        console.log('[매칭] SKU코드 매칭 성공:', item.sku_code, '→', found?.name);
      }
    }
    
    // ★ 1. 바코드 매칭
    if (!found && item.barcode) {
      console.log('[매칭] 바코드 검색 시도:', item.barcode, ', 등록여부:', barcodeToProduct.has(item.barcode));
      if (barcodeToProduct.has(item.barcode)) {
        found = barcodeToProduct.get(item.barcode);
        matchType = '바코드매칭(' + item.barcode + ')';
        console.log('[매칭] 바코드 매칭 성공:', item.barcode, '→', found?.code);
      }
    }
    
    // ★ 2. 발주상품명 정확 매칭
    if (!found) {
      found = orderNameToProduct.get(searchName);
      if (found) {
        matchType = '발주상품명_정확매칭';
        console.log('[매칭] 발주상품명 정확매칭 성공:', searchName);
      }
    }
    
    // ★ 3. 발주상품명 부분 매칭 (핵심 키워드 추출하여 매칭)
    if (!found) {
      // 배민 SKU명에서 브랜드+제품 핵심 키워드 추출
      // 예: "브로드카세 비엔나 쿠키 커피 100g" → "비엔나 쿠키 커피" 또는 "브로드카세"
      for (const [key, value] of orderNameToProduct) {
        // 양방향 포함 매칭
        if (key.includes(searchName) || searchName.includes(key)) {
          found = value;
          matchType = '발주상품명_부분매칭';
          console.log('[매칭] 발주상품명 부분매칭 성공:', searchName, '↔', key);
          break;
        }
      }
    }
    
    // ★ 3.5. 제품명 핵심 키워드 매칭 (용량 제거 후 매칭)
    if (!found) {
      // 용량 정보 제거: "100g", "300g", "80g" 등
      const nameWithoutSize = searchName.replace(/\s*\d+g\s*/gi, ' ').replace(/\s+/g, ' ').trim();
      console.log('[매칭] 용량 제거 후 검색:', nameWithoutSize);
      
      for (const [key, value] of orderNameToProduct) {
        const keyWithoutSize = key.replace(/\s*\d+g\s*/gi, ' ').replace(/\s+/g, ' ').trim();
        if (keyWithoutSize.includes(nameWithoutSize) || nameWithoutSize.includes(keyWithoutSize)) {
          found = value;
          matchType = '발주상품명_용량제거매칭';
          console.log('[매칭] 용량제거 매칭 성공:', nameWithoutSize, '↔', keyWithoutSize);
          break;
        }
      }
    }
    
    // 4. 제품명 정확 매칭
    if (!found) {
      found = productNameToProduct.get(searchName);
      if (found) matchType = '제품명_정확매칭';
    }
    
    // 5. 제품명 부분 매칭
    if (!found) {
      for (const [key, value] of productNameToProduct) {
        if (key.includes(searchName) || searchName.includes(key)) {
          found = value;
          matchType = '제품명_부분매칭';
          break;
        }
      }
    }
    
    // 6. 키워드 매칭 (최후 수단) - 단, 3개 이상 키워드가 모두 일치해야 함
    if (!found) {
      const keywords = extractSearchKeywords(item.product_name);
      if (keywords.length >= 2) {  // 최소 2개 키워드 필요
        for (const [key, value] of orderNameToProduct) {
          const allMatch = keywords.every(kw => key.includes(kw.toLowerCase()));
          if (allMatch) {
            found = value;
            matchType = '키워드매칭_발주상품명(' + keywords.join('+') + ')';
            break;
          }
        }
      }
    }
    
    if (found) {
      matched.push({
        product_code: found.code,
        product_name: found.name,
        quantity: item.quantity,
        matched_name: item.product_name,
        match_type: matchType
      });
    } else {
      // 유사 제품 찾기
      const keywords = extractSearchKeywords(item.product_name);
      const similarProducts: string[] = [];
      
      // 발주상품명에서 유사 제품 찾기
      for (const name of allOrderNames) {
        const nameLower = name.toLowerCase();
        if (keywords.some(kw => nameLower.includes(kw.toLowerCase()))) {
          similarProducts.push(name);
          if (similarProducts.length >= 3) break;
        }
      }
      
      // 제품명에서도 유사 제품 찾기
      if (similarProducts.length < 3) {
        for (const name of allProductNames) {
          const nameLower = name.toLowerCase();
          if (keywords.some(kw => nameLower.includes(kw.toLowerCase()))) {
            if (!similarProducts.includes(name)) {
              similarProducts.push(name);
              if (similarProducts.length >= 3) break;
            }
          }
        }
      }
      
      // 실패 사유 결정
      let failReason = '';
      if (item.barcode) {
        failReason = `바코드 미등록 (${item.barcode}) - 제품마스터에 바코드 추가 필요`;
      } else if (keywords.length === 0) {
        failReason = '검색 키워드 추출 실패';
      } else if (similarProducts.length > 0) {
        failReason = `유사 제품 있음 - 발주상품명 또는 바코드 등록 필요`;
      } else {
        failReason = `제품마스터에 미등록 (검색어: ${keywords.join(', ')})`;
      }
      
      unmatched.push({
        product_name: item.product_name,
        quantity: item.quantity,
        fail_reason: failReason,
        similar_products: similarProducts
      });
    }
  }
  
  console.log('[매칭] 완료 - 성공:', matched.length, '실패:', unmatched.length);
  return { matched, unmatched };
}

// ★ D1 기반 매칭 (폴백용, 특수문자 이스케이프 적용)
async function matchProductCodesFromD1(
  db: D1Database, 
  items: { product_name: string; quantity: number }[]
): Promise<{
  matched: { product_code: string; product_name: string; quantity: number; matched_name: string }[];
  unmatched: { product_name: string; quantity: number }[];
}> {
  const matched: any[] = [];
  const unmatched: any[] = [];
  
  for (const item of items) {
    // 검색 키워드 추출 및 이스케이프
    const keywords = extractSearchKeywords(item.product_name);
    if (keywords.length === 0) {
      unmatched.push(item);
      continue;
    }
    
    // 첫 번째 키워드로만 검색 (단순화)
    const searchTerm = escapeLikePattern(keywords[0]);
    if (searchTerm.length < 2) {
      unmatched.push(item);
      continue;
    }
    
    try {
      // production_items에서 검색
      const result = await db.prepare(`
        SELECT production_code, production_name
        FROM production_items
        WHERE production_name LIKE ? ESCAPE '\\'
        LIMIT 1
      `).bind('%' + searchTerm + '%').first<any>();
      
      if (result) {
        matched.push({
          product_code: result.production_code,
          product_name: result.production_name,
          quantity: item.quantity,
          matched_name: item.product_name
        });
      } else {
        // production_barcodes에서 검색
        const barcodeResult = await db.prepare(`
          SELECT pb.production_code, pi.production_name
          FROM production_barcodes pb
          LEFT JOIN production_items pi ON pb.production_code = pi.production_code
          WHERE pb.product_name LIKE ? ESCAPE '\\'
          LIMIT 1
        `).bind('%' + searchTerm + '%').first<any>();
        
        if (barcodeResult) {
          matched.push({
            product_code: barcodeResult.production_code,
            product_name: barcodeResult.production_name || item.product_name,
            quantity: item.quantity,
            matched_name: item.product_name
          });
        } else {
          unmatched.push(item);
        }
      }
    } catch (e) {
      console.error('D1 매칭 오류:', e);
      unmatched.push(item);
    }
  }
  
  return { matched, unmatched };
}

// ★ 통합 매칭 함수 (Google Sheets 우선, D1 폴백) - 바코드 지원
async function matchProductCodes(
  c: any,
  items: { product_name: string; quantity: number; barcode?: string }[]
): Promise<{
  matched: { product_code: string; product_name: string; quantity: number; matched_name: string }[];
  unmatched: { product_name: string; quantity: number; fail_reason?: string; similar_products?: string[] }[];
}> {
  const service = getSheetService(c);
  
  // 1. Google Sheets 제품마스터로 먼저 매칭 시도 (바코드 포함)
  if (service) {
    try {
      const sheetsResult = await matchProductCodesFromSheets(service, items);
      if (sheetsResult.matched.length > 0 || sheetsResult.unmatched.length === items.length) {
        // 시트 매칭이 작동했으면 (일부라도 매칭 OR 전부 미매칭) 결과 반환
        return sheetsResult;
      }
    } catch (e) {
      console.error('Sheets 매칭 실패, D1로 폴백:', e);
    }
  }
  
  // 2. D1로 폴백 (바코드 없이)
  const d1Items = items.map(i => ({ product_name: i.product_name, quantity: i.quantity }));
  return matchProductCodesFromD1(c.env.DB, d1Items);
}

// ===== Google Sheets에 발주 저장 =====
async function saveOrdersToSheets(
  service: GoogleSheetsService,
  orderDate: string,
  channel: string,
  items: { product_code: string; product_name: string; quantity: number }[]
): Promise<{ success: boolean; count: number }> {
  if (items.length === 0) return { success: true, count: 0 };
  
  const rows = items.map(item => [
    "'" + orderDate,
    item.product_code,
    item.product_name,
    item.quantity,
    "'" + orderDate,  // delivery_date
    channel,
    '',  // remark
    '대기'
  ]);
  
  const result = await service.appendSheet('발주서', rows);
  return { success: result.success, count: items.length };
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
                     (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv') || fileName.endsWith('.txt') || fileName.endsWith('.tsv')) ? 'excel' : 
                     'unknown';
    
    if (fileType === 'unknown') {
      return c.json({ success: false, error: '지원하지 않는 파일 형식입니다 (엑셀/CSV/TSV/TXT 또는 PDF만 가능)' }, 400);
    }
    
    if (fileType === 'pdf') {
      return c.json({ 
        success: false, 
        error: 'PDF 파일은 텍스트 복사 후 텍스트 업로드를 사용하세요',
        hint: '배민/오아시스 PDF에서 텍스트를 복사하세요'
      }, 400);
    }
    
    // 엑셀/CSV 파일 처리
    const text = await file.text();
    const parsedItems = parseExcelData(text, channel);
    
    if (parsedItems.length === 0) {
      return c.json({ success: false, error: '파싱된 데이터가 없습니다. 파일 형식을 확인하세요.' }, 400);
    }
    
    // 제품코드 매칭 (Google Sheets 우선)
    const { matched, unmatched } = await matchProductCodes(c, parsedItems);
    
    // Google Sheets에 저장 (SSOT)
    let sheetsSaved = 0;
    const service = getSheetService(c);
    if (service && matched.length > 0) {
      const saveResult = await saveOrdersToSheets(service, orderDate, channel, matched);
      sheetsSaved = saveResult.count;
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
        sheets_saved: sheetsSaved
      },
      matched_items: matched,
      unmatched_items: unmatched,
      message: matched.length + '건 발주서 등록 완료, ' + unmatched.length + '건 미매칭'
    });
    
  } catch (error: any) {
    console.error('발주서 업로드 오류:', error);
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
    
    const { matched, unmatched } = await matchProductCodes(c, parsedItems);
    
    // Google Sheets에 저장
    let sheetsSaved = 0;
    const service = getSheetService(c);
    if (service && matched.length > 0) {
      const saveResult = await saveOrdersToSheets(service, orderDate, channel, matched);
      sheetsSaved = saveResult.count;
    }
    
    return c.json({
      success: true,
      channel,
      order_date: orderDate,
      summary: {
        total_parsed: parsedItems.length,
        matched: matched.length,
        unmatched: unmatched.length,
        sheets_saved: sheetsSaved
      },
      matched_items: matched,
      unmatched_items: unmatched,
      message: matched.length + '건 발주서 등록 완료'
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
    
    const service = getSheetService(c);
    const directItems: any[] = [];
    const needMatch: { product_name: string; quantity: number; barcode?: string; sku_code?: string }[] = [];
    
    // 제품코드가 있는 항목과 매칭이 필요한 항목 분리
    for (const item of items) {
      if (item.product_code) {
        directItems.push({
          product_code: item.product_code,
          product_name: item.product_name || item.product_code,
          quantity: item.quantity
        });
      } else if (item.product_name) {
        // ★ 바코드도 함께 전달 (있는 경우)
        needMatch.push({ 
          product_name: item.product_name, 
          quantity: item.quantity,
          barcode: item.barcode || undefined,
          sku_code: item.sku_code || undefined  // ★ SKU코드 추가
        });
      }
    }
    
    // 매칭 필요한 항목 처리
    let matched: any[] = [];
    let unmatched: any[] = [];
    if (needMatch.length > 0) {
      const matchResult = await matchProductCodes(c, needMatch);
      matched = matchResult.matched;
      unmatched = matchResult.unmatched;
    }
    
    const allMatched = [...directItems, ...matched];
    
    // Google Sheets에 저장
    let sheetsSaved = 0;
    if (service && allMatched.length > 0) {
      const saveResult = await saveOrdersToSheets(service, orderDate, channel, allMatched);
      sheetsSaved = saveResult.count;
    }
    
    return c.json({
      success: true,
      channel,
      order_date: orderDate,
      summary: {
        total: items.length,
        registered: allMatched.length,
        unmatched: unmatched.length,
        sheets_saved: sheetsSaved
      },
      registered_items: allMatched,
      unmatched_items: unmatched,
      message: allMatched.length + '건 발주서 등록 완료'
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ========================================
// 발주 목록 조회 API (Google Sheets 기반)
// ========================================

// ===== 발주 목록 조회 (날짜별/채널별) =====
orderUpload.get('/list', async (c) => {
  try {
    const orderDate = c.req.query('order_date');
    const channel = c.req.query('channel');
    const status = c.req.query('status');
    
    const service = getSheetService(c);
    if (!service) {
      return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
    }
    
    // 발주서 시트에서 읽기
    const data = await service.readSheet('발주서', 'A2:H');
    
    let orders = data.map((row, idx) => ({
      id: idx + 1,
      order_date: row[0]?.toString().replace(/^'/, '') || '',
      product_code: row[1] || '',
      product_name: row[2] || '',
      quantity: parseInt(row[3]) || 0,
      delivery_date: row[4]?.toString().replace(/^'/, '') || '',
      channel: row[5] || '',
      remark: row[6] || '',
      status: row[7] || '대기'
    }));
    
    // 필터링
    if (orderDate) {
      orders = orders.filter(o => o.order_date === orderDate);
    }
    if (channel) {
      orders = orders.filter(o => o.channel === channel);
    }
    if (status) {
      orders = orders.filter(o => o.status === status);
    }
    
    return c.json({
      success: true,
      count: orders.length,
      orders
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 발주 집계 (날짜별 제품 합산) =====
orderUpload.get('/summary', async (c) => {
  try {
    const orderDate = c.req.query('order_date') || new Date().toISOString().split('T')[0];
    
    const service = getSheetService(c);
    if (!service) {
      return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
    }
    
    const data = await service.readSheet('발주서', 'A2:H');
    
    // 해당 날짜의 대기 상태만 필터
    const filtered = data.filter(row => {
      const rowDate = row[0]?.toString().replace(/^'/, '') || '';
      const rowStatus = row[7] || '대기';
      return rowDate === orderDate && rowStatus === '대기';
    });
    
    // 채널별 집계
    const byChannel: Record<string, any[]> = {};
    // 제품별 전체 합계
    const totalByProduct: Record<string, { product_code: string; product_name: string; total_qty: number; order_qty?: number; channels: Set<string> }> = {};
    
    for (const row of filtered) {
      const productCode = row[1] || '';
      const productName = row[2] || '';
      const quantity = parseInt(row[3]) || 0;
      const channel = row[5] || '기타';
      
      // 채널별
      if (!byChannel[channel]) byChannel[channel] = [];
      byChannel[channel].push({ product_code: productCode, product_name: productName, quantity });
      
      // 제품별
      if (!totalByProduct[productCode]) {
        totalByProduct[productCode] = { product_code: productCode, product_name: productName, total_qty: 0, channels: new Set() };
      }
      totalByProduct[productCode].total_qty += quantity;
      totalByProduct[productCode].channels.add(channel);
    }
    
    // 결과 포맷팅
    const channelSummary = Object.entries(byChannel).map(([ch, items]) => ({
      channel: ch,
      items: items,
      total_qty: items.reduce((sum, i) => sum + i.quantity, 0)
    }));
    
    const productSummary = Object.values(totalByProduct).map(p => ({
      ...p,
      channels: Array.from(p.channels).join(', ')
    }));
    
    return c.json({
      success: true,
      order_date: orderDate,
      by_channel: channelSummary,
      by_product: productSummary,
      total_products: productSummary.length,
      total_quantity: productSummary.reduce((sum, p) => sum + p.total_qty, 0)
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 발주 → 생산실적 변환 =====
// ★ 별칭 라우트 - 프론트엔드 호환용
orderUpload.post('/to-production', async (c) => {
  const body = await c.req.json();
  const { order_date, production_date } = body;
  const orderDate = order_date || new Date().toISOString().split('T')[0];
  const prodDate = production_date || orderDate;
  
  const service = getSheetService(c);
  if (!service) {
    return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
  }
  
  try {
    // 발주서 시트 구조: A=날짜, B=제품코드, C=제품명, D=수량, E=납품일, F=채널, G=비고, H=상태
    const data = await service.readSheet('발주서', 'A2:H');
    
    const filtered = data.filter(row => {
      const rowDate = row[0]?.toString().replace(/^'/, '') || '';
      const rowStatus = row[7] || '대기';
      return rowDate === orderDate && rowStatus === '대기';
    });
    
    if (filtered.length === 0) {
      return c.json({ 
        success: true, 
        message: '변환할 발주가 없습니다', 
        total_products: 0,
        items: []
      });
    }
    
    // 제품별 합계 및 채널 수집
    const productTotals: Record<string, { 
      product_code: string; 
      product_name: string; 
      order_qty: number;
      channels: Set<string>;
    }> = {};
    
    for (const row of filtered) {
      const productCode = row[1]?.toString() || '';
      const productName = row[2]?.toString() || '';
      const quantity = parseInt(row[3]) || 0;
      const channel = row[5]?.toString() || '';
      
      if (!productCode) continue;
      
      if (!productTotals[productCode]) {
        productTotals[productCode] = { 
          product_code: productCode, 
          product_name: productName, 
          order_qty: 0,
          channels: new Set()
        };
      }
      productTotals[productCode].order_qty += quantity;
      if (channel) {
        productTotals[productCode].channels.add(channel);
      }
    }
    
    // Set을 문자열로 변환
    const items = Object.values(productTotals).map(p => ({
      product_code: p.product_code,
      product_name: p.product_name,
      order_qty: p.order_qty,
      channels: Array.from(p.channels).join(', ')
    }));
    
    return c.json({
      success: true,
      order_date: orderDate,
      production_date: prodDate,
      total_products: items.length,
      items: items,
      message: items.length + '개 제품이 준비되었습니다'
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});


// ★ 생산 완료 등록 API (v3.5.57 - subrequest 최적화: 원료입고 1회 읽기 + 메모리 FEFO)
orderUpload.post('/complete-production', async (c) => {
  try {
    const body = await c.req.json();
    const { order_date, production_date, lot_number, items } = body;
    
    if (!production_date || !lot_number || !items || items.length === 0) {
      return c.json({ success: false, error: '생산일, LOT번호, 품목 정보가 필요합니다' }, 400);
    }
    
    const service = getSheetService(c);
    if (!service) {
      return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
    }
    
    // 생산실적 시트에 추가
    // ★ 실제 시트 구조: A:생산일, B:제품코드, C:제품명, D:수량, E:LOT번호, F:채널, G:비고, H:생성일
    const productionRows = items.map((item: any) => [
      "'" + production_date,           // A: 생산일
      item.product_code,               // B: 제품코드
      item.product_name,               // C: 제품명
      item.production_qty,             // D: 수량
      lot_number,                      // E: LOT번호
      item.channels || '',             // F: 채널
      '완료',                          // G: 비고/상태
      new Date().toISOString()         // H: 생성일
    ]);
    
    // ★★★ v3.5.66: 중복 방지 - 생산실적 추가 ★★★
    const prodResult = await service.appendProductionWithDedup(productionRows);
    console.log(`생산실적 추가: ${prodResult.added}건 추가, ${prodResult.skipped}건 중복 스킵`);
    
    // ★★★ BOM 기반 원료사용량 자동 계산 + 로트매칭 시트 저장 ★★★
    // 로트매칭 시트 구조: A:생산일, B:제품LOT, C:원료코드, D:원료명, E:사용량, F:원료LOT, G:유통기한
    const lotMatchingRows: any[][] = [];
    const materialUsageSummary: { code: string; name: string; total: number }[] = [];
    
    try {
      // ★★★ v3.5.57 최적화: 데이터를 한 번만 읽고 메모리에서 처리 ★★★
      // 기존: 원료마다 readSheet 호출 (770회) → 개선: 1회만 읽기
      
      // 1. 전체 BOM 조회 (1회)
      const bomMap = await service.getAllBOM();
      
      // 2. 원료입고 데이터 전체 조회 (1회) - ★ 핵심 최적화
      const inboundData = await service.readSheet('원료입고', 'A2:I');
      
      // 3. 원료입고 데이터를 원료코드별로 그룹화 (메모리에서 처리)
      const inboundByMaterial = new Map<string, { lot_number: string; remain_qty: number; expiry_date: string }[]>();
      for (const row of inboundData) {
        const materialCode = row[1]?.toString() || '';
        const remainQty = parseFloat(row[8]) || 0;
        if (!materialCode || remainQty <= 0) continue;
        
        if (!inboundByMaterial.has(materialCode)) {
          inboundByMaterial.set(materialCode, []);
        }
        inboundByMaterial.get(materialCode)!.push({
          lot_number: row[3]?.toString() || '',
          remain_qty: remainQty,
          expiry_date: row[7]?.toString() || ''
        });
      }
      
      // 4. 각 원료별로 유통기한순 정렬 (FEFO)
      for (const [code, lots] of inboundByMaterial) {
        lots.sort((a, b) => (a.expiry_date || '9999').localeCompare(b.expiry_date || '9999'));
      }
      
      // 5. 메모리 기반 FEFO 할당 함수
      const allocateFEFOFromCache = (
        materialCode: string, 
        requiredQty: number
      ): { lot_number: string; used_qty: number; expiry_date: string }[] => {
        const availableLots = inboundByMaterial.get(materialCode) || [];
        const allocations: { lot_number: string; used_qty: number; expiry_date: string }[] = [];
        let remaining = requiredQty;
        
        for (const lot of availableLots) {
          if (remaining <= 0) break;
          if (lot.remain_qty <= 0) continue;
          
          const useQty = Math.min(lot.remain_qty, remaining);
          allocations.push({
            lot_number: lot.lot_number,
            used_qty: useQty,
            expiry_date: lot.expiry_date
          });
          remaining -= useQty;
          // 메모리상 잔량 차감 (다음 제품에서 중복 할당 방지)
          lot.remain_qty -= useQty;
        }
        
        return allocations;
      };
      
      // 6. 제품별 원료 사용량 계산 (API 호출 없이 메모리에서 처리)
      for (const item of items) {
        const productCode = item.product_code;
        const productionQty = item.production_qty || 0;
        const bom = bomMap.get(productCode) || [];
        
        if (bom.length === 0) continue;  // BOM 없으면 스킵
        
        for (const bomItem of bom) {
          // 원료 사용량 = 배합비(kg) × 생산수량
          const usageQty = (bomItem.ratio_kg || 0) * productionQty;
          if (usageQty <= 0) continue;
          
          // ★ 메모리 기반 FEFO 할당 (API 호출 없음)
          const allocations = allocateFEFOFromCache(bomItem.material_code, usageQty);
          
          if (allocations.length > 0) {
            // LOT별로 로트매칭 행 추가
            for (const alloc of allocations) {
              lotMatchingRows.push([
                "'" + production_date,      // A: 생산일
                lot_number,                 // B: 제품LOT
                bomItem.material_code,      // C: 원료코드
                bomItem.material_name,      // D: 원료명
                alloc.used_qty,             // E: 사용량
                alloc.lot_number,           // F: 원료LOT
                alloc.expiry_date           // G: 유통기한
              ]);
            }
          } else {
            // 할당 가능한 LOT 없으면 기본 행 추가 (추적용)
            lotMatchingRows.push([
              "'" + production_date,
              lot_number,
              bomItem.material_code,
              bomItem.material_name,
              usageQty,
              '-',  // 원료LOT 미할당
              '-'
            ]);
          }
          
          // 요약용
          const existing = materialUsageSummary.find(m => m.code === bomItem.material_code);
          if (existing) {
            existing.total += usageQty;
          } else {
            materialUsageSummary.push({ 
              code: bomItem.material_code, 
              name: bomItem.material_name, 
              total: usageQty 
            });
          }
        }
      }
      
      // 7. 로트매칭 시트에 일괄 저장 (1회) - ★★★ v3.5.66: 중복 방지 ★★★
      if (lotMatchingRows.length > 0) {
        const lotResult = await service.appendLotMatchingWithDedup(lotMatchingRows);
        console.log(`로트매칭 추가: ${lotResult.added}건 추가, ${lotResult.skipped}건 중복 스킵`);
      }
      
    } catch (bomError: any) {
      console.error('BOM 기반 로트매칭 생성 오류:', bomError.message);
      // BOM 오류는 생산완료 처리를 막지 않음 (로그만)
    }
    
    // 발주서 상태 업데이트 (대기 → 생산완료)
    if (order_date) {
      const orderData = await service.readSheet('발주서', 'A2:H');
      const updates: { sheetName: string; range: string; values: any[][] }[] = [];
      
      for (let i = 0; i < orderData.length; i++) {
        const row = orderData[i];
        const rowDate = row[0]?.toString().replace(/^'/, '') || '';
        const productCode = row[1]?.toString() || '';
        const currentStatus = row[7] || '대기';
        
        if (rowDate === order_date && currentStatus === '대기') {
          const matchedItem = items.find((item: any) => item.product_code === productCode);
          if (matchedItem) {
            updates.push({ 
              sheetName: '발주서', 
              range: `H${i + 2}`, 
              values: [['생산완료']] 
            });
          }
        }
      }
      
      // ★ batchWriteSheet로 일괄 업데이트
      if (updates.length > 0) {
        await service.batchWriteSheet(updates);
      }
    }
    
    return c.json({
      success: true,
      production_date,
      lot_number,
      completed_products: items.length,
      lot_matching_rows: lotMatchingRows.length,
      material_usage: materialUsageSummary,
      message: `${items.length}개 제품 생산완료 + ${lotMatchingRows.length}건 로트매칭 등록`
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});
orderUpload.post('/convert-to-production', async (c) => {
  try {
    const body = await c.req.json();
    const { order_date, production_date } = body;
    const orderDate = order_date || new Date().toISOString().split('T')[0];
    const prodDate = production_date || orderDate;
    
    const service = getSheetService(c);
    if (!service) {
      return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
    }
    
    // 발주서에서 해당 날짜 조회
    const data = await service.readSheet('발주서', 'A2:H');
    
    const filtered = data.filter(row => {
      const rowDate = row[0]?.toString().replace(/^'/, '') || '';
      const rowStatus = row[7] || '대기';
      return rowDate === orderDate && rowStatus === '대기';
    });
    
    if (filtered.length === 0) {
      return c.json({ success: true, message: '변환할 발주가 없습니다', converted: 0 });
    }
    
    // 제품별 합계
    const productTotals: Record<string, { product_code: string; product_name: string; total_qty: number; order_qty?: number }> = {};
    
    for (const row of filtered) {
      const productCode = row[1] || '';
      const productName = row[2] || '';
      const quantity = parseInt(row[3]) || 0;
      
      if (!productTotals[productCode]) {
        productTotals[productCode] = { product_code: productCode, product_name: productName, total_qty: 0 };
      }
      productTotals[productCode].total_qty += quantity;
      productTotals[productCode].order_qty = productTotals[productCode].total_qty;
    }
    
    // 생산실적 시트에 추가
    const productionRows = Object.values(productTotals).map(p => [
      "'" + prodDate,
      p.product_code,
      p.product_name,
      p.total_qty,
      'EA',
      '',  // lot_number
      '',  // remark
      '계획'  // status
    ]);
    
    // ★ v3.5.67: 중복 방지 함수 사용
    const prodResult = await service.appendProductionWithDedup(productionRows);
    
    return c.json({
      success: true,
      order_date: orderDate,
      production_date: prodDate,
      converted: productionRows.length,
      added: prodResult.added,
      skipped: prodResult.skipped,
      items: Object.values(productTotals),
      message: `${prodResult.added}건 생산실적 등록 완료 (${prodResult.skipped}건 중복 스킵)`
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 발주 삭제 (Google Sheets 기반) =====
// POST도 지원 (axios.delete body 호환성 문제)
orderUpload.post('/delete', async (c) => {
  return handleDeleteOrders(c);
});

orderUpload.delete('/delete', async (c) => {
  return handleDeleteOrders(c);
});

async function handleDeleteOrders(c: any) {
  try {
    const body = await c.req.json();
    const { order_date, product_code, channel, row_indices, ids } = body;
    
    const service = getSheetService(c);
    if (!service) {
      return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
    }
    
    // 발주서 시트 데이터 읽기
    const data = await service.readSheet('발주서', 'A2:H');
    
    // 삭제할 행 인덱스 찾기
    const deleteIndices: number[] = [];
    
    // ids 파라미터 지원 (프론트엔드 호환) - 1-indexed를 시트 행 번호로 변환
    if (ids && Array.isArray(ids)) {
      // ids는 1부터 시작하는 인덱스 → 시트 행 번호는 +1 (헤더 때문)
      deleteIndices.push(...ids.map(id => id + 1));
    } else if (row_indices && Array.isArray(row_indices)) {
      // 직접 행 인덱스 지정
      deleteIndices.push(...row_indices);
    } else {
      // 조건으로 찾기
      data.forEach((row, idx) => {
        const rowDate = row[0]?.toString().replace(/^'/, '') || '';
        const rowProductCode = row[1] || '';
        const rowChannel = row[5] || '';
        
        let match = true;
        if (order_date && rowDate !== order_date) match = false;
        if (product_code && rowProductCode !== product_code) match = false;
        if (channel && rowChannel !== channel) match = false;
        
        if (match) {
          deleteIndices.push(idx + 2); // 헤더 제외, 1-indexed
        }
      });
    }
    
    if (deleteIndices.length === 0) {
      return c.json({ success: true, message: '삭제할 항목이 없습니다', deleted: 0 });
    }
    
    // 역순으로 정렬 (뒤에서부터 삭제해야 인덱스 안 밀림)
    deleteIndices.sort((a, b) => b - a);
    
    // 각 행 삭제 (빈 값으로 덮어쓰기 후 나중에 정리 또는 상태 변경)
    // Google Sheets API는 직접 행 삭제가 복잡하므로 상태를 '삭제'로 변경
    const batchUpdates: Array<{ sheetName: string; range: string; values: any[][] }> = [];
    
    for (const rowIdx of deleteIndices) {
      batchUpdates.push({
        sheetName: '발주서',
        range: `H${rowIdx}`,
        values: [['삭제']]
      });
    }
    
    if (batchUpdates.length > 0) {
      await service.batchWriteSheet(batchUpdates);
    }
    
    return c.json({
      success: true,
      deleted: deleteIndices.length,
      message: deleteIndices.length + '건 삭제 완료 (상태: 삭제)'
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
}

// ===== 발주 개별 삭제 (행 번호로) =====
orderUpload.delete('/delete/:rowIndex', async (c) => {
  try {
    const rowIndex = parseInt(c.req.param('rowIndex'));
    
    if (!rowIndex || rowIndex < 2) {
      return c.json({ success: false, error: '유효하지 않은 행 번호' }, 400);
    }
    
    const service = getSheetService(c);
    if (!service) {
      return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
    }
    
    // 상태를 '삭제'로 변경
    await service.writeSheet('발주서', `H${rowIndex}`, [['삭제']]);
    
    return c.json({
      success: true,
      deleted_row: rowIndex,
      message: '삭제 완료'
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ========================================
// 발주서 시트 관리 API (중복 확인, 정리)
// ========================================

// ===== 발주서 시트 분석 (중복, 삭제 상태 확인) =====
orderUpload.get('/analyze', async (c) => {
  try {
    const service = getSheetService(c);
    if (!service) {
      return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
    }
    
    const data = await service.readSheet('발주서', 'A2:H');
    
    // 통계 수집
    const stats = {
      total_rows: data.length,
      by_status: {} as Record<string, number>,
      by_date: {} as Record<string, number>,
      duplicates: [] as any[],
      deleted_rows: [] as any[]
    };
    
    // 중복 체크용 맵 (날짜+제품코드+채널 → 행 목록)
    const uniqueMap = new Map<string, number[]>();
    
    data.forEach((row, idx) => {
      const rowNum = idx + 2;  // 시트 행 번호 (헤더 제외)
      const orderDate = row[0]?.toString().replace(/^'/, '') || '';
      const productCode = row[1] || '';
      const productName = row[2] || '';
      const quantity = parseInt(row[3]) || 0;
      const channel = row[5] || '';
      const status = row[7] || '대기';
      
      // 상태별 카운트
      stats.by_status[status] = (stats.by_status[status] || 0) + 1;
      
      // 날짜별 카운트
      if (orderDate && status !== '삭제') {
        stats.by_date[orderDate] = (stats.by_date[orderDate] || 0) + 1;
      }
      
      // 삭제 상태 행 수집
      if (status === '삭제') {
        stats.deleted_rows.push({ rowNum, orderDate, productCode, productName, quantity, channel });
      }
      
      // 중복 체크 (삭제 상태 제외)
      if (status !== '삭제') {
        const key = `${orderDate}|${productCode}|${channel}`;
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, []);
        }
        uniqueMap.get(key)!.push(rowNum);
      }
    });
    
    // 중복 항목 추출
    for (const [key, rowNums] of uniqueMap) {
      if (rowNums.length > 1) {
        const [orderDate, productCode, channel] = key.split('|');
        stats.duplicates.push({
          order_date: orderDate,
          product_code: productCode,
          channel,
          count: rowNums.length,
          row_numbers: rowNums
        });
      }
    }
    
    return c.json({
      success: true,
      stats,
      summary: {
        total: stats.total_rows,
        active: stats.total_rows - (stats.by_status['삭제'] || 0),
        deleted: stats.by_status['삭제'] || 0,
        duplicate_groups: stats.duplicates.length
      }
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 삭제 상태 행 정리 (실제 삭제) =====
orderUpload.post('/cleanup', async (c) => {
  try {
    const service = getSheetService(c);
    if (!service) {
      return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
    }
    
    const data = await service.readSheet('발주서', 'A2:H');
    
    // 삭제 상태가 아닌 행만 유지
    const activeRows = data.filter(row => (row[7] || '대기') !== '삭제');
    
    if (activeRows.length === data.length) {
      return c.json({ success: true, message: '정리할 항목이 없습니다', cleaned: 0 });
    }
    
    // 시트 전체 덮어쓰기 (헤더 제외)
    // 먼저 기존 데이터 영역 클리어
    const clearRange = `A2:H${data.length + 1}`;
    await service.writeSheet('발주서', clearRange, data.map(() => ['', '', '', '', '', '', '', '']));
    
    // 활성 데이터만 다시 쓰기
    if (activeRows.length > 0) {
      await service.writeSheet('발주서', 'A2', activeRows);
    }
    
    return c.json({
      success: true,
      cleaned: data.length - activeRows.length,
      remaining: activeRows.length,
      message: `${data.length - activeRows.length}건 정리 완료`
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 중복 항목 자동 병합 =====
orderUpload.post('/merge-duplicates', async (c) => {
  try {
    let order_date: string | undefined;
    try {
      const body = await c.req.json();
      order_date = body?.order_date;
    } catch {
      // body가 없거나 JSON 파싱 실패 시 무시 (전체 중복 병합)
    }
    
    const service = getSheetService(c);
    if (!service) {
      return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
    }
    
    const data = await service.readSheet('발주서', 'A2:H');
    
    // 특정 날짜 필터 (선택사항)
    const targetData = order_date 
      ? data.filter(row => row[0]?.toString().replace(/^'/, '') === order_date && (row[7] || '대기') !== '삭제')
      : data.filter(row => (row[7] || '대기') !== '삭제');
    
    // 날짜+제품코드+채널 기준으로 그룹화
    const grouped = new Map<string, { rows: any[], indices: number[] }>();
    
    data.forEach((row, idx) => {
      const status = row[7] || '대기';
      if (status === '삭제') return;
      
      const orderDateVal = row[0]?.toString().replace(/^'/, '') || '';
      if (order_date && orderDateVal !== order_date) return;
      
      const productCode = row[1] || '';
      const channel = row[5] || '';
      const key = `${orderDateVal}|${productCode}|${channel}`;
      
      if (!grouped.has(key)) {
        grouped.set(key, { rows: [], indices: [] });
      }
      grouped.get(key)!.rows.push(row);
      grouped.get(key)!.indices.push(idx + 2);  // 시트 행 번호
    });
    
    // 중복 그룹 병합
    const batchUpdates: Array<{ sheetName: string; range: string; values: any[][] }> = [];
    let mergedCount = 0;
    
    for (const [key, group] of grouped) {
      if (group.rows.length <= 1) continue;
      
      // 수량 합산
      const totalQty = group.rows.reduce((sum, row) => sum + (parseInt(row[3]) || 0), 0);
      const firstRow = group.rows[0];
      
      // 첫 번째 행에 합산 수량 저장
      batchUpdates.push({
        sheetName: '발주서',
        range: `D${group.indices[0]}`,
        values: [[totalQty]]
      });
      
      // 나머지 행은 삭제 상태로
      for (let i = 1; i < group.indices.length; i++) {
        batchUpdates.push({
          sheetName: '발주서',
          range: `H${group.indices[i]}`,
          values: [['삭제']]
        });
        mergedCount++;
      }
    }
    
    if (batchUpdates.length > 0) {
      await service.batchWriteSheet(batchUpdates);
    }
    
    return c.json({
      success: true,
      merged_groups: grouped.size,
      deleted_duplicates: mergedCount,
      message: `${mergedCount}건 중복 병합 완료`
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 제품마스터 조회 (별칭 포함) =====
orderUpload.get('/products', async (c) => {
  try {
    const service = getSheetService(c);
    if (!service) {
      return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
    }
    
    const data = await service.readSheet('제품마스터', 'A2:J');
    
    const products = data.map((row, idx) => ({
      row_num: idx + 2,
      product_code: row[0] || '',
      product_name: row[1] || '',
      category: row[2] || '',
      unit: row[3] || '',
      spec: row[4] || '',
      shelf_life: row[5] || '',
      storage_temp: row[6] || '',
      barcode: row[7] || '',
      aliases: row[8] || '',  // 별칭 (쉼표로 구분)
      notes: row[9] || ''
    }));
    
    return c.json({
      success: true,
      count: products.length,
      products
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 제품마스터 별칭 추가 =====
orderUpload.post('/products/:productCode/alias', async (c) => {
  try {
    const productCode = c.req.param('productCode');
    const { alias } = await c.req.json();
    
    if (!alias) {
      return c.json({ success: false, error: '추가할 별칭을 입력하세요' }, 400);
    }
    
    const service = getSheetService(c);
    if (!service) {
      return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
    }
    
    // 제품 찾기
    const data = await service.readSheet('제품마스터', 'A2:J');
    let targetRowIdx = -1;
    let currentAliases = '';
    
    for (let i = 0; i < data.length; i++) {
      if (data[i][0] === productCode) {
        targetRowIdx = i + 2;  // 시트 행 번호
        currentAliases = data[i][8] || '';
        break;
      }
    }
    
    if (targetRowIdx < 0) {
      return c.json({ success: false, error: `제품코드 ${productCode}를 찾을 수 없습니다` }, 404);
    }
    
    // 기존 별칭에 추가 (중복 체크)
    const aliasSet = new Set(currentAliases.split(',').map(a => a.trim()).filter(a => a));
    const newAlias = alias.trim();
    
    if (aliasSet.has(newAlias)) {
      return c.json({ success: false, error: '이미 등록된 별칭입니다' }, 400);
    }
    
    aliasSet.add(newAlias);
    const updatedAliases = Array.from(aliasSet).join(', ');
    
    // 시트 업데이트
    await service.writeSheet('제품마스터', `I${targetRowIdx}`, [[updatedAliases]]);
    
    return c.json({
      success: true,
      product_code: productCode,
      added_alias: newAlias,
      all_aliases: updatedAliases,
      message: `별칭 '${newAlias}' 추가 완료`
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== AI 기반 PDF 파싱 (Gemini Vision) =====
// 배민 입고확인서 등 테이블 구조 PDF를 AI로 분석
orderUpload.post('/ai-parse', async (c) => {
  try {
    const apiKey = c.env.GEMINI_API_KEY;
    if (!apiKey) {
      return c.json({ 
        success: false, 
        error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다. Cloudflare Dashboard에서 설정하세요.' 
      }, 400);
    }

    // multipart/form-data로 PDF 파일 또는 base64 데이터 받기
    const contentType = c.req.header('Content-Type') || '';
    let pdfBase64: string = '';
    let fileName: string = '';
    
    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return c.json({ success: false, error: 'PDF 파일이 필요합니다' }, 400);
      }
      fileName = file.name;
      const arrayBuffer = await file.arrayBuffer();
      pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    } else if (contentType.includes('application/json')) {
      const body = await c.req.json();
      pdfBase64 = body.pdf_base64;
      fileName = body.file_name || 'document.pdf';
      if (!pdfBase64) {
        return c.json({ success: false, error: 'pdf_base64 필드가 필요합니다' }, 400);
      }
    } else {
      return c.json({ success: false, error: '지원하지 않는 Content-Type' }, 400);
    }

    console.log('[AI파싱] 파일명:', fileName, ', Base64 길이:', pdfBase64.length);

    // Gemini API 호출 (gemini-2.0-flash 모델 사용)
    const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    
    const prompt = `이 PDF는 배달의민족(배민) 입고확인서입니다.
테이블에서 다음 정보를 추출하세요:
1. 바코드 (13자리 숫자, 880942453으로 시작)
2. 상품명 (한글 제품명)
3. 입고수량 (박스/낱개 중 "낱개" 컬럼의 숫자가 실제 입고수량)

주의사항:
- 바코드가 두 줄로 나뉘어 있을 수 있음 (예: 8809424537 / 176 → 8809424537176)
- "박스입수량", "박스", "낱개" 컬럼 중 "낱개" 컬럼 값이 실제 입고수량
- 페이지 번호(1/2, 2/2 등)는 무시
- 동일 바코드가 여러 번 나오면 수량 합산

JSON 배열 형식으로만 응답하세요 (다른 텍스트 없이):
[{"barcode": "8809424537176", "product_name": "제품명", "quantity": 20}, ...]`;

    const geminiResponse = await fetch(geminiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: 'application/pdf',
                data: pdfBase64
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096
        }
      })
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('[AI파싱] Gemini API 오류:', errorText);
      return c.json({ 
        success: false, 
        error: `Gemini API 오류: ${geminiResponse.status}`,
        detail: errorText 
      }, 500);
    }

    const geminiResult = await geminiResponse.json() as any;
    console.log('[AI파싱] Gemini 응답 수신');

    // 응답에서 텍스트 추출
    const responseText = geminiResult?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('[AI파싱] 응답 텍스트:', responseText.substring(0, 500));

    // JSON 배열 파싱 (```json ... ``` 감싸기 처리)
    let items: { barcode: string; product_name: string; quantity: number }[] = [];
    try {
      // JSON 블록 추출
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        items = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error('[AI파싱] JSON 파싱 실패:', parseError);
      return c.json({ 
        success: false, 
        error: 'AI 응답을 파싱할 수 없습니다',
        raw_response: responseText.substring(0, 1000)
      }, 500);
    }

    // 유효성 검증 및 정제
    const validItems = items.filter(item => 
      item.barcode && 
      /^\d{12,14}$/.test(item.barcode) &&
      item.quantity > 0
    ).map(item => ({
      barcode: item.barcode.trim(),
      product_name: (item.product_name || item.barcode).trim(),
      quantity: parseInt(String(item.quantity)) || 1
    }));

    // 중복 바코드 합산
    const merged = new Map<string, { barcode: string; product_name: string; quantity: number }>();
    for (const item of validItems) {
      if (merged.has(item.barcode)) {
        merged.get(item.barcode)!.quantity += item.quantity;
      } else {
        merged.set(item.barcode, { ...item });
      }
    }

    const result = Array.from(merged.values());
    console.log('[AI파싱] 최종 결과:', result.length, '건');

    return c.json({
      success: true,
      items: result,
      count: result.length,
      message: `AI 분석 완료: ${result.length}건 추출`
    });

  } catch (error: any) {
    console.error('[AI파싱] 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== AI 파싱 후 제품 매칭 =====
// AI로 추출한 바코드/수량을 제품마스터와 매칭
orderUpload.post('/ai-match', async (c) => {
  try {
    const { items } = await c.req.json() as { 
      items: { barcode: string; product_name: string; quantity: number }[] 
    };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return c.json({ success: false, error: '매칭할 아이템이 없습니다' }, 400);
    }

    const service = getSheetService(c);
    if (!service) {
      return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
    }

    // 바코드 필드를 갖도록 변환
    const itemsWithBarcode = items.map(item => ({
      product_name: item.product_name || item.barcode,
      quantity: item.quantity,
      barcode: item.barcode
    }));

    // 기존 매칭 함수 사용
    const { matched, unmatched } = await matchProductCodesFromSheets(service, itemsWithBarcode);

    return c.json({
      success: true,
      matched,
      unmatched,
      summary: {
        total: items.length,
        matched: matched.length,
        unmatched: unmatched.length
      }
    });

  } catch (error: any) {
    console.error('[AI매칭] 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★ v3.5.78: 오아시스 발주서 파싱 (HTML 형식 .xls 파일)
// 바코드, 제품명, 수량 추출 → 생산등록/일별수불부 연동
orderUpload.post('/parse-oasis', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File;
    const orderDate = (formData.get('order_date') as string) || new Date().toISOString().split('T')[0];
    const deliveryDate = (formData.get('delivery_date') as string) || '';
    
    if (!file) {
      return c.json({ success: false, error: '파일이 없습니다' }, 400);
    }
    
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.xls') && !fileName.endsWith('.xlsx')) {
      return c.json({ success: false, error: '오아시스 발주서는 .xls 또는 .xlsx 파일만 지원합니다' }, 400);
    }
    
    // 파일 내용 읽기
    const arrayBuffer = await file.arrayBuffer();
    const content = new TextDecoder('euc-kr').decode(arrayBuffer);
    
    // HTML 테이블 파싱
    const items = parseOasisHtmlTable(content);
    
    if (items.length === 0) {
      // UTF-8로 다시 시도
      const contentUtf8 = new TextDecoder('utf-8').decode(arrayBuffer);
      const itemsUtf8 = parseOasisHtmlTable(contentUtf8);
      if (itemsUtf8.length === 0) {
        return c.json({ 
          success: false, 
          error: '오아시스 발주서를 파싱할 수 없습니다. 파일 형식을 확인하세요.',
          hint: '오아시스에서 다운로드한 .xls 파일을 업로드하세요'
        }, 400);
      }
      items.push(...itemsUtf8);
    }
    
    // 바코드별 합계 (같은 바코드는 수량 합산)
    const barcodeMap = new Map<string, { barcode: string; product_name: string; quantity: number }>();
    for (const item of items) {
      const existing = barcodeMap.get(item.barcode);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        barcodeMap.set(item.barcode, { ...item });
      }
    }
    const aggregatedItems = Array.from(barcodeMap.values());
    
    // 입고예정일 추출 (첫 번째 아이템의 delivery_date)
    const extractedDeliveryDate = items[0]?.delivery_date || deliveryDate;
    
    // 제품마스터와 매칭 (바코드 기준)
    const service = getSheetService(c);
    let matched: any[] = [];
    let unmatched: any[] = [];
    
    if (service) {
      const matchResult = await matchOasisBarcodesFromSheets(service, aggregatedItems);
      matched = matchResult.matched;
      unmatched = matchResult.unmatched;
    } else {
      // 시트 서비스 없으면 모두 미매칭
      unmatched = aggregatedItems.map(item => ({
        barcode: item.barcode,
        product_name: item.product_name,
        quantity: item.quantity,
        fail_reason: 'Google Sheets 연결 실패'
      }));
    }
    
    return c.json({
      success: true,
      channel: '오아시스',
      order_date: orderDate,
      delivery_date: extractedDeliveryDate,
      summary: {
        total_rows: items.length,
        unique_products: aggregatedItems.length,
        total_quantity: aggregatedItems.reduce((sum, item) => sum + item.quantity, 0),
        matched: matched.length,
        unmatched: unmatched.length
      },
      matched_items: matched,
      unmatched_items: unmatched,
      message: `오아시스 발주서 파싱 완료: ${matched.length}건 매칭, ${unmatched.length}건 미매칭`
    });
    
  } catch (error: any) {
    console.error('[오아시스 파싱] 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★ 오아시스 HTML 테이블 파싱 함수
function parseOasisHtmlTable(html: string): { barcode: string; product_name: string; quantity: number; delivery_date: string }[] {
  const results: { barcode: string; product_name: string; quantity: number; delivery_date: string }[] = [];
  
  // <tr> 태그로 행 추출
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  
  let rowMatch;
  let isHeader = true;
  let headerMap: Record<string, number> = {};
  
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowContent = rowMatch[1];
    const cells: string[] = [];
    
    let cellMatch;
    const cellRegexLocal = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    while ((cellMatch = cellRegexLocal.exec(rowContent)) !== null) {
      // HTML 태그 제거하고 텍스트만 추출
      const cellText = cellMatch[1]
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
      cells.push(cellText);
    }
    
    if (cells.length === 0) continue;
    
    // 첫 번째 유효한 행을 헤더로 인식
    if (isHeader && cells.some(c => c.includes('바코드') || c.includes('상품코드') || c.includes('No'))) {
      // 헤더 매핑
      cells.forEach((cell, idx) => {
        if (cell.includes('바코드')) headerMap['barcode'] = idx;
        if (cell.includes('상 품 명') || cell.includes('상품명')) headerMap['product_name'] = idx;
        if (cell.includes('출고수량') || cell.includes('수량')) headerMap['quantity'] = idx;
        if (cell.includes('입고예정') || cell.includes('납품일')) headerMap['delivery_date'] = idx;
      });
      isHeader = false;
      continue;
    }
    
    // 소계/분류소계 행 건너뛰기
    if (cells[0]?.includes('소 계') || cells[0]?.includes('분 류')) continue;
    
    // No 컬럼이 숫자인 행만 처리 (실제 데이터 행)
    const firstCell = cells[0] || '';
    if (!/^\d+$/.test(firstCell)) continue;
    
    // 기본 인덱스 (오아시스 표준 형식)
    // 0:No, 1:주문구분, 2:매입처, 3:분류명, 4:상품코드, 5:상품명, 6:매장코드, 7:매장명, 8:입고예정, 9:출고수량, 10:단위, 11:출고금액, 12:바코드, 13:주문일자, 14:전표번호
    const barcodeIdx = headerMap['barcode'] ?? 12;
    const productNameIdx = headerMap['product_name'] ?? 5;
    const quantityIdx = headerMap['quantity'] ?? 9;
    const deliveryDateIdx = headerMap['delivery_date'] ?? 8;
    
    const barcode = cells[barcodeIdx]?.trim() || '';
    let productName = cells[productNameIdx]?.trim() || '';
    const quantityStr = cells[quantityIdx]?.trim() || '0';
    const deliveryDate = cells[deliveryDateIdx]?.trim() || '';
    
    // 제품명 앞의 + 기호 제거
    productName = productName.replace(/^\+/, '').trim();
    
    // 수량 파싱
    const quantity = parseInt(quantityStr.replace(/,/g, '')) || 0;
    
    // 유효한 데이터만 추가
    if (barcode && productName && quantity > 0) {
      results.push({ barcode, product_name: productName, quantity, delivery_date: deliveryDate });
    }
  }
  
  return results;
}

// ★ 오아시스 바코드 매칭 (제품마스터 시트 기준)
async function matchOasisBarcodesFromSheets(
  service: GoogleSheetsService,
  items: { barcode: string; product_name: string; quantity: number }[]
): Promise<{
  matched: { product_code: string; product_name: string; barcode: string; quantity: number; matched_name: string }[];
  unmatched: { barcode: string; product_name: string; quantity: number; fail_reason: string }[];
}> {
  const matched: any[] = [];
  const unmatched: any[] = [];
  
  // 제품마스터 시트에서 바코드 매핑 로드
  // 구조: A=제품코드, B=제품명, C=바코드/SKU코드, D=발주상품명, E=판매채널, F=소비기한, G=박스수량, H=등록일
  let productMaster: any[][] = [];
  try {
    productMaster = await service.readSheet('제품마스터', 'A2:H');
  } catch (e) {
    console.error('[오아시스 매칭] 제품마스터 읽기 실패:', e);
    return {
      matched: [],
      unmatched: items.map(item => ({
        barcode: item.barcode,
        product_name: item.product_name,
        quantity: item.quantity,
        fail_reason: '제품마스터 시트 읽기 실패'
      }))
    };
  }
  
  // 바코드 → 제품 매핑 생성
  const barcodeToProduct = new Map<string, { code: string; name: string }>();
  for (const row of productMaster) {
    const productCode = row[0]?.toString().trim() || '';
    const productName = row[1]?.toString().trim() || '';
    const barcode = row[2]?.toString().trim() || '';
    
    if (barcode && productCode) {
      barcodeToProduct.set(barcode, { code: productCode, name: productName });
    }
  }
  
  console.log('[오아시스 매칭] 바코드 등록 수:', barcodeToProduct.size);
  
  // 매칭 수행
  for (const item of items) {
    const product = barcodeToProduct.get(item.barcode);
    
    if (product) {
      matched.push({
        product_code: product.code,
        product_name: product.name,
        barcode: item.barcode,
        quantity: item.quantity,
        matched_name: item.product_name,
        channel: '오아시스'
      });
    } else {
      unmatched.push({
        barcode: item.barcode,
        product_name: item.product_name,
        quantity: item.quantity,
        fail_reason: '바코드 미등록'
      });
    }
  }
  
  return { matched, unmatched };
}

// ★ v3.5.78: 오아시스 발주 등록 (파싱 후 발주서 시트 저장 + 생산등록 연동)
orderUpload.post('/register-oasis', async (c) => {
  try {
    const body = await c.req.json();
    const { items, order_date, delivery_date } = body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return c.json({ success: false, error: 'items 배열이 필요합니다' }, 400);
    }
    
    const orderDate = order_date || new Date().toISOString().split('T')[0];
    const channel = '오아시스';
    
    const service = getSheetService(c);
    if (!service) {
      return c.json({ success: false, error: 'Google Sheets 연결 실패' }, 500);
    }
    
    // 1. 발주서 시트에 저장
    // 구조: A=날짜, B=제품코드, C=제품명, D=수량, E=납품일, F=채널, G=비고, H=상태
    const orderRows = items.map((item: any) => [
      `'${orderDate}`,           // A: 발주일
      item.product_code,          // B: 제품코드
      item.product_name,          // C: 제품명
      item.quantity,              // D: 수량
      delivery_date || '',        // E: 납품일
      channel,                    // F: 채널 (오아시스)
      `바코드:${item.barcode}`,   // G: 비고 (원본 바코드)
      '대기'                      // H: 상태
    ]);
    
    await service.appendSheet('발주서', orderRows);
    
    return c.json({
      success: true,
      channel,
      order_date: orderDate,
      delivery_date,
      registered_count: items.length,
      total_quantity: items.reduce((sum: number, item: any) => sum + item.quantity, 0),
      message: `오아시스 발주 ${items.length}건 등록 완료`,
      next_step: '발주목록에서 생산시작 → 생산완료 진행하면 LOT매칭 및 일별수불부가 자동 갱신됩니다.'
    });
    
  } catch (error: any) {
    console.error('[오아시스 등록] 오류:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default orderUpload;
