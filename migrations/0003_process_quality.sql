-- 반제품 공정 품질 관리 테이블
CREATE TABLE IF NOT EXISTS process_quality (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_date DATE NOT NULL,
  record_time TEXT,
  dough_name TEXT NOT NULL,
  dough_temp REAL,
  dough_temp_standard TEXT DEFAULT '24-26°C',
  dough_temp_judgment TEXT DEFAULT '적합' CHECK (dough_temp_judgment IN ('적합', '부적합')),
  ph_value REAL,
  ph_standard TEXT DEFAULT '5.5-6.5',
  ph_judgment TEXT DEFAULT '적합' CHECK (ph_judgment IN ('적합', '부적합')),
  humidity REAL,
  humidity_standard TEXT DEFAULT '60-70%',
  humidity_judgment TEXT DEFAULT '적합' CHECK (humidity_judgment IN ('적합', '부적합')),
  fermentation_time INTEGER,
  fermentation_standard TEXT,
  fermentation_judgment TEXT DEFAULT '적합' CHECK (fermentation_judgment IN ('적합', '부적합')),
  worker_name TEXT,
  memo TEXT,
  overall_judgment TEXT DEFAULT '적합' CHECK (overall_judgment IN ('적합', '부적합')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 반제품 마스터 (반죽 종류)
CREATE TABLE IF NOT EXISTS dough_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dough_code TEXT UNIQUE NOT NULL,
  dough_name TEXT NOT NULL,
  temp_min REAL DEFAULT 24,
  temp_max REAL DEFAULT 26,
  ph_min REAL DEFAULT 5.5,
  ph_max REAL DEFAULT 6.5,
  humidity_min REAL DEFAULT 60,
  humidity_max REAL DEFAULT 70,
  fermentation_min INTEGER,
  fermentation_max INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_process_quality_date ON process_quality(record_date);
CREATE INDEX IF NOT EXISTS idx_process_quality_dough ON process_quality(dough_name);
CREATE INDEX IF NOT EXISTS idx_dough_master_code ON dough_master(dough_code);

-- 기본 반죽 마스터 데이터
INSERT OR IGNORE INTO dough_master (dough_code, dough_name, temp_min, temp_max, ph_min, ph_max, humidity_min, humidity_max, fermentation_min, fermentation_max)
VALUES 
  ('DG001', '식빵반죽', 24, 26, 5.5, 6.5, 60, 70, 60, 90),
  ('DG002', '바게트반죽', 22, 24, 5.5, 6.0, 65, 75, 90, 120),
  ('DG003', '크루아상반죽', 18, 20, 5.5, 6.0, 55, 65, 30, 45),
  ('DG004', '브리오슈반죽', 24, 26, 5.5, 6.5, 60, 70, 60, 90),
  ('DG005', '치아바타반죽', 24, 26, 5.5, 6.5, 70, 80, 120, 180),
  ('DG006', '단팥빵반죽', 26, 28, 5.5, 6.5, 60, 70, 40, 60),
  ('DG007', '소보로반죽', 24, 26, 5.5, 6.5, 55, 65, 30, 45),
  ('DG008', '베이글반죽', 22, 24, 5.5, 6.0, 60, 70, 60, 90);
