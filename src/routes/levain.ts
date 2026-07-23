// ★★★ v3.6.125: 르방 숙성 모니터링 API (반제품검사일지) ★★★
import { Hono } from 'hono';
import type { Bindings } from '../types';

const levainRoutes = new Hono<{ Bindings: Bindings }>();

// KST 날짜 헬퍼
function getKSTDate(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  return kst.toISOString().split('T')[0];
}

// 반제품검사일지 테이블 생성
async function ensureLevainTable(db: D1Database) {
  // D1은 prepare().run()을 사용해야 함 (exec()는 제한적)
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS levain_inspection (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inspection_date TEXT NOT NULL,
      product_name TEXT NOT NULL,
      prod_date TEXT NOT NULL,
      fridge_temp REAL,
      levain_temp REAL,
      sensory_test TEXT,
      ph_value REAL,
      elapsed_days INTEGER,
      judgment TEXT DEFAULT '적합',
      inspector TEXT,
      remarks TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  
  // 인덱스 생성 (각각 별도 실행)
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_levain_inspection_date ON levain_inspection(inspection_date)`).run();
  } catch (e) { /* 이미 존재하면 무시 */ }
  
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_levain_product ON levain_inspection(product_name)`).run();
  } catch (e) { /* 이미 존재하면 무시 */ }
}

