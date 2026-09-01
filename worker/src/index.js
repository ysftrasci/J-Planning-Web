import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createClient } from '@libsql/client/web';
import canonicalSchema from '../../schema.sql';

// Google Firebase Public JWKS Endpoint
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

/**
 * Firebase UID'sini Turso veritabanı isimlendirme standartlarına uygun hale getirir.
 * Turso kuralları: Sadece [a-z0-9-], başta ve sonda tire olamaz.
 */
export function getDbNameForUser(uid) {
  if (!uid || typeof uid !== 'string') {
    throw new Error('Geçersiz kullanıcı kimliği (UID)');
  }
  const cleanUid = uid
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return `jplanning-user-${cleanUid}`;
}

/**
 * CORS başlıklarını istek kaynağına (Origin) göre güvenli şekilde ayarlar.
 */
function getCorsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowedList = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const isAllowed =
    allowedList.includes(origin) ||
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:');

  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };

  if (isAllowed) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

function jsonResponse(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

/**
 * Firebase ID Token doğrulaması
 */
async function verifyFirebaseToken(authHeader, projectId) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Authorization header eksik veya geçersiz formatta');
  }

  const token = authHeader.substring(7).trim();
  const issuer = `https://securetoken.google.com/${projectId}`;

  const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
    issuer,
    audience: projectId,
  });

  const uid = payload.user_id || payload.sub;
  if (!uid) {
    throw new Error('Token içinde kullanıcı kimliği (UID) bulunamadı');
  }

  return { uid, payload };
}

/**
 * Firebase ID Token içindeki admin claim'ini doğrular.
 */
async function verifyAdminClaim(authHeader, projectId) {
  const { uid, payload } = await verifyFirebaseToken(authHeader, projectId);

  if (payload.admin !== true) {
    const forbiddenErr = new Error('Admin yetkisi bulunamadı');
    forbiddenErr.isForbidden = true;
    forbiddenErr.uid = uid;
    throw forbiddenErr;
  }

  return { uid, payload };
}

/**
 * Control Plane veritabanı istemcisini döndürür.
 */
function getControlPlaneClient(env) {
  const org = env.TURSO_ORG;
  const dbUrl = env.TURSO_CONTROL_DB_URL || `libsql://jplanning-control-${org}.turso.io`;
  const dbToken = env.TURSO_CONTROL_DB_TOKEN || env.TURSO_PLATFORM_TOKEN;

  if (!dbToken) {
    return null;
  }

  return createClient({
    url: dbUrl,
    authToken: dbToken,
  });
}

/**
 * Kullanıcı giriş yaptığında (POST /session), meta verileri Control Plane DB'ye kaydeder/günceller.
 * Bu işlem fire-and-forget şeklinde çalışır; ana akışı geciktirmez veya kesmez.
 */
async function syncUserToControlPlane(env, { uid, email, displayName, dbName }) {
  try {
    const client = getControlPlaneClient(env);
    if (!client) {
      return;
    }

    const now = Date.now();
    const query = `
      INSERT INTO admin_users_index (
        uid, email, display_name, db_name, created_at, last_login_at, task_count, jp_balance, is_disabled, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, 0, 0, 0, ?
      )
      ON CONFLICT(uid) DO UPDATE SET
        email = excluded.email,
        display_name = excluded.display_name,
        db_name = excluded.db_name,
        last_login_at = excluded.last_login_at,
        updated_at = excluded.updated_at;
    `;

    await client.execute({
      sql: query,
      args: [
        uid,
        email || null,
        displayName || null,
        dbName,
        now,
        now,
        now,
      ],
    });
  } catch (err) {
    console.error('[Worker Control Plane Sync Hatası]:', err.message);
  }
}

/**
 * admin_audit_log tablosunun tüm Faz 4 kolonları ile hazır olmasını sağlar (Migration)
 */
let auditSchemaInitialized = false;
async function ensureAuditLogSchema(client) {
  if (auditSchemaInitialized || !client) return;
  try {
    await client.execute(`
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
    `);
    const cols = ['admin_email', 'old_value', 'new_value', 'status', 'error_message', 'detail'];
    for (const col of cols) {
      await client.execute(`ALTER TABLE admin_audit_log ADD COLUMN ${col} TEXT;`).catch(() => {});
    }
    auditSchemaInitialized = true;
  } catch (e) {
    console.warn('[Audit Log Schema Warning]:', e.message);
  }
}

/**
 * Admin tarafından yapılan değişiklikleri Control Plane DB'deki admin_audit_log tablosuna kaydeder.
 * Append-only çalışır; kayıtlar asla silinemez veya güncellenemez.
 */
async function logAdminAudit(env, { adminUid, adminEmail, targetUid, action, oldValue, newValue, status = 'SUCCESS', errorMessage = null }) {
  try {
    const client = getControlPlaneClient(env);
    if (!client) {
      return;
    }

    await ensureAuditLogSchema(client);

    const id = crypto.randomUUID ? crypto.randomUUID() : `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const sql = `
      INSERT INTO admin_audit_log (
        id, admin_uid, admin_email, target_user_uid, action, old_value, new_value, status, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    await client.execute({
      sql,
      args: [
        id,
        adminUid,
        adminEmail || null,
        targetUid,
        action,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        status,
        errorMessage || null,
        now,
      ],
    });
  } catch (err) {
    console.warn('[Worker Audit Log Kayıt Hatası]:', err.message);
  }
}

/**
 * Turso Platform API Çağrısı Yardımcısı
 */
async function callTursoPlatformApi(endpoint, env, options = {}) {
  const org = env.TURSO_ORG;
  const platformToken = env.TURSO_PLATFORM_TOKEN;

  if (!org || !platformToken) {
    throw new Error('Turso organizasyon adı (TURSO_ORG) veya TURSO_PLATFORM_TOKEN tanımlı değil');
  }

  const url = `https://api.turso.tech/v1/organizations/${org}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${platformToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  return response;
}

/**
 * Turso API yanıtından gerçek Hostname'i / DB URL'ini ayıklar.
 * Turso Hostname alanında bölge bilgisini (örn: db-name-org.aws-eu-west-1.turso.io) döner.
 */
function extractDbUrl(data, dbName, org) {
  const hostname =
    data?.database?.Hostname ||
    data?.database?.hostname ||
    data?.Hostname ||
    data?.hostname;

  if (hostname) {
    return hostname.startsWith('libsql://') ? hostname : `libsql://${hostname}`;
  }
  return `libsql://${dbName}-${org}.turso.io`;
}

