-- 미생물 검사 결과 테이블
CREATE TABLE IF NOT EXISTS Microbial_Test (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_date DATE NOT NULL,
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  
  -- 일반세균 (CFU/g)
  total_bacteria TEXT,
  total_bacteria_standard TEXT DEFAULT '100,000 이하',
  total_bacteria_judgment TEXT DEFAULT '적합' CHECK (total_bacteria_judgment IN ('적합', '부적합')),
  
  -- 대장균 
  coliform TEXT,
  coliform_standard TEXT DEFAULT '음성',
  coliform_judgment TEXT DEFAULT '적합' CHECK (coliform_judgment IN ('적합', '부적합')),
  
  -- 중량 (최대 5개)
  weight_1 REAL,
  weight_2 REAL,
  weight_3 REAL,
  weight_4 REAL,
  weight_5 REAL,
  weight_avg REAL,
  weight_standard TEXT,
  weight_judgment TEXT DEFAULT '적합' CHECK (weight_judgment IN ('적합', '부적합')),
  
  -- 종합 판정
  overall_judgment TEXT DEFAULT '적합' CHECK (overall_judgment IN ('적합', '부적합')),
  
  -- 검사자 및 메모
  inspector TEXT,
  memo TEXT,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_microbial_test_date ON Microbial_Test(test_date);
CREATE INDEX IF NOT EXISTS idx_microbial_test_product ON Microbial_Test(product_code);
CREATE INDEX IF NOT EXISTS idx_microbial_test_judgment ON Microbial_Test(overall_judgment);
