// 입고 관리 API (FEFO 기반 LOT 관리)
import { Hono } from 'hono';
import type { Bindings, Inbound, InboundRequest } from '../types';
import { GoogleSheetsService } from '../services/GoogleSheetsService';

const inboundRoutes = new Hono<{ Bindings: Bindings }>();

// 구글시트 서비스 인스턴스 생성 헬퍼
function getSheetService(c: any): GoogleSheetsService | null {
  const clientEmail = c.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = c.env.GOOGLE_PRIVATE_KEY;
  
  if (!clientEmail || !privateKey) {
    return null;
  }
  
  const formattedKey = privateKey.replace(/\\n/g, '\n');
  return new GoogleSheetsService(clientEmail, formattedKey);
}

// LOT 번호 생성 함수 (YYYYMMDD-품목코드-순번)
function generateLotNumber(itemCode: string, date: string, sequence: number): string {
  const dateStr = date.replace(/-/g, '');
  return `${dateStr}-${itemCode}-${String(sequence).padStart(3, '0')}`;
}

// 디버그: inbound 테이블 구조 확인
inboundRoutes.get('/debug-table', async (c) => {
  const tableInfo = await c.env.DB.prepare("PRAGMA table_info(inbound)").all();
  const sampleData = await c.env.DB.prepare("SELECT * FROM inbound LIMIT 3").all();
  const recentData = await c.env.DB.prepare("SELECT * FROM inbound ORDER BY rowid DESC LIMIT 5").all();
  const nullIdCount = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM inbound WHERE id IS NULL").first();
  return c.json({ 
    success: true, 
    columns: tableInfo.results,
    sample: sampleData.results,
    recent: recentData.results,
    nullIdCount: nullIdCount
  });
});

