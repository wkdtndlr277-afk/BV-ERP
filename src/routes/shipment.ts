// 출고 관리 API
// v3.5.24: 생산일보 기반 출고 자동화 연동
import { Hono } from 'hono';

type Bindings = {
  DB: D1Database;
};

const shipmentRoutes = new Hono<{ Bindings: Bindings }>();

// ===== 테이블 초기화 =====
shipmentRoutes.post('/init-table', async (c) => {
  try {
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS shipments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shipment_date TEXT NOT NULL,
        order_id TEXT,
        production_lot TEXT,
        channel TEXT,
        product_code TEXT NOT NULL,
        product_name TEXT,
        quantity INTEGER NOT NULL,
        status TEXT DEFAULT '출고대기',
        delivery_status TEXT DEFAULT '배송준비',
        tracking_number TEXT,
        remark TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    await c.env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_shipments_date ON shipments(shipment_date)
    `).run();
    await c.env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status)
    `).run();
    
    return c.json({ success: true, message: 'shipments 테이블 생성 완료' });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 출고 대기 목록 =====
shipmentRoutes.get('/pending', async (c) => {
  try {
    const date = c.req.query('date');
    let query = `SELECT * FROM shipments WHERE status IN ('출고대기', '부분출고대기')`;
    const params: any[] = [];
    
    if (date) {
      query += ` AND shipment_date = ?`;
      params.push(date);
    }
    query += ` ORDER BY created_at DESC`;
    
    const result = await c.env.DB.prepare(query).bind(...params).all();
    return c.json({ success: true, count: result.results?.length || 0, data: result.results || [] });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 출고 확정 =====
shipmentRoutes.post('/confirm', async (c) => {
  try {
    const { shipment_ids, confirm_date } = await c.req.json();
    if (!shipment_ids?.length) return c.json({ success: false, error: '출고 ID 필요' }, 400);
    
    const shipDate = confirm_date || new Date().toISOString().split('T')[0];
    const results = [];
    
    for (const id of shipment_ids) {
      const shipment = await c.env.DB.prepare(`SELECT * FROM shipments WHERE id = ?`).bind(id).first<any>();
      if (!shipment || shipment.status === '출고완료') continue;
      
      await c.env.DB.prepare(`
        UPDATE shipments SET status = '출고완료', shipment_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).bind(shipDate, id).run();
      
      await c.env.DB.prepare(`
        UPDATE master SET current_stock = MAX(0, current_stock - ?), updated_at = CURRENT_TIMESTAMP WHERE item_code = ?
      `).bind(shipment.quantity, shipment.product_code).run();
      
      results.push({ id, product_code: shipment.product_code, quantity: shipment.quantity });
    }
    
    return c.json({ success: true, confirmed_count: results.length, data: results });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 출고 등록 =====
shipmentRoutes.post('/register', async (c) => {
  try {
    const body = await c.req.json();
    const { shipment_date, order_id, production_lot, channel, product_code, product_name, quantity, status = '출고대기' } = body;
    
    if (!product_code || !quantity) return c.json({ success: false, error: '제품코드, 수량 필수' }, 400);
    
    const date = shipment_date || new Date().toISOString().split('T')[0];

    const result = await c.env.DB.prepare(`
      INSERT INTO shipments (shipment_date, order_id, production_lot, channel, product_code, product_name, quantity, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(date, order_id ?? null, production_lot ?? null, channel ?? null, product_code, product_name ?? null, quantity, status).run();

    // 포장재(박스 등) 자동 차감: 이 제품에 연결된 포장재가 있으면
    // 입수량 기준으로 필요한 박스 수를 계산해서 재고에서 차감하고 이력을 남긴다.
    const packagingLinks = await c.env.DB.prepare(`
      SELECT supply_code, pack_qty FROM production_packaging WHERE production_code = ?
    `).bind(product_code).all();

    const packagingDeducted: any[] = [];
    for (const link of (packagingLinks.results as any[]) || []) {
      const neededQty = Math.ceil(quantity / link.pack_qty);
      await c.env.DB.batch([
        c.env.DB.prepare('UPDATE supplies SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP WHERE item_code = ?')
          .bind(neededQty, link.supply_code),
        c.env.DB.prepare(`
          INSERT INTO supply_transactions (trans_date, item_code, trans_type, quantity, reference_type, reference_id, memo)
          VALUES (?, ?, '사용', ?, 'shipment', ?, ?)
        `).bind(date, link.supply_code, neededQty, result.meta.last_row_id, `출고 ${quantity}개 -> 포장재 ${neededQty}개 차감`)
      ]);
      packagingDeducted.push({ supply_code: link.supply_code, deducted_qty: neededQty });
    }
    
    return c.json({ success: true, id: result.meta.last_row_id, packaging_deducted: packagingDeducted });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 배송 상태 업데이트 =====
shipmentRoutes.put('/delivery-status/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const { delivery_status, tracking_number } = await c.req.json();
    
    await c.env.DB.prepare(`
      UPDATE shipments SET delivery_status = ?, tracking_number = COALESCE(?, tracking_number), updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(delivery_status, tracking_number, id).run();
    
    return c.json({ success: true, message: `배송 상태: ${delivery_status}` });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 일별 출고 요약 =====
shipmentRoutes.get('/daily-summary', async (c) => {
  try {
    const date = c.req.query('date') || new Date().toISOString().split('T')[0];
    
    const statusSummary = await c.env.DB.prepare(`
      SELECT status, COUNT(*) as count, SUM(quantity) as total_qty FROM shipments WHERE shipment_date = ? GROUP BY status
    `).bind(date).all();
    
    const channelSummary = await c.env.DB.prepare(`
      SELECT channel, COUNT(*) as count, SUM(quantity) as total_qty FROM shipments WHERE shipment_date = ? AND status = '출고완료' GROUP BY channel
    `).bind(date).all();
    
    return c.json({ success: true, date, summary: { by_status: statusSummary.results, by_channel: channelSummary.results } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 주문-생산 매칭 =====
shipmentRoutes.post('/match-orders', async (c) => {
  try {
    const { production_date, product_code, quantity, production_lot, channel } = await c.req.json();
    if (!product_code || !quantity) return c.json({ success: false, error: '제품코드, 수량 필수' }, 400);
    
    let orderQuery = `SELECT * FROM orders WHERE product_code = ? AND status IN ('대기', '부분출고대기')`;
    const orderParams: any[] = [product_code];
    if (channel) { orderQuery += ` AND (channel = ? OR channel IS NULL)`; orderParams.push(channel); }
    orderQuery += ` ORDER BY order_date ASC, id ASC`;
    
    const orders = await c.env.DB.prepare(orderQuery).bind(...orderParams).all();
    let remainingQty = quantity;
    const matchResults = [];
    
    for (const order of (orders.results || []) as any[]) {
      if (remainingQty <= 0) break;
      const orderNeeded = (order.quantity || 0) - (order.matched_qty || 0);
      if (orderNeeded <= 0) continue;
      
      const matchQty = Math.min(remainingQty, orderNeeded);
      remainingQty -= matchQty;
      
      const newMatchedQty = (order.matched_qty || 0) + matchQty;
      const newStatus = newMatchedQty >= order.quantity ? '출고대기' : '부분출고대기';
      
      await c.env.DB.prepare(`UPDATE orders SET matched_qty = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(newMatchedQty, newStatus, order.id).run();
      
      const shipmentResult = await c.env.DB.prepare(`
        INSERT INTO shipments (shipment_date, order_id, production_lot, channel, product_code, product_name, quantity, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(production_date || new Date().toISOString().split('T')[0], `ORD-${order.id}`, production_lot, channel || order.channel, product_code, order.product_name, matchQty, newStatus).run();
      
      matchResults.push({ order_id: order.id, matched_qty: matchQty, new_status: newStatus, shipment_id: shipmentResult.meta.last_row_id });
    }
    
    if (remainingQty > 0) {
      await c.env.DB.prepare(`UPDATE master SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE item_code = ?`)
        .bind(remainingQty, product_code).run();
    }
    
    return c.json({ success: true, production_qty: quantity, matched_qty: quantity - remainingQty, remaining_qty: remainingQty, matches: matchResults });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ===== 정합성 체크 =====
shipmentRoutes.get('/consistency-check', async (c) => {
  try {
    const date = c.req.query('date') || new Date().toISOString().split('T')[0];
    
    const overdueOrders = await c.env.DB.prepare(`SELECT * FROM orders WHERE status = '대기' AND delivery_date < ?`).bind(date).all();
    const partialOrders = await c.env.DB.prepare(`SELECT *, (quantity - COALESCE(matched_qty, 0)) as shortage FROM orders WHERE status = '부분출고대기'`).all();
    const pendingShipments = await c.env.DB.prepare(`SELECT * FROM shipments WHERE status = '출고대기' AND shipment_date < ?`).bind(date).all();
    
    return c.json({
      success: true, date,
      consistency: {
        overdue_orders: { count: overdueOrders.results?.length || 0, data: overdueOrders.results || [] },
        partial_orders: { count: partialOrders.results?.length || 0, data: partialOrders.results || [] },
        pending_shipments: { count: pendingShipments.results?.length || 0, data: pendingShipments.results || [] }
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default shipmentRoutes;
