-- 시스템 설정 테이블 (ERP 메타 관리용)
CREATE TABLE IF NOT EXISTS system_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_key TEXT UNIQUE NOT NULL,
  config_value TEXT,
  config_type TEXT DEFAULT 'string',  -- string, number, boolean, json
  category TEXT DEFAULT 'general',    -- general, company, form, code, quality, notification
  description TEXT,
  is_editable INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 양식 템플릿 테이블
CREATE TABLE IF NOT EXISTS form_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_type TEXT UNIQUE NOT NULL,     -- inspection, inbound_check, production_report, lot_label
  form_name TEXT NOT NULL,
  template_html TEXT,                 -- HTML 템플릿
  template_css TEXT,                  -- 추가 CSS
  fields TEXT,                        -- JSON: 필드 정의 [{name, label, type, required, options}]
  is_active INTEGER DEFAULT 1,
  version INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 품질검사 항목 테이블
CREATE TABLE IF NOT EXISTS quality_check_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,             -- 원료, 부자재, 제품, 공정
  check_type TEXT NOT NULL,           -- 외관, 이물, 맛, 냄새, 색상, 수분, 당도 등
  check_name TEXT NOT NULL,
  check_method TEXT,                  -- 검사 방법
  standard_value TEXT,                -- 기준값
  min_value REAL,
  max_value REAL,
  unit TEXT,
  is_required INTEGER DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 코드 생성 규칙 테이블
CREATE TABLE IF NOT EXISTS code_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_type TEXT UNIQUE NOT NULL,     -- material, product, production, lot, document
  rule_name TEXT NOT NULL,
  prefix TEXT,                        -- 접두사 (R, P, PR, LOT 등)
  separator TEXT DEFAULT '',          -- 구분자
  date_format TEXT,                   -- 날짜 형식 (YYMMDD, YYYYMMDD 등)
  sequence_digits INTEGER DEFAULT 3,  -- 일련번호 자릿수
  example TEXT,                       -- 예시
  description TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 카테고리 관리 테이블
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_type TEXT NOT NULL,        -- item, supplier, quality 등
  category_name TEXT NOT NULL,
  parent_id INTEGER,
  display_order INTEGER DEFAULT 0,
  color TEXT,                         -- UI 색상
  icon TEXT,                          -- 아이콘 클래스
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(category_type, category_name)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_system_config_key ON system_config(config_key);
CREATE INDEX IF NOT EXISTS idx_system_config_category ON system_config(category);
CREATE INDEX IF NOT EXISTS idx_form_templates_type ON form_templates(form_type);
CREATE INDEX IF NOT EXISTS idx_quality_check_category ON quality_check_items(category);
CREATE INDEX IF NOT EXISTS idx_categories_type ON categories(category_type);

-- 기본 시스템 설정 데이터 삽입
INSERT OR IGNORE INTO system_config (config_key, config_value, config_type, category, description) VALUES
-- 회사 정보
('company_name', '(주)본비반트', 'string', 'company', '회사명'),
('company_address', '', 'string', 'company', '회사 주소'),
('company_tel', '', 'string', 'company', '회사 전화번호'),
('company_fax', '', 'string', 'company', '회사 팩스번호'),
('company_email', '', 'string', 'company', '회사 이메일'),
('company_ceo', '', 'string', 'company', '대표자명'),
('company_business_number', '', 'string', 'company', '사업자등록번호'),
('company_haccp_number', '', 'string', 'company', 'HACCP 인증번호'),

-- 일반 설정
('default_unit', 'kg', 'string', 'general', '기본 단위'),
('default_expiry_days', '365', 'number', 'general', '기본 유통기한(일)'),
('stock_warning_percent', '20', 'number', 'general', '재고 경고 기준(%)'),
('lot_expiry_warning_days', '30', 'number', 'general', 'LOT 만료 경고 기준(일)'),

-- 알림 설정
('notify_low_stock', 'true', 'boolean', 'notification', '재고 부족 알림'),
('notify_expiry_soon', 'true', 'boolean', 'notification', '유통기한 임박 알림'),
('notify_email_enabled', 'false', 'boolean', 'notification', '이메일 알림 사용'),

-- 시스템 설정
('date_format', 'YYYY-MM-DD', 'string', 'general', '날짜 형식'),
('timezone', 'Asia/Seoul', 'string', 'general', '시간대'),
('language', 'ko', 'string', 'general', '언어');

-- 기본 코드 규칙 삽입
INSERT OR IGNORE INTO code_rules (rule_type, rule_name, prefix, sequence_digits, example, description) VALUES
('material', '원료 코드', 'R', 3, 'R001, R002', '원료 품목 코드 생성 규칙'),
('submaterial', '부자재 코드', 'S', 3, 'S001, S002', '부자재 품목 코드 생성 규칙'),
('product', '제품 코드', 'P', 3, 'P001, P002', '제품 품목 코드 생성 규칙'),
('production', '생산명 코드', 'PR', 3, 'PR001, PR002', '생산명 코드 생성 규칙'),
('lot', 'LOT 번호', 'LOT', 4, 'LOT240403-0001', 'LOT 번호 생성 규칙 (날짜+일련번호)'),
('document', '문서 번호', 'DOC', 4, 'DOC-2024-0001', '문서 번호 생성 규칙');

-- 기본 품질검사 항목 삽입
INSERT OR IGNORE INTO quality_check_items (category, check_type, check_name, check_method, standard_value, is_required, display_order) VALUES
-- 원료 검사 항목
('원료', '외관', '외관 검사', '육안 검사', '이상 없음', 1, 1),
('원료', '이물', '이물질 검사', '육안 검사', '이물 없음', 1, 2),
('원료', '냄새', '냄새 검사', '관능 검사', '이취 없음', 1, 3),
('원료', '포장상태', '포장 상태', '육안 검사', '양호', 1, 4),

-- 부자재 검사 항목
('부자재', '외관', '외관 검사', '육안 검사', '이상 없음', 1, 1),
('부자재', '이물', '이물질 검사', '육안 검사', '이물 없음', 1, 2),
('부자재', '파손', '파손 여부', '육안 검사', '파손 없음', 1, 3),

-- 제품 검사 항목
('제품', '외관', '외관 검사', '육안 검사', '이상 없음', 1, 1),
('제품', '이물', '이물질 검사', '육안 검사', '이물 없음', 1, 2),
('제품', '맛', '맛 검사', '관능 검사', '양호', 1, 3),
('제품', '색상', '색상 검사', '육안 검사', '양호', 1, 4),
('제품', '조직감', '조직감 검사', '관능 검사', '양호', 0, 5);

-- 기본 카테고리 삽입
INSERT OR IGNORE INTO categories (category_type, category_name, display_order, color, icon) VALUES
('item', '원료', 1, 'blue', 'fa-flask'),
('item', '부자재', 2, 'gray', 'fa-box'),
('item', '소모품', 3, 'yellow', 'fa-tools'),
('item', '제품', 4, 'green', 'fa-bread-slice'),
('supplier', '원료 공급사', 1, 'blue', 'fa-truck'),
('supplier', '부자재 공급사', 2, 'gray', 'fa-boxes'),
('supplier', '기타', 3, 'yellow', 'fa-building');