// 입고 일별/월별/기간 조회 (통계 포함)
inboundRoutes.get('/query', async (c) => {
  const view_type = c.req.query('view_type') || 'daily'; // daily, monthly, range
  const date = c.req.query('date'); // YYYY-MM-DD (daily) or YYYY-MM (monthly)
  const start_date = c.req.query('start_date'); // 기간 조회용 시작일
  const end_date = c.req.query('end_date'); // 기간 조회용 종료일
  const item_code = c.req.query('item_code');
  const supplier = c.req.query('supplier');
  const category = c.req.query('category'); // 원료, 부자재, 전체
  const item_search = c.req.query('item_search'); // 품목명/코드 검색
  const is_sample = c.req.query('is_sample'); // 샘플 필터 (0, 1, 'all')
  const is_sanitary = c.req.query('is_sanitary'); // 위생자재 필터 (0, 1, 'all')
  
  let dateFilter = '';
  const params: any[] = [];
  
  if (view_type === 'range' && start_date && end_date) {
    // 기간 조회: 시작일 ~ 종료일
    dateFilter = 'AND i.inbound_date >= ? AND i.inbound_date <= ?';
    params.push(start_date);
    params.push(end_date);
  } else if (view_type === 'daily' && date) {
    dateFilter = 'AND i.inbound_date = ?';
    params.push(date);
  } else if (view_type === 'monthly' && date) {
    dateFilter = 'AND i.inbound_date LIKE ?';
    params.push(date + '%');
  }
  
  if (item_code) {
    dateFilter += ' AND i.item_code = ?';
    params.push(item_code);
  }
  
  if (item_search) {
    dateFilter += ' AND (m.item_name LIKE ? OR m.item_code LIKE ?)';
    params.push('%' + item_search + '%');
    params.push('%' + item_search + '%');
  }
  
  if (supplier) {
    dateFilter += ' AND i.supplier LIKE ?';
    params.push('%' + supplier + '%');
  }
  
  if (category && category !== '전체') {
    if (category === '부자재') {
      // 부자재: master에 없고 supplies에 있는 품목
      dateFilter += ' AND m.item_code IS NULL AND s.item_code IS NOT NULL';
    } else {
      // 원료/제품: master 테이블에서 카테고리 필터
      dateFilter += ' AND m.category = ?';
      params.push(category);
    }
  }
  
  // 샘플/위생자재 필터 - 컬럼 존재 여부 먼저 확인
  let hasSampleColumn = false;
  let hasSanitaryColumn = false;
  try {
    const tableInfo = await c.env.DB.prepare("PRAGMA table_info(inbound)").all();
    hasSampleColumn = (tableInfo.results || []).some((col: any) => col.name === 'is_sample');
    hasSanitaryColumn = (tableInfo.results || []).some((col: any) => col.name === 'is_sanitary');
  } catch (e) {
    hasSampleColumn = false;
    hasSanitaryColumn = false;
  }
  
  // 샘플만 조회 요청인데 컬럼이 없으면 즉시 빈 결과 반환
  if (is_sample === '1' && !hasSampleColumn) {
    return c.json({ 
      success: true, 
      data: {
        details: [],
        summary: view_type === 'daily' ? {} : [],
        itemSummary: [],
        supplierSummary: [],
        view_type,
        date,
        notice: '샘플 관리 기능이 아직 활성화되지 않았습니다.'
      }
    });
  }
  
  // 위생자재만 조회 요청인데 컬럼이 없으면 즉시 빈 결과 반환
  if (is_sanitary === '1' && !hasSanitaryColumn) {
    return c.json({ 
      success: true, 
      data: {
        details: [],
        summary: view_type === 'daily' ? {} : [],
        itemSummary: [],
        supplierSummary: [],
        view_type,
        date,
        notice: '위생자재 관리 기능이 아직 활성화되지 않았습니다.'
      }
    });
  }
  
  // 샘플 필터 설정
  let sampleFilter = '';
  if (hasSampleColumn) {
    if (is_sample === '1') {
      sampleFilter = ' AND i.is_sample = 1';
    } else if (is_sample !== 'all') {
      sampleFilter = ' AND (i.is_sample IS NULL OR i.is_sample = 0)';
    }
  }
  
  // 위생자재 필터 설정
  let sanitaryFilter = '';
  if (hasSanitaryColumn) {
    if (is_sanitary === '1') {
      sanitaryFilter = ' AND i.is_sanitary = 1';
    } else if (is_sanitary !== 'all') {
      sanitaryFilter = ' AND (i.is_sanitary IS NULL OR i.is_sanitary = 0)';
    }
  }
  // 컬럼이 없고 is_sample !== '1'이면 필터 없이 진행 (모든 데이터를 일반으로 취급)
  
  // 상세 데이터 조회 (master 또는 supplies 테이블에서 품목 정보 가져오기)
  const detailQuery = `
    SELECT i.*, 
           COALESCE(m.item_name, s.item_name) as item_name, 
           COALESCE(m.category, '부자재') as category, 
           COALESCE(m.unit, s.unit) as unit,
           DATE(i.inbound_date) as date_group
    FROM inbound i 
    LEFT JOIN master m ON i.item_code = m.item_code
    LEFT JOIN supplies s ON i.item_code = s.item_code
    WHERE (m.item_code IS NOT NULL OR s.item_code IS NOT NULL) ${dateFilter}${sampleFilter}${sanitaryFilter}
    ORDER BY i.inbound_date DESC, i.id DESC
  `;
  
  const detailResult = await c.env.DB.prepare(detailQuery).bind(...params).all();
  
  // 통계 조회 (샘플 필터 적용)
  let summaryQuery = '';
  if (view_type === 'daily' || view_type === 'range') {
    // 일별 또는 기간 조회: 전체 합계
    summaryQuery = `
      SELECT 
        COUNT(*) as total_count,
        SUM(i.origin_qty) as total_qty,
        COUNT(DISTINCT i.item_code) as item_count,
        COUNT(DISTINCT i.supplier) as supplier_count,
        SUM(CASE WHEN i.quality_status = '합격' THEN 1 ELSE 0 END) as passed_count,
        SUM(CASE WHEN i.quality_status = '불합격' THEN 1 ELSE 0 END) as failed_count,
        SUM(CASE WHEN i.quality_status = '검사중' THEN 1 ELSE 0 END) as pending_count
      FROM inbound i
      LEFT JOIN master m ON i.item_code = m.item_code
      LEFT JOIN supplies s ON i.item_code = s.item_code
      WHERE (m.item_code IS NOT NULL OR s.item_code IS NOT NULL) ${dateFilter}${sampleFilter}${sanitaryFilter}
    `;
  } else {
    // 월별인 경우 일자별 그룹핑
    summaryQuery = `
      SELECT 
        DATE(i.inbound_date) as date,
        COUNT(*) as count,
        SUM(i.origin_qty) as total_qty,
        COUNT(DISTINCT i.item_code) as item_count
      FROM inbound i
      LEFT JOIN master m ON i.item_code = m.item_code
      LEFT JOIN supplies s ON i.item_code = s.item_code
      WHERE (m.item_code IS NOT NULL OR s.item_code IS NOT NULL) ${dateFilter}${sampleFilter}${sanitaryFilter}
      GROUP BY DATE(i.inbound_date)
      ORDER BY DATE(i.inbound_date) DESC
    `;
  }
  
  const summaryResult = await c.env.DB.prepare(summaryQuery).bind(...params).all();
  
  // 품목별 합계 (상위 10개) - 샘플 필터 적용
  const itemSummaryQuery = `
    SELECT 
      i.item_code,
      COALESCE(m.item_name, s.item_name) as item_name,
      COALESCE(m.category, '부자재') as category,
      COALESCE(m.unit, s.unit) as unit,
      COUNT(*) as inbound_count,
      SUM(i.origin_qty) as total_qty,
      COUNT(DISTINCT i.supplier) as supplier_count
    FROM inbound i
    LEFT JOIN master m ON i.item_code = m.item_code
    LEFT JOIN supplies s ON i.item_code = s.item_code
    WHERE (m.item_code IS NOT NULL OR s.item_code IS NOT NULL) ${dateFilter}${sampleFilter}${sanitaryFilter}
    GROUP BY i.item_code, COALESCE(m.item_name, s.item_name), COALESCE(m.category, '부자재'), COALESCE(m.unit, s.unit)
    ORDER BY SUM(i.origin_qty) DESC
    LIMIT 10
  `;
  const itemSummaryResult = await c.env.DB.prepare(itemSummaryQuery).bind(...params).all();
  
  // 거래처별 합계 - 샘플 필터 적용
  const supplierSummaryQuery = `
    SELECT 
      i.supplier,
      COUNT(*) as inbound_count,
      SUM(i.origin_qty) as total_qty,
      COUNT(DISTINCT i.item_code) as item_count
    FROM inbound i
    LEFT JOIN master m ON i.item_code = m.item_code
    LEFT JOIN supplies s ON i.item_code = s.item_code
    WHERE i.supplier IS NOT NULL AND i.supplier != '' AND (m.item_code IS NOT NULL OR s.item_code IS NOT NULL) ${dateFilter}${sampleFilter}${sanitaryFilter}
    GROUP BY i.supplier
    ORDER BY SUM(i.origin_qty) DESC
    LIMIT 10
  `;
  const supplierSummaryResult = await c.env.DB.prepare(supplierSummaryQuery).bind(...params).all();
  
  return c.json({ 
    success: true, 
    data: {
      details: detailResult.results,
      summary: (view_type === 'daily' || view_type === 'range') ? (summaryResult.results[0] || {}) : summaryResult.results,
      itemSummary: itemSummaryResult.results,
      supplierSummary: supplierSummaryResult.results,
      view_type,
      date,
      start_date,
      end_date
    }
  });
});

