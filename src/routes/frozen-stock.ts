import { Hono } from 'hono';

type Bindings = {
  DB: D1Database;
};

const frozenStockRoutes = new Hono<{ Bindings: Bindings }>();

// 테이블 생성
async function ensureTables(db: D1Database) {
  try {
    // 냉동재고 마스터 (현재 재고)
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
    
    // 냉동재고 수불 이력
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS frozen_stock_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trans_date DATE NOT NULL,
        product_name TEXT NOT NULL,
        product_code TEXT,
        trans_type TEXT NOT NULL,
        quantity REAL NOT NULL,
        remain_qty REAL,
        frozen_date DATE,
        expiry_date DATE,
        location TEXT,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    // 인덱스 생성
    await db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_frozen_trans_date ON frozen_stock_transactions(trans_date)
    `).run();
    
    await db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_frozen_trans_product ON frozen_stock_transactions(product_name)
    `).run();
  } catch (e) {
    console.error('Frozen stock table creation error:', e);
  }
}

// 냉동재고 현황 조회 (제품별 집계)
frozenStockRoutes.get('/', async (c) => {
  await ensureTables(c.env.DB);
  
  const stocks = await c.env.DB.prepare(`
    SELECT 
      product_name,
      product_code,
      SUM(quantity) as total_qty,
      MIN(frozen_date) as oldest_date,
      MAX(frozen_date) as newest_date,
      COUNT(*) as lot_count
    FROM frozen_stock 
    WHERE quantity > 0
    GROUP BY product_name, product_code
    ORDER BY product_name
  `).all();
  
  return c.json({ success: true, data: stocks.results });
});

// 냉동재고 상세 (LOT별)
frozenStockRoutes.get('/detail', async (c) => {
  await ensureTables(c.env.DB);
  
  const productName = c.req.query('product_name');
  
  let query = `SELECT * FROM frozen_stock WHERE quantity > 0`;
  const params: any[] = [];
  
  if (productName) {
    query += ` AND product_name = ?`;
    params.push(productName);
  }
  
  query += ` ORDER BY frozen_date ASC, id ASC`;
  
  const stocks = await c.env.DB.prepare(query).bind(...params).all();
  
  return c.json({ success: true, data: stocks.results });
});

// 냉동재고 입고
frozenStockRoutes.post('/inbound', async (c) => {
  await ensureTables(c.env.DB);
  
  const body = await c.req.json();
  const { 
    product_name, 
    product_code, 
    quantity, 
    frozen_date, 
    expiry_date, 
    location, 
    memo 
  } = body;
  
  if (!product_name || !quantity) {
    return c.json({ success: false, error: '제품명과 수량은 필수입니다.' }, 400);
  }
  
  const transDate = frozen_date || new Date().toISOString().split('T')[0];
  
  // 냉동재고에 추가
  const result = await c.env.DB.prepare(`
    INSERT INTO frozen_stock (product_name, product_code, quantity, frozen_date, expiry_date, location, memo)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(product_name, product_code || null, quantity, transDate, expiry_date || null, location || null, memo || null).run();
  
  // 수불 이력 기록
  await c.env.DB.prepare(`
    INSERT INTO frozen_stock_transactions (trans_date, product_name, product_code, trans_type, quantity, remain_qty, frozen_date, expiry_date, location, memo)
    VALUES (?, ?, ?, '입고', ?, ?, ?, ?, ?, ?)
  `).bind(transDate, product_name, product_code || null, quantity, quantity, transDate, expiry_date || null, location || null, memo || null).run();
  
  return c.json({ success: true, data: { id: result.meta.last_row_id } });
});

// 냉동재고 출고 (선입선출)
frozenStockRoutes.post('/outbound', async (c) => {
  await ensureTables(c.env.DB);
  
  const body = await c.req.json();
  const { product_name, quantity, memo, trans_date } = body;
  
  if (!product_name || !quantity) {
    return c.json({ success: false, error: '제품명과 수량은 필수입니다.' }, 400);
  }
  
  const transDate = trans_date || new Date().toISOString().split('T')[0];
  
  // 해당 제품의 냉동재고 조회 (선입선출: 냉동일 오래된 순)
  const stocks = await c.env.DB.prepare(`
    SELECT * FROM frozen_stock 
    WHERE product_name = ? AND quantity > 0
    ORDER BY frozen_date ASC, id ASC
  `).bind(product_name).all();
  
  if (!stocks.results || stocks.results.length === 0) {
    return c.json({ success: false, error: '해당 제품의 냉동재고가 없습니다.' }, 400);
  }
  
  // 총 재고 확인
  const totalStock = stocks.results.reduce((sum: number, s: any) => sum + s.quantity, 0);
  if (totalStock < quantity) {
    return c.json({ success: false, error: `재고 부족 (현재: ${totalStock}, 요청: ${quantity})` }, 400);
  }
  
  // 선입선출로 출고 처리
  let remainingQty = quantity;
  const usedLots: any[] = [];
  
  for (const stock of stocks.results as any[]) {
    if (remainingQty <= 0) break;
    
    const useQty = Math.min(stock.quantity, remainingQty);
    const newQty = stock.quantity - useQty;
    
    // 재고 차감
    await c.env.DB.prepare(`
      UPDATE frozen_stock SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(newQty, stock.id).run();
    
    usedLots.push({
      id: stock.id,
      frozen_date: stock.frozen_date,
      used_qty: useQty,
      remain_qty: newQty
    });
    
    remainingQty -= useQty;
  }
  
  // 수불 이력 기록
  const productCode = (stocks.results[0] as any).product_code;
  await c.env.DB.prepare(`
    INSERT INTO frozen_stock_transactions (trans_date, product_name, product_code, trans_type, quantity, memo)
    VALUES (?, ?, ?, '출고', ?, ?)
  `).bind(transDate, product_name, productCode, -quantity, memo || '출고').run();
  
  return c.json({ 
    success: true, 
    data: { 
      used_qty: quantity,
      used_lots: usedLots
    } 
  });
});

