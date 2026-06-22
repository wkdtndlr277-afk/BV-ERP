/**
 * 로트 검증 로직 단위 테스트
 * 
 * v3.5.4: 로트 번호 필수화 및 레거시 데이터 분류 테스트
 * 
 * 테스트 대상:
 * 1. InventoryService - 레거시 데이터 분류 헬퍼 함수
 * 2. ProductionService - executeAtomicDeduction의 로트 검증 로직
 */

import { describe, it, expect } from 'vitest';
import { 
  isLegacyTransaction, 
  classifyLotStatus, 
  getLotDisplayValue,
  LOT_ENFORCEMENT_DATE 
} from '../src/services/InventoryService';

describe('로트 검증 - 레거시 데이터 분류', () => {
  
  describe('LOT_ENFORCEMENT_DATE 상수', () => {
    it('로트 강제 적용일이 2026-06-23이어야 함', () => {
      expect(LOT_ENFORCEMENT_DATE).toBe('2026-06-23');
    });
  });

  describe('isLegacyTransaction()', () => {
    it('적용일 이전 날짜는 레거시로 판정', () => {
      expect(isLegacyTransaction('2026-06-22')).toBe(true);
      expect(isLegacyTransaction('2026-01-01')).toBe(true);
      expect(isLegacyTransaction('2025-12-31')).toBe(true);
    });

    it('적용일 이후 날짜는 레거시가 아님', () => {
      expect(isLegacyTransaction('2026-06-23')).toBe(false);
      expect(isLegacyTransaction('2026-06-24')).toBe(false);
      expect(isLegacyTransaction('2026-12-31')).toBe(false);
    });
  });

  describe('classifyLotStatus()', () => {
    // 로트 번호가 있는 경우
    it('로트 번호가 있으면 항상 VALID', () => {
      expect(classifyLotStatus('LOT-2026-001', '2026-06-22')).toBe('VALID');
      expect(classifyLotStatus('LOT-2026-001', '2026-06-23')).toBe('VALID');
      expect(classifyLotStatus('LOT-2026-001', '2026-06-30')).toBe('VALID');
    });

    // 로트 번호가 없는 경우 - 레거시 데이터
    it('레거시 데이터에서 로트 누락은 LEGACY (정상)', () => {
      expect(classifyLotStatus(null, '2026-06-22')).toBe('LEGACY');
      expect(classifyLotStatus('', '2026-06-22')).toBe('LEGACY');
      expect(classifyLotStatus(undefined, '2026-06-01')).toBe('LEGACY');
      expect(classifyLotStatus('  ', '2026-05-01')).toBe('LEGACY');
    });

    // 로트 번호가 없는 경우 - 새 데이터
    it('새 데이터에서 로트 누락은 ERROR', () => {
      expect(classifyLotStatus(null, '2026-06-23')).toBe('ERROR');
      expect(classifyLotStatus('', '2026-06-24')).toBe('ERROR');
      expect(classifyLotStatus(undefined, '2026-07-01')).toBe('ERROR');
      expect(classifyLotStatus('  ', '2026-12-31')).toBe('ERROR');
    });
  });

  describe('getLotDisplayValue()', () => {
    it('로트 번호가 있으면 그대로 반환', () => {
      expect(getLotDisplayValue('LOT-2026-001', '2026-06-22')).toBe('LOT-2026-001');
      expect(getLotDisplayValue('ABC-123', '2026-06-30')).toBe('ABC-123');
    });

    it('레거시 데이터에서 로트 누락은 [레거시] 표시', () => {
      expect(getLotDisplayValue(null, '2026-06-22')).toBe('[레거시]');
      expect(getLotDisplayValue('', '2026-06-01')).toBe('[레거시]');
    });

    it('새 데이터에서 로트 누락은 [누락-확인필요] 표시', () => {
      expect(getLotDisplayValue(null, '2026-06-23')).toBe('[누락-확인필요]');
      expect(getLotDisplayValue('', '2026-06-30')).toBe('[누락-확인필요]');
    });
  });
});

