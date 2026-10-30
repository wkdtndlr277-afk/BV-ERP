# BV-ERP (본비반트 통합관리시스템) - v3.8.10

## 프로젝트 개요
- **이름**: BV-ERP (Bon Vivant ERP)
- **목표**: 베이커리 HACCP 규정 대응 + 원료/반죽/생산/재고 통합 관리 + **원료 구매발주 (카톡 기반)**
- **주요 기능**: 재료체크시트 자동 임포트, 반죽↔제품 매핑, 원료사용량 산출, HACCP 편차관리, D1 DB 스냅샷, **구매발주서 자동 생성 → 카톡 공유**

## v3.8.10 — 일별수불부·월별수불부 조회 모드에서 행 삭제 가능 (2026-10-30)

### 증상
- 일별수불부(사이드바 "월별 수불부" 메뉴 서브, 2026-08-01)에서 R1057(분말(메밀 생)), R1058(분말(메밀 묶음)) 같은 원료 코드를 삭제하려 해도 삭제 버튼이 안 보임
- D1(`master`/`inbound`/`transactions`/`po_items`/`production_usage`) 전수 조사 결과 R1057·R1058 없음 → 데이터 소스가 D1이 아닌 **구글시트 "일별수불부" 시트**임을 확인

### 진짜 원인
- 백엔드 삭제 API(`POST /sheets/daily-stock/delete-row`)는 **이미 존재**
- 프론트 삭제 함수(`deleteDailyRow`)도 **이미 존재**
- 하지만 삭제 열이 **"수동 정정 모드"(editMode) 켤 때만 렌더링**되도록 조건부여서, 일반 조회 모드에서는 삭제 열 자체가 사라져 있었음

### 해결
- 일별수불부 **조회 모드에도** 각 행에 🗑 삭제 버튼 노출 (`app-v400.js` 라인 7208 헤더 + 7283+ 각 행)
- 조회 모드 전용 `deleteDailyRowView(sheetRow, itemCode, itemName, date)` 함수 신규 추가 — 품목코드/이름/날짜가 포함된 **상세 확인창** 제공 (기존 `deleteDailyRow`는 행 번호만 보여줘서 UX 부족)
- 월별수불부(재고실사) 화면에도 동일한 삭제 기능 추가:
  - 백엔드: `DELETE /sheets/monthly-stock/row?year_month=&item_code=` 신규 라우트 (`sheets.ts`) — Google Sheets `batchUpdate + deleteDimension`로 행을 뒤에서부터 물리 삭제
  - 프론트: `deleteMonthlyStockItem(itemCode, itemName)` 함수 신규

### 사용 방법 (일별수불부 조회 모드 삭제)
1. 사이드바 "월별 수불부" → 날짜 선택 (예: 2026-08-01)
2. 삭제하려는 원료 행의 맨 오른쪽 **🗑 (빨간 휴지통)** 클릭
3. 확인창에 품목코드·품목명·날짜·시트 행이 표시됨 → "확인"
4. 구글시트 "일별수불부"의 해당 행 값이 비워지고 테이블이 자동 갱신됨

### 주의
- 조회 모드에서는 **품목이 구글시트에서 "읽혀올 수 있는 행"일 때만** 🗑 버튼이 활성화됨 (불러오지 못한 행은 "—" 표시 + "편집 모드를 켜야 행 번호가 매핑되어 삭제 가능" 안내)
- 삭제 동작은 **구글시트의 값을 비우는 방식** (물리 행 삭제 아님) — 수식 셀은 자동 재계산

### 변경 파일
- `src/routes/sheets.ts` — `DELETE /monthly-stock/row` 신규
- `public/static/app-v400.js` — 일별수불부 조회 모드 삭제 열/버튼 + `deleteDailyRowView` 함수 + 월별수불부(재고실사) 삭제 UI + `deleteMonthlyStockItem` 함수

### 배포
- Production: https://bv-erp.pages.dev
- 이번 배포: https://22464451.bv-erp.pages.dev (cf-byok-deploy)

---

## v3.8.9 — 원료 발주관리 품목 필터 UX 개선 (2026-10-26)

### 증상
- 업체(에이엘)를 선택했는데 "품목이 없습니다"로 나와 품목이 사라져 보임
- 원인: 검색창에 이전 검색어("d")가 남아 있어서 결과 0건
- 백엔드는 정상 (업체만 필터 → 8개, 검색어 추가 시 → 0개)
- **UX 결함**: 검색어가 켜져 있다는 사실이 눈에 띄지 않음 + empty state 메시지가 "품목이 없다"고 오해 유발

