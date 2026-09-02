/**
 * ★★★ v3.4.27: 재고 무결성 관리 API ★★★
 * 
 * 이카운트 수준의 정확한 재고 관리 시스템
 */
import { Hono } from 'hono';
import type { Bindings } from '../types';
import {
  getVerifiedStock,
  getBulkVerifiedStock,
  validateAllStock,
  syncMasterStockFromLots,
  calculateMaterialRequirements,
  detectAndLogInconsistencies,
  StockInfo
} from '../utils/stock-validator';

const stockRoutes = new Hono<{ Bindings: Bindings }>();

// ===== 재고 조회 API =====

/**
 * 단일 품목 재고 조회 (검증 포함)
 * GET /api/stock/:item_code
 */
stockRoutes.get('/:item_code', async (c) => {
  const itemCode = c.req.param('item_code');
  
  try {
    const stock = await getVerifiedStock(c.env.DB, itemCode);
    
    return c.json({
      success: true,
      data: stock,
      warning: !stock.is_consistent ? {
        message: '재고 불일치 감지',
        lot_stock: stock.lot_stock,
        master_stock: stock.master_stock,
        difference: stock.difference
      } : null
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * 여러 품목 재고 일괄 조회
 * POST /api/stock/bulk
 */
stockRoutes.post('/bulk', async (c) => {
  const { item_codes } = await c.req.json();
  
  if (!item_codes || !Array.isArray(item_codes)) {
    return c.json({ success: false, error: 'item_codes 배열이 필요합니다' }, 400);
  }
  
  try {
    const stockMap = await getBulkVerifiedStock(c.env.DB, item_codes);
    const items = Array.from(stockMap.values());
    const inconsistent = items.filter(i => !i.is_consistent);
    
    return c.json({
      success: true,
      data: items,
      summary: {
        total: items.length,
        consistent: items.length - inconsistent.length,
        inconsistent: inconsistent.length
      },
      warnings: inconsistent.length > 0 ? inconsistent.map(i => ({
        item_code: i.item_code,
        item_name: i.item_name,
        lot_stock: i.lot_stock,
        master_stock: i.master_stock,
        difference: i.difference
      })) : []
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * 전체 원료 재고 현황 (카테고리별)
 * GET /api/stock/all/summary
 */
stockRoutes.get('/all/summary', async (c) => {
  try {
    // 원료 재고 (LOT 기반)
    const rawMaterials = await c.env.DB.prepare(`
      SELECT 
        m.item_code,
        m.item_name,
        m.unit,
        m.safety_stock,
        COALESCE(SUM(i.remain_qty), 0) as lot_stock,
        m.current_stock as master_stock,
        CASE 
          WHEN COALESCE(SUM(i.remain_qty), 0) < m.safety_stock THEN 'LOW'
          WHEN COALESCE(SUM(i.remain_qty), 0) = 0 THEN 'OUT'
          ELSE 'OK'
        END as status
      FROM master m
      LEFT JOIN inbound i ON m.item_code = i.item_code AND i.remain_qty > 0
      WHERE m.category = '원료'
      GROUP BY m.item_code
      ORDER BY m.item_name
    `).all<any>();
    
    // SF 원료 재고
    const sfMaterials = await c.env.DB.prepare(`
      SELECT 
        sf.item_code,
        sf.item_name,
        sf.unit,
        0 as safety_stock,
        COALESCE(SUM(sfl.remain_qty), 0) as lot_stock,
        COALESCE(SUM(sfl.remain_qty), 0) as master_stock,
        CASE 
          WHEN COALESCE(SUM(sfl.remain_qty), 0) = 0 THEN 'OUT'
          ELSE 'OK'
        END as status
      FROM semi_finished_items sf
      LEFT JOIN semi_finished_lots sfl ON sf.item_code = sfl.item_code AND sfl.remain_qty > 0
      WHERE sf.is_active = 1
      GROUP BY sf.item_code
      ORDER BY sf.item_name
    `).all<any>();
    
    const allItems = [
      ...(rawMaterials.results || []).map((r: any) => ({ ...r, category: 'raw' })),
      ...(sfMaterials.results || []).map((r: any) => ({ ...r, category: 'semi' }))
    ];
    
    const outOfStock = allItems.filter(i => i.status === 'OUT');
    const lowStock = allItems.filter(i => i.status === 'LOW');
    const inconsistent = allItems.filter(i => Math.abs(i.lot_stock - i.master_stock) >= 0.01);
    
    return c.json({
      success: true,
      data: allItems,
      summary: {
        total: allItems.length,
        raw_count: rawMaterials.results?.length || 0,
        sf_count: sfMaterials.results?.length || 0,
        out_of_stock: outOfStock.length,
        low_stock: lowStock.length,
        inconsistent: inconsistent.length
      },
      alerts: {
        out_of_stock: outOfStock.map(i => ({ item_code: i.item_code, item_name: i.item_name })),
        low_stock: lowStock.map(i => ({ item_code: i.item_code, item_name: i.item_name, stock: i.lot_stock, safety: i.safety_stock })),
        inconsistent: inconsistent.map(i => ({ item_code: i.item_code, item_name: i.item_name, lot: i.lot_stock, master: i.master_stock }))
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 재고 검증 API =====

/**
 * 전체 재고 일관성 검증
 * GET /api/stock/validate/all
 */
stockRoutes.get('/validate/all', async (c) => {
  try {
    const result = await validateAllStock(c.env.DB);
    
    return c.json({
      success: result.success,
      data: result,
      message: result.success 
        ? '모든 재고가 일관성을 유지하고 있습니다.'
        : `${result.inconsistent_count}개 품목의 재고 불일치가 발견되었습니다.`
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * 생산 원료 소요량 검증
 * POST /api/stock/validate/requirements
 */
stockRoutes.post('/validate/requirements', async (c) => {
  const { items } = await c.req.json();
  
  if (!items || !Array.isArray(items)) {
    return c.json({ success: false, error: 'items 배열이 필요합니다' }, 400);
  }
  
  try {
    const result = await calculateMaterialRequirements(c.env.DB, items);
    
    return c.json({
      success: !result.has_shortage,
      data: result.requirements,
      summary: {
        total_materials: result.requirements.length,
        sufficient: result.requirements.length - result.shortage_count,
        insufficient: result.shortage_count
      },
      can_proceed: !result.has_shortage,
      shortages: result.requirements.filter(r => !r.is_sufficient).map(r => ({
        item_code: r.item_code,
        item_name: r.item_name,
        required: r.required_qty,
        available: r.available_qty,
        shortage: r.shortage,
        unit: r.unit
      }))
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 재고 동기화 API =====

/**
 * 마스터 재고를 LOT 합계로 동기화
 * POST /api/stock/sync
 */
stockRoutes.post('/sync', async (c) => {
  const { item_code, reason } = await c.req.json();
  
  try {
    // 동기화 전 상태 확인
    const beforeValidation = await validateAllStock(c.env.DB);
    
    // 동기화 실행
    const result = await syncMasterStockFromLots(c.env.DB, item_code);
    
    // 동기화 후 상태 확인
    const afterValidation = await validateAllStock(c.env.DB);
    
    // 감사 로그 추가
    await c.env.DB.prepare(`
      INSERT INTO stock_audit_log (action, item_code, details, created_at)
      VALUES ('MANUAL_SYNC', ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      item_code || 'ALL',
      JSON.stringify({
        reason: reason || '수동 동기화',
        before_inconsistent: beforeValidation.inconsistent_count,
        after_inconsistent: afterValidation.inconsistent_count,
        synced: result.synced
      })
    ).run();
    
    return c.json({
      success: result.errors.length === 0,
      message: item_code 
        ? `${item_code} 재고가 동기화되었습니다.`
        : `${result.synced}개 품목의 재고가 동기화되었습니다.`,
      data: {
        synced: result.synced,
        before_inconsistent: beforeValidation.inconsistent_count,
        after_inconsistent: afterValidation.inconsistent_count
      },
      errors: result.errors
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * 재고 불일치 자동 감지 및 로그
 * POST /api/stock/detect-inconsistencies
 */
stockRoutes.post('/detect-inconsistencies', async (c) => {
  try {
    const result = await detectAndLogInconsistencies(c.env.DB);
    
    return c.json({
      success: true,
      data: result,
      message: result.detected === 0 
        ? '재고 불일치가 없습니다.'
        : `${result.detected}개 불일치가 감지되어 로그에 기록되었습니다.`
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 재고 감사 로그 API =====

/**
 * 재고 감사 로그 조회
 * GET /api/stock/audit-log
 */
stockRoutes.get('/audit-log', async (c) => {
  const itemCode = c.req.query('item_code');
  const action = c.req.query('action');
  const limit = parseInt(c.req.query('limit') || '100');
  
  try {
    let query = `
      SELECT * FROM stock_audit_log
      WHERE 1=1
    `;
    const params: any[] = [];
    
    if (itemCode) {
      query += ' AND item_code = ?';
      params.push(itemCode);
    }
    if (action) {
      query += ' AND action = ?';
      params.push(action);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    
    const result = await c.env.DB.prepare(query).bind(...params).all();
    
    return c.json({
      success: true,
      data: result.results
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * 재고 이력 조회 (수불부)
 * GET /api/stock/history/:item_code
 */
stockRoutes.get('/history/:item_code', async (c) => {
  const itemCode = c.req.param('item_code');
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  
  try {
    let query = `
      SELECT 
        trans_date,
        trans_type,
        quantity,
        lot_number,
        remain_qty,
        memo,
        created_at
      FROM transactions
      WHERE item_code = ?
    `;
    const params: any[] = [itemCode];
    
    if (startDate) {
      query += ' AND trans_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND trans_date <= ?';
      params.push(endDate);
    }
    
    query += ' ORDER BY trans_date DESC, created_at DESC LIMIT 500';
    
    const result = await c.env.DB.prepare(query).bind(...params).all();
    
    // 현재 재고
    const currentStock = await getVerifiedStock(c.env.DB, itemCode);
    
    return c.json({
      success: true,
      data: {
        item_code: itemCode,
        item_name: currentStock.item_name,
        current_stock: currentStock.lot_stock,
        unit: currentStock.unit,
        is_consistent: currentStock.is_consistent,
        transactions: result.results
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default stockRoutes;
