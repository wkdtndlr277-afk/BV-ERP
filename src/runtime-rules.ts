/**
 * ERP 시스템 운영 규칙 (Runtime Engine Mode)
 * 
 * 이 파일은 ERP 시스템의 핵심 비즈니스 로직을 정의합니다.
 * AI가 자의적으로 추론하지 않고, 반드시 이 규칙에 정의된 SQL 로직만 실행합니다.
 * 규칙에 없는 상황이 발생하면 '작업 중단'과 함께 에러를 반환합니다.
 * 
 * ⚠️ 핵심 원칙:
 * 1. 모든 수불 계산은 DB 잔량 합계(SUM(remain_qty))만을 신뢰한다.
 * 2. 재고 부족 시 계산하지 말고 즉시 'INSUFFICIENT_STOCK' 오류를 발생시켜 작업을 중단한다.
 * 3. LOT 생성 누락 시 기록을 거부하고 'LOT_MISSING' 알람을 발생시킨다.
 * 4. AI 예측값 완전 배제 - DB 실제 잔량만 신뢰한다.
 * 
 * @version 2.2.0
 * @lastUpdated 2026-06-01
 */

// ===== 1. 재고 관리 규칙 =====

export const STOCK_RULES = {
  /**
   * FEFO (First Expired First Out) 규칙
   * - 모든 재고 차감은 소비기한이 빠른 LOT부터 우선 사용
   * - 강제 쿼리: ORDER BY expiry_date ASC, inbound_date ASC, id ASC
   */
  FEFO_QUERY: {
    INBOUND: `
      SELECT * FROM inbound 
      WHERE item_code = ? AND remain_qty > 0 AND quality_status = '합격' AND expiry_date >= ?
      ORDER BY expiry_date ASC, inbound_date ASC, id ASC
    `,
    SEMI_FINISHED: `
      SELECT * FROM semi_finished_lots 
      WHERE item_code = ? AND remain_qty > 0 AND (expiry_date >= ? OR expiry_date IS NULL)
      ORDER BY expiry_date ASC, prod_date ASC, id ASC
    `,
    PRODUCTION: `
      SELECT * FROM production_inbound 
      WHERE production_code = ? AND remain_qty > 0 AND quality_status = '합격' AND expiry_date >= ?
      ORDER BY expiry_date ASC, inbound_date ASC, id ASC
    `
  },

  /**
   * 음수 재고 방지 규칙
   * - 모든 재고 차감에 MAX(0, current_stock - deduction) 적용
   * - SQL 패턴: UPDATE table SET current_stock = MAX(0, current_stock - ?)
   */
  PREVENT_NEGATIVE: {
    MASTER: `UPDATE master SET current_stock = MAX(0, current_stock - ?), updated_at = CURRENT_TIMESTAMP WHERE item_code = ?`,
    SUPPLIES: `UPDATE supplies SET current_stock = MAX(0, current_stock - ?), updated_at = CURRENT_TIMESTAMP WHERE item_code = ?`,
    INBOUND: `UPDATE inbound SET remain_qty = MAX(0, remain_qty - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND remain_qty >= ?`,
    SEMI_FINISHED: `UPDATE semi_finished_lots SET remain_qty = MAX(0, remain_qty - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND remain_qty >= ?`
  },

  /**
   * 재고 부족 방어 규칙
   * - 차감 전 반드시 가용 재고 검증
   * - 부족 시 즉시 작업 중단 및 에러 반환
   * - 에러 코드: INSUFFICIENT_STOCK
   */
  INSUFFICIENT_STOCK_ERROR: {
    code: 'INSUFFICIENT_STOCK',
    message: '재고 부족으로 작업을 진행할 수 없습니다.',
    action: 'ABORT'  // 작업 중단
  },

  /**
   * 이중 재고 추적
   * - master.current_stock: HACCP 재고 (총량)
   * - inbound.remain_qty: 수불부 기준 (LOT별 잔량)
   * - 두 값은 항상 동기화되어야 함
   */
  DUAL_TRACKING: {
    description: 'master.current_stock = SUM(inbound.remain_qty) WHERE quality_status = "합격"',
    audit_query: `
      SELECT 
        m.item_code,
        m.item_name,
        m.current_stock as master_stock,
        COALESCE(SUM(i.remain_qty), 0) as inbound_sum,
        m.current_stock - COALESCE(SUM(i.remain_qty), 0) as difference
      FROM master m
      LEFT JOIN inbound i ON m.item_code = i.item_code AND i.quality_status = '합격'
      WHERE m.category = '원료'
      GROUP BY m.item_code
      HAVING ABS(difference) > 0.001
    `
  }
};

// ===== 2. LOT 관리 규칙 =====

