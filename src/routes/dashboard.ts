// 대시보드 API
// ★★★ v3.6.75: 대시보드 시각화 개선 - 신호등 시스템, A등급 우선 배치, 요약 카드, 라인 차트 ★★★
import { Hono } from 'hono';
import type { Bindings } from '../types';
import { GoogleSheetsService } from '../services/GoogleSheetsService';

// ★ v3.6.80: 제외할 품목 코드 (입고 원료가 아닌 것들)
// - RM184: 정제수
// - RM266, RM267: 입고 대상 아님
// - SF로 시작하는 품목: 반제품(발효종 등), 입고 원료 아님
const EXCLUDED_ITEM_CODES = ['RM184', 'RM266', 'RM267'];
const EXCLUDED_ITEM_PREFIXES = ['SF'];  // SF로 시작하는 품목 제외

// ★★★ v3.6.122: KST(한국시간) 날짜 헬퍼 함수 추가 ★★★
function getKSTDate(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  return kst.toISOString().split('T')[0];
}

function getKSTDateObject(): Date {
  const now = new Date();
  return new Date(now.getTime() + (9 * 60 * 60 * 1000));
}

// GoogleSheetsService 헬퍼 (올바른 방식)
function getSheetService(c: any): GoogleSheetsService | null {
  const clientEmail = c.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = c.env.GOOGLE_PRIVATE_KEY;
  
  if (!clientEmail || !privateKey) {
    return null;
  }
  
  // 환경변수에서 개행문자 복원
  const formattedKey = privateKey.replace(/\\n/g, '\n');
  return new GoogleSheetsService(clientEmail, formattedKey);
}

const dashboardRoutes = new Hono<{ Bindings: Bindings }>();

