-- 신규 기능: 믹싱 배치(반죽 단위) 수율 관리
-- 다품종 소량생산 환경에서는 두 가지 방식이 섞여있음:
--   1) 제품별로 따로 계량해서 반죽 (기존 production_materials -> production_id 모델로 충분)
--   2) 큰 반죽 하나를 여러 제품으로 나눠 성형 (원료 투입이 "제품"이 아니라 "배치" 단위)
-- 2번 케이스는 개별 제품 단위로 "진짜 수율"을 물리적으로 측정할 수 없음
-- (원료를 애초에 제품별로 나눠 넣은 게 아니므로). 그래서 배치 전체로 수율을 재고,
-- 거기서 나온 제품들에는 산출 비율대로 배분(pro-rata)해서 보여주는 구조로 설계함.

-- 믹싱 배치 (반죽 단위)
CREATE TABLE IF NOT EXISTS mixing_batch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_lot_number TEXT UNIQUE NOT NULL,   -- 배치 LOT번호 (여러 제품이 이 LOT을 공유함 -> 추적용)
  dough_name TEXT,                          -- dough_master와 연결되는 반죽 종류 (선택)
  mix_date TEXT NOT NULL,
  notes TEXT,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mixing_batch_date ON mixing_batch(mix_date);

-- 배치에 실제로 투입된 원료 (제품별이 아니라 배치 전체 기준)
CREATE TABLE IF NOT EXISTS mixing_batch_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  item_code TEXT NOT NULL,
  lot_number TEXT,                          -- 사용한 원료 LOT (추적용)
  actual_qty REAL NOT NULL,                 -- 실제 투입 중량 (kg)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES mixing_batch(id)
);
CREATE INDEX IF NOT EXISTS idx_mixing_batch_materials_batch ON mixing_batch_materials(batch_id);

-- production 테이블에 "이 생산 건이 어느 믹싱 배치에서 나눠 나온 것인지" 연결
ALTER TABLE production ADD COLUMN mixing_batch_id INTEGER REFERENCES mixing_batch(id);
CREATE INDEX IF NOT EXISTS idx_production_mixing_batch ON production(mixing_batch_id);
