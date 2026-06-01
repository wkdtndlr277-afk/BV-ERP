/**
 * LOT 번호 생성 유틸리티
 * 
 * 핵심 규칙:
 * 1. LOT 번호가 누락되면 절대 DB에 기록하지 않음
 * 2. 시스템이 자동으로 YYYYMMDD-코드-순번 형식 생성
 * 3. 생성 실패 시 'LOT 생성 오류' 예외 발생
 * 4. 반제품 LOT 조회 시 기준일 = 생산일 전날
 * 
 * @version 1.0.0
 * @lastUpdated 2026-06-01
 */

// ===== LOT 에러 정의 =====

export class LOTGenerationError extends Error {
  constructor(
    message: string,
    public code: 'LOT_GENERATION_FAILED' | 'LOT_MISSING' | 'LOT_INVALID_FORMAT' | 'LOT_DUPLICATE',
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'LOTGenerationError';
  }
}

// ===== LOT 형식 정의 =====

export const LOT_FORMAT = {
  /**
   * 원료 LOT: YYYYMMDD-R코드-순번 (입고일 기준)
   * 예: 20260601-R001-001
   */
  RAW_MATERIAL: {
    prefix: '',
    pattern: /^\d{8}-R\d{3,4}-\d{3}$/,
    generate: (date: string, itemCode: string, sequence: number): string => {
      const dateStr = date.replace(/-/g, '');
      const seq = String(sequence).padStart(3, '0');
      return `${dateStr}-${itemCode}-${seq}`;
    }
  },

  /**
   * 반제품 LOT: YYYYMMDD-SF코드-순번 (생산일 전날 기준!)
   * 예: 20260531-SF001-001 (6월 1일 생산 시)
   */
  SEMI_FINISHED: {
    prefix: '',
    pattern: /^\d{8}-SF\d{3,4}-\d{3}$/,
    generate: (productionDate: string, itemCode: string, sequence: number): string => {
      // 생산일 전날 계산
      const prodDate = new Date(productionDate);
      prodDate.setDate(prodDate.getDate() - 1);
      const dateStr = prodDate.toISOString().split('T')[0].replace(/-/g, '');
      const seq = String(sequence).padStart(3, '0');
      return `${dateStr}-${itemCode}-${seq}`;
    },
    // 반제품 LOT 조회 시 기준일 계산 (생산일 전날)
    getReferenceDate: (productionDate: string): string => {
      const prodDate = new Date(productionDate);
      prodDate.setDate(prodDate.getDate() - 1);
      return prodDate.toISOString().split('T')[0];
    }
  },

  /**
   * 제품 LOT: PRD-YYYYMMDD-제품코드-랜덤4자리
   * 예: PRD-20260601-PR001-1234
   */
  PRODUCT: {
    prefix: 'PRD-',
    pattern: /^PRD-\d{8}-[A-Z0-9]+-\d{4}$/,
    generate: (date: string, productCode: string): string => {
      const dateStr = date.replace(/-/g, '');
      const random = String(Date.now()).slice(-4);
      return `PRD-${dateStr}-${productCode}-${random}`;
    }
  },

  /**
   * 샘플 LOT: 원료 LOT + '-S' 접미사
   * 예: 20260601-R001-001-S
   */
  SAMPLE: {
    suffix: '-S',
    generate: (baseLotNumber: string): string => {
      return `${baseLotNumber}-S`;
    }
  }
};

// ===== LOT 생성 함수 =====

/**
 * 원료 LOT 번호 생성 (필수)
 * @throws LOTGenerationError 생성 실패 시
 */
