-- 신규 기능: 포장재(부자재) BOM 연결 + 일별수불부
-- 제품 1개를 만들 때 필요한 원료(production_bom)와는 별개로,
-- "제품 N개당 포장재 1단위(박스 등)" 관계를 관리하기 위한 테이블입니다.
-- 예: 식빵 1박스(20개입) -> 출고 100개 등록 시 박스 5개 자동 차감

CREATE TABLE IF NOT EXISTS production_packaging (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  production_code TEXT NOT NULL,        -- 제품코드 (production_items.production_code)
  supply_code TEXT NOT NULL,             -- 포장재코드 (supplies.item_code)
  pack_qty REAL NOT NULL DEFAULT 1,      -- 입수량: 포장재 1단위(박스 등)에 들어가는 제품 수량
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(production_code, supply_code)
);
CREATE INDEX IF NOT EXISTS idx_production_packaging_code ON production_packaging(production_code);

-- 부자재(포장재/위생자재) 입출고 이력 - 원료의 transactions 테이블과 동일한 역할
-- 이게 있어야 "일별수불부"처럼 날짜별 입고/사용/재고를 보여줄 수 있습니다.
CREATE TABLE IF NOT EXISTS supply_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trans_date TEXT NOT NULL,
  item_code TEXT NOT NULL,               -- supplies.item_code
  trans_type TEXT NOT NULL CHECK (trans_type IN ('입고', '사용', '재고조정')),
  quantity REAL NOT NULL,                -- 입고는 양수, 사용/차감은 음수
  reference_type TEXT,                   -- 'shipment' | 'manual' 등 발생 출처
  reference_id INTEGER,                  -- 연관된 shipments.id 등
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_supply_trans_date ON supply_transactions(trans_date);
CREATE INDEX IF NOT EXISTS idx_supply_trans_item ON supply_transactions(item_code);