### 해결
- **검색창 ✕ 지우기 버튼**: 검색어 입력 시 입력창 우측에 ✕ 아이콘, 입력창도 파란 테두리로 활성 상태 강조
- **활성 필터 요약 바**: 품목 목록 상단에 현재 적용 중인 필터(업체·분류·검색어) 뱃지로 표시 + **[전체 필터 초기화]** 버튼
- **조건부 empty state**: 결과 0건일 때
  - 필터가 걸려 있으면 → "필터 조건에 맞는 품목이 없습니다" + 전체 필터 초기화 버튼
  - 필터가 없으면 → 기존 "ERP에서 동기화" 안내 (품목 재집계 포함)
- 신규 함수: `window.clearItemsSearch()` (검색어만 리셋), `window.clearAllItemsFilters()` (업체/분류/검색어 전부 리셋)

### 검증 (production)
- `GET /api/po/items?supplier_id=11` → 8건 ✅ (에이엘 품목)
- `GET /api/po/items?supplier_id=11&search=d` → 0건 (스크린샷 상황 재현)
- 새 UI에서 검색창 ✕ 클릭 → 검색어 초기화 → 8건 즉시 표시
- 배포: https://d173d99f.bv-erp.pages.dev

---

## v3.8.8 — 원료 발주관리 품목 조회 확장 + 품목 코드 삭제 기능 (2026-10-23)

### 증상 1 — 에이엘 등 "다중 공급" 업체의 품목이 사이드바에서 안 뜸
- ERP 동기화는 정상(po_erp_inbound 에 데이터 적재됨)인데, 사이드바에서 에이엘 선택 시 **빈 목록**
- D1 조사 결과: 에이엘(id=11) 입고 이력 18건·품목 8종 모두 적재되어 있으나, 품목 마스터(po_items) 에서는 **primary_supplier_id 가 다른 업체**(웰푸드시스템·열매마을 등)로 잡혀 있어서 매칭 실패

### 원인
- `recalcItemsSummary()` 는 품목별로 **입고 횟수가 가장 많은 업체 1개만** primary_supplier_id 로 저장
- `GET /items` 조회가 `primary_supplier_id = ?` 단일 매칭만 함
  → 1개 품목을 여러 업체가 공급하면 primary 안 된 업체에선 안 보임

### 해결
- `GET /items` 조회 로직 변경: `primary_supplier_id = ?` 단일 매칭 → `EXISTS (po_erp_inbound WHERE supplier_id = ?)` 로 확장
  → **해당 업체가 한 번이라도 공급한 모든 품목** 노출
- 응답에 `is_primary_for_filter`, `supplier_inbound_count`, `supplier_last_date` 보조 통계 추가
- 프론트 품목 행에 뱃지 표시:
  - 선택 업체가 현재 주거래면 `[주거래]` (파란색)
  - 다른 업체가 주거래면 `[주거래]` (황색) + 그 업체명 노출
- 최근 입고일/횟수를 **선택된 업체 기준**으로 전환 (전체 입고 횟수는 작게 병기)

### 증상 2 — 품목 코드 삭제 기능 부재
- 잘못 등록된 품목코드/오타 품목을 지울 방법이 없었음

### 해결
- **백엔드**: `DELETE /api/po/items/:code` 추가
  - 1차 요청: 발주 이력(po_order_items)에 사용 중이면 **409** 반환 + 상세(order_count/cart_count/inbound_count/item_name)
  - 2차 요청: `?force=1` 로 재요청하면 강제 삭제 (po_order_items 는 발주 기록 보존을 위해 유지)
  - 삭제 범위: `po_items` + `po_erp_inbound` + `po_cart` (batch 처리)
- **프론트**: 품목 행 우측에 🗑 삭제 버튼 추가
  - 1차 확인창 → 사용 중이면 2차 "강제 삭제" 확인창 → 성공 시 자동 재조회
  - 응답 토스트 자동출력 방지용 `apiDeleteRaw()` 헬퍼 신규 추가

### 검증
- `GET /api/po/items?supplier_id=11` → 에이엘 품목 **8종 전부 반환** ✅
  (R012 건크랜베리, R013 건포도, R079 아몬드슬라이스, R134 피칸, R136 해바라기씨, R142 호두(분태), R150 통아몬드, RM147 호박씨)
- `DELETE /api/po/items/__NONEXISTENT__` → `404 존재하지 않는 품목코드` ✅