export async function generateRawMaterialLOT(
  db: D1Database,
  itemCode: string,
  inboundDate: string
): Promise<string> {
  if (!itemCode || !inboundDate) {
    throw new LOTGenerationError(
      'LOT 생성 오류: 품목코드와 입고일이 필요합니다.',
      'LOT_GENERATION_FAILED',
      { itemCode, inboundDate }
    );
  }

  try {
    // 해당 날짜의 해당 품목 순번 조회
    const countResult = await db.prepare(`
      SELECT COUNT(*) as count FROM inbound 
      WHERE item_code = ? AND inbound_date = ?
    `).bind(itemCode, inboundDate).first<{ count: number }>();

    const sequence = (countResult?.count || 0) + 1;
    const lotNumber = LOT_FORMAT.RAW_MATERIAL.generate(inboundDate, itemCode, sequence);

    // 중복 확인
    const existing = await db.prepare(`
      SELECT lot_number FROM inbound WHERE lot_number = ?
    `).bind(lotNumber).first();

    if (existing) {
      // 중복 시 타임스탬프 추가
      const uniqueLot = `${lotNumber}-${Date.now().toString(36)}`;
      return uniqueLot;
    }

    return lotNumber;
  } catch (error: any) {
    throw new LOTGenerationError(
      `LOT 생성 오류: ${error.message}`,
      'LOT_GENERATION_FAILED',
      { itemCode, inboundDate, originalError: error.message }
    );
  }
}

/**
 * 반제품 LOT 번호 생성 (필수)
 * 기준일: 생산일 전날
 * @throws LOTGenerationError 생성 실패 시
 */
export async function generateSemiFinishedLOT(
  db: D1Database,
  itemCode: string,
  productionDate: string
): Promise<string> {
  if (!itemCode || !productionDate) {
    throw new LOTGenerationError(
      'LOT 생성 오류: 품목코드와 생산일이 필요합니다.',
      'LOT_GENERATION_FAILED',
      { itemCode, productionDate }
    );
  }

  try {
    // 생산일 전날 계산
    const referenceDate = LOT_FORMAT.SEMI_FINISHED.getReferenceDate(productionDate);

    // 해당 날짜의 해당 품목 순번 조회
    const countResult = await db.prepare(`
      SELECT COUNT(*) as count FROM semi_finished_lots 
      WHERE item_code = ? AND prod_date = ?
    `).bind(itemCode, referenceDate).first<{ count: number }>();

    const sequence = (countResult?.count || 0) + 1;
    const lotNumber = LOT_FORMAT.SEMI_FINISHED.generate(productionDate, itemCode, sequence);

    return lotNumber;
  } catch (error: any) {
    throw new LOTGenerationError(
      `반제품 LOT 생성 오류: ${error.message}`,
      'LOT_GENERATION_FAILED',
      { itemCode, productionDate, originalError: error.message }
    );
  }
}

/**
 * 제품 LOT 번호 생성 (필수)
 * @throws LOTGenerationError 생성 실패 시
 */
export function generateProductLOT(
  productCode: string,
  productionDate: string
): string {
  if (!productCode || !productionDate) {
    throw new LOTGenerationError(
      'LOT 생성 오류: 제품코드와 생산일이 필요합니다.',
      'LOT_GENERATION_FAILED',
      { productCode, productionDate }
    );
  }

  return LOT_FORMAT.PRODUCT.generate(productionDate, productCode);
}

// ===== LOT 검증 함수 =====

/**
 * LOT 번호 필수 검증
 * @throws LOTGenerationError LOT이 누락된 경우
 */
export function validateLOTRequired(lotNumber: string | null | undefined, context?: string): void {
  if (!lotNumber || lotNumber.trim() === '') {
    throw new LOTGenerationError(
      `LOT 생성 오류: LOT 번호가 누락되었습니다.${context ? ` (${context})` : ''}`,
      'LOT_MISSING',
      { context }
    );
  }
}

/**
 * LOT 형식 검증
 */
export function validateLOTFormat(lotNumber: string, type: 'raw' | 'semi' | 'product'): boolean {
  switch (type) {
    case 'raw':
      return LOT_FORMAT.RAW_MATERIAL.pattern.test(lotNumber);
    case 'semi':
      return LOT_FORMAT.SEMI_FINISHED.pattern.test(lotNumber);
    case 'product':
      return LOT_FORMAT.PRODUCT.pattern.test(lotNumber);
    default:
      return false;
  }
}

// ===== 반제품 LOT 조회 유틸리티 =====

