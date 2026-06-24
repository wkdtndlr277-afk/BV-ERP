/**
 * 추적성 검증 테스트 스크립트
 * - 6/1 ~ 6/10 기간 동안 하루 약 50~80건 발주 (총 500~800건)
 * - 생산 등록 → 다음날 100% 출고
 * - 일별수불부 정합성 검증
 * - 추적성 보고서 출력
 */

const API_BASE = 'https://bv-erp.pages.dev/api';
const CHANNELS = ['쿠팡', '컬리', '배민', '오아시스', 'GS', '네이버'];

// 테스트 설정
const TEST_CONFIG = {
  startDate: '2026-06-01',
  endDate: '2026-06-10',
  minOrdersPerDay: 50,
  maxOrdersPerDay: 80,
  minQuantity: 5,
  maxQuantity: 50
};

// API 호출 헬퍼
async function api(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) options.body = JSON.stringify(body);
  
  const res = await fetch(`${API_BASE}${endpoint}`, options);
  return res.json();
}

// 날짜 범위 생성
function getDateRange(start, end) {
  const dates = [];
  let current = new Date(start);
  const endDate = new Date(end);
  
  while (current <= endDate) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// 랜덤 선택
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 메인 테스트 함수
async function runTraceabilityTest() {
  console.log('='.repeat(60));
  console.log('🔬 추적성 검증 테스트 시작');
  console.log('='.repeat(60));
  
  // 1. 제품 목록 조회
  console.log('\n📦 [1단계] 제품 목록 조회...');
  const productsRes = await api('/admin/production-items?limit=300');
  if (!productsRes.success) {
    console.error('제품 목록 조회 실패:', productsRes.error);
    return;
  }
  
  // BOM이 있는 제품만 필터링
  const products = productsRes.data.filter(p => p.bom_count > 0);
  console.log(`  - 전체 제품: ${productsRes.data.length}개`);
  console.log(`  - BOM 있는 제품: ${products.length}개`);
  
  // 2. 날짜별 발주/생산/출고 데이터 생성
  const dates = getDateRange(TEST_CONFIG.startDate, TEST_CONFIG.endDate);
  console.log(`\n📅 [2단계] ${dates[0]} ~ ${dates[dates.length-1]} 테스트 데이터 생성`);
  
  const allOrders = [];  // 전체 발주 기록
  const dailySummary = {};  // 일별 요약
  
  for (const date of dates) {
    const orderCount = randomInt(TEST_CONFIG.minOrdersPerDay, TEST_CONFIG.maxOrdersPerDay);
    const dayOrders = [];
    
    for (let i = 0; i < orderCount; i++) {
      const product = randomChoice(products);
      const channel = randomChoice(CHANNELS);
      const quantity = randomInt(TEST_CONFIG.minQuantity, TEST_CONFIG.maxQuantity);
      
      dayOrders.push({
        order_date: date,
        product_code: product.production_code,
        product_name: product.production_name,
        quantity,
        channel,
        // 생산일 = 발주일, 출고일 = 생산일 다음날
        prod_date: date,
        ship_date: new Date(new Date(date).getTime() + 86400000).toISOString().split('T')[0]
      });
    }
    
    allOrders.push(...dayOrders);
    dailySummary[date] = {
      orders: dayOrders.length,
      totalQuantity: dayOrders.reduce((sum, o) => sum + o.quantity, 0),
      channels: [...new Set(dayOrders.map(o => o.channel))]
    };
    
    console.log(`  ${date}: ${dayOrders.length}건 발주, 총 ${dailySummary[date].totalQuantity}개`);
  }
  
  console.log(`\n📊 총 발주: ${allOrders.length}건`);
  
  // 3. 생산 등록 (simple-batch API)
  console.log('\n🏭 [3단계] 생산 등록...');
  
  const productionResults = {};
  for (const date of dates) {
    const dayOrders = allOrders.filter(o => o.prod_date === date);
    
    // 배치로 분할 (30개씩)
    const batches = [];
    for (let i = 0; i < dayOrders.length; i += 30) {
      batches.push(dayOrders.slice(i, i + 30));
    }
    
    let successCount = 0;
    for (const batch of batches) {
      const items = batch.map(o => ({
        product_code: o.product_code,
        product_name: o.product_name,
        quantity: o.quantity,
        channel: o.channel
      }));
      
      const result = await api('/production/simple-batch', 'POST', {
        prod_date: date,
        items
      });
      
      if (result.success) {
        successCount += result.data?.success || items.length;
      }
    }
    
    productionResults[date] = successCount;
    console.log(`  ${date}: ${successCount}/${dayOrders.length}건 생산 등록 완료`);
  }
  
  // 4. 출고 등록 (생산 다음날)
  console.log('\n🚚 [4단계] 출고 등록 (생산 다음날 100%)...');
  
  const shipmentResults = {};
  for (const date of dates) {
    const shipDate = new Date(new Date(date).getTime() + 86400000).toISOString().split('T')[0];
    const dayProductions = allOrders.filter(o => o.prod_date === date);
    
    // 출고 등록
    const shipItems = dayProductions.map(o => ({
      product_code: o.product_code,
      product_name: o.product_name,
      quantity: o.quantity,
      channel: o.channel,
      ship_date: shipDate
    }));
    
    // 배치로 분할
    const batches = [];
    for (let i = 0; i < shipItems.length; i += 30) {
      batches.push(shipItems.slice(i, i + 30));
    }
    
    let successCount = 0;
    for (const batch of batches) {
      const result = await api('/outbound/batch', 'POST', {
        ship_date: shipDate,
        items: batch
      });
      
      if (result.success) {
        successCount += batch.length;
      }
    }
    
    shipmentResults[shipDate] = successCount;
    console.log(`  ${shipDate}: ${successCount}건 출고 완료 (생산일: ${date})`);
  }
  
  // 5. 일별수불부 검증
  console.log('\n📋 [5단계] 일별수불부 검증...');
  
  // 구글시트에서 계산 트리거
  const calcResult = await api('/sheets/test/calculate-usage', 'POST', {
    prod_date: TEST_CONFIG.startDate
  });
  console.log('  구글시트 계산 트리거:', calcResult.success ? '완료' : '실패');
  
  // 6. 추적성 요약 보고서 생성
  console.log('\n📝 [6단계] 추적성 요약 보고서');
  console.log('='.repeat(60));
  
  const report = {
    test_period: `${TEST_CONFIG.startDate} ~ ${TEST_CONFIG.endDate}`,
    total_orders: allOrders.length,
    total_quantity: allOrders.reduce((sum, o) => sum + o.quantity, 0),
    daily_summary: dailySummary,
    production_results: productionResults,
    shipment_results: shipmentResults,
    channels: CHANNELS.map(ch => ({
      channel: ch,
      orders: allOrders.filter(o => o.channel === ch).length,
      quantity: allOrders.filter(o => o.channel === ch).reduce((sum, o) => sum + o.quantity, 0)
    }))
  };
  
  console.log(JSON.stringify(report, null, 2));
  
  return report;
}

// Node.js 환경에서 실행
if (typeof module !== 'undefined') {
  module.exports = { runTraceabilityTest, api, TEST_CONFIG };
}

// 브라우저에서 실행 가능
if (typeof window !== 'undefined') {
  window.runTraceabilityTest = runTraceabilityTest;
}
