# ERP 마이그레이션 요약 보고서

**작성일**: 2026년 6월 1일  
**시스템**: HACCP-ERP 통합 생산관리 시스템  
**플랫폼**: Cloudflare Pages + D1 Database  
**운영 URL**: https://bv-erp.pages.dev

---

## 1. 프로젝트 개요

### 1.1 시스템 구성
| 구분 | 내용 |
|------|------|
| **프레임워크** | Hono (TypeScript) |
| **데이터베이스** | Cloudflare D1 (SQLite 기반) |
| **호스팅** | Cloudflare Pages |
| **Database ID** | `596dc841-d436-4555-a774-5aa647455162` |
| **Database Name** | `haccp-erp-production` |

### 1.2 주요 기능
- 생산등록 및 생산일보 관리
- 원료/제품 LOT 추적 관리
- 입고/출고 수불부 관리
- BOM(원재료 배합표) 관리
- 재고 현황 실시간 조회
- HACCP 문서 자동 생성

---

## 2. 품목 목록 (Master Data)

### 2.1 품목 분류별 현황
| 분류 | 품목 수 | 설명 |
|------|---------|------|
| **제품 (PR/PD)** | 197건 | 완제품 (베이글, 식빵, 깜바뉴 등) |
| **원료 (R/RM)** | 189건 | 원재료 (밀가루, 버터, 설탕 등) |
| **합계** | **386건** | - |

### 2.2 품목코드 체계
| 접두사 | 분류 | 예시 | 설명 |
|--------|------|------|------|
| `PD` | 제품 | PD001~PD200 | 완제품 (구버전 코드) |
| `PR` | 제품 | PR001~PR250 | 완제품 (신규 코드) |
| `R` | 원료 | R001~R150 | 일반 원재료 |
| `RM` | 원료 | RM147~RM211 | 부자재/원료 |
| `SF` | 반제품 | SF001~SF010 | 반제품 (발효종, 탕종 등) |

### 2.3 주요 원료 목록 (상위 20개)
| 코드 | 품목명 | 단위 | 안전재고 |
|------|--------|------|----------|
| R001 | I.S.P (분리대두단백) | kg | 20 |
| R002 | W.P.C (유청단백) | kg | 20 |
| R003 | W.P.I (분리유청단백) | kg | 20 |
| R048 | 버터 | kg | 50 |
| R068 | 생이스트 | kg | 30 |
| R070 | 유기농(설탕) | kg | 50 |
| R071 | 소금 | kg | 30 |
| R100 | 우유 | kg | 100 |
| R101 | 유기농 T65 | kg | 100 |
| R102 | 유기농 T55 | kg | 100 |
| R103 | 전란 | kg | 50 |
| R104 | 유기농통밀(사조) | kg | 50 |
| R114 | 통밀(사조) | kg | 50 |
| R142 | 호두(분태) | kg | 20 |
| R143 | 호밀가루 | kg | 30 |
| RM184 | 정제수 | kg | 200 |
| RM211 | 통밀(스테인메츠) | kg | 50 |

### 2.4 반제품(SF) 목록
| 코드 | 품목명 | 설명 |
|------|--------|------|
| SF001 | 르방(발효종) | 자연발효종 |
| SF002 | 통밀발효종 | 통밀 기반 발효종 |
| SF003 | 론도발효종 | 론도 제품용 발효종 |
| SF006 | 탕종 | 밀가루 호화 반죽 |
| SF007 | 베이글발효종 | 베이글 전용 발효종 |
| SF008 | 호밀발효종 | 호밀 기반 발효종 |
| SF009 | 천연발효종 | 천연 발효 스타터 |

---

## 3. LOT 관리 기준

### 3.1 LOT 번호 형식

#### 3.1.1 원료 LOT (입고 기준)
```
형식: YYYYMMDD-품목코드-순번
예시: 20260519-R001-001
```
- **YYYYMMDD**: 입고일자
- **품목코드**: R001, R002 등
- **순번**: 동일 일자/품목 내 순차 번호 (001, 002, ...)

#### 3.1.2 반제품 LOT (생산일 전날 기준)
```
형식: YYYYMMDD-SF코드-순번
예시: 20260517-SF009-001
```
- **YYYYMMDD**: **생산일 전날** (반제품 제조일)
- **SF코드**: SF001~SF010
- **순번**: 001, 002, ...

**중요**: 반제품 LOT는 생산일보 출력 시 **생산일 전날 기준**으로 조회/생성됨

#### 3.1.3 제품 LOT (생산일 기준)
```
형식: PRD-YYYYMMDD-제품코드-랜덤4자리
예시: PRD-20260528-PR001-4746
```
- **PRD**: 제품(Production) 접두사
- **YYYYMMDD**: 생산일자
- **제품코드**: PR001, PD001 등
- **랜덤4자리**: 고유 식별자

