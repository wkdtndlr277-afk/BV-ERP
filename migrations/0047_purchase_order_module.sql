-- =============================================================
-- 0047: 구매발주 관리 모듈 (Purchase Order Management)
-- =============================================================
-- 독립 모듈. 기존 ERP 테이블과 분리되어 운영됨.
-- 네임스페이스: po_* (purchase order)
-- =============================================================

-- -----------------------------------------------------------
-- 1. 공급업체 (별칭 자동 통합)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,            -- 표준 업체명 (예: 풍림푸드)
  business_number TEXT,                 -- 사업자번호
  contact_person TEXT,                  -- 담당자
  email TEXT,                           -- 이메일
  phone TEXT,                           -- 전화
  fax TEXT,                             -- 팩스
  address TEXT,                         -- 주소
  payment_terms TEXT,                   -- 결제조건 (예: 월말마감 익월 15일)
  memo TEXT,                            -- 메모
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_po_suppliers_name ON po_suppliers(name);
CREATE INDEX IF NOT EXISTS idx_po_suppliers_active ON po_suppliers(is_active);

-- 공급업체 별칭 (업로드 시 자동 매칭)
CREATE TABLE IF NOT EXISTS po_supplier_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  alias TEXT NOT NULL UNIQUE,           -- 정규화 전 원본 (예: (주)풍림푸드, 품링푸드)
  normalized_alias TEXT NOT NULL,       -- 정규화 후 (주/공백 제거) 소문자
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
  inbound_date TEXT NOT NULL,                     -- 입고일 YYYY-MM-DD
  material_code TEXT NOT NULL,                    -- 원료코드 R099, SM006
  material_name TEXT NOT NULL,                    -- 원료명
  lot_number TEXT NOT NULL,                       -- 입고번호 20261020-R099-001
  quantity REAL NOT NULL,                         -- 수량 (소수 가능)
  unit TEXT NOT NULL,                             -- kg, ea, box, roll
  supplier_raw TEXT,                              -- 업체명 원본 (업로드 시점)
  supplier_id INTEGER,                            -- 정규화 후 매칭된 공급업체
  category TEXT NOT NULL DEFAULT 'raw',           -- raw(원재료 R/RM) | sub(부자재 SM) | other
  is_sample INTEGER DEFAULT 0,                    -- 입고번호 -S 접미사
  is_excluded INTEGER DEFAULT 0,                  -- 제외 처리 (재고조정/테스트 등)
  excluded_reason TEXT,                           -- 제외 사유
  needs_review INTEGER DEFAULT 0,                 -- 확인 필요
  review_reason TEXT,                             -- 확인 사유 (코드-원료명 불일치 / 날짜 불일치 등)
  dedup_hash TEXT NOT NULL UNIQUE,                -- 중복 방지 해시 (date+code+lot+qty+supplier)
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES po_suppliers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_po_erp_date ON po_erp_inbound(inbound_date);
CREATE INDEX IF NOT EXISTS idx_po_erp_mcode ON po_erp_inbound(material_code);
CREATE INDEX IF NOT EXISTS idx_po_erp_sup ON po_erp_inbound(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_erp_lot ON po_erp_inbound(lot_number);
CREATE INDEX IF NOT EXISTS idx_po_erp_excluded ON po_erp_inbound(is_excluded);

-- -----------------------------------------------------------
-- 3. 원료 마스터 (ERP 업로드 데이터에서 자동 집계되는 요약)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_code TEXT NOT NULL UNIQUE,
  material_name TEXT NOT NULL,                    -- 최신 이름 (복수일 경우 가장 최근)
  unit TEXT NOT NULL,                             -- 주 단위
  category TEXT NOT NULL DEFAULT 'raw',
  primary_supplier_id INTEGER,                    -- 최근 주거래 업체
  last_inbound_date TEXT,                         -- 최근 입고일
  last_quantity REAL,                             -- 최근 수량
  avg_quantity REAL,                              -- 평균 수량
  inbound_count INTEGER DEFAULT 0,                -- 입고 횟수
  avg_cycle_days INTEGER,                         -- 평균 주기 (일)
  next_expected_date TEXT,                        -- 다음 예상 발주일
  memo TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (primary_supplier_id) REFERENCES po_suppliers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_po_materials_sup ON po_materials(primary_supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_materials_cat ON po_materials(category);
CREATE INDEX IF NOT EXISTS idx_po_materials_next ON po_materials(next_expected_date);

-- -----------------------------------------------------------
-- 4. 업체별 원료별 단가표 (ERP에는 단가가 없으므로 별도 관리)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_price_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  material_code TEXT NOT NULL,
  unit_price REAL NOT NULL DEFAULT 0,             -- 단가
  unit TEXT,                                      -- 단가 기준 단위
  effective_date TEXT,                            -- 적용 시작일
  memo TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES po_suppliers(id) ON DELETE CASCADE,
  UNIQUE(supplier_id, material_code)
);

CREATE INDEX IF NOT EXISTS idx_po_price_sup ON po_price_list(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_price_code ON po_price_list(material_code);

-- 단가 변동 이력
CREATE TABLE IF NOT EXISTS po_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  material_code TEXT NOT NULL,
  old_price REAL,
  new_price REAL NOT NULL,
  changed_by TEXT,                                -- 'manual' | 'po:PO-20261020-001'
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES po_suppliers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_po_price_hist_sup ON po_price_history(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_price_hist_code ON po_price_history(material_code);

-- -----------------------------------------------------------
-- 5. 발주 대기 (Cart)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_cart (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  material_code TEXT NOT NULL,
  material_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL DEFAULT 0,
  amount REAL DEFAULT 0,                          -- 수량 * 단가
  delivery_date TEXT,                             -- 납기일
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES po_suppliers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_po_cart_sup ON po_cart(supplier_id);

-- -----------------------------------------------------------
-- 6. 발주서 (Purchase Order) - 헤더
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_number TEXT NOT NULL UNIQUE,                 -- PO-YYYYMMDD-001
  order_date TEXT NOT NULL,                       -- 발주일 YYYY-MM-DD
  supplier_id INTEGER NOT NULL,
  supplier_name_snapshot TEXT NOT NULL,           -- 발주 시점 업체명 보존
  supplier_contact_snapshot TEXT,                 -- 담당자 보존
  supplier_email_snapshot TEXT,
  supplier_phone_snapshot TEXT,
  supplier_fax_snapshot TEXT,
  supplier_address_snapshot TEXT,
  delivery_date TEXT,                             -- 전체 납기일
  delivery_place TEXT,                            -- 납품장소
  payment_terms TEXT,                             -- 결제조건
  vat_mode TEXT DEFAULT 'exclude',                -- exclude(별도) | include(포함) | exempt(면세)
  subtotal REAL DEFAULT 0,                        -- 공급가액
  vat REAL DEFAULT 0,                             -- 부가세
  total REAL DEFAULT 0,                           -- 합계
  memo TEXT,
  status TEXT DEFAULT 'pending',                  -- pending(발송대기) | sent(발송완료) | received(입고완료) | cancelled(취소)
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
CREATE INDEX IF NOT EXISTS idx_po_orders_delivery ON po_orders(delivery_date);

-- -----------------------------------------------------------
-- 7. 발주서 품목 (Lines)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,                           -- 품목 순번 (1부터)
  material_code TEXT NOT NULL,
  material_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  memo TEXT,
  received_qty REAL DEFAULT 0,                    -- 입고 확인된 수량 (매칭용)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (po_id) REFERENCES po_orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_po_order_items_po ON po_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_po_order_items_mcode ON po_order_items(material_code);

-- -----------------------------------------------------------
-- 8. 발주 번호 시퀀스 (날짜별)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_number_sequence (
  date_key TEXT PRIMARY KEY,                      -- YYYYMMDD
  last_seq INTEGER NOT NULL DEFAULT 0
);

-- -----------------------------------------------------------
-- 9. 시스템 설정 (단일 행)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  company_name TEXT DEFAULT '본비반트',
  business_number TEXT,
  ceo_name TEXT,
  company_address TEXT,
  company_phone TEXT,
  company_fax TEXT,
  company_email TEXT,
  contact_person TEXT,
  seal_text TEXT DEFAULT '본비반트',
  default_delivery_place TEXT DEFAULT '본사 창고',
  default_payment_terms TEXT DEFAULT '월말마감 익월 15일 결제',
  default_memo TEXT,
  default_vat_mode TEXT DEFAULT 'exclude',
  mail_subject_template TEXT DEFAULT '[{회사명}] 발주서 송부 ({발주번호})',
  mail_body_template TEXT DEFAULT '{업체명} {담당자} 담당자님께\n\n안녕하세요. {회사명}입니다.\n발주서({발주번호})를 첨부하여 송부드립니다.\n\n- 납기일: {납기일}\n- 합계금액: {합계금액}원\n\n확인 후 회신 부탁드립니다.\n감사합니다.',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 설정 기본 행 삽입
INSERT OR IGNORE INTO po_settings (id, company_name) VALUES (1, '본비반트');

-- -----------------------------------------------------------
-- 10. 업로드 로그 (최근 업로드 추적용)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_upload_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  source TEXT,                                    -- paste | file:csv | file:xlsx
  total_rows INTEGER,
  inserted_rows INTEGER,
  duplicate_rows INTEGER,
  excluded_rows INTEGER,
  review_rows INTEGER,
  message TEXT
);
