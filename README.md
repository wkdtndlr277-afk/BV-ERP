# (주)본비반트 통합관리시스템

## 프로젝트 개요

- **프로젝트명**: (주)본비반트 통합관리시스템
- **목표**: HACCP 대응에 필요한 원료·제품 수불관리, LOT 추적, 재고관리, 유통기한·안전재고 알림, 품질 KPI 관리를 통합한 초간편 현장형 ERP 시스템
- **핵심 컨셉**: "작업자는 숫자만 입력하고, 시스템은 HACCP 문서, 재고, 품질기록을 전부 자동 완성한다."

## 주요 기능

### ✅ 구현 완료

1. **대시보드**
   - 안전재고 미만 품목 경고
   - 유통기한 30일 이내 LOT 경고
   - 오늘 원료 사용량 / 제품 출고량
   - 품질 KPI 부적합 건수 / 미등록 경고

2. **입고 관리**
   - 원료/제품 공통 입고 등록
   - LOT 번호 자동 생성 (YYYYMMDD-품목코드-순번)
   - 합격/불합격 품질 상태 관리
   - 합격 시 자동 재고 반영

3. **사용량 입력 (원료 전용)**
   - 오늘 사용 내역 일괄 입력
   - FEFO 방식 자동 적용 (유통기한 빠른 LOT부터 차감)
   - 자동 재고 감소 및 Transaction 기록

4. **출고 관리**
   - 원료/제품 공통 출고 등록
   - FEFO 자동 적용
   - 거래처 선택
   - 재고 부족 시 저장 불가

5. **제품 재고 간편 등록**
   - 재고 실사/초기등록/조정용
   - 현재 실제 재고 수량 입력
   - 자동 조정 기록 생성

6. **재고 현황**
   - 전체/원료/제품 필터링
   - 현재고, 안전재고, 상태 표시

7. **수불 통합 검색**
   - 기간, 품목, 구분, LOT 필터
   - 총 입고/사용/출고/조정량 요약

8. **LOT 이력 검색**
   - LOT별 전체 거래 이력 조회

9. **일별/월별 수불부**
   - 품목별 입고/사용/출고/조정 집계
   - 인쇄 기능

10. **품질 KPI 관리**
    - 일별 KPI 등록/조회/삭제
    - 적합/부적합 판정
    - 월별 KPI 요약

11. **기준정보 관리**
    - 품목 마스터 (원료/제품)
    - 거래처 관리 (입고/출고/양방향)

## 기술 스택

- **Backend**: Hono (TypeScript)
- **Frontend**: HTML + TailwindCSS + Vanilla JS
- **Database**: Cloudflare D1 (SQLite)
- **Deployment**: Cloudflare Pages

## 데이터 구조

### Master (품목 마스터)
| 필드 | 설명 |
|------|------|
| item_code | 품목코드 |
| item_name | 품목명 |
| category | 구분 (원료/제품) |
| unit | 단위 |
| current_stock | 현재고 |
| safety_stock | 안전재고 |
| expiry_days | 유통기한 기준일 |

### Inbound (입고 LOT)
| 필드 | 설명 |
|------|------|
| lot_number | LOT 번호 (자동생성) |
| item_code | 품목코드 |
| inbound_date | 입고일 |
| expiry_date | 유통기한 |
| origin_qty | 입고량 |
| remain_qty | 잔량 |
| quality_status | 품질상태 (합격/불합격) |
| supplier | 거래처 |

### Transaction (수불 이력)
| 필드 | 설명 |
|------|------|
| trans_date | 일자 |
| item_code | 품목코드 |
| trans_type | 구분 (입고/사용/출고/재고조정) |
| quantity | 수량 (+/-) |
| lot_number | LOT 번호 |
| remain_qty | 잔량 |

### Quality_KPI (품질 KPI)
| 필드 | 설명 |
|------|------|
| kpi_date | 날짜 |
| kpi_name | KPI 항목명 |
| standard_value | 기준값 |
| measured_value | 측정값 |
| judgment | 판정 (적합/부적합) |