// 대시보드 전체 데이터
dashboardRoutes.get('/', async (c) => {
  // ★★★ v3.6.122: UTC → KST 날짜로 변경 ★★★
  const today = getKSTDate();
  
  // ★★★ v3.6.61: 바코드 재고관리(D1 inbound 잔량) 기반 안전재고 체크 ★★★
  let lowStockItems: any[] = [];
  let lowStockCount = 0;
  let expiringLots: any[] = [];
  let expiringCount = 0;
  
  try {
    // 1. ★★★ D1 inbound 테이블에서 원료별 실재고(잔량 합계) 조회 ★★★
    const realStockResult = await c.env.DB.prepare(`
      SELECT 
        m.item_code,
        m.item_name,
        m.unit,
        m.safety_stock,
        COALESCE(SUM(i.remain_qty), 0) as real_stock
      FROM master m
      LEFT JOIN inbound i ON m.item_code = i.item_code 
        AND i.remain_qty > 0 
        AND i.quality_status = '합격'
      WHERE m.category = '원료' AND m.safety_stock > 0
      GROUP BY m.item_code, m.item_name, m.unit, m.safety_stock
      HAVING real_stock < m.safety_stock
      ORDER BY (m.safety_stock - real_stock) DESC
    `).all<{ item_code: string; item_name: string; unit: string; safety_stock: number; real_stock: number }>();
    
    // 2. 안전재고 미만 품목 리스트 생성
    for (const item of realStockResult.results || []) {
      lowStockItems.push({
        item_code: item.item_code,
        item_name: item.item_name,
        category: '원료',
        unit: item.unit || 'kg',
        current_stock: Math.round(item.real_stock * 100) / 100,
        safety_stock: item.safety_stock,
        shortage: Math.round((item.safety_stock - item.real_stock) * 100) / 100,
        source: 'barcode'  // 바코드 재고 기준임을 표시
      });
    }
    lowStockCount = lowStockItems.length;
  } catch (dbError) {
    console.error('D1 stock check error:', dbError);
  }
  
  // ★★★ v3.6.61: D1 inbound 테이블에서 유통기한 30일 이내 LOT 조회 ★★★
  try {
    const d1Expiring = await c.env.DB.prepare(`
      SELECT 
        i.item_code,
        m.item_name,
        i.lot_number,
        i.remain_qty,
        i.expiry_date,
        m.unit,
        CAST(julianday(i.expiry_date) - julianday(?) AS INTEGER) as days_until_expiry
      FROM inbound i
      JOIN master m ON i.item_code = m.item_code
      WHERE i.remain_qty > 0 
        AND i.quality_status = '합격'
        AND i.expiry_date IS NOT NULL
        AND julianday(i.expiry_date) - julianday(?) BETWEEN 0 AND 30
      ORDER BY i.expiry_date ASC
      LIMIT 50
    `).bind(today, today).all();
    
    for (const lot of d1Expiring.results || []) {
      expiringLots.push({
        item_code: lot.item_code,
        item_name: lot.item_name,
        lot_number: lot.lot_number,
        remain_qty: lot.remain_qty,
        expiry_date: lot.expiry_date,
        days_until_expiry: lot.days_until_expiry,
        unit: lot.unit || 'kg',
        category: '원료',
        source: 'barcode'
      });
    }
    expiringCount = expiringLots.length;
  } catch (expiryError) {
    console.error('D1 expiry check error:', expiryError);
  }
  
  // 오늘 원료 사용량 (D1 transactions 기준)
  const todayUsage = await c.env.DB.prepare(`
    SELECT t.item_code, m.item_name, m.unit, SUM(ABS(t.quantity)) as total_qty
    FROM transactions t
    JOIN master m ON t.item_code = m.item_code
    WHERE t.trans_date = ? AND t.trans_type = '사용' AND m.category = '원료'
    GROUP BY t.item_code
    ORDER BY total_qty DESC
    LIMIT 10
  `).bind(today).all();
  
  // 오늘 제품 출고량
  const todayOutbound = await c.env.DB.prepare(`
    SELECT t.item_code, m.item_name, m.unit, SUM(ABS(t.quantity)) as total_qty
    FROM transactions t
    JOIN master m ON t.item_code = m.item_code
    WHERE t.trans_date = ? AND t.trans_type = '출고' AND m.category = '제품'
    GROUP BY t.item_code
    ORDER BY total_qty DESC
    LIMIT 10
  `).bind(today).all();
  
  // 품질 KPI 알림
  const nonCompliantCount = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM quality_kpi WHERE kpi_date = ? AND judgment = '부적합'
  `).bind(today).first<{ count: number }>();
  
  const todayKpiCount = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM quality_kpi WHERE kpi_date = ?
  `).bind(today).first<{ count: number }>();
  
  // 재고 현황 요약
  const stockSummary = await c.env.DB.prepare(`
    SELECT 
      category,
      COUNT(*) as item_count,
      SUM(current_stock) as total_stock,
      SUM(CASE WHEN current_stock < safety_stock AND safety_stock > 0 THEN 1 ELSE 0 END) as low_stock_count
    FROM master
    GROUP BY category
  `).all();
  
  // 최근 입고 내역
  const recentInbound = await c.env.DB.prepare(`
    SELECT i.*, m.item_name, m.category
    FROM inbound i
    JOIN master m ON i.item_code = m.item_code
    ORDER BY i.created_at DESC
    LIMIT 5
  `).all();
  
  // 최근 거래 내역
  const recentTransactions = await c.env.DB.prepare(`
    SELECT t.*, m.item_name, m.category
    FROM transactions t
    JOIN master m ON t.item_code = m.item_code
    ORDER BY t.created_at DESC
    LIMIT 10
  `).all();
  
  // ★★★ v3.6.93: 생산 현황 추가 - 일별/주별/월별 요약 ★★★
  let productionStats = {
    todayTotal: 0,        // 오늘 총 생산 수량
    todayProducts: 0,     // 오늘 생산 품목 수
    todayRecords: 0,      // 오늘 생산 등록 건수
    weekTotal: 0,         // 이번주 총 생산 수량
    weekProducts: 0,      // 이번주 생산 품목 수
    monthTotal: 0,        // 이번달 총 생산 수량
    monthProducts: 0,     // 이번달 생산 품목 수
    byChannel: {} as Record<string, { count: number; quantity: number }>,  // 채널별 현황
    // ★★★ v3.6.99: 일별 요약 (생산일, 품목수, 총생산량, 채널별) ★★★
    dailySummary: [] as { date: string; products: number; total: number; records: number; byChannel: Record<string, number> }[],
    weeklySummary: [] as { week: string; startDate: string; endDate: string; products: number; total: number; records: number }[],
    monthlySummary: [] as { month: string; products: number; total: number; records: number }[]
  };
  
  // ★★★ v3.6.63: service 변수 선언 추가 ★★★
  const service = getSheetService(c);
  
  if (service) {
    try {
      const spreadsheetId = c.env.GOOGLE_SHEET_ID;
      if (spreadsheetId) {
        service.setSpreadsheetId(spreadsheetId);
      }
      
      // 생산실적 시트에서 데이터 조회
      // 컬럼: A:생산일, B:제품코드, C:제품명, D:수량, E:LOT번호, F:채널, G:비고, H:생성일
      const productionData = await service.readSheet('생산실적', 'A2:H10000');
      
      // 날짜 계산
      const todayStr = today;
      const todayDate = new Date(today);
      const weekAgo = new Date(todayDate);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoStr = weekAgo.toISOString().split('T')[0];
      const monthStart = today.substring(0, 7) + '-01';  // 이번달 1일
      const threeMonthsAgo = new Date(todayDate);
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const threeMonthsAgoStr = threeMonthsAgo.toISOString().split('T')[0];
      
      const todayItems = new Set<string>();
      const weekItems = new Set<string>();
      const monthItems = new Set<string>();
      const channelStats: Record<string, { count: number; quantity: number }> = {};
      
      // ★★★ v3.6.99: 일별/주별/월별 집계용 맵 (채널별 추가) ★★★
      const dailyMap = new Map<string, { products: Set<string>; total: number; records: number; byChannel: Record<string, number> }>();
      const monthlyMap = new Map<string, { products: Set<string>; total: number; records: number }>();
      
      for (const row of productionData || []) {
        const prodDate = String(row[0] || '').trim().replace(/^'/, '');
        const productCode = String(row[1] || '').trim();
        const quantity = parseInt(row[3]) || 0;
        const channel = String(row[5] || '').trim() || '기타';
        
        if (!prodDate || !productCode) continue;
        
        // ★★★ v3.6.99: 일별 집계 (최근 30일, 채널별 포함) ★★★
        const thirtyDaysAgo = new Date(todayDate);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        if (prodDate >= thirtyDaysAgo.toISOString().split('T')[0]) {
          if (!dailyMap.has(prodDate)) {
            dailyMap.set(prodDate, { products: new Set(), total: 0, records: 0, byChannel: {} });
          }
          const daily = dailyMap.get(prodDate)!;
          daily.products.add(productCode);
          daily.total += quantity;
          daily.records++;
          // 채널별 집계
          if (!daily.byChannel[channel]) {
            daily.byChannel[channel] = 0;
          }
          daily.byChannel[channel] += quantity;
        }
        
        // ★★★ 월별 집계 (최근 3개월) ★★★
        if (prodDate >= threeMonthsAgoStr) {
          const monthKey = prodDate.substring(0, 7);  // YYYY-MM
          if (!monthlyMap.has(monthKey)) {
            monthlyMap.set(monthKey, { products: new Set(), total: 0, records: 0 });
          }
          const monthly = monthlyMap.get(monthKey)!;
          monthly.products.add(productCode);
          monthly.total += quantity;
          monthly.records++;
        }
        
        // 오늘 생산 현황
        if (prodDate === todayStr) {
          productionStats.todayTotal += quantity;
          productionStats.todayRecords++;
          todayItems.add(productCode);
          
          // 채널별 집계 (오늘 기준)
          if (!channelStats[channel]) {
            channelStats[channel] = { count: 0, quantity: 0 };
          }
          channelStats[channel].count++;
          channelStats[channel].quantity += quantity;
        }
        
        // 이번주 생산 현황
        if (prodDate >= weekAgoStr && prodDate <= todayStr) {
          productionStats.weekTotal += quantity;
          weekItems.add(productCode);
        }
        
        // 이번달 생산 현황
        if (prodDate >= monthStart && prodDate <= todayStr) {
          productionStats.monthTotal += quantity;
          monthItems.add(productCode);
        }
      }
      
      productionStats.todayProducts = todayItems.size;
      productionStats.weekProducts = weekItems.size;
      productionStats.monthProducts = monthItems.size;
      productionStats.byChannel = channelStats;
      
      // ★★★ v3.6.99: 일별 요약 배열 생성 (최근 14일, 채널별 포함) ★★★
      productionStats.dailySummary = Array.from(dailyMap.entries())
        .map(([date, data]) => ({
          date,
          products: data.products.size,
          total: data.total,
          records: data.records,
          byChannel: data.byChannel
        }))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 14);
      
      // ★★★ v3.6.93: 주별 요약 (최근 4주) ★★★
      const weeklyData: { [key: string]: { products: Set<string>; total: number; records: number; startDate: string; endDate: string } } = {};
      for (const [date, data] of dailyMap.entries()) {
        const d = new Date(date);
        const weekNum = Math.floor((todayDate.getTime() - d.getTime()) / (7 * 24 * 60 * 60 * 1000));
        if (weekNum < 4) {
          const weekKey = weekNum === 0 ? '이번주' : weekNum === 1 ? '지난주' : `${weekNum}주 전`;
          if (!weeklyData[weekKey]) {
            weeklyData[weekKey] = { products: new Set(), total: 0, records: 0, startDate: date, endDate: date };
          }
          data.products.forEach(p => weeklyData[weekKey].products.add(p));
          weeklyData[weekKey].total += data.total;
          weeklyData[weekKey].records += data.records;
          if (date < weeklyData[weekKey].startDate) weeklyData[weekKey].startDate = date;
          if (date > weeklyData[weekKey].endDate) weeklyData[weekKey].endDate = date;
        }
      }
      productionStats.weeklySummary = ['이번주', '지난주', '2주 전', '3주 전']
        .filter(week => weeklyData[week])
        .map(week => ({
          week,
          startDate: weeklyData[week].startDate,
          endDate: weeklyData[week].endDate,
          products: weeklyData[week].products.size,
          total: weeklyData[week].total,
          records: weeklyData[week].records
        }));
      
      // ★★★ v3.6.93: 월별 요약 배열 생성 ★★★
      productionStats.monthlySummary = Array.from(monthlyMap.entries())
        .map(([month, data]) => ({
          month,
          products: data.products.size,
          total: data.total,
          records: data.records
        }))
        .sort((a, b) => b.month.localeCompare(a.month))
        .slice(0, 3);
      
    } catch (prodError: any) {
      console.error('[dashboard] 생산 현황 조회 오류:', prodError.message);
    }
  }
  
  return c.json({
    success: true,
    data: {
      date: today,
      alerts: {
        lowStockItems: lowStockItems,
        lowStockCount: lowStockCount,
        expiringLots: expiringLots,
        expiringCount: expiringCount,
        kpiAlerts: {
          nonCompliantCount: nonCompliantCount?.count || 0,
          unregisteredToday: (todayKpiCount?.count || 0) === 0
        }
      },
      today: {
        usage: todayUsage.results,
        outbound: todayOutbound.results
      },
      summary: {
        stock: stockSummary.results,
        recentInbound: recentInbound.results,
        recentTransactions: recentTransactions.results
      },
      // ★★★ v3.6.49: 생산 현황 추가 ★★★
      production: productionStats
    }
  });
});