export const LOT_RULES = {
  /**
   * LOT 번호 생성 규칙
   * - 원료: YYYYMMDD-R코드-순번 (입고일 기준)
   * - 반제품: YYYYMMDD-SF코드-순번 (생산일 전날 기준)
   * - 제품: PRD-YYYYMMDD-제품코드-랜덤4자리
   */
  FORMAT: {
    RAW_MATERIAL: (date: string, itemCode: string, sequence: number) => 
      `${date.replace(/-/g, '')}-${itemCode}-${String(sequence).padStart(3, '0')}`,
    SEMI_FINISHED: (date: string, itemCode: string, sequence: number) => 
      `${date.replace(/-/g, '')}-${itemCode}-${String(sequence).padStart(3, '0')}`,
    PRODUCT: (date: string, productCode: string) => 
      `PRD-${date.replace(/-/g, '')}-${productCode}-${String(Date.now()).slice(-4)}`
  },

  /**
   * LOT 유효성 검사
   * - 소비기한 경과된 LOT는 사용 불가
   * - quality_status = '합격'인 LOT만 사용 가능
   */
  VALIDATION: {
    query: `
      SELECT * FROM inbound 
      WHERE lot_number = ? 
        AND remain_qty > 0 
        AND quality_status = '합격' 
        AND expiry_date >= ?
    `
  }
};

// ===== 3. 생산 관리 규칙 =====

export const PRODUCTION_RULES = {
  /**
   * BOM 기반 원료 차감
   * - 생산 등록 시 BOM에 정의된 원료를 FEFO 방식으로 자동 차감
   * - 정제수는 재고 차감 제외 (사용량 기록만)
   */
  BOM_DEDUCTION: {
    enabled: true,
    water_exception: ['정제수'],  // 차감 제외 품목명 키워드
    unit_conversion: {
      g_to_kg: 1000  // BOM은 g 기준, 재고는 kg 기준
    }
  },

  /**
   * 생산 입고 규칙
   * - 생산 완료 시 제품 재고 자동 증가
   * - production_inbound 테이블에 LOT 생성
   */
  INBOUND_ON_PRODUCTION: {
    enabled: true,
    status: '완료',
    quality_status: '합격',
    supplier: '자체생산'
  }
};

// ===== 4. 트랜잭션 규칙 =====

export const TRANSACTION_RULES = {
  /**
   * Atomic Transaction (원자적 트랜잭션)
   * - 모든 재고 업데이트는 D1 batch()로 묶어서 실행
   * - 하나라도 실패하면 전체 롤백
   */
  ATOMIC: {
    enabled: true,
    method: 'D1.batch()',
    rollback_on_failure: true
  },

  /**
   * 트랜잭션 유형
   */
  TYPES: {
    INBOUND: '입고',
    USAGE: '사용',
    OUTBOUND: '출고',
    ADJUSTMENT: '재고조정',
    PRODUCTION_INBOUND: '생산입고'
  }
};

// ===== 5. 에러 처리 규칙 =====

export const ERROR_RULES = {
  /**
   * 규칙 외 상황 처리
   * - 정의되지 않은 상황 발생 시 함부로 계산하지 않음
   * - 무조건 '작업 중단'과 함께 에러 반환
   */
  UNDEFINED_SITUATION: {
    action: 'ABORT',
    error_code: 'RULE_NOT_DEFINED',
    message: '시스템 운영 규칙에 정의되지 않은 상황입니다. 작업을 중단합니다.'
  },

  /**
   * 에러 코드 정의
   */
  CODES: {
    INSUFFICIENT_STOCK: '재고 부족',
    NO_LOT_AVAILABLE: '사용 가능한 LOT 없음',
    ITEM_NOT_FOUND: '품목을 찾을 수 없음',
    DB_ERROR: '데이터베이스 오류',
    VALIDATION_ERROR: '유효성 검사 실패',
    RULE_NOT_DEFINED: '규칙 미정의',
    TRANSACTION_FAILED: '트랜잭션 실패'
  }
};

// ===== 6. 감사(Audit) 규칙 =====

export const AUDIT_RULES = {
  /**
   * 재고 일치성 검사
   * - inbound.remain_qty 합계 vs master.current_stock 비교
   * - 불일치 허용 오차: 0.001
   */
  CONSISTENCY_CHECK: {
    enabled: true,
    tolerance: 0.001,
    query: STOCK_RULES.DUAL_TRACKING.audit_query
  },

  /**
   * 음수 재고 검사
   * - current_stock < 0 또는 remain_qty < 0 검출
   */
  NEGATIVE_STOCK_CHECK: {
    enabled: true,
    queries: {
      master: `SELECT * FROM master WHERE current_stock < 0`,
      inbound: `SELECT * FROM inbound WHERE remain_qty < 0`,
      semi_finished: `SELECT * FROM semi_finished_lots WHERE remain_qty < 0`
    }
  },

  /**
   * 스케줄 설정
   * - 매일 자정 (한국시간 00:00)에 자동 실행
   * - Cloudflare Cron Triggers 사용
   */
  SCHEDULE: {
    cron: '0 15 * * *',  // UTC 15:00 = KST 00:00
    endpoint: '/api/audit/run-all'
  }
};