/**
 * Kullanıcı için veritabanının varlığını kontrol eder, yoksa oluşturup şemayı yükler.
 */
async function ensureUserDatabase(dbName, env) {
  const org = env.TURSO_ORG;
  const group = env.TURSO_GROUP || 'jplanning';

  let dbUrl = `libsql://${dbName}-${org}.turso.io`;
  let needInitSchema = false;

  // 1. Veritabanı var mı kontrol et
  const checkRes = await callTursoPlatformApi(`/databases/${dbName}`, env);

  if (checkRes.ok) {
    const dbData = await checkRes.json();
    dbUrl = extractDbUrl(dbData, dbName, org);
  } else if (checkRes.status === 404) {
    // Veritabanı yok, yeni oluştur
    const createRes = await callTursoPlatformApi(`/databases`, env, {
      method: 'POST',
      body: JSON.stringify({
        name: dbName,
        group: group,
      }),
    });

    if (createRes.ok) {
      const createdData = await createRes.json();
      dbUrl = extractDbUrl(createdData, dbName, org);
      needInitSchema = true;
    } else if (createRes.status === 409) {
      // 409 Conflict: Eşzamanlı istek veritabanını zaten oluşturdu, detayını çekelim
      const retryGet = await callTursoPlatformApi(`/databases/${dbName}`, env);
      if (retryGet.ok) {
        const retryData = await retryGet.json();
        dbUrl = extractDbUrl(retryData, dbName, org);
      }
    } else {
      const errText = await createRes.text();
      throw new Error(`Turso veritabanı oluşturulamadı (${createRes.status}): ${errText}`);
    }
  } else {
    const errText = await checkRes.text();
    throw new Error(`Turso veritabanı durumu kontrol edilemedi (${checkRes.status}): ${errText}`);
  }

  // 2. Kapsamı bu veritabanı ile sınırlı 1 saatlik full-access token üret
  const tokenEndpoint = `/databases/${dbName}/auth/tokens?expiration=1h&authorization=full-access&permission=full-access`;
  const tokenRes = await callTursoPlatformApi(tokenEndpoint, env, {
    method: 'POST',
    body: JSON.stringify({
      expiration: '1h',
      authorization: 'full-access',
      permission: 'full-access',
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Turso erişim token'ı üretilemedi (${tokenRes.status}): ${errText}`);
  }

  const tokenData = await tokenRes.json();
  const dbToken = tokenData.jwt || tokenData.token;

  if (!dbToken) {
    throw new Error('Turso token yanıtında JWT/token alanı bulunamadı');
  }

  // 3. Eğer yeni oluşturulduysa canonical şemayı veritabanına uygula
  if (needInitSchema && canonicalSchema) {
    try {
      const client = createClient({
        url: dbUrl,
        authToken: dbToken,
      });

      await client.executeMultiple(canonicalSchema);
      console.log(`[Worker] ${dbName} için şema başarıyla yüklendi.`);
    } catch (schemaErr) {
      console.error(`[Worker] ${dbName} için şema yükleme hatası:`, schemaErr);
    }
  }

  return {
    dbUrl,
    token: dbToken,
    expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 saat sonra
  };
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = getCorsHeaders(request, env);

    // CORS Preflight (OPTIONS) İsteği
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const url = new URL(request.url);

    // Health check endpoint
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return jsonResponse(
        {
          status: 'ok',
          service: 'jplanning-auth-worker',
          timestamp: new Date().toISOString(),
        },
        200,
        corsHeaders
      );
    }

    // GET /admin/ping (Admin yetkisi doğrulama ve sağlık kontrolü)
    if (request.method === 'GET' && url.pathname === '/admin/ping') {
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

        const { uid, payload } = await verifyAdminClaim(authHeader, projectId);

        return jsonResponse(
          {
            success: true,
            service: 'jplanning-admin',
            message: 'Admin yetkisi başarıyla doğrulandı',
            uid,
            email: payload.email || null,
            timestamp: new Date().toISOString(),
          },
          200,
          corsHeaders
        );
      } catch (err) {
        console.warn('[Worker /admin/ping Auth Error]:', err.message);

        if (err.isForbidden) {
          return jsonResponse(
            {
              error: 'FORBIDDEN',
              message: 'Yetkisiz erişim: Bu işlem için yönetici (admin) yetkisi gereklidir.',
            },
            403,
            corsHeaders
          );
        }

        const isAuthError =
          err.name?.startsWith('JWT') ||
          err.name?.startsWith('JWS') ||
          err.name?.startsWith('JWE') ||
          err.code?.startsWith('ERR_JWT') ||
          err.code?.startsWith('ERR_JWS') ||
          err.code?.startsWith('ERR_JWE') ||
          err.name === 'JWTExpired' ||
          err.name === 'JWTClaimValidationFailed' ||
          err.name === 'JWSSignatureVerificationFailed' ||
          err.name === 'JWSInvalid' ||
          err.message?.includes('Authorization') ||
          err.message?.includes('Token') ||
          err.message?.includes('token') ||
          err.message?.includes('JWT') ||
          err.message?.includes('jwt');

        if (isAuthError) {
          return jsonResponse(
            {
              error: 'UNAUTHORIZED',
              message: 'Oturum doğrulanamadı veya süresi doldu. Lütfen tekrar giriş yapın.',
            },
            401,
            corsHeaders
          );
        }

        return jsonResponse(
          {
            error: 'INTERNAL_ERROR',
            message: 'Doğrulama sırasında bir hata oluştu.',
            detail: err.message,
          },
          500,
          corsHeaders
        );
      }
    }

    // GET /admin/users (Kullanıcı listesi ve sayfalama)
    if (request.method === 'GET' && url.pathname === '/admin/users') {
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

        await verifyAdminClaim(authHeader, projectId);

        const client = getControlPlaneClient(env);
        if (!client) {
          return jsonResponse(
            {
              error: 'CONTROL_PLANE_UNAVAILABLE',
              message: 'Control Plane veritabanı yapılandırması eksik.',
            },
            503,
            corsHeaders
          );
        }

        const rawPage = parseInt(url.searchParams.get('page'), 10);
        const rawLimit = parseInt(url.searchParams.get('limit'), 10);
        const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
        const limit = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(100, rawLimit);
        const search = (url.searchParams.get('search') || '').trim();
        const sortBy = ['created_at', 'last_login_at', 'task_count', 'jp_balance', 'email'].includes(
          url.searchParams.get('sortBy')
        )
          ? url.searchParams.get('sortBy')
          : 'last_login_at';
        const order = url.searchParams.get('order')?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const offset = (page - 1) * limit;

        let query =
          'SELECT uid, email, display_name, db_name, created_at, last_login_at, task_count, jp_balance, is_disabled, updated_at FROM admin_users_index';
        let countQuery = 'SELECT COUNT(*) as total FROM admin_users_index';
        const args = [];
        const countArgs = [];

        if (search) {
          const searchPattern = `%${search}%`;
          const searchClause = ' WHERE email LIKE ? OR display_name LIKE ? OR uid LIKE ?';
          query += searchClause;
          countQuery += searchClause;
          args.push(searchPattern, searchPattern, searchPattern);
          countArgs.push(searchPattern, searchPattern, searchPattern);
        }

        query += ` ORDER BY ${sortBy} ${order} LIMIT ? OFFSET ?`;
        args.push(limit, offset);

        const [rowsRes, countRes] = await Promise.all([
          client.execute({ sql: query, args }),
          client.execute({ sql: countQuery, args: countArgs }),
        ]);

        const total = Number(countRes.rows[0]?.total || 0);
        const totalPages = Math.ceil(total / limit) || 1;

        return jsonResponse(
          {
            success: true,
            users: rowsRes.rows,
            pagination: {
              page,
              limit,
              total,
              totalPages,
            },
          },
          200,
          corsHeaders
        );
      } catch (err) {
        console.warn('[Worker /admin/users Error]:', err.message);

        if (err.isForbidden) {
          return jsonResponse(
            {
              error: 'FORBIDDEN',
              message: 'Yetkisiz erişim: Bu işlem için yönetici (admin) yetkisi gereklidir.',
            },
            403,
            corsHeaders
          );
        }

        const isAuthError =
          err.name?.startsWith('JWT') ||
          err.name?.startsWith('JWS') ||
          err.name?.startsWith('JWE') ||
          err.code?.startsWith('ERR_JWT') ||
          err.code?.startsWith('ERR_JWS') ||
          err.code?.startsWith('ERR_JWE') ||
          err.name === 'JWTExpired' ||
          err.name === 'JWTClaimValidationFailed' ||
          err.name === 'JWSSignatureVerificationFailed' ||
          err.name === 'JWSInvalid' ||
          err.message?.includes('Authorization') ||
          err.message?.includes('Token') ||
          err.message?.includes('token') ||
          err.message?.includes('JWT') ||
          err.message?.includes('jwt');

        if (isAuthError) {
          return jsonResponse(
            {
              error: 'UNAUTHORIZED',
              message: 'Oturum doğrulanamadı veya süresi doldu.',
            },
            401,
            corsHeaders
          );
        }

        return jsonResponse(
          {
            error: 'INTERNAL_ERROR',
            message: 'Kullanıcı listesi alınırken hata oluştu.',
            detail: err.message,
          },
          500,
          corsHeaders
        );
      }
    }

    // GET /admin/stats (Genel metrikler ve istatistikler)
    if (request.method === 'GET' && url.pathname === '/admin/stats') {
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

        await verifyAdminClaim(authHeader, projectId);

        const client = getControlPlaneClient(env);
        if (!client) {
          return jsonResponse(
            {
              error: 'CONTROL_PLANE_UNAVAILABLE',
              message: 'Control Plane veritabanı yapılandırması eksik.',
            },
            503,
            corsHeaders
          );
        }

        const now = Date.now();
        const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
        const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

        const statsQuery = `
          SELECT
            COUNT(*) AS total_users,
            SUM(CASE WHEN last_login_at >= ? THEN 1 ELSE 0 END) AS active_7d,
            SUM(CASE WHEN last_login_at >= ? THEN 1 ELSE 0 END) AS active_30d,
            SUM(CASE WHEN is_disabled = 1 THEN 1 ELSE 0 END) AS disabled_users,
            COALESCE(SUM(task_count), 0) AS total_tasks,
            COALESCE(SUM(jp_balance), 0) AS total_jp
          FROM admin_users_index;
        `;

        const res = await client.execute({
          sql: statsQuery,
          args: [sevenDaysAgo, thirtyDaysAgo],
        });

        const row = res.rows[0] || {};

        return jsonResponse(
          {
            success: true,
            stats: {
              totalUsers: Number(row.total_users || 0),
              active7d: Number(row.active_7d || 0),
              active30d: Number(row.active_30d || 0),
              disabledUsers: Number(row.disabled_users || 0),
              totalTasks: Number(row.total_tasks || 0),
              totalJP: Number(row.total_jp || 0),
              summaryNotice:
                'task_count ve jp_balance özet sayaçları Faz 3 kullanıcı drill-down aşamasında gerçek zamanlı eşitlenecektir.',
              serverTimestamp: now,
            },
          },
          200,
          corsHeaders
        );
      } catch (err) {
        console.warn('[Worker /admin/stats Error]:', err.message);

        if (err.isForbidden) {
          return jsonResponse(
            {
              error: 'FORBIDDEN',
              message: 'Yetkisiz erişim: Bu işlem için yönetici (admin) yetkisi gereklidir.',
            },
            403,
            corsHeaders
          );
        }

        const isAuthError =
          err.name?.startsWith('JWT') ||
          err.name?.startsWith('JWS') ||
          err.name?.startsWith('JWE') ||
          err.code?.startsWith('ERR_JWT') ||
          err.code?.startsWith('ERR_JWS') ||
          err.code?.startsWith('ERR_JWE') ||
          err.name === 'JWTExpired' ||
          err.name === 'JWTClaimValidationFailed' ||
          err.name === 'JWSSignatureVerificationFailed' ||
          err.name === 'JWSInvalid' ||
          err.message?.includes('Authorization') ||
          err.message?.includes('Token') ||
          err.message?.includes('token') ||
          err.message?.includes('JWT') ||
          err.message?.includes('jwt');

        if (isAuthError) {
          return jsonResponse(
            {
              error: 'UNAUTHORIZED',
              message: 'Oturum doğrulanamadı veya süresi doldu.',
            },
            401,
            corsHeaders
          );
        }

        return jsonResponse(
          {
            error: 'INTERNAL_ERROR',
            message: 'İstatistikler alınırken hata oluştu.',
            detail: err.message,
          },
          500,
          corsHeaders
        );
      }
    }

    // GET /admin/users/:uid/detail (Kullanıcı Detayı - Salt Okunur ve Drill-Down Senkronu)
    const detailMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/detail$/);
    if (request.method === 'GET' && detailMatch) {
      const targetUid = decodeURIComponent(detailMatch[1]);
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

        await verifyAdminClaim(authHeader, projectId);

        const controlClient = getControlPlaneClient(env);
        if (!controlClient) {
          return jsonResponse(
            {
              error: 'CONTROL_PLANE_UNAVAILABLE',
              message: 'Control Plane veritabanı yapılandırması eksik.',
            },
            503,
            corsHeaders
          );
        }

        // 1. Control Plane'den kullanıcı meta bilgilerini al
        const userRowRes = await controlClient.execute({
          sql: 'SELECT uid, email, display_name, db_name, created_at, last_login_at, task_count, jp_balance, is_disabled, updated_at FROM admin_users_index WHERE uid = ? LIMIT 1;',
          args: [targetUid],
        });

        const userMeta = userRowRes.rows[0] || {
          uid: targetUid,
          email: null,
          display_name: null,
          db_name: getDbNameForUser(targetUid),
          created_at: Date.now(),
          last_login_at: Date.now(),
          task_count: 0,
          jp_balance: 0,
          is_disabled: 0,
        };

        const targetDbName = userMeta.db_name || getDbNameForUser(targetUid);

        // 2. Yalnızca bu kullanıcıya özel Turso DB'ye geçici bağlan
        const sessionInfo = await ensureUserDatabase(targetDbName, env);
        const userDbClient = createClient({
          url: sessionInfo.dbUrl,
          authToken: sessionInfo.token,
        });

        // 3. Salt okunur verileri çek (Görevler maks 50, Ödüller maks 50, Kategoriler, Cüzdan)
        const [tasksRes, rewardsRes, categoriesRes, walletRes, countsRes] = await Promise.all([
          userDbClient
            .execute(
              'SELECT id, title, description, notes, categoryId, priority, period, subtaskCount, isArchived, assignmentDirection, assignedByName, firestoreAssignmentId, createdAt FROM tasks ORDER BY createdAt DESC LIMIT 50;'
            )
            .catch(() => ({ rows: [] })),
          userDbClient
            .execute(
              'SELECT id, title, description, cost, isRedeemed, redeemedAt, createdAt FROM rewards ORDER BY createdAt DESC LIMIT 50;'
            )
            .catch(() => ({ rows: [] })),
          userDbClient
            .execute('SELECT id, name, color, createdAt FROM categories;')
            .catch(() => ({ rows: [] })),
          userDbClient
            .execute('SELECT COALESCE(balance, 0) AS balance FROM wallet LIMIT 1;')
            .catch(() => ({ rows: [{ balance: 0 }] })),
          userDbClient
            .execute('SELECT COUNT(*) AS total_tasks FROM tasks WHERE isArchived = 0;')
            .catch(() => ({ rows: [{ total_tasks: 0 }] })),
        ]);

        const realTaskCount = Number(countsRes.rows[0]?.total_tasks ?? tasksRes.rows.length);
        const realJpBalance = Number(walletRes.rows[0]?.balance || 0);
        const now = Date.now();

        // 4. Drill-Down Sync: Control Plane özet sayaçlarını gerçek verilerle güncelle (AWAIT ile kesin kayıt)
        try {
          await controlClient.execute({
            sql: 'UPDATE admin_users_index SET task_count = ?, jp_balance = ?, updated_at = ? WHERE uid = ?;',
            args: [realTaskCount, realJpBalance, now, targetUid],
          });
        } catch (syncErr) {
          console.warn('[Worker Drill-down Sync Error]:', syncErr.message);
        }

        return jsonResponse(
          {
            success: true,
            user: {
              ...userMeta,
              task_count: realTaskCount,
              jp_balance: realJpBalance,
            },
            tasks: tasksRes.rows,
            rewards: rewardsRes.rows,
            categories: categoriesRes.rows,
            wallet: {
              balance: realJpBalance,
            },
            summary: {
              totalTasks: realTaskCount,
              jpBalance: realJpBalance,
              rewardCount: rewardsRes.rows.length,
              syncedAt: now,
            },
          },
          200,
          corsHeaders
        );
      } catch (err) {
        console.error('[Worker /admin/users/:uid/detail Error]:', err);

        if (err.isForbidden) {
          return jsonResponse(
            {
              error: 'FORBIDDEN',
              message: 'Yetkisiz erişim: Bu işlem için yönetici (admin) yetkisi gereklidir.',
            },
            403,
            corsHeaders
          );
        }

        return jsonResponse(
          {
            error: 'INTERNAL_ERROR',
            message: 'Kullanıcı detayları alınamadı.',
            detail: err.message,
          },
          500,
          corsHeaders
        );
      }
    }

    // PATCH /admin/users/:uid/status (Kullanıcı Askıya Alma / Aktifleştirme)
    const statusMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/status$/);
    if (request.method === 'PATCH' && statusMatch) {
      const targetUid = decodeURIComponent(statusMatch[1]);
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

        const { uid: adminUid, payload } = await verifyAdminClaim(authHeader, projectId);

        const body = await request.json();
        const isDisabled =
          body.isDisabled === true || body.isDisabled === 1 || body.isDisabled === '1' ? 1 : 0;

        const controlClient = getControlPlaneClient(env);
        if (!controlClient) {
          return jsonResponse(
            {
              error: 'CONTROL_PLANE_UNAVAILABLE',
              message: 'Control Plane veritabanı yapılandırması eksik.',
            },
            503,
            corsHeaders
          );
        }

        const now = Date.now();
        await controlClient.execute({
          sql: 'UPDATE admin_users_index SET is_disabled = ?, updated_at = ? WHERE uid = ?;',
          args: [isDisabled, now, targetUid],
        });

        // Audit Log Kaydı (Faz 4 — Await ile garantilenir)
        await logAdminAudit(env, {
          adminUid,
          adminEmail: payload.email,
          targetUid,
          action: 'TOGGLE_STATUS',
          oldValue: { is_disabled: !isDisabled ? 1 : 0 },
          newValue: { is_disabled: isDisabled },
          status: 'SUCCESS',
        });

        return jsonResponse(
          {
            success: true,
            uid: targetUid,
            isDisabled: Boolean(isDisabled),
            message: isDisabled ? 'Kullanıcı hesabı askıya alındı.' : 'Kullanıcı hesabı aktifleştirildi.',
          },
          200,
          corsHeaders
        );
      } catch (err) {
        console.error('[Worker /admin/users/:uid/status Error]:', err);

        if (err.isForbidden) {
          return jsonResponse(
            {
              error: 'FORBIDDEN',
              message: 'Yetkisiz erişim.',
            },
            403,
            corsHeaders
          );
        }

        return jsonResponse(
          {
            error: 'INTERNAL_ERROR',
            message: 'Kullanıcı durumu güncellenemedi.',
            detail: err.message,
          },
          500,
          corsHeaders
        );
      }
    }

    // PATCH /admin/users/:uid/tasks/:taskId (Faz 4 — Görev Düzenleme)
    const taskEditMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/tasks\/([^/]+)$/);
    if (request.method === 'PATCH' && taskEditMatch) {
      const targetUid = decodeURIComponent(taskEditMatch[1]);
      const taskId = decodeURIComponent(taskEditMatch[2]);
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

        const { uid: adminUid, payload } = await verifyAdminClaim(authHeader, projectId);

        const body = await request.json();
        const { title, description, notes, priority, period, isArchived } = body;

        // Whitelist girdi denetimi
        const allowedPriorities = ['HIGH', 'MEDIUM', 'LOW', 'ZERO'];
        const allowedPeriods = ['DAILY', 'WEEKLY', 'MONTHLY', 'ONCE'];

        if (priority && !allowedPriorities.includes(String(priority).toUpperCase())) {
          return jsonResponse({ error: 'INVALID_INPUT', message: 'Geçersiz öncelik değeri.' }, 400, corsHeaders);
        }
        if (period && !allowedPeriods.includes(String(period).toUpperCase())) {
          return jsonResponse({ error: 'INVALID_INPUT', message: 'Geçersiz periyot değeri.' }, 400, corsHeaders);
        }

        // Kullanıcının gerçek db_name bilgisini Control Plane'den bul
        let targetDbName = getDbNameForUser(targetUid);
        const controlClient = getControlPlaneClient(env);
        if (controlClient) {
          const userMetaRes = await controlClient.execute({
            sql: 'SELECT db_name FROM admin_users_index WHERE uid = ? LIMIT 1;',
            args: [targetUid],
          }).catch(() => null);
          if (userMetaRes?.rows?.[0]?.db_name) {
            targetDbName = String(userMetaRes.rows[0].db_name);
          }
        }

        const sessionInfo = await ensureUserDatabase(targetDbName, env);
        const userDbClient = createClient({
          url: sessionInfo.dbUrl,
          authToken: sessionInfo.token,
        });

        // 1. Eski kaydı oku
        const oldRes = await userDbClient.execute({
          sql: 'SELECT id, title, description, notes, priority, period, isArchived FROM tasks WHERE id = ? LIMIT 1;',
          args: [taskId],
        });

        if (oldRes.rows.length === 0) {
          return jsonResponse({ error: 'NOT_FOUND', message: 'Düzenlenecek görev bulunamadı.' }, 404, corsHeaders);
        }

        const oldTask = oldRes.rows[0];

        // 2. Dinamik güncelleme sorgusu (sadece gelen whitelist alanları güncelle)
        const updateFields = [];
        const updateArgs = [];

        if (title !== undefined) {
          updateFields.push('title = ?');
          updateArgs.push(String(title).trim().slice(0, 300));
        }
        if (description !== undefined) {
          updateFields.push('description = ?');
          updateArgs.push(description ? String(description).trim().slice(0, 1000) : null);
        }
        if (notes !== undefined) {
          updateFields.push('notes = ?');
          updateArgs.push(notes ? String(notes).trim().slice(0, 1000) : null);
        }
        if (priority !== undefined) {
          updateFields.push('priority = ?');
          updateArgs.push(String(priority).toUpperCase());
        }
        if (period !== undefined) {
          updateFields.push('period = ?');
          updateArgs.push(String(period).toUpperCase());
        }
        if (isArchived !== undefined) {
          updateFields.push('isArchived = ?');
          updateArgs.push(isArchived === 1 || isArchived === true ? 1 : 0);
        }

        if (updateFields.length === 0) {
          return jsonResponse({ error: 'NO_CHANGES', message: 'Güncellenecek geçerli bir alan belirtilmedi.' }, 400, corsHeaders);
        }

        updateArgs.push(taskId);
        await userDbClient.execute({
          sql: `UPDATE tasks SET ${updateFields.join(', ')} WHERE id = ?;`,
          args: updateArgs,
        });

        // 3. Değiştirilemez Audit Log Kaydı (Await ile garantilenir)
        await logAdminAudit(env, {
          adminUid,
          adminEmail: payload.email,
          targetUid,
          action: 'UPDATE_TASK',
          oldValue: oldTask,
          newValue: { ...oldTask, ...body, id: taskId },
          status: 'SUCCESS',
        });

        return jsonResponse(
          {
            success: true,
            taskId,
            message: 'Görev başarıyla güncellendi.',
          },
          200,
          corsHeaders
        );
      } catch (err) {
        console.error('[Worker /admin/users/:uid/tasks/:taskId Error]:', err);
        if (err.isForbidden) {
          return jsonResponse({ error: 'FORBIDDEN', message: 'Yetkisiz erişim.' }, 403, corsHeaders);
        }
        return jsonResponse({ error: 'INTERNAL_ERROR', message: 'Görev güncellenemedi.', detail: err.message }, 500, corsHeaders);
      }
    }

    // PATCH /admin/users/:uid/wallet (Faz 4 — Cüzdan JP Bakiyesi Düzenleme)
    const walletEditMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/wallet$/);
    if (request.method === 'PATCH' && walletEditMatch) {
      const targetUid = decodeURIComponent(walletEditMatch[1]);
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

        const { uid: adminUid, payload } = await verifyAdminClaim(authHeader, projectId);

        const body = await request.json();
        const rawBalance = parseInt(body.balance, 10);
        const reason = (body.reason || '').trim();

        // 1. Doğrulama: Bakiye >= 0 ve Reason zorunlu (min 3 karakter)
        if (isNaN(rawBalance) || rawBalance < 0) {
          return jsonResponse(
            { error: 'INVALID_INPUT', message: 'Cüzdan bakiyesi negatif olamaz ve geçerli bir sayı olmalıdır.' },
            400,
            corsHeaders
          );
        }

        if (!reason || reason.length < 3) {
          return jsonResponse(
            { error: 'REASON_REQUIRED', message: 'Bakiye değişikliği için en az 3 karakterlik bir gerekçe (reason) belirtilmesi zorunludur.' },
            400,
            corsHeaders
          );
        }

        // Kullanıcının gerçek db_name bilgisini Control Plane'den bul
        let targetDbName = getDbNameForUser(targetUid);
        const controlClient = getControlPlaneClient(env);
        if (controlClient) {
          const userMetaRes = await controlClient.execute({
            sql: 'SELECT db_name FROM admin_users_index WHERE uid = ? LIMIT 1;',
            args: [targetUid],
          }).catch(() => null);
          if (userMetaRes?.rows?.[0]?.db_name) {
            targetDbName = String(userMetaRes.rows[0].db_name);
          }
        }

        const sessionInfo = await ensureUserDatabase(targetDbName, env);
        const userDbClient = createClient({
          url: sessionInfo.dbUrl,
          authToken: sessionInfo.token,
        });

        // 2. Eski bakiyeyi oku
        const oldWalletRes = await userDbClient
          .execute('SELECT balance FROM wallet WHERE userId = \'me\' LIMIT 1;')
          .catch(() => ({ rows: [] }));
        const oldBalance = Number(oldWalletRes.rows[0]?.balance ?? 0);

        // 3. Kullanıcı DB'sinde wallet tablosunu güncelle (upsert)
        await userDbClient.execute({
          sql: "INSERT INTO wallet (userId, balance) VALUES ('me', ?) ON CONFLICT(userId) DO UPDATE SET balance = excluded.balance;",
          args: [rawBalance],
        });

        // 4. Control Plane üzerindeki jp_balance sayacını anında güncelle
        const now = Date.now();
        if (controlClient) {
          await controlClient
            .execute({
              sql: 'UPDATE admin_users_index SET jp_balance = ?, updated_at = ? WHERE uid = ?;',
              args: [rawBalance, now, targetUid],
            })
            .catch(() => {});
        }

        // 5. Değiştirilemez Audit Log Kaydı (Await ile garantilenir)
        await logAdminAudit(env, {
          adminUid,
          adminEmail: payload.email,
          targetUid,
          action: 'UPDATE_WALLET',
          oldValue: { balance: oldBalance },
          newValue: { balance: rawBalance, reason },
          status: 'SUCCESS',
        });

        return jsonResponse(
          {
            success: true,
            uid: targetUid,
            newBalance: rawBalance,
            reason,
            message: 'Cüzdan bakiyesi başarıyla güncellendi.',
          },
          200,
          corsHeaders
        );
      } catch (err) {
        console.error('[Worker /admin/users/:uid/wallet Error]:', err);
        if (err.isForbidden) {
          return jsonResponse({ error: 'FORBIDDEN', message: 'Yetkisiz erişim.' }, 403, corsHeaders);
        }
        return jsonResponse({ error: 'INTERNAL_ERROR', message: 'Cüzdan bakiyesi güncellenemedi.', detail: err.message }, 500, corsHeaders);
      }
    }

    // PATCH /admin/users/:uid/rewards/:rewardId (Faz 4 — Ödül Düzenleme)
    const rewardEditMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/rewards\/([^/]+)$/);
    if (request.method === 'PATCH' && rewardEditMatch) {
      const targetUid = decodeURIComponent(rewardEditMatch[1]);
      const rewardId = decodeURIComponent(rewardEditMatch[2]);
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

        const { uid: adminUid, payload } = await verifyAdminClaim(authHeader, projectId);

        const body = await request.json();
        const { title, cost, isRedeemed } = body;

        if (cost !== undefined) {
          const rawCost = parseInt(cost, 10);
          if (isNaN(rawCost) || rawCost < 0) {
            return jsonResponse(
              { error: 'INVALID_INPUT', message: 'Ödül maliyeti negatif olamaz.' },
              400,
              corsHeaders
            );
          }
        }

        // Kullanıcının gerçek db_name bilgisini Control Plane'den bul
        let targetDbName = getDbNameForUser(targetUid);
        const controlClient = getControlPlaneClient(env);
        if (controlClient) {
          const userMetaRes = await controlClient.execute({
            sql: 'SELECT db_name FROM admin_users_index WHERE uid = ? LIMIT 1;',
            args: [targetUid],
          }).catch(() => null);
          if (userMetaRes?.rows?.[0]?.db_name) {
            targetDbName = String(userMetaRes.rows[0].db_name);
          }
        }

        const sessionInfo = await ensureUserDatabase(targetDbName, env);
        const userDbClient = createClient({
          url: sessionInfo.dbUrl,
          authToken: sessionInfo.token,
        });

        // 1. Eski kaydı oku
        const oldRewardRes = await userDbClient.execute({
          sql: 'SELECT id, title, cost, isRedeemed, redeemedAt FROM rewards WHERE id = ? LIMIT 1;',
          args: [rewardId],
        });

        if (oldRewardRes.rows.length === 0) {
          return jsonResponse({ error: 'NOT_FOUND', message: 'Düzenlenecek ödül bulunamadı.' }, 404, corsHeaders);
        }

        const oldReward = oldRewardRes.rows[0];

        // 2. Dinamik güncelleme
        const updateFields = [];
        const updateArgs = [];

        if (title !== undefined) {
          updateFields.push('title = ?');
          updateArgs.push(String(title).trim().slice(0, 300));
        }
        if (cost !== undefined) {
          updateFields.push('cost = ?');
          updateArgs.push(parseInt(cost, 10));
        }
        if (isRedeemed !== undefined) {
          const redeemedInt = isRedeemed === 1 || isRedeemed === true ? 1 : 0;
          updateFields.push('isRedeemed = ?');
          updateArgs.push(redeemedInt);
          if (redeemedInt === 1 && !oldReward.redeemedAt) {
            updateFields.push('redeemedAt = ?');
            updateArgs.push(Date.now());
          }
        }

        if (updateFields.length === 0) {
          return jsonResponse({ error: 'NO_CHANGES', message: 'Güncellenecek alan belirtilmedi.' }, 400, corsHeaders);
        }

        updateArgs.push(rewardId);
        await userDbClient.execute({
          sql: `UPDATE rewards SET ${updateFields.join(', ')} WHERE id = ?;`,
          args: updateArgs,
        });

        // 3. Audit Log Kaydı (Await ile garantilenir)
        await logAdminAudit(env, {
          adminUid,
          adminEmail: payload.email,
          targetUid,
          action: 'UPDATE_REWARD',
          oldValue: oldReward,
          newValue: { ...oldReward, ...body, id: rewardId },
          status: 'SUCCESS',
        });

        return jsonResponse(
          {
            success: true,
            rewardId,
            message: 'Ödül başarıyla güncellendi.',
          },
          200,
          corsHeaders
        );
      } catch (err) {
        console.error('[Worker /admin/users/:uid/rewards/:rewardId Error]:', err);
        if (err.isForbidden) {
          return jsonResponse({ error: 'FORBIDDEN', message: 'Yetkisiz erişim.' }, 403, corsHeaders);
        }
        return jsonResponse({ error: 'INTERNAL_ERROR', message: 'Ödül güncellenemedi.', detail: err.message }, 500, corsHeaders);
      }
    }

    // GET /admin/audit-logs (Faz 4 — Değiştirilemez Aktivite Geçmişi Listesi)
    if (request.method === 'GET' && url.pathname === '/admin/audit-logs') {
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

        await verifyAdminClaim(authHeader, projectId);

        const client = getControlPlaneClient(env);
        if (!client) {
          return jsonResponse(
            {
              error: 'CONTROL_PLANE_UNAVAILABLE',
              message: 'Control Plane veritabanı yapılandırması eksik.',
            },
            503,
            corsHeaders
          );
        }

        await ensureAuditLogSchema(client);

        const rawPage = parseInt(url.searchParams.get('page'), 10);
        const rawLimit = parseInt(url.searchParams.get('limit'), 10);
        const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
        const limit = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(100, rawLimit);
        const targetUid = url.searchParams.get('targetUid');
        const action = url.searchParams.get('action');

        const offset = (page - 1) * limit;

        let query = `
          SELECT 
            l.id, 
            l.admin_uid, 
            l.admin_email, 
            l.target_user_uid, 
            l.action, 
            l.old_value, 
            l.new_value, 
            l.status, 
            l.error_message, 
            l.created_at,
            u.email AS target_user_email,
            u.display_name AS target_user_name
          FROM admin_audit_log l
          LEFT JOIN admin_users_index u ON l.target_user_uid = u.uid
        `;
        let countQuery = 'SELECT COUNT(*) as total FROM admin_audit_log l';
        const args = [];
        const countArgs = [];
        const whereClauses = [];

        if (targetUid) {
          whereClauses.push('l.target_user_uid = ?');
          args.push(targetUid);
          countArgs.push(targetUid);
        }
        if (action) {
          whereClauses.push('l.action = ?');
          args.push(action);
          countArgs.push(action);
        }

        if (whereClauses.length > 0) {
          const whereSql = ` WHERE ${whereClauses.join(' AND ')}`;
          query += whereSql;
          countQuery += whereSql;
        }

        query += ' ORDER BY l.created_at DESC LIMIT ? OFFSET ?;';
        args.push(limit, offset);

        const [rowsRes, countRes] = await Promise.all([
          client.execute({ sql: query, args }),
          client.execute({ sql: countQuery, args: countArgs }),
        ]);

        const total = Number(countRes.rows[0]?.total || 0);
        const totalPages = Math.ceil(total / limit) || 1;

        return jsonResponse(
          {
            success: true,
            logs: rowsRes.rows,
            pagination: {
              page,
              limit,
              total,
              totalPages,
            },
          },
          200,
          corsHeaders
        );
      } catch (err) {
        console.error('[Worker /admin/audit-logs Error]:', err);
        if (err.isForbidden) {
          return jsonResponse({ error: 'FORBIDDEN', message: 'Yetkisiz erişim.' }, 403, corsHeaders);
        }
        return jsonResponse({ error: 'INTERNAL_ERROR', message: 'Audit loglar alınamadı.', detail: err.message }, 500, corsHeaders);
      }
    }

    // DELETE /account (Kullanıcı Kendi Hesabını Sildiğinde Turso DB ve Control Plane Kaydını Temizleme)
    if ((request.method === 'DELETE' && url.pathname === '/account') || (request.method === 'POST' && url.pathname === '/account/delete')) {
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

        // 1. Firebase Token Doğrulama
        const { uid, payload } = await verifyFirebaseToken(authHeader, projectId);

        const dbName = getDbNameForUser(uid);

        // 2. Turso Platform API üzerinden kullanıcının veritabanını sil
        try {
          const deleteDbRes = await callTursoPlatformApi(`/databases/${dbName}`, env, {
            method: 'DELETE',
          });
          if (!deleteDbRes.ok && deleteDbRes.status !== 404) {
            const errText = await deleteDbRes.text();
            console.warn(`[Worker /account] Turso DB silinirken uyarı (${deleteDbRes.status}):`, errText);
          } else {
            console.log(`[Worker /account] ${dbName} Turso DB başarıyla silindi.`);
          }
        } catch (tursoErr) {
          console.warn(`[Worker /account] Turso DB silme hatası (${dbName}):`, tursoErr.message);
        }

        // 3. Control Plane'deki admin_users_index kaydını sil
        const controlClient = getControlPlaneClient(env);
        if (controlClient) {
          try {
            await controlClient.execute({
              sql: 'DELETE FROM admin_users_index WHERE uid = ?;',
              args: [uid],
            });
            console.log(`[Worker /account] ${uid} control plane kaydı silindi.`);
          } catch (cpErr) {
            console.warn(`[Worker /account] Control Plane kaydı silinirken hata:`, cpErr.message);
          }
        }

        // 4. Audit Log kaydı
        await logAdminAudit(env, {
          adminUid: uid,
          adminEmail: payload.email || null,
          targetUid: uid,
          action: 'USER_SELF_DELETED',
          oldValue: { dbName, email: payload.email },
          newValue: null,
          status: 'SUCCESS',
        });

        return jsonResponse(
          {
            success: true,
            message: 'Kullanıcı veritabanı ve kontrol paneli kaydı başarıyla silindi.',
          },
          200,
          corsHeaders
        );
      } catch (err) {
        console.error('[Worker /account Error]:', err);

        const isAuthError =
          err.name?.startsWith('JWT') ||
          err.name?.startsWith('JWS') ||
          err.name?.startsWith('JWE') ||
          err.code?.startsWith('ERR_JWT') ||
          err.code?.startsWith('ERR_JWS') ||
          err.code?.startsWith('ERR_JWE') ||
          err.name === 'JWTExpired' ||
          err.name === 'JWTClaimValidationFailed' ||
          err.name === 'JWSSignatureVerificationFailed' ||
          err.name === 'JWSInvalid' ||
          err.message?.includes('Authorization') ||
          err.message?.includes('Token') ||
          err.message?.includes('token') ||
          err.message?.includes('JWT') ||
          err.message?.includes('jwt');

        if (isAuthError) {
          return jsonResponse(
            {
              error: 'UNAUTHORIZED',
              message: 'Oturum doğrulanamadı veya süresi doldu.',
            },
            401,
            corsHeaders
          );
        }

        return jsonResponse(
          {
            error: 'INTERNAL_ERROR',
            message: 'Hesap veritabanı silinirken bir hata oluştu.',
            detail: err.message,
          },
          500,
          corsHeaders
        );
      }
    }

    // POST /session (Firebase Token -> Turso DB & Scoped Token)
    if (request.method === 'POST' && url.pathname === '/session') {
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

        // 1. Firebase Token Doğrulama
        const { uid, payload } = await verifyFirebaseToken(authHeader, projectId);

        // 2. Kullanıcı Askıya Alınmış mı? (Control Plane Denetimi)
        const controlClient = getControlPlaneClient(env);
        if (controlClient) {
          try {
            const checkRes = await controlClient.execute({
              sql: 'SELECT is_disabled FROM admin_users_index WHERE uid = ? LIMIT 1;',
              args: [uid],
            });
            if (checkRes.rows.length > 0 && Number(checkRes.rows[0].is_disabled) === 1) {
              return jsonResponse(
                {
                  error: 'ACCOUNT_DISABLED',
                  message:
                    'Hesabınız yönetici tarafından askıya alınmıştır. Lütfen destek ekibi ile iletişime geçin.',
                },
                403,
                corsHeaders
              );
            }
          } catch (checkErr) {
            console.warn('[Worker /session Disabled Check Warning]:', checkErr.message);
          }
        }

        // 3. Kullanıcıya özel DB adı
        const dbName = getDbNameForUser(uid);

        // 4. DB kontrolü / oluşturma & scoped token üretimi
        const sessionInfo = await ensureUserDatabase(dbName, env);

        // 5. Control Plane sync (Fire-and-forget, ana akışı geciktirmez)
        const syncPromise = syncUserToControlPlane(env, {
          uid,
          email: payload.email,
          displayName: payload.name || payload.display_name,
          dbName,
        });

        if (ctx?.waitUntil) {
          ctx.waitUntil(syncPromise);
        } else {
          syncPromise.catch(() => { });
        }

        return jsonResponse(
          {
            success: true,
            uid,
            dbName,
            dbUrl: sessionInfo.dbUrl,
            token: sessionInfo.token,
            expiresAt: sessionInfo.expiresAt,
          },
          200,
          corsHeaders
        );
      } catch (err) {
        console.error('[Worker /session Error]:', err);

        const isAuthError =
          err.name?.startsWith('JWT') ||
          err.name?.startsWith('JWS') ||
          err.name?.startsWith('JWE') ||
          err.code?.startsWith('ERR_JWT') ||
          err.code?.startsWith('ERR_JWS') ||
          err.code?.startsWith('ERR_JWE') ||
          err.name === 'JWTExpired' ||
          err.name === 'JWTClaimValidationFailed' ||
          err.name === 'JWSSignatureVerificationFailed' ||
          err.name === 'JWSInvalid' ||
          err.message?.includes('Authorization') ||
          err.message?.includes('Token') ||
          err.message?.includes('token') ||
          err.message?.includes('JWT') ||
          err.message?.includes('jwt');

        if (isAuthError) {
          return jsonResponse(
            {
              error: 'UNAUTHORIZED',
              message: 'Oturum doğrulanamadı veya süresi doldu. Lütfen tekrar giriş yapın.',
            },
            401,
            corsHeaders
          );
        }

        return jsonResponse(
          {
            error: 'DATABASE_UNAVAILABLE',
            message: 'Veritabanı servisine şu anda ulaşılamıyor. Lütfen birkaç saniye sonra tekrar deneyin.',
            detail: err.message,
            retryable: true,
          },
          503,
          corsHeaders
        );
      }
    }

    return jsonResponse({ error: 'NOT_FOUND', message: 'Endpoint bulunamadı' }, 404, corsHeaders);
  },
};
