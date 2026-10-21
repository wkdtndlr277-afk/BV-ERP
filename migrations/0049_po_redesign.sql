-- =============================================================
-- 0049: 구매발주 모듈 재설계 (카톡 전송 기반, 금액 제거)
-- 변경 사유: 이메일/금액/부가세/직인/납품장소 등 제거,
--           카톡 이미지 전송 중심 + 품목별 입고요청일로 단순화
-- =============================================================

-- 기존 po_* 테이블 전부 제거 (아직 운영 데이터 없음)
DROP TABLE IF EXISTS po_order_items;
DROP TABLE IF EXISTS po_orders;
DROP TABLE IF EXISTS po_cart;
DROP TABLE IF EXISTS po_price_history;
DROP TABLE IF EXISTS po_price_list;
DROP TABLE IF EXISTS po_materials;
DROP TABLE IF EXISTS po_erp_inbound;
DROP TABLE IF EXISTS po_supplier_aliases;
DROP TABLE IF EXISTS po_suppliers;
DROP TABLE IF EXISTS po_number_sequence;
DROP TABLE IF EXISTS po_settings;
DROP TABLE IF EXISTS po_upload_log;

-- -----------------------------------------------------------
-- 1. 공급업체 (업체명/별칭/담당자/휴대폰/메모만)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,              -- 표준 업체명
  contact_person TEXT,                    -- 담당자 이름
  phone TEXT,                             -- 휴대폰 번호
  memo TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_po_suppliers_name ON po_suppliers(name);

-- 공급업체 별칭 (업로드 시 자동 매칭)
CREATE TABLE IF NOT EXISTS po_supplier_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  alias TEXT NOT NULL UNIQUE,
  normalized_alias TEXT NOT NULL,         -- (주)/주식회사/공백 제거 소문자
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES po_suppliers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_po_supplier_aliases_sup ON po_supplier_aliases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_supplier_aliases_norm ON po_supplier_aliases(normalized_alias);

