-- J-Planning Admin Control Plane Şeması (jplanning-control)
-- Bu veritabanı kullanıcıların kişisel verilerini saklamaz;
-- sadece admin paneli için özet/meta dizini ve denetim (audit) loglarını barındırır.

CREATE TABLE IF NOT EXISTS admin_users_index (
    uid TEXT PRIMARY KEY,
    email TEXT,
    display_name TEXT,
    db_name TEXT,
    created_at INTEGER,
    last_login_at INTEGER,
    task_count INTEGER DEFAULT 0,
    jp_balance INTEGER DEFAULT 0,
    is_disabled INTEGER DEFAULT 0,
    updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users_index(email);
CREATE INDEX IF NOT EXISTS idx_admin_users_last_login ON admin_users_index(last_login_at);

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id TEXT PRIMARY KEY,
    admin_uid TEXT NOT NULL,
    admin_email TEXT,
    target_user_uid TEXT,
    action TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    status TEXT DEFAULT 'SUCCESS',
    error_message TEXT,
    detail TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_log(admin_uid);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_log(target_user_uid);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action);