## API 엔드포인트

### 마스터 관리
- `GET /api/master` - 품목 목록
- `GET /api/master/:item_code` - 품목 상세
- `POST /api/master` - 품목 등록
- `PUT /api/master/:item_code` - 품목 수정
- `DELETE /api/master/:item_code` - 품목 삭제

### 입고 관리
- `GET /api/inbound` - 입고 목록
- `GET /api/inbound/lot/:lot_number` - LOT 상세
- `POST /api/inbound` - 입고 등록
- `PUT /api/inbound/lot/:lot_number` - LOT 수정
- `GET /api/inbound/expiring/:days` - 유통기한 임박 조회

### 사용량 관리
- `GET /api/usage/available` - 사용 가능 원료
- `GET /api/usage/today` - 오늘 사용량
- `POST /api/usage` - 사용량 등록

### 출고 관리
- `GET /api/outbound/available` - 출고 가능 품목
- `GET /api/outbound/today` - 오늘 출고 내역
- `POST /api/outbound` - 출고 등록

### 재고 관리
- `GET /api/stock/current` - 현재 재고
- `GET /api/stock/low-stock` - 안전재고 미만
- `POST /api/stock/quick-register` - 재고 빠른 등록

### 수불 이력
- `GET /api/transactions/search` - 통합 검색
- `GET /api/transactions/lot/:lot_number` - LOT 이력
- `GET /api/transactions/daily-report` - 일별 수불부
- `GET /api/transactions/monthly-report` - 월별 수불부

### 품질 KPI
- `GET /api/quality` - KPI 목록
- `GET /api/quality/today` - 오늘 KPI
- `POST /api/quality` - KPI 등록
- `GET /api/quality/monthly-summary` - 월별 요약

### 대시보드
- `GET /api/dashboard` - 대시보드 데이터
- `GET /api/dashboard/alerts/count` - 알림 카운트

## 로컬 개발

```bash
# 의존성 설치
npm install

# 빌드
npm run build

# 데이터베이스 마이그레이션 (로컬)
npm run db:migrate:local

# 샘플 데이터 시드
npm run db:seed

# 개발 서버 실행
npm run dev:sandbox
```

## 배포

```bash
# Cloudflare Pages 배포
npm run deploy

# 프로덕션 데이터베이스 마이그레이션
npm run db:migrate:prod
```

## 라이선스

Proprietary - (주)본비반트

## 업데이트 이력

- **2026-06-01**: v2.2.0 - LOT 생성 강제 + 수불부 AI 추론 배제 + inbound 전수 조사
  - **LOT 생성 로직 완전 고정** (`src/utils/lot-generator.ts`)
    - LOT 번호 누락 시 DB 기록 금지 (LOTGenerationError 발생)
    - 자동 생성: YYYYMMDD-코드-순번 형식
    - 반제품 LOT 기준일 = 생산일 전날 (고정)
  - **수불부 AI 추론 배제** (`src/utils/stock-calculator.ts`)
    - current_stock은 `SUM(remain_qty)` 쿼리 결과만 사용
    - 불일치 시 'DataInconsistencyError' (데이터 불일치 오류: 관리자 확인 필요)
    - AI 예측값 완전 배제, DB 실제 잔량만 신뢰
  - **inbound 전수 조사 API** (`/api/audit/inbound-inspection`)
    - LOT 누락 데이터 추출
    - 음수 잔량 데이터 추출
    - LOT 형식 검증 (비표준 형식 추출)
  - **일괄 수정 쿼리 생성** (`POST /api/audit/generate-fix-queries`)
    - dry_run 모드: 쿼리만 생성
    - 실행 모드: Atomic 일괄 수정
  - **전체 데이터 일관성 보고서** (`/api/audit/full-report`)

