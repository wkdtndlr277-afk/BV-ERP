-- 샘플 입고 관련 컬럼 추가
-- inbound 테이블에 is_sample, storage_location 컬럼 추가

-- is_sample: 샘플 여부 (0 또는 1, 기본값 0)
ALTER TABLE inbound ADD COLUMN is_sample INTEGER DEFAULT 0;

-- storage_location: 샘플 보관 장소 (샘플인 경우에만 사용)
ALTER TABLE inbound ADD COLUMN storage_location TEXT;

-- transactions 테이블에도 is_sample 컬럼 추가 (수불 이력에서 샘플 구분)
ALTER TABLE transactions ADD COLUMN is_sample INTEGER DEFAULT 0;

-- 인덱스 생성 (샘플 필터링 성능 향상)
CREATE INDEX IF NOT EXISTS idx_inbound_is_sample ON inbound(is_sample);
CREATE INDEX IF NOT EXISTS idx_transactions_is_sample ON transactions(is_sample);
