-- ============================================================
-- 0043: 생산 계획 스냅샷 (일자별 계획 + 실적 저장)
-- ============================================================
-- 배경: 재료체크시트 xlsm 파일에서 추출한 계획 수량과
--   자동 산출된 원료/반죽 사용량을 일자별로 저장
--   → 향후 계획 vs 실적 비교, 트렌드 분석, HACCP 감사 자료
-- ============================================================

-- 1. 생산 계획 스냅샷 (파일 헤더)
CREATE TABLE IF NOT EXISTS production_plan_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_date DATE NOT NULL,                    -- 생산일 YYYY-MM-DD (예: 2026-09-06)
  weekday TEXT,                                -- 요일 (일요일)
  source_file TEXT,                            -- 원본 xlsm 파일명
  total_products INTEGER DEFAULT 0,            -- 총 제품 종류
  total_qty_ea REAL DEFAULT 0,                 -- 총 계획 수량 (EA)
  total_pan_su REAL DEFAULT 0,                 -- 총 판수
  total_dough_g REAL DEFAULT 0,                -- 총 반죽 사용량 (g)
  total_material_g REAL DEFAULT 0,             -- 총 원료 사용량 (g)
  memo TEXT,
  status TEXT DEFAULT 'planned',               -- 'planned' | 'in_progress' | 'completed'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pps_date ON production_plan_snapshot(plan_date);

-- 2. 제품별 계획량 (스냅샷의 각 제품 라인)
CREATE TABLE IF NOT EXISTS production_plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL,               -- FK to production_plan_snapshot
  plan_date DATE NOT NULL,                    -- 편의용 중복 저장
  product_name TEXT NOT NULL,                 -- 원본 제품명 (엑셀)
  product_code TEXT,                          -- 매칭된 제품 코드 (선택)
  total_qty REAL DEFAULT 0,                   -- 총 수량 (EA)
  pan_su REAL,                                 -- 판수
  channels_json TEXT,                          -- 채널별 수량 JSON (쿠팡, 오아시스, 컬리 등)
  memo TEXT,
  FOREIGN KEY (snapshot_id) REFERENCES production_plan_snapshot(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ppi_snapshot ON production_plan_items(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_ppi_date ON production_plan_items(plan_date);
CREATE INDEX IF NOT EXISTS idx_ppi_product ON production_plan_items(plan_date, product_name);

-- 3. 반죽별 총 사용량 (스냅샷의 반죽 집계)
CREATE TABLE IF NOT EXISTS production_plan_doughs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL,
  plan_date DATE NOT NULL,
  dough_name TEXT NOT NULL,                   -- 발효종르방, 폴리쉬, 통밀르방 등
  dough_name_en TEXT,
  total_g REAL DEFAULT 0,                     -- 총 사용량 (g) — BACK UP R798
  pan_su_20kg REAL DEFAULT 0,                 -- 판수 (20kg 배치 기준)
  FOREIGN KEY (snapshot_id) REFERENCES production_plan_snapshot(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ppd_snapshot ON production_plan_doughs(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_ppd_date ON production_plan_doughs(plan_date);

-- 4. 원료별 총 사용량 (스냅샷의 원료 집계 — 재료체크시트에서 추출)
CREATE TABLE IF NOT EXISTS production_plan_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL,
  plan_date DATE NOT NULL,
  material_name TEXT NOT NULL,                -- 유기농강력, 통밀, 소금 등
  material_name_en TEXT,
  total_g REAL DEFAULT 0,                     -- 총 사용량 (g)
  memo TEXT,
  FOREIGN KEY (snapshot_id) REFERENCES production_plan_snapshot(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ppm_snapshot ON production_plan_materials(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_ppm_date ON production_plan_materials(plan_date);
CREATE INDEX IF NOT EXISTS idx_ppm_material ON production_plan_materials(plan_date, material_name);
