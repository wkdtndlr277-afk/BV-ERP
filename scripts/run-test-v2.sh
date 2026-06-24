#!/bin/bash
# 추적성 테스트 실행 스크립트 v2

API_BASE="https://bv-erp.pages.dev/api"

echo "=============================================="
echo "🔬 추적성 검증 테스트 v2 시작"
echo "=============================================="

# 1. 제품 목록 가져오기
echo ""
echo "📦 [1단계] 제품 목록 조회..."
PRODUCTS=$(curl -s "$API_BASE/admin/production-items?limit=300")
PRODUCT_COUNT=$(echo $PRODUCTS | python3 -c "import sys,json; d=json.load(sys.stdin); print(len([p for p in d.get('data',[]) if p.get('bom_count',0)>0]))")
echo "  BOM 있는 제품: ${PRODUCT_COUNT}개"

# 제품 코드/이름/BOM 추출
echo $PRODUCTS | python3 -c "
import sys,json
d=json.load(sys.stdin)
items = [p for p in d.get('data',[]) if p.get('bom_count',0)>0]
for p in items[:50]:
    print(p['production_code'] + '|' + p['production_name'][:30] + '|' + str(p.get('bom_count',0)))
" > /tmp/products.txt

echo "  제품 목록 저장 완료"

# 통계 초기화
TOTAL_ORDERS=0
TOTAL_SUCCESS=0

# 2. 테스트 데이터 생성 및 등록
echo ""
echo "📅 [2단계] 6/1~6/10 테스트 데이터 생성 및 등록"

for DAY in $(seq 1 10); do
  DATE=$(printf "2026-06-%02d" $DAY)
  
  # 하루 60~80건 랜덤 생성
  ORDER_COUNT=$((60 + RANDOM % 20))
  
  echo ""
  echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  📆 $DATE: ${ORDER_COUNT}건 생산 등록"
  
  # JSON 데이터 생성
  python3 << PYTHON_SCRIPT
import json
import random

products = []
with open('/tmp/products.txt', 'r') as f:
    for line in f:
        parts = line.strip().split('|')
        if len(parts) >= 2:
            products.append({'code': parts[0], 'name': parts[1]})

if not products:
    print("제품 없음!")
    exit(1)

channels = ['쿠팡', '컬리', '배민', '오아시스', 'GS', '네이버']
items = []

for i in range($ORDER_COUNT):
    p = random.choice(products)
    items.append({
        'product_code': p['code'],
        'product_name': p['name'],
        'quantity': random.randint(5, 50),
        'channel': random.choice(channels)
    })

payload = {
    'prod_date': '$DATE',
    'items': items
}

with open('/tmp/batch_$DAY.json', 'w') as f:
    json.dump(payload, f, ensure_ascii=False)

# 채널별 집계
channel_summary = {}
total_qty = 0
for item in items:
    ch = item['channel']
    channel_summary[ch] = channel_summary.get(ch, 0) + item['quantity']
    total_qty += item['quantity']
    
print(f"     총 수량: {total_qty}개")
for ch, qty in sorted(channel_summary.items()):
    print(f"       {ch}: {qty}개")
PYTHON_SCRIPT

  # 생산 등록 API 호출
  RESULT=$(curl -s -X POST "$API_BASE/production/simple-batch" \
    -H "Content-Type: application/json" \
    -d @/tmp/batch_$DAY.json)
  
  # 결과 파싱 (db_saved 사용)
  SUCCESS=$(echo $RESULT | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('db_saved',0) if d.get('success') else 'FAIL: '+str(d.get('error','')))")
  SHEET=$(echo $RESULT | python3 -c "import sys,json; d=json.load(sys.stdin); print('✓' if d.get('sheet_sent') else '✗')")
  
  echo "  ✅ DB 저장: ${SUCCESS}건, 시트: ${SHEET}"
  
  # 통계 업데이트
  TOTAL_ORDERS=$((TOTAL_ORDERS + ORDER_COUNT))
  if [[ "$SUCCESS" =~ ^[0-9]+$ ]]; then
    TOTAL_SUCCESS=$((TOTAL_SUCCESS + SUCCESS))
  fi
  
  # 잠시 대기
  sleep 0.3
done

echo ""
echo "=============================================="
echo "📊 생산 등록 완료"
echo "  - 총 발주: ${TOTAL_ORDERS}건"
echo "  - DB 저장: ${TOTAL_SUCCESS}건"
echo "=============================================="

# 3. 구글시트 동기화 및 BOM 계산
echo ""
echo "🔄 [3단계] 구글시트 동기화..."

# BOM 동기화
echo "  BOM 데이터 동기화..."
curl -s -X POST "$API_BASE/sheets/sync/bom" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  ✅ ' + d.get('message','실패'))"

# 입고 데이터 동기화
echo "  원료 입고 동기화..."
curl -s -X POST "$API_BASE/sheets/sync/inbound" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  ✅ ' + d.get('message','실패'))"

sleep 1

# 4. 일별 원료 사용량 계산 (각 날짜별)
echo ""
echo "🧮 [4단계] 원료 사용량 계산 (BOM 기반)..."

for DAY in $(seq 1 10); do
  DATE=$(printf "2026-06-%02d" $DAY)
  
  CALC_RESULT=$(curl -s -X POST "$API_BASE/sheets/test/calculate-usage" \
    -H "Content-Type: application/json" \
    -d "{\"prod_date\": \"$DATE\"}")
  
  PROD_COUNT=$(echo $CALC_RESULT | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('summary',{}).get('production_count',0) if d.get('success') else 'FAIL')")
  LOT_COUNT=$(echo $CALC_RESULT | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('summary',{}).get('lot_matching_count',0) if d.get('success') else '')")
  
  echo "  $DATE: 생산 ${PROD_COUNT}건, 로트매칭 ${LOT_COUNT}건"
  sleep 0.3
done

echo ""
echo "=============================================="
echo "✅ 추적성 테스트 완료!"
echo "=============================================="
echo ""
echo "📋 확인 방법:"
echo "  1. 구글시트에서 '생산실적' 탭 확인"
echo "  2. 구글시트에서 '로트매칭' 탭 확인"
echo "  3. 구글시트에서 '일별수불부' 탭 확인"
echo ""
echo "📊 구글시트 URL:"
echo "  https://docs.google.com/spreadsheets/d/1aEvc4673J0wZoPuojwgrxVu7qhkR5VuymmlKPdHpNfU"
echo ""
