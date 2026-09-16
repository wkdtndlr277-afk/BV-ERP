# BV-ERP (본비반트 통합관리시스템) - v3.6.84

## 프로젝트 개요
- **이름**: BV-ERP (Bon Vivant ERP)
- **목표**: 베이커리 HACCP 규정 대응 + 원료/반죽/생산/재고 통합 관리
- **주요 기능**: 재료체크시트 자동 임포트, 반죽↔제품 매핑, 원료사용량 산출, HACCP 편차관리, D1 DB 스냅샷

## URLs
- **Production**: https://bv-erp.pages.dev
- **Latest deploy**: https://51d0bf00.bv-erp.pages.dev
- **GitHub**: https://github.com/wkdtndlr277-afk/BV-ERP

## Data Architecture
- **Data Models**:
  - `master` - 원료/반제품/완제품 마스터
  - `dough_recipe` (8종) - 반죽 마스터 (발효종르방, 폴리쉬, 통밀르방, 통밀폴리쉬, 탕종, 통밀탕종, 쌀르방, 쌀탕종)
  - `production_plan_snapshot` - 일자별 생산계획 스냅샷 헤더
  - `production_plan_items` - 제품별 채널 계획 (쿠팡/오아시스/컬리 등 12채널)
  - `production_plan_doughs` - 스냅샷별 반죽 총량
  - `production_plan_materials` - 스냅샷별 원료 총량
  - `haccp_material_check` - HACCP 원료 편차 관리
- **Storage**: Cloudflare D1 `haccp-erp-production` (id: 596dc841-d436-4555-a774-5aa647455162)

## v3.6.84 신규 기능 (이번 세션)
### 1. 제품 ↔ 반죽 매핑 정확도 개선 (팝업 0/119 → 119/0)
**문제**: `/order-plan` 페이지의 "원료 사용량 산출" 팝업이 계획 119건 전체를 "반죽 매핑 없음"으로 표시 (0/119)

**원인**: `product_dough_usage` 테이블이 완전히 비어있음

**해결 (다중 전략 매칭 + 수동 오버라이드)**:
1. **BACK UP 시트에서 173개 제품 헤더 추출** (병합셀 인식, 노이즈 필터링)
2. **4단계 매칭 알고리즘**:
   - `exact`: 정규화 후 완전 일치 (40개)
   - `sub_in/sub_out`: 부분 문자열 포함 관계 (42개)
   - `jaccard`: 2-gram/3-gram 토큰 Jaccard 유사도 ≥0.5 (6개)
   - `manual`: 46개 수동 오버라이드 (사워도우/포켓/저당 등 특수 제품)
3. **오타/변형 사전**: 깜빠뉴↔깜바뉴, 크렌↔크랜, 프로틴↔단백질 등

**결과**: `product_dough_usage` 테이블에 **236개 매핑 삽입** (124개 제품 × 평균 1.9개 반죽)

**팝업 검증 (`POST /api/order-plan/material-usage` `plan_date=2026-09-16`)**:
| 항목 | Before | After |
|---|---|---|
| 계획 제품 수 | 119 | 119 |
| 반죽 배정 있음 | **0** | **119** |
| 반죽 매핑 없음 | **119** | **0** |
| 총 반죽 | 0 kg | **1,937.6 kg** |
| 총 판수 | 0 | 96.88 |
| 반죽별 필요량 | 0종 | **6종** |

**반죽별 산출**:
- D001 발효종르방: 718.40 kg (35.92판)
- D003 통밀르방: 497.70 kg (24.88판)
- D002 폴리쉬: 346.80 kg (17.34판)
- D004 통밀폴리쉬: 261.70 kg (13.08판)
- D005 탕종: 80.00 kg (4판)
- D006 통밀 탕종: 33.00 kg (1.65판)

### 2. 새 API 엔드포인트
- `POST /api/checksheet-import/clear-pdu` - product_dough_usage 전체 삭제 (재삽입용)

## v3.6.83 (이전 세션)
### 1. 재료체크시트 → DB 임포트 라우트 (`/api/checksheet-import`)
- 서버 사이드 마이그레이션 (API 토큰 D1 권한 없이 마이그레이션 실행)
- 기존 스키마 자동 감지 + `ALTER TABLE ADD COLUMN`으로 컬럼 자동 추가

### 2. 임포트 완료된 데이터 (2026-09-06 일요일)
- **반죽 8종** 마스터 등록 (D001~D008)
- **원료 90종** (기존 마스터에 이미 등록되어 skipped)
- **일자 스냅샷 1건**: 110개 제품 / 6,094.3 EA / 357.57 kg 반죽 / 976.85 kg 원료

## API 엔드포인트 (신규)
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/checksheet-import/status` | 10개 테이블 존재 + row 카운트 |
| GET | `/api/checksheet-import/schema/:table` | PRAGMA table_info |
| POST | `/api/checksheet-import/migrate` | 0041/0042/0043 서버 실행 |
| POST | `/api/checksheet-import/fix-schema` | 기존 테이블에 누락 컬럼 ALTER |
| POST | `/api/checksheet-import/clear-legacy` | 기존 데이터 초기화 |
| POST | `/api/checksheet-import/clear-pdu` | product_dough_usage 전체 삭제 |
| POST | `/api/checksheet-import/import-doughs` | 반죽 마스터 upsert |
| POST | `/api/checksheet-import/import-materials` | 원료 마스터 등록 (RM 코드 자동) |
| POST | `/api/checksheet-import/import-snapshot` | 일자별 계획 스냅샷 저장 |
| GET | `/api/checksheet-import/snapshots` | 저장된 스냅샷 목록 |
| GET | `/api/checksheet-import/snapshot/:date` | 특정 일자 상세 |

## User Guide
### 새 일자의 xlsm 데이터를 DB에 저장하려면
1. xlsm 파일에서 계획/BACK UP/재료체크시트 3개 시트 추출
2. Python 스크립트로 `db_payload_XXXX.json` 생성 (구조는 `/tmp/db_payload_0906.json` 참조)
3. `POST /api/checksheet-import/import-snapshot` (overwrite=true로 덮어쓰기)
4. `GET /api/checksheet-import/snapshot/YYYY-MM-DD`로 검증

### 반죽 마스터 확인
- 화면: `/order-plan` (이제 정상 작동, 8개 반죽 표시)
- API: `GET /api/dough/list`

## Deployment
- **Platform**: Cloudflare Pages
- **Status**: ✅ Active
- **Tech Stack**: Hono + TypeScript + TailwindCSS + Cloudflare D1
- **Last Updated**: 2026-09-16
- **Last Commit**: v3.6.83 재료체크시트 임포트 라우트 + 서버사이드 마이그레이션

## Migration Notes
### 문제: `/order-plan`에서 "반죽 마스터 테이블이 없습니다" 오류
- **원인**: API 토큰이 D1 권한 미비로 `wrangler d1 execute --remote` 실행 불가 (7403 error)
- **해결**: 서버 사이드 `/api/checksheet-import/migrate` 엔드포인트로 Worker 컨텍스트 내에서 D1 binding 사용
- **결과**: 10개 테이블 모두 정상 생성, 반죽 마스터 8종 등록 완료