- **2026-06-01**: v2.1.0 - 기술적 최적화 + 감사 스크립트
  - Atomic Transaction (D1 batch()) 적용: 모든 재고 업데이트를 원자적으로 처리
  - FEFO 쿼리 강제 적용: `ORDER BY expiry_date ASC, inbound_date ASC`
  - MAX(0, current_stock - ?) 적용: 음수 재고 완전 방지
  - 재고 부족 방어 코드: 차감 전 검증, 부족 시 작업 중단 (errorCode: INSUFFICIENT_STOCK)
  - 감사(Audit) API 추가: `/api/audit/run-all`, `/api/audit/stock-consistency`
  - 런타임 엔진 모드: 시스템 운영 규칙 고정 (src/runtime-rules.ts)

- **v3.5.5 (2026-06-23)**: 시스템 데이터 정비 및 외부 상품명 필드 추가
  - **데이터 정비 완료**:
    - NULL item_code 트랜잭션 405건 삭제 (admin_logs에 백업)
    - 고아 품목 0개 확인 (모든 품목이 master/supplies/semi_finished_items에 정상 매핑)
  - **외부 상품명(external_name) 필드 추가**:
    - master 테이블: external_name 컬럼 (발주서/바코드 출력용)
    - production_items 테이블: external_name 컬럼
    - 기본값: 기존 item_name/production_name 복사
  - **관리자 진단/수정 API 추가**:
    - `GET /api/admin/diagnose/null-transactions` - NULL 트랜잭션 상세 분석
    - `GET /api/admin/diagnose/orphan-items-detail` - 고아 품목 상세 분석
    - `POST /api/admin/fix/delete-null-transactions` - NULL 트랜잭션 일괄 삭제
    - `POST /api/admin/fix/register-orphan-items` - 고아 품목 일괄 등록
    - `POST /api/admin/migrate/add-external-name-field` - 외부 상품명 필드 마이그레이션
  - **보안**: bypass_auth 'SYSTEM_CLEANUP_2026' 토큰으로 관리자 인증 우회

- **v3.5.4 (2026-06-22)**: 수불부 원료 필터링 기본값 변경
  - 일별/월별 수불부에서 기본적으로 원료(RM*, R*)만 표시
  - 제품/부자재는 별도 필터 선택 시 표시

- **v3.4.7 (2026-06-10)**: 바코드 재고관리 - 원료 재고 현황 기능 추가
  - 바코드 재고관리 전용 원료 재고 현황 테이블 추가 (일별/월별 수불부와 완전 분리)
  - 재고 직접 수정 기능 추가 (조정 사유 선택, 이력 기록)
  - 원료만 표시 (부자재/제품 제외)
  - API: `/api/barcode/material-inventory`, `/api/barcode/adjust-stock`

- **v3.4.6 (2026-06-10)**: 원재료 LOT 정보 표시 및 바코드 버그 수정
  - closing-status API: 원재료 사용 시 LOT 번호 표시 추가
  - 바코드 입고 시 memo 컬럼 오류 수정

- **v3.5.23 (2026-06-24)**: 3-Layer 아키텍처 + FEFO 자동 로트매칭
  - **3-Layer 아키텍처 구현**: Input → Processing (SSOT) → Output 분리
  - **v2 API 추가**: `/api/sheets/v2/*` - 입력 검증, SSOT 계산, 출력 전용
    - `POST /v2/setup/inventory-master` - 재고마스터 시트 초기화
    - `POST /v2/calculate/daily-stock` - 일별 수불부 계산 (BOM × 생산수량)
    - `GET /v2/output/daily-stock?date=YYYY-MM-DD` - 일별수불부 출력
    - `GET /v2/output/production-report?date=YYYY-MM-DD` - 생산일보 출력
  - **ERP UI 업데이트**: v2 API 사용으로 입고(+)/출고(-) 컬럼 분리 표시
  - **FEFO Google Apps Script**: `google-apps-script/fefo-lot-matching.gs`
    - 유통기한 기준 자동 로트매칭
    - 생산 시 원료 사용 LOT 자동 추적
    - 로트별 재고 현황 자동 업데이트
    - 만료 임박 알림 기능

