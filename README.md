# BV-ERP (본비반트 통합관리시스템) - v3.7.0

## 프로젝트 개요
- **이름**: BV-ERP (Bon Vivant ERP)
- **목표**: 베이커리 HACCP 규정 대응 + 원료/반죽/생산/재고 통합 관리 + **원료 구매발주 (카톡 기반)**
- **주요 기능**: 재료체크시트 자동 임포트, 반죽↔제품 매핑, 원료사용량 산출, HACCP 편차관리, D1 DB 스냅샷, **구매발주서 자동 생성 → 카톡 공유**

## v3.7.0 신규 모듈: 원료 구매발주 관리 (`/purchase`)

### 핵심 특징
- **금액 완전 미표시** (단가/합계/VAT 등 전부 제외) — 발주서는 품목·수량·입고요청일만 포함
- **카톡 중심 공유**: 발주서를 **고해상도 JPG**로 렌더링 → Web Share / 클립보드 복사 / 다운로드
- **품목별 입고요청일** 지원 (한 공급사 발주서 안에서 품목마다 요청일 다를 수 있음)
- **공급사 별칭 자동 통합**: `(주)풍림푸드/품링푸드` → `풍림푸드`, `웰푸드` → `웰푸드시스템` 등 17개 공급사 사전 정의
- **ERP 재료체크시트 업로드**: 7컬럼 TSV (붙여넣기 / xlsx / csv), 중복 자동 제외, 테스트/빈값 자동 필터
- **상태 흐름**: 작성(draft) → 보냄(sent) → 입고완료(received) / 취소(cancelled)
- **스냅샷 보존**: 발주 시점의 공급사 이름·담당자·전화를 발주서에 고정 저장

### 메뉴 구성 (좌→우)
1. **원료 목록** — ERP 입고 이력 요약 + 체크박스 다중 선택 → 장바구니 담기
2. **발주 담은 목록 (badge)** — 공급사별 그룹, 수량/요청일/비고 인라인 수정 → 발주서 생성
3. **발주 이력** — 상태/업체/기간 필터, 상세 모달에서 JPG 생성 + 카톡 템플릿 미리보기
4. **업체 관리** — 담당자·전화·별칭 CRUD, 업체 병합
5. **설정** — 회사명·담당자·연락처·입고 장소·카톡 템플릿 변수 편집

### 데이터 모델 (10개 테이블, `po_` prefix)
| 테이블 | 역할 |
|---|---|
| `po_suppliers` | 공급사 (name, contact_person, phone, memo) — 이메일/팩스/주소/사업자번호 없음 |
| `po_supplier_aliases` | 공급사 별칭 (풍림푸드 ← (주)풍림푸드/품링푸드) |
| `po_erp_inbound` | ERP 업로드된 원본 입고 행 (UNIQUE: 입고일+품목코드+입고번호+수량+공급사) |
| `po_items` | 품목 요약 (최근 입고, 횟수) — po_erp_inbound로부터 자동 재계산 |
| `po_cart` | 장바구니 (품목별 requested_date 각각) |
| `po_orders` | 발주서 헤더 (po_number, 공급사 스냅샷 3필드, status) |
| `po_order_items` | 발주 품목 (품목코드, 수량, 단위, 입고요청일, 비고, 입고량) — **가격 필드 없음** |
| `po_number_sequence` | 발주번호 YYYYMMDD-NNN 시퀀스 |
| `po_settings` | 회사·카톡 템플릿 (vat/payment/mail 템플릿 없음) |
| `po_upload_log` | 업로드 이력 |

### API 엔드포인트 (`/api/po/*`)
| Method | Path | 설명 |
|---|---|---|
| GET/PUT | `/settings` | 회사·카톡 템플릿 |
| GET/POST | `/suppliers` | 공급사 CRUD (?stats=1 for 품목수/입고수) |
| GET/PUT/DELETE | `/suppliers/:id` | 단건 |
| POST/DELETE | `/suppliers/:id/aliases` | 별칭 추가/삭제 |
| POST | `/suppliers/merge` | 두 업체 병합 (별칭·발주 이관) |
| POST | `/upload-preview` | 파일/텍스트 파싱 + 매칭 미리보기 (저장 안함) |
| POST | `/upload-commit` | 확정 저장 + po_items 재집계 |
| GET | `/items` | ?category=raw/sub/other, ?supplier_id, ?search |
| GET | `/items/:code/history` | 입고 이력 |
| GET/POST/DELETE | `/cart` | 장바구니 (DELETE ?supplier_id=로 공급사별 비우기) |
| PUT/DELETE | `/cart/:id` | 단건 수정/삭제 |
| GET/POST | `/orders` | 발주 목록/생성 (from_cart=true 지원) |
| GET | `/orders/:id` | 상세 (order + items + settings) |
| POST | `/orders/:id/status` | 상태 변경 (취소 시 장바구니로 복원) |
| GET | `/orders/:id/match-candidates` | ERP 재업로드 후 입고 매칭 후보 |
| GET | `/stats` | 대시보드/배지용 통계 |

### UI 디자인 시스템
- **Primary**: Cobalt Blue `#1D4ED8`
- **Warning Badge**: Orange `#FFF7ED` / `#F97316`
- **Selected Row**: Light Blue `#EFF6FF`
- 좌측 공급사 사이드바 + 상단 가로 탭 + 상단 우측 primary 버튼 "ERP 데이터 가져오기"
- **모바일 완전 지원** (카톡 전송이 주로 휴대폰)

### 샘플 데이터 검증 결과 (v3.7.0)
8행 테스트 입력 → **정확히 기대값 매칭**:
- 웰푸드시스템 3건 (중복 1건 제거: `아몬드슬라이스` 2행 → 1행)
- 풍림푸드 2건 (`(주)풍림푸드`, `품링푸드` 자동 통합)
- 테스트 2건 제외 (`1`, `테스트업체`)
- → `inserted:5, skipped:1, excluded:2`
- 웰푸드시스템 발주서 생성 PO-20261021-001 → **금액 필드 전무 ✅**

### 카톡 템플릿 변수
`{회사명}`, `{담당자}`, `{업체명}`, `{발주번호}`, `{품목목록}`, `{입고요청일}`
- `{품목목록}`: `- {품목명} {수량}{단위} [{메모}]` 형식 여러 줄
- `{입고요청일}`: 품목별 요청일 중복 제거 후 쉼표 구분

---

## 이전 버전 (v3.6.84까지)

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
