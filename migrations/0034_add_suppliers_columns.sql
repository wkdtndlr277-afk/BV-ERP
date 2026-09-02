-- 버그 수정: suppliers 테이블에 haccp_certified, is_imported 컬럼이 애초에 없어서
-- /api/suppliers/stats/summary 가 처리되지 않은 예외로 Internal Server Error를 냈습니다.
ALTER TABLE suppliers ADD COLUMN haccp_certified INTEGER DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN is_imported INTEGER DEFAULT 0;