### 3.2 LOT 선택 방식 (FEFO)
```
First Expired, First Out
소비기한이 빠른 LOT부터 우선 사용
```

**SQL 구현**:
```sql
SELECT lot_number, remain_qty, expiry_date
FROM inbound
WHERE item_code = ? AND quality_status = '합격' AND remain_qty > 0
ORDER BY expiry_date ASC  -- 소비기한 빠른 순서
```

### 3.3 AUTO LOT 처리 (레거시 데이터)
- 기존 `-AUTO` 형식 LOT → `-001` 형식으로 변환 완료
- 총 296건 자동 변환 처리됨

---

## 4. 재고 관리 규칙

### 4.1 이중 재고 추적 시스템

| 필드 | 테이블 | 용도 | 설명 |
|------|--------|------|------|
| `current_stock` | master | HACCP 표시용 | 품목별 현재 재고량 |
| `remain_qty` | inbound | 수불부 기준 | LOT별 실제 잔량 |

**핵심 원칙**: 모든 재고 조회 시 `inbound.remain_qty` 합계 사용

### 4.2 재고 계산 공식

```
현재 재고 = 이전 재고 + 입고량 - 생산 투입량
```

**실제 구현 (SQL)**:
```sql
SELECT COALESCE(SUM(remain_qty), 0) as current_stock
FROM inbound
WHERE item_code = ?
  AND quality_status = '합격'
  AND remain_qty > 0
```

### 4.3 생산 투입량 계산

```
투입량(kg) = BOM.quantity(g) × 생산수량 ÷ 1000
```

**예시**: R001 6g × 생산 100개 = 600g = 0.6kg

### 4.4 음수 재고 방지

모든 재고 차감 시 음수 방지 로직 적용:

```sql
UPDATE master 
SET current_stock = MAX(0, current_stock - ?)
WHERE item_code = ?
```

**적용된 파일 목록**:
- `production.ts` - 생산등록 시 원료 차감
- `usage.ts` - 수동 사용 등록
- `outbound.ts` - 출고 처리
- `admin.ts` - 관리자 조정
- `inbound.ts` - 입고 취소
- `barcode.ts` - 바코드 스캔 처리
- `transaction.ts` - 트랜잭션 처리

### 4.5 재고 재계산 기능

```
POST /api/stock/recalculate
```

master.current_stock을 inbound.remain_qty 합계로 동기화

---

## 5. BOM (원재료 배합표) 관리

### 5.1 BOM 테이블 구조

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INTEGER | 자동 증가 PK |
| product_code | TEXT | 제품코드 (PR001, PD001) |
| item_code | TEXT | 원료코드 (R001, SF001) |
| quantity | REAL | 소요량 (g) |
| unit | TEXT | 단위 (기본: g) |
| sort_order | INTEGER | 정렬 순서 |
| memo | TEXT | 비고 |

### 5.2 BOM 데이터 현황

- **총 BOM 레코드**: 1,978건
- **평균 원료 수/제품**: 약 10개

### 5.3 BOM 조회 로직

```sql
SELECT b.*, 
  COALESCE(
    (SELECT SUM(remain_qty) 
     FROM inbound i 
     WHERE i.item_code = COALESCE(m1.item_code, m2.item_code) 
       AND i.quality_status = '합격' 
       AND i.remain_qty > 0),
    0
  ) as current_stock
FROM bom b
LEFT JOIN master m1 ON b.item_code = m1.item_code AND m1.category = '원료'
LEFT JOIN master m2 ON b.item_code = m2.item_code AND m2.category = '반제품'
WHERE b.product_code = ?
```

---

## 6. 데이터베이스 스키마

### 6.1 테이블 구조

