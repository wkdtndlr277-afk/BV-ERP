#!/bin/bash
# 추적성 테스트 실행 스크립트

API_BASE="https://bv-erp.pages.dev/api"

echo "=============================================="
echo "🔬 추적성 검증 테스트 시작"
echo "=============================================="

# 1. 제품 목록 가져오기
echo ""
echo "📦 [1단계] 제품 목록 조회..."
PRODUCTS=$(curl -s "$API_BASE/admin/production-items?limit=300")
PRODUCT_COUNT=$(echo $PRODUCTS | python3 -c "import sys,json; d=json.load(sys.stdin); print(len([p for p in d.get('data',[]) if p.get('bom_count',0)>0]))")
echo "  BOM 있는 제품: ${PRODUCT_COUNT}개"

# 제품 코드 목록 추출
PRODUCT_CODES=$(echo $PRODUCTS | python3 -c "
import sys,json
d=json.load(sys.stdin)
items = [p for p in d.get('data',[]) if p.get('bom_count',0)>0]
for p in items[:50]:
    print(p['production_code'] + '|' + p['production_name'][:30])
")

echo "$PRODUCT_CODES" > /tmp/products.txt
echo "  제품 목록 저장 완료"

# 2. 테스트 데이터 생성 및 등록
echo ""
echo "📅 [2단계] 6/1~6/10 테스트 데이터 생성 및 등록"

for DAY in $(seq 1 10); do
  DATE=$(printf "2026-06-%02d" $DAY)
  SHIP_DATE=$(printf "2026-06-%02d" $((DAY+1)))
  
  # 하루 60~80건 랜덤 생성
  ORDER_COUNT=$((60 + RANDOM % 20))
  
  echo ""
  echo "  📆 $DATE: ${ORDER_COUNT}건 생산 등록 중..."
  
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

print(f"  생성된 품목: {len(items)}건")

# 채널별 집계
channel_summary = {}
for item in items:
    ch = item['channel']
    channel_summary[ch] = channel_summary.get(ch, 0) + item['quantity']
for ch, qty in sorted(channel_summary.items()):
    print(f"    {ch}: {qty}개")
PYTHON_SCRIPT

  # 생산 등록 API 호출
  RESULT=$(curl -s -X POST "$API_BASE/production/simple-batch" \
    -H "Content-Type: application/json" \
    -d @/tmp/batch_$DAY.json)
  
  SUCCESS=$(echo $RESULT | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('success',0) if d.get('success') else 'FAIL: '+str(d.get('error','')))")
  echo "  ✅ 생산 등록 결과: $SUCCESS"
  
  # 잠시 대기 (API 부하 방지)
  sleep 0.5
done

echo ""
echo "=============================================="
echo "✅ 테스트 데이터 생성 완료!"
echo "=============================================="
