const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // 콘솔 메시지 캡처
  page.on('console', msg => {
    if (msg.type() === 'log' || msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[${msg.type().toUpperCase()}]`, msg.text());
    }
  });
  
  console.log('1. 페이지 로드 중...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  
  console.log('\n2. 일별 수불부 메뉴 클릭...');
  await page.evaluate(() => {
    navigateTo('daily-report');
  });
  await page.waitForTimeout(2000);
  
  console.log('\n3. 조회 버튼 클릭...');
  await page.evaluate(() => {
    loadDailyLedger();
  });
  await page.waitForTimeout(3000);
  
  console.log('\n4. window.dailyLedgerData 확인...');
  const dataCheck = await page.evaluate(() => {
    return {
      dataLength: (window.dailyLedgerData || []).length,
      periodExists: !!window.dailyLedgerPeriod,
      summaryExists: !!window.dailyLedgerSummary,
      firstItem: window.dailyLedgerData?.[0] ? JSON.stringify(window.dailyLedgerData[0]).substring(0, 500) : 'NO DATA'
    };
  });
  console.log('데이터 체크:', JSON.stringify(dataCheck, null, 2));
  
  console.log('\n5. printDailyLedger 실행...');
  const printResult = await page.evaluate(() => {
    try {
      printDailyLedger();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  console.log('인쇄 결과:', printResult);
  
  await page.waitForTimeout(2000);
  await browser.close();
  console.log('\n완료!');
})();
