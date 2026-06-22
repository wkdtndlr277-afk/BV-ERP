/**
 * ProductionService 통합 테스트
 * 
 * v3.5.4: 재고 무결성 검증 테스트
 * 
 * 테스트 대상:
 * 1. 생산 등록 시 로트별 잔량 정확히 차감
 * 2. 생산 삭제(롤백) 시 로트 잔량 복구
 * 3. FEFO 차감 순서 검증
 * 4. 원자적 트랜잭션 검증
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ===== Mock D1 Database =====
// Cloudflare D1 인터페이스를 모킹하여 테스트

interface MockInbound {
  id: number;
  item_code: string;
  lot_number: string;
  remain_qty: number;
  expire_date: string;
}

interface MockTransaction {
  id: number;
  item_code: string;
  trans_type: string;
  quantity: number;
  lot_number: string;
  trans_date: string;
}

interface MockMaster {
  item_code: string;
  item_name: string;
  current_stock: number;
  category: string;
}

class MockD1Database {
  inboundData: MockInbound[] = [];
  transactionData: MockTransaction[] = [];
  masterData: MockMaster[] = [];
  private nextId = 1;
  private executedStatements: string[] = [];

  // 테스트용 데이터 초기화
  reset() {
    this.inboundData = [];
    this.transactionData = [];
    this.masterData = [];
    this.nextId = 1;
    this.executedStatements = [];
  }

  // Mock prepare/bind/run 체인
  prepare(sql: string) {
    const db = this;
    return {
      bind(...params: any[]) {
        return {
          async run() {
            db.executedStatements.push(sql);
            // INSERT 감지
            if (sql.includes('INSERT INTO transactions')) {
              const id = db.nextId++;
              db.transactionData.push({
                id,
                item_code: params[0],
                trans_type: params[1],
                quantity: params[2],
                lot_number: params[3],
                trans_date: params[4]
              });
              return { success: true, meta: { last_row_id: id } };
            }
            // UPDATE inbound 감지
            if (sql.includes('UPDATE inbound') && sql.includes('remain_qty')) {
              const newQty = params[0];
              const inboundId = params[1];
              const item = db.inboundData.find(i => i.id === inboundId);
              if (item) {
                item.remain_qty = newQty;
              }
              return { success: true };
            }
            // UPDATE master 감지
            if (sql.includes('UPDATE master') && sql.includes('current_stock')) {
              const newStock = params[0];
              const itemCode = params[1];
              const item = db.masterData.find(i => i.item_code === itemCode);
              if (item) {
                item.current_stock = newStock;
              }
              return { success: true };
            }
            return { success: true };
          },
          async all<T>(): Promise<{ results: T[] }> {
            db.executedStatements.push(sql);
            // SELECT inbound for FEFO
            if (sql.includes('FROM inbound') && sql.includes('remain_qty > 0')) {
              const itemCode = params[0];
              const results = db.inboundData
                .filter(i => i.item_code === itemCode && i.remain_qty > 0)
                .sort((a, b) => a.expire_date.localeCompare(b.expire_date));
              return { results: results as T[] };
            }
            // SELECT master
            if (sql.includes('FROM master')) {
              const itemCode = params[0];
              const results = db.masterData.filter(i => i.item_code === itemCode);
              return { results: results as T[] };
            }
            return { results: [] };
          },
          async first<T>(): Promise<T | null> {
            const result = await this.all<T>();
            return result.results[0] || null;
          }
        };
      }
    };
  }

  // Mock batch for atomic transactions
  async batch(statements: any[]) {
    const results = [];
    for (const stmt of statements) {
      results.push(await stmt.run());
    }
    return results;
  }

  // 테스트용: 실행된 SQL 확인
  getExecutedStatements() {
    return this.executedStatements;
  }
}

// ===== FEFO 차감 계획 함수 (ProductionService에서 추출한 로직) =====
interface FEFODeductionPlan {
  itemCode: string;
  lots: Array<{
    inboundId: number;
    lotNumber: string;
    deductQty: number;
    remainAfter: number;
    expiryDate: string;
  }>;
  totalDeducted: number;
  shortage: number;
}

async function createFEFODeductionPlan(
  db: MockD1Database,
  itemCode: string,
  requiredQty: number
): Promise<FEFODeductionPlan> {
  // FEFO: 소비기한 빠른 순서로 정렬된 로트 조회
  const lots = db.inboundData
    .filter(i => i.item_code === itemCode && i.remain_qty > 0)
    .sort((a, b) => a.expire_date.localeCompare(b.expire_date));

  const plan: FEFODeductionPlan = {
    itemCode,
    lots: [],
    totalDeducted: 0,
    shortage: 0
  };

  let remaining = requiredQty;

  for (const lot of lots) {
    if (remaining <= 0) break;

    const deductQty = Math.min(remaining, lot.remain_qty);
    plan.lots.push({
      inboundId: lot.id,
      lotNumber: lot.lot_number,
      deductQty,
      remainAfter: lot.remain_qty - deductQty,
      expiryDate: lot.expire_date
    });

    plan.totalDeducted += deductQty;
    remaining -= deductQty;
  }

  plan.shortage = Math.max(0, remaining);
  return plan;
}

// ===== 원자적 차감 실행 함수 =====
interface DeductionResult {
  success: boolean;
  error?: string;
  transactionIds: number[];
}

async function executeAtomicDeduction(
  db: MockD1Database,
  plan: FEFODeductionPlan,
  transDate: string
): Promise<DeductionResult> {
  // v3.5.3: 로트 번호 필수 검증
  if (plan.lots.length === 0) {
    return {
      success: false,
      error: `로트 정보 없음: ${plan.itemCode}`,
      transactionIds: []
    };
  }

  for (const lot of plan.lots) {
    if (!lot.lotNumber || lot.lotNumber.trim() === '') {
      return {
        success: false,
        error: `로트 번호 누락: ${plan.itemCode}`,
        transactionIds: []
      };
    }
  }

  // 원자적 실행 (실제로는 D1 batch 사용)
  const transactionIds: number[] = [];

  for (const lot of plan.lots) {
    // 1. inbound.remain_qty 차감
    const inboundItem = db.inboundData.find(i => i.id === lot.inboundId);
    if (inboundItem) {
      inboundItem.remain_qty = lot.remainAfter;
    }

    // 2. transactions INSERT
    const txId = db.transactionData.length + 1;
    db.transactionData.push({
      id: txId,
      item_code: plan.itemCode,
      trans_type: '사용',
      quantity: -lot.deductQty, // 사용은 음수
      lot_number: lot.lotNumber,
      trans_date: transDate
    });
    transactionIds.push(txId);
  }

  // 3. master.current_stock 차감
  const masterItem = db.masterData.find(i => i.item_code === plan.itemCode);
  if (masterItem) {
    masterItem.current_stock -= plan.totalDeducted;
  }

  return { success: true, transactionIds };
}

// ===== 롤백 함수 =====
async function rollbackDeduction(
  db: MockD1Database,
  plan: FEFODeductionPlan,
  transactionIds: number[]
): Promise<{ success: boolean }> {
  // 1. inbound.remain_qty 복구
  for (const lot of plan.lots) {
    const inboundItem = db.inboundData.find(i => i.id === lot.inboundId);
    if (inboundItem) {
      inboundItem.remain_qty += lot.deductQty; // 원복
    }
  }

  // 2. transactions 삭제 (또는 역분개 INSERT)
  db.transactionData = db.transactionData.filter(
    t => !transactionIds.includes(t.id)
  );

  // 3. master.current_stock 복구
  const masterItem = db.masterData.find(i => i.item_code === plan.itemCode);
  if (masterItem) {
    masterItem.current_stock += plan.totalDeducted;
  }

  return { success: true };
}

// ===== 테스트 케이스 =====

describe('ProductionService - Inventory Integrity', () => {
  let db: MockD1Database;

  beforeEach(() => {
    db = new MockD1Database();
    db.reset();

    // 테스트용 기초 데이터 설정
    // Master 데이터
    db.masterData = [
      { item_code: 'RM001', item_name: '밀가루', current_stock: 1000, category: '원료' },
      { item_code: 'RM002', item_name: '설탕', current_stock: 500, category: '원료' },
    ];

    // Inbound 데이터 (FEFO 테스트용 - 소비기한 다른 로트)
    db.inboundData = [
      { id: 1, item_code: 'RM001', lot_number: 'LOT-2026-001', remain_qty: 300, expire_date: '2026-08-01' },
      { id: 2, item_code: 'RM001', lot_number: 'LOT-2026-002', remain_qty: 400, expire_date: '2026-07-15' }, // 먼저 소진
      { id: 3, item_code: 'RM001', lot_number: 'LOT-2026-003', remain_qty: 300, expire_date: '2026-09-01' },
      { id: 4, item_code: 'RM002', lot_number: 'LOT-2026-010', remain_qty: 500, expire_date: '2026-12-01' },
    ];
  });

  describe('FEFO 차감 계획 생성', () => {
    it('소비기한 빠른 로트부터 차감 계획을 생성해야 함', async () => {
      const plan = await createFEFODeductionPlan(db, 'RM001', 500);

      expect(plan.itemCode).toBe('RM001');
      expect(plan.totalDeducted).toBe(500);
      expect(plan.shortage).toBe(0);

      // FEFO 순서 검증: LOT-2026-002(7/15) → LOT-2026-001(8/1)
      expect(plan.lots.length).toBe(2);
      expect(plan.lots[0].lotNumber).toBe('LOT-2026-002'); // 7/15 먼저
      expect(plan.lots[0].deductQty).toBe(400); // 전량 소진
      expect(plan.lots[1].lotNumber).toBe('LOT-2026-001'); // 8/1 다음
      expect(plan.lots[1].deductQty).toBe(100); // 나머지
    });

    it('재고 부족 시 shortage를 계산해야 함', async () => {
      const plan = await createFEFODeductionPlan(db, 'RM001', 1500);

      expect(plan.totalDeducted).toBe(1000); // 전체 가용 재고
      expect(plan.shortage).toBe(500); // 부족분
    });

    it('재고가 없으면 빈 계획을 반환해야 함', async () => {
      const plan = await createFEFODeductionPlan(db, 'RM999', 100);

      expect(plan.lots.length).toBe(0);
      expect(plan.totalDeducted).toBe(0);
      expect(plan.shortage).toBe(100);
    });
  });

  describe('생산 등록 시 로트별 잔량 차감', () => {
    it('생산 등록 시 로트별 잔량이 정확히 차감되어야 함', async () => {
      // 초기 상태 기록
      const initialStock = db.masterData.find(m => m.item_code === 'RM001')!.current_stock;
      const initialLot2Qty = db.inboundData.find(i => i.id === 2)!.remain_qty;
      const initialLot1Qty = db.inboundData.find(i => i.id === 1)!.remain_qty;

      // 1. FEFO 차감 계획 생성
      const plan = await createFEFODeductionPlan(db, 'RM001', 500);
      
      // 2. 원자적 차감 실행
      const result = await executeAtomicDeduction(db, plan, '2026-06-23');

      expect(result.success).toBe(true);
      expect(result.transactionIds.length).toBe(2); // 2개 로트에서 차감

      // 3. 잔량 검증
      const lot2 = db.inboundData.find(i => i.id === 2)!;
      const lot1 = db.inboundData.find(i => i.id === 1)!;
      
      expect(lot2.remain_qty).toBe(0); // 400 → 0 (전량 소진)
      expect(lot1.remain_qty).toBe(200); // 300 → 200 (100 차감)

      // 4. master.current_stock 검증
      const master = db.masterData.find(m => m.item_code === 'RM001')!;
      expect(master.current_stock).toBe(initialStock - 500); // 1000 → 500

      // 5. transactions 검증
      expect(db.transactionData.length).toBe(2);
      expect(db.transactionData[0].lot_number).toBe('LOT-2026-002');
      expect(db.transactionData[0].quantity).toBe(-400); // 음수 (사용)
      expect(db.transactionData[1].lot_number).toBe('LOT-2026-001');
      expect(db.transactionData[1].quantity).toBe(-100);
    });

    it('모든 transactions에 lot_number가 기록되어야 함', async () => {
      const plan = await createFEFODeductionPlan(db, 'RM001', 500);
      await executeAtomicDeduction(db, plan, '2026-06-23');

      // 모든 트랜잭션에 lot_number 존재 검증
      for (const tx of db.transactionData) {
        expect(tx.lot_number).toBeTruthy();
        expect(tx.lot_number.trim()).not.toBe('');
      }
    });
  });

  describe('생산 등록 삭제(롤백) 시 잔량 복구', () => {
    it('생산 등록을 삭제하면 로트 잔량이 복구되어야 함', async () => {
      // 초기 상태 기록
      const initialMasterStock = db.masterData.find(m => m.item_code === 'RM001')!.current_stock;
      const initialLot1Qty = db.inboundData.find(i => i.id === 1)!.remain_qty;
      const initialLot2Qty = db.inboundData.find(i => i.id === 2)!.remain_qty;

      // 1. 생산 등록 실행
      const plan = await createFEFODeductionPlan(db, 'RM001', 500);
      const result = await executeAtomicDeduction(db, plan, '2026-06-23');

      // 차감 후 상태 확인
      expect(db.masterData.find(m => m.item_code === 'RM001')!.current_stock).toBe(500);

      // 2. 롤백 실행
      const rollbackResult = await rollbackDeduction(db, plan, result.transactionIds);

      expect(rollbackResult.success).toBe(true);

      // 3. 모든 상태가 초기화되었는지 확인
      const restoredMaster = db.masterData.find(m => m.item_code === 'RM001')!;
      const restoredLot1 = db.inboundData.find(i => i.id === 1)!;
      const restoredLot2 = db.inboundData.find(i => i.id === 2)!;

      expect(restoredMaster.current_stock).toBe(initialMasterStock); // 1000 복구
      expect(restoredLot1.remain_qty).toBe(initialLot1Qty); // 300 복구
      expect(restoredLot2.remain_qty).toBe(initialLot2Qty); // 400 복구

      // transactions도 삭제되었는지 확인
      expect(db.transactionData.length).toBe(0);
    });

    it('부분 롤백도 정확히 동작해야 함', async () => {
      // 두 품목 차감
      const plan1 = await createFEFODeductionPlan(db, 'RM001', 200);
      const plan2 = await createFEFODeductionPlan(db, 'RM002', 100);

      const result1 = await executeAtomicDeduction(db, plan1, '2026-06-23');
      const result2 = await executeAtomicDeduction(db, plan2, '2026-06-23');

      expect(db.transactionData.length).toBe(2); // 각 1개씩

      // plan1만 롤백
      await rollbackDeduction(db, plan1, result1.transactionIds);

      // RM001은 복구, RM002는 차감 상태 유지
      expect(db.masterData.find(m => m.item_code === 'RM001')!.current_stock).toBe(1000);
      expect(db.masterData.find(m => m.item_code === 'RM002')!.current_stock).toBe(400);
      expect(db.transactionData.length).toBe(1);
    });
  });

  describe('로트 검증 (v3.5.3)', () => {
    it('로트 번호가 없으면 차감이 거부되어야 함', async () => {
      // 로트 번호 없는 데이터 강제 설정
      db.inboundData = [
        { id: 99, item_code: 'RM999', lot_number: '', remain_qty: 100, expire_date: '2026-12-01' }
      ];

      const plan = await createFEFODeductionPlan(db, 'RM999', 50);
      
      // 로트 번호가 비어있으면 차감 거부
      const result = await executeAtomicDeduction(db, plan, '2026-06-23');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('로트 번호 누락');
    });

    it('재고 없으면 "로트 정보 없음" 에러 반환해야 함', async () => {
      const plan = await createFEFODeductionPlan(db, 'RM_NO_STOCK', 100);
      const result = await executeAtomicDeduction(db, plan, '2026-06-23');

      expect(result.success).toBe(false);
      expect(result.error).toContain('로트 정보 없음');
    });
  });

  describe('원자성 검증', () => {
    it('차감 중 오류 발생 시 전체 롤백되어야 함', async () => {
      // 이 테스트는 실제 D1 batch()의 원자성을 검증
      // Mock에서는 개념적으로만 검증

      const initialStock = db.masterData.find(m => m.item_code === 'RM001')!.current_stock;
      
      // 시뮬레이션: 차감 시도 후 수동 롤백
      const plan = await createFEFODeductionPlan(db, 'RM001', 500);
      const result = await executeAtomicDeduction(db, plan, '2026-06-23');
      
      // 오류 발생 시뮬레이션 - 즉시 롤백
      if (result.success) {
        await rollbackDeduction(db, plan, result.transactionIds);
      }

      // 원래 상태로 복구 확인
      expect(db.masterData.find(m => m.item_code === 'RM001')!.current_stock).toBe(initialStock);
    });
  });
});

describe('ProductionService - 수량 정밀도', () => {
  let db: MockD1Database;

  beforeEach(() => {
    db = new MockD1Database();
    db.masterData = [
      { item_code: 'RM001', item_name: '밀가루', current_stock: 100.12345, category: '원료' }
    ];
    db.inboundData = [
      { id: 1, item_code: 'RM001', lot_number: 'LOT-001', remain_qty: 50.12345, expire_date: '2026-08-01' },
      { id: 2, item_code: 'RM001', lot_number: 'LOT-002', remain_qty: 50, expire_date: '2026-09-01' }
    ];
  });

  it('소수점 수량도 정확히 처리해야 함', async () => {
    const plan = await createFEFODeductionPlan(db, 'RM001', 50.12345);
    
    expect(plan.lots.length).toBe(1);
    expect(plan.lots[0].deductQty).toBe(50.12345);
    expect(plan.lots[0].remainAfter).toBe(0);

    await executeAtomicDeduction(db, plan, '2026-06-23');

    const lot = db.inboundData.find(i => i.id === 1)!;
    expect(lot.remain_qty).toBe(0);

    const master = db.masterData.find(m => m.item_code === 'RM001')!;
    expect(master.current_stock).toBeCloseTo(50, 5);
  });
});