/**
 * 반제품 LOT 조회 (기준일: 생산일 전날)
 * FEFO 방식으로 가용 LOT 조회
 */
export async function querySemiFinishedLOTs(
  db: D1Database,
  itemCode: string,
  productionDate: string
): Promise<{
  lots: Array<{
    lot_number: string;
    item_code: string;
    remain_qty: number;
    expiry_date: string;
    prod_date: string;
  }>;
  referenceDate: string;
}> {
  // 기준일 = 생산일 전날 (고정)
  const referenceDate = LOT_FORMAT.SEMI_FINISHED.getReferenceDate(productionDate);

  const result = await db.prepare(`
    SELECT lot_number, item_code, remain_qty, expiry_date, prod_date
    FROM semi_finished_lots 
    WHERE item_code = ? 
      AND remain_qty > 0 
      AND prod_date <= ?
      AND (expiry_date >= ? OR expiry_date IS NULL)
    ORDER BY expiry_date ASC, prod_date ASC, id ASC
  `).bind(itemCode, referenceDate, productionDate).all<{
    lot_number: string;
    item_code: string;
    remain_qty: number;
    expiry_date: string;
    prod_date: string;
  }>();

  return {
    lots: result.results || [],
    referenceDate
  };
}

// ===== 생산일보 LOT 강제 생성 =====

/**
 * 생산일보 등록 시 LOT 강제 생성
 * LOT이 없으면 DB에 기록하지 않고 예외 발생
 * 
 * @throws LOTGenerationError LOT 생성 실패 시
 */
export async function ensureProductionLOT(
  db: D1Database,
  params: {
    productCode: string;
    productionDate: string;
    existingLot?: string | null;
  }
): Promise<string> {
  const { productCode, productionDate, existingLot } = params;

  // 이미 LOT이 있으면 검증 후 반환
  if (existingLot && existingLot.trim() !== '') {
    // 형식 검증 (선택적)
    if (!existingLot.startsWith('PRD-')) {
      console.warn(`[LOT 경고] 비표준 LOT 형식: ${existingLot}`);
    }
    return existingLot;
  }

  // LOT 자동 생성 (필수)
  const newLot = generateProductLOT(productCode, productionDate);

  if (!newLot) {
    throw new LOTGenerationError(
      'LOT 생성 오류: 제품 LOT를 생성할 수 없습니다.',
      'LOT_GENERATION_FAILED',
      { productCode, productionDate }
    );
  }

  console.log(`[LOT 생성] ${productCode} → ${newLot}`);
  return newLot;
}

/**
 * 입고 LOT 강제 생성
 * LOT이 없으면 DB에 기록하지 않고 예외 발생
 */
export async function ensureInboundLOT(
  db: D1Database,
  params: {
    itemCode: string;
    inboundDate: string;
    existingLot?: string | null;
    isSample?: boolean;
  }
): Promise<string> {
  const { itemCode, inboundDate, existingLot, isSample } = params;

  // 이미 LOT이 있으면 반환
  if (existingLot && existingLot.trim() !== '') {
    return existingLot;
  }

  // LOT 자동 생성 (필수)
  let newLot = await generateRawMaterialLOT(db, itemCode, inboundDate);

  // 샘플이면 접미사 추가
  if (isSample) {
    newLot = LOT_FORMAT.SAMPLE.generate(newLot);
  }

  if (!newLot) {
    throw new LOTGenerationError(
      'LOT 생성 오류: 입고 LOT를 생성할 수 없습니다.',
      'LOT_GENERATION_FAILED',
      { itemCode, inboundDate }
    );
  }

  console.log(`[LOT 생성] ${itemCode} → ${newLot}`);
  return newLot;
}

export default {
  LOT_FORMAT,
  LOTGenerationError,
  generateRawMaterialLOT,
  generateSemiFinishedLOT,
  generateProductLOT,
  validateLOTRequired,
  validateLOTFormat,
  querySemiFinishedLOTs,
  ensureProductionLOT,
  ensureInboundLOT
};