// 입고 목록 조회
// ★★★ v3.6.87: 재고조정 LOT 제외 (STADJ, PADJ, BADJ로 시작하는 LOT) ★★★
inboundRoutes.get('/', async (c) => {
  const item_code = c.req.query('item_code');
  const start_date = c.req.query('start_date');
  const end_date = c.req.query('end_date');
  const has_remain = c.req.query('has_remain'); // 잔량 있는 것만
  const include_unlinked = c.req.query('include_unlinked'); // 마스터 없는 품목 포함
  const include_adjustments = c.req.query('include_adjustments'); // 재고조정 LOT 포함
  
  let query = `
    SELECT i.*, 
           COALESCE(m.item_name, s.item_name, i.item_code) as item_name, 
           COALESCE(m.category, CASE WHEN s.item_code IS NOT NULL THEN '부자재' ELSE '미등록' END) as category, 
           COALESCE(m.unit, s.unit, 'EA') as unit 
    FROM inbound i 
    LEFT JOIN master m ON i.item_code = m.item_code
    LEFT JOIN supplies s ON i.item_code = s.item_code
    WHERE 1=1
  `;
  const params: any[] = [];
  
  // 마스터 없는 품목 제외 (기본값) - 이전 호환성 유지
  if (include_unlinked !== 'true') {
    query += ' AND (m.item_code IS NOT NULL OR s.item_code IS NOT NULL)';
  }
  
  // ★★★ v3.6.87: 재고조정 LOT 제외 (기본값) ★★★
  if (include_adjustments !== 'true') {
    query += ` AND i.lot_number NOT LIKE 'STADJ%' AND i.lot_number NOT LIKE 'PADJ%' AND i.lot_number NOT LIKE 'BADJ%'`;
  }
  
  if (item_code) {
    query += ' AND i.item_code = ?';
    params.push(item_code);
  }
  if (start_date) {
    query += ' AND i.inbound_date >= ?';
    params.push(start_date);
  }
  if (end_date) {
    query += ' AND i.inbound_date <= ?';
    params.push(end_date);
  }
  if (has_remain === 'true') {
    query += ' AND i.remain_qty > 0';
  }
  
  query += ' ORDER BY i.expiry_date ASC, i.inbound_date ASC';
  
  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ success: true, data: result.results });
});

// LOT 상세 조회
inboundRoutes.get('/lot/:lot_number', async (c) => {
  const lot_number = c.req.param('lot_number');
  
  const lot = await c.env.DB.prepare(`
    SELECT i.*, 
           COALESCE(m.item_name, s.item_name) as item_name, 
           COALESCE(m.category, '부자재') as category, 
           COALESCE(m.unit, s.unit) as unit 
    FROM inbound i 
    LEFT JOIN master m ON i.item_code = m.item_code
    LEFT JOIN supplies s ON i.item_code = s.item_code
    WHERE i.lot_number = ? AND (m.item_code IS NOT NULL OR s.item_code IS NOT NULL)
  `).bind(lot_number).first();
  
  if (!lot) {
    return c.json({ success: false, error: 'LOT을 찾을 수 없습니다.' }, 404);
  }
  
  // 해당 LOT의 거래 이력
  const history = await c.env.DB.prepare(`
    SELECT * FROM transactions WHERE lot_number = ? ORDER BY trans_date DESC, id DESC
  `).bind(lot_number).all();
  
  return c.json({ success: true, data: { lot, history: history.results } });
});

