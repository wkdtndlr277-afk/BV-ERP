-- 신규 기능: 비품(위생복/위생화/장갑/모자 등) 관리
-- 사이즈가 있는 품목(의류, 신발, 장갑)과 없는 품목(모자 등)을 함께 다루기 위해
-- "품목 마스터"와 "사이즈별 재고"를 분리했습니다.

-- 1. 비품 품목 마스터 (사이즈와 무관한 공통 정보: 이름, 분류, 단가)
CREATE TABLE IF NOT EXISTS equipment_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code TEXT UNIQUE NOT NULL,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '기타',   -- 의류/신발/장갑/모자/방문객용/기타
  unit TEXT NOT NULL DEFAULT 'EA',
  unit_price REAL DEFAULT 0,               -- 현재 단가 (입고 시 갱신됨)
  memo TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. 사이즈별 재고 (사이즈 없는 품목은 size = '' 로 저장)
CREATE TABLE IF NOT EXISTS equipment_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code TEXT NOT NULL,
  size TEXT NOT NULL DEFAULT '',
  current_stock REAL NOT NULL DEFAULT 0,
  safety_stock REAL NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(item_code, size)
);
CREATE INDEX IF NOT EXISTS idx_equipment_stock_item ON equipment_stock(item_code);

-- 3. 입출고/지급 이력 (입고=구매, 지급=개인에게 나눠준 것, 재고조정=실사보정)
--    지급 건은 issued_to에 받은 사람 이름이 남아 "누가 가져갔는지" 추적 가능
--    unit_price는 거래 시점 단가를 스냅샷으로 남겨 월별 구매금액 집계에 사용
CREATE TABLE IF NOT EXISTS equipment_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trans_date TEXT NOT NULL,
  item_code TEXT NOT NULL,
  size TEXT NOT NULL DEFAULT '',
  trans_type TEXT NOT NULL CHECK (trans_type IN ('입고', '지급', '재고조정')),
  quantity REAL NOT NULL,                  -- 입고는 양수, 지급은 양수(차감은 코드에서 처리), 조정은 +/-
  unit_price REAL DEFAULT 0,               -- 거래 시점 단가 스냅샷
  issued_to TEXT,                          -- 지급 대상자 (지급 타입일 때만 사용)
  department TEXT,
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_equipment_trans_date ON equipment_transactions(trans_date);
CREATE INDEX IF NOT EXISTS idx_equipment_trans_item ON equipment_transactions(item_code);
CREATE INDEX IF NOT EXISTS idx_equipment_trans_issued_to ON equipment_transactions(issued_to);

-- 4. 요청하신 비품 품목 초기 등록 (사이즈/가격은 비워둠 - 나중에 직접 채우는 구조)
INSERT OR IGNORE INTO equipment_items (item_code, item_name, category, unit) VALUES
  ('EQ001', '위생복 상의', '의류', 'EA'),
  ('EQ002', '위생복 하의', '의류', 'EA'),
  ('EQ003', '앞치마', '의류', 'EA'),
  ('EQ004', '위생화', '신발', '족'),
  ('EQ005', '실내화', '신발', '족'),
  ('EQ006', '라텍스장갑', '장갑', '개'),
  ('EQ007', '금속검출용 라텍스장갑', '장갑', '개'),
  ('EQ008', '속모자', '모자', 'EA'),
  ('EQ009', '겉모자', '모자', 'EA'),
  ('EQ010', '일회용 방문객용', '방문객용', 'EA');
