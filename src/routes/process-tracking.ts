// ★★★ v3.6.145: 생산공정 실시간 추적 시스템 ★★★
// 바코드 기반 공정시간 관리 - 성형명 기반 공정 라우팅, 배치 추적, 실시간 타이머
// v3.6.145: 성형명 마스터 추가 - 제품코드와 독립적인 성형/생산 명칭 관리

import { Hono } from 'hono';
import type { Bindings } from '../types';

const app = new Hono<{ Bindings: Bindings }>();

// ========== 데이터베이스 초기화 ==========
app.post('/init-db', async (c) => {
  try {
    // 1. 공정 마스터 테이블
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS process_master (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        process_code TEXT UNIQUE NOT NULL,
        process_name TEXT NOT NULL,
        process_name_en TEXT,
        default_order INTEGER DEFAULT 0,
        standard_minutes INTEGER DEFAULT 60,
        is_optional INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // 2. 제품별 공정 라우팅 테이블
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS product_process_routing (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_code TEXT NOT NULL,
        product_name TEXT NOT NULL,
        process_code TEXT NOT NULL,
        process_order INTEGER NOT NULL,
        standard_minutes INTEGER DEFAULT 60,
        is_optional INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_code, process_code)
      )
    `).run();

    // 3. 배치(배합) 테이블 - 바코드 발행 단위
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS production_batch (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_code TEXT UNIQUE NOT NULL,
        product_code TEXT NOT NULL,
        product_name TEXT NOT NULL,
        batch_quantity REAL,
        batch_unit TEXT DEFAULT 'kg',
        current_process_code TEXT,
        current_process_name TEXT,
        current_process_order INTEGER DEFAULT 0,
        status TEXT DEFAULT 'CREATED',
        started_at DATETIME,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        notes TEXT
      )
    `).run();

    // 4. 공정 추적 테이블 - 각 공정별 시작/종료 시간
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS process_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL,
        batch_code TEXT NOT NULL,
        process_code TEXT NOT NULL,
        process_name TEXT NOT NULL,
        process_order INTEGER NOT NULL,
        start_time DATETIME,
        end_time DATETIME,
        actual_minutes INTEGER,
        standard_minutes INTEGER,
        delay_minutes INTEGER,
        status TEXT DEFAULT 'PENDING',
        worker_id TEXT,
        worker_name TEXT,
        workstation_id TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (batch_id) REFERENCES production_batch(id)
      )
    `).run();

    // 5. 공정 이벤트 로그 - 모든 스캔 이벤트 기록
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS process_event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL,
        batch_code TEXT NOT NULL,
        process_code TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        worker_id TEXT,
        worker_name TEXT,
        device_id TEXT,
        workstation_id TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // ★★★ v3.6.145: 성형명 마스터 테이블 (제품코드와 독립) ★★★
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS shaping_name_master (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shaping_code TEXT UNIQUE NOT NULL,
        shaping_name TEXT NOT NULL,
        recipe_code TEXT,
        category TEXT,
        description TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // ★★★ v3.6.145: 성형명별 공정 라우팅 테이블 ★★★
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS shaping_process_routing (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shaping_id INTEGER NOT NULL,
        shaping_code TEXT NOT NULL,
        process_code TEXT NOT NULL,
        process_order INTEGER NOT NULL,
        standard_minutes INTEGER DEFAULT 60,
        is_optional INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(shaping_code, process_code),
        FOREIGN KEY (shaping_id) REFERENCES shaping_name_master(id)
      )
    `).run();

    // 인덱스 생성
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_batch_code ON production_batch(batch_code)`).run();
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_batch_status ON production_batch(status)`).run();
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_tracking_batch ON process_tracking(batch_id)`).run();
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_tracking_status ON process_tracking(status)`).run();
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_routing_product ON product_process_routing(product_code)`).run();
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_shaping_name ON shaping_name_master(shaping_name)`).run();
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_shaping_routing ON shaping_process_routing(shaping_code)`).run();

    // 기본 공정 데이터 삽입
    // ★★★ v3.6.144: 공정 마스터 확장 - 폴딩, 1차발효실전온도 등 추가 ★★★
    const defaultProcesses = [
      { code: 'RF_IN', name: '저온숙성 IN', name_en: 'RF PUT IN', order: 1, minutes: 480 },
      { code: 'RF_OUT', name: '저온숙성 OUT', name_en: 'RF TAKE OUT', order: 2, minutes: 0 },
      { code: 'PROOF_1ST', name: '1차 발효', name_en: '1st Proof', order: 3, minutes: 60, optional: 1 },
      { code: 'FOLDING_1', name: '①폴딩', name_en: 'Folding 1', order: 4, minutes: 5, optional: 1 },
      { code: 'FOLDING_2', name: '②폴딩', name_en: 'Folding 2', order: 5, minutes: 5, optional: 1 },
      { code: 'FOLDING_3', name: '③폴딩', name_en: 'Folding 3', order: 6, minutes: 5, optional: 1 },
      { code: 'FOLDING_4', name: '④폴딩', name_en: 'Folding 4', order: 7, minutes: 5, optional: 1 },
      { code: 'FOLDING_5', name: '⑤폴딩', name_en: 'Folding 5', order: 8, minutes: 5, optional: 1 },
      { code: 'PRE_PROOF_TEMP', name: '1차발효실전온도', name_en: 'Pre-Proof Temp Check', order: 9, minutes: 2, optional: 1 },
      { code: 'DIVIDING', name: '분할', name_en: 'Dividing', order: 10, minutes: 30 },
      { code: 'REST', name: '휴지', name_en: 'Rest', order: 11, minutes: 20 },
      { code: 'SHAPING', name: '성형', name_en: 'Molding/Shaping', order: 12, minutes: 30 },
      { code: 'PROOF_2ND', name: '2차 발효', name_en: '2nd Proof', order: 13, minutes: 60 },
      { code: 'BAKING', name: '굽기', name_en: 'Baking', order: 14, minutes: 25 },
      { code: 'COOLING', name: '냉각', name_en: 'Cooling', order: 15, minutes: 30 },
      { code: 'PACKING', name: '포장', name_en: 'Packing', order: 16, minutes: 20 }
    ];

    for (const p of defaultProcesses) {
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO process_master (process_code, process_name, process_name_en, default_order, standard_minutes, is_optional)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(p.code, p.name, p.name_en, p.order, p.minutes, p.optional || 0).run();
    }

    // ★★★ v3.6.145: 50+ 성형명 기본 데이터 삽입 ★★★
    const defaultShapingNames = [
      // 깜빠뉴/슬랩 계열
      { code: 'SH001', name: '컨트리 통밀 깜빠뉴 (통밀깜바뉴AA)R-①', recipe: 'R-①', category: '깜빠뉴' },
      { code: 'SH002', name: '컨트리 통밀 슬랩 (통밀깜바뉴AA)R-①', recipe: 'R-①', category: '슬랩' },
      { code: 'SH003', name: '멀티그레인 컨트리 깜빠뉴 (뺑오시리얼)R-②', recipe: 'R-②', category: '깜빠뉴' },
      { code: 'SH004', name: '멀티그레인 컨트리 슬랩 (뺑오시리얼)R-②', recipe: 'R-②', category: '슬랩' },
      { code: 'SH005', name: '잡곡 후르츠 사워도우 깜빠뉴 (뺑오시리얼후르츠)', recipe: '', category: '깜빠뉴' },
      { code: 'SH006', name: '호밀 사워도우 깜빠뉴 (CW)R-③', recipe: 'R-③', category: '깜빠뉴' },
      { code: 'SH007', name: '호밀 사워도우 슬랩 (CW)R-③', recipe: 'R-③', category: '슬랩' },
      { code: 'SH008', name: '호밀 사워도우 피칸 깜빠뉴 (CW)R-③', recipe: 'R-③', category: '깜빠뉴' },
      { code: 'SH009', name: '호밀 후르츠 사워도우 깜빠뉴 (CW)R-③', recipe: 'R-③', category: '깜빠뉴' },
      { code: 'SH010', name: '호밀통밀 사워도우 깜빠뉴 (뺑오)R-④', recipe: 'R-④', category: '깜빠뉴' },
      { code: 'SH011', name: '호밀통밀 사워도우 슬랩 (뺑오)R-④', recipe: 'R-④', category: '슬랩' },
      { code: 'SH012', name: '사워도우 슬랩 (크리스탈)R-⑤', recipe: 'R-⑤', category: '슬랩' },
      { code: 'SH013', name: '사워도우 치아바타 (크리스탈)', recipe: '', category: '치아바타' },
      { code: 'SH014', name: '사워도우 무화과 치아바타 (크리스탈)', recipe: '', category: '치아바타' },
      { code: 'SH015', name: '사워도우 올리브 치아바타 (크리스탈)', recipe: '', category: '치아바타' },
      { code: 'SH016', name: '버터 사워도우 깜빠뉴 (버터치아바타)R-⑥', recipe: 'R-⑥', category: '깜빠뉴' },
      { code: 'SH017', name: '버터 사워도우 슬랩 (버터치아바타)R-⑥', recipe: 'R-⑥', category: '슬랩' },
      { code: 'SH018', name: '오레가노 슬랩 (소프트르방)', recipe: '', category: '슬랩' },
      { code: 'SH019', name: '올리브 푸가스 (소프트르방)R-⑦', recipe: 'R-⑦', category: '푸가스' },
      { code: 'SH020', name: '토마토 푸가스 (소프트르방)R-⑦', recipe: 'R-⑦', category: '푸가스' },
      { code: 'SH021', name: '올리브 가득 치아바타 슬랩', recipe: '', category: '치아바타' },
      { code: 'SH022', name: '씨앗가득 치아바타 슬랩', recipe: '', category: '치아바타' },
      { code: 'SH023', name: '씨앗가득 치아바타 깜빠뉴', recipe: '', category: '깜빠뉴' },
      // 호밀 계열
      { code: 'SH024', name: '100% 호밀 사워도우', recipe: '', category: '호밀' },
      { code: 'SH025', name: '100% 호밀 사워도우 식빵', recipe: '', category: '호밀' },
      { code: 'SH026', name: '70% 호밀 사워도우', recipe: '', category: '호밀' },
      { code: 'SH027', name: '70% 호밀 사워도우 식빵', recipe: '', category: '호밀' },
      // 초코/카카오 계열
      { code: 'SH028', name: '초코 카카오 크림치즈 깜빠뉴', recipe: '', category: '초코' },
      { code: 'SH029', name: '더블 초코 카카오 깜빠뉴', recipe: '', category: '초코' },
      { code: 'SH030', name: '카카오 사워도우 깜빠뉴 (진한 초코)', recipe: '', category: '초코' },
      // 병아리콩/고단백 계열
      { code: 'SH031', name: '병아리콩 토마토 사워도우 슬랩', recipe: '', category: '고단백' },
      { code: 'SH032', name: '병아리콩 토마토 사워도우 깜빠뉴', recipe: '', category: '고단백' },
      { code: 'SH033', name: '고단백 슬랩', recipe: '', category: '고단백' },
      { code: 'SH034', name: '고단백 통밀 슬랩', recipe: '', category: '고단백' },
      // 브리오슈 계열
      { code: 'SH035', name: '밤 브리오슈', recipe: '', category: '브리오슈' },
      { code: 'SH036', name: '콩 브리오슈', recipe: '', category: '브리오슈' },
      { code: 'SH037', name: '오렌지 화이트초코 브리오슈', recipe: '', category: '브리오슈' },
      { code: 'SH038', name: '건포도 브리오슈', recipe: '', category: '브리오슈' },
      { code: 'SH039', name: '크랜베리 호두 브리오슈', recipe: '', category: '브리오슈' },
      { code: 'SH040', name: '호두 단팥 브리오슈', recipe: '', category: '브리오슈' },
      // 치아바타 계열
      { code: 'SH041', name: '버터 치아바타', recipe: '', category: '치아바타' },
      { code: 'SH042', name: '소프트 플레인 치아바타', recipe: '', category: '치아바타' },
      { code: 'SH043', name: '치즈 치아바타', recipe: '', category: '치아바타' },
      // 중복 제거된 초코 계열 (원래 데이터에 중복 있었음)
      // 이미 SH028, SH029, SH030에서 정의됨
    ];

    for (const s of defaultShapingNames) {
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO shaping_name_master (shaping_code, shaping_name, recipe_code, category)
        VALUES (?, ?, ?, ?)
      `).bind(s.code, s.name, s.recipe || null, s.category || null).run();
    }

    return c.json({ success: true, message: '공정 추적 및 성형명 마스터 테이블 초기화 완료' });
  } catch (error: any) {
    console.error('Init DB error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ========== 성형명 마스터 CRUD (v3.6.145) ==========

// 성형명 마스터 목록 조회
app.get('/shaping-master', async (c) => {
  try {
    const category = c.req.query('category');
    const search = c.req.query('search');
    
    let query = `SELECT * FROM shaping_name_master WHERE is_active = 1`;
    const params: any[] = [];
    
    if (category) {
      query += ` AND category = ?`;
      params.push(category);
    }
    if (search) {
      query += ` AND shaping_name LIKE ?`;
      params.push(`%${search}%`);
    }
    
    query += ` ORDER BY category, shaping_name`;
    
    const result = await c.env.DB.prepare(query).bind(...params).all();
    return c.json({ success: true, data: result.results });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 성형명 카테고리 목록
app.get('/shaping-master/categories', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT DISTINCT category, COUNT(*) as count 
      FROM shaping_name_master 
      WHERE is_active = 1 AND category IS NOT NULL
      GROUP BY category 
      ORDER BY category
    `).all();
    return c.json({ success: true, data: result.results });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 성형명 추가/수정
app.post('/shaping-master', async (c) => {
  try {
    const body = await c.req.json();
    const { shaping_code, shaping_name, recipe_code, category, description } = body;

    // 자동 코드 생성 (없는 경우)
    let code = shaping_code;
    if (!code) {
      const countResult = await c.env.DB.prepare(`
        SELECT COUNT(*) as cnt FROM shaping_name_master
      `).first();
      const seq = ((countResult?.cnt as number) || 0) + 1;
      code = `SH${String(seq).padStart(3, '0')}`;
    }

    await c.env.DB.prepare(`
      INSERT INTO shaping_name_master (shaping_code, shaping_name, recipe_code, category, description)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(shaping_code) DO UPDATE SET
        shaping_name = excluded.shaping_name,
        recipe_code = excluded.recipe_code,
        category = excluded.category,
        description = excluded.description,
        updated_at = CURRENT_TIMESTAMP
    `).bind(code, shaping_name, recipe_code || null, category || null, description || null).run();

    return c.json({ success: true, message: '성형명 저장 완료', data: { shaping_code: code } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 성형명 삭제 (비활성화)
app.delete('/shaping-master/:code', async (c) => {
  try {
    const code = c.req.param('code');
    await c.env.DB.prepare(`
      UPDATE shaping_name_master SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE shaping_code = ?
    `).bind(code).run();
    return c.json({ success: true, message: '성형명 삭제 완료' });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ========== 성형명별 공정 라우팅 (v3.6.145) ==========

// 성형명별 공정 라우팅 조회
app.get('/shaping-routing/:shapingCode', async (c) => {
  try {
    const shapingCode = c.req.param('shapingCode');
    const result = await c.env.DB.prepare(`
      SELECT r.*, m.shaping_name 
      FROM shaping_process_routing r
      JOIN shaping_name_master m ON m.shaping_code = r.shaping_code
      WHERE r.shaping_code = ? AND r.is_active = 1 
      ORDER BY r.process_order
    `).bind(shapingCode).all();
    return c.json({ success: true, data: result.results });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 성형명별 공정 라우팅 저장 (전체 덮어쓰기)
app.post('/shaping-routing/:shapingCode', async (c) => {
  try {
    const shapingCode = c.req.param('shapingCode');
    const body = await c.req.json();
    const { processes } = body;

    // 성형명 마스터에서 ID 조회
    const shaping = await c.env.DB.prepare(`
      SELECT id FROM shaping_name_master WHERE shaping_code = ?
    `).bind(shapingCode).first();

    if (!shaping) {
      return c.json({ success: false, error: '성형명을 찾을 수 없습니다' }, 404);
    }

    // 기존 라우팅 비활성화
    await c.env.DB.prepare(`
      UPDATE shaping_process_routing SET is_active = 0 WHERE shaping_code = ?
    `).bind(shapingCode).run();

    // 새 라우팅 저장
    for (const p of processes) {
      await c.env.DB.prepare(`
        INSERT INTO shaping_process_routing (shaping_id, shaping_code, process_code, process_order, standard_minutes, is_optional)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(shaping_code, process_code) DO UPDATE SET
          process_order = excluded.process_order,
          standard_minutes = excluded.standard_minutes,
          is_optional = excluded.is_optional,
          is_active = 1,
          updated_at = CURRENT_TIMESTAMP
      `).bind(shaping.id, shapingCode, p.process_code, p.process_order, p.standard_minutes || 60, p.is_optional || 0).run();
    }

    return c.json({ success: true, message: '성형명 공정 라우팅 저장 완료' });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 라우팅이 설정된 성형명 목록 조회
app.get('/shaping-routing-list', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT m.shaping_code, m.shaping_name, m.category, m.recipe_code,
             COUNT(r.id) as process_count,
             MAX(r.updated_at) as last_updated
      FROM shaping_name_master m
      LEFT JOIN shaping_process_routing r ON r.shaping_code = m.shaping_code AND r.is_active = 1
      WHERE m.is_active = 1
      GROUP BY m.shaping_code, m.shaping_name, m.category, m.recipe_code
      ORDER BY m.category, m.shaping_name
    `).all();
    return c.json({ success: true, data: result.results });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ========== 배치 생성 v3.6.145: 성형명 기반으로 변경 ==========

// 배치 바코드 생성 (성형명 기반)
app.post('/batch-by-shaping', async (c) => {
  try {
    const body = await c.req.json();
    const { shaping_code, batch_quantity, batch_unit, notes } = body;

    // 성형명 마스터 조회
    const shaping = await c.env.DB.prepare(`
      SELECT * FROM shaping_name_master WHERE shaping_code = ? AND is_active = 1
    `).bind(shaping_code).first();

    if (!shaping) {
      return c.json({ success: false, error: '성형명을 찾을 수 없습니다' }, 404);
    }

    // 오늘 날짜 기반 배치 코드 생성 (KST)
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstDate = new Date(now.getTime() + kstOffset);
    const dateStr = kstDate.toISOString().slice(0, 10).replace(/-/g, '');
    
    // 오늘 배치 수 조회
    const countResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM production_batch 
      WHERE batch_code LIKE ?
    `).bind(`BATCH-${dateStr}-%`).first();
    
    const seq = ((countResult?.cnt as number) || 0) + 1;
    const batchCode = `BATCH-${dateStr}-${String(seq).padStart(3, '0')}`;

    // 배치 생성 (성형명 정보 저장)
    const result = await c.env.DB.prepare(`
      INSERT INTO production_batch (batch_code, product_code, product_name, batch_quantity, batch_unit, status, notes)
      VALUES (?, ?, ?, ?, ?, 'CREATED', ?)
    `).bind(batchCode, shaping_code, shaping.shaping_name, batch_quantity || null, batch_unit || 'kg', notes || null).run();

    const batchId = result.meta.last_row_id;

    // 성형명별 공정 라우팅 조회 후 추적 레코드 생성
    const routing = await c.env.DB.prepare(`
      SELECT r.*, pm.process_name 
      FROM shaping_process_routing r
      LEFT JOIN process_master pm ON pm.process_code = r.process_code
      WHERE r.shaping_code = ? AND r.is_active = 1 
      ORDER BY r.process_order
    `).bind(shaping_code).all();

    if (routing.results.length > 0) {
      for (const r of routing.results as any[]) {
        await c.env.DB.prepare(`
          INSERT INTO process_tracking (batch_id, batch_code, process_code, process_name, process_order, standard_minutes, status)
          VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
        `).bind(batchId, batchCode, r.process_code, r.process_name || r.process_code, r.process_order, r.standard_minutes).run();
      }
    }

    return c.json({ 
      success: true, 
      data: { 
        batch_id: batchId, 
        batch_code: batchCode,
        shaping_code,
        shaping_name: shaping.shaping_name,
        category: shaping.category,
        process_count: routing.results.length
      },
      message: `배치 생성 완료: ${batchCode}` 
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ========== 공정 마스터 CRUD ==========

// 공정 마스터 목록 조회
app.get('/process-master', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT * FROM process_master WHERE is_active = 1 ORDER BY default_order
    `).all();
    return c.json({ success: true, data: result.results });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 공정 마스터 추가/수정
app.post('/process-master', async (c) => {
  try {
    const body = await c.req.json();
    const { process_code, process_name, process_name_en, default_order, standard_minutes, is_optional, description } = body;

    await c.env.DB.prepare(`
      INSERT INTO process_master (process_code, process_name, process_name_en, default_order, standard_minutes, is_optional, description)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(process_code) DO UPDATE SET
        process_name = excluded.process_name,
        process_name_en = excluded.process_name_en,
        default_order = excluded.default_order,
        standard_minutes = excluded.standard_minutes,
        is_optional = excluded.is_optional,
        description = excluded.description,
        updated_at = CURRENT_TIMESTAMP
    `).bind(process_code, process_name, process_name_en || null, default_order || 0, standard_minutes || 60, is_optional || 0, description || null).run();

    return c.json({ success: true, message: '공정 저장 완료' });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ========== 제품별 공정 라우팅 ==========

// 제품별 공정 라우팅 조회
app.get('/routing/:productCode', async (c) => {
  try {
    const productCode = c.req.param('productCode');
    const result = await c.env.DB.prepare(`
      SELECT * FROM product_process_routing 
      WHERE product_code = ? AND is_active = 1 
      ORDER BY process_order
    `).bind(productCode).all();
    return c.json({ success: true, data: result.results });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 제품별 공정 라우팅 저장 (전체 덮어쓰기)
app.post('/routing/:productCode', async (c) => {
  try {
    const productCode = c.req.param('productCode');
    const body = await c.req.json();
    const { product_name, processes } = body;

    // 기존 라우팅 비활성화
    await c.env.DB.prepare(`
      UPDATE product_process_routing SET is_active = 0 WHERE product_code = ?
    `).bind(productCode).run();

    // 새 라우팅 저장
    for (const p of processes) {
      await c.env.DB.prepare(`
        INSERT INTO product_process_routing (product_code, product_name, process_code, process_order, standard_minutes, is_optional)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(product_code, process_code) DO UPDATE SET
          process_order = excluded.process_order,
          standard_minutes = excluded.standard_minutes,
          is_optional = excluded.is_optional,
          is_active = 1,
          updated_at = CURRENT_TIMESTAMP
      `).bind(productCode, product_name, p.process_code, p.process_order, p.standard_minutes || 60, p.is_optional || 0).run();
    }

    return c.json({ success: true, message: '공정 라우팅 저장 완료' });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 라우팅이 설정된 제품 목록 조회
app.get('/routing-products', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT DISTINCT product_code, product_name, 
             COUNT(*) as process_count,
             MAX(updated_at) as last_updated
      FROM product_process_routing 
      WHERE is_active = 1 
      GROUP BY product_code, product_name
      ORDER BY product_name
    `).all();
    return c.json({ success: true, data: result.results });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ========== 배치(배합) 관리 ==========

// 배치 바코드 생성
app.post('/batch', async (c) => {
  try {
    const body = await c.req.json();
    const { product_code, product_name, batch_quantity, batch_unit, notes } = body;

    // 오늘 날짜 기반 배치 코드 생성 (KST)
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstDate = new Date(now.getTime() + kstOffset);
    const dateStr = kstDate.toISOString().slice(0, 10).replace(/-/g, '');
    
    // 오늘 배치 수 조회
    const countResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as cnt FROM production_batch 
      WHERE batch_code LIKE ?
    `).bind(`BATCH-${dateStr}-%`).first();
    
    const seq = ((countResult?.cnt as number) || 0) + 1;
    const batchCode = `BATCH-${dateStr}-${String(seq).padStart(3, '0')}`;

    // 배치 생성
    const result = await c.env.DB.prepare(`
      INSERT INTO production_batch (batch_code, product_code, product_name, batch_quantity, batch_unit, status, notes)
      VALUES (?, ?, ?, ?, ?, 'CREATED', ?)
    `).bind(batchCode, product_code, product_name, batch_quantity || null, batch_unit || 'kg', notes || null).run();

    const batchId = result.meta.last_row_id;

    // 제품별 공정 라우팅 조회 후 추적 레코드 생성
    const routing = await c.env.DB.prepare(`
      SELECT * FROM product_process_routing 
      WHERE product_code = ? AND is_active = 1 
      ORDER BY process_order
    `).bind(product_code).all();

    if (routing.results.length > 0) {
      for (const r of routing.results as any[]) {
        await c.env.DB.prepare(`
          INSERT INTO process_tracking (batch_id, batch_code, process_code, process_name, process_order, standard_minutes, status)
          VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
        `).bind(batchId, batchCode, r.process_code, r.process_code, r.process_order, r.standard_minutes).run();
      }
    }

    return c.json({ 
      success: true, 
      data: { 
        batch_id: batchId, 
        batch_code: batchCode,
        product_code,
        product_name,
        process_count: routing.results.length
      },
      message: `배치 생성 완료: ${batchCode}` 
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 배치 목록 조회
app.get('/batch', async (c) => {
  try {
    const status = c.req.query('status');
    const date = c.req.query('date');
    
    let query = `
      SELECT b.*, 
             (SELECT COUNT(*) FROM process_tracking WHERE batch_id = b.id AND status = 'COMPLETED') as completed_count,
             (SELECT COUNT(*) FROM process_tracking WHERE batch_id = b.id) as total_count
      FROM production_batch b
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) {
      query += ` AND b.status = ?`;
      params.push(status);
    }

    if (date) {
      query += ` AND DATE(b.created_at) = ?`;
      params.push(date);
    }

    query += ` ORDER BY b.created_at DESC LIMIT 100`;

    const result = await c.env.DB.prepare(query).bind(...params).all();
    return c.json({ success: true, data: result.results });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 배치 상세 조회 (바코드 스캔 시)
app.get('/batch/:batchCode', async (c) => {
  try {
    const batchCode = c.req.param('batchCode');
    
    // 배치 정보
    const batch = await c.env.DB.prepare(`
      SELECT * FROM production_batch WHERE batch_code = ?
    `).bind(batchCode).first();

    if (!batch) {
      return c.json({ success: false, error: '배치를 찾을 수 없습니다' }, 404);
    }

    // 공정 추적 정보
    const tracking = await c.env.DB.prepare(`
      SELECT * FROM process_tracking WHERE batch_id = ? ORDER BY process_order
    `).bind(batch.id).all();

    // 현재 진행 중인 공정 찾기
    const currentProcess = tracking.results.find((t: any) => t.status === 'IN_PROGRESS');
    const nextProcess = tracking.results.find((t: any) => t.status === 'PENDING');

    return c.json({ 
      success: true, 
      data: {
        batch,
        processes: tracking.results,
        current_process: currentProcess || null,
        next_process: nextProcess || null
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ========== 공정 스캔 (핵심 기능) ==========

// 공정 시작 스캔
app.post('/scan/start', async (c) => {
  try {
    const body = await c.req.json();
    const { batch_code, process_code, worker_id, worker_name, workstation_id, device_id } = body;

    // 배치 조회
    const batch = await c.env.DB.prepare(`
      SELECT * FROM production_batch WHERE batch_code = ?
    `).bind(batch_code).first();

    if (!batch) {
      return c.json({ success: false, error: '배치를 찾을 수 없습니다' }, 404);
    }

    // 현재 진행 중인 공정이 있는지 확인
    const inProgress = await c.env.DB.prepare(`
      SELECT * FROM process_tracking 
      WHERE batch_id = ? AND status = 'IN_PROGRESS'
    `).bind(batch.id).first();

    if (inProgress) {
      return c.json({ 
        success: false, 
        error: `현재 '${inProgress.process_name}' 공정이 진행 중입니다. 먼저 종료해주세요.`,
        current_process: inProgress
      }, 400);
    }

    // 다음 공정 확인 (process_code가 없으면 자동으로 다음 공정)
    let targetProcess;
    if (process_code) {
      targetProcess = await c.env.DB.prepare(`
        SELECT * FROM process_tracking 
        WHERE batch_id = ? AND process_code = ? AND status = 'PENDING'
      `).bind(batch.id, process_code).first();
    } else {
      targetProcess = await c.env.DB.prepare(`
        SELECT * FROM process_tracking 
        WHERE batch_id = ? AND status = 'PENDING'
        ORDER BY process_order LIMIT 1
      `).bind(batch.id).first();
    }

    if (!targetProcess) {
      return c.json({ success: false, error: '시작할 수 있는 공정이 없습니다' }, 400);
    }

    const now = new Date().toISOString();

    // 공정 시작
    await c.env.DB.prepare(`
      UPDATE process_tracking 
      SET status = 'IN_PROGRESS', start_time = ?, worker_id = ?, worker_name = ?, workstation_id = ?, updated_at = ?
      WHERE id = ?
    `).bind(now, worker_id || null, worker_name || null, workstation_id || null, now, targetProcess.id).run();

    // 배치 상태 업데이트
    await c.env.DB.prepare(`
      UPDATE production_batch 
      SET status = 'IN_PROGRESS', 
          current_process_code = ?, 
          current_process_name = ?,
          current_process_order = ?,
          started_at = COALESCE(started_at, ?),
          updated_at = ?
      WHERE id = ?
    `).bind(targetProcess.process_code, targetProcess.process_name, targetProcess.process_order, now, now, batch.id).run();

    // 이벤트 로그
    await c.env.DB.prepare(`
      INSERT INTO process_event_log (batch_id, batch_code, process_code, event_type, event_time, worker_id, worker_name, device_id, workstation_id)
      VALUES (?, ?, ?, 'START', ?, ?, ?, ?, ?)
    `).bind(batch.id, batch_code, targetProcess.process_code, now, worker_id || null, worker_name || null, device_id || null, workstation_id || null).run();

    return c.json({ 
      success: true, 
      message: `${targetProcess.process_name} 공정 시작`,
      data: {
        batch_code,
        process_code: targetProcess.process_code,
        process_name: targetProcess.process_name,
        start_time: now,
        standard_minutes: targetProcess.standard_minutes
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 공정 종료 스캔
app.post('/scan/end', async (c) => {
  try {
    const body = await c.req.json();
    const { batch_code, worker_id, worker_name, device_id, notes } = body;

    // 배치 조회
    const batch = await c.env.DB.prepare(`
      SELECT * FROM production_batch WHERE batch_code = ?
    `).bind(batch_code).first();

    if (!batch) {
      return c.json({ success: false, error: '배치를 찾을 수 없습니다' }, 404);
    }

    // 현재 진행 중인 공정 조회
    const currentProcess = await c.env.DB.prepare(`
      SELECT * FROM process_tracking 
      WHERE batch_id = ? AND status = 'IN_PROGRESS'
    `).bind(batch.id).first();

    if (!currentProcess) {
      return c.json({ success: false, error: '진행 중인 공정이 없습니다' }, 400);
    }

    const now = new Date().toISOString();
    const startTime = new Date(currentProcess.start_time as string);
    const endTime = new Date(now);
    const actualMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);
    const delayMinutes = actualMinutes - (currentProcess.standard_minutes as number);

    // 공정 종료
    await c.env.DB.prepare(`
      UPDATE process_tracking 
      SET status = 'COMPLETED', 
          end_time = ?, 
          actual_minutes = ?, 
          delay_minutes = ?,
          notes = COALESCE(?, notes),
          updated_at = ?
      WHERE id = ?
    `).bind(now, actualMinutes, delayMinutes, notes || null, now, currentProcess.id).run();

    // 다음 공정 확인
    const nextProcess = await c.env.DB.prepare(`
      SELECT * FROM process_tracking 
      WHERE batch_id = ? AND status = 'PENDING'
      ORDER BY process_order LIMIT 1
    `).bind(batch.id).first();

    // 배치 상태 업데이트
    if (nextProcess) {
      await c.env.DB.prepare(`
        UPDATE production_batch 
        SET current_process_code = NULL, 
            current_process_name = NULL,
            updated_at = ?
        WHERE id = ?
      `).bind(now, batch.id).run();
    } else {
      // 모든 공정 완료
      await c.env.DB.prepare(`
        UPDATE production_batch 
        SET status = 'COMPLETED', 
            current_process_code = NULL, 
            current_process_name = NULL,
            completed_at = ?,
            updated_at = ?
        WHERE id = ?
      `).bind(now, now, batch.id).run();
    }

    // 이벤트 로그
    await c.env.DB.prepare(`
      INSERT INTO process_event_log (batch_id, batch_code, process_code, event_type, event_time, worker_id, worker_name, device_id, notes)
      VALUES (?, ?, ?, 'END', ?, ?, ?, ?, ?)
    `).bind(batch.id, batch_code, currentProcess.process_code, now, worker_id || null, worker_name || null, device_id || null, notes || null).run();

    return c.json({ 
      success: true, 
      message: `${currentProcess.process_name} 공정 완료 (${actualMinutes}분 소요)`,
      data: {
        batch_code,
        completed_process: {
          process_code: currentProcess.process_code,
          process_name: currentProcess.process_name,
          start_time: currentProcess.start_time,
          end_time: now,
          actual_minutes: actualMinutes,
          standard_minutes: currentProcess.standard_minutes,
          delay_minutes: delayMinutes
        },
        next_process: nextProcess ? {
          process_code: nextProcess.process_code,
          process_name: nextProcess.process_name,
          standard_minutes: nextProcess.standard_minutes
        } : null,
        is_all_completed: !nextProcess
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ========== 실시간 대시보드 ==========

// 현재 진행 중인 모든 배치 현황
app.get('/dashboard/active', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT 
        b.*,
        pt.process_code as current_process_code,
        pt.process_name as current_process_name,
        pt.start_time,
        pt.standard_minutes,
        CAST((julianday('now') - julianday(pt.start_time)) * 24 * 60 AS INTEGER) as elapsed_minutes
      FROM production_batch b
      LEFT JOIN process_tracking pt ON pt.batch_id = b.id AND pt.status = 'IN_PROGRESS'
      WHERE b.status IN ('CREATED', 'IN_PROGRESS')
      ORDER BY b.created_at DESC
    `).all();

    // 각 배치별 상태 계산
    const data = result.results.map((r: any) => {
      let statusLevel = 'normal';
      if (r.elapsed_minutes && r.standard_minutes) {
        const ratio = r.elapsed_minutes / r.standard_minutes;
        if (ratio >= 1.5) statusLevel = 'critical';
        else if (ratio >= 1.0) statusLevel = 'delayed';
        else if (ratio >= 0.8) statusLevel = 'warning';
      }
      return { ...r, status_level: statusLevel };
    });

    return c.json({ success: true, data });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 공정별 현황 요약
app.get('/dashboard/summary', async (c) => {
  try {
    // 공정별 진행 중인 배치 수
    const byProcess = await c.env.DB.prepare(`
      SELECT 
        pt.process_code,
        pt.process_name,
        COUNT(*) as batch_count,
        AVG(CAST((julianday('now') - julianday(pt.start_time)) * 24 * 60 AS INTEGER)) as avg_elapsed
      FROM process_tracking pt
      JOIN production_batch b ON b.id = pt.batch_id
      WHERE pt.status = 'IN_PROGRESS' AND b.status = 'IN_PROGRESS'
      GROUP BY pt.process_code, pt.process_name
    `).all();

    // 전체 현황
    const total = await c.env.DB.prepare(`
      SELECT 
        COUNT(CASE WHEN status = 'CREATED' THEN 1 END) as created,
        COUNT(CASE WHEN status = 'IN_PROGRESS' THEN 1 END) as in_progress,
        COUNT(CASE WHEN status = 'COMPLETED' AND DATE(completed_at) = DATE('now') THEN 1 END) as completed_today
      FROM production_batch
    `).first();

    // 지연 배치 수
    const delayed = await c.env.DB.prepare(`
      SELECT COUNT(*) as count
      FROM process_tracking pt
      JOIN production_batch b ON b.id = pt.batch_id
      WHERE pt.status = 'IN_PROGRESS' 
        AND b.status = 'IN_PROGRESS'
        AND CAST((julianday('now') - julianday(pt.start_time)) * 24 * 60 AS INTEGER) > pt.standard_minutes
    `).first();

    return c.json({ 
      success: true, 
      data: {
        by_process: byProcess.results,
        total: total,
        delayed_count: delayed?.count || 0
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 배치 이력 조회
app.get('/history/:batchCode', async (c) => {
  try {
    const batchCode = c.req.param('batchCode');
    
    const batch = await c.env.DB.prepare(`
      SELECT * FROM production_batch WHERE batch_code = ?
    `).bind(batchCode).first();

    if (!batch) {
      return c.json({ success: false, error: '배치를 찾을 수 없습니다' }, 404);
    }

    const tracking = await c.env.DB.prepare(`
      SELECT * FROM process_tracking WHERE batch_id = ? ORDER BY process_order
    `).bind(batch.id).all();

    const events = await c.env.DB.prepare(`
      SELECT * FROM process_event_log WHERE batch_id = ? ORDER BY event_time
    `).bind(batch.id).all();

    return c.json({ 
      success: true, 
      data: {
        batch,
        processes: tracking.results,
        events: events.results
      }
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// 공정 건너뛰기 (관리자용)
app.post('/skip-process', async (c) => {
  try {
    const body = await c.req.json();
    const { batch_code, process_code, reason, admin_id, admin_name } = body;

    const batch = await c.env.DB.prepare(`
      SELECT * FROM production_batch WHERE batch_code = ?
    `).bind(batch_code).first();

    if (!batch) {
      return c.json({ success: false, error: '배치를 찾을 수 없습니다' }, 404);
    }

    const now = new Date().toISOString();

    // 공정 스킵 처리
    await c.env.DB.prepare(`
      UPDATE process_tracking 
      SET status = 'SKIPPED', notes = ?, updated_at = ?
      WHERE batch_id = ? AND process_code = ?
    `).bind(`[SKIP] ${reason || ''} by ${admin_name || admin_id}`, now, batch.id, process_code).run();

    // 이벤트 로그
    await c.env.DB.prepare(`
      INSERT INTO process_event_log (batch_id, batch_code, process_code, event_type, event_time, worker_id, worker_name, notes)
      VALUES (?, ?, ?, 'SKIP', ?, ?, ?, ?)
    `).bind(batch.id, batch_code, process_code, now, admin_id || null, admin_name || null, reason || null).run();

    return c.json({ success: true, message: '공정 건너뛰기 완료' });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
