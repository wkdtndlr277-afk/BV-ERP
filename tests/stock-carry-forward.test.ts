import { describe, it, expect } from 'vitest';
import { GoogleSheetsService, buildBaselineLotPool, STOCK_BASELINE_DATE } from '../src/services/GoogleSheetsService';

// 메모리 시트로 GoogleSheetsService 의 읽기/쓰기만 대체
class FakeSheets extends (GoogleSheetsService as any) {
  sheets: Record<string, any[][]>;
  constructor(sheets: Record<string, any[][]>) {
    super('x', 'y');
    this.sheets = sheets;
  }
  async readSheet(name: string) { return (this.sheets[name] || []).map(r => [...r]); }
  async clearRange(name: string, range: string) {
    const m = range.match(/A(\d+):H?G?(\d+)/);
    const rows = this.sheets[name] || [];
    if (m) for (let i = +m[1] - 2; i <= +m[2] - 2 && i < rows.length; i++) rows[i] = [];
    return { success: true };
  }
  async writeSheet(name: string, a1: string, values: any[][]) {
    const start = parseInt(a1.slice(1)) - 2;
    const rows = (this.sheets[name] ||= []);
    values.forEach((v, i) => { rows[start + i] = v; });
    return true;
  }
  async getSfBom() { return {}; }
  async ensureRowCount() {}
  async writeRowsChunked(name: string, startRow: number, rows: any[][]) { await this.writeSheet(name, `A${startRow}`, rows); }
}

// 원료입고: A 입고일자, B 코드, C 이름, D 로트, E 입고량, F 단위, G 업체, H 소비기한, I 잔량(오래된 값)
const inbound = [
  ['2026-04-01', 'R1', '밀가루', 'APR', 100, 'kg', '', '2027-04-01', 100],   // 6개월 전, I열에 잔량 100 남아 있음
  ['2020-01-01', 'R1', '밀가루', 'STADJ', 50, 'kg', '', '', 50],            // 재고조정 가짜 LOT
  ['2026-09-24', 'R1', '밀가루', 'SEP24', 70, 'kg', '', '2027-09-24', 70],  // 기준일 7일 전 (주기 약 14일)
  ['2026-10-08', 'R1', '밀가루', 'OCT08', 70, 'kg', '', '2027-10-08', 70],
  ['2026-10-22', 'R1', '밀가루', 'OCT22', 70, 'kg', '', '2027-10-22', 70],
];
const bom = [['P1', '빵', 'R1', '밀가루', 10, 'kg']];
const production = [
  ['2026-10-02', 'P1', '빵', 2, '261002'],
  ['2026-10-09', 'P1', '빵', 5, '261009'],
  ['2026-10-23', 'P1', '빵', 3, '261023'],
];

describe('기준일 LOT 풀', () => {
  it('오래된 LOT·가짜 LOT는 0, 기준일 직전 LOT는 주기에 비례해 남음', () => {
    const pool = buildBaselineLotPool(inbound, STOCK_BASELINE_DATE)['R1'];
    const by = Object.fromEntries(pool.map(l => [l.lot, l.remaining]));
    expect(by.APR).toBe(0);
    expect(by.STADJ).toBe(0);
    expect(by.SEP24).toBeGreaterThan(0);
    expect(by.SEP24).toBeLessThan(70);
    expect(by.OCT08).toBe(70);
  });
});

