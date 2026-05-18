// 작업표준서(SOP) API
import { Hono } from 'hono';
import type { Bindings } from '../types';

const workStandardRoutes = new Hono<{ Bindings: Bindings }>();

// 테이블 초기화 (자동 생성)
async function ensureTables(db: D1Database) {
  try {
    await db.prepare('SELECT 1 FROM work_standards LIMIT 1').first();
  } catch (e) {
    // 테이블 생성
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS work_standards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_code TEXT NOT NULL,
        product_name TEXT NOT NULL,
        product_type TEXT,
        version TEXT DEFAULT '1.0',
        effective_date DATE,
        package_spec TEXT,
        process_no TEXT,
        sales_channel TEXT,
        pdf_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT,
        UNIQUE(product_code, version)
      )
    `).run();
    
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS work_standard_ingredients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_standard_id INTEGER NOT NULL,
        seq_no INTEGER,
        category TEXT,
        item_code TEXT,
        item_name TEXT NOT NULL,
        ratio REAL,
        quantity REAL,
        supplier TEXT,
        remarks TEXT,
        FOREIGN KEY (work_standard_id) REFERENCES work_standards(id) ON DELETE CASCADE
      )
    `).run();
    
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS work_standard_processes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_standard_id INTEGER NOT NULL,
        step_no INTEGER NOT NULL,
        process_name TEXT NOT NULL,
        work_method TEXT,
        check_points TEXT,
        equipment TEXT,
        time_standard TEXT,
        temperature TEXT,
        FOREIGN KEY (work_standard_id) REFERENCES work_standards(id) ON DELETE CASCADE
      )
    `).run();
    
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_work_standards_product ON work_standards(product_code)').run();
  }
}

// 제품코드로 작업표준서 조회
workStandardRoutes.get('/product/:code', async (c) => {
  const productCode = c.req.param('code');
  
  try {
    await ensureTables(c.env.DB);
    
    // 작업표준서 기본 정보
    const standard = await c.env.DB.prepare(`
      SELECT * FROM work_standards 
      WHERE product_code = ? 
      ORDER BY version DESC 
      LIMIT 1
    `).bind(productCode).first();
    
    if (!standard) {
      // 작업표준서가 없으면 제품 정보만 반환
      const product = await c.env.DB.prepare(`
        SELECT production_code, production_name, alias1, unit
        FROM production_items 
        WHERE production_code = ?
      `).bind(productCode).first();
      
      return c.json({ 
        success: true, 
        data: null,
        product: product,
        message: '등록된 작업표준서가 없습니다.'
      });
    }
    
    // 원료 배합비 조회
    const ingredients = await c.env.DB.prepare(`
      SELECT * FROM work_standard_ingredients 
      WHERE work_standard_id = ? 
      ORDER BY seq_no
    `).bind(standard.id).all();
    
    // 공정 단계 조회
    const processes = await c.env.DB.prepare(`
      SELECT * FROM work_standard_processes 
      WHERE work_standard_id = ? 
      ORDER BY step_no
    `).bind(standard.id).all();
    
    return c.json({
      success: true,
      data: {
        ...standard,
        ingredients: ingredients.results || [],
        processes: processes.results || []
      }
    });
    
  } catch (error: any) {
    console.error('Work standard query error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 작업표준서 목록 조회
workStandardRoutes.get('/list', async (c) => {
  const search = c.req.query('search') || '';
  
  try {
    await ensureTables(c.env.DB);
    
    let query = `
      SELECT ws.*, 
        (SELECT COUNT(*) FROM work_standard_ingredients WHERE work_standard_id = ws.id) as ingredient_count,
        (SELECT COUNT(*) FROM work_standard_processes WHERE work_standard_id = ws.id) as process_count
      FROM work_standards ws
    `;
    
    if (search) {
      query += ` WHERE ws.product_code LIKE ? OR ws.product_name LIKE ?`;
    }
    query += ` ORDER BY ws.updated_at DESC LIMIT 100`;
    
    const result = search 
      ? await c.env.DB.prepare(query).bind(`%${search}%`, `%${search}%`).all()
      : await c.env.DB.prepare(query).all();
    
    return c.json({
      success: true,
      data: result.results || [],
      count: result.results?.length || 0
    });
    
  } catch (error: any) {
    console.error('Work standard list error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 작업표준서 등록/수정
workStandardRoutes.post('/save', async (c) => {
  try {
    await ensureTables(c.env.DB);
    
    const body = await c.req.json();
    const { 
      id,
      product_code, 
      product_name, 
      product_type,
      version,
      effective_date,
      package_spec,
      process_no,
      sales_channel,
      pdf_url,
      ingredients,
      processes
    } = body;
    
    if (!product_code || !product_name) {
      return c.json({ success: false, error: '제품코드와 제품명은 필수입니다.' }, 400);
    }
    
    let standardId = id;
    
    if (id) {
      // 수정
      await c.env.DB.prepare(`
        UPDATE work_standards SET
          product_name = ?,
          product_type = ?,
          version = ?,
          effective_date = ?,
          package_spec = ?,
          process_no = ?,
          sales_channel = ?,
          pdf_url = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).bind(
        product_name, product_type, version || '1.0', effective_date,
        package_spec, process_no, sales_channel, pdf_url, id
      ).run();
    } else {
      // 신규 등록
      const result = await c.env.DB.prepare(`
        INSERT INTO work_standards 
        (product_code, product_name, product_type, version, effective_date, package_spec, process_no, sales_channel, pdf_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        product_code, product_name, product_type, version || '1.0', effective_date,
        package_spec, process_no, sales_channel, pdf_url
      ).run();
      
      standardId = result.meta.last_row_id;
    }
    
    // 원료 배합비 저장
    if (ingredients && Array.isArray(ingredients)) {
      // 기존 삭제
      await c.env.DB.prepare('DELETE FROM work_standard_ingredients WHERE work_standard_id = ?').bind(standardId).run();
      
      // 새로 입력
      for (let i = 0; i < ingredients.length; i++) {
        const ing = ingredients[i];
        await c.env.DB.prepare(`
          INSERT INTO work_standard_ingredients 
          (work_standard_id, seq_no, category, item_code, item_name, ratio, quantity, supplier, remarks)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          standardId, i + 1, ing.category, ing.item_code, ing.item_name,
          ing.ratio, ing.quantity, ing.supplier, ing.remarks
        ).run();
      }
    }
    
    // 공정 단계 저장
    if (processes && Array.isArray(processes)) {
      // 기존 삭제
      await c.env.DB.prepare('DELETE FROM work_standard_processes WHERE work_standard_id = ?').bind(standardId).run();
      
      // 새로 입력
      for (let i = 0; i < processes.length; i++) {
        const proc = processes[i];
        await c.env.DB.prepare(`
          INSERT INTO work_standard_processes 
          (work_standard_id, step_no, process_name, work_method, check_points, equipment, time_standard, temperature)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          standardId, i + 1, proc.process_name, proc.work_method,
          proc.check_points, proc.equipment, proc.time_standard, proc.temperature
        ).run();
      }
    }
    
    return c.json({
      success: true,
      message: id ? '작업표준서가 수정되었습니다.' : '작업표준서가 등록되었습니다.',
      id: standardId
    });
    
  } catch (error: any) {
    console.error('Work standard save error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 작업표준서 삭제
workStandardRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    await c.env.DB.prepare('DELETE FROM work_standard_ingredients WHERE work_standard_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM work_standard_processes WHERE work_standard_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM work_standards WHERE id = ?').bind(id).run();
    
    return c.json({ success: true, message: '작업표준서가 삭제되었습니다.' });
    
  } catch (error: any) {
    console.error('Work standard delete error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 제품 목록 조회 (작업표준서 등록용)
workStandardRoutes.get('/products', async (c) => {
  const search = c.req.query('search') || '';
  
  try {
    let query = `
      SELECT pi.production_code, pi.production_name, pi.alias1, pi.unit,
        (SELECT COUNT(*) FROM work_standards ws WHERE ws.product_code = pi.production_code) as has_standard
      FROM production_items pi
    `;
    
    if (search) {
      query += ` WHERE pi.production_code LIKE ? OR pi.production_name LIKE ? OR pi.alias1 LIKE ?`;
    }
    query += ` ORDER BY pi.production_name LIMIT 50`;
    
    const result = search 
      ? await c.env.DB.prepare(query).bind(`%${search}%`, `%${search}%`, `%${search}%`).all()
      : await c.env.DB.prepare(query).all();
    
    return c.json({
      success: true,
      data: result.results || []
    });
    
  } catch (error: any) {
    console.error('Products query error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default workStandardRoutes;