### 배포
- Production: https://bv-erp.pages.dev
- 스냅샷: https://fc0f0be5.bv-erp.pages.dev

---

## v3.8.7 — 입고 조회 엑셀 다운로드 복구 (2026-10-23)

### 증상
- 입고 조회 화면에서 "엑셀 다운로드" 버튼이 아무 반응 없음 (파일이 생성되지 않음)

### 원인
- `downloadInboundQuery()` 가 `downloadExcel()` 를 **잘못된 시그니처**로 호출
  - 공통 함수 정의: `downloadExcel(data, columns, filename, options)`
  - 입고 조회 호출: `downloadExcel(filename, company, ['문자열헤더'], 2차원배열, title)` ← 완전 다른 순서 + columns가 문자열 배열
- 다른 모든 export 함수(사용내역/일별수불부/품목마스터 등)는 올바른 시그니처로 호출 → 입고 조회만 유일하게 오작동

### 해결 (`public/static/app-v400.js:37276`)
- 호출 시그니처를 공통 함수와 일치시킴 — `downloadExcel(rows, columns, filename, { title, company })`
- `columns`를 `{ key, label, type }` 객체 배열로 변경 (다른 export와 동일 패턴)
- `rows`를 2차원 배열 → **key 매핑 객체 배열**로 변경
- null/undefined 값 빈 문자열로 fallback (셀 깨짐 방지)
- try/catch + 성공/실패 토스트 추가 (사용자 피드백)

### 배포
- Production: https://bv-erp.pages.dev
- 스냅샷: https://bf29f77e.bv-erp.pages.dev

---

## v3.8.6 — 제품 관리 엑셀 표준 양식 다운로드/업로드

### 요구
- 제품을 하나씩 UI로 등록하기 번거로움 → 엑셀로 한꺼번에 등록/수정하고 싶음
- 어제 올려주신 `브로드카세_판매상품_1021.xlsx` (292개) 같은 대량 등록 지원 필요

### 해결 — 엑셀 왕복(round-trip) 양식
- **다운로드 버튼** (`제품 관리` 사이드바 상단 녹색 버튼)
  - 현재 등록된 모든 제품/채널을 **평탄화 1시트** (`제품목록`) + **사용안내 1시트**로 담은 `.xlsx` 생성
  - 한 행 = 1(제품 × 채널) 조합. 채널 없는 제품은 1행
  - 총 36개 컬럼 — 제품 공통(18) + 채널(18)
  - **가격/VAT 완전 제외** (standing rule 준수)
  - **이미지 URL 제외** → ERP에서 수동 등록

- **업로드 버튼** (`제품 관리` 사이드바 상단 주황색 버튼)
  - 모달에서 드래그&드롭 or 파일 선택 → 미리보기 → 실행
  - 처리 결과 리포트 (제품 신규/수정/스킵, 채널 신규/수정/스킵, 에러 20건까지)
  - 신규 등록 완료 후 자동으로 목록 새로고침

### 매칭 규칙 (upsert)
| 조건 | 동작 |
|---|---|
| 대표코드 공란 + 브랜드코드+제품명 있음 | **신규 제품 생성** (PD코드 자동 채번) |
| 대표코드 있음 | **기존 제품 수정** |
| 채널코드 공란 + 채널명 있음 | **신규 채널 추가** (CP01, NV01 등 자동 채번) |
| 채널코드 있음 | **기존 채널 수정** |
| 브랜드코드가 brands 테이블에 없음 | ❌ 에러 (브랜드는 자동생성 X, 미리 등록 필수) |

**재업로드 중복 누적 방지** (standing rule):
- 같은 파일을 두 번 올려도 중복 생성 안 됨
- 매칭 키: 대표코드 (제품) / 채널코드 (채널) / brand_code+product_name 조합

### 새 API
- `GET /api/products-v2/export/rows` — 평탄화 JSON 반환 (클라이언트에서 xlsx 생성)
- `POST /api/products-v2/import/rows` — JSON 받아서 D1 upsert (최대 2000행)

### 기술 구현
- SheetJS (CDN `xlsx@0.18.5`) 동적 로드 — 서버 CPU 10ms 제한 회피
- 클라이언트에서 파일 → JSON 파싱 → API 전송 (서버는 JSON만 처리)
- 테스트 완료: 신규 1건+수정 1건+채널 추가 1건 → 재업로드 시 전부 스킵됨 (중복 방지 확인)

### 배포
- Production: https://bv-erp.pages.dev
- 스냅샷: https://e236e00a.bv-erp.pages.dev

