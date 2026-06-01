/**
 * 감사(Audit) API
 * 
 * 기능:
 * 1. inbound.remain_qty 합계 vs master.current_stock 일치 여부 전수 조사
 * 2. 자정 실행 트리거용 API (Cloudflare Cron Triggers와 연동)
 * 3. 불일치 감지 시 알람 로직
 */
import { Hono } from 'hono';
import type { Bindings } from '../types';
import { auditStockConsistency } from '../utils/inventory';
import { LOT_FORMAT, generateRawMaterialLOT, LOTGenerationError } from '../utils/lot-generator';

const auditRoutes = new Hono<{ Bindings: Bindings }>();

// ===== 재고 일치성 검사 =====

/**
 * 원료 재고 불일치 전수 조사
 * GET /api/audit/stock-consistency
 */
auditRoutes.get('/stock-consistency', async (c) => {
  try {
    const result = await auditStockConsistency(c.env.DB);
    
    // 불일치 발견 시 로깅
    if (!result.success) {
      console.error(`[AUDIT] 재고 불일치 발견: ${result.mismatch_count}건`);
      for (const m of result.mismatches.slice(0, 10)) {
        console.error(`  - ${m.item_code} (${m.item_name}): master=${m.master_stock}, inbound합계=${m.inbound_sum}, 차이=${m.difference}`);
      }
    }

    return c.json({
      success: true,
      audit_result: {
        consistent: result.success,
        total_checked: result.total_checked,
        mismatch_count: result.mismatch_count,
        mismatches: result.mismatches,
        audit_time: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('[AUDIT] 재고 검사 오류:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * 제품 재고 불일치 검사 (production_inbound vs master)
 * GET /api/audit/product-consistency
 */
auditRoutes.get('/product-consistency', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT 
        m.item_code,
        m.item_name,
        m.current_stock as master_stock,
        COALESCE(SUM(pi.remain_qty), 0) as production_inbound_sum,
        m.current_stock - COALESCE(SUM(pi.remain_qty), 0) as difference
      FROM master m
      LEFT JOIN production_inbound pi ON m.item_code = pi.production_code AND pi.quality_status = '합격'
      WHERE m.category = '제품'
      GROUP BY m.item_code, m.item_name, m.current_stock
      HAVING ABS(m.current_stock - COALESCE(SUM(pi.remain_qty), 0)) > 0.001
      ORDER BY ABS(difference) DESC
    `).all<{
      item_code: string;
      item_name: string;
      master_stock: number;
      production_inbound_sum: number;
      difference: number;
    }>();

    const mismatches = result.results || [];
    
    const totalCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM master WHERE category = '제품'
    `).first<{ cnt: number }>();

    return c.json({
      success: true,
      audit_result: {
        consistent: mismatches.length === 0,
        total_checked: totalCount?.cnt || 0,
        mismatch_count: mismatches.length,
        mismatches,
        audit_time: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('[AUDIT] 제품 재고 검사 오류:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * 반제품 재고 불일치 검사 (semi_finished_lots vs semi_finished_items)
 * GET /api/audit/semifinished-consistency
 */
auditRoutes.get('/semifinished-consistency', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT 
        sf.item_code,
        sf.item_name,
        sf.current_stock as master_stock,
        COALESCE(SUM(sfl.remain_qty), 0) as lot_sum,
        sf.current_stock - COALESCE(SUM(sfl.remain_qty), 0) as difference
      FROM semi_finished_items sf
      LEFT JOIN semi_finished_lots sfl ON sf.item_code = sfl.item_code
      GROUP BY sf.item_code, sf.item_name, sf.current_stock
      HAVING ABS(sf.current_stock - COALESCE(SUM(sfl.remain_qty), 0)) > 0.001
      ORDER BY ABS(difference) DESC
    `).all<{
      item_code: string;
      item_name: string;
      master_stock: number;
      lot_sum: number;
      difference: number;
    }>();

    const mismatches = result.results || [];
    
    const totalCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM semi_finished_items
    `).first<{ cnt: number }>();

    return c.json({
      success: true,
      audit_result: {
        consistent: mismatches.length === 0,
        total_checked: totalCount?.cnt || 0,
        mismatch_count: mismatches.length,
        mismatches,
        audit_time: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('[AUDIT] 반제품 재고 검사 오류:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * 전체 감사 실행 (원료 + 제품 + 반제품)
 * POST /api/audit/run-all
 * 
 * Cloudflare Cron Triggers 또는 외부 스케줄러에서 호출
 * 자정에 실행하여 불일치 감지 시 audit_logs 테이블에 기록
 */
auditRoutes.post('/run-all', async (c) => {
  const auditTime = new Date().toISOString();
  const results: any = {
    audit_time: auditTime,
    raw_materials: null,
    products: null,
    semi_finished: null,
    has_issues: false,
    total_mismatches: 0
  };

  try {
    // 1. 원료 감사
    const rawMaterialResult = await auditStockConsistency(c.env.DB);
    results.raw_materials = {
      consistent: rawMaterialResult.success,
      mismatch_count: rawMaterialResult.mismatch_count,
      mismatches: rawMaterialResult.mismatches.slice(0, 20) // 상위 20개만
    };
    results.total_mismatches += rawMaterialResult.mismatch_count;

    // 2. 제품 감사
    const productResult = await c.env.DB.prepare(`
      SELECT 
        m.item_code,
        m.item_name,
        m.current_stock as master_stock,
        COALESCE(SUM(pi.remain_qty), 0) as lot_sum,
        m.current_stock - COALESCE(SUM(pi.remain_qty), 0) as difference
      FROM master m
      LEFT JOIN production_inbound pi ON m.item_code = pi.production_code
      WHERE m.category = '제품'
      GROUP BY m.item_code, m.item_name, m.current_stock
      HAVING ABS(m.current_stock - COALESCE(SUM(pi.remain_qty), 0)) > 0.001
      ORDER BY ABS(difference) DESC
      LIMIT 20
    `).all();

    const productMismatches = productResult.results || [];
    results.products = {
      consistent: productMismatches.length === 0,
      mismatch_count: productMismatches.length,
      mismatches: productMismatches
    };
    results.total_mismatches += productMismatches.length;

    // 3. 반제품 감사
    try {
      const sfResult = await c.env.DB.prepare(`
        SELECT 
          sf.item_code,
          sf.item_name,
          sf.current_stock as master_stock,
          COALESCE(SUM(sfl.remain_qty), 0) as lot_sum,
          sf.current_stock - COALESCE(SUM(sfl.remain_qty), 0) as difference
        FROM semi_finished_items sf
        LEFT JOIN semi_finished_lots sfl ON sf.item_code = sfl.item_code
        GROUP BY sf.item_code, sf.item_name, sf.current_stock
        HAVING ABS(sf.current_stock - COALESCE(SUM(sfl.remain_qty), 0)) > 0.001
        ORDER BY ABS(difference) DESC
        LIMIT 20
      `).all();

      const sfMismatches = sfResult.results || [];
      results.semi_finished = {
        consistent: sfMismatches.length === 0,
        mismatch_count: sfMismatches.length,
        mismatches: sfMismatches
      };
      results.total_mismatches += sfMismatches.length;
    } catch (e) {
      results.semi_finished = { skipped: true, reason: '테이블 없음' };
    }

    results.has_issues = results.total_mismatches > 0;

    // 4. 감사 로그 저장
    try {
      await c.env.DB.prepare(`
        INSERT INTO audit_logs (audit_type, audit_time, has_issues, total_mismatches, details, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(
        'STOCK_CONSISTENCY',
        auditTime,
        results.has_issues ? 1 : 0,
        results.total_mismatches,
        JSON.stringify(results)
      ).run();
    } catch (e) {
      // audit_logs 테이블이 없으면 생성
      await c.env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          audit_type TEXT NOT NULL,
          audit_time TEXT NOT NULL,
          has_issues INTEGER DEFAULT 0,
          total_mismatches INTEGER DEFAULT 0,
          details TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      
      await c.env.DB.prepare(`
        INSERT INTO audit_logs (audit_type, audit_time, has_issues, total_mismatches, details, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(
        'STOCK_CONSISTENCY',
        auditTime,
        results.has_issues ? 1 : 0,
        results.total_mismatches,
        JSON.stringify(results)
      ).run();
    }

    // 5. 불일치 발견 시 알람 (콘솔 로그 + 응답에 경고 포함)
    if (results.has_issues) {
      console.error(`[AUDIT ALERT] ${auditTime} - 재고 불일치 발견: ${results.total_mismatches}건`);
      
      return c.json({
        success: true,
        warning: `재고 불일치 ${results.total_mismatches}건 발견! 확인이 필요합니다.`,
        results
      });
    }

    return c.json({
      success: true,
      message: '재고 감사 완료: 불일치 없음',
      results
    });

  } catch (error: any) {
    console.error('[AUDIT] 전체 감사 오류:', error);
    return c.json({
      success: false,
      error: error.message,
      partial_results: results
    }, 500);
  }
});

/**
 * 감사 이력 조회
 * GET /api/audit/history
 */
auditRoutes.get('/history', async (c) => {
  const limit = parseInt(c.req.query('limit') || '30');
  const audit_type = c.req.query('type');

  try {
    let query = `
      SELECT * FROM audit_logs
      WHERE 1=1
    `;
    const params: any[] = [];

    if (audit_type) {
      query += ' AND audit_type = ?';
      params.push(audit_type);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const result = await c.env.DB.prepare(query).bind(...params).all();

    return c.json({
      success: true,
      data: result.results
    });
  } catch (error: any) {
    // 테이블이 없으면 빈 배열 반환
    if (error.message?.includes('no such table')) {
      return c.json({
        success: true,
        data: [],
        notice: '감사 이력이 없습니다.'
      });
    }
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * 음수 재고 검사
 * GET /api/audit/negative-stock
 */
auditRoutes.get('/negative-stock', async (c) => {
  try {
    // 원료
    const rawMaterials = await c.env.DB.prepare(`
      SELECT item_code, item_name, current_stock, category
      FROM master
      WHERE current_stock < 0
      ORDER BY current_stock ASC
    `).all();

    // 반제품
    let semiFinished: any[] = [];
    try {
      const sfResult = await c.env.DB.prepare(`
        SELECT item_code, item_name, current_stock
        FROM semi_finished_items
        WHERE current_stock < 0
        ORDER BY current_stock ASC
      `).all();
      semiFinished = sfResult.results || [];
    } catch (e) {
      // 테이블 없음
    }

    // LOT 잔량 음수
    const negativeLots = await c.env.DB.prepare(`
      SELECT lot_number, item_code, remain_qty
      FROM inbound
      WHERE remain_qty < 0
      ORDER BY remain_qty ASC
    `).all();

    const totalNegative = (rawMaterials.results?.length || 0) + 
                          semiFinished.length + 
                          (negativeLots.results?.length || 0);

    return c.json({
      success: true,
      has_issues: totalNegative > 0,
      data: {
        raw_materials: rawMaterials.results || [],
        semi_finished: semiFinished,
        negative_lots: negativeLots.results || [],
        total_count: totalNegative
      }
    });
  } catch (error: any) {
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * 재고 불일치 자동 수정 (주의: 신중하게 사용)
 * POST /api/audit/fix-consistency
 * 
 * inbound LOT 합계를 기준으로 master.current_stock을 재계산
 */
auditRoutes.post('/fix-consistency', async (c) => {
  const { item_codes, fix_type, dry_run } = await c.req.json<{
    item_codes?: string[];  // 특정 품목만 수정 (없으면 전체)
    fix_type: 'master_to_lot' | 'lot_to_master';  // master 기준 또는 lot 기준
    dry_run?: boolean;  // true면 실제 수정 없이 시뮬레이션
  }>();

  if (!fix_type) {
    return c.json({
      success: false,
      error: 'fix_type 필수 (master_to_lot 또는 lot_to_master)'
    }, 400);
  }

  try {
    // 불일치 품목 조회
    let mismatchQuery = `
      SELECT 
        m.item_code,
        m.item_name,
        m.current_stock as master_stock,
        COALESCE(SUM(i.remain_qty), 0) as inbound_sum
      FROM master m
      LEFT JOIN inbound i ON m.item_code = i.item_code AND i.quality_status = '합격'
      WHERE m.category = '원료'
    `;
    const params: any[] = [];

    if (item_codes && item_codes.length > 0) {
      mismatchQuery += ` AND m.item_code IN (${item_codes.map(() => '?').join(',')})`;
      params.push(...item_codes);
    }

    mismatchQuery += `
      GROUP BY m.item_code, m.item_name, m.current_stock
      HAVING ABS(m.current_stock - COALESCE(SUM(i.remain_qty), 0)) > 0.001
    `;

    const mismatches = await c.env.DB.prepare(mismatchQuery).bind(...params).all<{
      item_code: string;
      item_name: string;
      master_stock: number;
      inbound_sum: number;
    }>();

    const items = mismatches.results || [];
    
    if (items.length === 0) {
      return c.json({
        success: true,
        message: '수정이 필요한 불일치 품목이 없습니다.'
      });
    }

    const fixes: Array<{
      item_code: string;
      item_name: string;
      old_value: number;
      new_value: number;
    }> = [];

    if (dry_run) {
      // 시뮬레이션
      for (const item of items) {
        fixes.push({
          item_code: item.item_code,
          item_name: item.item_name,
          old_value: fix_type === 'lot_to_master' ? item.master_stock : item.inbound_sum,
          new_value: fix_type === 'lot_to_master' ? item.inbound_sum : item.master_stock
        });
      }

      return c.json({
        success: true,
        dry_run: true,
        message: `${fixes.length}개 품목 수정 예정`,
        fixes
      });
    }

    // 실제 수정
    const updateStatements: D1PreparedStatement[] = [];

    if (fix_type === 'lot_to_master') {
      // LOT 합계를 master에 반영
      for (const item of items) {
        updateStatements.push(
          c.env.DB.prepare(`
            UPDATE master SET current_stock = ?, updated_at = CURRENT_TIMESTAMP
            WHERE item_code = ?
          `).bind(item.inbound_sum, item.item_code)
        );

        fixes.push({
          item_code: item.item_code,
          item_name: item.item_name,
          old_value: item.master_stock,
          new_value: item.inbound_sum
        });
      }
    } else {
      // master 기준으로 LOT 조정은 복잡하므로 지원하지 않음
      return c.json({
        success: false,
        error: 'master_to_lot 수정은 지원되지 않습니다. lot_to_master를 사용하세요.'
      }, 400);
    }

    // batch 실행
    await c.env.DB.batch(updateStatements);

    // 수정 로그 기록
    await c.env.DB.prepare(`
      INSERT INTO audit_logs (audit_type, audit_time, has_issues, total_mismatches, details, created_at)
      VALUES (?, ?, 0, 0, ?, CURRENT_TIMESTAMP)
    `).bind(
      'STOCK_FIX',
      new Date().toISOString(),
      JSON.stringify({ fix_type, fixed_count: fixes.length, fixes })
    ).run();

    return c.json({
      success: true,
      message: `${fixes.length}개 품목 재고 수정 완료`,
      fixes
    });

  } catch (error: any) {
    console.error('[AUDIT] 재고 수정 오류:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

// ===== inbound 테이블 전수 조사 =====

/**
 * inbound 테이블 전수 조사
 * LOT 누락 또는 음수 재고 데이터 추출
 * GET /api/audit/inbound-inspection
 */
auditRoutes.get('/inbound-inspection', async (c) => {
  try {
    // 1. LOT 번호가 누락된 데이터 (supplies 테이블 없을 수 있어서 master만 사용)
    const lotMissing = await c.env.DB.prepare(`
      SELECT 
        i.id,
        i.lot_number,
        i.item_code,
        COALESCE(m.item_name, '미등록') as item_name,
        COALESCE(m.category, '미분류') as category,
        i.inbound_date,
        i.expiry_date,
        i.origin_qty,
        i.remain_qty,
        i.quality_status,
        i.supplier,
        'LOT_MISSING' as issue_type
      FROM inbound i
      LEFT JOIN master m ON i.item_code = m.item_code
      WHERE i.lot_number IS NULL OR i.lot_number = ''
      ORDER BY i.inbound_date DESC, i.id DESC
    `).all();

    // 2. 잔량이 음수인 데이터
    const negativeRemain = await c.env.DB.prepare(`
      SELECT 
        i.id,
        i.lot_number,
        i.item_code,
        COALESCE(m.item_name, '미등록') as item_name,
        COALESCE(m.category, '미분류') as category,
        i.inbound_date,
        i.expiry_date,
        i.origin_qty,
        i.remain_qty,
        i.quality_status,
        i.supplier,
        'NEGATIVE_REMAIN' as issue_type
      FROM inbound i
      LEFT JOIN master m ON i.item_code = m.item_code
      WHERE i.remain_qty < 0
      ORDER BY i.remain_qty ASC, i.id DESC
    `).all();

    // 3. LOT 형식이 올바르지 않은 데이터 (선택적)
    const invalidFormat = await c.env.DB.prepare(`
      SELECT 
        i.id,
        i.lot_number,
        i.item_code,
        COALESCE(m.item_name, '미등록') as item_name,
        COALESCE(m.category, '미분류') as category,
        i.inbound_date,
        i.expiry_date,
        i.origin_qty,
        i.remain_qty,
        i.quality_status,
        i.supplier,
        'INVALID_FORMAT' as issue_type
      FROM inbound i
      LEFT JOIN master m ON i.item_code = m.item_code
      WHERE i.lot_number IS NOT NULL 
        AND i.lot_number != ''
        AND i.lot_number NOT LIKE '________-%-___'
        AND i.lot_number NOT LIKE '________-%-___-S'
      ORDER BY i.id DESC
      LIMIT 100
    `).all();

    const lotMissingList = lotMissing.results || [];
    const negativeRemainList = negativeRemain.results || [];
    const invalidFormatList = invalidFormat.results || [];

    // 통계 요약
    const stats = {
      total_issues: lotMissingList.length + negativeRemainList.length + invalidFormatList.length,
      lot_missing_count: lotMissingList.length,
      negative_remain_count: negativeRemainList.length,
      invalid_format_count: invalidFormatList.length,
      inspection_time: new Date().toISOString()
    };

    return c.json({
      success: true,
      stats,
      data: {
        lot_missing: lotMissingList,
        negative_remain: negativeRemainList,
        invalid_format: invalidFormatList
      }
    });
  } catch (error: any) {
    console.error('[AUDIT] inbound 전수 조사 오류:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * inbound 문제 데이터 일괄 수정 쿼리 생성
 * POST /api/audit/generate-fix-queries
 * 
 * 수정 규칙:
 * 1. LOT 누락: YYYYMMDD-품목코드-순번 형식으로 자동 생성
 * 2. 음수 잔량: 0으로 수정
 */
auditRoutes.post('/generate-fix-queries', async (c) => {
  const { fix_types, dry_run } = await c.req.json<{
    fix_types?: ('lot_missing' | 'negative_remain')[];
    dry_run?: boolean;  // true면 쿼리만 생성, 실행 안함
  }>();

  const typesToFix = fix_types || ['lot_missing', 'negative_remain'];
  const queries: Array<{
    id: number;
    issue_type: string;
    item_code: string;
    old_value: string | number | null;
    new_value: string | number;
    query: string;
  }> = [];

  try {
    // 1. LOT 누락 수정
    if (typesToFix.includes('lot_missing')) {
      const lotMissing = await c.env.DB.prepare(`
        SELECT id, item_code, inbound_date, lot_number
        FROM inbound
        WHERE lot_number IS NULL OR lot_number = ''
        ORDER BY inbound_date ASC, id ASC
      `).all<{
        id: number;
        item_code: string;
        inbound_date: string;
        lot_number: string | null;
      }>();

      const lotMissingList = lotMissing.results || [];

      // 날짜 + 품목코드별 순번 추적
      const sequenceMap = new Map<string, number>();

      for (const row of lotMissingList) {
        const key = `${row.inbound_date}-${row.item_code}`;
        
        // 기존 LOT 순번 조회 (이미 있는 LOT 번호들)
        if (!sequenceMap.has(key)) {
          const existingCount = await c.env.DB.prepare(`
            SELECT COUNT(*) as count FROM inbound 
            WHERE item_code = ? AND inbound_date = ? AND lot_number IS NOT NULL AND lot_number != ''
          `).bind(row.item_code, row.inbound_date).first<{ count: number }>();
          sequenceMap.set(key, existingCount?.count || 0);
        }

        const sequence = (sequenceMap.get(key) || 0) + 1;
        sequenceMap.set(key, sequence);

        // LOT 번호 생성 (YYYYMMDD-품목코드-순번)
        const dateStr = row.inbound_date.replace(/-/g, '');
        const newLot = `${dateStr}-${row.item_code}-${String(sequence).padStart(3, '0')}`;

        queries.push({
          id: row.id,
          issue_type: 'LOT_MISSING',
          item_code: row.item_code,
          old_value: row.lot_number,
          new_value: newLot,
          query: `UPDATE inbound SET lot_number = '${newLot}', updated_at = CURRENT_TIMESTAMP WHERE id = ${row.id};`
        });
      }
    }

    // 2. 음수 잔량 수정
    if (typesToFix.includes('negative_remain')) {
      const negativeRemain = await c.env.DB.prepare(`
        SELECT id, item_code, remain_qty, lot_number
        FROM inbound
        WHERE remain_qty < 0
      `).all<{
        id: number;
        item_code: string;
        remain_qty: number;
        lot_number: string;
      }>();

      const negativeRemainList = negativeRemain.results || [];

      for (const row of negativeRemainList) {
        queries.push({
          id: row.id,
          issue_type: 'NEGATIVE_REMAIN',
          item_code: row.item_code,
          old_value: row.remain_qty,
          new_value: 0,
          query: `UPDATE inbound SET remain_qty = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ${row.id};`
        });
      }
    }

    // dry_run이 아니면 실제 실행
    if (!dry_run && queries.length > 0) {
      const statements: D1PreparedStatement[] = [];

      for (const q of queries) {
        if (q.issue_type === 'LOT_MISSING') {
          statements.push(
            c.env.DB.prepare(`
              UPDATE inbound SET lot_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
            `).bind(q.new_value, q.id)
          );
        } else if (q.issue_type === 'NEGATIVE_REMAIN') {
          statements.push(
            c.env.DB.prepare(`
              UPDATE inbound SET remain_qty = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?
            `).bind(q.id)
          );
        }
      }

      // Atomic 실행
      await c.env.DB.batch(statements);

      // 수정 로그 기록
      await c.env.DB.prepare(`
        INSERT INTO audit_logs (audit_type, audit_time, has_issues, total_mismatches, details, created_at)
        VALUES (?, ?, 0, ?, ?, CURRENT_TIMESTAMP)
      `).bind(
        'INBOUND_DATA_FIX',
        new Date().toISOString(),
        queries.length,
        JSON.stringify({ fix_types: typesToFix, fixed_count: queries.length })
      ).run();

      return c.json({
        success: true,
        executed: true,
        message: `${queries.length}건의 데이터가 수정되었습니다.`,
        fix_summary: {
          lot_missing_fixed: queries.filter(q => q.issue_type === 'LOT_MISSING').length,
          negative_remain_fixed: queries.filter(q => q.issue_type === 'NEGATIVE_REMAIN').length
        },
        queries
      });
    }

    // dry_run인 경우 쿼리만 반환
    return c.json({
      success: true,
      executed: false,
      dry_run: true,
      message: `${queries.length}건의 수정 쿼리가 생성되었습니다. 실행하려면 dry_run: false로 요청하세요.`,
      fix_summary: {
        lot_missing_count: queries.filter(q => q.issue_type === 'LOT_MISSING').length,
        negative_remain_count: queries.filter(q => q.issue_type === 'NEGATIVE_REMAIN').length
      },
      queries
    });

  } catch (error: any) {
    console.error('[AUDIT] 수정 쿼리 생성 오류:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

/**
 * 전체 데이터 일관성 검증 보고서
 * GET /api/audit/full-report
 */
auditRoutes.get('/full-report', async (c) => {
  try {
    const reportTime = new Date().toISOString();
    const report: any = {
      report_time: reportTime,
      sections: {}
    };

    // 1. 원료 재고 일관성
    const rawMaterialConsistency = await auditStockConsistency(c.env.DB);
    report.sections.raw_material_consistency = {
      title: '원료 재고 일관성 (inbound vs master)',
      consistent: rawMaterialConsistency.success,
      total_checked: rawMaterialConsistency.total_checked,
      mismatch_count: rawMaterialConsistency.mismatch_count,
      sample_mismatches: rawMaterialConsistency.mismatches.slice(0, 5)
    };

    // 2. LOT 누락 검사
    const lotMissingCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM inbound WHERE lot_number IS NULL OR lot_number = ''
    `).first<{ count: number }>();
    report.sections.lot_missing = {
      title: 'LOT 번호 누락',
      count: lotMissingCount?.count || 0,
      status: (lotMissingCount?.count || 0) === 0 ? 'OK' : 'ISSUE'
    };

    // 3. 음수 재고 검사
    const negativeInbound = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM inbound WHERE remain_qty < 0
    `).first<{ count: number }>();
    const negativeMaster = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM master WHERE current_stock < 0
    `).first<{ count: number }>();
    report.sections.negative_stock = {
      title: '음수 재고',
      inbound_negative_count: negativeInbound?.count || 0,
      master_negative_count: negativeMaster?.count || 0,
      status: ((negativeInbound?.count || 0) + (negativeMaster?.count || 0)) === 0 ? 'OK' : 'ISSUE'
    };

    // 4. 전체 통계
    const totalInbound = await c.env.DB.prepare(`
      SELECT COUNT(*) as total, SUM(remain_qty) as total_remain FROM inbound
    `).first<{ total: number; total_remain: number }>();
    const totalMaster = await c.env.DB.prepare(`
      SELECT COUNT(*) as total, SUM(current_stock) as total_stock FROM master WHERE category = '원료'
    `).first<{ total: number; total_stock: number }>();

    report.sections.statistics = {
      title: '전체 통계',
      inbound_records: totalInbound?.total || 0,
      inbound_total_remain: totalInbound?.total_remain || 0,
      master_items: totalMaster?.total || 0,
      master_total_stock: totalMaster?.total_stock || 0
    };

    // 5. 전체 상태 판정
    const hasIssues = 
      !rawMaterialConsistency.success ||
      (lotMissingCount?.count || 0) > 0 ||
      (negativeInbound?.count || 0) > 0 ||
      (negativeMaster?.count || 0) > 0;

    report.overall_status = hasIssues ? 'ISSUES_FOUND' : 'ALL_OK';
    report.overall_message = hasIssues 
      ? '데이터 불일치가 발견되었습니다. 관리자 확인이 필요합니다.' 
      : '모든 데이터가 일관성을 유지하고 있습니다.';

    return c.json({
      success: true,
      report
    });

  } catch (error: any) {
    console.error('[AUDIT] 전체 보고서 생성 오류:', error);
    return c.json({
      success: false,
      error: error.message
    }, 500);
  }
});

export default auditRoutes;