// ===== 7. 시스템 설정 =====

export const SYSTEM_CONFIG = {
  /**
   * 런타임 엔진 모드
   * - true: AI가 추론하지 않고 규칙만 실행
   * - false: 일반 모드 (기존 동작)
   */
  RUNTIME_ENGINE_MODE: true,

  /**
   * 버전 정보
   */
  VERSION: '2.2.0',
  BUILD_DATE: '2026-06-01',

  /**
   * 데이터베이스 설정
   */
  DATABASE: {
    type: 'Cloudflare D1',
    name: 'haccp-erp-production',
    id: '596dc841-d436-4555-a774-5aa647455162'
  }
};

// ===== 8. 수불부 계산 규칙 (AI 추론 배제) =====

export const STOCK_CALCULATION_RULES = {
  /**
   * 재고 계산 시 신뢰할 데이터 소스
   * - current_stock은 AI가 계산하지 않음
   * - SUM(remain_qty) 쿼리 결과만 사용
   */
  TRUST_SOURCE: {
    raw_material: 'SELECT COALESCE(SUM(remain_qty), 0) as current_stock FROM inbound WHERE item_code = ? AND quality_status = "합격"',
    product: 'SELECT COALESCE(SUM(remain_qty), 0) as current_stock FROM production_inbound WHERE production_code = ? AND quality_status = "합격"',
    semi_finished: 'SELECT COALESCE(SUM(remain_qty), 0) as current_stock FROM semi_finished_lots WHERE item_code = ?'
  },

  /**
   * 데이터 불일치 시 행동
   * - 계산 결과를 보여주지 말고 에러 메시지 반환
   * - 에러 코드: DATA_MISMATCH
   */
  ON_MISMATCH: {
    action: 'ABORT',
    error_code: 'DATA_MISMATCH',
    message: '데이터 불일치 오류: 관리자 확인 필요'
  },

  /**
   * AI 추론 완전 배제
   * - DB의 실제 잔량 합계만 신뢰
   * - 예측값, 추정값, 계산값 사용 금지
   */
  AI_INFERENCE: {
    enabled: false,
    reason: 'DB SUM 쿼리 결과만 사용, AI 예측값 배제'
  }
};

// ===== 9. LOT 생성 강제 규칙 =====

export const LOT_GENERATION_RULES = {
  /**
   * LOT 번호 필수 생성
   * - LOT 번호 누락 시 DB 기록 거부
   * - 시스템이 자동으로 생성
   */
  REQUIRED: {
    enabled: true,
    on_missing: 'REJECT',
    error_code: 'LOT_MISSING',
    message: 'LOT 생성 오류: LOT 번호가 누락되었습니다.'
  },

  /**
   * LOT 형식
   * - 원료: YYYYMMDD-R코드-순번 (입고일 기준)
   * - 반제품: YYYYMMDD-SF코드-순번 (생산일 전날 기준!)
   * - 제품: PRD-YYYYMMDD-제품코드-랜덤4자리
   */
  FORMAT: {
    raw_material: 'YYYYMMDD-{item_code}-{sequence:3}',
    semi_finished: 'YYYYMMDD-{item_code}-{sequence:3}',  // 기준일 = 생산일 전날
    product: 'PRD-YYYYMMDD-{product_code}-{random:4}'
  },

  /**
   * 반제품 LOT 기준일
   * - 생산일 전날 고정
   */
  SEMI_FINISHED_REFERENCE_DATE: {
    rule: 'production_date - 1 day',
    description: '반제품 LOT 조회 시 기준일은 생산일 전날'
  }
};

// ===== 10. 규칙 요약 =====

export const RULES_SUMMARY = `
## ERP 시스템 운영 규칙 요약

### 1. 재고 관리
- FEFO 강제: 소비기한 빠른 LOT 우선 사용
- 음수 방지: MAX(0, current_stock - deduction) 적용
- 재고 부족 방어: 차감 전 검증, 부족 시 작업 중단

### 2. 트랜잭션
- Atomic: 모든 재고 업데이트는 batch()로 원자적 처리
- 롤백: 하나라도 실패하면 전체 롤백

### 3. LOT 관리
- 원료: YYYYMMDD-R코드-순번
- 반제품: YYYYMMDD-SF코드-순번
- 제품: PRD-YYYYMMDD-제품코드-랜덤4자리

### 4. 감사(Audit)
- 매일 자정 재고 일치성 검사
- 불일치 발견 시 알람 로깅

### 5. 에러 처리
- 규칙 외 상황: 작업 중단 + 에러 반환
- 추론 금지: 정의된 SQL 로직만 실행
`;

export default {
  STOCK_RULES,
  LOT_RULES,
  PRODUCTION_RULES,
  TRANSACTION_RULES,
  ERROR_RULES,
  AUDIT_RULES,
  SYSTEM_CONFIG,
  RULES_SUMMARY
};
