-- 원료 단가 및 제조원가 계산 시스템
-- Material Costs (원료 단가 관리)
CREATE TABLE IF NOT EXISTS material_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code TEXT NOT NULL,              -- 원료코드 (master.item_code, category='원료')
  cost_per_unit REAL NOT NULL,          -- 단위당 단가 (원)
  unit TEXT NOT NULL DEFAULT 'kg',      -- 기준 단위 (kg, g, ea, L 등)
  supplier TEXT,                        -- 주 공급업체
  effective_date DATE NOT NULL,         -- 적용일 (단가 변동 이력 관리용)
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_code) REFERENCES master(item_code)
);

-- Product Costs (제품 원가 캐시/스냅샷)
CREATE TABLE IF NOT EXISTS product_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL,           -- 제품코드
  material_cost REAL NOT NULL,          -- 재료비 (BOM 기반 계산)
  labor_cost REAL DEFAULT 0,            -- 노무비 (수동 입력)
  overhead_cost REAL DEFAULT 0,         -- 경비 (수동 입력)
  total_cost REAL NOT NULL,             -- 총 제조원가
  selling_price REAL,                   -- 판매가 (참고용)
  margin_rate REAL,                     -- 마진율 (%) = (판매가-원가)/판매가*100
  calc_date DATE NOT NULL,              -- 계산일
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_code) REFERENCES master(item_code)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_material_costs_item ON material_costs(item_code);
CREATE INDEX IF NOT EXISTS idx_material_costs_date ON material_costs(effective_date);
CREATE INDEX IF NOT EXISTS idx_product_costs_product ON product_costs(product_code);
CREATE INDEX IF NOT EXISTS idx_product_costs_date ON product_costs(calc_date);

-- 원료별 최신 단가만 가져오는 뷰 (가장 최근 effective_date)
CREATE VIEW IF NOT EXISTS v_latest_material_costs AS
SELECT mc.*
FROM material_costs mc
INNER JOIN (
  SELECT item_code, MAX(effective_date) as max_date
  FROM material_costs
  GROUP BY item_code
) latest ON mc.item_code = latest.item_code AND mc.effective_date = latest.max_date;
