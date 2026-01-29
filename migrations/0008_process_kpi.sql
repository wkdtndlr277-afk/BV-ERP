-- ===========================================
-- 공정별 품질 KPI 테이블 (미생물 검사와 분리)
-- 본비반트 베이커리 HACCP 기준
-- ===========================================

-- 기존 테이블 백업용 (혹시 모를 데이터 보존)
-- DROP TABLE IF EXISTS quality_kpi_backup;
-- CREATE TABLE quality_kpi_backup AS SELECT * FROM quality_kpi;

-- ===========================================
-- 1. KPI 마스터 (공정별 KPI 항목 정의)
-- ===========================================
CREATE TABLE IF NOT EXISTS kpi_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  process_type TEXT NOT NULL,  -- 숙성, 성형1, 성형2, 오븐, 공통
  kpi_code TEXT UNIQUE NOT NULL,
  kpi_name TEXT NOT NULL,
  unit TEXT,                   -- ℃, 분, %, 개 등
  standard_min REAL,           -- 최소 기준값
  standard_max REAL,           -- 최대 기준값
  standard_text TEXT,          -- 텍스트 기준 (예: "음성")
  input_type TEXT DEFAULT 'number', -- number, text, select
  display_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ===========================================
-- 2. 일별 공정 KPI 기록 (수기 입력)
-- ===========================================
CREATE TABLE IF NOT EXISTS daily_process_kpi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_date DATE NOT NULL,
  record_time TEXT,            -- HH:MM 형식
  process_type TEXT NOT NULL,  -- 숙성, 성형1, 성형2, 오븐
  
  -- 제품/배치 정보
  product_name TEXT,           -- 제품명
  batch_no TEXT,               -- 배치번호
  
  -- KPI 값들 (JSON 형태로 저장)
  kpi_values TEXT,             -- JSON: {"저온숙성시간": 120, "발효온도": 28, ...}
  
  -- 판정
  judgment TEXT DEFAULT '적합' CHECK (judgment IN ('적합', '부적합', '보류')),
  
  -- 작업자 및 비고
  worker_name TEXT,
  memo TEXT,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ===========================================
