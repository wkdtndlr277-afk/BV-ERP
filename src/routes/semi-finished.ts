import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const semiFinished = new Hono<{ Bindings: Bindings }>()

// ========== 반제품 마스터 관리 ==========

// 반제품 목록 조회
semiFinished.get('/items', async (c) => {
  const { env } = c
  
  try {
    const data = await env.DB.prepare(`
      SELECT sf.*, 
             (SELECT SUM(remain_qty) FROM semi_finished_lots WHERE item_code = sf.item_code AND remain_qty > 0) as total_stock
      FROM semi_finished_items sf
      ORDER BY sf.item_code
    `).all()
    
    return c.json({ success: true, data: data.results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 반제품 단일 조회
semiFinished.get('/items/:code', async (c) => {
  const { env } = c
  const code = c.req.param('code')
  
  try {
    const item = await env.DB.prepare(`
      SELECT * FROM semi_finished_items WHERE item_code = ?
    `).bind(code).first()
    
    if (!item) {
      return c.json({ success: false, message: '반제품을 찾을 수 없습니다' }, 404)
    }
    
    // LOT 목록도 함께 조회
    const lots = await env.DB.prepare(`
      SELECT * FROM semi_finished_lots 
      WHERE item_code = ? AND remain_qty > 0
      ORDER BY expiry_date ASC
    `).bind(code).all()
    
    return c.json({ 
      success: true, 
      data: { 
        ...item, 
        lots: lots.results,
        total_stock: lots.results?.reduce((sum: number, lot: any) => sum + (lot.remain_qty || 0), 0) || 0
      } 
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 반제품 추가
semiFinished.post('/items', async (c) => {
  const { env } = c
  const { item_code, item_name, unit, shelf_life_days, description } = await c.req.json()
  
  if (!item_code || !item_name) {
    return c.json({ success: false, message: '품목코드와 품목명은 필수입니다' }, 400)
  }
  
  try {
    await env.DB.prepare(`
      INSERT INTO semi_finished_items (item_code, item_name, unit, shelf_life_days, description)
      VALUES (?, ?, ?, ?, ?)
    `).bind(item_code, item_name, unit || 'kg', shelf_life_days || 3, description || '').run()
    
    return c.json({ success: true, message: '반제품이 등록되었습니다' })
  } catch (error: any) {
    if (error.message.includes('UNIQUE constraint')) {
      return c.json({ success: false, message: '이미 존재하는 품목코드입니다' }, 400)
    }
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 반제품 수정
semiFinished.put('/items/:code', async (c) => {
  const { env } = c
  const code = c.req.param('code')
  const { item_name, unit, shelf_life_days, description, is_active } = await c.req.json()
  
  try {
    await env.DB.prepare(`
      UPDATE semi_finished_items 
      SET item_name = ?, unit = ?, shelf_life_days = ?, description = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE item_code = ?
    `).bind(item_name, unit || 'kg', shelf_life_days || 3, description || '', is_active !== false ? 1 : 0, code).run()
    
    return c.json({ success: true, message: '반제품이 수정되었습니다' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ========== 반제품 생산 (LOT 생성) ==========

// 반제품 생산 등록 (자동 LOT 생성)
semiFinished.post('/production', async (c) => {
  const { env } = c
  const { item_code, quantity, prod_date, memo, created_by } = await c.req.json()
  
  if (!item_code || !quantity) {
    return c.json({ success: false, message: '품목코드와 수량은 필수입니다' }, 400)
  }
  
  try {
    // 반제품 정보 조회
    const item = await env.DB.prepare(`
      SELECT * FROM semi_finished_items WHERE item_code = ? AND is_active = 1
    `).bind(item_code).first<any>()
    
    if (!item) {
      return c.json({ success: false, message: '반제품을 찾을 수 없습니다' }, 404)
    }
    
    const productionDate = prod_date || new Date().toISOString().split('T')[0]
    const dateStr = productionDate.replace(/-/g, '')
    
    // LOT 번호 생성: YYYYMMDD-SF코드-순번
    const existingLots = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM semi_finished_lots 
      WHERE item_code = ? AND DATE(created_at) = ?
    `).bind(item_code, productionDate).first<any>()
    
    const sequence = String((existingLots?.count || 0) + 1).padStart(3, '0')
    const lotNumber = `${dateStr}-${item_code}-${sequence}`
    
    // 소비기한 계산
    const expiryDate = new Date(productionDate)
    expiryDate.setDate(expiryDate.getDate() + (item.shelf_life_days || 3))
    const expiryDateStr = expiryDate.toISOString().split('T')[0]
    
    // LOT 생성
    const result = await env.DB.prepare(`
      INSERT INTO semi_finished_lots (item_code, lot_number, quantity, remain_qty, unit, prod_date, expiry_date, memo, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      item_code, 
      lotNumber, 
      quantity, 
      quantity, // 초기 잔량 = 생산량
      item.unit || 'kg',
      productionDate,
      expiryDateStr,
      memo || '',
      created_by || ''
    ).run()
    
    return c.json({ 
      success: true, 
      message: '반제품 생산이 등록되었습니다',
      data: {
        lot_id: result.meta.last_row_id,
        lot_number: lotNumber,
        item_code,
        item_name: item.item_name,
        quantity,
        unit: item.unit,
        prod_date: productionDate,
        expiry_date: expiryDateStr
      }
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 반제품 생산 이력 조회
semiFinished.get('/production', async (c) => {
  const { env } = c
  const item_code = c.req.query('item_code')
  const start_date = c.req.query('start_date')
  const end_date = c.req.query('end_date')
  
  try {
    let query = `
      SELECT l.*, s.item_name 
      FROM semi_finished_lots l
      JOIN semi_finished_items s ON l.item_code = s.item_code
      WHERE 1=1
    `
    const params: any[] = []
    
    if (item_code) {
      query += ' AND l.item_code = ?'
      params.push(item_code)
    }
    if (start_date) {
      query += ' AND l.prod_date >= ?'
      params.push(start_date)
    }
    if (end_date) {
      query += ' AND l.prod_date <= ?'
      params.push(end_date)
    }
    
    query += ' ORDER BY l.prod_date DESC, l.id DESC LIMIT 100'
    
    const data = await env.DB.prepare(query).bind(...params).all()
    
    return c.json({ success: true, data: data.results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ========== 반제품 LOT 관리 ==========

// 반제품 LOT 목록 조회 (재고 있는 것만)
semiFinished.get('/lots', async (c) => {
  const { env } = c
  const item_code = c.req.query('item_code')
  const include_empty = c.req.query('include_empty') === 'true'
  
  try {
    let query = `
      SELECT l.*, s.item_name 
      FROM semi_finished_lots l
      JOIN semi_finished_items s ON l.item_code = s.item_code
      WHERE 1=1
    `
    const params: any[] = []
    
    if (item_code) {
      query += ' AND l.item_code = ?'
      params.push(item_code)
    }
    
    if (!include_empty) {
      query += ' AND l.remain_qty > 0'
    }
    
    query += ' ORDER BY l.expiry_date ASC, l.id ASC'
    
    const data = await env.DB.prepare(query).bind(...params).all()
    
    return c.json({ success: true, data: data.results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 반제품 사용 (FEFO 기준 자동 차감)
semiFinished.post('/consume', async (c) => {
  const { env } = c
  const { item_code, quantity, reference_type, reference_id, memo } = await c.req.json()
  
  if (!item_code || !quantity) {
    return c.json({ success: false, message: '품목코드와 수량은 필수입니다' }, 400)
  }
  
  try {
    // FEFO 기준으로 LOT 조회 (소비기한 빠른 순)
    const lots = await env.DB.prepare(`
      SELECT * FROM semi_finished_lots 
      WHERE item_code = ? AND remain_qty > 0
      ORDER BY expiry_date ASC, id ASC
    `).bind(item_code).all<any>()
    
    if (!lots.results || lots.results.length === 0) {
      return c.json({ success: false, message: '사용 가능한 재고가 없습니다' }, 400)
    }
    
    let remainingQty = quantity
    const consumedLots: any[] = []
    
    for (const lot of lots.results) {
      if (remainingQty <= 0) break
      
      const consumeQty = Math.min(lot.remain_qty, remainingQty)
      
      // LOT 잔량 차감
      await env.DB.prepare(`
        UPDATE semi_finished_lots SET remain_qty = remain_qty - ? WHERE id = ?
      `).bind(consumeQty, lot.id).run()
      
      // 사용 이력 기록
      await env.DB.prepare(`
        INSERT INTO semi_finished_transactions (lot_id, item_code, transaction_type, quantity, reference_type, reference_id, memo)
        VALUES (?, ?, 'OUT', ?, ?, ?, ?)
      `).bind(lot.id, item_code, consumeQty, reference_type || '', reference_id || '', memo || '').run()
      
      consumedLots.push({
        lot_number: lot.lot_number,
        consumed_qty: consumeQty,
        remain_qty: lot.remain_qty - consumeQty
      })
      
      remainingQty -= consumeQty
    }
    
    if (remainingQty > 0) {
      return c.json({ 
        success: false, 
        message: `재고 부족: ${remainingQty}${lots.results[0]?.unit || 'kg'} 부족`,
        consumed: consumedLots
      }, 400)
    }
    
    return c.json({ 
      success: true, 
      message: '반제품 사용이 처리되었습니다',
      consumed: consumedLots
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 반제품 재고 현황 조회
semiFinished.get('/stock', async (c) => {
  const { env } = c
  
  try {
    const data = await env.DB.prepare(`
      SELECT 
        s.item_code,
        s.item_name,
        s.unit,
        s.shelf_life_days,
        COALESCE(SUM(l.remain_qty), 0) as total_stock,
        COUNT(CASE WHEN l.remain_qty > 0 THEN 1 END) as lot_count,
        MIN(CASE WHEN l.remain_qty > 0 THEN l.expiry_date END) as nearest_expiry
      FROM semi_finished_items s
      LEFT JOIN semi_finished_lots l ON s.item_code = l.item_code
      WHERE s.is_active = 1
      GROUP BY s.item_code, s.item_name, s.unit, s.shelf_life_days
      ORDER BY s.item_code
    `).all()
    
    return c.json({ success: true, data: data.results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 반제품 거래 이력 조회
semiFinished.get('/transactions', async (c) => {
  const { env } = c
  const item_code = c.req.query('item_code')
  const limit = parseInt(c.req.query('limit') || '50')
  
  try {
    let query = `
      SELECT t.*, l.lot_number, s.item_name
      FROM semi_finished_transactions t
      JOIN semi_finished_lots l ON t.lot_id = l.id
      JOIN semi_finished_items s ON t.item_code = s.item_code
      WHERE 1=1
    `
    const params: any[] = []
    
    if (item_code) {
      query += ' AND t.item_code = ?'
      params.push(item_code)
    }
    
    query += ' ORDER BY t.created_at DESC LIMIT ?'
    params.push(limit)
    
    const data = await env.DB.prepare(query).bind(...params).all()
    
    return c.json({ success: true, data: data.results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ========== 반제품 테이블 마이그레이션 ==========

semiFinished.post('/migrate', async (c) => {
  const { env } = c
  
  try {
    const results: string[] = []
    
    // 1. 반제품 마스터 테이블
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS semi_finished_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_code TEXT UNIQUE NOT NULL,
        item_name TEXT NOT NULL,
        unit TEXT DEFAULT 'kg',
        shelf_life_days INTEGER DEFAULT 3,
        description TEXT,
        old_item_code TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    results.push('semi_finished_items 테이블 생성 완료')
    
    // 2. 반제품 LOT 테이블
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS semi_finished_lots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_code TEXT NOT NULL,
        lot_number TEXT UNIQUE NOT NULL,
        quantity REAL NOT NULL,
        remain_qty REAL NOT NULL,
        unit TEXT DEFAULT 'kg',
        prod_date DATE NOT NULL,
        expiry_date DATE NOT NULL,
        memo TEXT,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (item_code) REFERENCES semi_finished_items(item_code)
      )
    `).run()
    results.push('semi_finished_lots 테이블 생성 완료')
    
    // 3. 반제품 거래 이력 테이블
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS semi_finished_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lot_id INTEGER NOT NULL,
        item_code TEXT NOT NULL,
        transaction_type TEXT NOT NULL CHECK (transaction_type IN ('IN', 'OUT', 'ADJUST')),
        quantity REAL NOT NULL,
        reference_type TEXT,
        reference_id TEXT,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (lot_id) REFERENCES semi_finished_lots(id),
        FOREIGN KEY (item_code) REFERENCES semi_finished_items(item_code)
      )
    `).run()
    results.push('semi_finished_transactions 테이블 생성 완료')
    
    // 인덱스 생성
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sf_lots_item ON semi_finished_lots(item_code)`).run()
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sf_lots_expiry ON semi_finished_lots(expiry_date)`).run()
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sf_trans_item ON semi_finished_transactions(item_code)`).run()
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sf_trans_lot ON semi_finished_transactions(lot_id)`).run()
    results.push('인덱스 생성 완료')
    
    return c.json({ success: true, message: '반제품 테이블 마이그레이션 완료', details: results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// 초기 반제품 데이터 설정
semiFinished.post('/setup-initial', async (c) => {
  const { env } = c
  
  try {
    const results: string[] = []
    
    // 기존 원료 → 반제품 코드 매핑
    const semiFinishedItems = [
      { code: 'SF001', name: '발효종르방', old_code: 'RM146', unit: 'kg', shelf_life: 3 },
      { code: 'SF002', name: '통밀르방', old_code: 'R076', unit: 'kg', shelf_life: 3 },
      { code: 'SF003', name: '폴리쉬', old_code: 'RM136', unit: 'kg', shelf_life: 2 },
      { code: 'SF004', name: '쌀르방', old_code: 'RM155', unit: 'kg', shelf_life: 3 },
      { code: 'SF005', name: '쌀탕종', old_code: 'RM156', unit: 'kg', shelf_life: 2 },
      { code: 'SF006', name: '탕종', old_code: 'RM137', unit: 'kg', shelf_life: 2 },
      { code: 'SF007', name: '통밀탕종', old_code: 'RM149', unit: 'kg', shelf_life: 2 },
      { code: 'SF008', name: '통밀폴리쉬', old_code: 'RM145', unit: 'kg', shelf_life: 2 },
      { code: 'SF009', name: '호밀르방', old_code: 'RM265', unit: 'kg', shelf_life: 3 },
    ]
    
    for (const item of semiFinishedItems) {
      try {
        await env.DB.prepare(`
          INSERT OR REPLACE INTO semi_finished_items (item_code, item_name, unit, shelf_life_days, old_item_code)
          VALUES (?, ?, ?, ?, ?)
        `).bind(item.code, item.name, item.unit, item.shelf_life, item.old_code).run()
        results.push(`${item.code} (${item.name}) 등록 완료`)
      } catch (e: any) {
        results.push(`${item.code} 등록 실패: ${e.message}`)
      }
    }
    
    return c.json({ 
      success: true, 
      message: '반제품 초기 데이터 설정 완료', 
      details: results,
      mapping: semiFinishedItems 
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// BOM에서 기존 코드를 SF 코드로 변경
semiFinished.post('/migrate-bom', async (c) => {
  const { env } = c
  
  try {
    const results: string[] = []
    
    // 매핑 정보
    const mapping = [
      { old: 'RM146', new: 'SF001', name: '발효종르방' },
      { old: 'R076', new: 'SF002', name: '통밀르방' },
      { old: 'RM136', new: 'SF003', name: '폴리쉬' },
      { old: 'RM155', new: 'SF004', name: '쌀르방' },
      { old: 'RM156', new: 'SF005', name: '쌀탕종' },
      { old: 'RM137', new: 'SF006', name: '탕종' },
      { old: 'RM149', new: 'SF007', name: '통밀탕종' },
      { old: 'RM145', new: 'SF008', name: '통밀폴리쉬' },
      { old: 'RM265', new: 'SF009', name: '호밀르방' },
    ]
    
    for (const m of mapping) {
      // bom 테이블 변경
      const bomResult = await env.DB.prepare(`
        UPDATE bom SET item_code = ? WHERE item_code = ?
      `).bind(m.new, m.old).run()
      
      // production_bom 테이블 변경
      const prodBomResult = await env.DB.prepare(`
        UPDATE production_bom SET material_code = ?, material_name = ? WHERE material_code = ?
      `).bind(m.new, m.name, m.old).run()
      
      results.push(`${m.old} → ${m.new}: bom ${bomResult.meta.changes || 0}건, production_bom ${prodBomResult.meta.changes || 0}건`)
    }
    
    return c.json({ 
      success: true, 
      message: 'BOM 코드 변경 완료', 
      details: results 
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

export default semiFinished
