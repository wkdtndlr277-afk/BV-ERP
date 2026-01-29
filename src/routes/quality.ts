// 품질 KPI 관리 API
import { Hono } from 'hono';
import type { Bindings, QualityKPI } from '../types';

const qualityRoutes = new Hono<{ Bindings: Bindings }>();

// KPI 목록 조회
qualityRoutes.get('/', async (c) => {
  const start_date = c.req.query('start_date');
  const end_date = c.req.query('end_date');
  const kpi_name = c.req.query('kpi_name');
  const judgment = c.req.query('judgment');
  
  let query = 'SELECT * FROM quality_kpi WHERE 1=1';
  const params: any[] = [];
  
  if (start_date) {
    query += ' AND kpi_date >= ?';
    params.push(start_date);
  }
  if (end_date) {
    query += ' AND kpi_date <= ?';
    params.push(end_date);
  }
  if (kpi_name) {
    query += ' AND kpi_name LIKE ?';
    params.push(`%${kpi_name}%`);
  }
  if (judgment) {
    query += ' AND judgment = ?';
    params.push(judgment);
  }
  
  query += ' ORDER BY kpi_date DESC, kpi_name';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// 오늘 KPI 상태
qualityRoutes.get('/today', async (c) => {
  const today = new Date().toISOString().split('T')[0];
  
  const result = await c.env.DB.prepare(`
    SELECT * FROM quality_kpi WHERE kpi_date = ? ORDER BY kpi_name
  `).bind(today).all();
  
  // 부적합 건수
  const nonCompliant = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM quality_kpi WHERE kpi_date = ? AND judgment = '부적합'
  `).bind(today).first<{ count: number }>();
  
  // 미등록 여부 (예상 KPI 항목 기준)
  const expectedItems = ['대장균군', '일반세균', 'CCP온도(발효)', 'CCP온도(굽기)'];
  const registered = result.results?.map((r: any) => r.kpi_name) || [];
  const unregistered = expectedItems.filter(item => !registered.includes(item));
  
  return c.json({ 
    success: true, 
    data: result.results,
    summary: {
      total: result.results?.length || 0,
      nonCompliant: nonCompliant?.count || 0,
      unregistered: unregistered,
      isComplete: unregistered.length === 0
    }
  });
});

// KPI 등록
qualityRoutes.post('/', async (c) => {
  const body = await c.req.json<Partial<QualityKPI>>();
  const { kpi_date, kpi_name, standard_value, measured_value, judgment, pdf_path } = body;
  
  if (!kpi_date || !kpi_name || !judgment) {
    return c.json({ success: false, error: '필수 항목을 입력해주세요.' }, 400);
  }
  
  await c.env.DB.prepare(`
    INSERT INTO quality_kpi (kpi_date, kpi_name, standard_value, measured_value, judgment, pdf_path, registration_status)
    VALUES (?, ?, ?, ?, ?, ?, '수동보정')
  `).bind(kpi_date, kpi_name, standard_value || null, measured_value || null, judgment, pdf_path || null).run();
  
  return c.json({ success: true, message: 'KPI가 등록되었습니다.' });
});

// KPI 일괄 등록 (PDF 업로드 시 추출 데이터)
qualityRoutes.post('/bulk', async (c) => {
  const body = await c.req.json<{ items: Partial<QualityKPI>[] }>();
  const { items } = body;
  
  if (!items || items.length === 0) {
    return c.json({ success: false, error: 'KPI 데이터를 입력해주세요.' }, 400);
  }
  
  let insertedCount = 0;
  for (const item of items) {
    if (!item.kpi_date || !item.kpi_name) continue;
    
    await c.env.DB.prepare(`
      INSERT INTO quality_kpi (kpi_date, kpi_name, standard_value, measured_value, judgment, pdf_path, registration_status)
      VALUES (?, ?, ?, ?, ?, ?, '자동')
    `).bind(
      item.kpi_date, 
      item.kpi_name, 
      item.standard_value || null, 
      item.measured_value || null, 
      item.judgment || '적합', 
      item.pdf_path || null
    ).run();
    insertedCount++;
  }
  
  return c.json({ success: true, message: `${insertedCount}개의 KPI가 등록되었습니다.` });
});

// KPI 수정
qualityRoutes.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<QualityKPI>>();
  const { kpi_name, standard_value, measured_value, judgment } = body;
  
  const result = await c.env.DB.prepare(`
    UPDATE quality_kpi 
    SET kpi_name = COALESCE(?, kpi_name),
        standard_value = COALESCE(?, standard_value),
        measured_value = COALESCE(?, measured_value),
        judgment = COALESCE(?, judgment),
        registration_status = '수동보정',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(kpi_name, standard_value, measured_value, judgment, id).run();
  
  if (result.meta.changes === 0) {
    return c.json({ success: false, error: 'KPI를 찾을 수 없습니다.' }, 404);
  }
  return c.json({ success: true, message: 'KPI가 수정되었습니다.' });
});

// KPI 삭제
qualityRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  
  const result = await c.env.DB.prepare(
    'DELETE FROM quality_kpi WHERE id = ?'
  ).bind(id).run();
  
  if (result.meta.changes === 0) {
    return c.json({ success: false, error: 'KPI를 찾을 수 없습니다.' }, 404);
  }
  return c.json({ success: true, message: 'KPI가 삭제되었습니다.' });
});

