-- 바코드별 소비기한(일수) 컬럼 추가
-- 특히 오아시스 채널에서 빵/쿠키 품목별 소비기한 관리를 위함

-- production_barcodes 테이블에 소비기한 컬럼 추가
ALTER TABLE production_barcodes ADD COLUMN expiry_days INTEGER DEFAULT NULL;

-- 소비기한이 설정된 바코드 조회를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_production_barcodes_expiry ON production_barcodes(expiry_days);
