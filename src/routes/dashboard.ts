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
  
  // ★★★ v3.6.46: 일별수불부 시트 기반 안전재고 미만 품목 조회 ★★★
  let lowStockItems: any[] = [];
  let lowStockCount = 0;
  let expiringLots: any[] = [];
  let expiringCount = 0;
  
  const service = getSheetService(c);
  if (service) {
    try {
      // 1. ★★★ 일별수불부 시트에서 원료별 최신 현재고 조회 ★★★
      // 일별수불부 컬럼: A:일자, B:원료코드, C:원료명, D:전일재고, E:입고량, F:사용량, G:현재고, H:단위
      const dailyStockData = await service.readSheet('일별수불부', 'A2:H50000');
      const currentStockMap = new Map<string, { name: string; unit: string; stock: number; date: string }>();
      
      for (const row of dailyStockData || []) {
        const dateStr = String(row[0] || '').trim().replace(/^'/, '');
        const itemCode = String(row[1] || '').trim();
        const itemName = String(row[2] || '').trim();
        const currentStock = parseFloat(row[6]) || 0;  // G컬럼: 현재고
        const unit = String(row[7] || 'kg').trim();
        
        if (!itemCode || !dateStr) continue;
        
        // 각 원료별로 가장 최신 날짜의 현재고만 저장
        const existing = currentStockMap.get(itemCode);
        if (!existing || dateStr > existing.date) {
          currentStockMap.set(itemCode, { 
            name: itemName, 
            unit, 
            stock: currentStock,
            date: dateStr
          });
        }
      }
      
      // 2. D1에서 안전재고 설정 조회 (원료만, safety_stock > 0)
      const safetyStockData = await c.env.DB.prepare(`
        SELECT item_code, item_name, safety_stock, unit
        FROM master
        WHERE category = '원료' AND safety_stock > 0
      `).all<{ item_code: string; item_name: string; safety_stock: number; unit: string }>();
      
      // 3. 안전재고 미만 품목 필터링 (일별수불부 현재고 기준)
      for (const item of safetyStockData.results || []) {
        const current = currentStockMap.get(item.item_code);
        const currentStock = current?.stock ?? 0;  // 일별수불부에 없으면 0
        
        if (currentStock < item.safety_stock) {
          lowStockItems.push({
            item_code: item.item_code,
            item_name: current?.name || item.item_name,
            category: '원료',
            unit: current?.unit || item.unit || 'kg',
            current_stock: Math.round(currentStock * 100) / 100,
            safety_stock: item.safety_stock,
            shortage: Math.round((item.safety_stock - currentStock) * 100) / 100,
            last_date: current?.date || '미등록'  // 최신 수불부 날짜
          });
        }
      }
      
      // 부족량 순으로 정렬
      lowStockItems.sort((a, b) => b.shortage - a.shortage);
      lowStockCount = lowStockItems.length;
      
      // 4. ★★★ 구글시트 원료입고에서 유통기한 30일 이내 LOT 조회 ★★★
      // 원료입고 컬럼: A:입고일, B:원료코드, C:원료명, D:LOT번호, E:입고량, F:단위, G:공급업체, H:소비기한, I:잔량
      const inboundData = await service.readSheet('원료입고', 'A2:I5000');
      const todayDate = new Date(today);
      for (const row of inboundData || []) {
        const itemCode = String(row[1] || '').trim();
        const itemName = String(row[2] || '').trim();
        const lotNumber = String(row[3] || '').trim();
        const remainQty = parseFloat(row[8]) || 0;
        const expiryDateStr = String(row[7] || '').trim();  // H컬럼: 소비기한
        
        if (!itemCode || remainQty <= 0 || !expiryDateStr) continue;
        
        // 날짜 파싱
        let expiryDate: Date | null = null;
        if (/^\d{4}-\d{2}-\d{2}$/.test(expiryDateStr)) {
          expiryDate = new Date(expiryDateStr);
        } else if (/^\d{4}\.\d{2}\.\d{2}$/.test(expiryDateStr)) {
          expiryDate = new Date(expiryDateStr.replace(/\./g, '-'));
        }
        
        if (!expiryDate || isNaN(expiryDate.getTime())) continue;
        
        const daysUntilExpiry = Math.floor((expiryDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysUntilExpiry >= 0 && daysUntilExpiry <= 30) {
          expiringLots.push({
            item_code: itemCode,
            item_name: itemName,
            lot_number: lotNumber,
            remain_qty: remainQty,
            expiry_date: expiryDateStr,
            days_until_expiry: daysUntilExpiry,
            category: '원료'
          });
        }
      }
      
      // 유통기한순 정렬
      expiringLots.sort((a, b) => a.days_until_expiry - b.days_until_expiry);
      expiringCount = expiringLots.length;
      
    } catch (sheetError: any) {
      console.error('[dashboard] 구글시트 조회 오류:', sheetError.message);
      // 구글시트 오류 시 D1 폴백
    }
  }
  
  // D1 폴백 (구글시트 데이터 없을 때)
  if (lowStockItems.length === 0) {
    const d1LowStock = await c.env.DB.prepare(`
      SELECT m.item_code, m.item_name, m.category, m.unit, m.current_stock, m.safety_stock,
             (m.safety_stock - m.current_stock) as shortage
      FROM master m
      WHERE m.current_stock < m.safety_stock
        AND m.safety_stock > 0
        AND m.category = '원료'
      ORDER BY shortage DESC
    `).all();
    lowStockItems = d1LowStock.results || [];
    lowStockCount = lowStockItems.length;
  }
  
  if (expiringLots.length === 0) {
    const d1Expiring = await c.env.DB.prepare(`
      SELECT i.*, m.item_name, m.category, m.unit,
             CAST(julianday(i.expiry_date) - julianday(?) AS INTEGER) as days_until_expiry
      FROM inbound i
      JOIN master m ON i.item_code = m.item_code
      WHERE i.remain_qty > 0 
        AND i.quality_status = '합격'
        AND m.category = '원료'
        AND julianday(i.expiry_date) - julianday(?) <= 30
        AND julianday(i.expiry_date) - julianday(?) >= 0
      ORDER BY i.expiry_date ASC
    `).bind(today, today, today).all();
    expiringLots = d1Expiring.results || [];
    expiringCount = expiringLots.length;
  }
  
  // 오늘 원료 사용량
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
      }
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
