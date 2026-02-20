import { Hono } from 'hono';
import type { Bindings } from '../types';

const app = new Hono<{ Bindings: Bindings }>();

// ==================== 원료 단가 관리 ====================

// 원료 단가 목록 조회 (최신 단가만)
app.get('/materials', async (c) => {
  try {
    // 원료 목록과 최신 단가 조인
    const result = await c.env.DB.prepare(`
      SELECT 
        m.item_code,
        m.item_name,
        m.unit as master_unit,
        mc.id as cost_id,
        mc.cost_per_unit,
        mc.unit as cost_unit,
        mc.supplier,
        mc.effective_date,
        mc.memo,
        mc.updated_at
      FROM master m
      LEFT JOIN (
        SELECT mc1.*
        FROM material_costs mc1
        INNER JOIN (
          SELECT item_code, MAX(effective_date) as max_date
          FROM material_costs
          GROUP BY item_code
        ) mc2 ON mc1.item_code = mc2.item_code AND mc1.effective_date = mc2.max_date
      ) mc ON m.item_code = mc.item_code
      WHERE m.category = '원료'
      ORDER BY m.item_name
    `).all();
    
    return c.json({ success: true, data: result.results });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 원료 단가 등록/수정
app.post('/materials', async (c) => {
  try {
    const body = await c.req.json();
    const { item_code, cost_per_unit, unit, supplier, effective_date, memo } = body;
    
    if (!item_code || cost_per_unit === undefined) {
      return c.json({ success: false, error: '원료코드와 단가는 필수입니다' }, 400);
    }
    
    const effDate = effective_date || new Date().toISOString().split('T')[0];
    
    // 기존 동일 날짜 단가가 있으면 업데이트, 없으면 삽입
    const existing = await c.env.DB.prepare(`
      SELECT id FROM material_costs WHERE item_code = ? AND effective_date = ?
    `).bind(item_code, effDate).first();
    
    if (existing) {
      await c.env.DB.prepare(`
        UPDATE material_costs 
        SET cost_per_unit = ?, unit = ?, supplier = ?, memo = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(cost_per_unit, unit || 'kg', supplier || null, memo || null, existing.id).run();
    } else {
      await c.env.DB.prepare(`
        INSERT INTO material_costs (item_code, cost_per_unit, unit, supplier, effective_date, memo)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(item_code, cost_per_unit, unit || 'kg', supplier || null, effDate, memo || null).run();
    }
    
    return c.json({ success: true, message: '단가가 저장되었습니다' });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 원료 단가 일괄 등록
app.post('/materials/bulk', async (c) => {
  try {
    const body = await c.req.json();
    const { items } = body; // [{item_code, cost_per_unit, unit, supplier}]
    
    if (!items || !Array.isArray(items)) {
      return c.json({ success: false, error: '항목 배열이 필요합니다' }, 400);
    }
    
    const effDate = new Date().toISOString().split('T')[0];
    let savedCount = 0;
    
    for (const item of items) {
      if (item.item_code && item.cost_per_unit !== undefined && item.cost_per_unit !== null) {
        // 기존 동일 날짜 단가 확인
        const existing = await c.env.DB.prepare(`
          SELECT id FROM material_costs WHERE item_code = ? AND effective_date = ?
        `).bind(item.item_code, effDate).first();
        
        if (existing) {
          await c.env.DB.prepare(`
            UPDATE material_costs 
            SET cost_per_unit = ?, unit = ?, supplier = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).bind(item.cost_per_unit, item.unit || 'kg', item.supplier || null, existing.id).run();
        } else {
          await c.env.DB.prepare(`
            INSERT INTO material_costs (item_code, cost_per_unit, unit, supplier, effective_date)
            VALUES (?, ?, ?, ?, ?)
          `).bind(item.item_code, item.cost_per_unit, item.unit || 'kg', item.supplier || null, effDate).run();
        }
        savedCount++;
      }
    }
    
    return c.json({ success: true, message: `${savedCount}개 원료 단가가 저장되었습니다`, count: savedCount });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 원료 단가 이력 조회
app.get('/materials/:itemCode/history', async (c) => {
  try {
    const itemCode = c.req.param('itemCode');
    
    const result = await c.env.DB.prepare(`
      SELECT * FROM material_costs 
      WHERE item_code = ?
      ORDER BY effective_date DESC
      LIMIT 50
    `).bind(itemCode).all();
    
    return c.json({ success: true, data: result.results });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ==================== 제품 원가 계산 ====================

// 단일 제품 원가 계산
app.get('/product/:productCode', async (c) => {
  try {
    const productCode = c.req.param('productCode');
    
    // 제품 정보
    const product = await c.env.DB.prepare(`
      SELECT item_code, item_name, unit FROM master WHERE item_code = ? AND category = '제품'
    `).bind(productCode).first();
    
    if (!product) {
      return c.json({ success: false, error: '제품을 찾을 수 없습니다' }, 404);
    }
    
    // BOM 조회 및 원가 계산
    const bomResult = await c.env.DB.prepare(`
      SELECT 
        b.item_code,
        b.quantity as bom_qty,
        b.unit as bom_unit,
        m.item_name,
        mc.cost_per_unit,
        mc.unit as cost_unit
      FROM bom b
      JOIN master m ON b.item_code = m.item_code
      LEFT JOIN (
        SELECT mc1.*
        FROM material_costs mc1
        INNER JOIN (
          SELECT item_code, MAX(effective_date) as max_date
          FROM material_costs
          GROUP BY item_code
        ) mc2 ON mc1.item_code = mc2.item_code AND mc1.effective_date = mc2.max_date
      ) mc ON b.item_code = mc.item_code
      WHERE b.product_code = ?
      ORDER BY b.sort_order
    `).bind(productCode).all();
    
    let totalMaterialCost = 0;
    const materials = bomResult.results.map((row: any) => {
      // 단위 변환: BOM 단위(g) → 원가 단위(kg)
      let convertedQty = row.bom_qty;
      if (row.bom_unit === 'g' && row.cost_unit === 'kg') {
        convertedQty = row.bom_qty / 1000;
      } else if (row.bom_unit === 'kg' && row.cost_unit === 'g') {
        convertedQty = row.bom_qty * 1000;
      }
      
      const cost = row.cost_per_unit ? convertedQty * row.cost_per_unit : 0;
      totalMaterialCost += cost;
      
      return {
        item_code: row.item_code,
        item_name: row.item_name,
        bom_qty: row.bom_qty,
        bom_unit: row.bom_unit,
        cost_per_unit: row.cost_per_unit,
        cost_unit: row.cost_unit,
        calculated_cost: Math.round(cost * 100) / 100,
        has_cost: !!row.cost_per_unit
      };
    });
    
    const missingCostCount = materials.filter((m: any) => !m.has_cost).length;
    
    return c.json({
      success: true,
      data: {
        product_code: product.item_code,
        product_name: product.item_name,
        materials,
        material_cost: Math.round(totalMaterialCost * 100) / 100,
        missing_cost_count: missingCostCount,
        is_complete: missingCostCount === 0
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 전체 제품 원가 목록 (최적화된 단일 쿼리)
app.get('/products', async (c) => {
  try {
    // 단일 쿼리로 모든 제품의 원가 계산
    const result = await c.env.DB.prepare(`
      WITH latest_costs AS (
        SELECT mc1.item_code, mc1.cost_per_unit, mc1.unit
        FROM material_costs mc1
        INNER JOIN (
          SELECT item_code, MAX(effective_date) as max_date
          FROM material_costs
          GROUP BY item_code
        ) mc2 ON mc1.item_code = mc2.item_code AND mc1.effective_date = mc2.max_date
      ),
      product_costs AS (
        SELECT 
          b.product_code,
          SUM(
            CASE 
              WHEN b.unit = 'g' AND lc.unit = 'kg' THEN (b.quantity / 1000.0) * COALESCE(lc.cost_per_unit, 0)
              WHEN b.unit = 'kg' AND lc.unit = 'g' THEN (b.quantity * 1000.0) * COALESCE(lc.cost_per_unit, 0)
              ELSE b.quantity * COALESCE(lc.cost_per_unit, 0)
            END
          ) as total_cost,
          COUNT(*) as bom_count,
          SUM(CASE WHEN lc.cost_per_unit IS NULL THEN 1 ELSE 0 END) as missing_items
        FROM bom b
        LEFT JOIN latest_costs lc ON b.item_code = lc.item_code
        GROUP BY b.product_code
      )
      SELECT 
        m.item_code as product_code,
        m.item_name as product_name,
        COALESCE(pc.bom_count, 0) as bom_count,
        COALESCE(pc.total_cost, 0) as material_cost,
        COALESCE(pc.missing_items, 0) as missing_items
      FROM master m
      INNER JOIN product_costs pc ON m.item_code = pc.product_code
      WHERE m.category = '제품'
      ORDER BY m.item_name
    `).all();
    
    const products = (result.results as any[]).map(row => ({
      product_code: row.product_code,
      product_name: row.product_name,
      bom_count: row.bom_count,
      material_cost: Math.round((row.material_cost || 0) * 100) / 100,
      missing_items: row.missing_items,
      is_complete: row.missing_items === 0
    }));
    
    return c.json({ success: true, data: products });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 제품 원가 저장 (스냅샷)
app.post('/products/save', async (c) => {
  try {
    const body = await c.req.json();
    const { product_code, material_cost, labor_cost, overhead_cost, selling_price, memo } = body;
    
    if (!product_code) {
      return c.json({ success: false, error: '제품코드는 필수입니다' }, 400);
    }
    
    const total_cost = (material_cost || 0) + (labor_cost || 0) + (overhead_cost || 0);
    const margin_rate = selling_price ? ((selling_price - total_cost) / selling_price * 100) : null;
    const calc_date = new Date().toISOString().split('T')[0];
    
    await c.env.DB.prepare(`
      INSERT INTO product_costs (product_code, material_cost, labor_cost, overhead_cost, total_cost, selling_price, margin_rate, calc_date, memo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      product_code,
      material_cost || 0,
      labor_cost || 0,
      overhead_cost || 0,
      total_cost,
      selling_price || null,
      margin_rate,
      calc_date,
      memo || null
    ).run();
    
    return c.json({ success: true, message: '제품 원가가 저장되었습니다' });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 제품 원가 이력 조회
app.get('/products/:productCode/history', async (c) => {
  try {
    const productCode = c.req.param('productCode');
    
    const result = await c.env.DB.prepare(`
      SELECT * FROM product_costs 
      WHERE product_code = ?
      ORDER BY calc_date DESC
      LIMIT 50
    `).bind(productCode).all();
    
    return c.json({ success: true, data: result.results });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ==================== 원가 분석/시뮬레이션 ====================

// 원료 단가 변동 시뮬레이션
app.post('/simulate', async (c) => {
  try {
    const body = await c.req.json();
    const { changes } = body; // [{item_code, new_cost}]
    
    if (!changes || !Array.isArray(changes)) {
      return c.json({ success: false, error: '변경 항목 배열이 필요합니다' }, 400);
    }
    
    // 변경된 원료를 사용하는 모든 제품 조회
    const affectedProducts = new Map();
    
    for (const change of changes) {
      const products = await c.env.DB.prepare(`
        SELECT DISTINCT b.product_code, m.item_name as product_name
        FROM bom b
        JOIN master m ON b.product_code = m.item_code
        WHERE b.item_code = ?
      `).bind(change.item_code).all();
      
      for (const p of products.results as any[]) {
        if (!affectedProducts.has(p.product_code)) {
          affectedProducts.set(p.product_code, {
            product_code: p.product_code,
            product_name: p.product_name,
            current_cost: 0,
            new_cost: 0,
            difference: 0
          });
        }
      }
    }
    
    // 각 영향받는 제품의 현재 원가와 새 원가 계산
    for (const [productCode, productInfo] of affectedProducts) {
      // 현재 원가
      const currentResult = await c.env.DB.prepare(`
        SELECT SUM(
          CASE 
            WHEN b.unit = 'g' AND mc.unit = 'kg' THEN (b.quantity / 1000) * COALESCE(mc.cost_per_unit, 0)
            ELSE b.quantity * COALESCE(mc.cost_per_unit, 0)
          END
        ) as total
        FROM bom b
        LEFT JOIN (
          SELECT mc1.* FROM material_costs mc1
          INNER JOIN (SELECT item_code, MAX(effective_date) as max_date FROM material_costs GROUP BY item_code) mc2 
          ON mc1.item_code = mc2.item_code AND mc1.effective_date = mc2.max_date
        ) mc ON b.item_code = mc.item_code
        WHERE b.product_code = ?
      `).bind(productCode).first();
      
      productInfo.current_cost = Math.round((currentResult?.total as number || 0) * 100) / 100;
      
      // 새 원가 (변경된 단가 적용)
      const changeMap = new Map(changes.map((ch: any) => [ch.item_code, ch.new_cost]));
      
      const bomItems = await c.env.DB.prepare(`
        SELECT b.item_code, b.quantity, b.unit as bom_unit, mc.cost_per_unit, mc.unit as cost_unit
        FROM bom b
        LEFT JOIN (
          SELECT mc1.* FROM material_costs mc1
          INNER JOIN (SELECT item_code, MAX(effective_date) as max_date FROM material_costs GROUP BY item_code) mc2 
          ON mc1.item_code = mc2.item_code AND mc1.effective_date = mc2.max_date
        ) mc ON b.item_code = mc.item_code
        WHERE b.product_code = ?
      `).bind(productCode).all();
      
      let newTotal = 0;
      for (const item of bomItems.results as any[]) {
        const unitCost = changeMap.has(item.item_code) ? changeMap.get(item.item_code) : (item.cost_per_unit || 0);
        let qty = item.quantity;
        if (item.bom_unit === 'g' && item.cost_unit === 'kg') {
          qty = item.quantity / 1000;
        }
        newTotal += qty * unitCost;
      }
      
      productInfo.new_cost = Math.round(newTotal * 100) / 100;
      productInfo.difference = Math.round((productInfo.new_cost - productInfo.current_cost) * 100) / 100;
    }
    
    return c.json({
      success: true,
      data: {
        changes,
        affected_products: Array.from(affectedProducts.values())
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ==================== 상세 제조원가계산서 ====================

// 상세 원가계산서 목록 조회
app.get('/sheets', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT 
        s.*,
        m.item_name as product_name,
        cs.total_manufacturing_cost,
        cs.unit_manufacturing_cost
      FROM product_cost_sheet s
      LEFT JOIN master m ON s.product_code = m.item_code
      LEFT JOIN cost_summary cs ON s.id = cs.sheet_id
      WHERE s.is_active = 1
      ORDER BY s.updated_at DESC
    `).all();
    
    return c.json({ success: true, data: result.results });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 상세 원가계산서 조회
app.get('/sheets/:id', async (c) => {
  try {
    const sheetId = c.req.param('id');
    
    // 기본 정보
    const sheet = await c.env.DB.prepare(`
      SELECT s.*, m.item_name as product_name
      FROM product_cost_sheet s
      LEFT JOIN master m ON s.product_code = m.item_code
      WHERE s.id = ?
    `).bind(sheetId).first();
    
    if (!sheet) {
      return c.json({ success: false, error: '원가계산서를 찾을 수 없습니다' }, 404);
    }
    
    // 원재료비
    const rawMaterials = await c.env.DB.prepare(`
      SELECT * FROM cost_raw_materials WHERE sheet_id = ? ORDER BY sort_order
    `).bind(sheetId).all();
    
    // 부재료비
    const subMaterials = await c.env.DB.prepare(`
      SELECT * FROM cost_sub_materials WHERE sheet_id = ? ORDER BY sort_order
    `).bind(sheetId).all();
    
    // 노무비
    const laborCosts = await c.env.DB.prepare(`
      SELECT * FROM cost_labor WHERE sheet_id = ? ORDER BY cost_type, sort_order
    `).bind(sheetId).all();
    
    // 경비
    const overheadCosts = await c.env.DB.prepare(`
      SELECT * FROM cost_overhead WHERE sheet_id = ? ORDER BY cost_type, sort_order
    `).bind(sheetId).all();
    
    // 요약
    const summary = await c.env.DB.prepare(`
      SELECT * FROM cost_summary WHERE sheet_id = ?
    `).bind(sheetId).first();
    
    return c.json({
      success: true,
      data: {
        sheet,
        raw_materials: rawMaterials.results,
        sub_materials: subMaterials.results,
        labor_costs: laborCosts.results,
        overhead_costs: overheadCosts.results,
        summary
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 상세 원가계산서 생성
app.post('/sheets', async (c) => {
  try {
    const body = await c.req.json();
    const {
      product_code,
      sheet_name,
      base_quantity = 1,
      base_unit = 'ea',
      retail_price,
      wholesale_price,
      target_margin_rate,
      memo,
      raw_materials = [],      // 원재료비 목록
      sub_materials = [],      // 부재료비 목록
      labor_costs = [],        // 노무비 목록
      overhead_costs = []      // 경비 목록
    } = body;
    
    if (!product_code) {
      return c.json({ success: false, error: '제품코드는 필수입니다' }, 400);
    }
    
    // 원가계산서 생성
    const sheetResult = await c.env.DB.prepare(`
      INSERT INTO product_cost_sheet 
        (product_code, sheet_name, base_quantity, base_unit, retail_price, wholesale_price, target_margin_rate, memo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      product_code,
      sheet_name || null,
      base_quantity,
      base_unit,
      retail_price || null,
      wholesale_price || null,
      target_margin_rate || null,
      memo || null
    ).run();
    
    const sheetId = sheetResult.meta.last_row_id;
    
    // 원재료비 삽입
    let rawMaterialTotal = 0;
    for (let i = 0; i < raw_materials.length; i++) {
      const m = raw_materials[i];
      const amount = m.amount || (m.weight && m.unit_price ? (m.weight / 1000) * m.unit_price * (1 + (m.loss_rate || 0)) : 0);
      rawMaterialTotal += amount;
      
      await c.env.DB.prepare(`
        INSERT INTO cost_raw_materials 
          (sheet_id, sort_order, item_code, item_name, ratio, weight, loss_rate, unit_price, amount, unit_cost, memo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        sheetId, i, m.item_code || null, m.item_name,
        m.ratio || null, m.weight || null, m.loss_rate || 0,
        m.unit_price || null, amount, m.unit_cost || null, m.memo || null
      ).run();
    }
    
    // 부재료비 삽입
    let subMaterialTotal = 0;
    for (let i = 0; i < sub_materials.length; i++) {
      const m = sub_materials[i];
      const amount = m.amount || (m.quantity && m.unit_price ? m.quantity * m.unit_price * (1 + (m.loss_rate || 0)) : 0);
      subMaterialTotal += amount;
      
      await c.env.DB.prepare(`
        INSERT INTO cost_sub_materials 
          (sheet_id, sort_order, category, item_name, ratio, quantity, loss_rate, unit_price, amount, unit_cost, memo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        sheetId, i, m.category || null, m.item_name,
        m.ratio || null, m.quantity || null, m.loss_rate || 0,
        m.unit_price || null, amount, m.unit_cost || null, m.memo || null
      ).run();
    }
    
    // 노무비 삽입
    let directLaborTotal = 0, indirectLaborTotal = 0;
    for (let i = 0; i < labor_costs.length; i++) {
      const l = labor_costs[i];
      const amount = l.amount || 0;
      if (l.cost_type === 'direct') directLaborTotal += amount;
      else indirectLaborTotal += amount;
      
      await c.env.DB.prepare(`
        INSERT INTO cost_labor 
          (sheet_id, sort_order, cost_type, category, item_name, base_cost, allocation_rate, amount, unit_cost, memo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        sheetId, i, l.cost_type || 'direct', l.category || null, l.item_name,
        l.base_cost || null, l.allocation_rate || null, amount, l.unit_cost || null, l.memo || null
      ).run();
    }
    
    // 경비 삽입
    let directOverheadTotal = 0, indirectOverheadTotal = 0;
    for (let i = 0; i < overhead_costs.length; i++) {
      const o = overhead_costs[i];
      const amount = o.amount || 0;
      if (o.cost_type === 'direct') directOverheadTotal += amount;
      else indirectOverheadTotal += amount;
      
      await c.env.DB.prepare(`
        INSERT INTO cost_overhead 
          (sheet_id, sort_order, cost_type, category, item_name, base_cost, allocation_rate, amount, unit_cost, memo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        sheetId, i, o.cost_type || 'direct', o.category || null, o.item_name,
        o.base_cost || null, o.allocation_rate || null, amount, o.unit_cost || null, o.memo || null
      ).run();
    }
    
    // 요약 계산 및 저장
    const directCostTotal = rawMaterialTotal + subMaterialTotal + directLaborTotal + directOverheadTotal;
    const indirectCostTotal = indirectLaborTotal + indirectOverheadTotal;
    const totalManufacturingCost = directCostTotal + indirectCostTotal;
    const unitManufacturingCost = base_quantity > 0 ? totalManufacturingCost / base_quantity : 0;
    
    await c.env.DB.prepare(`
      INSERT INTO cost_summary 
        (sheet_id, raw_material_cost, sub_material_cost, direct_labor_cost, direct_overhead_cost, direct_cost_total,
         indirect_labor_cost, indirect_overhead_cost, indirect_cost_total, total_manufacturing_cost, unit_manufacturing_cost,
         retail_unit_cost, wholesale_unit_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      sheetId, rawMaterialTotal, subMaterialTotal, directLaborTotal, directOverheadTotal, directCostTotal,
      indirectLaborTotal, indirectOverheadTotal, indirectCostTotal, totalManufacturingCost, unitManufacturingCost,
      retail_price ? (unitManufacturingCost / retail_price * 100) : null,
      wholesale_price ? (unitManufacturingCost / wholesale_price * 100) : null
    ).run();
    
    return c.json({ 
      success: true, 
      message: '원가계산서가 생성되었습니다',
      data: { sheet_id: sheetId, total_manufacturing_cost: totalManufacturingCost }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// BOM 기반 원가계산서 자동 생성
app.post('/sheets/from-bom/:productCode', async (c) => {
  try {
    const productCode = c.req.param('productCode');
    const body = await c.req.json();
    const { 
      sheet_name,
      base_quantity = 1,
      retail_price,
      wholesale_price,
      labor_rate = 0,      // 노무비 비율 (원재료비 대비 %)
      overhead_rate = 0    // 경비 비율 (원재료비 대비 %)
    } = body;
    
    // 제품 정보
    const product = await c.env.DB.prepare(`
      SELECT item_code, item_name FROM master WHERE item_code = ? AND category = '제품'
    `).bind(productCode).first();
    
    if (!product) {
      return c.json({ success: false, error: '제품을 찾을 수 없습니다' }, 404);
    }
    
    // BOM 및 원가 조회
    const bomResult = await c.env.DB.prepare(`
      SELECT 
        b.item_code,
        m.item_name,
        b.quantity as weight,
        b.unit,
        mc.cost_per_unit as unit_price
      FROM bom b
      JOIN master m ON b.item_code = m.item_code
      LEFT JOIN (
        SELECT mc1.*
        FROM material_costs mc1
        INNER JOIN (
          SELECT item_code, MAX(effective_date) as max_date
          FROM material_costs
          GROUP BY item_code
        ) mc2 ON mc1.item_code = mc2.item_code AND mc1.effective_date = mc2.max_date
      ) mc ON b.item_code = mc.item_code
      WHERE b.product_code = ?
      ORDER BY b.sort_order
    `).bind(productCode).all();
    
    // 원재료 목록 생성
    const raw_materials = bomResult.results.map((b: any) => ({
      item_code: b.item_code,
      item_name: b.item_name,
      weight: b.weight,
      unit_price: b.unit_price || 0,
      loss_rate: 0.02,  // 기본 LOSS 2%
      amount: b.unit_price ? (b.weight / 1000) * b.unit_price * 1.02 : 0
    }));
    
    // 원재료비 합계
    const rawMaterialTotal = raw_materials.reduce((sum: number, m: any) => sum + (m.amount || 0), 0);
    
    // 노무비 (원재료비 기준)
    const labor_costs = [];
    if (labor_rate > 0) {
      labor_costs.push({
        cost_type: 'direct',
        item_name: '직접노무비',
        amount: rawMaterialTotal * labor_rate / 100
      });
    }
    
    // 경비 (원재료비 기준)
    const overhead_costs = [];
    if (overhead_rate > 0) {
      overhead_costs.push({
        cost_type: 'direct',
        item_name: '직접경비',
        amount: rawMaterialTotal * overhead_rate / 100
      });
    }
    
    // 원가계산서 생성 API 재호출
    const createBody = {
      product_code: productCode,
      sheet_name: sheet_name || (product as any).item_name,
      base_quantity,
      retail_price,
      wholesale_price,
      raw_materials,
      labor_costs,
      overhead_costs
    };
    
    // 직접 생성 로직
    const sheetResult = await c.env.DB.prepare(`
      INSERT INTO product_cost_sheet 
        (product_code, sheet_name, base_quantity, retail_price, wholesale_price)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      productCode,
      createBody.sheet_name,
      base_quantity,
      retail_price || null,
      wholesale_price || null
    ).run();
    
    const sheetId = sheetResult.meta.last_row_id;
    
    // 원재료비 삽입
    let rawTotal = 0;
    for (let i = 0; i < raw_materials.length; i++) {
      const m = raw_materials[i];
      rawTotal += m.amount || 0;
      
      await c.env.DB.prepare(`
        INSERT INTO cost_raw_materials 
          (sheet_id, sort_order, item_code, item_name, weight, loss_rate, unit_price, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(sheetId, i, m.item_code, m.item_name, m.weight, m.loss_rate, m.unit_price, m.amount).run();
    }
    
    // 노무비 삽입
    let laborTotal = 0;
    for (const l of labor_costs) {
      laborTotal += l.amount || 0;
      await c.env.DB.prepare(`
        INSERT INTO cost_labor (sheet_id, cost_type, item_name, amount)
        VALUES (?, ?, ?, ?)
      `).bind(sheetId, l.cost_type, l.item_name, l.amount).run();
    }
    
    // 경비 삽입
    let overheadTotal = 0;
    for (const o of overhead_costs) {
      overheadTotal += o.amount || 0;
      await c.env.DB.prepare(`
        INSERT INTO cost_overhead (sheet_id, cost_type, item_name, amount)
        VALUES (?, ?, ?, ?)
      `).bind(sheetId, o.cost_type, o.item_name, o.amount).run();
    }
    
    const totalCost = rawTotal + laborTotal + overheadTotal;
    
    // 요약 저장
    await c.env.DB.prepare(`
      INSERT INTO cost_summary 
        (sheet_id, raw_material_cost, direct_labor_cost, direct_overhead_cost, 
         direct_cost_total, total_manufacturing_cost, unit_manufacturing_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(sheetId, rawTotal, laborTotal, overheadTotal, totalCost, totalCost, totalCost / base_quantity).run();
    
    return c.json({
      success: true,
      message: 'BOM 기반 원가계산서가 생성되었습니다',
      data: { 
        sheet_id: sheetId, 
        total_manufacturing_cost: totalCost,
        raw_material_cost: rawTotal
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 원가계산서 삭제
app.delete('/sheets/:id', async (c) => {
  try {
    const sheetId = c.req.param('id');
    
    // 비활성화 (soft delete)
    await c.env.DB.prepare(`
      UPDATE product_cost_sheet SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(sheetId).run();
    
    return c.json({ success: true, message: '원가계산서가 삭제되었습니다' });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 원가계산서 인쇄용 데이터 조회
app.get('/sheets/:id/print', async (c) => {
  try {
    const sheetId = c.req.param('id');
    
    // 기본 정보
    const sheet = await c.env.DB.prepare(`
      SELECT s.*, m.item_name as product_name
      FROM product_cost_sheet s
      LEFT JOIN master m ON s.product_code = m.item_code
      WHERE s.id = ?
    `).bind(sheetId).first();
    
    if (!sheet) {
      return c.json({ success: false, error: '원가계산서를 찾을 수 없습니다' }, 404);
    }
    
    // 원재료비
    const rawMaterials = await c.env.DB.prepare(`
      SELECT * FROM cost_raw_materials WHERE sheet_id = ? ORDER BY sort_order
    `).bind(sheetId).all();
    
    // 부재료비
    const subMaterials = await c.env.DB.prepare(`
      SELECT * FROM cost_sub_materials WHERE sheet_id = ? ORDER BY category, sort_order
    `).bind(sheetId).all();
    
    // 노무비
    const laborCosts = await c.env.DB.prepare(`
      SELECT * FROM cost_labor WHERE sheet_id = ? ORDER BY cost_type, sort_order
    `).bind(sheetId).all();
    
    // 경비
    const overheadCosts = await c.env.DB.prepare(`
      SELECT * FROM cost_overhead WHERE sheet_id = ? ORDER BY cost_type, sort_order
    `).bind(sheetId).all();
    
    // 요약
    const summary = await c.env.DB.prepare(`
      SELECT * FROM cost_summary WHERE sheet_id = ?
    `).bind(sheetId).first();
    
    // 노무비/경비 분류
    const directLabor = (laborCosts.results as any[]).filter(l => l.cost_type === 'direct');
    const indirectLabor = (laborCosts.results as any[]).filter(l => l.cost_type === 'indirect');
    const directOverhead = (overheadCosts.results as any[]).filter(o => o.cost_type === 'direct');
    const indirectOverhead = (overheadCosts.results as any[]).filter(o => o.cost_type === 'indirect');
    
    // 부재료비 카테고리별 분류
    const subMaterialsByCategory: Record<string, any[]> = {};
    for (const sm of subMaterials.results as any[]) {
      const cat = sm.category || '기타';
      if (!subMaterialsByCategory[cat]) subMaterialsByCategory[cat] = [];
      subMaterialsByCategory[cat].push(sm);
    }
    
    return c.json({
      success: true,
      data: {
        sheet,
        summary,
        raw_materials: rawMaterials.results,
        sub_materials: subMaterials.results,
        sub_materials_by_category: subMaterialsByCategory,
        direct_labor: directLabor,
        indirect_labor: indirectLabor,
        direct_overhead: directOverhead,
        indirect_overhead: indirectOverhead
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 노무비/경비 기준 설정 조회
app.get('/standard-rates', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT * FROM cost_standard_rates WHERE is_active = 1 ORDER BY rate_type, category, item_name
    `).all();
    
    return c.json({ success: true, data: result.results });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 노무비/경비 기준 설정 저장
app.post('/standard-rates', async (c) => {
  try {
    const body = await c.req.json();
    const { rate_type, category, item_name, monthly_base_cost, allocation_method, memo } = body;
    
    if (!rate_type || !item_name) {
      return c.json({ success: false, error: '유형과 항목명은 필수입니다' }, 400);
    }
    
    await c.env.DB.prepare(`
      INSERT INTO cost_standard_rates (rate_type, category, item_name, monthly_base_cost, allocation_method, memo)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(rate_type, category || null, item_name, monthly_base_cost || null, allocation_method || null, memo || null).run();
    
    return c.json({ success: true, message: '기준 설정이 저장되었습니다' });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 원가 통계
app.get('/stats', async (c) => {
  try {
    // 전체 원료 수
    const totalMaterials = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM master WHERE category = '원료'
    `).first();
    
    // 단가 등록된 원료 수
    const materialsWithCost = await c.env.DB.prepare(`
      SELECT COUNT(DISTINCT item_code) as count FROM material_costs
    `).first();
    
    // BOM 있는 제품 수
    const productsWithBom = await c.env.DB.prepare(`
      SELECT COUNT(DISTINCT product_code) as count FROM bom
    `).first();
    
    // 원가 계산 완료 제품 수 (모든 원료에 단가가 있는 제품)
    const completeProducts = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM (
        SELECT b.product_code
        FROM bom b
        LEFT JOIN (
          SELECT mc1.item_code FROM material_costs mc1
          INNER JOIN (SELECT item_code, MAX(effective_date) as max_date FROM material_costs GROUP BY item_code) mc2 
          ON mc1.item_code = mc2.item_code AND mc1.effective_date = mc2.max_date
        ) mc ON b.item_code = mc.item_code
        GROUP BY b.product_code
        HAVING SUM(CASE WHEN mc.item_code IS NULL THEN 1 ELSE 0 END) = 0
      )
    `).first();
    
    return c.json({
      success: true,
      data: {
        total_materials: totalMaterials?.count || 0,
        materials_with_cost: materialsWithCost?.count || 0,
        products_with_bom: productsWithBom?.count || 0,
        complete_products: completeProducts?.count || 0,
        cost_coverage: totalMaterials?.count ? 
          Math.round(((materialsWithCost?.count as number || 0) / (totalMaterials.count as number)) * 100) : 0
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
