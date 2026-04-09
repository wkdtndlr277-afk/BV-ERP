-- 소비기한 필드 추가
-- production_items 테이블에 소비기한(일수) 컬럼 추가

-- 생산명에 소비기한 추가 (생산일 기준 며칠)
ALTER TABLE production_items ADD COLUMN shelf_life_days INTEGER DEFAULT NULL;

-- 생산일보 품목에 소비기한 날짜 추가
ALTER TABLE production_daily_items ADD COLUMN expiry_date TEXT DEFAULT NULL;