describe('로트매칭 + 일별수불부 기간 재계산', () => {
  it('LOT 잔량이 날짜 간 이어지고, 6개월 전 LOT는 쓰지 않으며, 수불이 연속된다', async () => {
    const svc: any = new FakeSheets({
      원료입고: inbound.map(r => [...r]),
      BOM마스터: bom,
      생산실적: production,
      로트매칭: [['2026-09-15', 'X', 'R1', '밀가루', 5, 'APR', '2027-04-01']],  // 기준일 이전 기록은 보존
      일별수불부: [["'2026-09-30", 'R1', '밀가루', 1, 0, 0, 1, 'kg']],
    });
    const res = await svc.rebuildStockRange('2026-10-01', '2026-10-31');
    expect(res.dates).toBe(31);

    const lm = svc.sheets['로트매칭'].filter((r: any[]) => r.length && String(r[0]).replace(/^'/, '') >= '2026-10-01');
    const lotsUsed = new Set(lm.map((r: any[]) => r[5]));
    expect(lotsUsed.has('APR')).toBe(false);
    expect(lotsUsed.has('STADJ')).toBe(false);
    // 10/2 에 SEP24 일부 사용 → 10/9 에는 SEP24 남은 것 + OCT08 (같은 잔량을 반복 사용하지 않음)
    const sep24Total = lm.filter((r: any[]) => r[5] === 'SEP24').reduce((a: number, r: any[]) => a + r[4], 0);
    const pool = buildBaselineLotPool(inbound, STOCK_BASELINE_DATE)['R1'];
    expect(sep24Total).toBeLessThanOrEqual(pool.find(l => l.lot === 'SEP24')!.remaining + 1e-9);
    // 생산일 이전 입고 LOT만 사용
    expect(lm.some((r: any[]) => r[5] === 'OCT22' && String(r[0]).includes('10-09'))).toBe(false);
    // 기준일 이전 로트매칭 행은 그대로
    expect(svc.sheets['로트매칭'].some((r: any[]) => r[0] === '2026-09-15')).toBe(true);

    // 일별수불부: 전일 현재고 = 다음날 전일재고, 현재고 = 전일 + 입고 − 사용
    const daily = svc.sheets['일별수불부'].filter((r: any[]) => r.length && r[1] === 'R1' && String(r[0]).includes('2026-10'));
    expect(daily.length).toBe(31);
    for (let i = 0; i < daily.length; i++) {
      const [, , , prev, inb, use, cur] = daily[i];
      expect(cur).toBeCloseTo(prev + inb - use, 3);
      if (i > 0) expect(prev).toBeCloseTo(daily[i - 1][6], 3);
    }
    const oct2 = daily.find((r: any[]) => String(r[0]).includes('10-02'));
    expect(oct2[5]).toBeCloseTo(20, 3);   // 2개 × 10kg
    const oct8 = daily.find((r: any[]) => String(r[0]).includes('10-08'));
    expect(oct8[4]).toBe(70);            // 입고 반영
    // 9/30 행은 건드리지 않음
    expect(svc.sheets['일별수불부'][0][0]).toBe("'2026-09-30");
  });
});

describe('정제수', () => {
  it('로트매칭은 재고미관리로 기록하고 일별수불부에는 넣지 않는다', async () => {
    const svc: any = new FakeSheets({
      원료입고: [['2026-10-01', 'RM184', '정제수', 'W1', 1000, 'kg', '', '', 1000]],
      BOM마스터: [['P1', '빵', 'RM184', '정제수', 5, 'kg']],
      생산실적: [['2026-10-02', 'P1', '빵', 2, '261002']],
      로트매칭: [],
      일별수불부: [],
    });
    await svc.rebuildStockRange('2026-10-01', '2026-10-03');
    const lm = svc.sheets['로트매칭'].filter((r: any[]) => r.length);
    expect(lm).toHaveLength(1);
    expect(lm[0][5]).toBe('재고미관리(정제수)');
    expect(svc.sheets['일별수불부'].filter((r: any[]) => r.length && r[1] === 'RM184')).toHaveLength(0);
  });
});

describe('대량 매입 품목 기준일 재고', () => {
  it('5월 대량 입고 후 추가 입고가 없으면 기준일 재고를 사용량만큼 잡아 마이너스가 나지 않는다', async () => {
    const svc: any = new FakeSheets({
      원료입고: [
        ['2026-05-27', 'RM211', '통밀', 'MAY', 5000, 'kg', '', '2027-05-27', 0],
        ['2026-05-01', 'RM211', '통밀', 'MAY01', 3000, 'kg', '', '2027-05-01', 0],
      ],
      BOM마스터: [['P1', '빵', 'RM211', '통밀', 10, 'kg']],
      생산실적: [['2026-10-02', 'P1', '빵', 20, '261002'], ['2026-10-20', 'P1', '빵', 30, '261020']],
      로트매칭: [],
      일별수불부: [],
    });
    const res = await svc.rebuildStockRange('2026-10-01', '2026-10-31');
    expect(res.negativeItems).not.toContain('RM211');
    expect(res.openingRaisedItems).toBe(1);
    const lm = svc.sheets['로트매칭'].filter((r: any[]) => r.length);
    expect(lm.every((r: any[]) => r[5] === 'MAY')).toBe(true);   // 가장 최근 대량 LOT에서 사용
    const daily = svc.sheets['일별수불부'].filter((r: any[]) => r.length && r[1] === 'RM211');
    expect(daily[0][3]).toBeCloseTo(500, 3);                       // 10/1 전일재고 = 기간 사용량(500kg)
    expect(daily[daily.length - 1][6]).toBeCloseTo(0, 3);
  });
});