-- -----------------------------------------------------------
-- 2. ERP 입고 이력 (업로드된 원본)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_erp_inbound (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inbound_date TEXT NOT NULL,             -- 입고일 YYYY-MM-DD
  item_code TEXT NOT NULL,                -- 품목코드
  item_name TEXT NOT NULL,                -- 품목명
  lot_number TEXT NOT NULL,               -- 입고번호
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  supplier_raw TEXT,                      -- 업체명 원본
  supplier_id INTEGER,                    -- 정규화 매칭된 공급업체
  category TEXT NOT NULL DEFAULT 'raw',   -- raw(원재료) | sub(부자재) | other
  is_sample INTEGER DEFAULT 0,            -- -S 접미사
  is_excluded INTEGER DEFAULT 0,          -- 제외 처리
  excluded_reason TEXT,
  needs_review INTEGER DEFAULT 0,
  review_reason TEXT,
  dedup_hash TEXT NOT NULL UNIQUE,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES po_suppliers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_po_erp_date ON po_erp_inbound(inbound_date);
CREATE INDEX IF NOT EXISTS idx_po_erp_code ON po_erp_inbound(item_code);
CREATE INDEX IF NOT EXISTS idx_po_erp_sup ON po_erp_inbound(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_erp_lot ON po_erp_inbound(lot_number);
CREATE INDEX IF NOT EXISTS idx_po_erp_excluded ON po_erp_inbound(is_excluded);

-- -----------------------------------------------------------
-- 3. 품목 요약 (ERP 이력에서 자동 집계)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code TEXT NOT NULL UNIQUE,
  item_name TEXT NOT NULL,                -- 최신 이름
  unit TEXT NOT NULL,                     -- 주 단위
  category TEXT NOT NULL DEFAULT 'raw',
  primary_supplier_id INTEGER,            -- 최근 주거래 업체
  last_inbound_date TEXT,
  last_quantity REAL,
  inbound_count INTEGER DEFAULT 0,
  avg_cycle_days INTEGER,                 -- 평균 입고 주기
  memo TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (primary_supplier_id) REFERENCES po_suppliers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_po_items_sup ON po_items(primary_supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_items_cat ON po_items(category);

-- -----------------------------------------------------------
-- 4. 발주 담은 목록 (Cart) - 품목별 입고요청일/비고
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_cart (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL,
  requested_date TEXT,                    -- 입고요청일 (품목별)
  memo TEXT,                              -- 비고 (품목별)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES po_suppliers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_po_cart_sup ON po_cart(supplier_id);

-- -----------------------------------------------------------
-- 5. 발주서 헤더
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_number TEXT NOT NULL UNIQUE,         -- PO-YYYYMMDD-001
  order_date TEXT NOT NULL,               -- 발주일
  supplier_id INTEGER NOT NULL,
  supplier_name_snapshot TEXT NOT NULL,   -- 발주 시점 업체명
  supplier_contact_snapshot TEXT,         -- 담당자
  supplier_phone_snapshot TEXT,           -- 휴대폰
  notes TEXT,                             -- 특이사항 (자유 입력)
  status TEXT DEFAULT 'draft',            -- draft(작성) | sent(보냄) | received(입고완료) | cancelled(취소)
  sent_at DATETIME,
  received_at DATETIME,
  cancelled_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES po_suppliers(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_po_orders_date ON po_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_po_orders_sup ON po_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_orders_status ON po_orders(status);

-- -----------------------------------------------------------
-- 6. 발주서 품목 (금액 없음, 입고요청일 품목별)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL,
  requested_date TEXT,                    -- 입고요청일 (품목별)
  memo TEXT,
  received_qty REAL DEFAULT 0,            -- 입고 매칭용
  received_date TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (po_id) REFERENCES po_orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_po_order_items_po ON po_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_po_order_items_code ON po_order_items(item_code);

-- -----------------------------------------------------------
-- 7. 발주 번호 시퀀스
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_number_sequence (
  date_key TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0
);

-- -----------------------------------------------------------
-- 8. 시스템 설정 (단일 행) - 카톡 문구 중심
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  company_name TEXT DEFAULT '본비반트',
  contact_person TEXT DEFAULT '',
  contact_phone TEXT DEFAULT '',
  delivery_address TEXT DEFAULT '',       -- 입고 장소 주소
  kakao_template TEXT DEFAULT '안녕하세요, {회사명} {담당자}입니다.
아래 원료 발주 드립니다.

{품목목록}

입고요청일: {입고요청일}

확인 부탁드립니다. 감사합니다.',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO po_settings (id, company_name) VALUES (1, '본비반트');

-- -----------------------------------------------------------
-- 9. 업로드 로그
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_upload_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  source TEXT,
  total_rows INTEGER,
  inserted_rows INTEGER,
  duplicate_rows INTEGER,
  excluded_rows INTEGER,
  review_rows INTEGER,
  message TEXT
);

-- -----------------------------------------------------------
-- 10. 공급업체 시드 + 별칭 (요구사항 2 통합 목록)
-- -----------------------------------------------------------
INSERT OR IGNORE INTO po_suppliers (name) VALUES
  ('풍림푸드'), ('브이비푸드'), ('에쓰푸드'), ('내츄럴에프앤비'),
  ('웰푸드시스템'), ('플러스오케이'), ('디에스글로벌'), ('사조동아원'),
  ('조흥'), ('맑은들'), ('에이엘'), ('베이크어바웃'),
  ('프레롱'), ('한주통상'), ('주피터인터네셔널'), ('범호통상'),
  ('열매마을');

INSERT OR IGNORE INTO po_supplier_aliases (supplier_id, alias, normalized_alias) VALUES
  ((SELECT id FROM po_suppliers WHERE name='풍림푸드'), '풍림푸드', '풍림푸드'),
  ((SELECT id FROM po_suppliers WHERE name='풍림푸드'), '(주)풍림푸드', '풍림푸드'),
  ((SELECT id FROM po_suppliers WHERE name='풍림푸드'), '품링푸드', '품링푸드'),
  ((SELECT id FROM po_suppliers WHERE name='풍림푸드'), '(주', '(주'),
  ((SELECT id FROM po_suppliers WHERE name='브이비푸드'), '브이비푸드', '브이비푸드'),
  ((SELECT id FROM po_suppliers WHERE name='브이비푸드'), '주식회사 브이비푸드', '브이비푸드'),
  ((SELECT id FROM po_suppliers WHERE name='브이비푸드'), '브이피푸드', '브이피푸드'),
  ((SELECT id FROM po_suppliers WHERE name='에쓰푸드'), '에쓰푸드', '에쓰푸드'),
  ((SELECT id FROM po_suppliers WHERE name='에쓰푸드'), '애쓰푸드', '애쓰푸드'),
  ((SELECT id FROM po_suppliers WHERE name='내츄럴에프앤비'), '내츄럴에프앤비', '내츄럴에프앤비'),
  ((SELECT id FROM po_suppliers WHERE name='내츄럴에프앤비'), '(주)네츄럴에프앤비', '네츄럴에프앤비'),
  ((SELECT id FROM po_suppliers WHERE name='내츄럴에프앤비'), '네츄럴에프엔비', '네츄럴에프엔비'),
  ((SELECT id FROM po_suppliers WHERE name='내츄럴에프앤비'), '네추럴에프엔비', '네추럴에프엔비'),
  ((SELECT id FROM po_suppliers WHERE name='웰푸드시스템'), '웰푸드시스템', '웰푸드시스템'),
  ((SELECT id FROM po_suppliers WHERE name='웰푸드시스템'), '웰푸드', '웰푸드'),
  ((SELECT id FROM po_suppliers WHERE name='플러스오케이'), '플러스오케이', '플러스오케이'),
  ((SELECT id FROM po_suppliers WHERE name='플러스오케이'), '플러스오케이(주)', '플러스오케이'),
  ((SELECT id FROM po_suppliers WHERE name='디에스글로벌'), '디에스글로벌', '디에스글로벌'),
  ((SELECT id FROM po_suppliers WHERE name='디에스글로벌'), '(주)디에스글로벌', '디에스글로벌'),
  ((SELECT id FROM po_suppliers WHERE name='사조동아원'), '사조동아원', '사조동아원'),
  ((SELECT id FROM po_suppliers WHERE name='사조동아원'), '사조동아원(주)', '사조동아원'),
  ((SELECT id FROM po_suppliers WHERE name='조흥'), '조흥', '조흥'),
  ((SELECT id FROM po_suppliers WHERE name='조흥'), '(주)조흥', '조흥'),
  ((SELECT id FROM po_suppliers WHERE name='맑은들'), '맑은들', '맑은들'),
  ((SELECT id FROM po_suppliers WHERE name='맑은들'), '맑은들(주)', '맑은들'),
  ((SELECT id FROM po_suppliers WHERE name='에이엘'), '에이엘', '에이엘'),
  ((SELECT id FROM po_suppliers WHERE name='에이엘'), '주식회사 에이엘', '에이엘'),
  ((SELECT id FROM po_suppliers WHERE name='베이크어바웃'), '베이크어바웃', '베이크어바웃'),
  ((SELECT id FROM po_suppliers WHERE name='베이크어바웃'), '주식회사 베이크어바웃', '베이크어바웃'),
  ((SELECT id FROM po_suppliers WHERE name='프레롱'), '프레롱', '프레롱'),
  ((SELECT id FROM po_suppliers WHERE name='프레롱'), '주식회사 프레롱', '프레롱'),
  ((SELECT id FROM po_suppliers WHERE name='한주통상'), '한주통상', '한주통상'),
  ((SELECT id FROM po_suppliers WHERE name='한주통상'), '(주)한주종합통상', '한주종합통상'),
  ((SELECT id FROM po_suppliers WHERE name='주피터인터네셔널'), '주피터인터네셔널', '주피터인터네셔널'),
  ((SELECT id FROM po_suppliers WHERE name='주피터인터네셔널'), '주피터', '주피터'),
  ((SELECT id FROM po_suppliers WHERE name='범호통상'), '범호통상', '범호통상'),
  ((SELECT id FROM po_suppliers WHERE name='열매마을'), '열매마을', '열매마을');