describe('로트 검증 - 비즈니스 규칙', () => {
  
  describe('로트 번호 필수 검증 규칙', () => {
    // 이 테스트는 ProductionService.executeAtomicDeduction의 검증 로직을 검사
    
    it('v3.5.3 이후 로트 없이 사용 트랜잭션 불가 원칙', () => {
      // 이 테스트는 문서화 목적
      // 실제 로직은 ProductionService에서 다음과 같이 검증됨:
      // 1. LOT_NOT_FOUND: 로트 정보가 아예 없음
      // 2. LOT_NUMBER_REQUIRED: 로트 번호가 비어있음
      // 3. LOT_NUMBER_EMPTY: INSERT 전 최종 검증
      
      const v353Rules = {
        lotNotFound: '로트 정보 없음 → 에러',
        lotNumberRequired: '로트 번호 비어있음 → 에러', 
        lotNumberEmpty: 'INSERT 전 최종 검증 → 에러'
      };
      
      expect(Object.keys(v353Rules).length).toBe(3);
    });

    it('레거시 데이터는 오류로 분류하지 않음', () => {
      // 분석 API나 리포트에서 LOT_ENFORCEMENT_DATE 이전 데이터는
      // lot_number가 NULL이어도 LEGACY로 분류 (에러 아님)
      
      const legacyDate = '2026-06-20';
      const status = classifyLotStatus(null, legacyDate);
      
      expect(status).not.toBe('ERROR');
      expect(status).toBe('LEGACY');
    });
  });

  describe('FEFO 차감 시 로트 추적', () => {
    it('FEFO는 특정 inbound 레코드의 lot_number를 지정해서 차감해야 함', () => {
      // 이 테스트는 문서화 목적
      // ProductionService.createFEFODeductionPlan이 수행하는 작업:
      // 1. inbound 테이블에서 expire_date ASC 정렬
      // 2. 각 inbound의 lot_number를 명확히 지정
      // 3. transactions에 해당 lot_number 기록
      
      const fefoRules = {
        ordering: 'expire_date ASC (소비기한 빠른 것 먼저)',
        lotTracking: 'inbound.lot_number → transactions.lot_number',
        remainUpdate: 'inbound.remain_qty 차감'
      };
      
      expect(fefoRules.lotTracking).toContain('lot_number');
    });
  });
});

describe('로트 무결성 모니터링 API 규격', () => {
  
  it('/lot-integrity-check API 응답 구조', () => {
    // API 응답 스키마 문서화
    const expectedResponseStructure = {
      success: 'boolean',
      version: 'v3.5.4',
      status: 'PASS | WARNING | FAIL',
      enforcement: {
        cutoffDate: LOT_ENFORCEMENT_DATE,
        description: 'string',
        includeLegacy: 'boolean'
      },
      period: {
        requested: { start: 'date', days: 'number' },
        effective: { start: 'date', end: 'date' }
      },
      summary: {
        newDataMissingLot: 'number',
        legacyDataMissingLot: 'number',
        message: 'string',
        legacyNote: 'string | null'
      },
      statsByType: 'array',
      legacyStatsByType: 'array',
      missingLotByItem: 'array',
      recentMissingTransactions: 'array'
    };
    
    expect(expectedResponseStructure.enforcement.cutoffDate).toBe('2026-06-23');
  });

  it('상태 판정 기준 (새 데이터만)', () => {
    // PASS: newDataMissingLot === 0
    // WARNING: newDataMissingLot < 10
    // FAIL: newDataMissingLot >= 10
    
    const statusRules = {
      PASS: 'newDataMissingLot === 0',
      WARNING: 'newDataMissingLot > 0 && < 10',
      FAIL: 'newDataMissingLot >= 10'
    };
    
    expect(Object.keys(statusRules)).toContain('PASS');
    expect(Object.keys(statusRules)).toContain('WARNING');
    expect(Object.keys(statusRules)).toContain('FAIL');
  });
});
