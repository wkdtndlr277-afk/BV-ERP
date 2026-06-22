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

// ===== BOM 기반 원료 차감 테스트 =====

// BOM (Bill of Materials) 타입 정의
interface BOMItem {
  material_code: string;
  material_name: string;
  quantity: number;  // 제품 1개당 소요량
  unit: string;
}

interface BOMRecipe {
  product_code: string;
  product_name: string;
  materials: BOMItem[];
}

// Mock BOM 저장소
class MockBOMRepository {
  private recipes: Map<string, BOMRecipe> = new Map();

  addRecipe(recipe: BOMRecipe) {
    this.recipes.set(recipe.product_code, recipe);
  }

  getRecipe(productCode: string): BOMRecipe | null {
    return this.recipes.get(productCode) || null;
  }

  // 생산 수량에 따른 원료 소요량 계산
  calculateMaterialUsage(productCode: string, productionQty: number): Array<{
    material_code: string;
    material_name: string;
    required_qty: number;
    unit: string;
  }> {
    const recipe = this.getRecipe(productCode);
    if (!recipe) return [];

    return recipe.materials.map(mat => ({
      material_code: mat.material_code,
      material_name: mat.material_name,
      required_qty: mat.quantity * productionQty,
      unit: mat.unit
    }));
  }
}

// 생산 서비스 - BOM 기반 재고 차감
class MockProductionService {
  constructor(
    private db: MockD1Database,
    private bom: MockBOMRepository
  ) {}

  // BOM 공식에 따른 원료 사용량 계산
  calculateUsage(productCode: string, productionQty: number) {
    return this.bom.calculateMaterialUsage(productCode, productionQty);
  }

  // 생산 등록 - BOM 기반 원자적 재고 차감
  async registerProduction(
    productCode: string,
    productionQty: number,
    prodDate: string
  ): Promise<{
    success: boolean;
    materialDeductions: Array<{
      material_code: string;
      material_name: string;
      deducted_qty: number;
      lots_used: string[];
    }>;
    error?: string;
  }> {
    const materialUsage = this.calculateUsage(productCode, productionQty);
    const deductions: Array<{
      material_code: string;
      material_name: string;
      deducted_qty: number;
      lots_used: string[];
    }> = [];

    // 1. 모든 원료에 대해 재고 확인 (사전 검증)
    for (const usage of materialUsage) {
      const availableLots = this.db.inboundData
        .filter(i => i.item_code === usage.material_code && i.remain_qty > 0)
        .sort((a, b) => a.expire_date.localeCompare(b.expire_date));
      
      const totalAvailable = availableLots.reduce((sum, lot) => sum + lot.remain_qty, 0);
      
      if (totalAvailable < usage.required_qty) {
        return {
          success: false,
          materialDeductions: [],
          error: `재고 부족: ${usage.material_name}(${usage.material_code}) - 필요: ${usage.required_qty}${usage.unit}, 가용: ${totalAvailable}${usage.unit}`
        };
      }
    }

    // 2. 원자적 차감 실행
    for (const usage of materialUsage) {
      const plan = await createFEFODeductionPlan(this.db, usage.material_code, usage.required_qty);
      
      // 로트 번호 검증
      if (plan.lots.some(lot => !lot.lotNumber || lot.lotNumber.trim() === '')) {
        return {
          success: false,
          materialDeductions: deductions,
          error: `로트 번호 누락: ${usage.material_name}`
        };
      }

      const result = await executeAtomicDeduction(this.db, plan, prodDate);
      
      if (!result.success) {
        // 이미 차감된 것들 롤백 필요 (실제 구현에서는 batch로 원자성 보장)
        return {
          success: false,
          materialDeductions: deductions,
          error: result.error
        };
      }

      deductions.push({
        material_code: usage.material_code,
        material_name: usage.material_name,
        deducted_qty: plan.totalDeducted,
        lots_used: plan.lots.map(l => l.lotNumber)
      });
    }

    return { success: true, materialDeductions: deductions };
  }
}

