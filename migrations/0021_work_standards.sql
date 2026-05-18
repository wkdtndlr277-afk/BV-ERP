-- 작업표준서(SOP) 테이블
CREATE TABLE IF NOT EXISTS work_standards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL,           -- 제품코드 (production_code)
  product_name TEXT NOT NULL,           -- 제품명
  product_type TEXT,                    -- 유형 (과자류, 빵류 등)
  version TEXT DEFAULT '1.0',           -- 버전
  effective_date DATE,                  -- 제정일자
  package_spec TEXT,                    -- 포장규격
  process_no TEXT,                      -- 공정번호
  sales_channel TEXT,                   -- 판매처
  pdf_url TEXT,                         -- PDF 파일 URL
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT,
  UNIQUE(product_code, version)
);

-- 작업표준서 원료 배합비
CREATE TABLE IF NOT EXISTS work_standard_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_standard_id INTEGER NOT NULL,
  seq_no INTEGER,                       -- 순번
  category TEXT,                        -- 구분 (가, 나, 다...)
  item_code TEXT,                       -- 원료코드
  item_name TEXT NOT NULL,              -- 원료명
  ratio REAL,                           -- 배합비(%)
  quantity REAL,                        -- 투입량(kg)
  supplier TEXT,                        -- 납품처
  remarks TEXT,                         -- 비고
  FOREIGN KEY (work_standard_id) REFERENCES work_standards(id) ON DELETE CASCADE
);

-- 작업표준서 공정 단계
CREATE TABLE IF NOT EXISTS work_standard_processes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_standard_id INTEGER NOT NULL,
  step_no INTEGER NOT NULL,             -- 공정 순번
  process_name TEXT NOT NULL,           -- 공정명
  work_method TEXT,                     -- 작업 방법 및 기준
  check_points TEXT,                    -- 체크 포인트
  equipment TEXT,                       -- 사용 장비
  time_standard TEXT,                   -- 시간 기준
  temperature TEXT,                     -- 온도 기준
  FOREIGN KEY (work_standard_id) REFERENCES work_standards(id) ON DELETE CASCADE
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_work_standards_product ON work_standards(product_code);
CREATE INDEX IF NOT EXISTS idx_work_standard_ingredients ON work_standard_ingredients(work_standard_id);
CREATE INDEX IF NOT EXISTS idx_work_standard_processes ON work_standard_processes(work_standard_id);