---

## v3.8.5 — 발주 이력 목록에 '발주 품목' 컬럼 추가 (2026-10-22)

- 품목수(2, 1, 5...)만으로는 무엇을 발주했는지 알 수 없어 품목 목록 표시
- GROUP_CONCAT으로 `건조무화과 18.0kg, 피칸 40.8kg` 형식 집계
- 3개 초과 시 `[+N개 더]` 토글 버튼

---

## v3.8.4 — 본체 ERP 사이드바에 원료 발주 관리 링크 추가

### 요구
- 본체 ERP(`/`)에서 발주 관리 사이트(`/purchase`)로 바로 넘어갈 수 있는 네비게이션 수단 없음
- 사용자: "https://bv-erp.pages.dev/purchase 이사이트를 erp에서도 접속되게 상단에 링크란 걸어줘"

### 해결
- `src/index.tsx` 사이드바 **대시보드 바로 아래 (최상단)** 에 "🛒 원료 발주" 섹션 신설
- `<a href="/purchase" target="_blank" rel="noopener">` 로 새 탭에서 열림 (별도 모듈 느낌 유지)
- 눈에 확실히 띄도록 `indigo→purple` 그라데이션 + `shopping-cart` + `external-link-alt` 아이콘
- 두 사이트가 같은 `bv-erp` Pages 프로젝트의 라우트이므로 same-origin, 인증/CORS 이슈 없음

### 배포
- Production: https://ff740b07.bv-erp.pages.dev
- 본체 사이드바 → "🛒 원료 발주" → "원료 발주 관리" 클릭 시 새 탭에서 `/purchase` 열림

---

## v3.8.3 — 부자재(SM*) 명칭 복구 + 공급업체 검색

### 문제
1. **부자재 품목명이 코드와 동일하게 표시** (SM006 → "SM006")
   - 원인: `sync-from-erp` 가 `master` 테이블만 조회했는데, SM* 부자재는 `master` 가 아니라 **별도 `supplies` 테이블**에 등록됨 (57개 품목)
   - 결과: `COALESCE(m.item_name, i.item_code)` fallback 으로 코드가 그대로 들어감
2. **공급업체가 많아져서 (83개) 사이드바에서 특정 업체 찾기 어려움**

### 해결
1. **sync-from-erp JOIN 확장**: `master` + `supplies` 양쪽 LEFT JOIN
   ```sql
   COALESCE(NULLIF(m.item_name,''), NULLIF(s.item_name,''), i.item_code)
   ```
   - 원료 (R*/RM*) 는 `master` 매칭
   - 부자재 (SM*) 는 `supplies` 매칭
   - 둘 다 없으면 코드 fallback (유지)
   - unit, pack_unit, pack_unit_name 도 같은 방식 COALESCE
2. **기존 운영 데이터 일괄 복구** (SQL UPDATE):
   - `po_erp_inbound` SM* 296행의 item_name/unit/pack_unit 복구
   - `po_items` recalc → **230 품목 전체 정식 명칭 표시**
3. **공급업체 사이드바 실시간 검색**
   - 검색창 추가 (돋보기 아이콘 + X 버튼)
   - 업체명 + **별칭(aliases)** 양쪽 매칭 (예: "주식회사" 입력 → "(주)풍림푸드" 등 전부 노출)
   - 150ms 디바운스, 사이드바만 부분 리렌더링 (포커스 유지)
   - 검색 결과 0건이면 "검색 결과 없음" 표시

### 운영 복구 결과 (부자재 샘플)
| 품목코드 | 수정 전 | 수정 후 |
|---|---|---|
| SM001 | SM001 | **포장박스(대)** |
| SM006 | SM006 | **날개1** |
| SM011 | SM011 | **니트릴장갑S** |
| SM015 | SM015 | **쿠팡 냉동 1호** |
| SM016 | SM016 | **PL 무지 240x300 모닝** |

---

## v3.8.2 (hotfix) — ERP 동기화 전체 데이터 복구 (페이지네이션)

### 문제
- `POST /sync-from-erp` 가 **ERP 2,162행 중 117행만 (5%)** 가져오고 조용히 중단
- 공급사별 심각한 누락: 웰푸드 475→11, 플러스오케이 221→14, **에쓰푸드 209→2** 등
- `po_upload_log` 에 `erp-sync` 기록 0건 → 요청이 중간에 timeout 되어 완료 코드 미도달

