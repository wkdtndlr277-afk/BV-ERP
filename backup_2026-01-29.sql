PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" VALUES(1,'0001_initial_schema.sql','2026-01-29 14:40:42');
INSERT INTO "d1_migrations" VALUES(2,'0002_admin_system.sql','2026-01-29 14:40:42');
INSERT INTO "d1_migrations" VALUES(3,'0003_process_quality.sql','2026-01-29 14:40:42');
INSERT INTO "d1_migrations" VALUES(4,'0004_product_catalog.sql','2026-01-29 14:40:42');
INSERT INTO "d1_migrations" VALUES(5,'0005_user_auth.sql','2026-01-29 14:40:43');
INSERT INTO "d1_migrations" VALUES(6,'0006_add_super_admin_role.sql','2026-01-29 14:40:43');
CREATE TABLE master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code TEXT UNIQUE NOT NULL,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('원료', '제품')),
  unit TEXT NOT NULL DEFAULT 'kg',
  current_stock REAL DEFAULT 0,
  safety_stock REAL DEFAULT 0,
  expiry_days INTEGER DEFAULT 365,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "master" VALUES(1,'RM001','올리브','원료','kg',30,0,365,'2026-01-29 15:01:55','2026-01-29 15:02:00');
INSERT INTO "master" VALUES(2,'RM002','담금질','원료','kg',0,25,365,'2026-01-29 15:02:12','2026-01-29 15:02:12');
CREATE TABLE inbound (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_number TEXT UNIQUE NOT NULL,
  item_code TEXT NOT NULL,
  inbound_date DATE NOT NULL,
  expiry_date DATE NOT NULL,
  origin_qty REAL NOT NULL,
  remain_qty REAL NOT NULL,
  quality_status TEXT NOT NULL DEFAULT '합격' CHECK (quality_status IN ('합격', '불합격')),
  supplier TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_code) REFERENCES master(item_code)
);
INSERT INTO "inbound" VALUES(1,'20260130-RM001-001','RM001','2026-01-30','2027-01-30',30,30,'합격',NULL,'2026-01-29 15:01:59','2026-01-29 15:01:59');
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trans_date DATE NOT NULL,
  item_code TEXT NOT NULL,
  trans_type TEXT NOT NULL CHECK (trans_type IN ('입고', '사용', '출고', '재고조정')),
  quantity REAL NOT NULL,
  lot_number TEXT,
  remain_qty REAL,
  supplier TEXT,
  memo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_code) REFERENCES master(item_code),
  FOREIGN KEY (lot_number) REFERENCES inbound(lot_number)
);
INSERT INTO "transactions" VALUES(1,'2026-01-30','RM001','입고',30,'20260130-RM001-001',30,NULL,NULL,'2026-01-29 15:02:00');
CREATE TABLE quality_kpi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kpi_date DATE NOT NULL,
  kpi_name TEXT NOT NULL,
  standard_value TEXT,
  measured_value TEXT,
  judgment TEXT NOT NULL DEFAULT '적합' CHECK (judgment IN ('적합', '부적합')),
  pdf_path TEXT,
  registration_status TEXT DEFAULT '수동' CHECK (registration_status IN ('자동', '수동보정')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_code TEXT UNIQUE NOT NULL,
  supplier_name TEXT NOT NULL,
  supplier_type TEXT DEFAULT '입고' CHECK (supplier_type IN ('입고', '출고', '양방향')),
  contact TEXT,
  address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE admin_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_key TEXT UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "admin_settings" VALUES(1,'admin_password','admin1234','관리자 비밀번호','2026-01-29 14:40:42','2026-01-29 14:40:42');
INSERT INTO "admin_settings" VALUES(2,'admin_session_timeout','3600','관리자 세션 타임아웃 (초)','2026-01-29 14:40:42','2026-01-29 14:40:42');
CREATE TABLE admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id INTEGER,
  before_data TEXT,
  after_data TEXT,
  reason TEXT,
  action_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  ip_address TEXT
);
INSERT INTO "admin_logs" VALUES(1,'로그인','admin',NULL,NULL,NULL,'관리자 로그인','2026-01-29 14:54:04',NULL);
INSERT INTO "admin_logs" VALUES(2,'로그인','admin',NULL,NULL,NULL,'관리자 로그인','2026-01-29 15:01:02',NULL);
INSERT INTO "admin_logs" VALUES(3,'로그인','admin',NULL,NULL,NULL,'관리자 로그인','2026-01-29 15:03:06',NULL);
INSERT INTO "admin_logs" VALUES(4,'로그인','admin',NULL,NULL,NULL,'관리자 로그인','2026-01-29 15:04:21',NULL);
INSERT INTO "admin_logs" VALUES(5,'로그인','admin',NULL,NULL,NULL,'관리자 로그인','2026-01-29 15:04:52',NULL);
CREATE TABLE process_quality (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_date DATE NOT NULL,
  record_time TEXT,
  dough_name TEXT NOT NULL,
  dough_temp REAL,
  dough_temp_standard TEXT DEFAULT '24-26°C',
  dough_temp_judgment TEXT DEFAULT '적합' CHECK (dough_temp_judgment IN ('적합', '부적합')),
  ph_value REAL,
  ph_standard TEXT DEFAULT '5.5-6.5',
  ph_judgment TEXT DEFAULT '적합' CHECK (ph_judgment IN ('적합', '부적합')),
  humidity REAL,
  humidity_standard TEXT DEFAULT '60-70%',
  humidity_judgment TEXT DEFAULT '적합' CHECK (humidity_judgment IN ('적합', '부적합')),
  fermentation_time INTEGER,
  fermentation_standard TEXT,
  fermentation_judgment TEXT DEFAULT '적합' CHECK (fermentation_judgment IN ('적합', '부적합')),
  worker_name TEXT,
  memo TEXT,
  overall_judgment TEXT DEFAULT '적합' CHECK (overall_judgment IN ('적합', '부적합')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE dough_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dough_code TEXT UNIQUE NOT NULL,
  dough_name TEXT NOT NULL,
  temp_min REAL DEFAULT 24,
  temp_max REAL DEFAULT 26,
  ph_min REAL DEFAULT 5.5,
  ph_max REAL DEFAULT 6.5,
  humidity_min REAL DEFAULT 60,
  humidity_max REAL DEFAULT 70,
  fermentation_min INTEGER,
  fermentation_max INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "dough_master" VALUES(1,'DG001','식빵반죽',24,26,5.5,6.5,60,70,60,90,'2026-01-29 14:40:42');
INSERT INTO "dough_master" VALUES(2,'DG002','바게트반죽',22,24,5.5,6,65,75,90,120,'2026-01-29 14:40:42');
INSERT INTO "dough_master" VALUES(3,'DG003','크루아상반죽',18,20,5.5,6,55,65,30,45,'2026-01-29 14:40:42');
INSERT INTO "dough_master" VALUES(4,'DG004','브리오슈반죽',24,26,5.5,6.5,60,70,60,90,'2026-01-29 14:40:42');
INSERT INTO "dough_master" VALUES(5,'DG005','치아바타반죽',24,26,5.5,6.5,70,80,120,180,'2026-01-29 14:40:42');
INSERT INTO "dough_master" VALUES(6,'DG006','단팥빵반죽',26,28,5.5,6.5,60,70,40,60,'2026-01-29 14:40:42');
INSERT INTO "dough_master" VALUES(7,'DG007','소보로반죽',24,26,5.5,6.5,55,65,30,45,'2026-01-29 14:40:42');
INSERT INTO "dough_master" VALUES(8,'DG008','베이글반죽',22,24,5.5,6,60,70,60,90,'2026-01-29 14:40:42');
CREATE TABLE Product_Catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT UNIQUE NOT NULL,          
  product_name TEXT NOT NULL,                  
  manufacture_report TEXT,                     
  product_image TEXT,                          
  process_number TEXT,                         
  barcode TEXT,                                
  expiry_info TEXT,                            
  storage_method TEXT,                         
  sales_channel TEXT,                          
  memo TEXT,                                   
  is_active INTEGER DEFAULT 1,                 
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE Sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  session_token TEXT UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
);
INSERT INTO "Sessions" VALUES(4,1,'bVKsGXrklftZBUoFgylljqtXIpigXghpE6ptfVsYSdXOmWDupOvNG9G8pMEAJujY','2026-01-30T14:59:42.613Z','2026-01-29 14:59:43');
CREATE TABLE Users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  user_name TEXT NOT NULL,
  role TEXT DEFAULT 'user' CHECK(role IN ('super_admin', 'admin', 'manager', 'user')),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'suspended')),
  department TEXT,
  phone TEXT,
  last_login DATETIME,
  login_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  approved_by INTEGER,
  approved_at DATETIME
);
INSERT INTO "Users" VALUES(1,'admin','admin1234','시스템관리자','super_admin','approved',NULL,NULL,'2026-01-29 14:59:43',3,'2026-01-29 14:40:43','2026-01-29 14:40:43',NULL,'2026-01-29 14:40:43');
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" VALUES('d1_migrations',6);
INSERT INTO "sqlite_sequence" VALUES('admin_settings',2);
INSERT INTO "sqlite_sequence" VALUES('dough_master',8);
INSERT INTO "sqlite_sequence" VALUES('Users',2);
INSERT INTO "sqlite_sequence" VALUES('Sessions',5);
INSERT INTO "sqlite_sequence" VALUES('admin_logs',5);
INSERT INTO "sqlite_sequence" VALUES('master',2);
INSERT INTO "sqlite_sequence" VALUES('inbound',1);
INSERT INTO "sqlite_sequence" VALUES('transactions',1);
CREATE INDEX idx_master_category ON master(category);
CREATE INDEX idx_master_item_code ON master(item_code);
CREATE INDEX idx_inbound_item_code ON inbound(item_code);
CREATE INDEX idx_inbound_lot_number ON inbound(lot_number);
CREATE INDEX idx_inbound_expiry_date ON inbound(expiry_date);
CREATE INDEX idx_transactions_date ON transactions(trans_date);
CREATE INDEX idx_transactions_item_code ON transactions(item_code);
CREATE INDEX idx_transactions_type ON transactions(trans_type);
CREATE INDEX idx_quality_kpi_date ON quality_kpi(kpi_date);
CREATE INDEX idx_admin_logs_date ON admin_logs(action_date);
CREATE INDEX idx_admin_logs_type ON admin_logs(action_type);
CREATE INDEX idx_admin_logs_table ON admin_logs(target_table);
CREATE INDEX idx_process_quality_date ON process_quality(record_date);
CREATE INDEX idx_process_quality_dough ON process_quality(dough_name);
CREATE INDEX idx_dough_master_code ON dough_master(dough_code);
CREATE INDEX idx_product_catalog_name ON Product_Catalog(product_name);
CREATE INDEX idx_product_catalog_barcode ON Product_Catalog(barcode);
CREATE INDEX idx_product_catalog_code ON Product_Catalog(product_code);
CREATE INDEX idx_product_catalog_active ON Product_Catalog(is_active);
CREATE INDEX idx_sessions_token ON Sessions(session_token);
CREATE INDEX idx_sessions_user ON Sessions(user_id);
CREATE INDEX idx_sessions_expires ON Sessions(expires_at);
CREATE INDEX idx_users_user_id ON Users(user_id);
CREATE INDEX idx_users_status ON Users(status);
CREATE INDEX idx_users_role ON Users(role);
