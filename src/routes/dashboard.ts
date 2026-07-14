// 대시보드 API
import { Hono } from 'hono';
import type { Bindings } from '../types';
import { GoogleSheetsService } from '../services/GoogleSheetsService';

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

export default dashboardRoutes;
