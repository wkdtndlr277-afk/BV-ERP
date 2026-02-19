// 공정별 품질 KPI API (미생물 검사와 분리)
import { Hono } from 'hono';
import type { Bindings } from '../types';

const processKpiRoutes = new Hono<{ Bindings: Bindings }>();

// ===========================================
// KPI 기준 관리 (제품별 기준 설정)
// ===========================================

// KPI 기준 목록 조회
processKpiRoutes.get('/standards', async (c) => {
  const processType = c.req.query('process_type');
  const productName = c.req.query('product_name');
  
  let query = 'SELECT * FROM kpi_standards WHERE is_active = 1';
  const params: any[] = [];
  
  if (processType) {
    query += ' AND process_type = ?';
    params.push(processType);
  }
  if (productName) {
    query += ' AND (product_name = ? OR product_name IS NULL)';
    params.push(productName);
  }
  
  query += ' ORDER BY process_type, product_name NULLS FIRST, display_order';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// 특정 제품의 KPI 기준 조회 (제품 기준 없으면 기본값 반환)
processKpiRoutes.get('/standards/product', async (c) => {
  const processType = c.req.query('process_type');
  const productName = c.req.query('product_name');
  
  if (!processType) {
    return c.json({ success: false, error: '공정 유형을 선택해주세요.' }, 400);
  }
  
  // 제품별 기준이 있으면 가져오고, 없으면 기본값(product_name IS NULL) 사용
  const query = `
    SELECT * FROM kpi_standards 
    WHERE is_active = 1 
      AND process_type = ?
      AND (product_name = ? OR (product_name IS NULL AND kpi_item NOT IN (
        SELECT kpi_item FROM kpi_standards WHERE process_type = ? AND product_name = ? AND is_active = 1
      )))
    ORDER BY display_order
  `;
  
  const result = await c.env.DB.prepare(query)
    .bind(processType, productName || null, processType, productName || null)
    .all();
  
  // 기준을 객체로 변환
  const standards: Record<string, any> = {};
  for (const row of result.results as any[]) {
    standards[row.kpi_item] = {
      min: row.min_value,
      max: row.max_value,
      unit: row.unit,
      label: row.kpi_item_label,
      isCcp: row.is_ccp === 1,
      isRequired: row.is_required === 1
    };
  }
  
  return c.json({ 
    success: true, 
    data: standards,
    productName: productName || '기본',
    processType 
  });
});

// 등록된 제품 목록 조회
processKpiRoutes.get('/standards/products', async (c) => {
  const processType = c.req.query('process_type');
  
  let query = `
    SELECT DISTINCT product_name 
    FROM kpi_standards 
    WHERE is_active = 1 AND product_name IS NOT NULL
  `;
  const params: any[] = [];
  
  if (processType) {
    query += ' AND process_type = ?';
    params.push(processType);
  }
  
  query += ' ORDER BY product_name';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  const products = (result.results as any[]).map(r => r.product_name);
  
  return c.json({ success: true, data: products });
});

// KPI 기준 등록/수정
processKpiRoutes.post('/standards', async (c) => {
  const body = await c.req.json();
  const {
    process_type, product_name, kpi_item, kpi_item_label,
    min_value, max_value, unit, is_ccp, is_required, display_order, memo
  } = body;
  
  if (!process_type || !kpi_item || !kpi_item_label) {
    return c.json({ success: false, error: '필수 항목을 입력해주세요.' }, 400);
  }
  
  // 기존 데이터 확인 (중복 시 업데이트)
  const existing = await c.env.DB.prepare(`
    SELECT id FROM kpi_standards 
    WHERE process_type = ? AND kpi_item = ? AND (product_name = ? OR (product_name IS NULL AND ? IS NULL))
  `).bind(process_type, kpi_item, product_name || null, product_name || null).first();
  
  if (existing) {
    // 업데이트
    await c.env.DB.prepare(`
      UPDATE kpi_standards SET
        kpi_item_label = ?, min_value = ?, max_value = ?, unit = ?,
        is_ccp = ?, is_required = ?, display_order = ?, memo = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      kpi_item_label, min_value ?? null, max_value ?? null, unit || null,
      is_ccp ? 1 : 0, is_required ? 1 : 0, display_order || 0, memo || null,
      (existing as any).id
    ).run();
    
    return c.json({ success: true, message: 'KPI 기준이 수정되었습니다.' });
  } else {
    // 신규 등록
    await c.env.DB.prepare(`
      INSERT INTO kpi_standards (
        process_type, product_name, kpi_item, kpi_item_label,
        min_value, max_value, unit, is_ccp, is_required, display_order, memo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      process_type, product_name || null, kpi_item, kpi_item_label,
      min_value ?? null, max_value ?? null, unit || null,
      is_ccp ? 1 : 0, is_required ? 1 : 0, display_order || 0, memo || null
    ).run();
    
    return c.json({ success: true, message: 'KPI 기준이 등록되었습니다.' });
  }
});

// KPI 기준 일괄 등록 (제품 복사)
processKpiRoutes.post('/standards/copy', async (c) => {
  const body = await c.req.json();
  const { from_product, to_product, process_type } = body;
  
  if (!to_product) {
    return c.json({ success: false, error: '새 제품명을 입력해주세요.' }, 400);
  }
  
  // 기존 기준 조회 (from_product가 null이면 기본값에서 복사)
  let query = `
    SELECT process_type, kpi_item, kpi_item_label, min_value, max_value, 
           unit, is_ccp, is_required, display_order
    FROM kpi_standards 
    WHERE is_active = 1
  `;
  const params: any[] = [];
  
  if (from_product) {
    query += ' AND product_name = ?';
    params.push(from_product);
  } else {
    query += ' AND product_name IS NULL';
  }
  
  if (process_type) {
    query += ' AND process_type = ?';
    params.push(process_type);
  }
  
  const source = await c.env.DB.prepare(query).bind(...params).all();
  
  if (source.results.length === 0) {
    return c.json({ success: false, error: '복사할 기준이 없습니다.' }, 400);
  }
  
  // 새 제품으로 복사
  let inserted = 0;
  for (const row of source.results as any[]) {
    await c.env.DB.prepare(`
      INSERT OR REPLACE INTO kpi_standards (
        process_type, product_name, kpi_item, kpi_item_label,
        min_value, max_value, unit, is_ccp, is_required, display_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      row.process_type, to_product, row.kpi_item, row.kpi_item_label,
      row.min_value, row.max_value, row.unit, row.is_ccp, row.is_required, row.display_order
    ).run();
    inserted++;
  }
  
  return c.json({ 
    success: true, 
    message: `${to_product} 제품의 KPI 기준이 생성되었습니다.`,
    count: inserted 
  });
});

// KPI 기준 삭제
processKpiRoutes.delete('/standards/:id', async (c) => {
  const id = c.req.param('id');
  
  await c.env.DB.prepare('UPDATE kpi_standards SET is_active = 0 WHERE id = ?').bind(id).run();
  
  return c.json({ success: true, message: 'KPI 기준이 삭제되었습니다.' });
});

// 제품의 모든 KPI 기준 삭제
processKpiRoutes.delete('/standards/product/:productName', async (c) => {
  const productName = c.req.param('productName');
  
  await c.env.DB.prepare('UPDATE kpi_standards SET is_active = 0 WHERE product_name = ?')
    .bind(productName).run();
  
  return c.json({ success: true, message: `${productName} 제품의 KPI 기준이 삭제되었습니다.` });
});

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

// 제품별 KPI 기준 조회 헬퍼 함수
async function getProductStandards(db: any, processType: string, productName: string | null) {
  const query = `
    SELECT kpi_item, min_value, max_value FROM kpi_standards 
    WHERE is_active = 1 AND process_type = ?
      AND (product_name = ? OR (product_name IS NULL AND kpi_item NOT IN (
        SELECT kpi_item FROM kpi_standards WHERE process_type = ? AND product_name = ? AND is_active = 1
      )))
  `;
  const result = await db.prepare(query)
    .bind(processType, productName || null, processType, productName || null)
    .all();
  
  const standards: Record<string, { min: number | null, max: number | null }> = {};
  for (const row of result.results as any[]) {
    standards[row.kpi_item] = { min: row.min_value, max: row.max_value };
  }
  return standards;
}

// 기준에 따른 판정 헬퍼 함수
function judgeValue(value: number | null, min: number | null, max: number | null): string {
  if (value === null || value === undefined) return '적합';
  const minOk = min === null || value >= min;
  const maxOk = max === null || value <= max;
  return (minOk && maxOk) ? '적합' : '부적합';
}

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
  
  // 제품별 기준 조회
  const standards = await getProductStandards(c.env.DB, '숙성', product_name);
  
  // 기준이 없으면 null로 설정 (판정하지 않음)
  const coldAgingStd = standards['cold_aging_time'] || { min: null, max: null };
  const fermentTempStd = standards['ferment_temp'] || { min: null, max: null };
  const maxTempStd = standards['max_temp'] || { min: null, max: null };
  
  // 자동 판정 (제품별 기준 적용)
  const coldAgingJudgment = judgeValue(cold_aging_time, coldAgingStd.min, coldAgingStd.max);
  const fermentTempJudgment = judgeValue(ferment_temp, fermentTempStd.min, fermentTempStd.max);
  const maxTempJudgment = judgeValue(max_temp, maxTempStd.min, maxTempStd.max);
  
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
  
  // 제품별 기준 조회
  const standards = await getProductStandards(c.env.DB, '성형1', product_name);
  
  // 자동 판정 (제품별 기준 적용, 기준 없으면 판정하지 않음)
  const doughTempStd = standards['dough_temp'] || { min: null, max: null };
  const firstFermentStd = standards['first_ferment_time'] || { min: null, max: null };
  const fermentTempStd = standards['ferment_temp'] || { min: null, max: null };
  const benchStd = standards['bench_time'] || { min: null, max: null };
  const secondFermentStd = standards['second_ferment_time'] || { min: null, max: null };
  
  const doughTempJudgment = judgeValue(dough_temp, doughTempStd.min, doughTempStd.max);
  const firstFermentJudgment = judgeValue(first_ferment_time, firstFermentStd.min, firstFermentStd.max);
  const fermentTempJudgment = judgeValue(ferment_temp, fermentTempStd.min, fermentTempStd.max);
  const benchJudgment = judgeValue(bench_time, benchStd.min, benchStd.max);
  const secondFermentJudgment = judgeValue(second_ferment_time, secondFermentStd.min, secondFermentStd.max);
  
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
  
  // 제품별 기준 조회
  const standards = await getProductStandards(c.env.DB, '성형2', product_name);
  
  // 자동 판정 (제품별 기준 적용, 기준 없으면 판정하지 않음)
  const doughTempStd = standards['dough_temp'] || { min: null, max: null };
  const firstFermentStd = standards['first_ferment_time'] || { min: null, max: null };
  const fermentTempStd = standards['ferment_temp'] || { min: null, max: null };
  const benchStd = standards['bench_time'] || { min: null, max: null };
  
  const doughTempJudgment = judgeValue(dough_temp, doughTempStd.min, doughTempStd.max);
  const firstFermentJudgment = judgeValue(first_ferment_time, firstFermentStd.min, firstFermentStd.max);
  const fermentTempJudgment = judgeValue(ferment_temp, fermentTempStd.min, fermentTempStd.max);
  const benchJudgment = judgeValue(bench_time, benchStd.min, benchStd.max);
  
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
  
  // 제품별 기준 조회
  const standards = await getProductStandards(c.env.DB, '오븐', product_name);
  
  // 자동 판정 (제품별 기준 적용, 기준 없으면 판정하지 않음)
  const ovenTempStd = standards['oven_temp'] || { min: null, max: null };
  const coreTempStd = standards['core_temp'] || { min: null, max: null };
  
  const ovenTempJudgment = judgeValue(oven_temp, ovenTempStd.min, ovenTempStd.max);
  const coreTempJudgment = judgeValue(core_temp, coreTempStd.min, coreTempStd.max);
  
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
  const month = c.req.query('month') || String(new Date().getMonth() + 1);
  const processType = c.req.query('process_type');
  
  // 월을 2자리로 패딩
  const paddedMonth = month.padStart(2, '0');
  const startDate = `${year}-${paddedMonth}-01`;
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