// 알림 카운트 (헤더 배지용)
dashboardRoutes.get('/alerts/count', async (c) => {
  // ★★★ v3.6.122: UTC → KST 날짜로 변경 ★★★
  const today = getKSTDate();
  
  // 원료만 안전재고 미만 카운트 (safety_stock > 0인 것만)
  const lowStock = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM master 
    WHERE current_stock < safety_stock 
      AND safety_stock > 0
      AND category = '원료'
  `).first<{ count: number }>();
  
  const expiring = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM inbound i
    JOIN master m ON i.item_code = m.item_code
    WHERE i.remain_qty > 0 AND i.quality_status = '합격'
      AND m.category = '원료'
      AND julianday(i.expiry_date) - julianday(?) <= 30
      AND julianday(i.expiry_date) - julianday(?) >= 0
  `).bind(today, today).first<{ count: number }>();
  
  const kpiIssues = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM quality_kpi WHERE kpi_date = ? AND judgment = '부적합'
  `).bind(today).first<{ count: number }>();
  
  const todayKpi = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM quality_kpi WHERE kpi_date = ?
  `).bind(today).first<{ count: number }>();
  
  return c.json({
    success: true,
    data: {
      lowStock: lowStock?.count || 0,
      expiring: expiring?.count || 0,
      kpiIssues: kpiIssues?.count || 0,
      kpiUnregistered: (todayKpi?.count || 0) === 0 ? 1 : 0,
      total: (lowStock?.count || 0) + (expiring?.count || 0) + (kpiIssues?.count || 0) + ((todayKpi?.count || 0) === 0 ? 1 : 0)
    }
  });
});

