import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

// 미생물 검사 목록 조회
app.get('/', async (c) => {
  const { env } = c
  const { start_date, end_date, product_code, judgment } = c.req.query()
  
  try {
    let query = 'SELECT * FROM Microbial_Test WHERE 1=1'
    const params: any[] = []
    
    if (start_date) {
      query += ' AND test_date >= ?'
      params.push(start_date)
    }
    if (end_date) {
      query += ' AND test_date <= ?'
      params.push(end_date)
    }
    if (product_code) {
      query += ' AND product_code = ?'
      params.push(product_code)
    }
    if (judgment) {
      query += ' AND overall_judgment = ?'
      params.push(judgment)
    }
    
    query += ' ORDER BY test_date DESC, id DESC'
    
    const result = await env.DB.prepare(query).bind(...params).all()
    
    return c.json({ success: true, data: result.results })
  } catch (error) {
    return c.json({ success: false, error: '조회 실패' }, 500)
  }
})

// 일별 리포트
app.get('/daily/:date', async (c) => {
  const { env } = c
  const date = c.req.param('date')
  
  try {
    const data = await env.DB.prepare(`
      SELECT * FROM Microbial_Test WHERE test_date = ? ORDER BY id DESC
    `).bind(date).all()
    
    const summary = await env.DB.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN overall_judgment = '적합' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN overall_judgment = '부적합' THEN 1 ELSE 0 END) as fail
      FROM Microbial_Test WHERE test_date = ?
    `).bind(date).first()
    
    return c.json({ 
      success: true, 
      data: data.results,
      summary: summary
    })
  } catch (error) {
    return c.json({ success: false, error: '조회 실패' }, 500)
  }
})

// 월별 리포트
app.get('/monthly/:year/:month', async (c) => {
  const { env } = c
  const year = c.req.param('year')
  const month = c.req.param('month').padStart(2, '0')
  
  try {
    const startDate = `${year}-${month}-01`
    const endDate = `${year}-${month}-31`
    
    const data = await env.DB.prepare(`
      SELECT * FROM Microbial_Test 
      WHERE test_date >= ? AND test_date <= ?
      ORDER BY test_date DESC, id DESC
    `).bind(startDate, endDate).all()
    
    const summary = await env.DB.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN overall_judgment = '적합' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN overall_judgment = '부적합' THEN 1 ELSE 0 END) as fail
      FROM Microbial_Test 
      WHERE test_date >= ? AND test_date <= ?
    `).bind(startDate, endDate).first()
    
    // 일별 집계
    const dailySummary = await env.DB.prepare(`
      SELECT 
        test_date,
        COUNT(*) as total,
        SUM(CASE WHEN overall_judgment = '적합' THEN 1 ELSE 0 END) as pass,
        SUM(CASE WHEN overall_judgment = '부적합' THEN 1 ELSE 0 END) as fail
      FROM Microbial_Test 
      WHERE test_date >= ? AND test_date <= ?
      GROUP BY test_date
      ORDER BY test_date DESC
    `).bind(startDate, endDate).all()
    
    return c.json({ 
      success: true, 
      data: data.results,
      summary: summary,
      dailySummary: dailySummary.results
    })
  } catch (error) {
    return c.json({ success: false, error: '조회 실패' }, 500)
  }
})

