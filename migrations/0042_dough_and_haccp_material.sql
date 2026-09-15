-- ============================================================
-- 0042: 반죽(sub-recipe) 마스터 + HACCP 원료 사용량 체크
-- ============================================================
-- 배경: 엑셀 재료체크시트 = 반죽 배합 + 총 원료 사용량 자동 산출
--   제품 수량 → 반죽 필요 kg → 판 수 → 원료 총 사용량
-- ============================================================

-- 1. 반죽(sub-recipe) 마스터
-- 예: 발효종르방(Levain), 폴리쉬(Polish), 통밀르방, 탕종, 통밀탕종, 쌀르방, 쌀탕종, 통밀폴리쉬
CREATE TABLE IF NOT EXISTS dough_recipe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dough_code TEXT NOT NULL UNIQUE,           -- 예: 'DOUGH_LEVAIN'
  dough_name TEXT NOT NULL,                   -- 예: '발효종르방'
  dough_name_en TEXT,                         -- 예: 'Levain'
  batch_size_kg REAL NOT NULL DEFAULT 40,     -- 판(배치) 1개당 반죽 완성 무게 kg (예: 40kg/판)
  memo TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. 반죽별 원료 배합 (반죽 1kg 만들 때 필요한 원료 g)
CREATE TABLE IF NOT EXISTS dough_material (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dough_code TEXT NOT NULL,                   -- FK to dough_recipe
  material_code TEXT,                          -- FK to raw_materials (선택)
  material_name TEXT NOT NULL,                 -- '유기농강력', '통밀', '소금' ...
  quantity_per_kg REAL NOT NULL,               -- 반죽 1kg당 g (예: 유기농강력 500g/1kg 반죽)
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dough_material_code ON dough_material(dough_code);

-- 3. 제품별 반죽 사용량 (제품 1개당 몇 g의 어떤 반죽 필요한가)
-- 예: '통밀식빵 220g x 2 (총 440g)' → dough_code='DOUGH_WHOLE_LEVAIN', dough_g_per_product=440
CREATE TABLE IF NOT EXISTS product_dough_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  production_code TEXT NOT NULL,              -- FK to production_items
  production_name TEXT,                        -- 편의용
  dough_code TEXT NOT NULL,                    -- FK to dough_recipe
  dough_g_per_product REAL NOT NULL,           -- 제품 1개당 반죽 g
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pdu_prod ON product_dough_usage(production_code);
CREATE INDEX IF NOT EXISTS idx_pdu_dough ON product_dough_usage(dough_code);

-- 4. HACCP 원료 사용량 체크 (계획 vs 실사용)
-- 매일 계획 산출 후 스냅샷 저장, 생산팀이 실사용 입력 → 편차 자동 계산
CREATE TABLE IF NOT EXISTS haccp_material_check (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_date DATE NOT NULL,                   -- 생산일 YYYY-MM-DD
  material_code TEXT,
  material_name TEXT NOT NULL,
  category TEXT DEFAULT 'raw',                 -- 'dough' | 'raw'
  planned_qty REAL DEFAULT 0,                  -- 계획 사용량 (자동 산출)
  actual_qty REAL,                             -- 실사용량 (생산팀 입력)
  unit TEXT DEFAULT 'kg',
  variance REAL,                               -- 편차 = actual - planned
  variance_pct REAL,                           -- 편차 % = variance / planned * 100
  status TEXT DEFAULT 'planned',               -- 'planned' | 'in_progress' | 'confirmed' | 'alerted'
  lot_no TEXT,                                 -- 사용 로트 (HACCP 추적)
  checked_by TEXT,
  checked_at DATETIME,
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hmc_date ON haccp_material_check(check_date);
CREATE INDEX IF NOT EXISTS idx_hmc_material ON haccp_material_check(check_date, material_name);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hmc ON haccp_material_check(check_date, material_name);

-- 5. HACCP 편차 임계값 설정 (원료별로 다른 허용치 지원)
CREATE TABLE IF NOT EXISTS haccp_variance_threshold (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_name TEXT UNIQUE,                   -- NULL이면 default
  warning_pct REAL DEFAULT 5,                  -- ±5% → 경고
  critical_pct REAL DEFAULT 10,                -- ±10% → 위험 알람
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 기본 임계값
INSERT OR IGNORE INTO haccp_variance_threshold (material_name, warning_pct, critical_pct, memo)
VALUES (NULL, 5, 10, '전체 기본값 - 특정 원료는 별도 등록');
