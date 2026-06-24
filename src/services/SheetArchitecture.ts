/**
 * 🏗️ 시트 아키텍처 v2.0 - 3단계 레이어 설계
 * 
 * [입력 단계] Input Layer
 * - 원료입고_RAW: ERP에서 입력되는 원시 데이터
 * - 생산실적_RAW: ERP에서 입력되는 원시 데이터
 * - 무결성 검증 후 마스터로 이동
 * 
 * [연산 단계] Processing Layer (SSOT)
 * - 재고마스터: 단일 진실 소스 - 모든 재고 계산의 중심
 * - BOM마스터: 제품별 원료 배합비
 * - 로트매칭: FEFO 자동 계산 (Google Apps Script)
 * 
 * [출력 단계] Output Layer
 * - 일별수불부_출력: LOOKUP 기반 정리된 출력
 * - 생산일보_출력: PDF 생성용 포맷팅된 시트
 */

// 시트 이름 상수
export const SHEET_NAMES = {
  // 입력 레이어 (RAW)
  INPUT_INBOUND: '원료입고_RAW',
  INPUT_PRODUCTION: '생산실적_RAW',
  
  // 연산 레이어 (SSOT)
  MASTER_INVENTORY: '재고마스터',
  MASTER_BOM: 'BOM마스터',
  MASTER_LOT_MATCHING: '로트매칭',
  
  // 출력 레이어
  OUTPUT_DAILY_STOCK: '일별수불부_출력',
  OUTPUT_PRODUCTION_REPORT: '생산일보_출력'
} as const;

// 데이터 유효성 검증
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitizedData?: any;
}

// 입력 데이터 검증 함수들
export function validateDate(dateStr: string): ValidationResult {
  const errors: string[] = [];
  
  // YYYY-MM-DD 형식 검증
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) {
    errors.push(`잘못된 날짜 형식: ${dateStr} (YYYY-MM-DD 필요)`);
    return { valid: false, errors };
  }
  
  // 유효한 날짜인지 검증
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    errors.push(`유효하지 않은 날짜: ${dateStr}`);
    return { valid: false, errors };
  }
  
  // 미래 날짜 검증 (30일 이후는 경고)
  const today = new Date();
  const diffDays = (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays > 30) {
    errors.push(`경고: 30일 이상 미래 날짜입니다 (${dateStr})`);
  }
  
  return { valid: errors.length === 0, errors, sanitizedData: dateStr };
}

export function validateQuantity(qty: any): ValidationResult {
  const errors: string[] = [];
  
  // 숫자 변환
  const num = parseFloat(qty);
  if (isNaN(num)) {
    errors.push(`숫자가 아닌 수량: ${qty}`);
    return { valid: false, errors };
  }
  
  // 음수 검증
  if (num < 0) {
    errors.push(`음수 수량 불가: ${num}`);
    return { valid: false, errors };
  }
  
  // 비정상적으로 큰 수량 검증
  if (num > 100000) {
    errors.push(`경고: 비정상적으로 큰 수량 (${num})`);
  }
  
  return { valid: true, errors, sanitizedData: num };
}

export function validateItemCode(code: string): ValidationResult {
  const errors: string[] = [];
  
  if (!code || code.trim() === '') {
    errors.push('품목코드가 비어있습니다');
    return { valid: false, errors };
  }
  
  // 품목코드 형식 검증 (R, RM, PR, SM, SF 시작)
  const validPrefixes = ['R', 'RM', 'PR', 'SM', 'SF', 'PD'];
  const hasValidPrefix = validPrefixes.some(prefix => code.toUpperCase().startsWith(prefix));
  
  if (!hasValidPrefix) {
    errors.push(`유효하지 않은 품목코드 형식: ${code}`);
    return { valid: false, errors };
  }
  
  return { valid: true, errors, sanitizedData: code.toUpperCase() };
}

// 입고 데이터 전체 검증
export function validateInboundData(data: any): ValidationResult {
  const errors: string[] = [];
  
  // 필수 필드 검증
  const dateResult = validateDate(data.inbound_date);
  if (!dateResult.valid) errors.push(...dateResult.errors);
  
  const codeResult = validateItemCode(data.item_code);
  if (!codeResult.valid) errors.push(...codeResult.errors);
  
  const qtyResult = validateQuantity(data.quantity);
  if (!qtyResult.valid) errors.push(...qtyResult.errors);
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  return {
    valid: true,
    errors: [],
    sanitizedData: {
      inbound_date: dateResult.sanitizedData,
      item_code: codeResult.sanitizedData,
      quantity: qtyResult.sanitizedData,
      lot_number: data.lot_number || '',
      supplier: data.supplier || '',
      expiry_date: data.expiry_date || ''
    }
  };
}

