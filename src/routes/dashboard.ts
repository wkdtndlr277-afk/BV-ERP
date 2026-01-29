// 대시보드 API
import { Hono } from 'hono';
import type { Bindings } from '../types';

const dashboardRoutes = new Hono<{ Bindings: Bindings }>();

// 대시보드 전체 데이터
dashboardRoutes.get('/', async (c) => {
  const today = new Date().toISOString().split('T')[0];
  
  // 안전재고 미만 품목
  const lowStockItems = await c.env.DB.prepare(`
    SELECT m.*, (m.safety_stock - m.current_stock) as shortage
    FROM master m
    WHERE m.current_stock < m.safety_stock
    ORDER BY shortage DESC
    LIMIT 10
  `).all();
  
  // 유통기한 30일 이내 LOT
  const expiringLots = await c.env.DB.prepare(`
    SELECT i.*, m.item_name, m.category, m.unit,
           CAST(julianday(i.expiry_date) - julianday(?) AS INTEGER) as days_until_expiry
    FROM inbound i
    JOIN master m ON i.item_code = m.item_code
    WHERE i.remain_qty > 0 
      AND i.quality_status = '합격'
      AND julianday(i.expiry_date) - julianday(?) <= 30
      AND julianday(i.expiry_date) - julianday(?) >= 0
    ORDER BY i.expiry_date ASC
    LIMIT 10
  `).bind(today, today, today).all();
  
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
      SUM(CASE WHEN current_stock < safety_stock THEN 1 ELSE 0 END) as low_stock_count
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
        lowStockItems: lowStockItems.results,
        expiringLots: expiringLots.results,
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
  
  const lowStock = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM master WHERE current_stock < safety_stock
  `).first<{ count: number }>();
  
  const expiring = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM inbound 
    WHERE remain_qty > 0 AND quality_status = '합격'
      AND julianday(expiry_date) - julianday(?) <= 30
      AND julianday(expiry_date) - julianday(?) >= 0
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