#### master (품목 마스터)
```sql
CREATE TABLE master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code TEXT UNIQUE NOT NULL,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL,  -- '원료', '제품', '반제품'
  unit TEXT DEFAULT 'kg',
  current_stock REAL DEFAULT 0,
  safety_stock REAL DEFAULT 0,
  expiry_days INTEGER DEFAULT 365,
  barcode TEXT,
  pack_unit REAL,
  pack_unit_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### inbound (입고 원장)
```sql
CREATE TABLE inbound (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_number TEXT NOT NULL,
  item_code TEXT NOT NULL,
  inbound_date DATE NOT NULL,
  expiry_date DATE,
  origin_qty REAL NOT NULL,
  remain_qty REAL NOT NULL,
  quality_status TEXT DEFAULT '대기',  -- '대기', '합격', '불합격'
  supplier TEXT,
  is_sanitary BOOLEAN DEFAULT FALSE,
  is_sample BOOLEAN DEFAULT FALSE,
  storage_location TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### production (생산 원장)
```sql
CREATE TABLE production (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prod_date DATE NOT NULL,
  product_code TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  lot_number TEXT,
  status TEXT DEFAULT '대기',
  memo TEXT,
  created_by TEXT,
  expiry_date DATE,
  channel TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### bom (원재료 배합표)
```sql
CREATE TABLE bom (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL,
  item_code TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT DEFAULT 'g',
  sort_order INTEGER DEFAULT 0,
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 7. 생산 현황 통계

### 7.1 월별 생산 통계
| 월 | 생산 건수 | 총 생산 수량 |
|----|-----------|--------------|
| 2026-05 | 3,479건 | 93,858개 |
| 2026-04 | 1,277건 | 31,643개 |
| **합계** | **4,756건** | **125,501개** |

### 7.2 채널별 생산 통계
| 채널 | 생산 건수 | 비율 |
|------|-----------|------|
| coupang | 4,152건 | 87.3% |
| oasis_paste | 407건 | 8.6% |
| kurly_paste | 115건 | 2.4% |
| bmart | 39건 | 0.8% |
| direct_store | 31건 | 0.7% |
| 기타 | 12건 | 0.2% |

---

## 8. 수정 완료 사항

### 8.1 코드 수정 이력

| 파일 | 수정 내용 | 상태 |
|------|-----------|------|
| `daily-report.ts` | SF LOT 생산일 전날 기준 조회, AUTO→001 변환 | ✅ 완료 |
| `production.ts` | BOM 조회 시 inbound.remain_qty 사용, MAX(0,...) 적용 | ✅ 완료 |
| `stock.ts` | 재고 조회 inbound 기준, 재계산 함수 개선 | ✅ 완료 |
| `usage.ts` | MAX(0, current_stock - ?) 적용 | ✅ 완료 |
| `outbound.ts` | MAX(0, current_stock - ?) 적용 | ✅ 완료 |
| `admin.ts` | MAX(0, current_stock - ?) 적용 | ✅ 완료 |
| `inbound.ts` | MAX(0, current_stock - ?) 적용 | ✅ 완료 |
| `barcode.ts` | MAX(0, current_stock - ?) 적용 | ✅ 완료 |
| `transaction.ts` | MAX(0, current_stock - ?) 적용 | ✅ 완료 |

### 8.2 데이터베이스 수정 이력

| 작업 | 내용 | 건수 |
|------|------|------|
| AUTO LOT 변환 | `-AUTO` → `-001` 형식 변환 | 296건 |
| PR219 추가 | master 테이블에 통밀발효종베이글 추가 | 1건 |

---

## 9. 추출 데이터 파일 목록

### 9.1 CSV 파일
| 파일명 | 건수 | 용량 | 내용 |
|--------|------|------|------|
| 1_BOM_마스터.csv | 1,978건 | 132KB | 제품별 원료 배합표 |
| 2_생산일보.csv | 4,756건 | 337KB | 전체 생산 이력 |
| 3_품목마스터.csv | 386건 | 22KB | 품목 마스터 정보 |
| 4_입고LOT.csv | 1,093건 | 79KB | 입고 LOT 현황 |

### 9.2 엑셀 파일
| 파일명 | 시트 수 | 용량 | 내용 |
|--------|---------|------|------|
| ERP_BOM_계산로직_점검.xlsx | 5개 | 151KB | BOM, Master, Inbound, 계산로직 설명, R001 확인 |

---

## 10. 미해결 사항 및 권장 조치

### 10.1 미해결 이슈

| 이슈 | 원인 | 권장 조치 |
|------|------|-----------|
| R001 LOT 누락 표시 | 일부 생산일보에서 `-` 표시 | inbound 테이블에 해당 일자 LOT 확인 필요 |
| PR219 제품 LOT 누락 | 5월 18일 production 테이블에 기록 없음 | 생산 등록 재수행 또는 수동 입력 |

### 10.2 운영 권장사항

1. **정기 재고 동기화**: 주 1회 `/api/stock/recalculate` 실행
2. **LOT 유효성 검사**: 생산등록 전 해당 원료 LOT 존재 여부 확인
3. **FEFO 준수**: 소비기한 임박 LOT 우선 사용 모니터링
4. **백업**: 일 1회 D1 데이터베이스 백업 권장

---

## 11. 기술 지원 정보

### 11.1 API 엔드포인트
| 엔드포인트 | 메소드 | 설명 |
|------------|--------|------|
| `/api/production` | POST | 생산 등록 |
| `/api/daily-report/:date` | GET | 생산일보 조회 |
| `/api/stock` | GET | 재고 현황 조회 |
| `/api/stock/recalculate` | POST | 재고 재계산 |
| `/api/inbound` | POST | 입고 등록 |
| `/api/bom/:product_code` | GET | BOM 조회 |

### 11.2 Cloudflare 관리
- **Dashboard**: https://dash.cloudflare.com
- **Wrangler CLI**: `npx wrangler d1 execute haccp-erp-production --remote`

---

**보고서 작성**: AI ERP 마이그레이션 어시스턴트  
**검토 필요**: 시스템 관리자 확인 후 운영 적용 권장