### 근본 원인
1. **`resolveSupplier()` 1회당 D1 쿼리 2~3개** × 90개 공급사 = **최소 180 subrequest** → Cloudflare Workers 50 subrequest 한도 초과
2. INSERT batch 100개 × 22번도 CPU time 과다
3. recalcItemsSummary 포함 → 전체 요청 timeout

### 해결 (완전 재설계)
1. **공급사 매칭을 "쿼리 폭발 없이"** 처리
   - `po_supplier_aliases` 전체 **단일 쿼리** 로 메모리에 로드
   - 신규 공급사는 **batch 로 한 번에 생성** + 별칭도 batch 등록
   - 쿼리 수: ~180개 → **최대 4개** (90% 감소)
2. **페이지네이션 지원** (`offset` + `limit` + `has_more`)
   - 1회 호출당 최대 3,000건 → 디폴트 1,000건
   - 프론트에서 `has_more: true` 면 자동으로 다음 offset 재호출
3. **중간 호출은 recalc 생략** (`skip_recalc: true`), 마지막 페이지 후 별도 `/items/recalc` 1회만
4. **INSERT chunk 100 → 50** 축소
5. **`po_upload_log` 매 호출마다 저장** (중간 실패 진단 가능)
6. **진행률 UI**: 모달에 "페이지 N 처리 중 (누적 신규 X건)" 실시간 표시

### 운영 복구 결과
```
Before: 117 행 / 72 품목 / 29 공급사
After:  2,137 행 / 230 품목 / 83 공급사  ✅
ERP 원본: 2,162 행 / 232 품목 / 90 공급사 (제외 분 25건)
→ 98.8% 복구, 에쓰푸드 2 → 209 완전 복구
```

처리 시간: **3페이지 × 약 1초 = 총 3초** (기존 timeout 과 비교)

---

## v3.8.1 (hotfix) — ERP 동기화 후 품목 집계 복구

### 문제
- `POST /sync-from-erp` 가 `po_erp_inbound` 에는 117행 저장했으나 뒤이은 `recalcItemsSummary()` 가 Workers CPU 시간 초과로 조용히 실패
- 결과: 공급사 사이드바에는 품목 수가 표시되지만 중앙 품목 테이블은 비어있음 (72개 품목이 누락)

### 해결
1. **`recalcItemsSummary` 를 D1 batch 로 재작성** — 72개 INSERT 를 단일 batch 로 묶어 CPU 시간 1/10 로 단축
2. **`sync-from-erp` INSERT 루프도 batch(chunk 100)** 로 변경 + `INSERT OR IGNORE` 로 UNIQUE 중복 자동 skip
3. **공급사 매칭을 미리 전부 캐시** → subrequest 수 감소
4. **recalc 실패시 응답에 `recalc_error` 포함** (조용히 실패하지 않음)
5. **`POST /api/po/items/recalc` 복구용 엔드포인트** 신규 추가
6. **품목 비어있을 때 "품목 재집계" 버튼** 표시 (사용자가 fallback 실행 가능)

### 운영 복구 결과
```
POST /api/po/items/recalc → {codes: 72, inserted: 72}
GET /api/po/items → 72개 품목 반환 (포장단위 자동 생성 포함)
```

---

## v3.8.0 신규 기능 (이번 세션) — ERP 자동 동기화 + 포장단위 사용자 편집

### 핵심 변경
1. **ERP → 발주 모듈 자동 동기화** (`POST /api/po/sync-from-erp`)
   - 기존 ERP 모듈의 `inbound` + `master` 테이블을 **직접 조회** → `po_erp_inbound` 저장
   - 수동 Excel 붙여넣기 불필요 (수동 업로드는 fallback으로 유지)
   - `since` (최근 N개월), `category_filter` (raw/sub/all), `limit`, `dry_run` 지원
   - UNIQUE(dedup_hash) 제약으로 **재실행 시 중복 자동 제외** (idempotent)
   - 테스트성 공급사 (`'1'`, `테스트*`, `재고조정*`) + `RT*` 품목코드 자동 제외
   - 상단 "ERP에서 동기화" primary 버튼 → 모달에서 기간/분류/건수 선택 → 미리보기 → 실행