// 수불 이력 조회
frozenStockRoutes.get('/transactions', async (c) => {
  await ensureTables(c.env.DB);
  
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  const productName = c.req.query('product_name');
  
  let query = `SELECT * FROM frozen_stock_transactions WHERE 1=1`;
  const params: any[] = [];
  
  if (startDate) {
    query += ` AND trans_date >= ?`;
    params.push(startDate);
  }
  
  if (endDate) {
    query += ` AND trans_date <= ?`;
    params.push(endDate);
  }
  
  if (productName) {
    query += ` AND product_name = ?`;
    params.push(productName);
  }
  
  query += ` ORDER BY trans_date DESC, id DESC`;
  
  const transactions = await c.env.DB.prepare(query).bind(...params).all();
  
  return c.json({ success: true, data: transactions.results });
});

// 일별 수불 리포트
frozenStockRoutes.get('/daily-report', async (c) => {
  await ensureTables(c.env.DB);
  
  const date = c.req.query('date') || new Date().toISOString().split('T')[0];
  
  // 제품별 입출고 집계
  const report = await c.env.DB.prepare(`
    SELECT 
      product_name,
      product_code,
      SUM(CASE WHEN trans_type = '입고' THEN quantity ELSE 0 END) as inbound,
      SUM(CASE WHEN trans_type = '출고' THEN ABS(quantity) ELSE 0 END) as outbound
    FROM frozen_stock_transactions
    WHERE trans_date = ?
    GROUP BY product_name, product_code
    ORDER BY product_name
  `).bind(date).all();
  
  // 현재 재고 조회
  const currentStock = await c.env.DB.prepare(`
    SELECT product_name, SUM(quantity) as stock
    FROM frozen_stock
    WHERE quantity > 0
    GROUP BY product_name
  `).all();
  
  const stockMap = new Map((currentStock.results || []).map((s: any) => [s.product_name, s.stock]));
  
  const data = (report.results || []).map((r: any) => ({
    ...r,
    current_stock: stockMap.get(r.product_name) || 0
  }));
  
  return c.json({ success: true, data });
});

// 냉동재고 직접 수정 (재고조정)
frozenStockRoutes.post('/adjust', async (c) => {
  await ensureTables(c.env.DB);
  
  const body = await c.req.json();
  const { id, quantity, memo } = body;
  
  if (!id) {
    return c.json({ success: false, error: 'ID가 필요합니다.' }, 400);
  }
  
  // 기존 재고 조회
  const stock = await c.env.DB.prepare(`
    SELECT * FROM frozen_stock WHERE id = ?
  `).bind(id).first<any>();
  
  if (!stock) {
    return c.json({ success: false, error: '재고를 찾을 수 없습니다.' }, 404);
  }
  
  const diff = quantity - stock.quantity;
  
  // 재고 수정
  await c.env.DB.prepare(`
    UPDATE frozen_stock SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(quantity, id).run();
  
  // 수불 이력 기록
  await c.env.DB.prepare(`
    INSERT INTO frozen_stock_transactions (trans_date, product_name, product_code, trans_type, quantity, remain_qty, memo)
    VALUES (?, ?, ?, '조정', ?, ?, ?)
  `).bind(
    new Date().toISOString().split('T')[0],
    stock.product_name,
    stock.product_code,
    diff,
    quantity,
    memo || '재고조정'
  ).run();
  
  return c.json({ success: true });
});

// 냉동재고 삭제
frozenStockRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  
  const stock = await c.env.DB.prepare(`
    SELECT * FROM frozen_stock WHERE id = ?
  `).bind(id).first<any>();
  
  if (stock && stock.quantity > 0) {
    // 삭제 이력 기록
    await c.env.DB.prepare(`
      INSERT INTO frozen_stock_transactions (trans_date, product_name, product_code, trans_type, quantity, memo)
      VALUES (?, ?, ?, '삭제', ?, '재고 삭제')
    `).bind(
      new Date().toISOString().split('T')[0],
      stock.product_name,
      stock.product_code,
      -stock.quantity
    ).run();
  }
  
  await c.env.DB.prepare('DELETE FROM frozen_stock WHERE id = ?').bind(id).run();
  
  return c.json({ success: true });
});

export { frozenStockRoutes };