// ★★★ v3.6.122: 안전재고 현황 API - D1 transactions + 구글시트 일별수불부 통합 (KST 날짜 적용) ★★★
dashboardRoutes.get('/safety-stock-status', async (c) => {
  try {
    // ★★★ v3.6.122: KST 기준 날짜 계산 ★★★
    const todayStr = getKSTDate();
    const kstNow = getKSTDateObject();
    
    // 최근 30일 기준 날짜 계산
    const startDate = new Date(kstNow);
    startDate.setDate(kstNow.getDate() - 30);
    const startDateStr = startDate.toISOString().split('T')[0];
    
    // ★★★ v3.6.121: 1. D1 transactions 테이블에서 실재고 기반 사용량 조회 ★★★
    let d1UsageMap: Record<string, { dailyAvg: number; totalUsage: number; usageDays: number; source: string }> = {};
    try {
      const d1Result = await c.env.DB.prepare(`
        SELECT 
          item_code,
          trans_date,
          SUM(ABS(quantity)) as daily_usage
        FROM transactions
        WHERE trans_type = '사용'
          AND trans_date >= ?
          AND trans_date <= ?
          AND item_code LIKE 'R%'
        GROUP BY item_code, trans_date
      `).bind(startDateStr, todayStr).all<{ item_code: string; trans_date: string; daily_usage: number }>();
      
      if (d1Result.results && d1Result.results.length > 0) {
        // 품목별 집계
        const tempD1Map: Record<string, { usages: number[], dates: Set<string> }> = {};
        
        for (const row of d1Result.results) {
          if (!tempD1Map[row.item_code]) {
            tempD1Map[row.item_code] = { usages: [], dates: new Set() };
          }
          if (row.daily_usage > 0) {
            tempD1Map[row.item_code].usages.push(row.daily_usage);
            tempD1Map[row.item_code].dates.add(row.trans_date);
          }
        }
        
        // 일평균 계산
        for (const [itemCode, data] of Object.entries(tempD1Map)) {
          if (data.usages.length > 0) {
            const totalUsage = data.usages.reduce((a, b) => a + b, 0);
            const usageDays = data.dates.size;
            d1UsageMap[itemCode] = {
              dailyAvg: Math.round((totalUsage / usageDays) * 100) / 100,
              totalUsage,
              usageDays,
              source: 'D1'
            };
          }
        }
        console.log('[safety-stock-status] D1 transactions 사용량 조회 완료:', Object.keys(d1UsageMap).length, '품목');
      }
    } catch (d1Error) {
      console.error('[safety-stock-status] D1 transactions 조회 실패:', d1Error);
    }
    
    // ★★★ v3.6.121: 2. 구글시트 일별수불부에서 서류상 사용량 조회 ★★★
    let sheetUsageMap: Record<string, { dailyAvg: number; totalUsage: number; usageDays: number; source: string }> = {};
    const service = getSheetService(c);
    
    if (service) {
      try {
        // 구글시트에서 일별수불부 조회
        const sheetData = await service.readSheet('일별수불부', 'A2:G');
        
        if (sheetData && sheetData.length > 0) {
          // 품목별 사용량 집계
          const tempMap: Record<string, { usages: number[], dates: Set<string> }> = {};
          
          for (const row of sheetData) {
            const dateStr = String(row[0] || '').trim();
            const itemCode = String(row[1] || '').trim();
            const usedQty = parseFloat(String(row[5] || '0').replace(/,/g, '')) || 0;
            
            // 날짜 필터링 (최근 30일)
            if (!dateStr || dateStr < startDateStr || dateStr > todayStr) continue;
            if (!itemCode.startsWith('R')) continue;
            
            if (!tempMap[itemCode]) {
              tempMap[itemCode] = { usages: [], dates: new Set() };
            }
            
            if (usedQty > 0) {
              tempMap[itemCode].usages.push(usedQty);
              tempMap[itemCode].dates.add(dateStr);
            }
          }
          
          // 일평균 계산
          for (const [itemCode, data] of Object.entries(tempMap)) {
            if (data.usages.length > 0) {
              const totalUsage = data.usages.reduce((a, b) => a + b, 0);
              const usageDays = data.dates.size;
              sheetUsageMap[itemCode] = {
                dailyAvg: Math.round((totalUsage / usageDays) * 100) / 100,
                totalUsage,
                usageDays,
                source: 'Sheet'
              };
            }
          }
          console.log('[safety-stock-status] 구글시트 사용량 조회 완료:', Object.keys(sheetUsageMap).length, '품목');
        }
      } catch (sheetError) {
        console.error('[safety-stock-status] 구글시트 조회 실패:', sheetError);
      }
    }
    
    // ★★★ v3.6.121: 3. 두 데이터 소스 병합 - 평균치 계산 ★★★
    // D1(실재고 기반) + 구글시트(서류상 재고) 통합
    let mergedUsageMap: Record<string, { 
      dailyAvg: number; 
      d1Avg: number; 
      sheetAvg: number; 
      source: string;
      usageDays: number;
    }> = {};
    
    // 모든 품목코드 수집
    const allItemCodes = new Set([...Object.keys(d1UsageMap), ...Object.keys(sheetUsageMap)]);
    
    for (const itemCode of allItemCodes) {
      const d1Data = d1UsageMap[itemCode];
      const sheetData = sheetUsageMap[itemCode];
      
      let finalDailyAvg = 0;
      let source = '';
      let usageDays = 0;
      
      if (d1Data && sheetData) {
        // 둘 다 있으면 평균 계산
        finalDailyAvg = Math.round(((d1Data.dailyAvg + sheetData.dailyAvg) / 2) * 100) / 100;
        source = `D1(${d1Data.dailyAvg})+Sheet(${sheetData.dailyAvg})`;
        usageDays = Math.max(d1Data.usageDays, sheetData.usageDays);
      } else if (d1Data) {
        // D1만 있으면 D1 값 사용
        finalDailyAvg = d1Data.dailyAvg;
        source = `D1(${d1Data.dailyAvg})`;
        usageDays = d1Data.usageDays;
      } else if (sheetData) {
        // 구글시트만 있으면 구글시트 값 사용
        finalDailyAvg = sheetData.dailyAvg;
        source = `Sheet(${sheetData.dailyAvg})`;
        usageDays = sheetData.usageDays;
      }
      
      mergedUsageMap[itemCode] = {
        dailyAvg: finalDailyAvg,
        d1Avg: d1Data?.dailyAvg || 0,
        sheetAvg: sheetData?.dailyAvg || 0,
        source,
        usageDays
      };
    }
    
    console.log('[safety-stock-status] 통합 사용량 계산 완료:', Object.keys(mergedUsageMap).length, '품목');
    
    // 1. 원료별 실재고 + 저장된 통계값 + 유통기한기준일 조회
    const stockResult = await c.env.DB.prepare(`
      SELECT 
        m.item_code,
        m.item_name,
        m.unit,
        m.safety_stock,
        m.daily_usage_avg,
        m.monthly_usage_avg,
        m.inbound_frequency,
        m.lead_time,
        m.usage_std_dev,
        m.usage_cv,
        m.item_grade,
        m.calculated_reorder_point,
        m.stats_updated_at,
        COALESCE(m.expiry_days, 365) as expiry_days,
        COALESCE(SUM(i.remain_qty), 0) as current_stock
      FROM master m
      LEFT JOIN inbound i ON m.item_code = i.item_code 
        AND i.remain_qty > 0 
        AND i.quality_status = '합격'
      WHERE m.category = '원료'
        AND COALESCE(m.is_active, 1) = 1
      GROUP BY m.item_code, m.item_name, m.unit, m.safety_stock,
               m.daily_usage_avg, m.monthly_usage_avg, m.inbound_frequency, m.lead_time,
               m.usage_std_dev, m.usage_cv, m.item_grade, m.calculated_reorder_point, m.stats_updated_at, m.expiry_days
    `).all<{ 
      item_code: string; item_name: string; unit: string; safety_stock: number;
      daily_usage_avg: number; monthly_usage_avg: number; inbound_frequency: number; lead_time: number;
      usage_std_dev: number; usage_cv: number; item_grade: string; calculated_reorder_point: number;
      stats_updated_at: string; current_stock: number; expiry_days: number;
    }>();
    
    // 2. 품목별 신호등 상태 결정
    const results: any[] = [];
    
    for (const item of stockResult.results || []) {
      // ★ v3.6.80: 제외 대상 체크
      // 1. 특정 품목코드 제외 (RM184, RM266, RM267)
      if (EXCLUDED_ITEM_CODES.includes(item.item_code)) {
        continue;
      }
      // 2. SF로 시작하는 품목 제외 (반제품/발효종)
      if (EXCLUDED_ITEM_PREFIXES.some(prefix => item.item_code.startsWith(prefix))) {
        continue;
      }
      
      // ★★★ v3.6.121: D1 + 구글시트 통합 사용량 사용 (실시간 우선) ★★★
      const mergedUsage = mergedUsageMap[item.item_code];
      // 실시간 데이터(D1+시트)가 있으면 항상 그것을 사용, 없을 때만 master 저장값 사용
      const dailyAvg = mergedUsage?.dailyAvg ?? item.daily_usage_avg ?? 0;
      const usageSource = mergedUsage?.source || (item.daily_usage_avg ? 'master(저장값)' : '없음');
      const d1Avg = mergedUsage?.d1Avg ?? 0;
      const sheetAvg = mergedUsage?.sheetAvg ?? 0;
      const leadTime = item.lead_time || 3;
      const expiryDays = item.expiry_days || 365;
      
      // ★★★ v3.6.91: 등급 재정의 ★★★
      // C등급: 유통기한이 짧은 원료 (30일 이하) - 사용량 관계없이 관리 필요
      // A등급: 사용량 많은 핵심 원료 (일평균 100kg 이상)
      // B등급: 중간 사용량 원료 (일평균 10kg 이상)
      // 기타: 저사용량 원료
      let grade: string;
      let gradeReason: string;
      
      if (expiryDays <= 30) {
        grade = 'C';
        gradeReason = `유통기한 ${expiryDays}일`;
      } else if (dailyAvg >= 100) {
        grade = 'A';
        gradeReason = `일사용량 ${Math.round(dailyAvg)}kg`;
      } else if (dailyAvg >= 10) {
        grade = 'B';
        gradeReason = `일사용량 ${Math.round(dailyAvg)}kg`;
      } else {
        grade = '기타';  // 관리 등급 외
        gradeReason = dailyAvg > 0 ? `일사용량 ${Math.round(dailyAvg * 10) / 10}kg` : '사용량 없음';
      }
      
      // 잔여일 계산
      const daysOfStock = dailyAvg > 0 
        ? Math.round((item.current_stock / dailyAvg) * 10) / 10 
        : (item.current_stock > 0 ? 999 : 0);
      
      // 발주점 (저장된 값 또는 간단 계산)
      const reorderPoint = item.calculated_reorder_point || (dailyAvg * leadTime);
      
      // 안전재고 (저장된 값 사용)
      const safetyStock = item.safety_stock || 0;
      
      // ★ v3.6.80: 신호등 상태 결정 (잔여일 10일 기준)
      // 긴급: 0-3일, 주의: 4-10일, 정상: 11일+
      let status: string;
      let statusColor: string;
      let needOrder = false;
      
      if (daysOfStock <= 3) {
        status = '🔴 긴급';
        statusColor = 'red';
        needOrder = true;
      } else if (daysOfStock <= 10) {
        status = '🟡 주의';
        statusColor = 'yellow';
        needOrder = item.current_stock <= reorderPoint;
      } else {
        status = '🟢 정상';
        statusColor = 'green';
      }
      
      // 현재고가 안전재고 이하면 무조건 주의 이상
      if (item.current_stock <= safetyStock && safetyStock > 0) {
        if (statusColor === 'green') {
          status = '🟡 주의';
          statusColor = 'yellow';
        }
        needOrder = true;
      }
      
      // ★★★ v3.6.121: 데이터 소스별 상세 정보 추가 ★★★
      results.push({
        item_code: item.item_code,
        item_name: item.item_name,
        unit: item.unit || 'kg',
        grade,
        grade_reason: gradeReason,
        expiry_days: expiryDays,
        current_stock: Math.round(item.current_stock * 100) / 100,
        daily_avg: dailyAvg,
        daily_avg_d1: d1Avg,         // D1 트랜잭션 기반 일평균 (실재고)
        daily_avg_sheet: sheetAvg,   // 구글시트 기반 일평균 (서류상)
        usage_source: usageSource,   // 데이터 소스 정보
        monthly_avg: item.monthly_usage_avg || 0,
        std_dev: item.usage_std_dev || 0,
        cv: item.usage_cv || 0,
        safety_stock: safetyStock,
        reorder_point: Math.round(reorderPoint * 10) / 10,
        lead_time: leadTime,
        inbound_frequency: item.inbound_frequency || 0,
        days_of_stock: daysOfStock,
        status,
        status_color: statusColor,
        need_order: needOrder,
        stats_updated_at: item.stats_updated_at
      });
    }
    
    // ★★★ v3.6.91: 등급별 분리 + 사용량 순 정렬 ★★★
    // 각 등급 내에서: 신호등(긴급→주의→정상) → 사용량 많은 순
    results.sort((a, b) => {
      // 1차: 신호등 상태 (red > yellow > green)
      const colorOrder: Record<string, number> = { 'red': 0, 'yellow': 1, 'green': 2 };
      if (colorOrder[a.status_color] !== colorOrder[b.status_color]) {
        return colorOrder[a.status_color] - colorOrder[b.status_color];
      }
      // 2차: 사용량 많은 순 (내림차순)
      return b.daily_avg - a.daily_avg;
    });
    
    // ★★★ v3.6.91: 등급별 분리 ★★★
    const gradeA = results.filter(r => r.grade === 'A');  // 사용량 多 (일100kg+)
    const gradeB = results.filter(r => r.grade === 'B');  // 중간 사용량 (일10kg+)
    const gradeC = results.filter(r => r.grade === 'C');  // 유통기한 짧음 (30일 이하)
    const gradeOther = results.filter(r => r.grade === '기타');  // 관리 등급 외
    
    // 4. 요약 통계
    const urgentCount = results.filter(r => r.status_color === 'red').length;
    const warningCount = results.filter(r => r.status_color === 'yellow').length;
    const normalCount = results.filter(r => r.status_color === 'green').length;
    
    // 등급별 긴급/주의 품목 수
    const gradeAAlertCount = gradeA.filter(r => r.status_color !== 'green').length;
    const gradeBAlertCount = gradeB.filter(r => r.status_color !== 'green').length;
    const gradeCAlertCount = gradeC.filter(r => r.status_color !== 'green').length;
    // ★★★ v3.6.108: 기타 등급 중 긴급/주의 품목 수 추가 ★★★
    const gradeOtherAlertCount = gradeOther.filter(r => r.status_color !== 'green').length;
    
    // 통계 미계산 품목 수
    const noStatsCount = results.filter(r => !r.stats_updated_at).length;
    
    // ★★★ v3.6.108: 긴급/주의 품목만 반환 (정상 제외) - 등급별 분리 + 기타 등급 포함 ★★★
    const alertGradeA = gradeA.filter(r => r.status_color === 'red' || r.status_color === 'yellow');
    const alertGradeB = gradeB.filter(r => r.status_color === 'red' || r.status_color === 'yellow');
    const alertGradeC = gradeC.filter(r => r.status_color === 'red' || r.status_color === 'yellow');
    // ★★★ v3.6.108: 기타 등급(사용량 없음) 중 안전재고 미만 품목도 긴급/주의에 포함 ★★★
    const alertGradeOther = gradeOther.filter(r => r.status_color === 'red' || r.status_color === 'yellow');
    
    return c.json({
      success: true,
      summary: {
        as_of: todayStr,
        total_items: results.length,      // 전체 품목 수 (참고용)
        urgent_count: urgentCount,        // 🔴 긴급 (0-3일)
        warning_count: warningCount,      // 🟡 주의 (4-10일)
        normal_count: normalCount,        // 🟢 정상 (11일+)
        grade_a: {
          total: gradeA.length,
          alert: gradeAAlertCount,
          description: 'A등급: 핵심원료 (일사용량 100kg+)'
        },
        grade_b: {
          total: gradeB.length,
          alert: gradeBAlertCount,
          description: 'B등급: 중간사용량 (일사용량 10kg+)'
        },
        grade_c: {
          total: gradeC.length,
          alert: gradeCAlertCount,
          description: 'C등급: 유통기한 짧음 (30일 이하)'
        },
        grade_other: {
          total: gradeOther.length,
          alert: gradeOtherAlertCount,  // ★★★ v3.6.108: 기타 등급 긴급/주의 수 추가 ★★★
          description: '기타: 저사용량/미사용 원료'
        },
        no_stats_count: noStatsCount,
        excluded_items: EXCLUDED_ITEM_CODES
      },
      // ★★★ v3.6.108: 등급별 분리된 데이터 (긴급/주의만) - 기타 등급 포함 ★★★
      items_by_grade: {
        A: alertGradeA,  // A등급 긴급/주의 품목 (사용량 많은 순)
        B: alertGradeB,  // B등급 긴급/주의 품목 (사용량 많은 순)
        C: alertGradeC,  // C등급 긴급/주의 품목 (유통기한 짧은 원료)
        other: alertGradeOther  // ★★★ v3.6.108: 기타 등급 긴급/주의 품목 (사용기록 없지만 안전재고 미만) ★★★
      },
      // ★★★ v3.6.108: 전체 긴급/주의 리스트 - 기타 등급 포함 ★★★
      items: [...alertGradeA, ...alertGradeB, ...alertGradeC, ...alertGradeOther]
    });
  } catch (error: any) {
    console.error('Safety stock status error:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

// ★★★ v3.6.170: 개별 품목의 안전재고 판정 상세 진단 (왜 긴급/주의로 안 뜨는지) ★★★
dashboardRoutes.get('/safety-stock-diagnose/:itemCode', async (c) => {
  try {
    const itemCode = c.req.param('itemCode');
    if (!itemCode) {
      return c.json({ success: false, error: 'itemCode가 필요합니다.' }, 400);
    }
    
    // 1. master 테이블 원본
    const master = await c.env.DB.prepare(`
      SELECT item_code, item_name, category, unit, current_stock, safety_stock, 
             daily_usage_avg, monthly_usage_avg, inbound_frequency, lead_time,
             usage_std_dev, usage_cv, item_grade, calculated_reorder_point, stats_updated_at,
             expiry_days, is_active
      FROM master WHERE item_code = ?
    `).bind(itemCode).first();
    
    if (!master) {
      return c.json({ success: false, error: `${itemCode}가 master 테이블에 없습니다.` }, 404);
    }
    
    // 2. inbound 합계 (safety-stock-status API가 실제로 쓰는 값)
    const inboundSum = await c.env.DB.prepare(`
      SELECT 
        COALESCE(SUM(remain_qty), 0) as total_remain,
        COUNT(*) as lot_count,
        SUM(CASE WHEN remain_qty > 0 AND quality_status = '합격' THEN remain_qty ELSE 0 END) as usable_remain,
        SUM(CASE WHEN remain_qty > 0 AND quality_status = '합격' THEN 1 ELSE 0 END) as usable_lots
      FROM inbound WHERE item_code = ?
    `).bind(itemCode).first() as any;
    
    // 3. 각 lot 상세
    const lots = await c.env.DB.prepare(`
      SELECT lot_number, inbound_date, expiry_date, origin_qty, remain_qty, quality_status
      FROM inbound WHERE item_code = ?
      ORDER BY inbound_date DESC
      LIMIT 20
    `).bind(itemCode).all();
    
    // 4. 최근 30일 사용량 (D1 transactions)
    const todayStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
    const start = new Date(Date.now() + 9 * 60 * 60 * 1000 - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const usageStats = await c.env.DB.prepare(`
      SELECT 
        COUNT(DISTINCT trans_date) as usage_days,
        SUM(ABS(quantity)) as total_usage,
        AVG(ABS(quantity)) as avg_per_transaction
      FROM transactions
      WHERE item_code = ? AND trans_type = '사용' AND trans_date >= ? AND trans_date <= ?
    `).bind(itemCode, start, todayStr).first() as any;
    
    // 5. 판정 시뮬레이션 (safety-stock-status와 동일한 로직)
    const usableStock = (inboundSum?.usable_remain as number) || 0;
    const dailyAvg = usageStats?.usage_days > 0 
      ? Math.round(((usageStats.total_usage as number) / (usageStats.usage_days as number)) * 100) / 100
      : ((master as any).daily_usage_avg ?? 0);
    const safetyStock = (master as any).safety_stock || 0;
    const leadTime = (master as any).lead_time || 3;
    const reorderPoint = (master as any).calculated_reorder_point || (dailyAvg * leadTime);
    const daysOfStock = dailyAvg > 0 
      ? Math.round((usableStock / dailyAvg) * 10) / 10 
      : (usableStock > 0 ? 999 : 0);
    const expiryDays = (master as any).expiry_days || 365;
    
    // 등급 판정
    let grade: string;
    if (expiryDays <= 30) grade = 'C';
    else if (dailyAvg >= 100) grade = 'A';
    else if (dailyAvg >= 10) grade = 'B';
    else grade = '기타';
    
    // 신호등
    let status: string, statusColor: string, needOrder = false;
    if (daysOfStock <= 3) { status = '🔴 긴급'; statusColor = 'red'; needOrder = true; }
    else if (daysOfStock <= 10) { status = '🟡 주의'; statusColor = 'yellow'; needOrder = usableStock <= reorderPoint; }
    else { status = '🟢 정상'; statusColor = 'green'; }
    // safety_stock 이하면 무조건 주의 이상
    if (usableStock <= safetyStock && safetyStock > 0) {
      if (statusColor === 'green') { status = '🟡 주의'; statusColor = 'yellow'; }
      needOrder = true;
    }
    
    // 제외 대상 체크
    const EXCLUDED_ITEM_CODES = ['RM184', 'RM266', 'RM267'];
    const EXCLUDED_ITEM_PREFIXES = ['SF'];
    const isExcluded = EXCLUDED_ITEM_CODES.includes(itemCode) || EXCLUDED_ITEM_PREFIXES.some(p => itemCode.startsWith(p));
    const isCategoryOK = (master as any).category === '원료';
    const isActive = ((master as any).is_active ?? 1) === 1;
    
    return c.json({
      success: true,
      item_code: itemCode,
      master: master,
      inbound_summary: inboundSum,
      recent_lots: lots.results,
      usage_last_30days: usageStats,
      computed: {
        usable_stock_from_inbound: usableStock,
        master_current_stock: (master as any).current_stock,
        stock_mismatch: usableStock !== (master as any).current_stock 
          ? `⚠️ inbound 합계(${usableStock})와 master.current_stock(${(master as any).current_stock})이 다름`
          : '✅ 일치',
        daily_avg: dailyAvg,
        days_of_stock: daysOfStock,
        safety_stock: safetyStock,
        reorder_point: reorderPoint,
        grade,
        status,
        status_color: statusColor,
        need_order: needOrder
      },
      inclusion_check: {
        category: (master as any).category,
        is_category_material: isCategoryOK,
        is_active: isActive,
        is_excluded: isExcluded,
        will_appear_in_safety_status: isCategoryOK && isActive && !isExcluded,
        reason: !isCategoryOK 
          ? `❌ category가 '원료'가 아님: '${(master as any).category}'`
          : !isActive
          ? `❌ is_active=0 (비활성)`
          : isExcluded
          ? `❌ 제외 목록에 포함`
          : statusColor === 'green'
          ? `⚠️ 판정 결과가 정상이라 alert 목록에 안 뜸 (재고 ${usableStock} > 안전재고 ${safetyStock}, 잔여일 ${daysOfStock}일)`
          : `✅ 알림 목록에 포함되어야 함`
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ★★★ v3.6.122: 발주점 3일 이하 품목의 최근 사용 추이 (라인 차트용) - KST 날짜 적용 ★★★
dashboardRoutes.get('/usage-trend', async (c) => {
  try {
    // ★★★ v3.6.122: KST 기준 날짜 계산 ★★★
    const today = getKSTDateObject();
    const todayStr = getKSTDate();
    const days = parseInt(c.req.query('days') || '14');
    
    // 기간 계산
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];
    
    // 품목 코드 목록 (콤마 구분)
    const itemCodes = c.req.query('item_codes')?.split(',').filter(Boolean) || [];
    
    if (itemCodes.length === 0) {
      return c.json({
        success: true,
        data: {
          labels: [],
          datasets: []
        }
      });
    }
    
    // 정제수 제외
    const filteredCodes = itemCodes.filter(code => !EXCLUDED_ITEM_CODES.includes(code));
    
    if (filteredCodes.length === 0) {
      return c.json({
        success: true,
        data: {
          labels: [],
          datasets: []
        }
      });
    }
    
    // 품목별 일별 사용량 조회
    const placeholders = filteredCodes.map(() => '?').join(',');
    const usageResult = await c.env.DB.prepare(`
      SELECT 
        t.item_code,
        m.item_name,
        t.trans_date,
        SUM(ABS(t.quantity)) as daily_qty
      FROM transactions t
      JOIN master m ON t.item_code = m.item_code
      WHERE t.trans_type = '사용'
        AND t.trans_date >= ?
        AND t.trans_date <= ?
        AND t.item_code IN (${placeholders})
      GROUP BY t.item_code, t.trans_date
      ORDER BY t.trans_date
    `).bind(startDateStr, todayStr, ...filteredCodes).all<{ item_code: string; item_name: string; trans_date: string; daily_qty: number }>();
    
    // 날짜 라벨 생성
    const labels: string[] = [];
    for (let i = 0; i <= days; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      labels.push(d.toISOString().split('T')[0].slice(5)); // MM-DD 형식
    }
    
    // 품목별 데이터셋 생성
    const itemNameMap: Record<string, string> = {};
    const dataMap: Record<string, Record<string, number>> = {};
    
    for (const row of usageResult.results || []) {
      if (!dataMap[row.item_code]) {
        dataMap[row.item_code] = {};
        itemNameMap[row.item_code] = row.item_name;
      }
      const dateLabel = row.trans_date.slice(5); // MM-DD 형식
      dataMap[row.item_code][dateLabel] = row.daily_qty;
    }
    
    // Chart.js 형식 데이터셋 생성
    const colors = [
      'rgb(239, 68, 68)',    // red
      'rgb(249, 115, 22)',   // orange
      'rgb(234, 179, 8)',    // yellow
      'rgb(34, 197, 94)',    // green
      'rgb(59, 130, 246)',   // blue
      'rgb(168, 85, 247)',   // purple
      'rgb(236, 72, 153)',   // pink
    ];
    
    const datasets = Object.entries(dataMap).map(([itemCode, dateData], idx) => ({
      label: itemNameMap[itemCode] || itemCode,
      data: labels.map(label => dateData[label] || 0),
      borderColor: colors[idx % colors.length],
      backgroundColor: colors[idx % colors.length].replace('rgb', 'rgba').replace(')', ', 0.2)'),
      tension: 0.3,
      fill: false
    }));
    
    return c.json({
      success: true,
      data: {
        labels,
        datasets
      }
    });
  } catch (error: any) {
    console.error('Usage trend error:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default dashboardRoutes;
