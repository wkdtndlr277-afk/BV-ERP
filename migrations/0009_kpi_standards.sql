-- KPI 기준 마스터 테이블 (제품별 기준 설정)
-- 제품별로 다른 KPI 기준을 설정할 수 있음

CREATE TABLE IF NOT EXISTS kpi_standards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  process_type TEXT NOT NULL CHECK (process_type IN ('숙성', '성형1', '성형2', '오븐', '공통')),
  product_name TEXT,  -- NULL이면 해당 공정의 기본 기준
  kpi_item TEXT NOT NULL,  -- KPI 항목명 (cold_aging_time, ferment_temp 등)
  kpi_item_label TEXT NOT NULL,  -- 표시명 (저온숙성시간, 발효온도 등)
  min_value REAL,  -- 최소값 (NULL이면 제한 없음)
  max_value REAL,  -- 최대값 (NULL이면 제한 없음)
  unit TEXT,  -- 단위 (분, ℃, g 등)
  is_ccp INTEGER DEFAULT 0,  -- CCP 항목 여부 (1: CCP, 0: 일반)
  is_required INTEGER DEFAULT 0,  -- 필수 입력 여부
  display_order INTEGER DEFAULT 0,  -- 표시 순서
  is_active INTEGER DEFAULT 1,  -- 사용 여부
  memo TEXT,  -- 비고
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_kpi_standards_process ON kpi_standards(process_type);
CREATE INDEX IF NOT EXISTS idx_kpi_standards_product ON kpi_standards(product_name);
CREATE INDEX IF NOT EXISTS idx_kpi_standards_item ON kpi_standards(kpi_item);

-- 기본 KPI 기준 데이터 삽입 (product_name = NULL은 기본값)

-- ============ 숙성 공정 기본 기준 ============
INSERT INTO kpi_standards (process_type, product_name, kpi_item, kpi_item_label, min_value, max_value, unit, is_ccp, is_required, display_order) VALUES
('숙성', NULL, 'cold_aging_time', '저온숙성시간', 60, 120, '분', 0, 1, 1),
('숙성', NULL, 'ferment_temp', '발효온도', 25, 29, '℃', 0, 1, 2),
('숙성', NULL, 'max_temp', '최고온도', NULL, 30, '℃', 0, 1, 3);

-- ============ 성형1 공정 기본 기준 ============
INSERT INTO kpi_standards (process_type, product_name, kpi_item, kpi_item_label, min_value, max_value, unit, is_ccp, is_required, display_order) VALUES
('성형1', NULL, 'dough_temp', '반죽온도', 24, 26, '℃', 0, 1, 1),
('성형1', NULL, 'first_ferment_time', '1차발효시간', 30, 60, '분', 0, 1, 2),
('성형1', NULL, 'ferment_temp', '발효온도', 25, 29, '℃', 0, 1, 3),
('성형1', NULL, 'bench_time', '벤치타임', 15, 20, '분', 0, 1, 4),
('성형1', NULL, 'second_ferment_time', '2차발효시간', 40, 60, '분', 0, 1, 5);

-- ============ 성형2 공정 기본 기준 ============
INSERT INTO kpi_standards (process_type, product_name, kpi_item, kpi_item_label, min_value, max_value, unit, is_ccp, is_required, display_order) VALUES
('성형2', NULL, 'dough_temp', '반죽온도', 24, 26, '℃', 0, 1, 1),
('성형2', NULL, 'first_ferment_time', '1차발효시간', 30, 60, '분', 0, 1, 2),
('성형2', NULL, 'ferment_temp', '발효온도', 25, 29, '℃', 0, 1, 3),
('성형2', NULL, 'bench_time', '벤치타임', 15, 20, '분', 0, 1, 4);

-- ============ 오븐 공정 기본 기준 ============
INSERT INTO kpi_standards (process_type, product_name, kpi_item, kpi_item_label, min_value, max_value, unit, is_ccp, is_required, display_order) VALUES
('오븐', NULL, 'oven_temp', '오븐온도', 170, 190, '℃', 0, 1, 1),
('오븐', NULL, 'core_temp', '중심온도', 74, NULL, '℃', 1, 1, 2);

-- ============ 제품별 예시 기준 ============
-- 식빵: 일반 기준과 동일
INSERT INTO kpi_standards (process_type, product_name, kpi_item, kpi_item_label, min_value, max_value, unit, is_ccp, is_required, display_order) VALUES
('숙성', '식빵', 'cold_aging_time', '저온숙성시간', 60, 120, '분', 0, 1, 1),
('숙성', '식빵', 'ferment_temp', '발효온도', 25, 29, '℃', 0, 1, 2),
('숙성', '식빵', 'max_temp', '최고온도', NULL, 30, '℃', 0, 1, 3);

-- 바게트: 저온숙성 시간이 더 김
INSERT INTO kpi_standards (process_type, product_name, kpi_item, kpi_item_label, min_value, max_value, unit, is_ccp, is_required, display_order) VALUES
('숙성', '바게트', 'cold_aging_time', '저온숙성시간', 90, 180, '분', 0, 1, 1),
('숙성', '바게트', 'ferment_temp', '발효온도', 24, 28, '℃', 0, 1, 2),
('숙성', '바게트', 'max_temp', '최고온도', NULL, 28, '℃', 0, 1, 3);

-- 크루아상: 낮은 온도 필요
INSERT INTO kpi_standards (process_type, product_name, kpi_item, kpi_item_label, min_value, max_value, unit, is_ccp, is_required, display_order) VALUES
('숙성', '크루아상', 'cold_aging_time', '저온숙성시간', 120, 240, '분', 0, 1, 1),
('숙성', '크루아상', 'ferment_temp', '발효온도', 22, 26, '℃', 0, 1, 2),
('숙성', '크루아상', 'max_temp', '최고온도', NULL, 26, '℃', 0, 1, 3);

-- 오븐 제품별 기준
INSERT INTO kpi_standards (process_type, product_name, kpi_item, kpi_item_label, min_value, max_value, unit, is_ccp, is_required, display_order) VALUES
('오븐', '식빵', 'oven_temp', '오븐온도', 180, 200, '℃', 0, 1, 1),
('오븐', '식빵', 'core_temp', '중심온도', 74, NULL, '℃', 1, 1, 2),
('오븐', '바게트', 'oven_temp', '오븐온도', 220, 240, '℃', 0, 1, 1),
('오븐', '바게트', 'core_temp', '중심온도', 74, NULL, '℃', 1, 1, 2),
('오븐', '크루아상', 'oven_temp', '오븐온도', 175, 185, '℃', 0, 1, 1),
('오븐', '크루아상', 'core_temp', '중심온도', 74, NULL, '℃', 1, 1, 2);
