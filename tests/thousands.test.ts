import { describe, it, expect } from 'vitest';
import { stripThousands } from '../src/services/GoogleSheetsService';

describe('천 단위 쉼표 숫자 읽기', () => {
  it('쉼표 숫자만 변환', () => {
    expect(stripThousands('3,085.01')).toBe('3085.01');
    expect(parseFloat(stripThousands('29,467'))).toBe(29467);
    expect(stripThousands('-1,234')).toBe('-1234');
    expect(stripThousands('2026-09-01')).toBe('2026-09-01');
    expect(stripThousands('20260901-R060-001')).toBe('20260901-R060-001');
    expect(stripThousands('1,2')).toBe('1,2');
    expect(stripThousands('강력(사조)')).toBe('강력(사조)');
    expect(stripThousands(12.5)).toBe(12.5);
    expect(stripThousands('815.854')).toBe('815.854');
  });
});
