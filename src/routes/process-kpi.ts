// 공정별 품질 KPI API (미생물 검사와 분리)
import { Hono } from 'hono';
import type { Bindings } from '../types';

const processKpiRoutes = new Hono<{ Bindings: Bindings }>();

// ===========================================
// KPI 마스터 관리
// ===========================================

// KPI 마스터 목록 조회
processKpiRoutes.get('/master', async (c) => {
  const processType = c.req.query('process_type');
  
  let query = 'SELECT * FROM kpi_master WHERE is_active = 1';
  const params: any[] = [];
  
  if (processType) {
    query += ' AND process_type = ?';
    params.push(processType);
  }
  
  query += ' ORDER BY process_type, display_order';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// 공정 유형 목록
processKpiRoutes.get('/process-types', async (c) => {
  const types = [
    { code: '숙성', name: '숙성 공정', description: '저온숙성 → 발효' },
    { code: '성형1', name: '성형1 공정', description: '반죽 → 분할 → 1차발효 → 벤치 → 성형 → 2차발효' },
    { code: '성형2', name: '성형2 공정', description: '반죽 → 분할 → 1차발효 → 발효 → 벤치 → 성형' },
    { code: '오븐', name: '오븐 공정', description: '실온발효 → 쿠프 → 굽기' },
    { code: '공통', name: '공통 항목', description: '작업장 온습도, 냉장/냉동고 온도' }
  ];
  return c.json({ success: true, data: types });
});

// ===========================================
// 숙성 공정 KPI
// ===========================================

// 숙성 KPI 목록 조회
processKpiRoutes.get('/aging', async (c) => {
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  const judgment = c.req.query('judgment');
  
  let query = 'SELECT * FROM kpi_aging WHERE 1=1';
  const params: any[] = [];
  
  if (startDate) {
    query += ' AND record_date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND record_date <= ?';
    params.push(endDate);
  }
  if (judgment) {
    query += ' AND overall_judgment = ?';
    params.push(judgment);
  }
  
  query += ' ORDER BY record_date DESC, record_time DESC';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// 숙성 KPI 등록
processKpiRoutes.post('/aging', async (c) => {
  const body = await c.req.json();
  const {
    record_date, record_time, product_name, batch_no,
    cold_aging_time, ferment_temp, max_temp,
    worker_name, memo
  } = body;
  
  if (!record_date) {
    return c.json({ success: false, error: '기록일자를 입력해주세요.' }, 400);
  }
  
  // 자동 판정
  const coldAgingJudgment = cold_aging_time >= 60 && cold_aging_time <= 120 ? '적합' : '부적합';
  const fermentTempJudgment = ferment_temp >= 25 && ferment_temp <= 29 ? '적합' : '부적합';
  const maxTempJudgment = max_temp <= 30 ? '적합' : '부적합';
  
  const overallJudgment = (coldAgingJudgment === '적합' && fermentTempJudgment === '적합' && maxTempJudgment === '적합') 
    ? '적합' : '부적합';
  
  await c.env.DB.prepare(`
    INSERT INTO kpi_aging (
      record_date, record_time, product_name, batch_no,
      cold_aging_time, cold_aging_judgment,
      ferment_temp, ferment_temp_judgment,
      max_temp, max_temp_judgment,
      overall_judgment, worker_name, memo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    record_date, record_time || null, product_name || null, batch_no || null,
    cold_aging_time || null, coldAgingJudgment,
    ferment_temp || null, fermentTempJudgment,
    max_temp || null, maxTempJudgment,
    overallJudgment, worker_name || null, memo || null
  ).run();
  
  return c.json({ success: true, message: '숙성 공정 KPI가 등록되었습니다.' });
});

// ===========================================
// 성형1 공정 KPI
// ===========================================

processKpiRoutes.get('/forming1', async (c) => {
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  
  let query = 'SELECT * FROM kpi_forming1 WHERE 1=1';
  const params: any[] = [];
  
  if (startDate) {
    query += ' AND record_date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND record_date <= ?';
    params.push(endDate);
  }
  
  query += ' ORDER BY record_date DESC, record_time DESC';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

processKpiRoutes.post('/forming1', async (c) => {
  const body = await c.req.json();
  const {
    record_date, record_time, product_name, batch_no,
    dough_temp, divide_weight, first_ferment_time, ferment_temp,
    bench_time, forming_time, second_ferment_time,
    worker_name, memo
  } = body;
  
  if (!record_date) {
    return c.json({ success: false, error: '기록일자를 입력해주세요.' }, 400);
  }
  
  // 자동 판정
  const doughTempJudgment = dough_temp >= 24 && dough_temp <= 26 ? '적합' : '부적합';
  const firstFermentJudgment = first_ferment_time >= 30 && first_ferment_time <= 60 ? '적합' : '부적합';
  const fermentTempJudgment = ferment_temp >= 25 && ferment_temp <= 29 ? '적합' : '부적합';
  const benchJudgment = bench_time >= 15 && bench_time <= 20 ? '적합' : '부적합';
  const secondFermentJudgment = second_ferment_time >= 40 && second_ferment_time <= 60 ? '적합' : '부적합';
  
  const checks = [doughTempJudgment, firstFermentJudgment, fermentTempJudgment, benchJudgment, secondFermentJudgment];
  const overallJudgment = checks.every(j => j === '적합') ? '적합' : '부적합';
  
  await c.env.DB.prepare(`
    INSERT INTO kpi_forming1 (
      record_date, record_time, product_name, batch_no,
      dough_temp, dough_temp_judgment,
      divide_weight, divide_weight_judgment,
      first_ferment_time, first_ferment_judgment,
      ferment_temp, ferment_temp_judgment,
      bench_time, bench_time_judgment,
      forming_time, forming_time_judgment,
      second_ferment_time, second_ferment_judgment,
      overall_judgment, worker_name, memo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '적합', ?, ?, ?, ?, ?, ?, ?, '적합', ?, ?, ?, ?, ?)
  `).bind(
    record_date, record_time || null, product_name || null, batch_no || null,
    dough_temp || null, doughTempJudgment,
    divide_weight || null,
    first_ferment_time || null, firstFermentJudgment,
    ferment_temp || null, fermentTempJudgment,
    bench_time || null, benchJudgment,
    forming_time || null,
    second_ferment_time || null, secondFermentJudgment,
    overallJudgment, worker_name || null, memo || null
  ).run();
  
  return c.json({ success: true, message: '성형1 공정 KPI가 등록되었습니다.' });
});

// ===========================================
// 성형2 공정 KPI
// ===========================================

processKpiRoutes.get('/forming2', async (c) => {
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  
  let query = 'SELECT * FROM kpi_forming2 WHERE 1=1';
  const params: any[] = [];
  
  if (startDate) {
    query += ' AND record_date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND record_date <= ?';
    params.push(endDate);
  }
  
  query += ' ORDER BY record_date DESC, record_time DESC';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

processKpiRoutes.post('/forming2', async (c) => {
  const body = await c.req.json();
  const {
    record_date, record_time, product_name, batch_no,
    dough_temp, divide_weight, first_ferment_time, ferment_temp,
    bench_time, forming_time,
    worker_name, memo
  } = body;
  
  if (!record_date) {
    return c.json({ success: false, error: '기록일자를 입력해주세요.' }, 400);
  }
  
  // 자동 판정
  const doughTempJudgment = dough_temp >= 24 && dough_temp <= 26 ? '적합' : '부적합';
  const firstFermentJudgment = first_ferment_time >= 30 && first_ferment_time <= 60 ? '적합' : '부적합';
  const fermentTempJudgment = ferment_temp >= 25 && ferment_temp <= 29 ? '적합' : '부적합';
  const benchJudgment = bench_time >= 15 && bench_time <= 20 ? '적합' : '부적합';
  
  const checks = [doughTempJudgment, firstFermentJudgment, fermentTempJudgment, benchJudgment];
  const overallJudgment = checks.every(j => j === '적합') ? '적합' : '부적합';
  
  await c.env.DB.prepare(`
    INSERT INTO kpi_forming2 (
      record_date, record_time, product_name, batch_no,
      dough_temp, dough_temp_judgment,
      divide_weight, divide_weight_judgment,
      first_ferment_time, first_ferment_judgment,
      ferment_temp, ferment_temp_judgment,
      bench_time, bench_time_judgment,
      forming_time, forming_time_judgment,
      overall_judgment, worker_name, memo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '적합', ?, ?, ?, ?, ?, ?, ?, '적합', ?, ?, ?)
  `).bind(
    record_date, record_time || null, product_name || null, batch_no || null,
    dough_temp || null, doughTempJudgment,
    divide_weight || null,
    first_ferment_time || null, firstFermentJudgment,
    ferment_temp || null, fermentTempJudgment,
    bench_time || null, benchJudgment,
    forming_time || null,
    overallJudgment, worker_name || null, memo || null
  ).run();
  
  return c.json({ success: true, message: '성형2 공정 KPI가 등록되었습니다.' });
});

// ===========================================
// 오븐 공정 KPI
// ===========================================

processKpiRoutes.get('/oven', async (c) => {
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  
  let query = 'SELECT * FROM kpi_oven WHERE 1=1';
  const params: any[] = [];
  
  if (startDate) {
    query += ' AND record_date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND record_date <= ?';
    params.push(endDate);
  }
  
  query += ' ORDER BY record_date DESC, record_time DESC';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

processKpiRoutes.post('/oven', async (c) => {
  const body = await c.req.json();
  const {
    record_date, record_time, product_name, batch_no,
    room_ferment_time, coupe_time, oven_temp, baking_time, core_temp,
    worker_name, memo
  } = body;
  
  if (!record_date) {
    return c.json({ success: false, error: '기록일자를 입력해주세요.' }, 400);
  }
  
  // 자동 판정
  const ovenTempJudgment = oven_temp >= 170 && oven_temp <= 190 ? '적합' : '부적합';
  const coreTempJudgment = core_temp >= 74 ? '적합' : '부적합';
  
  const overallJudgment = (ovenTempJudgment === '적합' && coreTempJudgment === '적합') ? '적합' : '부적합';
  
  await c.env.DB.prepare(`
    INSERT INTO kpi_oven (
      record_date, record_time, product_name, batch_no,
      room_ferment_time, room_ferment_judgment,
      coupe_time, coupe_time_judgment,
      oven_temp, oven_temp_judgment,
      baking_time, baking_time_judgment,
      core_temp, core_temp_judgment,
      overall_judgment, worker_name, memo
    ) VALUES (?, ?, ?, ?, ?, '적합', ?, '적합', ?, ?, ?, '적합', ?, ?, ?, ?, ?)
  `).bind(
    record_date, record_time || null, product_name || null, batch_no || null,
    room_ferment_time || null,
    coupe_time || null,
    oven_temp || null, ovenTempJudgment,
    baking_time || null,
    core_temp || null, coreTempJudgment,
    overallJudgment, worker_name || null, memo || null
  ).run();
  
  return c.json({ success: true, message: '오븐 공정 KPI가 등록되었습니다.' });
});

// ===========================================
// 오늘 KPI 현황 (대시보드용)
// ===========================================

processKpiRoutes.get('/today', async (c) => {
  const today = new Date().toISOString().split('T')[0];
  
  // 각 공정별 오늘 데이터 조회
  const [aging, forming1, forming2, oven] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM kpi_aging WHERE record_date = ? ORDER BY record_time DESC').bind(today).all(),
    c.env.DB.prepare('SELECT * FROM kpi_forming1 WHERE record_date = ? ORDER BY record_time DESC').bind(today).all(),
    c.env.DB.prepare('SELECT * FROM kpi_forming2 WHERE record_date = ? ORDER BY record_time DESC').bind(today).all(),
    c.env.DB.prepare('SELECT * FROM kpi_oven WHERE record_date = ? ORDER BY record_time DESC').bind(today).all()
  ]);
  
  // 부적합 건수
  const nonCompliantCount = 
    (aging.results?.filter((r: any) => r.overall_judgment === '부적합').length || 0) +
    (forming1.results?.filter((r: any) => r.overall_judgment === '부적합').length || 0) +
    (forming2.results?.filter((r: any) => r.overall_judgment === '부적합').length || 0) +
    (oven.results?.filter((r: any) => r.overall_judgment === '부적합').length || 0);
  
  const totalCount = 
    (aging.results?.length || 0) +
    (forming1.results?.length || 0) +
    (forming2.results?.length || 0) +
    (oven.results?.length || 0);
  
  return c.json({
    success: true,
    data: {
      date: today,
      aging: aging.results,
      forming1: forming1.results,
      forming2: forming2.results,
      oven: oven.results
    },
    summary: {
      total: totalCount,
      compliant: totalCount - nonCompliantCount,
      nonCompliant: nonCompliantCount,
      byProcess: {
        aging: aging.results?.length || 0,
        forming1: forming1.results?.length || 0,
        forming2: forming2.results?.length || 0,
        oven: oven.results?.length || 0
      }
    }
  });
});

// ===========================================
// 월별 KPI 요약
// ===========================================

processKpiRoutes.get('/monthly-summary', async (c) => {
  const year = c.req.query('year') || new Date().getFullYear().toString();
  const month = c.req.query('month') || String(new Date().getMonth() + 1).padStart(2, '0');
  const processType = c.req.query('process_type');
  
  const startDate = `${year}-${month}-01`;
  const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];
  
  // 공정별 통계 조회
  const getStats = async (tableName: string) => {
    return c.env.DB.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN overall_judgment = '적합' THEN 1 ELSE 0 END) as compliant,
        SUM(CASE WHEN overall_judgment = '부적합' THEN 1 ELSE 0 END) as non_compliant,
        COUNT(DISTINCT record_date) as registered_days
      FROM ${tableName}
      WHERE record_date >= ? AND record_date <= ?
    `).bind(startDate, endDate).first();
  };
  
  let stats: any = {};
  
  if (!processType || processType === '숙성') {
    stats.aging = await getStats('kpi_aging');
  }
  if (!processType || processType === '성형1') {
    stats.forming1 = await getStats('kpi_forming1');
  }
  if (!processType || processType === '성형2') {
    stats.forming2 = await getStats('kpi_forming2');
  }
  if (!processType || processType === '오븐') {
    stats.oven = await getStats('kpi_oven');
  }
  
  // 총합계
  const totalStats = {
    total: Object.values(stats).reduce((sum: number, s: any) => sum + (s?.total || 0), 0),
    compliant: Object.values(stats).reduce((sum: number, s: any) => sum + (s?.compliant || 0), 0),
    nonCompliant: Object.values(stats).reduce((sum: number, s: any) => sum + (s?.non_compliant || 0), 0)
  };
  
  return c.json({
    success: true,
    data: {
      period: { year, month, startDate, endDate },
      byProcess: stats,
      total: totalStats
    }
  });
});

// ===========================================
// KPI 삭제 (공통)
// ===========================================

processKpiRoutes.delete('/:process/:id', async (c) => {
  const process = c.req.param('process');
  const id = c.req.param('id');
  
  const tableMap: { [key: string]: string } = {
    'aging': 'kpi_aging',
    'forming1': 'kpi_forming1',
    'forming2': 'kpi_forming2',
    'oven': 'kpi_oven'
  };
  
  const tableName = tableMap[process];
  if (!tableName) {
    return c.json({ success: false, error: '잘못된 공정 유형입니다.' }, 400);
  }
  
  const result = await c.env.DB.prepare(`DELETE FROM ${tableName} WHERE id = ?`).bind(id).run();
  
  if (result.meta.changes === 0) {
    return c.json({ success: false, error: 'KPI를 찾을 수 없습니다.' }, 404);
  }
  
  return c.json({ success: true, message: 'KPI가 삭제되었습니다.' });
});

export default processKpiRoutes;
