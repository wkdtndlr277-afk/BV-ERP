-- 생산 관리 및 BOM (배합표) 시스템
-- BOM (Bill of Materials) - 제품별 원재료 배합표
CREATE TABLE IF NOT EXISTS bom (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL,           -- 제품코드 (master.item_code, category='제품')
  item_code TEXT NOT NULL,              -- 원재료코드 (master.item_code, category='원료')
  quantity REAL NOT NULL,               -- 제품 1개당 원재료 사용량
  unit TEXT NOT NULL DEFAULT 'g',       -- 단위 (g, kg, ml, L, ea 등)
  sort_order INTEGER DEFAULT 0,         -- 정렬 순서
  memo TEXT,                            -- 비고
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_code) REFERENCES master(item_code),
  FOREIGN KEY (item_code) REFERENCES master(item_code),
  UNIQUE(product_code, item_code)       -- 제품-원재료 조합 중복 방지
);

-- Production (생산 기록)
CREATE TABLE IF NOT EXISTS production (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prod_date DATE NOT NULL,              -- 생산일
  product_code TEXT NOT NULL,           -- 제품코드
  quantity REAL NOT NULL,               -- 생산수량
  lot_number TEXT,                      -- 제품 LOT 번호 (자동생성 또는 수동)
  status TEXT DEFAULT '완료' CHECK (status IN ('계획', '진행중', '완료', '취소')),
  memo TEXT,
  created_by TEXT,                      -- 등록자
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_code) REFERENCES master(item_code)
);

-- Production Materials (생산시 사용된 원재료 기록)
CREATE TABLE IF NOT EXISTS production_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  production_id INTEGER NOT NULL,       -- production 테이블 참조
  item_code TEXT NOT NULL,              -- 원재료코드
  lot_number TEXT,                      -- 사용된 원료 LOT
  planned_qty REAL NOT NULL,            -- BOM 기준 계획 사용량
  actual_qty REAL,                      -- 실제 사용량 (null이면 planned_qty 사용)
  unit TEXT NOT NULL DEFAULT 'g',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (production_id) REFERENCES production(id) ON DELETE CASCADE,
  FOREIGN KEY (item_code) REFERENCES master(item_code),
  FOREIGN KEY (lot_number) REFERENCES inbound(lot_number)
);

-- Product Outbound (제품 출고 - 마켓/거래처별)
CREATE TABLE IF NOT EXISTS product_outbound (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outbound_date DATE NOT NULL,          -- 출고일
  product_code TEXT NOT NULL,           -- 제품코드
  quantity REAL NOT NULL,               -- 출고수량
  lot_number TEXT,                      -- 제품 LOT (선입선출)
  market TEXT,                          -- 마켓 (쿠팡, 오아시스, 마켓컬리 등)
  order_number TEXT,                    -- 주문번호
  customer TEXT,                        -- 거래처/고객명
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_code) REFERENCES master(item_code)
);

-- Market Codes (마켓별 상품코드 매핑)
CREATE TABLE IF NOT EXISTS market_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL,           -- 자체 제품코드
  market TEXT NOT NULL,                 -- 마켓명 (쿠팡, 오아시스, 마켓컬리, 비마트 등)
  market_product_code TEXT,             -- 마켓 상품코드/바코드
  market_product_name TEXT,             -- 마켓에서 사용하는 상품명
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_code) REFERENCES master(item_code),
  UNIQUE(product_code, market)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_bom_product_code ON bom(product_code);
CREATE INDEX IF NOT EXISTS idx_bom_item_code ON bom(item_code);
CREATE INDEX IF NOT EXISTS idx_production_date ON production(prod_date);
CREATE INDEX IF NOT EXISTS idx_production_product ON production(product_code);
CREATE INDEX IF NOT EXISTS idx_production_status ON production(status);
CREATE INDEX IF NOT EXISTS idx_production_materials_prod ON production_materials(production_id);
CREATE INDEX IF NOT EXISTS idx_product_outbound_date ON product_outbound(outbound_date);
CREATE INDEX IF NOT EXISTS idx_product_outbound_market ON product_outbound(market);
CREATE INDEX IF NOT EXISTS idx_market_codes_product ON market_codes(product_code);
CREATE INDEX IF NOT EXISTS idx_market_codes_market ON market_codes(market);

-- 트랜잭션 타입에 '생산사용', '생산입고' 추가를 위한 체크 제약 수정
-- SQLite는 ALTER TABLE로 CHECK 제약 수정이 안되므로, 기존 데이터는 유지하고 새 타입만 허용
-- 실제로는 앱 레벨에서 처리