// 미생물 검사 등록
app.post('/', async (c) => {
  const { env } = c
  const body = await c.req.json()
  
  const {
    test_date, product_code, product_name,
    total_bacteria, total_bacteria_standard, total_bacteria_judgment,
    coliform, coliform_standard, coliform_judgment,
    weight_1, weight_2, weight_3, weight_4, weight_5, weight_standard, weight_judgment,
    inspector, memo
  } = body
  
  if (!test_date || !product_code || !product_name) {
    return c.json({ success: false, error: '필수 항목을 입력해주세요' }, 400)
  }
  
  try {
    // 중량 평균 계산
    const weights = [weight_1, weight_2, weight_3, weight_4, weight_5].filter(w => w != null && w !== '')
    const weight_avg = weights.length > 0 
      ? weights.reduce((sum, w) => sum + parseFloat(w), 0) / weights.length 
      : null
    
    // 종합 판정 계산
    const judgments = [total_bacteria_judgment, coliform_judgment, weight_judgment].filter(j => j)
    const overall_judgment = judgments.includes('부적합') ? '부적합' : '적합'
    
    const result = await env.DB.prepare(`
      INSERT INTO Microbial_Test (
        test_date, product_code, product_name,
        total_bacteria, total_bacteria_standard, total_bacteria_judgment,
        coliform, coliform_standard, coliform_judgment,
        weight_1, weight_2, weight_3, weight_4, weight_5, weight_avg, weight_standard, weight_judgment,
        overall_judgment, inspector, memo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      test_date, product_code, product_name,
      total_bacteria || null, total_bacteria_standard || '100,000 이하', total_bacteria_judgment || '적합',
      coliform || null, coliform_standard || '음성', coliform_judgment || '적합',
      weight_1 || null, weight_2 || null, weight_3 || null, weight_4 || null, weight_5 || null,
      weight_avg, weight_standard || null, weight_judgment || '적합',
      overall_judgment, inspector || null, memo || null
    ).run()
    
    return c.json({ 
      success: true, 
      message: '미생물 검사 결과가 등록되었습니다',
      id: result.meta.last_row_id
    })
  } catch (error) {
    return c.json({ success: false, error: '등록 실패' }, 500)
  }
})

// 미생물 검사 수정
app.put('/:id', async (c) => {
  const { env } = c
  const id = c.req.param('id')
  const body = await c.req.json()
  
  const {
    test_date, product_code, product_name,
    total_bacteria, total_bacteria_standard, total_bacteria_judgment,
    coliform, coliform_standard, coliform_judgment,
    weight_1, weight_2, weight_3, weight_4, weight_5, weight_standard, weight_judgment,
    inspector, memo
  } = body
  
  try {
    // 중량 평균 계산
    const weights = [weight_1, weight_2, weight_3, weight_4, weight_5].filter(w => w != null && w !== '')
    const weight_avg = weights.length > 0 
      ? weights.reduce((sum, w) => sum + parseFloat(w), 0) / weights.length 
      : null
    
    // 종합 판정 계산
    const judgments = [total_bacteria_judgment, coliform_judgment, weight_judgment].filter(j => j)
    const overall_judgment = judgments.includes('부적합') ? '부적합' : '적합'
    
    await env.DB.prepare(`
      UPDATE Microbial_Test SET
        test_date = ?, product_code = ?, product_name = ?,
        total_bacteria = ?, total_bacteria_standard = ?, total_bacteria_judgment = ?,
        coliform = ?, coliform_standard = ?, coliform_judgment = ?,
        weight_1 = ?, weight_2 = ?, weight_3 = ?, weight_4 = ?, weight_5 = ?, 
        weight_avg = ?, weight_standard = ?, weight_judgment = ?,
        overall_judgment = ?, inspector = ?, memo = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      test_date, product_code, product_name,
      total_bacteria || null, total_bacteria_standard || '100,000 이하', total_bacteria_judgment || '적합',
      coliform || null, coliform_standard || '음성', coliform_judgment || '적합',
      weight_1 || null, weight_2 || null, weight_3 || null, weight_4 || null, weight_5 || null,
      weight_avg, weight_standard || null, weight_judgment || '적합',
      overall_judgment, inspector || null, memo || null,
      id
    ).run()
    
    return c.json({ success: true, message: '수정되었습니다' })
  } catch (error) {
    return c.json({ success: false, error: '수정 실패' }, 500)
  }
})

// 미생물 검사 삭제
app.delete('/:id', async (c) => {
  const { env } = c
  const id = c.req.param('id')
  
  try {
    await env.DB.prepare('DELETE FROM Microbial_Test WHERE id = ?').bind(id).run()
    return c.json({ success: true, message: '삭제되었습니다' })
  } catch (error) {
    return c.json({ success: false, error: '삭제 실패' }, 500)
  }
})

// 제품 목록 (검사용)
app.get('/products', async (c) => {
  const { env } = c
  
  try {
    const result = await env.DB.prepare(`
      SELECT item_code, item_name FROM master WHERE category = '제품' ORDER BY item_name
    `).all()
    
    return c.json({ success: true, data: result.results })
  } catch (error) {
    return c.json({ success: false, error: '조회 실패' }, 500)
  }
})

export default app