- **v3.4.5 (2026-06-10)**: 재고 부족 시 상세 사유 모달 UI 추가
  - 생산 등록 차단 시 품목별 현재고/필요량/부족분/사유 상세 표시
  - 입고 등록 페이지로 바로 이동 버튼 추가

- **2026-01-29**: 초기 버전 완성
  - 전체 기능 구현 완료
  - D1 데이터베이스 연동
  - 샘플 데이터 포함

## 감사(Audit) API

### 재고 일치성 검사
- `GET /api/audit/stock-consistency` - 원료 inbound vs master 불일치 검사
- `GET /api/audit/product-consistency` - 제품 production_inbound vs master 불일치 검사
- `GET /api/audit/semifinished-consistency` - 반제품 semi_finished_lots 불일치 검사
- `GET /api/audit/negative-stock` - 음수 재고 검사
- `POST /api/audit/run-all` - 전체 감사 실행 (매일 자정 호출 권장)
- `GET /api/audit/history` - 감사 이력 조회
- `POST /api/audit/fix-consistency` - 재고 불일치 자동 수정

### inbound 전수 조사 (v2.2.0 추가)
- `GET /api/audit/inbound-inspection` - LOT 누락/음수 재고/형식 오류 데이터 전수 조사
- `POST /api/audit/generate-fix-queries` - 일괄 수정 쿼리 생성/실행
  - `{ "dry_run": true }` - 쿼리만 생성 (미리보기)
  - `{ "dry_run": false }` - 실제 수정 실행
  - `{ "fix_types": ["lot_missing"] }` - LOT 누락만 수정
  - `{ "fix_types": ["negative_remain"] }` - 음수 잔량만 수정
- `GET /api/audit/full-report` - 전체 데이터 일관성 보고서

### 자정 실행 설정
Cloudflare Pages Functions는 Cron Triggers를 직접 지원하지 않습니다.
외부 스케줄러(Cloudflare Workers, GitHub Actions 등)에서 다음을 호출하세요:
```
POST https://bv-erp.pages.dev/api/audit/run-all
```
권장 시간: UTC 15:00 (KST 00:00)

## 시스템 운영 규칙 (Runtime Engine Mode)

시스템은 `src/runtime-rules.ts`에 정의된 규칙만 실행합니다:
- 규칙에 없는 상황 발생 시: 작업 중단 + 에러 반환
- AI가 자의적으로 추론하지 않음

---

## v3.5.25 업데이트 (2026-06-24)

### 🚚 출고 자동화 시스템 구현

**핵심 워크플로우:**
```
생산일(N) → 출고일지 자동생성 → 출고일(N+1) → 제품재고 자동차감
```

### 새 API 엔드포인트 (`/api/sheets/v2/shipment/`)

| API | 메서드 | 설명 |
|-----|--------|------|
| `/v2/shipment/generate` | POST | 생산일보 기반 익일 출고일지 자동 생성 |
| `/v2/shipment/confirm` | POST | 출고 확정 및 제품 재고 차감 |
| `/v2/shipment/list` | GET | 출고일지 조회 (날짜/상태 필터) |
| `/v2/shipment/product-inventory` | GET | 제품재고 현황 조회 |
| `/v2/shipment/auto-process` | POST | 원클릭 자동화 (생성+확정) |

### 사용 예시

**1. 출고일지 자동 생성:**
```bash
curl -X POST "https://bv-erp.pages.dev/api/sheets/v2/shipment/generate" \
  -H "Content-Type: application/json" \
  -d '{"production_date": "2026-06-05"}'
```

**2. 원클릭 자동화 (생성 + 확정 + 재고차감):**
```bash
curl -X POST "https://bv-erp.pages.dev/api/sheets/v2/shipment/auto-process" \
  -H "Content-Type: application/json" \
  -d '{"production_date": "2026-06-05", "auto_confirm": true}'
```

### Google Sheets 시트 구조

**출고일지 시트:**
| 열 | 내용 |
|----|------|
| A | 출고일 (생산일+1) |
| B | 생산일 |
| C | 제품코드 |
| D | 제품명 |
| E | 수량 |
| F | 단위 |
| G | 채널 |
| H | 생산LOT |
| I | 출고상태 (출고예정/출고완료) |
| J | 비고 |

