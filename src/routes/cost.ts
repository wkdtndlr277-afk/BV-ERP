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

// 전체 제품 원가 목록
app.get('/products', async (c) => {
  try {
    // BOM이 있는 제품 목록 + 원가 계산
    const result = await c.env.DB.prepare(`
      SELECT DISTINCT 
        m.item_code,
        m.item_name,
        (SELECT COUNT(*) FROM bom WHERE product_code = m.item_code) as bom_count
      FROM master m
      WHERE m.category = '제품'
        AND EXISTS (SELECT 1 FROM bom WHERE product_code = m.item_code)
      ORDER BY m.item_name
    `).all();
    
    // 각 제품별 원가 계산
    const products = [];
    for (const row of result.results as any[]) {
      const costResult = await c.env.DB.prepare(`
        SELECT 
          SUM(
            CASE 
              WHEN b.unit = 'g' AND mc.unit = 'kg' THEN (b.quantity / 1000) * COALESCE(mc.cost_per_unit, 0)
              WHEN b.unit = 'kg' AND mc.unit = 'g' THEN (b.quantity * 1000) * COALESCE(mc.cost_per_unit, 0)
              ELSE b.quantity * COALESCE(mc.cost_per_unit, 0)
            END
          ) as total_cost,
          COUNT(*) as total_items,
          SUM(CASE WHEN mc.cost_per_unit IS NULL THEN 1 ELSE 0 END) as missing_items
        FROM bom b
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
      `).bind(row.item_code).first();
      
      products.push({
        product_code: row.item_code,
        product_name: row.item_name,
        bom_count: row.bom_count,
        material_cost: costResult ? Math.round((costResult.total_cost as number || 0) * 100) / 100 : 0,
        missing_items: costResult?.missing_items || 0,
        is_complete: (costResult?.missing_items || 0) === 0
      });
    }
    
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