// 월별 KPI 요약
qualityRoutes.get('/monthly-summary', async (c) => {
  const year = c.req.query('year') || new Date().getFullYear().toString();
  const month = c.req.query('month') || String(new Date().getMonth() + 1).padStart(2, '0');
  
  const startDate = `${year}-${month}-01`;
  const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];
  
  // 월간 통계
  const stats = await c.env.DB.prepare(`
    SELECT 
      COUNT(*) as total_count,
      SUM(CASE WHEN judgment = '적합' THEN 1 ELSE 0 END) as compliant_count,
      SUM(CASE WHEN judgment = '부적합' THEN 1 ELSE 0 END) as non_compliant_count,
      COUNT(DISTINCT kpi_date) as registered_days
    FROM quality_kpi 
    WHERE kpi_date >= ? AND kpi_date <= ?
  `).bind(startDate, endDate).first();
  
  // 항목별 집계
  const byItem = await c.env.DB.prepare(`
    SELECT 
      kpi_name,
      COUNT(*) as total,
      SUM(CASE WHEN judgment = '적합' THEN 1 ELSE 0 END) as compliant,
      SUM(CASE WHEN judgment = '부적합' THEN 1 ELSE 0 END) as non_compliant
    FROM quality_kpi 
    WHERE kpi_date >= ? AND kpi_date <= ?
    GROUP BY kpi_name
    ORDER BY kpi_name
  `).bind(startDate, endDate).all();
  
  // 월간 일수 계산
  const daysInMonth = new Date(parseInt(year), parseInt(month), 0).getDate();
  const registrationRate = stats ? ((stats.registered_days as number) / daysInMonth * 100).toFixed(1) : 0;
  
  return c.json({ 
    success: true, 
    data: {
      period: { year, month, startDate, endDate, daysInMonth },
      stats: {
        ...stats,
        registrationRate: `${registrationRate}%`
      },
      byItem: byItem.results
    }
  });
});

// KPI 항목 목록 (드롭다운용)
qualityRoutes.get('/items', async (c) => {
  const defaultItems = [
    { name: '대장균군', standard: '음성' },
    { name: '일반세균', standard: '10^5 이하' },
    { name: 'CCP온도(발효)', standard: '27±2℃' },
    { name: 'CCP온도(굽기)', standard: '180±10℃' },
    { name: 'CCP온도(냉각)', standard: '10℃ 이하' },
    { name: '이물검사', standard: '이물없음' },
    { name: '금속검출', standard: '불검출' },
    { name: '클레임', standard: '0건' }
  ];
  
  return c.json({ success: true, data: defaultItems });
});

export default qualityRoutes;