// 생산 데이터 전체 검증
export function validateProductionData(data: any): ValidationResult {
  const errors: string[] = [];
  
  const dateResult = validateDate(data.prod_date);
  if (!dateResult.valid) errors.push(...dateResult.errors);
  
  const codeResult = validateItemCode(data.product_code);
  if (!codeResult.valid) errors.push(...codeResult.errors);
  
  const qtyResult = validateQuantity(data.quantity);
  if (!qtyResult.valid) errors.push(...qtyResult.errors);
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  return {
    valid: true,
    errors: [],
    sanitizedData: {
      prod_date: dateResult.sanitizedData,
      product_code: codeResult.sanitizedData,
      quantity: qtyResult.sanitizedData,
      lot_number: data.lot_number || '',
      channel: data.channel || ''
    }
  };
}

// 트랜잭션 타입
export type TransactionType = 'INBOUND' | 'USAGE' | 'ADJUSTMENT';

// 재고 트랜잭션 인터페이스
export interface InventoryTransaction {
  date: string;
  item_code: string;
  item_name: string;
  transaction_type: TransactionType;
  quantity: number;  // 입고: +, 사용: -
  lot_number?: string;
  reference?: string;  // 관련 문서 번호
}

// 일별 수불부 레코드
export interface DailyStockRecord {
  date: string;
  item_code: string;
  item_name: string;
  prev_stock: number;    // 전일재고
  inbound_qty: number;   // 입고(+)
  usage_qty: number;     // 출고/사용(-)
  current_stock: number; // 현재고 = 전일재고 + 입고 - 사용
  unit: string;
}

/**
 * 재고마스터 시트 수식 구조
 * 
 * A: 일자
 * B: 품목코드
 * C: 품목명 (VLOOKUP)
 * D: 전일재고 (전일 F열 값)
 * E: 입고(+) (SUMIFS from 원료입고_RAW)
 * F: 출고/사용(-) (SUMPRODUCT from 생산실적 × BOM)
 * G: 현재고 (=D+E-F)
 * H: 단위
 */
export const INVENTORY_FORMULAS = {
  // C열: 품목명 자동 조회
  ITEM_NAME: '=IFERROR(VLOOKUP(B{row},원료입고_RAW!B:C,2,FALSE),"")',
  
  // D열: 전일재고 (전일 같은 품목의 현재고)
  PREV_STOCK: '=IFERROR(SUMIFS(재고마스터!G:G,재고마스터!B:B,B{row},재고마스터!A:A,A{row}-1),0)',
  
  // E열: 당일 입고량 (원료입고_RAW에서)
  INBOUND_QTY: '=SUMIFS(원료입고_RAW!E:E,원료입고_RAW!B:B,B{row},원료입고_RAW!A:A,A{row})',
  
  // F열: 당일 사용량 (BOM × 생산수량)
  // ★ 핵심: 생산실적의 제품코드 → BOM에서 원료 배합비 조회 → 합산
  USAGE_QTY: `=SUMPRODUCT(
    (생산실적_RAW!A:A=A{row})*
    (생산실적_RAW!B:B<>"")*
    IFERROR(VLOOKUP(생산실적_RAW!B:B&"|"&B{row},BOM마스터_LOOKUP!A:B,2,FALSE),0)*
    생산실적_RAW!D:D
  )/1000`,
  
  // G열: 현재고 = 전일재고 + 입고 - 사용
  CURRENT_STOCK: '=D{row}+E{row}-F{row}'
};

/**
 * BOM 마스터 LOOKUP 시트 구조 (연산용)
 * A: 연결키 (제품코드|원료코드)
 * B: 배합비(g)
 */
export const BOM_LOOKUP_FORMULA = {
  // A열: 연결키 생성
  CONCAT_KEY: '=BOM마스터!A{row}&"|"&BOM마스터!C{row}',
  // B열: 배합비
  RATIO: '=BOM마스터!E{row}'
};

export default {
  SHEET_NAMES,
  validateDate,
  validateQuantity,
  validateItemCode,
  validateInboundData,
  validateProductionData,
  INVENTORY_FORMULAS,
  BOM_LOOKUP_FORMULA
};
