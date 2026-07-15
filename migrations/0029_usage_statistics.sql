-- ★★★ v3.6.79: 원료 사용 통계 컬럼 추가 ★★★
-- master 테이블에 일평균, 월평균, 입고빈도, 리드타임 컬럼 추가

-- 일평균 사용량 (최근 30일 기준)
ALTER TABLE master ADD COLUMN daily_usage_avg REAL DEFAULT 0;

-- 월평균 사용량 (최근 90일 기준)
ALTER TABLE master ADD COLUMN monthly_usage_avg REAL DEFAULT 0;

-- 입고 빈도 (월 평균 입고 횟수)
ALTER TABLE master ADD COLUMN inbound_frequency REAL DEFAULT 0;

-- 리드타임 (평균 입고 주기, 일 단위)
ALTER TABLE master ADD COLUMN lead_time REAL DEFAULT 3;

-- 사용량 표준편차
ALTER TABLE master ADD COLUMN usage_std_dev REAL DEFAULT 0;

-- 변동계수 (CV = 표준편차/평균)
ALTER TABLE master ADD COLUMN usage_cv REAL DEFAULT 0;

-- 등급 (A/B/C)
ALTER TABLE master ADD COLUMN item_grade TEXT DEFAULT 'C';

-- 계산된 발주점
ALTER TABLE master ADD COLUMN calculated_reorder_point REAL DEFAULT 0;

-- 통계 마지막 업데이트 시간
ALTER TABLE master ADD COLUMN stats_updated_at TEXT;

-- supplies 테이블에도 동일 컬럼 추가
ALTER TABLE supplies ADD COLUMN daily_usage_avg REAL DEFAULT 0;
ALTER TABLE supplies ADD COLUMN monthly_usage_avg REAL DEFAULT 0;
ALTER TABLE supplies ADD COLUMN inbound_frequency REAL DEFAULT 0;
ALTER TABLE supplies ADD COLUMN lead_time REAL DEFAULT 3;
ALTER TABLE supplies ADD COLUMN usage_std_dev REAL DEFAULT 0;
ALTER TABLE supplies ADD COLUMN usage_cv REAL DEFAULT 0;
ALTER TABLE supplies ADD COLUMN item_grade TEXT DEFAULT 'C';
ALTER TABLE supplies ADD COLUMN calculated_reorder_point REAL DEFAULT 0;
ALTER TABLE supplies ADD COLUMN stats_updated_at TEXT;