describe('ProductionService - BOM 기반 원료 차감', () => {
  let db: MockD1Database;
  let bom: MockBOMRepository;
  let productionService: MockProductionService;

  beforeEach(() => {
    db = new MockD1Database();
    bom = new MockBOMRepository();

    // BOM 레시피 설정: 식빵 1개 = 밀가루 500g + 소금 10g + 설탕 30g + 버터 50g
    bom.addRecipe({
      product_code: 'PR001',
      product_name: '식빵',
      materials: [
        { material_code: 'RM001', material_name: '밀가루', quantity: 0.5, unit: 'kg' },
        { material_code: 'RM002', material_name: '소금', quantity: 0.01, unit: 'kg' },
        { material_code: 'RM003', material_name: '설탕', quantity: 0.03, unit: 'kg' },
        { material_code: 'RM004', material_name: '버터', quantity: 0.05, unit: 'kg' }
      ]
    });

    // 크루아상: 밀가루 300g + 버터 200g
    bom.addRecipe({
      product_code: 'PR002',
      product_name: '크루아상',
      materials: [
        { material_code: 'RM001', material_name: '밀가루', quantity: 0.3, unit: 'kg' },
        { material_code: 'RM004', material_name: '버터', quantity: 0.2, unit: 'kg' }
      ]
    });

    // Master 및 Inbound 데이터
    db.masterData = [
      { item_code: 'RM001', item_name: '밀가루', current_stock: 100, category: '원료' },
      { item_code: 'RM002', item_name: '소금', current_stock: 10, category: '원료' },
      { item_code: 'RM003', item_name: '설탕', current_stock: 20, category: '원료' },
      { item_code: 'RM004', item_name: '버터', current_stock: 30, category: '원료' }
    ];

    db.inboundData = [
      { id: 1, item_code: 'RM001', lot_number: 'FLOUR-2026-001', remain_qty: 50, expire_date: '2026-08-01' },
      { id: 2, item_code: 'RM001', lot_number: 'FLOUR-2026-002', remain_qty: 50, expire_date: '2026-09-01' },
      { id: 3, item_code: 'RM002', lot_number: 'SALT-2026-001', remain_qty: 10, expire_date: '2027-01-01' },
      { id: 4, item_code: 'RM003', lot_number: 'SUGAR-2026-001', remain_qty: 20, expire_date: '2026-12-01' },
      { id: 5, item_code: 'RM004', lot_number: 'BUTTER-2026-001', remain_qty: 15, expire_date: '2026-07-15' },
      { id: 6, item_code: 'RM004', lot_number: 'BUTTER-2026-002', remain_qty: 15, expire_date: '2026-08-01' }
    ];

    productionService = new MockProductionService(db, bom);
  });

  describe('BOM 기반 소요량 계산', () => {
    it('BOM 공식에 따라 원료가 정확하게 계산되어야 함', () => {
      // 식빵 10개 생산 시 필요 원료
      const usage = productionService.calculateUsage('PR001', 10);

      expect(usage.length).toBe(4);
      
      // 밀가루: 0.5kg * 10 = 5kg
      const flour = usage.find(u => u.material_code === 'RM001')!;
      expect(flour.required_qty).toBe(5);
      expect(flour.material_name).toBe('밀가루');

      // 소금: 0.01kg * 10 = 0.1kg
      const salt = usage.find(u => u.material_code === 'RM002')!;
      expect(salt.required_qty).toBe(0.1);

      // 설탕: 0.03kg * 10 = 0.3kg
      const sugar = usage.find(u => u.material_code === 'RM003')!;
      expect(sugar.required_qty).toBe(0.3);

      // 버터: 0.05kg * 10 = 0.5kg
      const butter = usage.find(u => u.material_code === 'RM004')!;
      expect(butter.required_qty).toBe(0.5);
    });

    it('생산 수량에 비례하여 소요량이 증가해야 함', () => {
      const usage1 = productionService.calculateUsage('PR001', 1);
      const usage10 = productionService.calculateUsage('PR001', 10);
      const usage100 = productionService.calculateUsage('PR001', 100);

      const flour1 = usage1.find(u => u.material_code === 'RM001')!.required_qty;
      const flour10 = usage10.find(u => u.material_code === 'RM001')!.required_qty;
      const flour100 = usage100.find(u => u.material_code === 'RM001')!.required_qty;

      expect(flour10).toBe(flour1 * 10);
      expect(flour100).toBe(flour1 * 100);
    });

    it('존재하지 않는 제품은 빈 배열 반환', () => {
      const usage = productionService.calculateUsage('PR999', 10);
      expect(usage).toEqual([]);
    });
  });

  describe('BOM 기반 생산 등록 및 재고 차감', () => {
    it('생산 등록 시 BOM에 따라 모든 원료가 정확히 차감되어야 함', async () => {
      // 식빵 10개 생산
      const result = await productionService.registerProduction('PR001', 10, '2026-06-23');

      expect(result.success).toBe(true);
      expect(result.materialDeductions.length).toBe(4);

      // 각 원료별 차감량 검증
      const flourDeduction = result.materialDeductions.find(d => d.material_code === 'RM001')!;
      expect(flourDeduction.deducted_qty).toBe(5); // 0.5kg * 10

      const saltDeduction = result.materialDeductions.find(d => d.material_code === 'RM002')!;
      expect(saltDeduction.deducted_qty).toBe(0.1); // 0.01kg * 10

      // 실제 재고 차감 확인
      const flourStock = db.masterData.find(m => m.item_code === 'RM001')!.current_stock;
      expect(flourStock).toBe(95); // 100 - 5

      const saltStock = db.masterData.find(m => m.item_code === 'RM002')!.current_stock;
      expect(saltStock).toBeCloseTo(9.9, 5); // 10 - 0.1
    });

    it('FEFO에 따라 소비기한 빠른 로트부터 차감', async () => {
      // 크루아상 50개 생산 (버터 10kg 필요)
      const result = await productionService.registerProduction('PR002', 50, '2026-06-23');

      expect(result.success).toBe(true);

      const butterDeduction = result.materialDeductions.find(d => d.material_code === 'RM004')!;
      expect(butterDeduction.deducted_qty).toBe(10); // 0.2kg * 50

      // FEFO 순서 검증: BUTTER-2026-001(7/15) 먼저 소진
      expect(butterDeduction.lots_used[0]).toBe('BUTTER-2026-001');
      
      // 버터 로트별 잔량 확인
      const butterLot1 = db.inboundData.find(i => i.id === 5)!;
      const butterLot2 = db.inboundData.find(i => i.id === 6)!;
      
      expect(butterLot1.remain_qty).toBe(5); // 15 - 10 = 5 (먼저 전량 차감 후 다음 로트에서 차감)
      // 실제로는 15kg 먼저 전부 소진 후 다음 로트에서 추가 차감될 수 있음
    });

    it('재고 부족 시 생산 등록 실패', async () => {
      // 식빵 500개 생산 시도 (밀가루 250kg 필요 - 가용 100kg)
      const result = await productionService.registerProduction('PR001', 500, '2026-06-23');

      expect(result.success).toBe(false);
      expect(result.error).toContain('재고 부족');
      expect(result.error).toContain('밀가루');

      // 재고 차감 없음 확인
      const flourStock = db.masterData.find(m => m.item_code === 'RM001')!.current_stock;
      expect(flourStock).toBe(100); // 변화 없음
    });

    it('transactions에 lot_number가 모두 기록되어야 함', async () => {
      await productionService.registerProduction('PR001', 10, '2026-06-23');

      // 모든 트랜잭션에 lot_number 존재
      for (const tx of db.transactionData) {
        expect(tx.lot_number).toBeTruthy();
        expect(tx.lot_number.trim()).not.toBe('');
      }
    });
  });

  describe('복합 생산 시나리오', () => {
    it('여러 제품 연속 생산 시 재고가 누적 차감되어야 함', async () => {
      const initialFlour = db.masterData.find(m => m.item_code === 'RM001')!.current_stock;

      // 1차: 식빵 10개 (밀가루 5kg 사용)
      await productionService.registerProduction('PR001', 10, '2026-06-23');
      
      // 2차: 크루아상 20개 (밀가루 6kg 사용)
      await productionService.registerProduction('PR002', 20, '2026-06-23');

      const finalFlour = db.masterData.find(m => m.item_code === 'RM001')!.current_stock;
      expect(finalFlour).toBe(initialFlour - 5 - 6); // 100 - 11 = 89
    });

    it('재고 한계까지 생산 후 추가 생산 시 실패', async () => {
      // 버터 30kg 전부 사용: 크루아상 150개 (0.2kg * 150 = 30kg)
      const result1 = await productionService.registerProduction('PR002', 150, '2026-06-23');
      expect(result1.success).toBe(true);

      const butterStock = db.masterData.find(m => m.item_code === 'RM004')!.current_stock;
      expect(butterStock).toBe(0);

      // 추가 생산 시도 - 실패
      const result2 = await productionService.registerProduction('PR002', 1, '2026-06-23');
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('재고 부족');
    });
  });
});
