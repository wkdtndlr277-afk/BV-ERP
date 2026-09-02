-- 버그 수정: /api/process/quality 가 dough_master.workspace_temp_min/max,
-- process_quality.workspace_temp* 컬럼을 참조하지만 이 컬럼들은 어떤 마이그레이션에도 없고
-- 코드 안의 별도 "마이그레이션 API"(/api/process/migrate-workspace-temp)를 호출해야만
-- 생성되도록 되어 있었습니다.
-- (참고: 프로덕션은 이미 해당 API를 사용한 이력이 있어 컬럼이 존재할 수 있습니다.
--  이미 존재하는 환경에 다시 적용하면 "duplicate column" 에러가 날 수 있으니 주의하세요.)

ALTER TABLE process_quality ADD COLUMN workspace_temp REAL;
ALTER TABLE process_quality ADD COLUMN workspace_temp_standard TEXT DEFAULT '기준없음';
ALTER TABLE process_quality ADD COLUMN workspace_temp_judgment TEXT DEFAULT '적합';

ALTER TABLE dough_master ADD COLUMN workspace_temp_min REAL;
ALTER TABLE dough_master ADD COLUMN workspace_temp_max REAL;