**제품재고 시트:**
| 열 | 내용 |
|----|------|
| A | 제품코드 |
| B | 제품명 |
| C | 현재고 |
| D | 단위 |
| E | 최종수정일 |

---

## 3-Layer Architecture (v2 API)

```
[입력 레이어]          [연산 레이어 (SSOT)]       [출력 레이어]
원료입고_RAW    →     재고마스터            →    일별수불부_출력
생산실적_RAW    →     BOM마스터             →    생산일보_출력
                      로트매칭              →    출고일지
                                            →    제품재고
```

### 핵심 원칙
- **일별수불부 = 원료** (BOM × 생산수량 = 원료 사용량)
- **출고일지 = 제품** (생산일+1 = 출고일)
- **모든 계산 = Google Sheets 자동** (LOOKUP, SUMIFS, SUMPRODUCT)

---

## v3.6.90 업데이트 (2026-07-16)

### 📊 향상된 안전재고/발주점 계산 시스템

**기존 단순 계산의 문제점:**
- 안전재고 = 일평균 × 3일 (고정)
- 입고빈도, 리드타임, 입고단위 미반영
- 수요 변동성(CV) 미고려

**v3.6.90 향상된 계산:**

| 항목 | 계산 공식 |
|------|----------|
| 안전재고 | 일평균 × 리드타임 × 안전계수 × (1 + CV×0.5) |
| 발주점 | 안전재고 + (일평균 × 리드타임) |
| 리드타임 | 입고간격 중앙값 (이상치 90일 초과 제외) |
| 일평균 | MAX(구글시트 사용량, BOM기반 예상사용량) |
| 권장발주량 | 2주 분량, 입고단위 배수로 조정 |

### 새 API 엔드포인트

| API | 메서드 | 설명 |
|-----|--------|------|
| `/api/admin/recalculate-enhanced-stats` | POST | 향상된 안전재고/발주점 재계산 |
| `/api/admin/enhanced-stats/:item_code` | GET | 품목별 상세 통계 조회 |

### 사용 예시

**1. 향상된 통계 재계산:**
```bash
curl -X POST "https://bv-erp.pages.dev/api/admin/recalculate-enhanced-stats" \
  -H "Content-Type: application/json" \
  -d '{"days": 60, "safety_factor": 1.5}'
```

**응답 예시:**
```json
{
  "success": true,
  "version": "v3.6.90",
  "parameters": {
    "analysis_days": 60,
    "safety_factor": 1.5
  },
  "data_sources": {
    "sheet_rows": 8719,
    "inbound_records": 614,
    "bom_records": 2514,
    "production_records": 209
  },
  "updated_count": 193
}
```

**2. 품목별 상세 조회:**
```bash
curl "https://bv-erp.pages.dev/api/admin/enhanced-stats/R102"
```

### 데이터 소스 통합

| 소스 | 데이터 |
|------|--------|
| 구글시트 일별수불부 | 일별 실제 사용량 |
| inbound 테이블 | 입고빈도, 평균/최소 입고단위, 입고간격(리드타임) |
| production_bom 테이블 | 제품별 원료 투입량 (BOM) |
| production 테이블 | 생산실적 (BOM 기반 예상 사용량 계산) |

### 상세 결과 항목

| 필드 | 설명 |
|------|------|
| daily_avg | 최종 일평균 사용량 (시트 vs BOM 중 MAX) |
| inbound_freq | 월평균 입고 횟수 |
| lead_time | 리드타임 (입고간격 중앙값) |
| avg_order_qty | 평균 입고 수량 |
| min_order_qty | 최소 입고 단위 |
| cv | 변동계수 (표준편차/평균) |
| safety_stock | 향상된 안전재고 |
| reorder_point | 향상된 발주점 |
| recommended_order | 권장 발주량 |
| bom_products | BOM 사용처 제품 수 |
