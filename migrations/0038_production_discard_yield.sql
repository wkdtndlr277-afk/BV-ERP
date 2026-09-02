-- 신규 기능: 생산 폐기량 기록 (수득율/수율 관리용)
-- 기존에 investigation_materials(투입량: 계획 vs 실제)는 이미 있었으나,
-- 산출 단계에서 "얼마나 버렸는지"를 남기는 곳이 전혀 없어 수율 계산이 불가능했음.
-- 이 테이블 하나로 산출-폐기 균형을 맞춰 중량 기준 수율(%) 계산이 가능해짐.

CREATE TABLE IF NOT EXISTS production_discard (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  production_id INTEGER NOT NULL,       -- production.id
  discard_qty REAL NOT NULL,            -- 폐기 수량 (개)
  discard_weight_kg REAL,               -- 폐기 중량(kg). NULL이면 표준중량으로 자동 환산
  reason TEXT NOT NULL,                 -- 폐기 사유 (자유 텍스트)
  discard_date TEXT NOT NULL,
  memo TEXT,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (production_id) REFERENCES production(id)
);
CREATE INDEX IF NOT EXISTS idx_production_discard_prod ON production_discard(production_id);
CREATE INDEX IF NOT EXISTS idx_production_discard_date ON production_discard(discard_date);