// 입고 등록
inboundRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json<InboundRequest & { is_sample?: boolean; is_sanitary?: boolean; storage_location?: string }>();
    const { item_code, quantity, inbound_date, expiry_date, supplier, quality_status, is_sample, is_sanitary, storage_location } = body;
    
    if (!item_code || !quantity || quantity <= 0) {
      return c.json({ success: false, error: '품목과 수량을 올바르게 입력해주세요.' }, 400);
    }
    
    // is_sample, is_sanitary 컬럼 존재 여부 확인
    let hasSampleColumn = false;
    let hasSanitaryColumn = false;
    try {
      const tableInfo = await c.env.DB.prepare("PRAGMA table_info(inbound)").all();
      const columns = (tableInfo.results || []).map((col: any) => col.name);
      console.log('inbound columns:', columns);
      hasSampleColumn = columns.includes('is_sample');
      hasSanitaryColumn = columns.includes('is_sanitary');
      console.log('hasSampleColumn:', hasSampleColumn, 'hasSanitaryColumn:', hasSanitaryColumn);
    } catch (e) {
      console.error('PRAGMA error:', e);
      hasSampleColumn = false;
      hasSanitaryColumn = false;
    }
    
    // 샘플인 경우 보관 장소 필수 (컬럼이 있을 때만)
    if (hasSampleColumn && is_sample && !storage_location) {
    return c.json({ success: false, error: '샘플의 보관 장소를 입력해주세요.' }, 400);
  }
  
  // 품목 확인 (master 또는 supplies 테이블에서)
  let master = await c.env.DB.prepare(
    'SELECT * FROM master WHERE item_code = ?'
  ).bind(item_code).first();
  
  let isSupplies = false;
  if (!master) {
    // supplies 테이블에서 찾기
    try {
      master = await c.env.DB.prepare(
        'SELECT * FROM supplies WHERE item_code = ?'
      ).bind(item_code).first();
      if (master) {
        isSupplies = true;
      }
    } catch (e) {
      // supplies 테이블이 없을 수 있음
    }
  }
  
  if (!master) {
    return c.json({ success: false, error: '등록되지 않은 품목입니다.' }, 404);
  }
  
  // 오늘 해당 품목의 입고 순번 조회
  const todayCount = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM inbound 
    WHERE item_code = ? AND inbound_date = ?
  `).bind(item_code, inbound_date).first<{ count: number }>();
  
  const sequence = (todayCount?.count || 0) + 1;
  // 샘플인 경우 LOT 번호에 S 접미사 추가 (컬럼이 있을 때만)
  let lot_number = generateLotNumber(item_code, inbound_date, sequence);
  if (hasSampleColumn && is_sample) {
    lot_number = lot_number + '-S';
  }
  
  // 입고 등록 - 컬럼 존재 여부에 따라 쿼리 분기
  // 부자재는 expiry_date가 없을 수 있으므로 null 처리
  const expiryDateValue = expiry_date || null;
  
  // 다음 id 값 조회 (AUTOINCREMENT가 없으므로 수동으로 생성)
  const maxIdResult = await c.env.DB.prepare('SELECT MAX(id) as max_id FROM inbound').first<{ max_id: number }>();
  const nextId = (maxIdResult?.max_id || 0) + 1;
  
  if (hasSampleColumn && hasSanitaryColumn) {
    // 샘플 + 위생자재 컬럼 둘 다 있는 경우
    await c.env.DB.prepare(`
      INSERT INTO inbound (id, lot_number, item_code, inbound_date, expiry_date, origin_qty, remain_qty, quality_status, supplier, is_sample, is_sanitary, storage_location, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      nextId,
      lot_number, 
      item_code, 
      inbound_date, 
      expiryDateValue, 
      quantity, 
      quantity, 
      quality_status || '합격', 
      supplier || null,
      is_sample ? 1 : 0,
      is_sanitary ? 1 : 0,
      is_sample ? storage_location : null
    ).run();
  } else if (hasSanitaryColumn) {
    // 위생자재 컬럼만 있는 경우 (is_sample 컬럼 없음)
    await c.env.DB.prepare(`
      INSERT INTO inbound (id, lot_number, item_code, inbound_date, expiry_date, origin_qty, remain_qty, quality_status, supplier, is_sanitary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      nextId,
      lot_number, 
      item_code, 
      inbound_date, 
      expiryDateValue, 
      quantity, 
      quantity, 
      quality_status || '합격', 
      supplier || null,
      is_sanitary ? 1 : 0
    ).run();
  } else if (hasSampleColumn) {
    // 샘플 컬럼만 있는 경우
    await c.env.DB.prepare(`
      INSERT INTO inbound (id, lot_number, item_code, inbound_date, expiry_date, origin_qty, remain_qty, quality_status, supplier, is_sample, storage_location, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      nextId,
      lot_number, 
      item_code, 
      inbound_date, 
      expiryDateValue, 
      quantity, 
      quantity, 
      quality_status || '합격', 
      supplier || null,
      is_sample ? 1 : 0,
      is_sample ? storage_location : null
    ).run();
  } else {
    // 기존 스키마
    await c.env.DB.prepare(`
      INSERT INTO inbound (id, lot_number, item_code, inbound_date, expiry_date, origin_qty, remain_qty, quality_status, supplier, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      nextId,
      lot_number, 
      item_code, 
      inbound_date, 
      expiryDateValue, 
      quantity, 
      quantity, 
      quality_status || '합격', 
      supplier || null
    ).run();
  }
  
  // 합격인 경우에만 재고 반영 (샘플은 일반 재고에 반영하지 않음 - 별도 관리)
  if (quality_status === '합격') {
    // 샘플이 아닌 경우에만 재고 증가
    if (!is_sample || !hasSampleColumn) {
      if (isSupplies) {
        // 부자재는 supplies 테이블에서 재고 업데이트
        await c.env.DB.prepare(`
          UPDATE supplies SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP
          WHERE item_code = ?
        `).bind(quantity, item_code).run();
      } else {
        // 원료/제품은 master 테이블에서 재고 업데이트
        await c.env.DB.prepare(`
          UPDATE master SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP
          WHERE item_code = ?
        `).bind(quantity, item_code).run();
      }
    }
    
    // Transaction 기록 - 컬럼 존재 여부에 따라 쿼리 분기
    if (hasSampleColumn) {
      await c.env.DB.prepare(`
        INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, remain_qty, supplier, is_sample)
        VALUES (?, ?, '입고', ?, ?, ?, ?, ?)
      `).bind(inbound_date, item_code, quantity, lot_number, quantity, supplier || null, is_sample ? 1 : 0).run();
    } else {
      await c.env.DB.prepare(`
        INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, remain_qty, supplier)
        VALUES (?, ?, '입고', ?, ?, ?, ?)
      `).bind(inbound_date, item_code, quantity, lot_number, quantity, supplier || null).run();
    }
  }
  
  // ★★★ 구글시트 원료입고 시트에 자동 동기화 ★★★
  let sheetSyncResult = { success: false, message: '구글시트 동기화 스킵' };
  try {
    const sheetService = getSheetService(c);
    if (sheetService) {
      // ★★★ v3.6.54: 원료입고 시트 구조 수정 - 단위 필드 추가 ★★★
      // 시트 헤더: A:입고일, B:품목코드, C:품목명, D:LOT, E:입고량, F:단위, G:공급업체, H:소비기한, I:잔량
      const itemName = (master as any).item_name || item_code;
      const itemUnit = (master as any).unit || 'kg';  // ★ 원료마스터에서 단위 조회
      const row = [
        `'${inbound_date}`,  // A: 입고일 (문자열로 강제)
        item_code,            // B: 품목코드
        itemName,             // C: 품목명
        lot_number,           // D: LOT
        quantity,             // E: 입고량
        itemUnit,             // F: 단위 ★ 추가
        supplier || '',       // G: 공급업체
        expiryDateValue ? `'${expiryDateValue}` : '',  // H: 소비기한
        quantity              // I: 잔량 (초기값 = 입고량)
      ];
      
      await sheetService.appendSheet('원료입고', [row]);
      sheetSyncResult = { success: true, message: '구글시트 동기화 완료' };
      console.log('구글시트 원료입고 동기화 성공:', { item_code, lot_number, quantity });
    }
  } catch (sheetError: any) {
    console.error('구글시트 동기화 오류:', sheetError);
    sheetSyncResult = { success: false, message: `구글시트 동기화 실패: ${sheetError.message}` };
    // 구글시트 동기화 실패해도 입고 등록은 성공으로 처리
  }
  
  return c.json({ 
    success: true, 
    message: (hasSampleColumn && is_sample) ? '샘플 입고가 등록되었습니다.' : '입고가 등록되었습니다.',
    data: { 
      lot_number, 
      quality_status, 
      is_sample: hasSampleColumn ? is_sample : undefined, 
      storage_location: hasSampleColumn ? storage_location : undefined,
      sheet_sync: sheetSyncResult
    }
  });
  } catch (error: any) {
    console.error('Inbound registration error:', error);
    return c.json({ success: false, error: `입고 등록 실패: ${error.message}` }, 500);
  }
});

