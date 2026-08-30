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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

// Rate Limiter: KV binding varsa KV ile, yoksa in-memory sliding-window fallback
const memoryRateLimitMap = new Map();

async function isRateLimited(request, env, identifier = null) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || '127.0.0.1';
  const keyId = identifier || ip;
  const now = Date.now();
  const minuteWindow = Math.floor(now / 60000);
  const limit = 40; // dakikada maks 40 istek

  // 1. Cloudflare KV varsa kullan
  if (env.RATE_LIMIT_KV) {
    try {
      const kvKey = `rl:${keyId}:${minuteWindow}`;
      const countStr = await env.RATE_LIMIT_KV.get(kvKey);
      const count = countStr ? parseInt(countStr, 10) : 0;
      if (count >= limit) {
        return true;
      }
      await env.RATE_LIMIT_KV.put(kvKey, (count + 1).toString(), { expirationTtl: 65 });
      return false;
    } catch (_) {
      // KV hatası durumunda in-memory'e düş
    }
  }

  // 2. In-Memory fallback (lokal test ve tekil isolate için)
  const userRecord = memoryRateLimitMap.get(keyId) || { count: 0, resetAt: now + 60000 };
  if (now > userRecord.resetAt) {
    userRecord.count = 0;
    userRecord.resetAt = now + 60000;
  }
  userRecord.count++;
  memoryRateLimitMap.set(keyId, userRecord);

  // Periyodik temizlik (RAM şişmesini önle)
  if (memoryRateLimitMap.size > 5000) {
    for (const [k, v] of memoryRateLimitMap.entries()) {
      if (now > v.resetAt) memoryRateLimitMap.delete(k);
    }
  }

  return userRecord.count > limit;
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

    // Rate Limiting Kontrolü (Tüm /session ve /admin/* endpoint'leri için)
    if (url.pathname === '/session' || url.pathname.startsWith('/admin/')) {
      if (await isRateLimited(request, env)) {
        return jsonResponse(
          {
            error: 'TOO_MANY_REQUESTS',
            message: 'Çok fazla istek gönderildi. Lütfen bir süre bekleyin.',
          },
          429,
          corsHeaders
        );
      }
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
              'SELECT id, title, description, notes, categoryId, priority, period, subtaskCount, isArchived, createdAt FROM tasks ORDER BY createdAt DESC LIMIT 50;'
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
            .execute('SELECT COUNT(*) AS total_tasks FROM tasks;')
            .catch(() => ({ rows: [{ total_tasks: 0 }] })),
        ]);

        const realTaskCount = Number(countsRes.rows[0]?.total_tasks || tasksRes.rows.length);
        const realJpBalance = Number(walletRes.rows[0]?.balance || 0);
        const now = Date.now();

        // 4. Drill-Down Sync: Control Plane özet sayaçlarını gerçek verilerle güncelle (fire-and-forget)
        controlClient
          .execute({
            sql: 'UPDATE admin_users_index SET task_count = ?, jp_balance = ?, updated_at = ? WHERE uid = ?;',
            args: [realTaskCount, realJpBalance, now, targetUid],
          })
          .catch((syncErr) => console.warn('[Worker Drill-down Sync Error]:', syncErr.message));

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

        await verifyAdminClaim(authHeader, projectId);

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
          syncPromise.catch(() => {});
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
