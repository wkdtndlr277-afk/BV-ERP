import { Hono } from 'hono';
import type { Bindings } from '../types';

const app = new Hono<{ Bindings: Bindings }>();

// ===== 부서 목록 =====
app.get('/departments', async (c) => {
  try {
    const results = await c.env.DB.prepare(`
      SELECT * FROM task_departments WHERE is_active = 1 ORDER BY sort_order
    `).all();
    return c.json({ success: true, data: results.results || [] });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ===== 부서 수정 =====
app.put('/departments/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { name, description, color, sort_order } = body;
  
  try {
    const updates: string[] = [];
    const values: any[] = [];
    
    if (name) { updates.push('name = ?'); values.push(name); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (color) { updates.push('color = ?'); values.push(color); }
    if (sort_order !== undefined) { updates.push('sort_order = ?'); values.push(sort_order); }
    
    if (updates.length === 0) {
      return c.json({ success: false, error: '수정할 내용이 없습니다' }, 400);
    }
    
    values.push(id);
    await c.env.DB.prepare(`UPDATE task_departments SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
    
    return c.json({ success: true, message: '부서가 수정되었습니다' });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ===== 업무/공지 목록 =====
app.get('/tasks', async (c) => {
  const month = c.req.query('month');
  
  try {
    let query = `
      SELECT t.*, 
        (SELECT COUNT(*) FROM task_checks WHERE task_id = t.id AND status = '완료') as completed_count,
        (SELECT COUNT(*) FROM task_checks WHERE task_id = t.id) as total_count,
        (SELECT COUNT(*) FROM task_files WHERE task_id = t.id AND department_id IS NULL) as file_count
      FROM tasks t
    `;
    
    if (month) {
      query += ` WHERE strftime('%Y-%m', t.due_date) = '${month}'`;
    }
    
    query += ' ORDER BY t.due_date DESC, t.created_at DESC';
    
    const results = await c.env.DB.prepare(query).all();
    return c.json({ success: true, data: results.results || [] });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ===== 업무 상세 =====
app.get('/tasks/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    const task = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
    
    const checks = await c.env.DB.prepare(`
      SELECT tc.*, d.name as department_name, d.color as department_color
      FROM task_checks tc
      LEFT JOIN task_departments d ON tc.department_id = d.id
      WHERE tc.task_id = ?
      ORDER BY d.sort_order
    `).bind(id).all();
    
    const mainFiles = await c.env.DB.prepare(`
      SELECT * FROM task_files WHERE task_id = ? AND department_id IS NULL ORDER BY created_at DESC
    `).bind(id).all();
    
    const deptFiles = await c.env.DB.prepare(`
      SELECT tf.*, d.name as department_name 
      FROM task_files tf
      LEFT JOIN task_departments d ON tf.department_id = d.id
      WHERE tf.task_id = ? AND tf.department_id IS NOT NULL
      ORDER BY tf.department_id, tf.created_at DESC
    `).bind(id).all();
    
    const history = await c.env.DB.prepare(`
      SELECT h.*, d.name as department_name, d.color as department_color
      FROM task_history h
      LEFT JOIN task_departments d ON h.department_id = d.id
      WHERE h.task_id = ?
      ORDER BY h.created_at DESC
    `).bind(id).all();
    
    return c.json({ 
      success: true, 
      data: { 
        ...task, 
        checks: checks.results || [],
        files: mainFiles.results || [],
        dept_files: deptFiles.results || [],
        history: history.results || []
      }
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ===== 업무 등록 =====
app.post('/tasks', async (c) => {
  const body = await c.req.json();
  const { title, content, type, priority, due_date, target_departments } = body;
  
  if (!title || !due_date) {
    return c.json({ success: false, error: '제목과 날짜를 입력해주세요' }, 400);
  }
  
  try {
    const result = await c.env.DB.prepare(`
      INSERT INTO tasks (title, content, type, priority, due_date)
      VALUES (?, ?, ?, ?, ?)
    `).bind(title, content || '', type || 'task', priority || 'normal', due_date).run();
    
    const taskId = result.meta.last_row_id;
    
    // 대상 부서 체크 항목 생성
    const depts = target_departments?.length > 0 
      ? target_departments 
      : (await c.env.DB.prepare('SELECT id FROM task_departments WHERE is_active = 1').all()).results?.map((d: any) => d.id) || [];
    
    for (const deptId of depts) {
      await c.env.DB.prepare(`
        INSERT INTO task_checks (task_id, department_id, status, progress)
        VALUES (?, ?, '대기', 0)
      `).bind(taskId, deptId).run();
    }
    
    return c.json({ success: true, message: '등록되었습니다', id: taskId });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ===== 업무 수정 =====
app.put('/tasks/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { title, content, type, priority, due_date } = body;
  
  try {
    await c.env.DB.prepare(`
      UPDATE tasks SET title = ?, content = ?, type = ?, priority = ?, due_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(title, content, type, priority || 'normal', due_date, id).run();
    return c.json({ success: true, message: '수정되었습니다' });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ===== 업무 삭제 =====
app.delete('/tasks/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await c.env.DB.prepare('DELETE FROM task_history WHERE task_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM task_checks WHERE task_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM task_files WHERE task_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
    return c.json({ success: true, message: '삭제되었습니다' });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ===== 부서별 진행상황 업데이트 =====
app.post('/tasks/:id/check', async (c) => {
  const taskId = c.req.param('id');
  const { department_id, status, progress, comment, checked_by } = await c.req.json();
  
  try {
    // 기존 상태 조회
    const existing = await c.env.DB.prepare(`
      SELECT status, progress, comment FROM task_checks WHERE task_id = ? AND department_id = ?
    `).bind(taskId, department_id).first() as any;
    
    const oldStatus = existing?.status || '대기';
    const oldProgress = existing?.progress || 0;
    
    // 상태 업데이트
    await c.env.DB.prepare(`
      UPDATE task_checks 
      SET status = ?, progress = ?, comment = ?, checked_by = ?, checked_at = CURRENT_TIMESTAMP
      WHERE task_id = ? AND department_id = ?
    `).bind(status || '대기', progress || 0, comment || '', checked_by || '', taskId, department_id).run();
    
    // 이력 기록
    if (oldStatus !== status || oldProgress !== progress) {
      await c.env.DB.prepare(`
        INSERT INTO task_history (task_id, department_id, action, old_status, new_status, old_progress, new_progress, comment, action_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        taskId, department_id,
        oldStatus !== status ? 'status_change' : 'progress_update',
        oldStatus, status || '대기',
        oldProgress, progress || 0,
        comment || '', checked_by || ''
      ).run();
    }
    
    return c.json({ success: true, message: '업데이트되었습니다' });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ===== 파일 업로드 =====
app.post('/tasks/:id/files', async (c) => {
  const taskId = c.req.param('id');
  
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File;
    const departmentId = formData.get('department_id') as string | null;
    
    if (!file) {
      return c.json({ success: false, error: '파일이 없습니다' }, 400);
    }
    
    const fileName = `${Date.now()}_${file.name}`;
    const deptPath = departmentId ? `dept${departmentId}/` : '';
    const fileKey = `tasks/${taskId}/${deptPath}${fileName}`;
    
    await c.env.DB.prepare(`
      INSERT INTO task_files (task_id, department_id, file_name, file_key, file_size, file_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(taskId, departmentId ? parseInt(departmentId) : null, file.name, fileKey, file.size, file.type).run();
    
    return c.json({ success: true, message: '파일이 업로드되었습니다', file_key: fileKey });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ===== 파일 삭제 =====
app.delete('/files/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await c.env.DB.prepare('DELETE FROM task_files WHERE id = ?').bind(id).run();
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ===== 캘린더 데이터 =====
app.get('/calendar', async (c) => {
  const month = c.req.query('month');
  
  if (!month) {
    return c.json({ success: false, error: '월을 지정해주세요' }, 400);
  }
  
  try {
    const tasks = await c.env.DB.prepare(`
      SELECT t.id, t.title, t.type, t.priority, t.due_date,
        (SELECT COUNT(*) FROM task_checks WHERE task_id = t.id AND status = '완료') as completed_count,
        (SELECT COUNT(*) FROM task_checks WHERE task_id = t.id) as total_count
      FROM tasks t
      WHERE strftime('%Y-%m', t.due_date) = ?
      ORDER BY t.due_date, t.created_at
    `).bind(month).all();
    
    return c.json({ success: true, data: tasks.results || [] });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ===== 부서별 현황 요약 =====
app.get('/department-summary', async (c) => {
  const month = c.req.query('month');
  const now = new Date();
  const currentMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  try {
    const summary = await c.env.DB.prepare(`
      SELECT 
        d.id, d.name, d.color,
        COUNT(tc.id) as total_tasks,
        SUM(CASE WHEN tc.status = '완료' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN tc.status = '진행중' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN tc.status = '대기' THEN 1 ELSE 0 END) as pending
      FROM task_departments d
      LEFT JOIN task_checks tc ON d.id = tc.department_id
      LEFT JOIN tasks t ON tc.task_id = t.id AND strftime('%Y-%m', t.due_date) = ?
      WHERE d.is_active = 1
      GROUP BY d.id
      ORDER BY d.sort_order
    `).bind(currentMonth).all();
    
    return c.json({ success: true, data: summary.results || [] });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ===== 대표용 대시보드 =====
app.get('/ceo-dashboard', async (c) => {
  const month = c.req.query('month');
  const now = new Date();
  const currentMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  try {
    const tasks = await c.env.DB.prepare(`
      SELECT 
        t.id, t.title, t.type, t.priority, t.due_date, t.created_at,
        (SELECT COUNT(*) FROM task_checks WHERE task_id = t.id AND status = '완료') as completed_count,
        (SELECT COUNT(*) FROM task_checks WHERE task_id = t.id) as total_count
      FROM tasks t
      WHERE strftime('%Y-%m', t.due_date) = ?
      ORDER BY t.due_date DESC, t.created_at DESC
    `).bind(currentMonth).all();
    
    const taskIds = (tasks.results || []).map((t: any) => t.id);
    let checksMap: Record<number, any[]> = {};
    
    if (taskIds.length > 0) {
      const checks = await c.env.DB.prepare(`
        SELECT tc.task_id, tc.department_id, tc.status, tc.progress, tc.comment, tc.checked_by, tc.checked_at,
               d.name as department_name, d.color as department_color
        FROM task_checks tc
        LEFT JOIN task_departments d ON tc.department_id = d.id
        WHERE tc.task_id IN (${taskIds.join(',')})
        ORDER BY d.sort_order
      `).all();
      
      for (const c of (checks.results || []) as any[]) {
        if (!checksMap[c.task_id]) checksMap[c.task_id] = [];
        checksMap[c.task_id].push(c);
      }
    }
    
    const departments = await c.env.DB.prepare(`
      SELECT id, name, color FROM task_departments WHERE is_active = 1 ORDER BY sort_order
    `).all();
    
    const stats = await c.env.DB.prepare(`
      SELECT 
        COUNT(DISTINCT t.id) as total_tasks,
        SUM(CASE WHEN tc.status = '완료' THEN 1 ELSE 0 END) as total_completed,
        SUM(CASE WHEN tc.status = '진행중' THEN 1 ELSE 0 END) as total_in_progress,
        SUM(CASE WHEN tc.status = '대기' THEN 1 ELSE 0 END) as total_pending
      FROM tasks t
      LEFT JOIN task_checks tc ON t.id = tc.task_id
      WHERE strftime('%Y-%m', t.due_date) = ?
    `).bind(currentMonth).first();
    
    const taskList = (tasks.results || []).map((t: any) => ({
      ...t,
      checks: checksMap[t.id] || []
    }));
    
    return c.json({ 
      success: true, 
      data: {
        tasks: taskList,
        departments: departments.results || [],
        stats: stats || { total_tasks: 0, total_completed: 0, total_in_progress: 0, total_pending: 0 },
        month: currentMonth
      }
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ===== 업무 이력 =====
app.get('/history', async (c) => {
  const month = c.req.query('month');
  const deptId = c.req.query('department_id');
  const now = new Date();
  const currentMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  try {
    let query = `
      SELECT h.*, t.title as task_title, t.type as task_type, t.due_date,
             d.name as department_name, d.color as department_color
      FROM task_history h
      LEFT JOIN tasks t ON h.task_id = t.id
      LEFT JOIN task_departments d ON h.department_id = d.id
      WHERE strftime('%Y-%m', h.created_at) = ?
    `;
    const params: any[] = [currentMonth];
    
    if (deptId) {
      query += ` AND h.department_id = ?`;
      params.push(deptId);
    }
    
    query += ` ORDER BY h.created_at DESC LIMIT 100`;
    
    const history = await c.env.DB.prepare(query).bind(...params).all();
    
    return c.json({ success: true, data: history.results || [] });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ===== 새 공지/업무 알림 조회 (팝업용) =====
app.get('/notifications', async (c) => {
  const since = c.req.query('since'); // ISO timestamp
  const deptId = c.req.query('department_id');
  
  try {
    let query = `
      SELECT t.*, 
        (SELECT COUNT(*) FROM task_checks WHERE task_id = t.id) as total_count
      FROM tasks t
      WHERE 1=1
    `;
    const params: any[] = [];
    
    if (since) {
      query += ` AND t.created_at > ?`;
      params.push(since);
    } else {
      // 기본: 오늘 등록된 것만
      query += ` AND date(t.created_at) = date('now')`;
    }
    
    query += ` ORDER BY t.created_at DESC LIMIT 10`;
    
    const tasks = params.length > 0 
      ? await c.env.DB.prepare(query).bind(...params).all()
      : await c.env.DB.prepare(query).all();
    
    return c.json({ success: true, data: tasks.results || [] });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ===== 읽음 처리 =====
app.post('/notifications/:id/read', async (c) => {
  const taskId = c.req.param('id');
  const { department_id, user_name } = await c.req.json();
  
  try {
    // 읽음 기록 테이블에 저장
    await c.env.DB.prepare(`
      INSERT OR REPLACE INTO task_reads (task_id, department_id, user_name, read_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(taskId, department_id, user_name || '').run();
    
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ===== 안읽은 알림 개수 =====
app.get('/notifications/unread-count', async (c) => {
  const deptId = c.req.query('department_id');
  
  try {
    let query = `
      SELECT COUNT(*) as count FROM tasks t
      WHERE date(t.created_at) >= date('now', '-7 days')
    `;
    
    if (deptId) {
      query += ` AND NOT EXISTS (
        SELECT 1 FROM task_reads r WHERE r.task_id = t.id AND r.department_id = ?
      )`;
      const result = await c.env.DB.prepare(query).bind(deptId).first() as any;
      return c.json({ success: true, count: result?.count || 0 });
    } else {
      const result = await c.env.DB.prepare(query).first() as any;
      return c.json({ success: true, count: result?.count || 0 });
    }
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ===== DB 마이그레이션 =====
app.post('/migrate', async (c) => {
  try {
    // 부서 테이블
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS task_departments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        color TEXT DEFAULT '#3B82F6',
        sort_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    // 업무 테이블
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        type TEXT DEFAULT 'task' CHECK (type IN ('task', 'notice')),
        priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
        due_date DATE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    // 부서별 체크 테이블
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS task_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        department_id INTEGER NOT NULL,
        status TEXT DEFAULT '대기' CHECK (status IN ('대기', '진행중', '완료')),
        progress INTEGER DEFAULT 0,
        comment TEXT,
        checked_by TEXT,
        checked_at DATETIME,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (department_id) REFERENCES task_departments(id),
        UNIQUE(task_id, department_id)
      )
    `).run();
    
    // 파일 테이블
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS task_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        department_id INTEGER,
        file_name TEXT NOT NULL,
        file_key TEXT NOT NULL,
        file_size INTEGER,
        file_type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (department_id) REFERENCES task_departments(id)
      )
    `).run();
    
    // 이력 테이블
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS task_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        department_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        old_status TEXT,
        new_status TEXT,
        old_progress INTEGER,
        new_progress INTEGER,
        comment TEXT,
        action_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (department_id) REFERENCES task_departments(id)
      )
    `).run();
    
    // 읽음 테이블
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS task_reads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        department_id INTEGER NOT NULL,
        user_name TEXT,
        read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(task_id, department_id)
      )
    `).run();
    
    // 인덱스
    try { await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date)').run(); } catch {}
    try { await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at)').run(); } catch {}
    try { await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_task_checks_task ON task_checks(task_id)').run(); } catch {}
    try { await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_history(task_id)').run(); } catch {}
    
    // 기본 부서
    const depts = [
      { name: '생산팀', desc: '생산 및 제조 업무', color: '#10B981', order: 1 },
      { name: '품질팀', desc: '품질관리 및 검사', color: '#3B82F6', order: 2 },
      { name: '구매팀', desc: '원자재 구매 및 재고관리', color: '#F59E0B', order: 3 }
    ];
    
    for (const d of depts) {
      try {
        await c.env.DB.prepare(`
          INSERT OR IGNORE INTO task_departments (name, description, color, sort_order) VALUES (?, ?, ?, ?)
        `).bind(d.name, d.desc, d.color, d.order).run();
      } catch {}
    }
    
    // 일일업무 보고 테이블
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS daily_work_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        department_id INTEGER NOT NULL,
        report_date DATE NOT NULL,
        reporter_name TEXT,
        summary TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(department_id, report_date),
        FOREIGN KEY (department_id) REFERENCES task_departments(id)
      )
    `).run();
    
    // 일일업무 보고 상세 항목
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS daily_work_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id INTEGER NOT NULL,
        task_id INTEGER,
        work_type TEXT DEFAULT 'general',
        title TEXT NOT NULL,
        content TEXT,
        status TEXT DEFAULT '완료',
        work_hours REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (report_id) REFERENCES daily_work_reports(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      )
    `).run();
    
    // 업무 협조 요청 테이블
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS task_cooperations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        from_department_id INTEGER NOT NULL,
        to_department_id INTEGER NOT NULL,
        requester_name TEXT,
        priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
        status TEXT DEFAULT '요청' CHECK (status IN ('요청', '검토중', '진행중', '완료', '반려')),
        due_date DATE,
        response TEXT,
        responder_name TEXT,
        responded_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (from_department_id) REFERENCES task_departments(id),
        FOREIGN KEY (to_department_id) REFERENCES task_departments(id)
      )
    `).run();
    
    // 업무 협조 인덱스
    try { await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_coop_from_dept ON task_cooperations(from_department_id)').run(); } catch {}
    try { await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_coop_to_dept ON task_cooperations(to_department_id)').run(); } catch {}
    try { await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_coop_status ON task_cooperations(status)').run(); } catch {}
    
    return c.json({ success: true, message: '업무관리 테이블 마이그레이션 완료' });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ===== 일일업무 보고 API =====

// 일일업무 보고 목록 조회
app.get('/daily-reports', async (c) => {
  const date = c.req.query('date') || new Date().toISOString().split('T')[0];
  const department_id = c.req.query('department_id');
  
  try {
    let query = `
      SELECT r.*, d.name as department_name, d.color as department_color,
        (SELECT COUNT(*) FROM daily_work_items WHERE report_id = r.id) as item_count
      FROM daily_work_reports r
      LEFT JOIN task_departments d ON r.department_id = d.id
      WHERE r.report_date = ?
    `;
    const params: any[] = [date];
    
    if (department_id) {
      query += ' AND r.department_id = ?';
      params.push(department_id);
    }
    
    query += ' ORDER BY d.sort_order';
    
    const results = await c.env.DB.prepare(query).bind(...params).all();
    return c.json({ success: true, data: results.results || [] });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 일일업무 보고 상세 조회
app.get('/daily-reports/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    const report = await c.env.DB.prepare(`
      SELECT r.*, d.name as department_name, d.color as department_color
      FROM daily_work_reports r
      LEFT JOIN task_departments d ON r.department_id = d.id
      WHERE r.id = ?
    `).bind(id).first();
    
    if (!report) {
      return c.json({ success: false, error: '보고서를 찾을 수 없습니다' }, 404);
    }
    
    const items = await c.env.DB.prepare(`
      SELECT i.*, t.title as task_title, t.type as task_type
      FROM daily_work_items i
      LEFT JOIN tasks t ON i.task_id = t.id
      WHERE i.report_id = ?
      ORDER BY i.id
    `).bind(id).all();
    
    return c.json({ 
      success: true, 
      data: { ...report, items: items.results || [] }
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 부서별 날짜별 보고서 조회/생성
app.get('/daily-reports/dept/:deptId/date/:date', async (c) => {
  const deptId = c.req.param('deptId');
  const date = c.req.param('date');
  
  try {
    let report = await c.env.DB.prepare(`
      SELECT r.*, d.name as department_name, d.color as department_color
      FROM daily_work_reports r
      LEFT JOIN task_departments d ON r.department_id = d.id
      WHERE r.department_id = ? AND r.report_date = ?
    `).bind(deptId, date).first();
    
    // 해당 날짜 업무지시 목록 (해당 부서 대상)
    const tasks = await c.env.DB.prepare(`
      SELECT t.*, tc.status as check_status, tc.comment as check_memo, tc.checked_at as completed_at
      FROM tasks t
      LEFT JOIN task_checks tc ON t.id = tc.task_id AND tc.department_id = ?
      WHERE t.due_date = ? AND tc.department_id IS NOT NULL
      ORDER BY t.created_at
    `).bind(deptId, date).all();
    
    let items: any[] = [];
    if (report) {
      const itemsRes = await c.env.DB.prepare(`
        SELECT i.*, t.title as task_title, t.type as task_type
        FROM daily_work_items i
        LEFT JOIN tasks t ON i.task_id = t.id
        WHERE i.report_id = ?
        ORDER BY i.id
      `).bind((report as any).id).all();
      items = itemsRes.results || [];
    }
    
    return c.json({ 
      success: true, 
      data: { 
        report, 
        items,
        tasks: tasks.results || []
      }
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 일일업무 보고 등록/수정
app.post('/daily-reports', async (c) => {
  const body = await c.req.json();
  const { department_id, report_date, reporter_name, summary, items } = body;
  
  if (!department_id || !report_date) {
    return c.json({ success: false, error: '부서와 날짜를 선택해주세요' }, 400);
  }
  
  try {
    // 기존 보고서 확인
    let report = await c.env.DB.prepare(`
      SELECT id FROM daily_work_reports WHERE department_id = ? AND report_date = ?
    `).bind(department_id, report_date).first<{id: number}>();
    
    let reportId: number;
    
    if (report) {
      // 업데이트
      await c.env.DB.prepare(`
        UPDATE daily_work_reports 
        SET reporter_name = ?, summary = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(reporter_name || '', summary || '', report.id).run();
      reportId = report.id;
      
      // 기존 항목 삭제
      await c.env.DB.prepare('DELETE FROM daily_work_items WHERE report_id = ?').bind(reportId).run();
    } else {
      // 신규 등록
      const result = await c.env.DB.prepare(`
        INSERT INTO daily_work_reports (department_id, report_date, reporter_name, summary)
        VALUES (?, ?, ?, ?)
      `).bind(department_id, report_date, reporter_name || '', summary || '').run();
      reportId = result.meta.last_row_id as number;
    }
    
    // 업무 항목 등록
    if (items && items.length > 0) {
      for (const item of items) {
        await c.env.DB.prepare(`
          INSERT INTO daily_work_items (report_id, task_id, work_type, title, content, status, work_hours)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          reportId,
          item.task_id || null,
          item.work_type || 'general',
          item.title,
          item.content || '',
          item.status || '완료',
          item.work_hours || 0
        ).run();
      }
    }
    
    return c.json({ success: true, message: '일일업무 보고가 저장되었습니다', data: { id: reportId } });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 당일 업무 현황 대시보드
app.get('/daily-dashboard', async (c) => {
  const date = c.req.query('date') || new Date().toISOString().split('T')[0];
  
  try {
    // 부서별 현황
    const deptStatus = await c.env.DB.prepare(`
      SELECT 
        d.id, d.name, d.color,
        (SELECT COUNT(*) FROM task_checks tc 
         JOIN tasks t ON tc.task_id = t.id 
         WHERE tc.department_id = d.id AND t.due_date = ?) as total_tasks,
        (SELECT COUNT(*) FROM task_checks tc 
         JOIN tasks t ON tc.task_id = t.id 
         WHERE tc.department_id = d.id AND t.due_date = ? AND tc.status = '완료') as completed_tasks,
        (SELECT COUNT(*) FROM daily_work_reports r 
         WHERE r.department_id = d.id AND r.report_date = ?) as has_report,
        (SELECT COUNT(*) FROM daily_work_items i 
         JOIN daily_work_reports r ON i.report_id = r.id 
         WHERE r.department_id = d.id AND r.report_date = ?) as report_items
      FROM task_departments d
      WHERE d.is_active = 1
      ORDER BY d.sort_order
    `).bind(date, date, date, date).all();
    
    // 오늘 업무지시 목록
    const todayTasks = await c.env.DB.prepare(`
      SELECT t.*, 
        (SELECT COUNT(*) FROM task_checks WHERE task_id = t.id AND status = '완료') as completed_count,
        (SELECT COUNT(*) FROM task_checks WHERE task_id = t.id) as total_count
      FROM tasks t
      WHERE t.due_date = ?
      ORDER BY t.priority DESC, t.created_at
    `).bind(date).all();
    
    // 일일보고 현황
    const reports = await c.env.DB.prepare(`
      SELECT r.*, d.name as department_name, d.color as department_color,
        (SELECT COUNT(*) FROM daily_work_items WHERE report_id = r.id) as item_count
      FROM daily_work_reports r
      LEFT JOIN task_departments d ON r.department_id = d.id
      WHERE r.report_date = ?
      ORDER BY d.sort_order
    `).bind(date).all();
    
    return c.json({ 
      success: true, 
      data: {
        date,
        departments: deptStatus.results || [],
        tasks: todayTasks.results || [],
        reports: reports.results || []
      }
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 부서별 업무 이력 조회 (기간별)
app.get('/work-history', async (c) => {
  const deptId = c.req.query('department_id');
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '20');
  const offset = (page - 1) * limit;
  
  try {
    let whereClause = '1=1';
    const params: any[] = [];
    
    if (deptId) {
      whereClause += ' AND r.department_id = ?';
      params.push(deptId);
    }
    if (startDate) {
      whereClause += ' AND r.report_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND r.report_date <= ?';
      params.push(endDate);
    }
    
    // 총 건수
    const countResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as total
      FROM daily_work_reports r
      WHERE ${whereClause}
    `).bind(...params).first<{total: number}>();
    
    // 보고서 목록
    const reports = await c.env.DB.prepare(`
      SELECT r.*, d.name as department_name, d.color as department_color,
        (SELECT COUNT(*) FROM daily_work_items WHERE report_id = r.id) as item_count,
        (SELECT SUM(work_hours) FROM daily_work_items WHERE report_id = r.id) as total_hours
      FROM daily_work_reports r
      LEFT JOIN task_departments d ON r.department_id = d.id
      WHERE ${whereClause}
      ORDER BY r.report_date DESC, d.sort_order
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();
    
    return c.json({
      success: true,
      data: {
        reports: reports.results || [],
        pagination: {
          total: countResult?.total || 0,
          page,
          limit,
          totalPages: Math.ceil((countResult?.total || 0) / limit)
        }
      }
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 부서별 업무 통계
app.get('/work-stats', async (c) => {
  const deptId = c.req.query('department_id');
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  
  try {
    let whereClause = '1=1';
    const params: any[] = [];
    
    if (deptId) {
      whereClause += ' AND r.department_id = ?';
      params.push(deptId);
    }
    if (startDate) {
      whereClause += ' AND r.report_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND r.report_date <= ?';
      params.push(endDate);
    }
    
    // 부서별 통계
    const deptStats = await c.env.DB.prepare(`
      SELECT 
        d.id, d.name, d.color,
        COUNT(DISTINCT r.id) as report_count,
        COUNT(i.id) as total_items,
        COALESCE(SUM(i.work_hours), 0) as total_hours,
        COUNT(CASE WHEN i.status = '완료' THEN 1 END) as completed_items,
        COUNT(CASE WHEN i.work_type = 'task' THEN 1 END) as task_items,
        COUNT(CASE WHEN i.work_type = 'general' THEN 1 END) as general_items
      FROM task_departments d
      LEFT JOIN daily_work_reports r ON d.id = r.department_id AND ${whereClause.replace(/r\./g, 'r.')}
      LEFT JOIN daily_work_items i ON r.id = i.report_id
      WHERE d.is_active = 1
      GROUP BY d.id
      ORDER BY d.sort_order
    `).bind(...params).all();
    
    // 일별 통계 (최근 30일)
    const dailyStats = await c.env.DB.prepare(`
      SELECT 
        r.report_date,
        COUNT(DISTINCT r.id) as report_count,
        COUNT(i.id) as item_count,
        COALESCE(SUM(i.work_hours), 0) as total_hours
      FROM daily_work_reports r
      LEFT JOIN daily_work_items i ON r.id = i.report_id
      WHERE ${whereClause}
      GROUP BY r.report_date
      ORDER BY r.report_date DESC
      LIMIT 30
    `).bind(...params).all();
    
    // 업무 유형별 통계
    const typeStats = await c.env.DB.prepare(`
      SELECT 
        i.work_type,
        COUNT(*) as count,
        COALESCE(SUM(i.work_hours), 0) as total_hours
      FROM daily_work_items i
      JOIN daily_work_reports r ON i.report_id = r.id
      WHERE ${whereClause}
      GROUP BY i.work_type
    `).bind(...params).all();
    
    return c.json({
      success: true,
      data: {
        departments: deptStats.results || [],
        daily: dailyStats.results || [],
        byType: typeStats.results || []
      }
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 보고서 삭제
app.delete('/daily-reports/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    // 먼저 항목 삭제
    await c.env.DB.prepare(`DELETE FROM daily_work_items WHERE report_id = ?`).bind(id).run();
    // 보고서 삭제
    await c.env.DB.prepare(`DELETE FROM daily_work_reports WHERE id = ?`).bind(id).run();
    
    return c.json({ success: true, message: '보고서가 삭제되었습니다' });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ===== 업무 협조 요청 API =====

// 협조 요청 목록 조회
app.get('/cooperations', async (c) => {
  const department_id = c.req.query('department_id');
  const direction = c.req.query('direction') || 'all'; // 'sent', 'received', 'all'
  const status = c.req.query('status');
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '20');
  const offset = (page - 1) * limit;
  
  try {
    let whereClause = '1=1';
    const params: any[] = [];
    
    if (department_id) {
      if (direction === 'sent') {
        whereClause += ' AND c.from_department_id = ?';
        params.push(department_id);
      } else if (direction === 'received') {
        whereClause += ' AND c.to_department_id = ?';
        params.push(department_id);
      } else {
        whereClause += ' AND (c.from_department_id = ? OR c.to_department_id = ?)';
        params.push(department_id, department_id);
      }
    }
    
    if (status) {
      whereClause += ' AND c.status = ?';
      params.push(status);
    }
    
    const countResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as total FROM task_cooperations c WHERE ${whereClause}
    `).bind(...params).first<{total: number}>();
    
    const results = await c.env.DB.prepare(`
      SELECT c.*, 
        fd.name as from_department_name, fd.color as from_department_color,
        td.name as to_department_name, td.color as to_department_color
      FROM task_cooperations c
      LEFT JOIN task_departments fd ON c.from_department_id = fd.id
      LEFT JOIN task_departments td ON c.to_department_id = td.id
      WHERE ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();
    
    return c.json({
      success: true,
      data: {
        items: results.results || [],
        pagination: {
          total: countResult?.total || 0,
          page,
          limit,
          totalPages: Math.ceil((countResult?.total || 0) / limit)
        }
      }
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 협조 요청 상세 조회
app.get('/cooperations/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    const result = await c.env.DB.prepare(`
      SELECT c.*, 
        fd.name as from_department_name, fd.color as from_department_color,
        td.name as to_department_name, td.color as to_department_color
      FROM task_cooperations c
      LEFT JOIN task_departments fd ON c.from_department_id = fd.id
      LEFT JOIN task_departments td ON c.to_department_id = td.id
      WHERE c.id = ?
    `).bind(id).first();
    
    if (!result) {
      return c.json({ success: false, error: '협조 요청을 찾을 수 없습니다' }, 404);
    }
    
    return c.json({ success: true, data: result });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 협조 요청 등록
app.post('/cooperations', async (c) => {
  const body = await c.req.json();
  const { title, content, from_department_id, to_department_id, requester_name, priority, due_date } = body;
  
  if (!title || !from_department_id || !to_department_id) {
    return c.json({ success: false, error: '필수 항목을 입력해주세요' }, 400);
  }
  
  try {
    const result = await c.env.DB.prepare(`
      INSERT INTO task_cooperations (title, content, from_department_id, to_department_id, requester_name, priority, due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(title, content || '', from_department_id, to_department_id, requester_name || '', priority || 'normal', due_date || null).run();
    
    return c.json({ success: true, message: '협조 요청이 등록되었습니다', data: { id: result.meta.last_row_id } });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 협조 요청 상태 업데이트 (응답)
app.put('/cooperations/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { status, response, responder_name } = body;
  
  try {
    let updateQuery = 'UPDATE task_cooperations SET updated_at = CURRENT_TIMESTAMP';
    const params: any[] = [];
    
    if (status) {
      updateQuery += ', status = ?';
      params.push(status);
    }
    if (response !== undefined) {
      updateQuery += ', response = ?';
      params.push(response);
    }
    if (responder_name) {
      updateQuery += ', responder_name = ?';
      params.push(responder_name);
    }
    if (status && status !== '요청') {
      updateQuery += ', responded_at = CURRENT_TIMESTAMP';
    }
    
    updateQuery += ' WHERE id = ?';
    params.push(id);
    
    await c.env.DB.prepare(updateQuery).bind(...params).run();
    
    return c.json({ success: true, message: '협조 요청이 업데이트되었습니다' });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 협조 요청 삭제
app.delete('/cooperations/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    await c.env.DB.prepare('DELETE FROM task_cooperations WHERE id = ?').bind(id).run();
    return c.json({ success: true, message: '협조 요청이 삭제되었습니다' });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 날짜별 업무 요약 (달력용)
app.get('/calendar-summary', async (c) => {
  const year = parseInt(c.req.query('year') || new Date().getFullYear().toString());
  const month = parseInt(c.req.query('month') || (new Date().getMonth() + 1).toString());
  
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-31`;
  
  try {
    // 업무지시/공지 날짜별 집계
    const tasks = await c.env.DB.prepare(`
      SELECT due_date, type, COUNT(*) as count
      FROM tasks
      WHERE due_date >= ? AND due_date <= ?
      GROUP BY due_date, type
    `).bind(startDate, endDate).all();
    
    // 일일업무 보고 날짜별 집계
    const reports = await c.env.DB.prepare(`
      SELECT r.report_date, d.id as department_id, d.name as department_name, d.color as department_color,
        (SELECT COUNT(*) FROM daily_work_items WHERE report_id = r.id) as item_count
      FROM daily_work_reports r
      LEFT JOIN task_departments d ON r.department_id = d.id
      WHERE r.report_date >= ? AND r.report_date <= ?
      ORDER BY r.report_date, d.sort_order
    `).bind(startDate, endDate).all();
    
    // 협조 요청 날짜별 집계
    const cooperations = await c.env.DB.prepare(`
      SELECT DATE(created_at) as date, status, COUNT(*) as count
      FROM task_cooperations
      WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?
      GROUP BY DATE(created_at), status
    `).bind(startDate, endDate).all();
    
    return c.json({
      success: true,
      data: {
        tasks: tasks.results || [],
        reports: reports.results || [],
        cooperations: cooperations.results || []
      }
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default app;