// LOT 수정 (관리자용 - 잔량 조정)
inboundRoutes.put('/lot/:lot_number', async (c) => {
  const lot_number = c.req.param('lot_number');
  const body = await c.req.json<{ remain_qty?: number; quality_status?: string }>();
  
  const lot = await c.env.DB.prepare(
    'SELECT * FROM inbound WHERE lot_number = ?'
  ).bind(lot_number).first<Inbound>();
  
  if (!lot) {
    return c.json({ success: false, error: 'LOT을 찾을 수 없습니다.' }, 404);
  }
  
  if (body.remain_qty !== undefined) {
    if (body.remain_qty < 0 || body.remain_qty > lot.origin_qty) {
      return c.json({ success: false, error: '잔량은 0 이상, 입고량 이하여야 합니다.' }, 400);
    }
    
    const diff = body.remain_qty - lot.remain_qty;
    
    // LOT 잔량 수정
    await c.env.DB.prepare(`
      UPDATE inbound SET remain_qty = ?, updated_at = CURRENT_TIMESTAMP WHERE lot_number = ?
    `).bind(body.remain_qty, lot_number).run();
    
    // Master 재고 조정
    await c.env.DB.prepare(`
      UPDATE master SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE item_code = ?
    `).bind(diff, lot.item_code).run();
    
    // 조정 기록
    if (diff !== 0) {
      const today = new Date().toISOString().split('T')[0];
      await c.env.DB.prepare(`
        INSERT INTO transactions (trans_date, item_code, trans_type, quantity, lot_number, remain_qty, memo)
        VALUES (?, ?, '재고조정', ?, ?, ?, 'LOT 잔량 수정')
      `).bind(today, lot.item_code, diff, lot_number, body.remain_qty).run();
    }
  }
  
  return c.json({ success: true, message: 'LOT이 수정되었습니다.' });
});

// 유통기한 임박 LOT 조회
inboundRoutes.get('/expiring/:days', async (c) => {
  const days = parseInt(c.req.param('days')) || 30;
  const today = new Date().toISOString().split('T')[0];
  
  const result = await c.env.DB.prepare(`
    SELECT i.*, 
           COALESCE(m.item_name, s.item_name) as item_name, 
           COALESCE(m.category, '부자재') as category, 
           COALESCE(m.unit, s.unit) as unit,
           CAST(julianday(i.expiry_date) - julianday(?) AS INTEGER) as days_until_expiry
    FROM inbound i
    LEFT JOIN master m ON i.item_code = m.item_code
    LEFT JOIN supplies s ON i.item_code = s.item_code
    WHERE i.remain_qty > 0 
      AND i.quality_status = '합격'
      AND i.expiry_date IS NOT NULL
      AND julianday(i.expiry_date) - julianday(?) <= ?
      AND (m.item_code IS NOT NULL OR s.item_code IS NOT NULL)
    ORDER BY i.expiry_date ASC
  `).bind(today, today, days).all();
  
  return c.json({ success: true, data: result.results });
});

// 입고 삭제 (단건)
inboundRoutes.delete('/:lot_number', async (c) => {
  const lot_number = c.req.param('lot_number');
  
  try {
    // LOT 정보 조회
    const lot = await c.env.DB.prepare(`
      SELECT * FROM inbound WHERE lot_number = ?
    `).bind(lot_number).first() as any;
    
    if (!lot) {
      return c.json({ success: false, error: '해당 LOT을 찾을 수 없습니다.' }, 404);
    }
    
    // 재고 차감 (잔량만큼)
    if (lot.remain_qty > 0) {
      // supplies 테이블인지 확인
      const isSupplies = lot.item_code.startsWith('SM');
      const targetTable = isSupplies ? 'supplies' : 'master';
      
      await c.env.DB.prepare(`
        UPDATE ${targetTable} SET current_stock = MAX(0, current_stock - ?), updated_at = CURRENT_TIMESTAMP 
        WHERE item_code = ?
      `).bind(lot.remain_qty, lot.item_code).run();
    }
    
    // 관련 트랜잭션 삭제
    await c.env.DB.prepare(`
      DELETE FROM transactions WHERE lot_number = ?
    `).bind(lot_number).run();
    
    // 입고 기록 삭제
    await c.env.DB.prepare(`
      DELETE FROM inbound WHERE lot_number = ?
    `).bind(lot_number).run();
    
    return c.json({ 
      success: true, 
      message: `LOT ${lot_number}이(가) 삭제되었습니다.`,
      deleted_qty: lot.remain_qty
    });
  } catch (error: any) {
    console.error('입고 삭제 오류:', error);
    return c.json({ success: false, error: `삭제 실패: ${error.message}` }, 500);
  }
});