-- 3. 숙성 공정 KPI (상세 테이블)
-- ===========================================
CREATE TABLE IF NOT EXISTS kpi_aging (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_date DATE NOT NULL,
  record_time TEXT,
  product_name TEXT,
  batch_no TEXT,
  
  -- 저온숙성 시간 (분)
  cold_aging_time INTEGER,
  cold_aging_standard TEXT DEFAULT '60-120분',
  cold_aging_judgment TEXT DEFAULT '적합',
  
  -- 발효 온도 (℃)
  ferment_temp REAL,
  ferment_temp_standard TEXT DEFAULT '27±2℃',
  ferment_temp_judgment TEXT DEFAULT '적합',
  
  -- 최고 온도 (℃)
  max_temp REAL,
  max_temp_standard TEXT DEFAULT '30℃ 이하',
  max_temp_judgment TEXT DEFAULT '적합',
  
  -- 종합
  overall_judgment TEXT DEFAULT '적합',
  worker_name TEXT,
  memo TEXT,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ===========================================
-- 4. 성형1 공정 KPI (반죽→분할→1차발효→벤치→성형→2차발효)
-- ===========================================
CREATE TABLE IF NOT EXISTS kpi_forming1 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_date DATE NOT NULL,
  record_time TEXT,
  product_name TEXT,
  batch_no TEXT,
  
  -- 반죽 온도 (℃)
  dough_temp REAL,
  dough_temp_standard TEXT DEFAULT '24-26℃',
  dough_temp_judgment TEXT DEFAULT '적합',
  
  -- 분할 중량 (g)
  divide_weight REAL,
  divide_weight_standard TEXT,
  divide_weight_judgment TEXT DEFAULT '적합',
  
  -- 1차 발효 시간 (분)
  first_ferment_time INTEGER,
  first_ferment_standard TEXT DEFAULT '30-60분',
  first_ferment_judgment TEXT DEFAULT '적합',
  
  -- 발효 온도 (℃)
  ferment_temp REAL,
  ferment_temp_standard TEXT DEFAULT '27±2℃',
  ferment_temp_judgment TEXT DEFAULT '적합',
  
  -- 벤치 타임 (분)
  bench_time INTEGER,
  bench_time_standard TEXT DEFAULT '15-20분',
  bench_time_judgment TEXT DEFAULT '적합',
  
  -- 성형 시간 (분)
  forming_time INTEGER,
  forming_time_standard TEXT,
  forming_time_judgment TEXT DEFAULT '적합',
  
  -- 2차 발효 시간 (분)
  second_ferment_time INTEGER,
  second_ferment_standard TEXT DEFAULT '40-60분',
  second_ferment_judgment TEXT DEFAULT '적합',
  
  -- 종합
  overall_judgment TEXT DEFAULT '적합',
  worker_name TEXT,
  memo TEXT,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ===========================================
-- 5. 성형2 공정 KPI (반죽→분할→1차발효시간→발효→벤치→성형)
-- ===========================================
CREATE TABLE IF NOT EXISTS kpi_forming2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_date DATE NOT NULL,
  record_time TEXT,
  product_name TEXT,
  batch_no TEXT,
  
  -- 반죽 온도 (℃)
  dough_temp REAL,
  dough_temp_standard TEXT DEFAULT '24-26℃',
  dough_temp_judgment TEXT DEFAULT '적합',
  
  -- 분할 중량 (g)
  divide_weight REAL,
  divide_weight_standard TEXT,
  divide_weight_judgment TEXT DEFAULT '적합',
  
  -- 1차 발효 시간 (분)
  first_ferment_time INTEGER,
  first_ferment_standard TEXT DEFAULT '30-60분',
  first_ferment_judgment TEXT DEFAULT '적합',
  
  -- 발효 온도 (℃)
  ferment_temp REAL,
  ferment_temp_standard TEXT DEFAULT '27±2℃',
  ferment_temp_judgment TEXT DEFAULT '적합',
  
  -- 벤치 타임 (분)
  bench_time INTEGER,
  bench_time_standard TEXT DEFAULT '15-20분',
  bench_time_judgment TEXT DEFAULT '적합',
  
  -- 성형 시간 (분)
  forming_time INTEGER,
  forming_time_standard TEXT,
  forming_time_judgment TEXT DEFAULT '적합',
  
  -- 종합
  overall_judgment TEXT DEFAULT '적합',
  worker_name TEXT,
  memo TEXT,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ===========================================
-- 6. 오븐 공정 KPI
-- ===========================================
CREATE TABLE IF NOT EXISTS kpi_oven (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_date DATE NOT NULL,
  record_time TEXT,
  product_name TEXT,
  batch_no TEXT,
  
  -- 실온 발효 시간 (분)
  room_ferment_time INTEGER,
  room_ferment_standard TEXT,
  room_ferment_judgment TEXT DEFAULT '적합',
  
  -- 쿠프(Coupe) 시간 (분)
  coupe_time INTEGER,
  coupe_time_standard TEXT,
  coupe_time_judgment TEXT DEFAULT '적합',
  
  -- 오븐 온도 (℃)
  oven_temp REAL,
  oven_temp_standard TEXT DEFAULT '180±10℃',
  oven_temp_judgment TEXT DEFAULT '적합',
  
  -- 굽기 시간 (분)
  baking_time INTEGER,
  baking_time_standard TEXT,
  baking_time_judgment TEXT DEFAULT '적합',
  
  -- 중심 온도 (℃) - CCP
  core_temp REAL,
  core_temp_standard TEXT DEFAULT '74℃ 이상',
  core_temp_judgment TEXT DEFAULT '적합',
  
  -- 종합
  overall_judgment TEXT DEFAULT '적합',
  worker_name TEXT,
  memo TEXT,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ===========================================
-- 인덱스 생성
-- ===========================================
CREATE INDEX IF NOT EXISTS idx_kpi_master_process ON kpi_master(process_type);
CREATE INDEX IF NOT EXISTS idx_daily_process_kpi_date ON daily_process_kpi(record_date);
CREATE INDEX IF NOT EXISTS idx_daily_process_kpi_process ON daily_process_kpi(process_type);
CREATE INDEX IF NOT EXISTS idx_kpi_aging_date ON kpi_aging(record_date);
CREATE INDEX IF NOT EXISTS idx_kpi_forming1_date ON kpi_forming1(record_date);
CREATE INDEX IF NOT EXISTS idx_kpi_forming2_date ON kpi_forming2(record_date);
CREATE INDEX IF NOT EXISTS idx_kpi_oven_date ON kpi_oven(record_date);

-- ===========================================
-- 기본 KPI 마스터 데이터
-- ===========================================

-- 숙성 공정 KPI
INSERT OR IGNORE INTO kpi_master (process_type, kpi_code, kpi_name, unit, standard_min, standard_max, standard_text, display_order) VALUES
('숙성', 'AG001', '저온숙성시간', '분', 60, 120, '60-120분', 1),
('숙성', 'AG002', '발효온도', '℃', 25, 29, '27±2℃', 2),
('숙성', 'AG003', '최고온도', '℃', NULL, 30, '30℃ 이하', 3);

-- 성형1 공정 KPI
INSERT OR IGNORE INTO kpi_master (process_type, kpi_code, kpi_name, unit, standard_min, standard_max, standard_text, display_order) VALUES
('성형1', 'F1001', '반죽온도', '℃', 24, 26, '24-26℃', 1),
('성형1', 'F1002', '분할중량', 'g', NULL, NULL, '제품별 상이', 2),
('성형1', 'F1003', '1차발효시간', '분', 30, 60, '30-60분', 3),
('성형1', 'F1004', '발효온도', '℃', 25, 29, '27±2℃', 4),
('성형1', 'F1005', '벤치타임', '분', 15, 20, '15-20분', 5),
('성형1', 'F1006', '성형시간', '분', NULL, NULL, '제품별 상이', 6),
('성형1', 'F1007', '2차발효시간', '분', 40, 60, '40-60분', 7);

-- 성형2 공정 KPI
INSERT OR IGNORE INTO kpi_master (process_type, kpi_code, kpi_name, unit, standard_min, standard_max, standard_text, display_order) VALUES
('성형2', 'F2001', '반죽온도', '℃', 24, 26, '24-26℃', 1),
('성형2', 'F2002', '분할중량', 'g', NULL, NULL, '제품별 상이', 2),
('성형2', 'F2003', '1차발효시간', '분', 30, 60, '30-60분', 3),
('성형2', 'F2004', '발효온도', '℃', 25, 29, '27±2℃', 4),
('성형2', 'F2005', '벤치타임', '분', 15, 20, '15-20분', 5),
('성형2', 'F2006', '성형시간', '분', NULL, NULL, '제품별 상이', 6);

-- 오븐 공정 KPI
INSERT OR IGNORE INTO kpi_master (process_type, kpi_code, kpi_name, unit, standard_min, standard_max, standard_text, display_order) VALUES
('오븐', 'OV001', '실온발효시간', '분', NULL, NULL, '제품별 상이', 1),
('오븐', 'OV002', '쿠프시간', '분', NULL, NULL, '제품별 상이', 2),
('오븐', 'OV003', '오븐온도', '℃', 170, 190, '180±10℃', 3),
('오븐', 'OV004', '굽기시간', '분', NULL, NULL, '제품별 상이', 4),
('오븐', 'OV005', '중심온도(CCP)', '℃', 74, NULL, '74℃ 이상', 5);

-- 공통 KPI (일반)
INSERT OR IGNORE INTO kpi_master (process_type, kpi_code, kpi_name, unit, standard_min, standard_max, standard_text, display_order) VALUES
('공통', 'CM001', '작업장온도', '℃', 18, 25, '18-25℃', 1),
('공통', 'CM002', '작업장습도', '%', 50, 70, '50-70%', 2),
('공통', 'CM003', '냉장고온도', '℃', 0, 5, '0-5℃', 3),
('공통', 'CM004', '냉동고온도', '℃', -25, -18, '-18℃ 이하', 4);
