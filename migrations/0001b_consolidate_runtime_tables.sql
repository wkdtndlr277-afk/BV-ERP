-- Consolidate all runtime-only ("CREATE TABLE IF NOT EXISTS" inside route handlers) tables
-- into a proper migration. Without this, a fresh clone/deploy of this app has 27+ tables
-- that silently do not exist until a specific init-style endpoint is called at least once
-- (e.g. orders, shipments, tasks, task_departments, task_cooperations, audit_logs, ...).
-- Any read-only query against these tables on a fresh environment fails with
-- "no such table: X" (or a 500 error surfaced to the user).
-- This migration creates them all up front with IF NOT EXISTS, so:
--  - fresh environments work immediately without hidden manual API calls
--  - production (where these tables already exist) is unaffected, since IF NOT EXISTS
--    makes every statement here a safe no-op there.

CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          audit_type TEXT NOT NULL,
          audit_time TEXT NOT NULL,
          has_issues INTEGER DEFAULT 0,
          total_mismatches INTEGER DEFAULT 0,
          details TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE IF NOT EXISTS barcode_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT NOT NULL,
        item_code TEXT NOT NULL,
        item_name TEXT NOT NULL,
        category TEXT DEFAULT '원료',
        unit TEXT DEFAULT 'kg',
        current_stock REAL DEFAULT 0,
        safety_stock REAL DEFAULT 0,
        location TEXT,
        table_type TEXT DEFAULT 'master',
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(barcode)
      );

CREATE TABLE IF NOT EXISTS barcode_master (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT UNIQUE NOT NULL,
        shaping_code TEXT,
        shaping_name TEXT,
        description TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

CREATE TABLE IF NOT EXISTS barcode_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT NOT NULL,
        item_code TEXT NOT NULL,
        transaction_type TEXT NOT NULL,
        quantity REAL NOT NULL,
        before_stock REAL,
        after_stock REAL,
        lot_number TEXT,
        expiry_date DATE,
        memo TEXT,
        user_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

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
      );

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
      );

CREATE TABLE IF NOT EXISTS frozen_stock_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trans_date DATE NOT NULL,
        product_name TEXT NOT NULL,
        product_code TEXT,
        trans_type TEXT NOT NULL,
        quantity REAL NOT NULL,
        remain_qty REAL,
        frozen_date DATE,
        expiry_date DATE,
        location TEXT,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

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
    );

CREATE TABLE IF NOT EXISTS opening_stock_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_code TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      adjusted_value REAL NOT NULL,
      original_value REAL,
      memo TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(item_code, year, month)
    );

CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_date TEXT NOT NULL,
        channel TEXT NOT NULL,
        product_code TEXT NOT NULL,
        product_name TEXT,
        quantity INTEGER NOT NULL,
        delivery_date TEXT,
        status TEXT DEFAULT '대기',
        remark TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

CREATE TABLE IF NOT EXISTS process_cycle (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT NOT NULL,
        shaping_code TEXT,
        shaping_name TEXT,
        cycle_date TEXT NOT NULL,
        current_process_code TEXT,
        current_process_name TEXT,
        status TEXT DEFAULT 'IN_PROGRESS',
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

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
      );

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
      );

CREATE TABLE IF NOT EXISTS process_time_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cycle_id INTEGER NOT NULL,
        barcode TEXT NOT NULL,
        process_code TEXT NOT NULL,
        process_name TEXT NOT NULL,
        process_order INTEGER NOT NULL,
        start_time DATETIME,
        end_time DATETIME,
        actual_minutes INTEGER,
        standard_minutes INTEGER,
        status TEXT DEFAULT 'PENDING',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cycle_id) REFERENCES process_cycle(id)
      );

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
      );

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
      );

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
      );

CREATE TABLE IF NOT EXISTS semi_finished_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lot_id INTEGER NOT NULL,
        item_code TEXT NOT NULL,
        transaction_type TEXT NOT NULL CHECK (transaction_type IN ('IN', 'OUT', 'ADJUST')),
        quantity REAL NOT NULL,
        reference_type TEXT,
        reference_id TEXT,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (lot_id) REFERENCES semi_finished_lots(id),
        FOREIGN KEY (item_code) REFERENCES semi_finished_items(item_code)
      );

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
      );

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
      );

CREATE TABLE IF NOT EXISTS shipments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shipment_date TEXT NOT NULL,
        order_id TEXT,
        production_lot TEXT,
        channel TEXT,
        product_code TEXT NOT NULL,
        product_name TEXT,
        quantity INTEGER NOT NULL,
        status TEXT DEFAULT '출고대기',
        delivery_status TEXT DEFAULT '배송준비',
        tracking_number TEXT,
        remark TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

CREATE TABLE IF NOT EXISTS supplier_materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER NOT NULL,
        item_code TEXT,
        material_name TEXT NOT NULL,
        manufacturer TEXT,
        manufacturer_address TEXT,
        haccp_certified INTEGER DEFAULT 0,
        is_imported INTEGER DEFAULT 0,
        origin_country TEXT,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
      );

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
      );

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
      );

CREATE TABLE IF NOT EXISTS task_departments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        color TEXT DEFAULT '#3B82F6',
        sort_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

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
      );

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
      );

CREATE TABLE IF NOT EXISTS task_reads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        department_id INTEGER NOT NULL,
        user_name TEXT,
        read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(task_id, department_id)
      );

CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        type TEXT DEFAULT 'task' CHECK (type IN ('task', 'notice')),
        priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
        due_date DATE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
