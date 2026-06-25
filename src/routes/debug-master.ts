// 제품마스터 디버그 API
import { Hono } from 'hono';
import { GoogleSheetsService } from '../services/GoogleSheetsService';

type Bindings = {
  GOOGLE_CLIENT_EMAIL?: string;
  GOOGLE_PRIVATE_KEY?: string;
};

const debugMaster = new Hono<{ Bindings: Bindings }>();

function getSheetService(c: any): GoogleSheetsService | null {
  const clientEmail = c.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = c.env.GOOGLE_PRIVATE_KEY;
  if (!clientEmail || !privateKey) return null;
  const formattedKey = privateKey.replace(/\\n/g, '\n');
  return new GoogleSheetsService(clientEmail, formattedKey);
}

// 제품마스터 원본 데이터 조회 (디버그용)
debugMaster.get('/raw', async (c) => {
  try {
    const service = getSheetService(c);
    if (!service) {
      return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
    }
    
    // A1:J10 - 헤더 포함 처음 10행
    const data = await service.readSheet('제품마스터', 'A1:H10');
    
    return c.json({
      success: true,
      message: '제품마스터 원본 데이터 (A1:H10)',
      row_count: data.length,
      data: data.map((row, idx) => ({
        row_num: idx + 1,
        A: row[0] || '(빈값)',
        B: row[1] || '(빈값)',
        C: row[2] || '(빈값)',
        D: row[3] || '(빈값)',
        E: row[4] || '(빈값)',
        F: row[5] || '(빈값)',
        G: row[6] || '(빈값)',
        H: row[7] || '(빈값)',
        raw_length: row.length,
        raw: row
      }))
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// SKU코드로 제품 검색
debugMaster.get('/find-sku/:sku', async (c) => {
  const sku = c.req.param('sku');
  
  try {
    const service = getSheetService(c);
    if (!service) {
      return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
    }
    
    const data = await service.readSheet('제품마스터', 'A2:H');
    
    const results: any[] = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      // 모든 컬럼에서 SKU 찾기
      for (let j = 0; j < row.length; j++) {
        const cellValue = row[j]?.toString().trim() || '';
        if (cellValue.includes(sku)) {
          results.push({
            row_num: i + 2,
            found_in_column: String.fromCharCode(65 + j),  // A, B, C...
            cell_value: cellValue,
            full_row: {
              A: row[0] || '(빈값)',
              B: row[1] || '(빈값)',
              C: row[2] || '(빈값)',
              D: row[3] || '(빈값)',
              E: row[4] || '(빈값)',
              F: row[5] || '(빈값)',
              G: row[6] || '(빈값)',
              H: row[7] || '(빈값)'
            }
          });
          break;  // 같은 행에서 중복 방지
        }
      }
    }
    
    return c.json({
      success: true,
      search_sku: sku,
      found_count: results.length,
      results
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default debugMaster;

// 매칭 테스트 API - SKU코드가 실제로 등록되는지 확인
debugMaster.get('/test-matching', async (c) => {
  try {
    const service = getSheetService(c);
    if (!service) {
      return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
    }
    
    // matchProductCodesFromSheets와 동일한 로직으로 SKU코드 맵 생성
    const productMaster = await service.readSheet('제품마스터', 'A2:H');
    
    const skuCodeToProduct = new Map<string, { code: string; name: string }>();
    const registeredSkus: { sku: string; productCode: string; productName: string; rowNum: number }[] = [];
    
    for (let i = 0; i < productMaster.length; i++) {
      const row = productMaster[i];
      const productCode = row[0]?.toString().trim() || '';
      const productName = row[1]?.toString().trim() || '';
      const barcode = row[2]?.toString().trim() || '';
      
      if (!productCode && !productName) continue;
      
      const finalProductCode = productCode || productName;
      
      // SKU코드 매핑 (S 또는 A로 시작)
      if (barcode && /^[SA]\d+/.test(barcode)) {
        skuCodeToProduct.set(barcode, { code: finalProductCode, name: productName });
        registeredSkus.push({
          sku: barcode,
          productCode: finalProductCode,
          productName: productName,
          rowNum: i + 2
        });
      }
    }
    
    // 특정 SKU 검색 테스트
    const testSkus = ['S0009835', 'S0009837', 'S0006301', 'S0015619'];
    const testResults = testSkus.map(sku => ({
      sku,
      found: skuCodeToProduct.has(sku),
      product: skuCodeToProduct.get(sku) || null
    }));
    
    return c.json({
      success: true,
      total_products: productMaster.length,
      registered_sku_count: skuCodeToProduct.size,
      registered_skus: registeredSkus.slice(0, 20),  // 처음 20개만
      all_sku_keys: Array.from(skuCodeToProduct.keys()),
      test_results: testResults
    });
    
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});