// 반제품검사일지 목록 조회
levainRoutes.get('/inspections', async (c) => {
  try {
    await ensureLevainTable(c.env.DB);
    
    const start_date = c.req.query('start_date');
    const end_date = c.req.query('end_date');
    const product_name = c.req.query('product_name');
    
    let query = `
      SELECT * FROM levain_inspection
      WHERE 1=1
    `;
    const params: any[] = [];
    
    if (start_date) {
      query += ' AND inspection_date >= ?';
      params.push(start_date);
    }
    if (end_date) {
      query += ' AND inspection_date <= ?';
      params.push(end_date);
    }
    if (product_name) {
      query += ' AND product_name = ?';
      params.push(product_name);
    }
    
    query += ' ORDER BY inspection_date DESC, product_name, elapsed_days';
    
    const result = await c.env.DB.prepare(query).bind(...params).all();
    
    return c.json({ 
      success: true, 
      data: result.results || [],
      count: result.results?.length || 0
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 특정 제품의 경과일별 데이터 (차트용)
levainRoutes.get('/chart-data', async (c) => {
  try {
    await ensureLevainTable(c.env.DB);
    
    const product_name = c.req.query('product_name');
    const prod_date = c.req.query('prod_date');
    
    if (!product_name || !prod_date) {
      return c.json({ success: false, error: '제품명과 제조일은 필수입니다.' }, 400);
    }
    
    const result = await c.env.DB.prepare(`
      SELECT 
        elapsed_days,
        ph_value,
        levain_temp,
        fridge_temp,
        sensory_test,
        judgment,
        inspection_date
      FROM levain_inspection
      WHERE product_name = ? AND prod_date = ?
      ORDER BY elapsed_days ASC
    `).bind(product_name, prod_date).all();
    
    return c.json({ 
      success: true, 
      data: result.results || [],
      product_name,
      prod_date
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 반제품검사일지 등록
levainRoutes.post('/inspections', async (c) => {
  try {
    await ensureLevainTable(c.env.DB);
    
    const body = await c.req.json();
    const {
      inspection_date,
      product_name,
      prod_date,
      fridge_temp,
      levain_temp,
      sensory_test,
      ph_value,
      elapsed_days,
      judgment,
      inspector,
      remarks
    } = body;
    
    if (!inspection_date || !product_name || !prod_date) {
      return c.json({ success: false, error: '검사일, 제품명, 제조일은 필수입니다.' }, 400);
    }
    
    // pH 또는 온도 기준 벗어나면 자동 '부적합' 판정
    let autoJudgment = judgment || '적합';
    const phVal = parseFloat(ph_value);
    const tempVal = parseFloat(levain_temp);
    const fridgeVal = parseFloat(fridge_temp);
    
    // pH 기준: 3.0 ~ 6.0
    if (!isNaN(phVal) && (phVal < 3.0 || phVal > 6.0)) {
      autoJudgment = '부적합';
    }
    // 냉장실 온도 기준: -5 ~ 10°C
    if (!isNaN(fridgeVal) && (fridgeVal < -5 || fridgeVal > 10)) {
      autoJudgment = '부적합';
    }
    
    const result = await c.env.DB.prepare(`
      INSERT INTO levain_inspection 
      (inspection_date, product_name, prod_date, fridge_temp, levain_temp, 
       sensory_test, ph_value, elapsed_days, judgment, inspector, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      inspection_date,
      product_name,
      prod_date,
      fridge_temp || null,
      levain_temp || null,
      sensory_test || null,
      ph_value || null,
      elapsed_days || 1,
      autoJudgment,
      inspector || null,
      remarks || null
    ).run();
    
    return c.json({ 
      success: true, 
      id: result.meta.last_row_id,
      judgment: autoJudgment
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 반제품검사일지 일괄 등록 (엑셀 데이터용)
levainRoutes.post('/inspections/bulk', async (c) => {
  try {
    await ensureLevainTable(c.env.DB);
    
    const { data } = await c.req.json();
    
    if (!Array.isArray(data) || data.length === 0) {
      return c.json({ success: false, error: '등록할 데이터가 없습니다.' }, 400);
    }
    
    let insertedCount = 0;
    let failedCount = 0;
    
    for (const row of data) {
      try {
        // pH 또는 온도 기준 벗어나면 자동 '부적합' 판정
        let autoJudgment = row.judgment || '적합';
        const phVal = parseFloat(row.ph_value);
        const fridgeVal = parseFloat(row.fridge_temp);
        
        if (!isNaN(phVal) && (phVal < 3.0 || phVal > 6.0)) {
          autoJudgment = '부적합';
        }
        if (!isNaN(fridgeVal) && (fridgeVal < -5 || fridgeVal > 10)) {
          autoJudgment = '부적합';
        }
        
        await c.env.DB.prepare(`
          INSERT INTO levain_inspection 
          (inspection_date, product_name, prod_date, fridge_temp, levain_temp, 
           sensory_test, ph_value, elapsed_days, judgment, inspector, remarks)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          row.inspection_date,
          row.product_name,
          row.prod_date,
          row.fridge_temp || null,
          row.levain_temp || null,
          row.sensory_test || null,
          row.ph_value || null,
          row.elapsed_days || 1,
          autoJudgment,
          row.inspector || null,
          row.remarks || null
        ).run();
        
        insertedCount++;
      } catch (e) {
        failedCount++;
      }
    }
    
    return c.json({ 
      success: true, 
      inserted: insertedCount,
      failed: failedCount
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 반제품검사일지 수정
levainRoutes.put('/inspections/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    
    const {
      inspection_date,
      product_name,
      prod_date,
      fridge_temp,
      levain_temp,
      sensory_test,
      ph_value,
      elapsed_days,
      judgment,
      inspector,
      remarks
    } = body;
    
    // 자동 판정
    let autoJudgment = judgment || '적합';
    const phVal = parseFloat(ph_value);
    const fridgeVal = parseFloat(fridge_temp);
    
    if (!isNaN(phVal) && (phVal < 3.0 || phVal > 6.0)) {
      autoJudgment = '부적합';
    }
    if (!isNaN(fridgeVal) && (fridgeVal < -5 || fridgeVal > 10)) {
      autoJudgment = '부적합';
    }
    
    await c.env.DB.prepare(`
      UPDATE levain_inspection SET
        inspection_date = ?,
        product_name = ?,
        prod_date = ?,
        fridge_temp = ?,
        levain_temp = ?,
        sensory_test = ?,
        ph_value = ?,
        elapsed_days = ?,
        judgment = ?,
        inspector = ?,
        remarks = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      inspection_date,
      product_name,
      prod_date,
      fridge_temp || null,
      levain_temp || null,
      sensory_test || null,
      ph_value || null,
      elapsed_days || 1,
      autoJudgment,
      inspector || null,
      remarks || null,
      id
    ).run();
    
    return c.json({ success: true, id, judgment: autoJudgment });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 반제품검사일지 삭제
levainRoutes.delete('/inspections/:id', async (c) => {
  try {
    const id = c.req.param('id');
    
    await c.env.DB.prepare(`
      DELETE FROM levain_inspection WHERE id = ?
    `).bind(id).run();
    
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 제품 목록 (드롭다운용)
levainRoutes.get('/products', async (c) => {
  try {
    await ensureLevainTable(c.env.DB);
    
    const result = await c.env.DB.prepare(`
      SELECT DISTINCT product_name 
      FROM levain_inspection 
      ORDER BY product_name
    `).all();
    
    // 기본 제품 목록 추가
    const defaultProducts = [
      '호밀 르방', '독일 풀리쉬', '호밀 통밀', '통밀 르방',
      '독일 통밀', '통밀 또띠아', 'RT호밀 M/S87', '소금 호밀',
      '얇고등 통밀', '사고농 호밀', '통밀 호밀'
    ];
    
    const existingProducts = (result.results || []).map((r: any) => r.product_name);
    const allProducts = [...new Set([...defaultProducts, ...existingProducts])].sort();
    
    return c.json({ 
      success: true, 
      data: allProducts
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// HACCP 출력용 데이터 (월별 일지)
levainRoutes.get('/haccp-report', async (c) => {
  try {
    await ensureLevainTable(c.env.DB);
    
    const year = c.req.query('year') || new Date().getFullYear().toString();
    const month = c.req.query('month') || (new Date().getMonth() + 1).toString().padStart(2, '0');
    
    const startDate = `${year}-${month}-01`;
    const endDate = `${year}-${month}-31`;
    
    const result = await c.env.DB.prepare(`
      SELECT * FROM levain_inspection
      WHERE inspection_date >= ? AND inspection_date <= ?
      ORDER BY inspection_date, product_name, elapsed_days
    `).bind(startDate, endDate).all();
    
    // 요약 통계
    const data = result.results || [];
    const summary = {
      total_inspections: data.length,
      passed: data.filter((d: any) => d.judgment === '적합').length,
      failed: data.filter((d: any) => d.judgment === '부적합').length,
      products: [...new Set(data.map((d: any) => d.product_name))],
      avg_ph: data.filter((d: any) => d.ph_value).reduce((sum: number, d: any) => sum + (d.ph_value || 0), 0) / (data.filter((d: any) => d.ph_value).length || 1),
      avg_fridge_temp: data.filter((d: any) => d.fridge_temp).reduce((sum: number, d: any) => sum + (d.fridge_temp || 0), 0) / (data.filter((d: any) => d.fridge_temp).length || 1)
    };
    
    return c.json({ 
      success: true, 
      data,
      summary,
      period: `${year}년 ${month}월`
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 예시 데이터 생성 (이미지 기반)
levainRoutes.post('/seed-sample', async (c) => {
  try {
    await ensureLevainTable(c.env.DB);
    
    // 이미지에서 추출한 예시 데이터
    const sampleData = [
      { inspection_date: '2026-07-03', product_name: '호밀 르방', prod_date: '2026-07-09', fridge_temp: 9.9, levain_temp: null, sensory_test: '적합/부적합', ph_value: 13.32, elapsed_days: 3, judgment: '적합', inspector: '박가영' },
      { inspection_date: '2026-07-03', product_name: '독일 풀리쉬', prod_date: '2026-07-09', fridge_temp: 9.5, levain_temp: 0, sensory_test: '적합/부적합', ph_value: 10.92, elapsed_days: 5, judgment: '적합', inspector: '박가영' },
      { inspection_date: '2026-07-04', product_name: '호밀 통밀', prod_date: '2026-07-09', fridge_temp: 3.9, levain_temp: 0, sensory_test: '적합/부적합', ph_value: 10.82, elapsed_days: 5, judgment: '적합', inspector: '박가영' },
      { inspection_date: '2026-07-04', product_name: '통밀 르방', prod_date: '2026-07-09', fridge_temp: 5.5, levain_temp: 0, sensory_test: '적합/부적합', ph_value: 9.5, elapsed_days: 5, judgment: '적합', inspector: '박가영' },
      { inspection_date: '2026-07-10', product_name: '독일 통밀', prod_date: '2026-07-09', fridge_temp: 6.6, levain_temp: null, sensory_test: '적합/부적합', ph_value: 15.5, elapsed_days: 5, judgment: '적합', inspector: '박가영' },
      { inspection_date: '2026-07-10', product_name: '통밀 또띠아', prod_date: '2026-07-09', fridge_temp: 5.9, levain_temp: 0, sensory_test: '적합/부적합', ph_value: 6.4, elapsed_days: null, judgment: '적합', inspector: '박가영' },
      { inspection_date: '2026-07-10', product_name: '독일 통밀', prod_date: '2026-07-12', fridge_temp: 5.5, levain_temp: 0, sensory_test: '적합/부적합', ph_value: 11.5, elapsed_days: 5, judgment: '적합', inspector: '박가영' },
      { inspection_date: '2026-07-10', product_name: '통밀 호밀', prod_date: '2026-07-12', fridge_temp: 5.5, levain_temp: 0, sensory_test: '적합/부적합', ph_value: 9.52, elapsed_days: null, judgment: '적합', inspector: '박가영' },
      { inspection_date: '2026-07-13', product_name: 'RT호밀 M/S87 (호밀 또띠아)', prod_date: '2026-07-12', fridge_temp: 5.5, levain_temp: 0, sensory_test: '적합/부적합', ph_value: 9.52, elapsed_days: null, judgment: '적합', inspector: '박가영' },
      { inspection_date: '2026-07-14', product_name: '독일 풀리쉬', prod_date: '2026-07-13', fridge_temp: 5.0, levain_temp: null, sensory_test: '적합/부적합', ph_value: 9.5, elapsed_days: 5, judgment: '적합', inspector: '박가영' },
      { inspection_date: '2026-07-20', product_name: '소금 호밀', prod_date: '2026-07-13', fridge_temp: 5.9, levain_temp: 0, sensory_test: '적합/부적합', ph_value: null, elapsed_days: null, judgment: '적합', inspector: '박가영' },
      { inspection_date: '2026-07-20', product_name: '얇고등 통밀', prod_date: '2026-07-14', fridge_temp: 3.4, levain_temp: 0, sensory_test: '적합/부적합', ph_value: 9.12, elapsed_days: 3, judgment: '적합', inspector: '박가영' },
      { inspection_date: '2026-07-20', product_name: '사고농 호밀', prod_date: '2026-07-14', fridge_temp: 3.5, levain_temp: 0, sensory_test: '적합/부적합', ph_value: 6.82, elapsed_days: 6, judgment: '적합', inspector: '박가영' },
      { inspection_date: '2026-07-20', product_name: '통밀 호밀', prod_date: null, fridge_temp: null, levain_temp: null, sensory_test: '적합/부적합', ph_value: null, elapsed_days: null, judgment: '적합', inspector: '박지수' }
    ];
    
    let inserted = 0;
    for (const row of sampleData) {
      try {
        await c.env.DB.prepare(`
          INSERT INTO levain_inspection 
          (inspection_date, product_name, prod_date, fridge_temp, levain_temp, 
           sensory_test, ph_value, elapsed_days, judgment, inspector, remarks)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          row.inspection_date,
          row.product_name,
          row.prod_date,
          row.fridge_temp,
          row.levain_temp,
          row.sensory_test,
          row.ph_value,
          row.elapsed_days,
          row.judgment,
          row.inspector,
          null
        ).run();
        inserted++;
      } catch (e) {
        // 중복 무시
      }
    }
    
    return c.json({ success: true, inserted });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default levainRoutes;