2. **포장단위 (`package_spec`) 사용자 편집 가능**
   - `po_items.package_spec` TEXT 컬럼 신규 (migration 0050)
   - **처음 동기화 시**: `master.pack_unit + pack_unit_name` 으로 초기값 자동 생성 (`2.5kg/팩`, `25kg/포대`, `10kg/박스` 등)
   - **사용자 수정 후 재동기화**: 수정값 **완전 보존** (`recalcItemsSummary`가 DELETE+INSERT 전에 Map으로 백업)
   - 원료 목록 테이블에 "포장단위" 컬럼 추가 → **인라인 편집** (디바운스 600ms + green/red 피드백)
   - 발주 담은 목록에도 포장단위 컬럼 노출 + 수정 가능
   - 발주서/카톡 문구에 `품목명 [포장단위]` 형식으로 자동 포함

3. **원료 목록 행 아무 곳이나 클릭 → 체크박스 토글** (UX 개선)
   - 체크박스 작은 영역만 클릭하던 불편함 해소
   - 편집용 요소 (input/select/button) 클릭 시엔 토글되지 않도록 가드
   - 선택된 행 하이라이트 (`.selected` 클래스, `#EFF6FF` 배경)
   - `check-all` ↔ 개별 체크 상태 양방향 동기화 + `indeterminate` 상태 지원

### 신규 API
| Method | Path | 설명 |
|---|---|---|
| POST | `/api/po/sync-from-erp` | ERP 자동 동기화 (body: `{since?, limit?, dry_run?, category_filter?}`) |
| PUT | `/api/po/items/:code` | 품목 사용자 필드 수정 (body: `{package_spec?, memo?}`) |

### 스키마 변경 (migration 0050)
```sql
ALTER TABLE po_items ADD COLUMN package_spec TEXT;
ALTER TABLE po_cart ADD COLUMN package_spec TEXT;
ALTER TABLE po_order_items ADD COLUMN package_spec TEXT;
ALTER TABLE po_erp_inbound ADD COLUMN erp_pack_unit REAL;
ALTER TABLE po_erp_inbound ADD COLUMN erp_pack_unit_name TEXT;
ALTER TABLE po_erp_inbound ADD COLUMN source TEXT DEFAULT 'manual-upload';
```
- `source`: `'manual-upload'` | `'erp-sync'`
- 로컬 D1 + 운영 D1 (haccp-erp-production) 둘 다 적용 완료

### 포장단위 스냅샷 흐름
```
master.pack_unit (ERP)
  ↓ (sync-from-erp, 최초만)
po_items.package_spec ← 사용자 편집 가능
  ↓ (add to cart)
po_cart.package_spec ← 사용자 편집 가능
  ↓ (create order)
po_order_items.package_spec (스냅샷 - 이후 수정해도 과거 발주서 유지)
  ↓
발주서 JPG + 카톡 문구
```

### 테스트 결과
- `POST /sync-from-erp` dry_run → `{considered:11, excluded:1, will_insert:10}` ✅
- `POST /sync-from-erp` 실행 → `{inserted:10, duplicates:0}` ✅
- 재실행 → `{inserted:0, duplicates:10}` ✅ (dedup 작동)
- `PUT /items/RM1063 {package_spec:"500g/병"}` → 재동기화 후에도 `500g/병` 유지 ✅
- Playwright: JS 에러 0건, 포장단위 컬럼/인라인 편집/행 클릭 토글 전부 정상 ✅

---

## v3.7.1 (이전 턴) — 카톡 전송 UX 전면 개선
- `detectKakaoCapability()`: UA + Share API + Clipboard API 더미 File 테스트로 디바이스 판별
- `kakaoSmartSend()`:
  - 모바일: 이미지 전용 공유 (텍스트는 자동 클립보드 복사, 카톡 호환성 향상)
  - PC: PNG → `ClipboardItem` write (카톡에서 Ctrl+V)
  - fallback: 다운로드
- 디바이스별 안내 뱃지 + 사용법 모달 안내
- `toast()`: `durationMs` + 클릭 즉시 닫기

---

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
- **Purchase Module (v3.7.0)**: https://bv-erp.pages.dev/purchase
- **Latest deploy**: https://075967b0.bv-erp.pages.dev
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
- **Last Updated**: 2026-10-21
- **Last Commit**: v3.8.1 hotfix — ERP 동기화 후 품목 집계 복구 (D1 batch)

## Migration Notes
### 문제: `/order-plan`에서 "반죽 마스터 테이블이 없습니다" 오류
- **원인**: API 토큰이 D1 권한 미비로 `wrangler d1 execute --remote` 실행 불가 (7403 error)
- **해결**: 서버 사이드 `/api/checksheet-import/migrate` 엔드포인트로 Worker 컨텍스트 내에서 D1 binding 사용
- **결과**: 10개 테이블 모두 정상 생성, 반죽 마스터 8종 등록 완료