// 입고 일괄 삭제
inboundRoutes.post('/delete-batch', async (c) => {
  const body = await c.req.json<{ lot_numbers: string[] }>();
  const { lot_numbers } = body;
  
  if (!lot_numbers || !Array.isArray(lot_numbers) || lot_numbers.length === 0) {
    return c.json({ success: false, error: '삭제할 LOT 번호가 필요합니다.' }, 400);
  }
  
  try {
    let deletedCount = 0;
    let errors: string[] = [];
    
    for (const lot_number of lot_numbers) {
      try {
        // LOT 정보 조회
        const lot = await c.env.DB.prepare(`
          SELECT * FROM inbound WHERE lot_number = ?
        `).bind(lot_number).first() as any;
        
        if (!lot) {
          errors.push(`${lot_number}: 찾을 수 없음`);
          continue;
        }
        
        // 재고 차감
        if (lot.remain_qty > 0) {
          const isSupplies = lot.item_code.startsWith('SM');
          const targetTable = isSupplies ? 'supplies' : 'master';
          
          await c.env.DB.prepare(`
            UPDATE ${targetTable} SET current_stock = MAX(0, current_stock - ?), updated_at = CURRENT_TIMESTAMP 
            WHERE item_code = ?
          `).bind(lot.remain_qty, lot.item_code).run();
        }
        
        // 트랜잭션 삭제
        await c.env.DB.prepare(`
          DELETE FROM transactions WHERE lot_number = ?
        `).bind(lot_number).run();
        
        // 입고 기록 삭제
        await c.env.DB.prepare(`
          DELETE FROM inbound WHERE lot_number = ?
        `).bind(lot_number).run();
        
        deletedCount++;
      } catch (e: any) {
        errors.push(`${lot_number}: ${e.message}`);
      }
    }
    
    return c.json({ 
      success: true, 
      message: `${deletedCount}건 삭제 완료${errors.length > 0 ? `, ${errors.length}건 실패` : ''}`,
      deleted_count: deletedCount,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error: any) {
    console.error('일괄 삭제 오류:', error);
    return c.json({ success: false, error: `삭제 실패: ${error.message}` }, 500);
  }
});

// 위생자재 컬럼 마이그레이션
inboundRoutes.post('/migrate-sanitary', async (c) => {
  try {
    // is_sanitary 컬럼 추가
    try {
      await c.env.DB.prepare(`ALTER TABLE inbound ADD COLUMN is_sanitary INTEGER DEFAULT 0`).run();
    } catch (e: any) {
      if (!e.message?.includes('duplicate column')) {
        console.log('is_sanitary column already exists');
      }
    }
    
    // transactions 테이블에도 추가
    try {
      await c.env.DB.prepare(`ALTER TABLE transactions ADD COLUMN is_sanitary INTEGER DEFAULT 0`).run();
    } catch (e: any) {
      if (!e.message?.includes('duplicate column')) {
        console.log('transactions.is_sanitary column already exists');
      }
    }
    
    return c.json({ success: true, message: '위생자재 컬럼 마이그레이션 완료' });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 디버그: 테이블 컬럼 확인
inboundRoutes.get('/debug-columns', async (c) => {
  try {
    const tableInfo = await c.env.DB.prepare("PRAGMA table_info(inbound)").all();
    const columns = (tableInfo.results || []).map((col: any) => col.name);
    return c.json({ 
      success: true, 
      columns,
      has_is_sample: columns.includes('is_sample'),
      has_is_sanitary: columns.includes('is_sanitary')
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 원료인데 위생자재로 잘못 표시된 데이터 수정
inboundRoutes.post('/fix-sanitary', async (c) => {
  try {
    // 원료 카테고리인데 is_sanitary=1인 입고 데이터를 is_sanitary=0으로 수정
    const result = await c.env.DB.prepare(`
      UPDATE inbound 
      SET is_sanitary = 0, updated_at = CURRENT_TIMESTAMP
      WHERE is_sanitary = 1 
        AND item_code IN (SELECT item_code FROM master WHERE category = '원료')
    `).run();
    
    return c.json({ 
      success: true, 
      message: '원료 품목의 위생자재 플래그가 수정되었습니다.',
      updated_count: result.meta?.changes || 0
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 디버그: 누락된 입고 데이터 확인 (master/supplies에 없는 품목)
inboundRoutes.get('/debug-missing', async (c) => {
  try {
    // inbound 테이블 전체 건수
    const totalResult = await c.env.DB.prepare('SELECT COUNT(*) as total FROM inbound').first<{total: number}>();
    
    // master 또는 supplies에 있는 품목의 입고 건수
    const linkedResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as linked FROM inbound i
      WHERE EXISTS (SELECT 1 FROM master m WHERE m.item_code = i.item_code)
         OR EXISTS (SELECT 1 FROM supplies s WHERE s.item_code = i.item_code)
    `).first<{linked: number}>();
    
    // 누락된 입고 목록 (품목 마스터에 없는 것)
    const missingResult = await c.env.DB.prepare(`
      SELECT DISTINCT i.item_code, COUNT(*) as inbound_count, SUM(i.remain_qty) as total_remain
      FROM inbound i
      WHERE NOT EXISTS (SELECT 1 FROM master m WHERE m.item_code = i.item_code)
        AND NOT EXISTS (SELECT 1 FROM supplies s WHERE s.item_code = i.item_code)
      GROUP BY i.item_code
      ORDER BY inbound_count DESC
      LIMIT 20
    `).all();
    
    return c.json({ 
      success: true, 
      total_inbound: totalResult?.total || 0,
      linked_inbound: linkedResult?.linked || 0,
      missing_count: (totalResult?.total || 0) - (linkedResult?.linked || 0),
      missing_items: missingResult.results
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// =====================================================
// 📦 재고 초기화 API (HACCP 기록 없이 잔량만 조정)
// =====================================================

/**
 * 원료별 실사재고 기준 잔량 초기화 (관리자 전용)
 * 
 * POST /api/inbound/inventory-reset
 * Body: { 
 *   items: [
 *     { item_code: "R001", actual_stock: 120 },
 *     { item_code: "R002", actual_stock: 100 },
 *     ...
 *   ]
 * }
 * 
 * 로직:
 * 1. 해당 원료의 모든 LOT 조회 (소비기한 순)
 * 2. 오래된 LOT부터 잔량 0으로 처리
 * 3. 실사재고에 맞게 마지막 LOT에 잔량 배분
 * 4. transactions 기록 없음 (HACCP 문서에 조정 내역 안 남음)
 */
inboundRoutes.post('/inventory-reset', async (c) => {
  try {
    const body = await c.req.json<{ items: Array<{ item_code: string; actual_stock: number }> }>();
    const { items } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return c.json({ success: false, error: 'items 배열이 필요합니다.' }, 400);
    }

    const results: Array<{
      item_code: string;
      before_total: number;
      after_total: number;
      actual_stock: number;
      lots_updated: number;
      status: string;
    }> = [];

    for (const item of items) {
      const { item_code, actual_stock } = item;

      if (!item_code || actual_stock === undefined || actual_stock < 0) {
        results.push({
          item_code: item_code || '(없음)',
          before_total: 0,
          after_total: 0,
          actual_stock: actual_stock || 0,
          lots_updated: 0,
          status: 'error: 잘못된 입력'
        });
        continue;
      }

      // 해당 원료의 모든 LOT 조회 (소비기한 순, 오래된 것부터)
      const lots = await c.env.DB.prepare(`
        SELECT lot_number, remain_qty, expiry_date
        FROM inbound
        WHERE item_code = ? AND remain_qty > 0
        ORDER BY expiry_date ASC, inbound_date ASC
      `).bind(item_code).all<{ lot_number: string; remain_qty: number; expiry_date: string }>();

      const lotList = lots.results || [];
      
      if (lotList.length === 0) {
        results.push({
          item_code,
          before_total: 0,
          after_total: 0,
          actual_stock,
          lots_updated: 0,
          status: actual_stock === 0 ? 'ok: 잔량 LOT 없음' : 'warning: 잔량 LOT 없음, 실사재고 반영 불가'
        });
        continue;
      }

      // 현재 총 잔량
      const beforeTotal = lotList.reduce((sum, lot) => sum + lot.remain_qty, 0);

      // 실사재고 배분
      let remainingActual = actual_stock;
      let lotsUpdated = 0;

      // 역순으로 처리 (최신 LOT부터 실사재고 배분)
      const reversedLots = [...lotList].reverse();

      for (const lot of reversedLots) {
        if (remainingActual <= 0) {
          // 실사재고 다 배분됨 → 나머지 LOT 잔량 0
          await c.env.DB.prepare(`
            UPDATE inbound SET remain_qty = 0, updated_at = CURRENT_TIMESTAMP
            WHERE lot_number = ?
          `).bind(lot.lot_number).run();
          lotsUpdated++;
        } else if (remainingActual >= lot.remain_qty) {
          // 이 LOT 전체 유지
          remainingActual -= lot.remain_qty;
          // 변경 없음 (기존 잔량 유지)
        } else {
          // 이 LOT에서 일부만 남김
          await c.env.DB.prepare(`
            UPDATE inbound SET remain_qty = ?, updated_at = CURRENT_TIMESTAMP
            WHERE lot_number = ?
          `).bind(remainingActual, lot.lot_number).run();
          lotsUpdated++;
          remainingActual = 0;
        }
      }

      // 결과 검증
      const afterCheck = await c.env.DB.prepare(`
        SELECT SUM(remain_qty) as total FROM inbound WHERE item_code = ?
      `).bind(item_code).first<{ total: number }>();

      results.push({
        item_code,
        before_total: Math.round(beforeTotal * 100) / 100,
        after_total: Math.round((afterCheck?.total || 0) * 100) / 100,
        actual_stock,
        lots_updated: lotsUpdated,
        status: 'ok'
      });
    }

    // master 테이블 current_stock도 업데이트
    for (const item of items) {
      if (item.actual_stock >= 0) {
        await c.env.DB.prepare(`
          UPDATE master SET current_stock = ?, updated_at = CURRENT_TIMESTAMP
          WHERE item_code = ?
        `).bind(item.actual_stock, item.item_code).run();
      }
    }

    return c.json({
      success: true,
      message: `${results.filter(r => r.status === 'ok').length}건 재고 초기화 완료`,
      results
    });

  } catch (error: any) {
    console.error('Inventory reset error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * 단일 원료 재고 초기화 (테스트용)
 * 
 * POST /api/inbound/inventory-reset/:item_code
 * Body: { actual_stock: 120 }
 */
inboundRoutes.post('/inventory-reset/:item_code', async (c) => {
  const item_code = c.req.param('item_code');
  const body = await c.req.json<{ actual_stock: number }>();
  const { actual_stock } = body;

  if (actual_stock === undefined || actual_stock < 0) {
    return c.json({ success: false, error: 'actual_stock은 0 이상이어야 합니다.' }, 400);
  }

  // 해당 원료의 모든 LOT 조회 (소비기한 순)
  const lots = await c.env.DB.prepare(`
    SELECT lot_number, remain_qty, expiry_date, origin_qty
    FROM inbound
    WHERE item_code = ? AND remain_qty > 0
    ORDER BY expiry_date ASC, inbound_date ASC
  `).bind(item_code).all<{ lot_number: string; remain_qty: number; expiry_date: string; origin_qty: number }>();

  const lotList = lots.results || [];
  
  if (lotList.length === 0) {
    return c.json({ 
      success: false, 
      error: '해당 원료의 잔량 있는 LOT이 없습니다.',
      item_code
    }, 404);
  }

  const beforeTotal = lotList.reduce((sum, lot) => sum + lot.remain_qty, 0);

  // 실사재고 배분 (최신 LOT부터)
  let remainingActual = actual_stock;
  const updates: Array<{ lot_number: string; before: number; after: number }> = [];

  const reversedLots = [...lotList].reverse();

  for (const lot of reversedLots) {
    const before = lot.remain_qty;
    let after = 0;

    if (remainingActual <= 0) {
      after = 0;
    } else if (remainingActual >= lot.remain_qty) {
      after = lot.remain_qty;
      remainingActual -= lot.remain_qty;
    } else {
      after = remainingActual;
      remainingActual = 0;
    }

    if (before !== after) {
      await c.env.DB.prepare(`
        UPDATE inbound SET remain_qty = ?, updated_at = CURRENT_TIMESTAMP
        WHERE lot_number = ?
      `).bind(after, lot.lot_number).run();
    }

    updates.push({ lot_number: lot.lot_number, before, after });
  }

  // master 테이블도 업데이트
  await c.env.DB.prepare(`
    UPDATE master SET current_stock = ?, updated_at = CURRENT_TIMESTAMP
    WHERE item_code = ?
  `).bind(actual_stock, item_code).run();

  return c.json({
    success: true,
    item_code,
    before_total: Math.round(beforeTotal * 100) / 100,
    after_total: actual_stock,
    lots: updates.reverse() // 원래 순서로 반환
  });
});

// =====================================================
// 📦 일별수불부 기준 D1 재고 동기화 API
// =====================================================

/**
 * 구글시트 일별수불부 기준으로 D1 inbound 잔량 동기화
 * 
 * POST /api/inbound/sync-from-daily-stock
 * Query: ?date=2026-07-02 (기준 날짜)
 * 
 * 로직:
 * 1. 구글시트 일별수불부에서 원료별 current_stock 조회
 * 2. D1 inbound 테이블의 LOT별 잔량을 조정
 * 3. 최신 LOT부터 잔량 배분 (입고량 한도 내에서)
 */
inboundRoutes.post('/sync-from-daily-stock', async (c) => {
  try {
    const date = c.req.query('date') || new Date().toISOString().split('T')[0];
    
    // 구글시트 서비스 초기화
    const clientEmail = c.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = c.env.GOOGLE_PRIVATE_KEY;
    
    if (!clientEmail || !privateKey) {
      return c.json({ success: false, error: '구글 시트 인증 정보 없음' }, 400);
    }
    
    const { GoogleSheetsService } = await import('../services/GoogleSheetsService');
    const formattedKey = privateKey.replace(/\\n/g, '\n');
    const sheetService = new GoogleSheetsService(clientEmail, formattedKey);
    
    // 1. 일별수불부에서 원료별 현재 재고 조회
    const dailyStock = await sheetService.getDailyStockReport(date);
    
    if (!dailyStock || dailyStock.length === 0) {
      return c.json({ success: false, error: `${date} 일별수불부 데이터 없음` }, 404);
    }

    const results: Array<{
      item_code: string;
      item_name: string;
      daily_stock: number;
      d1_before: number;
      d1_after: number;
      diff: number;
      status: string;
    }> = [];

    let syncedCount = 0;
    let errorCount = 0;

    for (const item of dailyStock) {
      const itemCode = item.item_code;
      const targetStock = item.current_stock || 0;
      
      try {
        // 2. D1에서 해당 원료의 모든 LOT 조회 (입고일 역순 - 최신부터)
        const allLots = await c.env.DB.prepare(`
          SELECT lot_number, remain_qty, origin_qty, inbound_date, expiry_date
          FROM inbound
          WHERE item_code = ?
          ORDER BY inbound_date DESC, expiry_date DESC
        `).bind(itemCode).all<{ 
          lot_number: string; 
          remain_qty: number; 
          origin_qty: number;
          inbound_date: string;
          expiry_date: string;
        }>();

        const lotList = allLots.results || [];
        
        if (lotList.length === 0) {
          results.push({
            item_code: itemCode,
            item_name: item.item_name || itemCode,
            daily_stock: targetStock,
            d1_before: 0,
            d1_after: 0,
            diff: targetStock,
            status: targetStock === 0 ? 'ok: LOT 없음' : 'warning: LOT 없음, 입고 필요'
          });
          continue;
        }

        // 현재 D1 총 잔량
        const d1Before = lotList.reduce((sum, lot) => sum + lot.remain_qty, 0);

        // 3. 목표 재고에 맞게 LOT별 잔량 재배분 (최신 LOT부터)
        let remainingTarget = targetStock;
        
        for (const lot of lotList) {
          let newRemainQty = 0;
          
          if (remainingTarget <= 0) {
            // 목표 재고 다 채움 → 이 LOT은 0
            newRemainQty = 0;
          } else if (remainingTarget >= lot.origin_qty) {
            // 목표 재고가 이 LOT 입고량보다 많음 → 입고량 전체 사용
            newRemainQty = lot.origin_qty;
            remainingTarget -= lot.origin_qty;
          } else {
            // 목표 재고가 이 LOT 입고량보다 적음 → 남은 만큼만
            newRemainQty = remainingTarget;
            remainingTarget = 0;
          }

          // 변경이 있으면 업데이트
          if (Math.abs(lot.remain_qty - newRemainQty) > 0.001) {
            await c.env.DB.prepare(`
              UPDATE inbound SET remain_qty = ?, updated_at = CURRENT_TIMESTAMP
              WHERE lot_number = ?
            `).bind(newRemainQty, lot.lot_number).run();
          }
        }

        // 4. 검증
        const afterCheck = await c.env.DB.prepare(`
          SELECT SUM(remain_qty) as total FROM inbound WHERE item_code = ?
        `).bind(itemCode).first<{ total: number }>();
        
        const d1After = afterCheck?.total || 0;

        // master 테이블도 업데이트
        await c.env.DB.prepare(`
          UPDATE master SET current_stock = ?, updated_at = CURRENT_TIMESTAMP
          WHERE item_code = ?
        `).bind(d1After, itemCode).run();

        results.push({
          item_code: itemCode,
          item_name: item.item_name || itemCode,
          daily_stock: Math.round(targetStock * 100) / 100,
          d1_before: Math.round(d1Before * 100) / 100,
          d1_after: Math.round(d1After * 100) / 100,
          diff: Math.round((d1After - d1Before) * 100) / 100,
          status: Math.abs(d1After - targetStock) < 0.01 ? 'ok' : 
                  d1After < targetStock ? 'warning: 입고량 부족' : 'ok'
        });
        
        syncedCount++;

      } catch (err: any) {
        results.push({
          item_code: itemCode,
          item_name: item.item_name || itemCode,
          daily_stock: targetStock,
          d1_before: 0,
          d1_after: 0,
          diff: 0,
          status: `error: ${err.message}`
        });
        errorCount++;
      }
    }

    // ★ 구글시트 원료입고 동기화 제거 (일별수불부 전일재고 영향 방지)
    // D1만 업데이트하고 구글시트는 건드리지 않음

    return c.json({
      success: true,
      message: `일별수불부 기준 D1 동기화 완료 (구글시트 미변경)`,
      date,
      summary: {
        total: dailyStock.length,
        synced: syncedCount,
        errors: errorCount
      },
      results: results.filter(r => r.diff !== 0 || r.status !== 'ok')
    });

  } catch (error: any) {
    console.error('Sync from daily stock error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default inboundRoutes;
