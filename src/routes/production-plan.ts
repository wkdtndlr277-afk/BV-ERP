import { Hono } from 'hono';

type Bindings = {
  DB: D1Database;
};

const productionPlanRoutes = new Hono<{ Bindings: Bindings }>();

// 테이블 생성
async function ensureTables(db: D1Database) {
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS production_plan (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_date DATE NOT NULL,
        plan_name TEXT,
        file_name TEXT,
        total_items INTEGER DEFAULT 0,
        total_quantity REAL DEFAULT 0,
        status TEXT DEFAULT '작성중',
        memo TEXT,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS production_plan_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id INTEGER NOT NULL,
        seq_no INTEGER,
        product_name TEXT NOT NULL,
        product_code TEXT,
        order_total REAL DEFAULT 0,
        qty_coupang REAL DEFAULT 0,
        qty_oasis REAL DEFAULT 0,
        qty_uiwang REAL DEFAULT 0,
        qty_store REAL DEFAULT 0,
        qty_franchise REAL DEFAULT 0,
        qty_kurly_frozen REAL DEFAULT 0,
        qty_kurly_pyeongtaek REAL DEFAULT 0,
        qty_kurly_gimpo REAL DEFAULT 0,
        qty_kurly_changwon REAL DEFAULT 0,
        qty_baemin REAL DEFAULT 0,
        qty_naver REAL DEFAULT 0,
        qty_extra REAL DEFAULT 0,
        current_stock REAL DEFAULT 0,
        frozen_stock REAL DEFAULT 0,
        required_qty REAL DEFAULT 0,
        storage_type TEXT DEFAULT '실온',
        status TEXT DEFAULT '대기',
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS frozen_stock (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name TEXT NOT NULL,
        product_code TEXT,
        quantity REAL DEFAULT 0,
        frozen_date DATE,
        expiry_date DATE,
        location TEXT,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (e) {
    console.error('Table creation error:', e);
  }
}

// 생산계획 목록 조회
productionPlanRoutes.get('/', async (c) => {
  await ensureTables(c.env.DB);
  
  const plans = await c.env.DB.prepare(`
    SELECT * FROM production_plan ORDER BY plan_date DESC, id DESC
  `).all();
  
  return c.json({ success: true, data: plans.results });
});

// 생산계획 상세 조회
productionPlanRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  
  const plan = await c.env.DB.prepare(`
    SELECT * FROM production_plan WHERE id = ?
  `).bind(id).first();
  
  if (!plan) {
    return c.json({ success: false, error: '계획을 찾을 수 없습니다.' }, 404);
  }
  
  // 상세 품목 조회
  const items = await c.env.DB.prepare(`
    SELECT * FROM production_plan_items WHERE plan_id = ? ORDER BY seq_no, id
  `).bind(id).all();
  
  return c.json({ success: true, data: { plan, items: items.results } });
});

