// 대시보드 API
// ★★★ v3.6.75: 대시보드 시각화 개선 - 신호등 시스템, A등급 우선 배치, 요약 카드, 라인 차트 ★★★
import { Hono } from 'hono';
import type { Bindings } from '../types';
import { GoogleSheetsService } from '../services/GoogleSheetsService';

// ★ v3.6.75: 정제수(RM184) 등 제외할 품목 코드
const EXCLUDED_ITEM_CODES = ['RM184'];

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
  const today = new Date().toISOString().split('T')[0];
  
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
  
  // ★★★ v3.6.49: 생산 현황 추가 (구글시트 기준) ★★★
  let productionStats = {
    todayTotal: 0,        // 오늘 총 생산 수량
    todayProducts: 0,     // 오늘 생산 품목 수
    todayRecords: 0,      // 오늘 생산 등록 건수
    weekTotal: 0,         // 이번주 총 생산 수량
    weekProducts: 0,      // 이번주 생산 품목 수
    byChannel: {} as Record<string, { count: number; quantity: number }>,  // 채널별 현황
    recentProduction: [] as any[]  // 최근 생산 내역
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
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoStr = weekAgo.toISOString().split('T')[0];
      
      const todayItems = new Set<string>();
      const weekItems = new Set<string>();
      const channelStats: Record<string, { count: number; quantity: number }> = {};
      const recentItems: any[] = [];
      
      for (const row of productionData || []) {
        const prodDate = String(row[0] || '').trim().replace(/^'/, '');
        const productCode = String(row[1] || '').trim();
        const productName = String(row[2] || '').trim();
        const quantity = parseInt(row[3]) || 0;
        const lotNumber = String(row[4] || '').trim();
        const channel = String(row[5] || '').trim() || '기타';
        
        if (!prodDate || !productCode) continue;
        
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
        
        // 최근 생산 내역 (최근 10건)
        if (recentItems.length < 10 && prodDate >= weekAgoStr) {
          recentItems.push({
            prod_date: prodDate,
            product_code: productCode,
            product_name: productName,
            quantity,
            lot_number: lotNumber,
            channel
          });
        }
      }
      
      productionStats.todayProducts = todayItems.size;
      productionStats.weekProducts = weekItems.size;
      productionStats.byChannel = channelStats;
      productionStats.recentProduction = recentItems.sort((a, b) => 
        b.prod_date.localeCompare(a.prod_date) || b.quantity - a.quantity
      ).slice(0, 10);
      
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
  const today = new Date().toISOString().split('T')[0];
  
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

// ★★★ v3.6.75: 안전재고 현황 API (신호등 시스템 + A등급 우선 + 정제수 제외) ★★★
dashboardRoutes.get('/safety-stock-status', async (c) => {
  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const lead_days = parseInt(c.req.query('lead_days') || '3');
    const days = parseInt(c.req.query('days') || '30');
    
    // 분석 기간 계산
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];
    
    // 1. 원료별 실재고 조회 (inbound.remain_qty SUM 기반)
    const stockResult = await c.env.DB.prepare(`
      SELECT 
        m.item_code,
        m.item_name,
        m.unit,
        m.safety_stock as master_safety_stock,
        COALESCE(SUM(i.remain_qty), 0) as current_stock
      FROM master m
      LEFT JOIN inbound i ON m.item_code = i.item_code 
        AND i.remain_qty > 0 
        AND i.quality_status = '합격'
      WHERE m.category = '원료'
      GROUP BY m.item_code, m.item_name, m.unit, m.safety_stock
    `).all<{ item_code: string; item_name: string; unit: string; master_safety_stock: number; current_stock: number }>();
    
    // 2. 원료별 일별 사용량 조회
    const usageResult = await c.env.DB.prepare(`
      SELECT 
        item_code,
        trans_date,
        SUM(ABS(quantity)) as daily_qty
      FROM transactions
      WHERE trans_type = '사용'
        AND trans_date >= ?
        AND trans_date <= ?
      GROUP BY item_code, trans_date
      ORDER BY item_code, trans_date
    `).bind(startDateStr, todayStr).all<{ item_code: string; trans_date: string; daily_qty: number }>();
    
    // 3. 사용량 데이터를 품목별로 그룹화
    const usageMap: Record<string, number[]> = {};
    for (const row of usageResult.results || []) {
      if (!usageMap[row.item_code]) {
        usageMap[row.item_code] = [];
      }
      usageMap[row.item_code].push(row.daily_qty);
    }
    
    // 4. 품목별 통계 계산
    const results: any[] = [];
    
    for (const item of stockResult.results || []) {
      // ★ 정제수(RM184) 등 제외
      if (EXCLUDED_ITEM_CODES.includes(item.item_code)) {
        continue;
      }
      
      const dailyUsages = usageMap[item.item_code] || [];
      
      // 사용량이 없는 품목은 건너뜀
      if (dailyUsages.length === 0) {
        continue;
      }
      
      // IQR 기반 이상치 제거
      const sorted = [...dailyUsages].sort((a, b) => a - b);
      const q1Idx = Math.floor(sorted.length * 0.25);
      const q3Idx = Math.floor(sorted.length * 0.75);
      const q1 = sorted[q1Idx];
      const q3 = sorted[q3Idx];
      const iqr = q3 - q1;
      const lowerBound = q1 - 1.5 * iqr;
      const upperBound = q3 + 1.5 * iqr;
      
      const filteredUsages = dailyUsages.filter(v => v >= lowerBound && v <= upperBound);
      if (filteredUsages.length === 0) continue;
      
      // 평균, 표준편차 계산
      const sum = filteredUsages.reduce((a, b) => a + b, 0);
      const avg = sum / filteredUsages.length;
      const variance = filteredUsages.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / filteredUsages.length;
      const stdDev = Math.sqrt(variance);
      const cv = avg > 0 ? stdDev / avg : 0;
      
      // 등급 결정 (CV + 일평균 사용량 기준)
      let grade: string;
      let zValue: number;
      
      if (cv <= 0.3 && avg >= 50) {
        grade = 'A';
        zValue = 1.96; // 98% 서비스 수준
      } else if (cv <= 0.5 && avg >= 10) {
        grade = 'B';
        zValue = 1.645; // 95%
      } else {
        grade = 'C';
        zValue = 1.28; // 90%
      }
      
      // 안전재고 계산: Z × σ × √(리드타임)
      const safetyStock = Math.round(zValue * stdDev * Math.sqrt(lead_days) * 10) / 10;
      
      // 발주점 계산: 일평균 × 리드타임 + 안전재고
      const reorderPoint = Math.round((avg * lead_days + safetyStock) * 10) / 10;
      
      // 잔여일 계산
      const daysOfStock = avg > 0 ? Math.round((item.current_stock / avg) * 10) / 10 : 999;
      
      // 신호등 상태 결정 (잔여일 기준)
      let status: string;
      let statusColor: string;
      let needOrder = false;
      
      if (daysOfStock <= 2) {
        status = '🔴 긴급';
        statusColor = 'red';
        needOrder = true;
      } else if (daysOfStock <= 7) {
        status = '🟡 주의';
        statusColor = 'yellow';
        needOrder = daysOfStock <= lead_days + 1;
      } else {
        status = '🟢 정상';
        statusColor = 'green';
      }
      
      results.push({
        item_code: item.item_code,
        item_name: item.item_name,
        unit: item.unit || 'kg',
        grade,
        z_value: zValue,
        current_stock: Math.round(item.current_stock * 100) / 100,
        daily_avg: Math.round(avg * 100) / 100,
        std_dev: Math.round(stdDev * 100) / 100,
        cv: Math.round(cv * 1000) / 1000,
        safety_stock: safetyStock,
        reorder_point: reorderPoint,
        days_of_stock: daysOfStock,
        status,
        status_color: statusColor,
        need_order: needOrder,
        data_points: filteredUsages.length
      });
    }
    
    // 5. 정렬: need_order(true 먼저) → grade(A→B→C) → days_of_stock(오름차순)
    results.sort((a, b) => {
      // 1차: 발주필요 우선
      if (a.need_order !== b.need_order) return a.need_order ? -1 : 1;
      // 2차: 등급 우선 (A > B > C)
      const gradeOrder: Record<string, number> = { 'A': 0, 'B': 1, 'C': 2 };
      if (gradeOrder[a.grade] !== gradeOrder[b.grade]) {
        return gradeOrder[a.grade] - gradeOrder[b.grade];
      }
      // 3차: 잔여일 오름차순
      return a.days_of_stock - b.days_of_stock;
    });
    
    // 6. 요약 통계
    const urgentCount = results.filter(r => r.status_color === 'red').length;
    const warningCount = results.filter(r => r.status_color === 'yellow').length;
    const normalCount = results.filter(r => r.status_color === 'green').length;
    const gradeACount = results.filter(r => r.grade === 'A').length;
    const gradeBCount = results.filter(r => r.grade === 'B').length;
    const gradeCCount = results.filter(r => r.grade === 'C').length;
    
    return c.json({
      success: true,
      summary: {
        analysis_period: `${startDateStr} ~ ${todayStr}`,
        lead_days,
        total_items: results.length,
        urgent_count: urgentCount,       // 🔴 긴급 (0-2일)
        warning_count: warningCount,     // 🟡 주의 (3-7일)
        normal_count: normalCount,       // 🟢 정상 (8일+)
        grade_a_count: gradeACount,
        grade_b_count: gradeBCount,
        grade_c_count: gradeCCount,
        excluded_items: EXCLUDED_ITEM_CODES
      },
      items: results
    });
  } catch (error: any) {
    console.error('Safety stock status error:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

// ★★★ v3.6.75: 발주점 3일 이하 품목의 최근 사용 추이 (라인 차트용) ★★★
dashboardRoutes.get('/usage-trend', async (c) => {
  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
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
