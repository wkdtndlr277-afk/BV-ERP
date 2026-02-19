-- 상세 제조원가 테이블 (엑셀 양식 기반)
-- 제품별 제조원가계산서 전체 정보 저장

-- 제조원가 마스터 (제품별 원가계산서 헤더)
CREATE TABLE IF NOT EXISTS product_cost_sheet (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL,            -- 제품코드 (master 참조)
  sheet_name TEXT,                       -- 시트명/제품명
  created_date TEXT DEFAULT (date('now')), -- 작성일자
  version INTEGER DEFAULT 1,             -- 버전
  base_quantity REAL DEFAULT 1,          -- 기준 생산량 (배치 기준)
  base_unit TEXT DEFAULT 'ea',           -- 기준 단위
  retail_price REAL,                     -- 소매가
  wholesale_price REAL,                  -- 공급가
  target_margin_rate REAL,               -- 목표 마진율
  memo TEXT,
  is_active INTEGER DEFAULT 1,           -- 활성 여부
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_code) REFERENCES master(item_code)
);

-- 원재료비 상세 (1. 원재료비)
CREATE TABLE IF NOT EXISTS cost_raw_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_id INTEGER NOT NULL,             -- product_cost_sheet 참조
  sort_order INTEGER DEFAULT 0,
  item_code TEXT,                        -- master 원료코드 (있으면)
  item_name TEXT NOT NULL,               -- 원재료명
  ratio REAL,                            -- 배합률 (%)
  weight REAL,                           -- 중량 (g)
  loss_rate REAL DEFAULT 0,              -- LOSS율 (%)
  unit_price REAL,                       -- kg 단가
  amount REAL,                           -- 금액
  unit_cost REAL,                        -- 원단위
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sheet_id) REFERENCES product_cost_sheet(id) ON DELETE CASCADE
);

-- 부재료비 상세 (2. 부재료비)
CREATE TABLE IF NOT EXISTS cost_sub_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_id INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0,
  category TEXT,                         -- 분류 (반제품, 완제품, 토핑 등)
  item_name TEXT NOT NULL,               -- 부재료명
  ratio REAL,                            -- 배합률
  quantity REAL,                         -- 수량
  loss_rate REAL DEFAULT 0,              -- LOSS율
  unit_price REAL,                       -- 단가
  amount REAL,                           -- 금액
  unit_cost REAL,                        -- 원단위
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sheet_id) REFERENCES product_cost_sheet(id) ON DELETE CASCADE
);

-- 노무비 상세 (3. 노무비 - 생산직접비/생산간접비)
CREATE TABLE IF NOT EXISTS cost_labor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_id INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0,
  cost_type TEXT NOT NULL,               -- 'direct' (생산직접비) / 'indirect' (생산간접비)
  category TEXT,                         -- 항목 분류
  item_name TEXT NOT NULL,               -- 항목명
  base_cost REAL,                        -- 기준 비용
  allocation_rate REAL,                  -- 배부율 (%)
  amount REAL,                           -- 금액
  unit_cost REAL,                        -- 원단위
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sheet_id) REFERENCES product_cost_sheet(id) ON DELETE CASCADE
);

-- 경비 상세 (4. 경비 - 생산직접비/생산간접비)
CREATE TABLE IF NOT EXISTS cost_overhead (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_id INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0,
  cost_type TEXT NOT NULL,               -- 'direct' / 'indirect'
  category TEXT,                         -- 항목 분류 (전력비, 수도광열비, 감가상각비 등)
  item_name TEXT NOT NULL,
  base_cost REAL,                        -- 기준 비용
  allocation_rate REAL,                  -- 배부율
  amount REAL,                           -- 금액
  unit_cost REAL,                        -- 원단위
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sheet_id) REFERENCES product_cost_sheet(id) ON DELETE CASCADE
);

-- 원가 요약 (계산된 합계 저장)
CREATE TABLE IF NOT EXISTS cost_summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_id INTEGER NOT NULL UNIQUE,
  
  -- 생산직접비
  raw_material_cost REAL DEFAULT 0,      -- 원재료비
  sub_material_cost REAL DEFAULT 0,      -- 부재료비
  direct_labor_cost REAL DEFAULT 0,      -- 직접 노무비
  direct_overhead_cost REAL DEFAULT 0,   -- 직접 경비
  direct_cost_total REAL DEFAULT 0,      -- 생산직접비 합계
  
  -- 생산간접비
  indirect_labor_cost REAL DEFAULT 0,    -- 간접 노무비
  indirect_overhead_cost REAL DEFAULT 0, -- 간접 경비
  indirect_cost_total REAL DEFAULT 0,    -- 생산간접비 합계
  
  -- 기타비용
  other_cost REAL DEFAULT 0,             -- 기타
  
  -- 총 제조원가
  total_manufacturing_cost REAL DEFAULT 0,  -- 제조원가 합계
  
  -- 단위당 원가
  unit_manufacturing_cost REAL DEFAULT 0,   -- 원단위 제조원가
  retail_unit_cost REAL DEFAULT 0,          -- 소매가 대비 원단위
  wholesale_unit_cost REAL DEFAULT 0,       -- 공급가 대비 원단위
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sheet_id) REFERENCES product_cost_sheet(id) ON DELETE CASCADE
);

-- 노무비/경비 기준 설정 테이블 (공장별 기준값)
CREATE TABLE IF NOT EXISTS cost_standard_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factory_code TEXT DEFAULT 'main',      -- 공장 코드
  rate_type TEXT NOT NULL,               -- 'labor_direct', 'labor_indirect', 'overhead_direct', 'overhead_indirect'
  category TEXT NOT NULL,                -- 분류명
  item_name TEXT NOT NULL,               -- 항목명
  monthly_base_cost REAL,                -- 월 기준 비용
  allocation_method TEXT,                -- 배부 방식 (생산량비율, 시간비율 등)
  is_active INTEGER DEFAULT 1,
  effective_date TEXT DEFAULT (date('now')),
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_product_cost_sheet_product ON product_cost_sheet(product_code);
CREATE INDEX IF NOT EXISTS idx_product_cost_sheet_active ON product_cost_sheet(is_active);
CREATE INDEX IF NOT EXISTS idx_cost_raw_materials_sheet ON cost_raw_materials(sheet_id);
CREATE INDEX IF NOT EXISTS idx_cost_sub_materials_sheet ON cost_sub_materials(sheet_id);
CREATE INDEX IF NOT EXISTS idx_cost_labor_sheet ON cost_labor(sheet_id);
CREATE INDEX IF NOT EXISTS idx_cost_overhead_sheet ON cost_overhead(sheet_id);
CREATE INDEX IF NOT EXISTS idx_cost_standard_rates_type ON cost_standard_rates(rate_type, is_active);