// 생산계획 업로드 (프론트엔드에서 파싱된 JSON 데이터 수신)
productionPlanRoutes.post('/upload', async (c) => {
  await ensureTables(c.env.DB);
  
  try {
    const body = await c.req.json();
    const { plan_date, file_name, items } = body;
    
    const planDate = plan_date || new Date().toISOString().split('T')[0];
    
    if (!items || items.length === 0) {
      return c.json({ success: false, error: '파싱된 데이터가 없습니다.' }, 400);
    }
    
    // 생산계획 마스터 생성
    const planResult = await c.env.DB.prepare(`
      INSERT INTO production_plan (plan_date, plan_name, file_name, total_items, total_quantity, status)
      VALUES (?, ?, ?, ?, ?, '작성중')
    `).bind(
      planDate,
      `${planDate} 생산계획`,
      file_name || 'uploaded_file.xlsx',
      items.length,
      items.reduce((sum: number, item: any) => sum + (item.order_total || 0), 0)
    ).run();
    
    const planId = planResult.meta.last_row_id;
    
    // 상세 품목 저장 및 재고 연동
    for (const item of items) {
      // 시스템 재고 조회 (제품 마스터에서)
      const product = await c.env.DB.prepare(`
        SELECT item_code, current_stock FROM master 
        WHERE category = '제품' AND (item_name LIKE ? OR item_name = ?)
        LIMIT 1
      `).bind(`%${item.product_name}%`, item.product_name).first<{ item_code: string; current_stock: number }>();
      
      // 냉동 재고 조회
      const frozen = await c.env.DB.prepare(`
        SELECT SUM(quantity) as total FROM frozen_stock WHERE product_name LIKE ?
      `).bind(`%${item.product_name}%`).first<{ total: number }>();
      
      const currentStock = product?.current_stock || 0;
      const frozenStock = frozen?.total || 0;
      const requiredQty = (item.order_total || 0) - currentStock - frozenStock;
      
      await c.env.DB.prepare(`
        INSERT INTO production_plan_items (
          plan_id, seq_no, product_name, product_code, order_total,
          qty_coupang, qty_oasis, qty_uiwang, qty_store, qty_franchise,
          qty_kurly_frozen, qty_kurly_pyeongtaek, qty_kurly_gimpo, qty_kurly_changwon,
          qty_baemin, qty_naver, qty_extra,
          current_stock, frozen_stock, required_qty
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        planId,
        item.seq_no || 0,
        item.product_name,
        product?.item_code || null,
        item.order_total || 0,
        item.qty_coupang || 0,
        item.qty_oasis || 0,
        item.qty_uiwang || 0,
        item.qty_store || 0,
        item.qty_franchise || 0,
        item.qty_kurly_frozen || 0,
        item.qty_kurly_pyeongtaek || 0,
        item.qty_kurly_gimpo || 0,
        item.qty_kurly_changwon || 0,
        item.qty_baemin || 0,
        item.qty_naver || 0,
        item.qty_extra || 0,
        currentStock,
        frozenStock,
        requiredQty
      ).run();
    }
    
    return c.json({ 
      success: true, 
      data: { 
        plan_id: planId, 
        items_count: items.length,
        total_quantity: items.reduce((sum: number, item: any) => sum + (item.order_total || 0), 0)
      } 
    });
    
  } catch (error: any) {
    console.error('Upload error:', error);
    return c.json({ success: false, error: error.message || '데이터 처리 중 오류 발생' }, 500);
  }
});

// 생산계획 삭제
productionPlanRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  
  await c.env.DB.prepare('DELETE FROM production_plan_items WHERE plan_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM production_plan WHERE id = ?').bind(id).run();
  
  return c.json({ success: true });
});

// 재고 동기화 (시스템 재고와 냉동 재고 다시 조회)
productionPlanRoutes.post('/:id/sync-stock', async (c) => {
  const id = c.req.param('id');
  
  const items = await c.env.DB.prepare(`
    SELECT * FROM production_plan_items WHERE plan_id = ?
  `).bind(id).all();
  
  for (const item of items.results || []) {
    const it = item as any;
    
    // 시스템 재고 조회
    const product = await c.env.DB.prepare(`
      SELECT current_stock FROM master 
      WHERE category = '제품' AND (item_name LIKE ? OR item_name = ?)
      LIMIT 1
    `).bind(`%${it.product_name}%`, it.product_name).first<{ current_stock: number }>();
    
    // 냉동 재고 조회
    const frozen = await c.env.DB.prepare(`
      SELECT SUM(quantity) as total FROM frozen_stock WHERE product_name LIKE ?
    `).bind(`%${it.product_name}%`).first<{ total: number }>();
    
    const currentStock = product?.current_stock || 0;
    const frozenStock = frozen?.total || 0;
    const requiredQty = it.order_total - currentStock - frozenStock;
    
    await c.env.DB.prepare(`
      UPDATE production_plan_items 
      SET current_stock = ?, frozen_stock = ?, required_qty = ?
      WHERE id = ?
    `).bind(currentStock, frozenStock, requiredQty, it.id).run();
  }
  
  return c.json({ success: true, message: '재고 동기화 완료' });
});

// 냉동 재고 목록
productionPlanRoutes.get('/frozen-stock/list', async (c) => {
  await ensureTables(c.env.DB);
  
  const stocks = await c.env.DB.prepare(`
    SELECT * FROM frozen_stock WHERE quantity > 0 ORDER BY product_name
  `).all();
  
  return c.json({ success: true, data: stocks.results });
});

// 냉동 재고 등록/수정
productionPlanRoutes.post('/frozen-stock', async (c) => {
  await ensureTables(c.env.DB);
  
  const body = await c.req.json();
  const { id, product_name, product_code, quantity, frozen_date, expiry_date, location, memo } = body;
  
  if (id) {
    await c.env.DB.prepare(`
      UPDATE frozen_stock SET 
        product_name = ?, product_code = ?, quantity = ?, 
        frozen_date = ?, expiry_date = ?, location = ?, memo = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(product_name, product_code, quantity, frozen_date, expiry_date, location, memo, id).run();
  } else {
    await c.env.DB.prepare(`
      INSERT INTO frozen_stock (product_name, product_code, quantity, frozen_date, expiry_date, location, memo)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(product_name, product_code, quantity, frozen_date, expiry_date, location, memo).run();
  }
  
  return c.json({ success: true });
});

// 냉동 재고 삭제
productionPlanRoutes.delete('/frozen-stock/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM frozen_stock WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

export { productionPlanRoutes };
