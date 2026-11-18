import { createRemoteJWKSet, jwtVerify, SignJWT, importPKCS8 } from 'jose';
import { createClient } from '@libsql/client/web';
import canonicalSchema from '../../schema.sql';
import { getPeriodKey, getPeriodEndTimestamp } from './periodUtils.js';
import {
  DEFAULT_TIME_ZONE,
  normalizeTimeZone,
  getTimeZoneOffsetMs,
  computeNextWeeklyFireAt,
  computeNextDailyFireAt,
} from './timeUtils.js';

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
  const org = env?.TURSO_ORG;
  const dbUrl = env?.TURSO_CONTROL_DB_URL || (org ? `libsql://jplanning-control-${org}.turso.io` : null);
  const dbToken = env?.TURSO_CONTROL_DB_TOKEN || env?.TURSO_PLATFORM_TOKEN;

  if (!dbToken || !dbUrl) {
    return null;
  }

  try {
    return createClient({
      url: dbUrl,
      authToken: dbToken,
    });
  } catch (err) {
    console.warn('[Worker Control Plane Client Init Warning]:', err.message);
    return null;
  }
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
        display_name = CASE
          WHEN excluded.display_name IS NOT NULL AND excluded.display_name != '' THEN excluded.display_name
          ELSE admin_users_index.display_name
        END,
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
        target_user_email TEXT,
        action TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        status TEXT DEFAULT 'SUCCESS',
        error_message TEXT,
        detail TEXT,
        created_at INTEGER NOT NULL
      );
    `);

    // Tablo zaten varsa eksik kolonları ekle (PRAGMA table_info kontrolü ile)
    const tableInfo = await client.execute('PRAGMA table_info(admin_audit_log);').catch(() => null);
    const existingCols = new Set(tableInfo?.rows?.map((r) => r.name) || []);
    const cols = ['admin_email', 'target_user_email', 'old_value', 'new_value', 'status', 'error_message', 'detail'];
    for (const col of cols) {
      if (!existingCols.has(col)) {
        await client.execute(`ALTER TABLE admin_audit_log ADD COLUMN ${col} TEXT;`).catch(() => {});
      }
    }
    auditSchemaInitialized = true;
  } catch (e) {
    console.warn('[Audit Log Schema Warning]:', e.message);
  }
}

/**
 * Control plane şeması (bildirimler için):
 * - admin_users_index: reminder_enabled, reminder_hour, timezone, reminder_next_at kolonları
 * - notification_schedules: kullanıcının özel bildirim zamanlamaları
 * İzolat başına bir kez çalışır.
 */
let controlPlaneUsersIndexInitialized = false;
async function ensureControlPlaneUsersIndexSchema(client) {
  if (controlPlaneUsersIndexInitialized || !client) return;
  try {
    const tableInfo = await client.execute('PRAGMA table_info(admin_users_index);').catch(() => null);
    const existingCols = new Set(tableInfo?.rows?.map((r) => r.name) || []);
    const missingColumns = [
      ['reminder_enabled', 'INTEGER NOT NULL DEFAULT 0'],
      ['reminder_hour', 'INTEGER NOT NULL DEFAULT 20'],
      ['timezone', 'TEXT'],
      ['reminder_next_at', 'INTEGER'],
    ].filter(([name]) => existingCols.size > 0 && !existingCols.has(name));
    for (const [name, type] of missingColumns) {
      await client.execute(`ALTER TABLE admin_users_index ADD COLUMN ${name} ${type};`).catch(() => {});
    }

    await client.batch(
      [
        `CREATE TABLE IF NOT EXISTS notification_schedules (
          id TEXT PRIMARY KEY,
          uid TEXT NOT NULL,
          weekdays TEXT NOT NULL,
          hour INTEGER NOT NULL,
          minute INTEGER NOT NULL,
          label TEXT,
          timezone TEXT NOT NULL,
          next_fire_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );`,
        'CREATE INDEX IF NOT EXISTS idx_notification_schedules_uid ON notification_schedules(uid);',
        'CREATE INDEX IF NOT EXISTS idx_notification_schedules_next ON notification_schedules(next_fire_at);',
        'CREATE INDEX IF NOT EXISTS idx_admin_users_reminder_next ON admin_users_index(reminder_next_at);',
      ],
      'write'
    );
    controlPlaneUsersIndexInitialized = true;
  } catch (e) {
    console.warn('[Control Plane Schema Warning]:', e.message);
  }
}

/**
 * Admin tarafından yapılan değişiklikleri Control Plane DB'deki admin_audit_log tablosuna kaydeder.
 * Append-only çalışır; kayıtlar asla silinemez veya güncellenemez.
 */
async function logAdminAudit(env, { adminUid, adminEmail, targetUid, targetEmail = null, action, oldValue, newValue, status = 'SUCCESS', errorMessage = null }) {
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
        id, admin_uid, admin_email, target_user_uid, target_user_email, action, old_value, new_value, status, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    await client.execute({
      sql,
      args: [
        id,
        adminUid,
        adminEmail || null,
        targetUid,
        targetEmail || null,
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
 * Hedef kullanıcının e-postasını Control Plane veya Firestore üzerinden çözer.
 * Kullanıcı silinmeden önce çağrılarak kalıcı audit log kaydı için e-posta temin edilir.
 */
async function resolveTargetUserEmail(env, uid, controlClient = null) {
  if (!uid) return null;
  // 1. Önce Control Plane admin_users_index tablosunu kontrol et
  try {
    const client = controlClient || getControlPlaneClient(env);
    if (client) {
      const res = await client.execute({
        sql: 'SELECT email FROM admin_users_index WHERE uid = ? LIMIT 1;',
        args: [uid],
      });
      if (res?.rows?.length > 0 && res.rows[0].email) {
        return String(res.rows[0].email);
      }
    }
  } catch (e) {
    console.warn('[resolveTargetUserEmail index warning]:', e.message);
  }

  // 2. Yoksa Firestore users/{uid} dokümanını kontrol et
  try {
    if (env?.FIREBASE_SERVICE_ACCOUNT) {
      const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';
      const googleToken = await getGoogleAccessToken(env.FIREBASE_SERVICE_ACCOUNT);
      const fsBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
      const res = await fetch(`${fsBase}/users/${encodeURIComponent(uid)}`, {
        headers: { Authorization: `Bearer ${googleToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.fields?.email?.stringValue) {
          return String(data.fields.email.stringValue);
        }
      }
    }
  } catch (e) {
    console.warn('[resolveTargetUserEmail firestore warning]:', e.message);
  }

  return null;
}

/**
 * Turso Platform API Çağrısı Yardımcısı
 */
async function callTursoPlatformApi(endpoint, env, options = {}) {
  const org = env?.TURSO_ORG;
  const platformToken = env?.TURSO_PLATFORM_TOKEN;

  if (!org || !platformToken) {
    const missing = [];
    if (!org) missing.push('TURSO_ORG');
    if (!platformToken) missing.push('TURSO_PLATFORM_TOKEN');
    throw new Error(`Turso Platform API yapılandırması eksik (${missing.join(', ')} tanımlı değil). Yerel ortam için worker/.dev.vars dosyasını kontrol edin.`);
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

const userDbSessionCache = new Map(); // dbName -> { dbUrl, token, expiresAt }

/**
 * Kullanıcı için veritabanının varlığını kontrol eder, yoksa oluşturup şemayı yükler.
 * Başarılı token'ları ~50 dakika önbellekte tutarak Turso Platform API yükünü ve gecikmeyi önler.
 */
async function ensureUserDatabase(dbName, env) {
  const now = Date.now();
  const cached = userDbSessionCache.get(dbName);
  if (cached && now < cached.expiresAt - 5 * 60 * 1000) {
    // expiresAt MUTLAKA döndürülür: istemci bunu almazsa token'ı "1 saat geçerli"
    // varsayar; oysa önbellekteki token'ın ömrü 5 dakikaya kadar inmiş olabilir.
    return { dbUrl: cached.dbUrl, token: cached.token, expiresAt: Math.floor(cached.expiresAt / 1000) };
  }

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

  userDbSessionCache.set(dbName, {
    dbUrl,
    token: dbToken,
    expiresAt: now + 3600 * 1000,
  });

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
    expiresAt: Math.floor(now / 1000) + 3600, // Token üretim isteğinin başladığı andan 1 saat sonra
  };
}

/**
 * ============================================================================
 * FCM Web Push Bildirim Motoru & Google OAuth2 Yönetimi
 * ============================================================================
 */
let cachedGoogleAccessToken = null;
let cachedGoogleTokenExpiresAt = 0;

/**
 * Service Account kimliğiyle Google OAuth2 erişim token'ı üretir ve ~50 dakika önbelleğe alır.
 */
async function getGoogleAccessToken(serviceAccountJson) {
  const now = Date.now();
  if (cachedGoogleAccessToken && now < cachedGoogleTokenExpiresAt - 5 * 60 * 1000) {
    return cachedGoogleAccessToken;
  }

  if (!serviceAccountJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT ortam değişkeni (secret) tanımlanmamış. Yerel geliştirme için worker/.dev.vars dosyasını kontrol edin.');
  }

  let sa;
  if (typeof serviceAccountJson === 'string') {
    try {
      sa = JSON.parse(serviceAccountJson);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT JSON formatı geçersiz. Geçerli bir Service Account JSON dizesi girilmelidir.');
    }
  } else if (typeof serviceAccountJson === 'object' && serviceAccountJson !== null) {
    sa = serviceAccountJson;
  } else {
    throw new Error('FIREBASE_SERVICE_ACCOUNT geçersiz türde.');
  }

  if (!sa || !sa.client_email || !sa.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT içinde client_email veya private_key eksik.');
  }

  const privateKey = await importPKCS8(sa.private_key, 'RS256');
  const issuedAt = Math.floor(now / 1000);
  const jwt = await new SignJWT({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit',
    iat: issuedAt,
    exp: issuedAt + 3600,
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .sign(privateKey);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Google OAuth token alınamadı: ${data.error_description || data.error || res.status}`);
  }

  cachedGoogleAccessToken = data.access_token;
  cachedGoogleTokenExpiresAt = now + (data.expires_in || 3600) * 1000;
  return cachedGoogleAccessToken;
}

/**
 * Google Identity Toolkit Admin REST API çağrısı yapar (accounts:delete, accounts:update vb.)
 */
async function callFirebaseAuthAdminApi(env, action, body) {
  if (!env?.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT ortam değişkeni (secret) tanımlanmamış. Yerel ortam için worker/.dev.vars dosyasını kontrol edin.');
  }
  const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';
  const accessToken = await getGoogleAccessToken(env.FIREBASE_SERVICE_ACCOUNT);
  const url = `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/${action}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/**
 * Hedef kullanıcının Firestore `users/{uid}` dokümanındaki `fcmTokens` dizisini çeker.
 */
async function getTargetUserFcmTokens(projectId, targetUid, accessToken) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(targetUid)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    if (res.status === 404) return [];
    const text = await res.text();
    console.warn(`[Push FCM] Firestore kullanıcı okuma hatası (${res.status}):`, text);
    return [];
  }

  const docData = await res.json();
  const rawValues = docData.fields?.fcmTokens?.arrayValue?.values || [];
  return rawValues.map((v) => v.stringValue).filter(Boolean);
}

/**
 * İki kullanıcı arasındaki arkadaşlık ilişkisini Firestore'dan doğrular.
 * - requireAccepted=false: fromUid -> toUid yönünde herhangi bir kayıt (PENDING/ACCEPTED) yeterlidir
 *   (arkadaşlık isteği bildirimi için: isteği gerçekten göndermiş olmalı).
 * - requireAccepted=true: iki yönden birinde ACCEPTED kayıt gerekir (görev bildirimleri için).
 * Hata durumunda İSTİSNA fırlatır (çağıran bildirimi göndermez: güvenli taraf).
 */
async function hasFriendshipRelation(projectId, accessToken, senderUid, targetUid, requireAccepted) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const buildBody = (fromUid, toUid) => ({
    structuredQuery: {
      from: [{ collectionId: 'friendships' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'fromUid' }, op: 'EQUAL', value: { stringValue: fromUid } } },
            { fieldFilter: { field: { fieldPath: 'toUid' }, op: 'EQUAL', value: { stringValue: toUid } } },
          ],
        },
      },
      limit: 10,
    },
  });

  const runOne = async (fromUid, toUid) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody(fromUid, toUid)),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Arkadaşlık doğrulama sorgusu başarısız (${res.status}): ${text.slice(0, 200)}`);
    }
    const rows = await res.json();
    return (Array.isArray(rows) ? rows : [])
      .filter((r) => r && r.document)
      .map((r) => r.document.fields?.status?.stringValue || '');
  };

  if (!requireAccepted) {
    const statuses = await runOne(senderUid, targetUid);
    return statuses.length > 0;
  }

  const [sent, received] = await Promise.all([runOne(senderUid, targetUid), runOne(targetUid, senderUid)]);
  return [...sent, ...received].includes('ACCEPTED');
}

/**
 * Gönderenin görünen adını Firestore profilinden okur (istemciden gelen ada güvenilmez).
 */
async function getUserDisplayName(projectId, accessToken, uid) {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(uid)}?mask.fieldPaths=displayName`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const data = await res.json();
    const name = data.fields?.displayName?.stringValue;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

/** Bildirim metnine girecek kullanıcı kaynaklı metni tek satıra indirir ve kısaltır. */
function cleanNotificationText(value, maxLength) {
  if (typeof value !== 'string') return '';
  const singleLine = value.replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength - 1)}…` : singleLine;
}

/**
 * FCM HTTP v1 REST API üzerinden tek bir cihaza bildirim gönderir.
 */
async function sendFcmMessage(projectId, token, payload, accessToken) {
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const messageBody = {
    message: {
      token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data || {},
      webpush: {
        headers: {
          Urgency: 'high',
        },
        notification: {
          title: payload.title,
          body: payload.body,
          icon: '/favicon.svg',
          badge: '/favicon.svg',
          tag: payload.tag || 'j-planning-notification',
        },
      },
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messageBody),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.warn(`[Push FCM] Mesaj gönderme uyarısı (${res.status}):`, errText);
    const isUnregistered =
      res.status === 404 ||
      errText.includes('UNREGISTERED') ||
      errText.includes('NOT_FOUND') ||
      errText.includes('registration-token-not-registered') ||
      errText.includes('invalid-registration-token');

    return { success: false, status: res.status, error: errText, isUnregistered };
  }

  return { success: true };
}

/**
 * Geçersiz / ölü FCM token'larını Firestore users/{uid} dokümanındaki fcmTokens dizisinden kaldırır.
 */
async function removeDeadFcmTokensFromFirestore(projectId, targetUid, deadTokens, accessToken) {
  if (!deadTokens || deadTokens.length === 0) return;
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`;
    const body = {
      writes: [
        {
          transform: {
            document: `projects/${projectId}/databases/(default)/documents/users/${targetUid}`,
            fieldTransforms: [
              {
                fieldPath: 'fcmTokens',
                removeAllFromArray: {
                  values: deadTokens.map((t) => ({ stringValue: t })),
                },
              },
            ],
          },
        },
      ],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      console.log(`[Push FCM] ${deadTokens.length} adet ölü/geçersiz token Firestore'dan başarıyla temizlendi (UID: ${targetUid}).`);
    } else {
      const errText = await res.text();
      console.warn(`[Push FCM] Ölü token'lar silinirken Firestore hatası (${res.status}):`, errText);
    }
  } catch (err) {
    console.warn('[Push FCM] Ölü token silme istisnası:', err.message);
  }
}

/**
 * Katı sunucu tarafı bildirim şablonları (İstemci serbest metin manipülasyonu yapamaz)
 */
const NOTIFICATION_TEMPLATES = {
  FRIEND_REQUEST: (senderName) => ({
    title: 'J-Planning 🔔',
    body: `${senderName || 'Bir kullanıcı'} sana arkadaşlık isteği gönderdi.`,
    tag: 'friend-request',
  }),
  TASK_ASSIGNED: (senderName, taskTitle) => ({
    title: 'J-Planning 🔔',
    body: `${senderName || 'Arkadaşın'} sana yeni bir görev atadı: "${taskTitle || 'Yeni Görev'}"`,
    tag: 'task-assigned',
  }),
  TASK_COMPLETED: (senderName, taskTitle) => ({
    title: 'J-Planning 🔔',
    body: `${senderName || 'Arkadaşın'}, attığın "${taskTitle || 'görev'}" görevini tamamladı! 🎉`,
    tag: 'task-completed',
  }),
  TASK_DELETED: (senderName, taskTitle) => ({
    title: 'J-Planning 🔔',
    body: `${senderName || 'Arkadaşın'}, attığın "${taskTitle || 'görev'}" görevini sildi.`,
    tag: 'task-deleted',
  }),
  TASK_REMINDER: (count) => ({
    title: 'J-Planning ⏰',
    body: `Bugün tamamlaman gereken ${count} görevin var!`,
    tag: 'task-reminder',
    data: { url: '/' },
  }),
};

/**
 * ============================================================================
 * Zamanlanmış işler: günlük hatırlatıcı + kullanıcı bildirim zamanlamaları
 * ============================================================================
 * Cron 5 dakikada bir çalışır. Her kayıt "bir sonraki gönderim anını" (UTC ms) saklar;
 * cron yalnızca zamanı gelmiş kayıtları çeker. Ücretsiz planda çağrı başına ~50 alt istek
 * sınırı olduğu için iş bir bütçeyle planlanır; bütçeye sığmayanlar sonraki çalışmaya kalır.
 * Aynı kaydın iki kez gönderilmemesi için kayıtlar göndermeden ÖNCE sahiplenilir
 * (next_* alanı koşullu UPDATE ile ileri alınır).
 */
const CRON_SUBREQUEST_BUDGET = 44;
const MAX_PUSH_TOKENS_PER_USER = 5;
const STALE_SCHEDULE_MS = 30 * 60 * 1000; // 30 dk'dan fazla geciken zamanlama gönderilmez, ileri alınır
const STALE_REMINDER_MS = 60 * 60 * 1000; // 1 saatten fazla geciken hatırlatıcı gönderilmez
const MAX_SCHEDULES_PER_USER = 20;

function parseWeekdaysJson(value) {
  try {
    const arr = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(arr) ? arr.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7) : [];
  } catch {
    return [];
  }
}

function computeScheduleNextFireAt(row, afterMs) {
  return computeNextWeeklyFireAt(
    parseWeekdaysJson(row.weekdays),
    Number(row.hour),
    Number(row.minute),
    normalizeTimeZone(row.timezone),
    afterMs
  );
}

/** Kullanıcının cihaz anahtarları (en yeni MAX_PUSH_TOKENS_PER_USER tanesi). */
async function getRecentFcmTokens(projectId, uid, accessToken) {
  const tokens = await getTargetUserFcmTokens(projectId, uid, accessToken);
  return tokens.slice(-MAX_PUSH_TOKENS_PER_USER);
}

/** Bir bildirimi tüm cihazlara gönderir; ölü anahtarları temizler. */
async function sendPushToTokens(projectId, uid, tokens, payload, accessToken) {
  const deadTokens = [];
  const errors = [];
  let delivered = 0;
  const results = await Promise.all(tokens.map((token) => sendFcmMessage(projectId, token, payload, accessToken)));
  results.forEach((res, i) => {
    if (res.success) delivered++;
    else {
      if (res.isUnregistered) deadTokens.push(tokens[i]);
      if (res.error) errors.push(res.error);
    }
  });
  if (deadTokens.length > 0) {
    await removeDeadFcmTokensFromFirestore(projectId, uid, deadTokens, accessToken);
  }
  return { delivered, cleaned: deadTokens.length, errors };
}

/**
 * Tek kullanıcı için "bugün bitmesi gereken tamamlanmamış görevin var" hatırlatıcısı.
 * user: { uid, db_name, timezone }
 */
async function processReminderForUser(env, { projectId, accessToken, nowMs }, user) {
  const uid = user.uid;
  const dbName = user.db_name || getDbNameForUser(uid);
  const timeZone = normalizeTimeZone(user.timezone);
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  try {
    const tokens = await getRecentFcmTokens(projectId, uid, accessToken);
    if (!tokens || tokens.length === 0) {
      return {
        uid,
        status: 'NO_TOKENS',
        message: 'Kullanıcının kayıtlı FCM bildirim anahtarı (cihaz tokenı) bulunamadı. Lütfen tarayıcı bildirim iznini verin.',
        diagnostics: { fcmTokenCount: 0 },
      };
    }

    const sessionInfo = await ensureUserDatabase(dbName, env);
    const userDbClient = createClient({ url: sessionInfo.dbUrl, authToken: sessionInfo.token });

    const tasksRes = await userDbClient.execute(
      "SELECT id, title, period, intervalValue, subtaskCount, createdAt FROM tasks WHERE isArchived = 0 AND assignmentStatus != 'PENDING_ACCEPT' AND (assignmentDirection IS NULL OR assignmentDirection != 'SENT');"
    );
    const tasks = tasksRes?.rows || [];
    if (tasks.length === 0) {
      return {
        uid,
        status: 'NO_TASKS',
        message: 'Kullanıcının hiç aktif görevi bulunmuyor.',
        diagnostics: { fcmTokenCount: tokens.length, activeTasksCount: 0 },
      };
    }

    // Periyot hesapları "yerel tarih" metodlarını kullanır; Worker UTC'de çalıştığı için
    // zaman kullanıcının saat dilimi farkı kadar kaydırılarak verilir.
    const offsetMs = getTimeZoneOffsetMs(nowMs, timeZone);
    const shiftedNowMs = nowMs + offsetMs;
    const shiftedNow = new Date(shiftedNowMs);

    const dueTasks = [];
    for (const task of tasks) {
      const createdAtNum = Number(task.createdAt);
      const shiftedTask = {
        period: task.period,
        intervalValue: task.intervalValue,
        createdAt: Number.isFinite(createdAtNum) && createdAtNum > 0 ? createdAtNum + offsetMs : null,
      };
      const periodKey = getPeriodKey(shiftedTask, shiftedNow);
      const periodEnd = getPeriodEndTimestamp(shiftedTask, periodKey);
      // DAILY her gün; diğerleri periyodun son 24 saatinde; ONCE tamamlanana kadar
      const isExpiringToday = task.period === 'ONCE' || (periodEnd - shiftedNowMs) <= ONE_DAY_MS;
      if (isExpiringToday) dueTasks.push({ task, periodKey });
    }

    // Kayıtlar görev başına ayrı sorgu yerine TEK sorguda çekilir (alt istek sınırı).
    const recordByTaskAndPeriod = new Map();
    if (dueTasks.length > 0) {
      const periodKeys = [...new Set(dueTasks.map((d) => d.periodKey))];
      const placeholders = periodKeys.map(() => '?').join(', ');
      const recordsRes = await userDbClient.execute({
        sql: `SELECT taskId, periodKey, status, completedSubtasks FROM task_records WHERE periodKey IN (${placeholders});`,
        args: periodKeys,
      });
      for (const row of recordsRes?.rows || []) {
        recordByTaskAndPeriod.set(`${row.taskId}|${row.periodKey}`, row);
      }
    }

    let uncompleted = 0;
    for (const { task, periodKey } of dueTasks) {
      const record = recordByTaskAndPeriod.get(`${task.id}|${periodKey}`);
      const isCompleted =
        record && (record.status === 'SUCCESSFUL' || Number(record.completedSubtasks) >= (Number(task.subtaskCount) || 1));
      if (!isCompleted) uncompleted++;
    }

    const diagnostics = {
      fcmTokenCount: tokens.length,
      activeTasksCount: tasks.length,
      dueTasksCount: dueTasks.length,
      uncompletedTasksCount: uncompleted,
    };

    if (uncompleted === 0) {
      return {
        uid,
        status: 'ALL_COMPLETED',
        message: `Bugün tamamlanması gereken ${dueTasks.length} görevin tümü zaten tamamlanmış.`,
        diagnostics,
      };
    }

    const template = NOTIFICATION_TEMPLATES.TASK_REMINDER(uncompleted);
    const { delivered, cleaned, errors } = await sendPushToTokens(projectId, uid, tokens, template, accessToken);
    const cleanedNote = cleaned > 0 ? ` (${cleaned} ölü token temizlendi)` : '';

    if (delivered > 0) {
      return {
        uid,
        status: 'SENT',
        uncompletedTasks: uncompleted,
        deviceCount: delivered,
        message: `${uncompleted} tamamlanmamış görev için ${delivered} cihaza bildirim gönderildi.${cleanedNote}`,
        diagnostics: { ...diagnostics, deliveredDevices: delivered, cleanedDeadTokensCount: cleaned },
      };
    }
    return {
      uid,
      status: 'FCM_SEND_FAILED',
      message: `Bildirim cihazlara iletilemedi (FCM reddetti).${cleanedNote}`,
      diagnostics: { ...diagnostics, cleanedDeadTokensCount: cleaned, errors },
    };
  } catch (userErr) {
    console.warn(`[Reminders] Kullanıcı (${uid}) işleme hatası:`, userErr.message);
    return { uid, status: 'ERROR', message: 'Hatırlatıcı işlenirken bir hata oluştu.' };
  }
}

/**
 * "Hatırlatıcıyı Test Et": yalnızca giriş yapan kullanıcının kendi hatırlatıcısını hemen çalıştırır.
 * Zamanlamayı (reminder_next_at) değiştirmez.
 */
async function runReminderTestForUser(env, uid) {
  const controlClient = getControlPlaneClient(env);
  let user = { uid, db_name: getDbNameForUser(uid), timezone: DEFAULT_TIME_ZONE };
  if (controlClient) {
    await ensureControlPlaneUsersIndexSchema(controlClient);
    try {
      const res = await controlClient.execute({
        sql: 'SELECT uid, db_name, timezone FROM admin_users_index WHERE uid = ? LIMIT 1;',
        args: [uid],
      });
      const row = res?.rows?.[0];
      if (row) {
        user = { uid, db_name: row.db_name || user.db_name, timezone: row.timezone || user.timezone };
      }
    } catch (e) {
      console.warn('[Reminders Test] Kullanıcı kaydı okunamadı:', e.message);
    }
  }

  const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';
  let accessToken;
  try {
    accessToken = await getGoogleAccessToken(env.FIREBASE_SERVICE_ACCOUNT);
  } catch (authErr) {
    console.warn('[Reminders Test] FCM access token alınamadı:', authErr.message);
    return { success: false, message: 'Bildirim servisine bağlanılamadı.' };
  }

  const r = await processReminderForUser(env, { projectId, accessToken, nowMs: Date.now() }, user);
  return {
    success: true,
    isTest: true,
    processedUsers: 1,
    sentCount: r.status === 'SENT' ? 1 : 0,
    deviceCount: r.deviceCount || 0,
    status: r.status || 'OK',
    uncompletedTasks: r.uncompletedTasks || 0,
    message: r.message,
    diagnostics: r.diagnostics || {},
    details: [r],
  };
}

/**
 * 5 dakikalık cron işleyicisi.
 */
async function handleScheduledTick(env) {
  const nowMs = Date.now();
  const controlClient = getControlPlaneClient(env);
  if (!controlClient) {
    console.warn('[Cron] Control plane client bulunamadı.');
    return;
  }

  let budget = CRON_SUBREQUEST_BUDGET;
  if (!controlPlaneUsersIndexInitialized) budget -= 4; // soğuk başlangıçta şema kontrolü
  await ensureControlPlaneUsersIndexSchema(controlClient);

  let dueSchedules = [];
  let dueReminders = [];
  let missingReminderNext = [];
  try {
    const rs = await controlClient.batch(
      [
        {
          sql: `SELECT s.id, s.uid, s.weekdays, s.hour, s.minute, s.label, s.timezone, s.next_fire_at
                FROM notification_schedules s
                JOIN admin_users_index u ON u.uid = s.uid
                WHERE s.next_fire_at IS NOT NULL AND s.next_fire_at <= ? AND COALESCE(u.is_disabled, 0) = 0
                ORDER BY s.next_fire_at LIMIT 30;`,
          args: [nowMs],
        },
        {
          sql: `SELECT uid, db_name, reminder_hour, timezone, reminder_next_at
                FROM admin_users_index
                WHERE COALESCE(is_disabled, 0) = 0 AND reminder_enabled = 1
                  AND reminder_next_at IS NOT NULL AND reminder_next_at <= ?
                ORDER BY reminder_next_at LIMIT 15;`,
          args: [nowMs],
        },
        {
          // Bu sürümden önce açılmış hatırlatıcılar: bir sonraki gönderim anı burada hesaplanır.
          sql: 'SELECT uid, reminder_hour, timezone FROM admin_users_index WHERE reminder_enabled = 1 AND reminder_next_at IS NULL LIMIT 50;',
          args: [],
        },
      ],
      'read'
    );
    dueSchedules = rs[0]?.rows || [];
    dueReminders = rs[1]?.rows || [];
    missingReminderNext = rs[2]?.rows || [];
  } catch (err) {
    console.error('[Cron] Zamanı gelen işler okunamadı:', err.message);
    return;
  }
  budget -= 1;

  if (dueSchedules.length === 0 && dueReminders.length === 0 && missingReminderNext.length === 0) return;

  budget -= 2; // sahiplenme yazımı + olası OAuth token isteği

  // 1. Plan: hangi işler bu çalışmada gönderilecek, hangileri yalnızca ileri alınacak
  const claimStatements = [];
  const claimPlan = []; // claimStatements ile aynı sırada: { kind, send, row }

  const schedulesByUid = new Map();
  for (const row of dueSchedules) {
    if (!schedulesByUid.has(row.uid)) schedulesByUid.set(row.uid, []);
    schedulesByUid.get(row.uid).push(row);
  }
  for (const rows of schedulesByUid.values()) {
    const fresh = rows.filter((r) => nowMs - Number(r.next_fire_at) <= STALE_SCHEDULE_MS);
    // Kullanıcı başına tahmini maliyet: cihaz anahtarı okuma + zamanlama başına ~2 cihaz
    const cost = fresh.length > 0 ? 1 + fresh.length * 2 : 0;
    const canSend = fresh.length > 0 && budget >= cost;
    if (canSend) budget -= cost;
    for (const row of rows) {
      const isFresh = fresh.includes(row);
      if (isFresh && !canSend) continue; // bütçe yok: sonraki çalışmaya kalsın
      const next = computeScheduleNextFireAt(row, Math.max(nowMs, Number(row.next_fire_at)));
      claimStatements.push({
        sql: 'UPDATE notification_schedules SET next_fire_at = ?, updated_at = ? WHERE id = ? AND next_fire_at = ?;',
        args: [next, nowMs, row.id, row.next_fire_at],
      });
      claimPlan.push({ kind: 'schedule', send: isFresh, row });
    }
  }

  for (const user of dueReminders) {
    const isFresh = nowMs - Number(user.reminder_next_at) <= STALE_REMINDER_MS;
    const dbName = user.db_name || getDbNameForUser(user.uid);
    const cached = userDbSessionCache.get(dbName);
    const cost = 6 + (cached && nowMs < cached.expiresAt - 5 * 60 * 1000 ? 0 : 2);
    if (isFresh && budget < cost) continue;
    if (isFresh) budget -= cost;
    const next = computeNextDailyFireAt(
      Number(user.reminder_hour),
      normalizeTimeZone(user.timezone),
      Math.max(nowMs, Number(user.reminder_next_at))
    );
    claimStatements.push({
      sql: 'UPDATE admin_users_index SET reminder_next_at = ? WHERE uid = ? AND reminder_next_at = ?;',
      args: [next, user.uid, user.reminder_next_at],
    });
    claimPlan.push({ kind: 'reminder', send: isFresh, row: user });
  }

  for (const user of missingReminderNext) {
    const next = computeNextDailyFireAt(Number(user.reminder_hour), normalizeTimeZone(user.timezone), nowMs);
    claimStatements.push({
      sql: 'UPDATE admin_users_index SET reminder_next_at = ? WHERE uid = ? AND reminder_next_at IS NULL;',
      args: [next, user.uid],
    });
    claimPlan.push({ kind: 'fixup', send: false, row: user });
  }

  if (claimStatements.length === 0) return;

  // 2. Sahiplen (tek istek). Başka bir çalışma aynı kaydı önce aldıysa rowsAffected 0 döner.
  let claimResults;
  try {
    claimResults = await controlClient.batch(claimStatements, 'write');
  } catch (err) {
    console.error('[Cron] Kayıtlar sahiplenilemedi:', err.message);
    return;
  }

  const scheduleSends = new Map(); // uid -> rows
  const reminderSends = [];
  claimPlan.forEach((plan, i) => {
    if (!plan.send || !(claimResults[i]?.rowsAffected > 0)) return;
    if (plan.kind === 'schedule') {
      if (!scheduleSends.has(plan.row.uid)) scheduleSends.set(plan.row.uid, []);
      scheduleSends.get(plan.row.uid).push(plan.row);
    } else if (plan.kind === 'reminder') {
      reminderSends.push(plan.row);
    }
  });

  if (scheduleSends.size === 0 && reminderSends.length === 0) return;

  const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';
  let accessToken;
  try {
    accessToken = await getGoogleAccessToken(env.FIREBASE_SERVICE_ACCOUNT);
  } catch (authErr) {
    console.error('[Cron] FCM access token alınamadı:', authErr.message);
    return;
  }

  // 3. Kullanıcı zamanlamaları
  let scheduleCount = 0;
  for (const [uid, rows] of scheduleSends) {
    try {
      const tokens = await getRecentFcmTokens(projectId, uid, accessToken);
      if (tokens.length === 0) continue;
      for (const row of rows) {
        const body = cleanNotificationText(row.label || '', 160) || 'Görevlerine göz atmayı unutma!';
        await sendPushToTokens(
          projectId,
          uid,
          tokens,
          { title: 'J-Planning Hatırlatması 🔔', body, tag: `j-planning-schedule-${row.id}`, data: { url: '/' } },
          accessToken
        );
        scheduleCount++;
      }
    } catch (err) {
      console.warn(`[Cron] Zamanlama bildirimi gönderilemedi (${uid}):`, err.message);
    }
  }

  // 4. Günlük hatırlatıcılar
  let reminderCount = 0;
  for (const user of reminderSends) {
    const r = await processReminderForUser(env, { projectId, accessToken, nowMs }, user);
    if (r.status === 'SENT') reminderCount++;
  }

  console.log(`[Cron] ${scheduleCount} zamanlama, ${reminderCount} hatırlatıcı gönderildi (kalan bütçe tahmini: ${budget}).`);
}

// Bellek içi yedek rate limiter
const pushMemoryRateLimits = new Map();

/**
 * Kullanıcı başına dakikada en fazla maxPerMinute kadar bildirim izni verir.
 */
async function checkPushRateLimit(env, senderUid, maxPerMinute = 15) {
  const currentMinute = Math.floor(Date.now() / 60000);
  const key = `ratelimit:push:${senderUid}:${currentMinute}`;

  if (env.RATE_LIMIT_KV) {
    try {
      const current = await env.RATE_LIMIT_KV.get(key);
      const count = current ? parseInt(current, 10) : 0;
      if (count >= maxPerMinute) {
        return false;
      }
      await env.RATE_LIMIT_KV.put(key, String(count + 1), { expirationTtl: 120 });
      return true;
    } catch (e) {
      console.warn('[Push RateLimit KV Warning]:', e.message);
    }
  }

  const count = pushMemoryRateLimits.get(key) || 0;
  if (count >= maxPerMinute) {
    return false;
  }
  pushMemoryRateLimits.set(key, count + 1);
  if (pushMemoryRateLimits.size > 2000) {
    pushMemoryRateLimits.clear();
  }
  return true;
}

export default {
  async fetch(request, env, ctx) {
    let corsHeaders;
    try {
      corsHeaders = getCorsHeaders(request, env);
    } catch {
      corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      };
    }

    // CORS Preflight (OPTIONS) İsteği
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    try {
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
        return jsonResponse({ error: 'INTERNAL_ERROR', message: 'Görev güncellenemedi.' }, 500, corsHeaders);
      }
    }

    // DELETE /admin/users/:uid/tasks/:taskId (Aşama 28 — Görev Silme)
    const taskDeleteMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/tasks\/([^/]+)$/);
    if (request.method === 'DELETE' && taskDeleteMatch) {
      const targetUid = decodeURIComponent(taskDeleteMatch[1]);
      const taskId = decodeURIComponent(taskDeleteMatch[2]);
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

        const { uid: adminUid, payload } = await verifyAdminClaim(authHeader, projectId);

        // Kullanıcının gerçek db_name bilgisini Control Plane'den bul
        let targetDbName = getDbNameForUser(targetUid);
        const controlClient = getControlPlaneClient(env);
        if (controlClient) {
          const userMetaRes = await controlClient.execute({
            sql: 'SELECT db_name FROM admin_users_index WHERE uid = ? LIMIT 1;',
            args: [targetUid],
          });
          if (userMetaRes.rows.length > 0 && userMetaRes.rows[0].db_name) {
            targetDbName = userMetaRes.rows[0].db_name;
          }
        }

        // Kullanıcı DB'sine bağlan
        const sessionInfo = await ensureUserDatabase(targetDbName, env);
        const userDbClient = createClient({
          url: sessionInfo.dbUrl,
          authToken: sessionInfo.token,
        });

        // 1. Silinecek görevi oku (Audit log & kısıtlama kontrolü için)
        const checkRes = await userDbClient.execute({
          sql: 'SELECT * FROM tasks WHERE id = ? LIMIT 1;',
          args: [taskId],
        });

        if (checkRes.rows.length === 0) {
          return jsonResponse({ error: 'NOT_FOUND', message: 'Silinecek görev bulunamadı.' }, 404, corsHeaders);
        }

        const oldTask = checkRes.rows[0];

        // 2. Atanan görev kısıtlaması
        if (oldTask.assignmentDirection === 'RECEIVED') {
          return jsonResponse(
            {
              error: 'CANNOT_DELETE_ASSIGNED_TASK',
              message: 'Başka bir kullanıcı tarafından atanan görevler yönetici tarafından silinemez.',
            },
            400,
            corsHeaders
          );
        }

        // 3. Görevi ve ilişkili periyot kayıtlarını sil
        await userDbClient.execute({
          sql: 'DELETE FROM task_records WHERE taskId = ?;',
          args: [taskId],
        });
        await userDbClient.execute({
          sql: 'DELETE FROM tasks WHERE id = ?;',
          args: [taskId],
        });

        // 4. Control Plane task_count sayacını güncelle (AWAIT ile)
        const countsRes = await userDbClient
          .execute('SELECT COUNT(*) AS total_tasks FROM tasks WHERE isArchived = 0;')
          .catch(() => ({ rows: [{ total_tasks: 0 }] }));
        const realTaskCount = Number(countsRes.rows[0]?.total_tasks || 0);

        if (controlClient) {
          try {
            await controlClient.execute({
              sql: 'UPDATE admin_users_index SET task_count = ?, updated_at = ? WHERE uid = ?;',
              args: [realTaskCount, Date.now(), targetUid],
            });
          } catch (syncErr) {
            console.warn('[Worker Task Delete Sync Warning]:', syncErr.message);
          }
        }

        // 5. Audit Log Kaydı (oldValue tam görev kaydı, newValue: null)
        await logAdminAudit(env, {
          adminUid,
          adminEmail: payload.email,
          targetUid,
          action: 'DELETE_TASK',
          oldValue: oldTask,
          newValue: null,
          status: 'SUCCESS',
        });

        return jsonResponse(
          {
            success: true,
            taskId,
            remainingTaskCount: realTaskCount,
            message: 'Görev başarıyla silindi.',
          },
          200,
          corsHeaders
        );
      } catch (err) {
        console.error('[Worker DELETE /admin/users/:uid/tasks/:taskId Error]:', err);
        if (err.isForbidden) {
          return jsonResponse({ error: 'FORBIDDEN', message: 'Yetkisiz erişim.' }, 403, corsHeaders);
        }
        return jsonResponse({ error: 'INTERNAL_ERROR', message: 'Görev silinemedi.' }, 500, corsHeaders);
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
        return jsonResponse({ error: 'INTERNAL_ERROR', message: 'Cüzdan bakiyesi güncellenemedi.' }, 500, corsHeaders);
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
        return jsonResponse({ error: 'INTERNAL_ERROR', message: 'Ödül güncellenemedi.' }, 500, corsHeaders);
      }
    }

    // PATCH /admin/users/:uid/code (Aşama 29 — Kullanıcı Kodu Düzenleme)
    const codeEditMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/code$/);
    if (request.method === 'PATCH' && codeEditMatch) {
      const targetUid = decodeURIComponent(codeEditMatch[1]);
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

        const { uid: adminUid, payload } = await verifyAdminClaim(authHeader, projectId);

        const body = await request.json();
        const rawNewCode = (body.newCode || '').trim().toUpperCase();
        const oldCode = (body.oldCode || '').trim().toUpperCase();
        const reason = (body.reason || '').trim();

        if (!rawNewCode || rawNewCode.length < 3 || rawNewCode.length > 25) {
          return jsonResponse({ error: 'INVALID_INPUT', message: 'Kullanıcı kodu 3 ile 25 karakter arasında olmalıdır.' }, 400, corsHeaders);
        }

        if (!/^[A-Z0-9_-]+$/.test(rawNewCode)) {
          return jsonResponse({ error: 'INVALID_INPUT', message: 'Kullanıcı kodu sadece harf, rakam, tire ve alt çizgi içerebilir.' }, 400, corsHeaders);
        }

        // Audit Log Kaydı
        await logAdminAudit(env, {
          adminUid,
          adminEmail: payload.email,
          targetUid,
          action: 'UPDATE_USER_CODE',
          oldValue: { userCode: oldCode || null },
          newValue: { userCode: rawNewCode, reason: reason || 'Yönetici kod güncellemesi' },
          status: 'SUCCESS',
        });

        return jsonResponse(
          {
            success: true,
            uid: targetUid,
            newCode: rawNewCode,
            message: 'Kullanıcı kodu başarıyla güncellendi ve denetim kaydı oluşturuldu.',
          },
          200,
          corsHeaders
        );
      } catch (err) {
        console.error('[Worker /admin/users/:uid/code Error]:', err);
        if (err.isForbidden) {
          return jsonResponse({ error: 'FORBIDDEN', message: 'Yetkisiz erişim.' }, 403, corsHeaders);
        }
        return jsonResponse({ error: 'INTERNAL_ERROR', message: 'Kullanıcı kodu kaydedilemedi.' }, 500, corsHeaders);
      }
    }

    // DELETE /admin/users/:uid (Yönetici Tarafından Kullanıcı Hesabı ve Verilerini Silme)
    const userDeleteMatch = url.pathname.match(/^\/admin\/users\/([^/]+)$/);
    if (request.method === 'DELETE' && userDeleteMatch) {
      const targetUid = decodeURIComponent(userDeleteMatch[1]);
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

        const { uid: adminUid, payload } = await verifyAdminClaim(authHeader, projectId);

        if (adminUid === targetUid) {
          return jsonResponse(
            { error: 'CANNOT_DELETE_SELF', message: 'Yönetici kendi hesabını bu panelden silemez.' },
            400,
            corsHeaders
          );
        }

        // Hedef kullanıcının e-postasını ve veritabanı adını silme işlemine başlamadan ÖNCE oku (silindikten sonra kaybolmasın)
        let targetDbName = getDbNameForUser(targetUid);
        let targetEmail = null;
        const controlClient = getControlPlaneClient(env);
        if (controlClient) {
          try {
            const userMetaRes = await controlClient.execute({
              sql: 'SELECT db_name, email FROM admin_users_index WHERE uid = ? LIMIT 1;',
              args: [targetUid],
            });
            if (userMetaRes.rows.length > 0) {
              if (userMetaRes.rows[0].db_name) targetDbName = String(userMetaRes.rows[0].db_name);
              if (userMetaRes.rows[0].email) targetEmail = String(userMetaRes.rows[0].email);
            }
          } catch (cpErr) {
            console.warn(`[Worker DELETE /admin/users/:uid] Control Plane sorgulama uyarısı:`, cpErr.message);
          }
        }

        if (!targetEmail) {
          targetEmail = await resolveTargetUserEmail(env, targetUid, controlClient);
        }

        const steps = {
          firebaseAuth: { status: 'PENDING' },
          tursoDb: { status: 'PENDING' },
          controlPlane: { status: 'PENDING' },
          firestore: { status: 'PENDING' },
        };

        // (a) Firebase Auth üzerinden hesabı sil
        try {
          const authRes = await callFirebaseAuthAdminApi(env, 'accounts:delete', { localId: targetUid });
          if (authRes.ok) {
            steps.firebaseAuth = { status: 'SUCCESS' };
          } else if (authRes.status === 400 && authRes.data?.error?.message?.includes('USER_NOT_FOUND')) {
            steps.firebaseAuth = { status: 'ALREADY_DELETED', message: 'Kullanıcı Firebase Auth üzerinde zaten bulunamadı.' };
          } else {
            const errMsg = authRes.data?.error?.message || `HTTP_${authRes.status}`;
            steps.firebaseAuth = { status: 'FAILED', error: errMsg };
          }
        } catch (authErr) {
          steps.firebaseAuth = { status: 'FAILED', error: authErr.message };
        }

        // (b) Turso DB'sini sil
        try {
          const deleteDbRes = await callTursoPlatformApi(`/databases/${targetDbName}`, env, {
            method: 'DELETE',
          });
          if (deleteDbRes.ok) {
            steps.tursoDb = { status: 'SUCCESS', dbName: targetDbName };
          } else if (deleteDbRes.status === 404) {
            steps.tursoDb = { status: 'ALREADY_DELETED', dbName: targetDbName, message: 'Turso veritabanı zaten mevcut değil.' };
          } else {
            const errText = await deleteDbRes.text().catch(() => '');
            steps.tursoDb = { status: 'FAILED', dbName: targetDbName, error: `HTTP ${deleteDbRes.status}: ${errText}` };
          }
        } catch (tursoErr) {
          steps.tursoDb = { status: 'FAILED', dbName: targetDbName, error: tursoErr.message };
        }

        // (c) Control Plane admin_users_index kaydını sil
        if (controlClient) {
          try {
            const delRes = await controlClient.execute({
              sql: 'DELETE FROM admin_users_index WHERE uid = ?;',
              args: [targetUid],
            });
            await controlClient
              .execute({ sql: 'DELETE FROM notification_schedules WHERE uid = ?;', args: [targetUid] })
              .catch((e) => console.warn('[Admin delete] Bildirim zamanlamaları silinemedi:', e.message));
            steps.controlPlane = { status: 'SUCCESS', rowsAffected: delRes.rowsAffected ?? 1 };
          } catch (cpDelErr) {
            steps.controlPlane = { status: 'FAILED', error: cpDelErr.message };
          }
        } else {
          steps.controlPlane = { status: 'FAILED', error: 'Control Plane DB client mevcut değil.' };
        }

        // (d) Firestore temizliği: users/{uid} ve userCodes/{userCode}
        try {
          const googleToken = await getGoogleAccessToken(env.FIREBASE_SERVICE_ACCOUNT);
          const fsBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

          // 1. users/{uid} dokümanından userCode'u öğren
          let userCode = null;
          try {
            const userDocRes = await fetch(`${fsBase}/users/${encodeURIComponent(targetUid)}`, {
              headers: { Authorization: `Bearer ${googleToken}` },
            });
            if (userDocRes.ok) {
              const userDocData = await userDocRes.json();
              userCode = userDocData.fields?.userCode?.stringValue || null;
            }
          } catch (e) {
            console.warn(`[Worker DELETE /admin/users/:uid] userCode sorgu hatası:`, e.message);
          }

          // 2. users/{uid} sil
          const delUserRes = await fetch(`${fsBase}/users/${encodeURIComponent(targetUid)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${googleToken}` },
          });

          // 3. userCodes/{userCode} varsa sil
          if (userCode) {
            await fetch(`${fsBase}/userCodes/${encodeURIComponent(userCode)}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${googleToken}` },
            });
          }

          // 4. users/{uid}/user_backup/latest varsa sil
          await fetch(`${fsBase}/users/${encodeURIComponent(targetUid)}/user_backup/latest`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${googleToken}` },
          }).catch(() => {});

          if (delUserRes.ok || delUserRes.status === 404) {
            steps.firestore = {
              status: delUserRes.status === 404 && !userCode ? 'ALREADY_DELETED' : 'SUCCESS',
              cleanedUserCode: userCode,
              note: 'Bilinen sınırlama: Arkadaşlık referansları (friendships/assignedTasks) temizlenmemiştir.',
            };
          } else {
            steps.firestore = { status: 'FAILED', error: `HTTP_${delUserRes.status}` };
          }
        } catch (fsErr) {
          steps.firestore = { status: 'FAILED', error: fsErr.message };
        }

        // Audit Log kaydı
        const hasFailed = Object.values(steps).some((s) => s.status === 'FAILED');
        await logAdminAudit(env, {
          adminUid,
          adminEmail: payload.email || null,
          targetUid,
          targetEmail,
          action: 'ADMIN_DELETED_USER',
          oldValue: { dbName: targetDbName, email: targetEmail },
          newValue: { steps },
          status: hasFailed ? 'PARTIAL_SUCCESS' : 'SUCCESS',
          errorMessage: hasFailed ? 'Bazı adımlar başarısız oldu' : null,
        });

        return jsonResponse(
          {
            success: true,
            message: hasFailed
              ? 'Kullanıcı silme işlemi kısmi başarıyla tamamlandı (bazı adımlarda hata oluştu).'
              : 'Kullanıcı hesabı ve tüm ilişkili veriler başarıyla silindi.',
            steps,
            limitationNote: 'Bilinen sınırlama: Arkadaşlık referansları temizlenmemiştir.',
          },
          200,
          corsHeaders
        );
      } catch (err) {
        console.error('[Worker DELETE /admin/users/:uid Error]:', err);
        if (err.isForbidden) {
          return jsonResponse({ error: 'FORBIDDEN', message: 'Yetkisiz erişim.' }, 403, corsHeaders);
        }
        return jsonResponse({ error: 'INTERNAL_ERROR', message: 'Kullanıcı silinemedi.' }, 500, corsHeaders);
      }
    }

    // PATCH /admin/users/:uid/reset-password (Yönetici Tarafından Kullanıcı Şifresi Sıfırlama)
    const resetPwdMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/reset-password$/);
    if (request.method === 'PATCH' && resetPwdMatch) {
      const targetUid = decodeURIComponent(resetPwdMatch[1]);
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

        const { uid: adminUid, payload } = await verifyAdminClaim(authHeader, projectId);

        const body = await request.json().catch(() => ({}));
        const newPassword = body?.newPassword;

        if (typeof newPassword !== 'string' || newPassword.length < 6) {
          return jsonResponse(
            { error: 'INVALID_PASSWORD', message: 'Yeni şifre en az 6 karakter uzunluğunda olmalıdır.' },
            400,
            corsHeaders
          );
        }

        // Hedef kullanıcının e-postasını işlem öncesinde oku (audit log için)
        const targetEmail = await resolveTargetUserEmail(env, targetUid);

        const authRes = await callFirebaseAuthAdminApi(env, 'accounts:update', {
          localId: targetUid,
          password: newPassword,
        });

        if (!authRes.ok) {
          const errMsg = authRes.data?.error?.message || `HTTP_${authRes.status}`;
          if (authRes.status === 403 && errMsg.includes('Identity Toolkit API')) {
            return jsonResponse(
              {
                error: 'API_DISABLED',
                message: 'Google Cloud projenizde Identity Toolkit API etkinleştirilmemiş. Lütfen GCP Konsolu üzerinden Identity Toolkit API’yi etkinleştirin.',
              },
              403,
              corsHeaders
            );
          }
          return jsonResponse(
            {
              error: 'AUTH_API_ERROR',
              message: `Firebase Auth şifre güncelleme hatası: ${errMsg}`,
            },
            authRes.status >= 400 && authRes.status < 500 ? authRes.status : 500,
            corsHeaders
          );
        }

        // Audit Log kaydı — Şifre ASLA loglanmaz veya saklanmaz!
        await logAdminAudit(env, {
          adminUid,
          adminEmail: payload.email || null,
          targetUid,
          targetEmail,
          action: 'ADMIN_RESET_PASSWORD',
          oldValue: null,
          newValue: { note: 'Kullanıcı şifresi yönetici tarafından doğrudan sıfırlandı' },
          status: 'SUCCESS',
        });

        return jsonResponse(
          {
            success: true,
            message: 'Kullanıcının şifresi başarıyla güncellendi.',
          },
          200,
          corsHeaders
        );
      } catch (err) {
        console.error('[Worker PATCH /admin/users/:uid/reset-password Error]:', err.message);
        if (err.isForbidden) {
          return jsonResponse({ error: 'FORBIDDEN', message: 'Yetkisiz erişim.' }, 403, corsHeaders);
        }
        return jsonResponse({ error: 'INTERNAL_ERROR', message: 'Şifre sıfırlanamadı.' }, 500, corsHeaders);
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
            COALESCE(l.target_user_email, u.email) AS target_user_email,
            l.action, 
            l.old_value, 
            l.new_value, 
            l.status, 
            l.error_message, 
            l.created_at,
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
        return jsonResponse({ error: 'INTERNAL_ERROR', message: 'Audit loglar alınamadı.' }, 500, corsHeaders);
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
            await controlClient
              .execute({ sql: 'DELETE FROM notification_schedules WHERE uid = ?;', args: [uid] })
              .catch((e) => console.warn('[Worker /account] Bildirim zamanlamaları silinemedi:', e.message));
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
          targetEmail: payload.email || null,
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
            retryable: true,
          },
          503,
          corsHeaders
        );
      }
    }

    // POST /push/notify (Anlık Olay Push Bildirimi Gönderme)
    if (request.method === 'POST' && url.pathname === '/push/notify') {
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

        // 1. Firebase Token Doğrulama (Sender Uid garanti edilir)
        const { uid: senderUid, payload: jwtPayload } = await verifyFirebaseToken(authHeader, projectId);

        const body = await request.json().catch(() => ({}));
        const { type, targetUid, params = {} } = body;

        // 2. Doğrulama: Tip ve Hedef Kontrolü
        if (!type || !NOTIFICATION_TEMPLATES[type]) {
          return jsonResponse(
            {
              error: 'INVALID_TYPE',
              message: `Geçersiz bildirim tipi. İzin verilenler: ${Object.keys(NOTIFICATION_TEMPLATES).join(', ')}`,
            },
            400,
            corsHeaders
          );
        }

        if (!targetUid || typeof targetUid !== 'string') {
          return jsonResponse(
            { error: 'INVALID_TARGET', message: 'Geçerli bir targetUid gereklidir.' },
            400,
            corsHeaders
          );
        }

        // 3. Kendine Bildirim Gönderme Engeli
        if (senderUid === targetUid) {
          return jsonResponse(
            { error: 'SELF_NOTIFICATION', message: 'Kendine bildirim gönderemezsin.' },
            400,
            corsHeaders
          );
        }

        // 4. Rate Limiting (Dakikada en fazla 15 push)
        const isAllowed = await checkPushRateLimit(env, senderUid, 15);
        if (!isAllowed) {
          return jsonResponse(
            { error: 'RATE_LIMIT_EXCEEDED', message: 'Çok sık bildirim isteği gönderildi. Lütfen biraz bekle.' },
            429,
            corsHeaders
          );
        }

        // 5. Firebase Service Account Kontrolü
        if (!env.FIREBASE_SERVICE_ACCOUNT) {
          console.error('[Push Notification] FIREBASE_SERVICE_ACCOUNT secret tanımlanmamış');
          return jsonResponse(
            {
              error: 'SERVICE_UNAVAILABLE',
              message: 'Push bildirim servisi yapılandırılmamış (FIREBASE_SERVICE_ACCOUNT eksik).',
            },
            503,
            corsHeaders
          );
        }

        // 6. Google OAuth2 Access Token Al (Önbellekten veya OAuth üzerinden)
        const googleAccessToken = await getGoogleAccessToken(env.FIREBASE_SERVICE_ACCOUNT);

        // 6.5 YETKİ: Gönderen ile hedef arasında gerçek bir ilişki var mı?
        // (Bu kontrol olmadan giriş yapmış herhangi biri, UID'sini bildiği herkese bildirim atabilirdi.)
        if (type === 'TASK_REMINDER') {
          return jsonResponse(
            { error: 'INVALID_TYPE', message: 'Bu bildirim tipi istemciden gönderilemez.' },
            400,
            corsHeaders
          );
        }
        let isRelated = false;
        try {
          isRelated = await hasFriendshipRelation(
            projectId,
            googleAccessToken,
            senderUid,
            targetUid,
            type !== 'FRIEND_REQUEST'
          );
        } catch (relErr) {
          console.warn('[Push Notification] Arkadaşlık doğrulanamadı:', relErr.message);
          return jsonResponse(
            { error: 'RELATION_CHECK_FAILED', message: 'Bildirim yetkisi şu anda doğrulanamadı.' },
            503,
            corsHeaders
          );
        }
        if (!isRelated) {
          return jsonResponse(
            { error: 'NOT_FRIENDS', message: 'Yalnızca arkadaşlarına bildirim gönderebilirsin.' },
            403,
            corsHeaders
          );
        }

        // 7. Hedef Kullanıcının FCM Token'larını Firestore'dan Çek
        const fcmTokens = await getTargetUserFcmTokens(projectId, targetUid, googleAccessToken);
        if (!fcmTokens || fcmTokens.length === 0) {
          return jsonResponse(
            {
              success: true,
              sentCount: 0,
              message: 'Hedef kullanıcının kayıtlı bildirim cihazı bulunamadı.',
            },
            200,
            corsHeaders
          );
        }

        // 8. Sabit Şablondan Mesajı Oluştur
        // Gönderen adı İSTEMCİDEN ALINMAZ; Firestore profilinden okunur (serbest metin enjeksiyonu engeli).
        const profileName = await getUserDisplayName(projectId, googleAccessToken, senderUid);
        const senderName = cleanNotificationText(profileName || jwtPayload.name || 'Arkadaşın', 40) || 'Arkadaşın';
        const taskTitle = cleanNotificationText(params?.taskTitle, 80);

        const template = NOTIFICATION_TEMPLATES[type](senderName, taskTitle);
        const notificationPayload = {
          title: template.title,
          body: template.body,
          tag: template.tag,
          data: {
            type,
            senderUid,
            targetUid,
            click_action: '/',
          },
        };

        // 9. Tüm Kayıtlı Cihazlara Push Gönder
        let successCount = 0;
        const deadTokens = [];
        await Promise.all(
          fcmTokens.map(async (token) => {
            const sendRes = await sendFcmMessage(projectId, token, notificationPayload, googleAccessToken);
            if (sendRes.success) successCount++;
            else if (sendRes.isUnregistered) deadTokens.push(token);
          })
        );

        // Artık geçersiz olan cihaz token'larını temizle (yanıtı bekletmeden)
        if (deadTokens.length > 0) {
          const cleanup = removeDeadFcmTokensFromFirestore(projectId, targetUid, deadTokens, googleAccessToken);
          if (ctx?.waitUntil) ctx.waitUntil(cleanup);
          else await cleanup;
        }

        return jsonResponse(
          {
            success: true,
            sentCount: successCount,
            totalDevices: fcmTokens.length,
          },
          200,
          corsHeaders
        );
      } catch (err) {
        console.error('[Worker /push/notify Error]:', err);
        const isAuth =
          err.name?.startsWith('JWT') ||
          err.name?.startsWith('JWS') ||
          err.message?.includes('Authorization') ||
          err.message?.includes('Token');

        if (isAuth) {
          return jsonResponse({ error: 'UNAUTHORIZED', message: 'Oturum doğrulanamadı.' }, 401, corsHeaders);
        }

        return jsonResponse(
          { error: 'INTERNAL_ERROR', message: 'Bildirim gönderilemedi.' },
          500,
          corsHeaders
        );
      }
    }

    // GET /user/reminder-settings (Kullanıcının hatırlatıcı ayarlarını oku)
    if (request.method === 'GET' && url.pathname === '/user/reminder-settings') {
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';
        const { uid } = await verifyFirebaseToken(authHeader, projectId);

        const controlClient = getControlPlaneClient(env);
        if (!controlClient) {
          return jsonResponse({ error: 'CONFIG_ERROR', message: 'Control plane veritabanına erişilemiyor.' }, 500, corsHeaders);
        }

        await ensureControlPlaneUsersIndexSchema(controlClient);

        const rowRes = await controlClient.execute({
          sql: 'SELECT reminder_enabled, reminder_hour, timezone FROM admin_users_index WHERE uid = ? LIMIT 1;',
          args: [uid],
        });

        const row = rowRes?.rows?.[0];
        const reminderEnabled = row ? Boolean(row.reminder_enabled ?? 0) : false;
        const reminderHour = row && typeof row.reminder_hour === 'number' ? row.reminder_hour : 20;

        return jsonResponse({
          success: true,
          reminderEnabled,
          reminderHour,
          timeZone: normalizeTimeZone(row?.timezone),
        }, 200, corsHeaders);
      } catch (err) {
        const isAuth = err.message?.includes('Token') || err.message?.includes('Authorization');
        if (isAuth) {
          return jsonResponse({ error: 'UNAUTHORIZED', message: 'Oturum doğrulanamadı.' }, 401, corsHeaders);
        }
        console.error('[Worker GET /user/reminder-settings Error]:', err.message);
        return jsonResponse({ error: 'INTERNAL_ERROR', message: 'Hatırlatıcı ayarları alınamadı.' }, 500, corsHeaders);
      }
    }

    // PATCH /user/reminder-settings (Kullanıcının hatırlatıcı ayarlarını güncelle)
    if (request.method === 'PATCH' && url.pathname === '/user/reminder-settings') {
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';
        const { uid } = await verifyFirebaseToken(authHeader, projectId);

        const body = await request.json().catch(() => ({}));
        const { reminderEnabled, reminderHour } = body;
        const timeZone = normalizeTimeZone(body.timeZone);

        if (typeof reminderEnabled !== 'boolean') {
          return jsonResponse({ error: 'VALIDATION_ERROR', message: 'reminderEnabled (boolean) alanı zorunludur.' }, 400, corsHeaders);
        }

        if (typeof reminderHour !== 'number' || reminderHour < 0 || reminderHour > 23 || !Number.isInteger(reminderHour)) {
          return jsonResponse({ error: 'VALIDATION_ERROR', message: 'reminderHour (0-23 arası tam sayı) zorunludur.' }, 400, corsHeaders);
        }

        const controlClient = getControlPlaneClient(env);
        if (!controlClient) {
          return jsonResponse({ error: 'CONFIG_ERROR', message: 'Control plane veritabanına erişilemiyor.' }, 500, corsHeaders);
        }

        await ensureControlPlaneUsersIndexSchema(controlClient);

        const now = Date.now();
        const enabledInt = reminderEnabled ? 1 : 0;
        // Bir sonraki gönderim anı kullanıcının saat dilimine göre (cron 5 dakikada bir bakar)
        const reminderNextAt = reminderEnabled ? computeNextDailyFireAt(reminderHour, timeZone, now) : null;

        // 1. Önce Control Plane DB (admin_users_index) güncelle - Başarısız olursa hata fırlat
        const updateRes = await controlClient.execute({
          sql: 'UPDATE admin_users_index SET reminder_enabled = ?, reminder_hour = ?, timezone = ?, reminder_next_at = ?, updated_at = ? WHERE uid = ?;',
          args: [enabledInt, reminderHour, timeZone, reminderNextAt, now, uid],
        });

        // Eğer admin_users_index'te henüz bu kullanıcı yoksa oluştur
        if (updateRes.rowsAffected === 0) {
          await controlClient.execute({
            sql: `INSERT INTO admin_users_index (uid, reminder_enabled, reminder_hour, timezone, reminder_next_at, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(uid) DO UPDATE SET reminder_enabled = excluded.reminder_enabled, reminder_hour = excluded.reminder_hour,
                    timezone = excluded.timezone, reminder_next_at = excluded.reminder_next_at, updated_at = excluded.updated_at;`,
            args: [uid, enabledInt, reminderHour, timeZone, reminderNextAt, now, now],
          });
        }

        // 2. Control plane başarılı oldu, kullanıcının Turso DB'sindeki app_meta'yı güncelle (sync)
        try {
          const userMetaRes = await controlClient.execute({
            sql: 'SELECT db_name FROM admin_users_index WHERE uid = ? LIMIT 1;',
            args: [uid],
          });
          const dbName = userMetaRes?.rows?.[0]?.db_name || getDbNameForUser(uid);
          const sessionInfo = await ensureUserDatabase(dbName, env);
          const userDbClient = createClient({
            url: sessionInfo.dbUrl,
            authToken: sessionInfo.token,
          });

          await userDbClient.execute({
            sql: "INSERT INTO app_meta (key, value) VALUES ('reminder_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
            args: [String(enabledInt)],
          }).catch(() => {});

          await userDbClient.execute({
            sql: "INSERT INTO app_meta (key, value) VALUES ('reminder_hour', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
            args: [String(reminderHour)],
          }).catch(() => {});
        } catch (syncDbErr) {
          console.warn('[Reminder Settings Sync DB Warning]:', syncDbErr.message);
        }

        return jsonResponse({
          success: true,
          reminderEnabled,
          reminderHour,
        }, 200, corsHeaders);
      } catch (err) {
        const isAuth = err.message?.includes('Token') || err.message?.includes('Authorization');
        if (isAuth) {
          return jsonResponse({ error: 'UNAUTHORIZED', message: 'Oturum doğrulanamadı.' }, 401, corsHeaders);
        }
        console.error('[Worker PATCH /user/reminder-settings Error]:', err.message);
        return jsonResponse({ error: 'INTERNAL_ERROR', message: 'Hatırlatıcı ayarları kaydedilemedi.' }, 500, corsHeaders);
      }
    }

    // GET /assigned-tasks/:id/stats
    // Görevi ATAYAN kişi, arkadaşının bu görevdeki ilerlemesini görür: periyot ayarı ve dönem
    // kayıtları (durum + yapılan adım sayısı). Not, JP ve diğer görevler gönderilmez.
    const assignedStatsMatch = url.pathname.match(/^\/assigned-tasks\/([A-Za-z0-9_-]{1,128})\/stats$/);
    if (request.method === 'GET' && assignedStatsMatch) {
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';
        const { uid } = await verifyFirebaseToken(authHeader, projectId);
        const assignmentId = assignedStatsMatch[1];

        const accessToken = await getGoogleAccessToken(env.FIREBASE_SERVICE_ACCOUNT);
        const docRes = await fetch(
          `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/assignedTasks/${encodeURIComponent(assignmentId)}?mask.fieldPaths=assignedByUid&mask.fieldPaths=assignedToUid&mask.fieldPaths=status`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (docRes.status === 404) {
          return jsonResponse({ error: 'NOT_FOUND', message: 'Görev bulunamadı.' }, 404, corsHeaders);
        }
        if (!docRes.ok) {
          throw new Error(`Atama okunamadı (${docRes.status})`);
        }
        const fields = (await docRes.json()).fields || {};
        const assignedByUid = fields.assignedByUid?.stringValue;
        const assignedToUid = fields.assignedToUid?.stringValue;
        const status = fields.status?.stringValue;

        // Yalnızca görevi atayan kişi görebilir.
        if (!assignedByUid || assignedByUid !== uid || !assignedToUid) {
          return jsonResponse({ error: 'FORBIDDEN', message: 'Bu görevin istatistiğini görme yetkin yok.' }, 403, corsHeaders);
        }
        if (status !== 'ACCEPTED') {
          return jsonResponse({ success: true, accepted: false, task: null, records: [] }, 200, corsHeaders);
        }

        let dbName = getDbNameForUser(assignedToUid);
        const controlClient = getControlPlaneClient(env);
        if (controlClient) {
          const metaRes = await controlClient
            .execute({ sql: 'SELECT db_name FROM admin_users_index WHERE uid = ? LIMIT 1;', args: [assignedToUid] })
            .catch(() => null);
          dbName = metaRes?.rows?.[0]?.db_name || dbName;
        }

        const sessionInfo = await ensureUserDatabase(dbName, env);
        const userDbClient = createClient({ url: sessionInfo.dbUrl, authToken: sessionInfo.token });
        const taskRes = await userDbClient.execute({
          sql: 'SELECT id, period, intervalValue, subtaskCount, createdAt FROM tasks WHERE firestoreAssignmentId = ? LIMIT 1;',
          args: [assignmentId],
        });
        const taskRow = taskRes?.rows?.[0];
        if (!taskRow) {
          // Kabul edildi ama arkadaşın cihazında henüz oluşmadı
          return jsonResponse({ success: true, accepted: true, task: null, records: [] }, 200, corsHeaders);
        }

        const recordsRes = await userDbClient.execute({
          sql: 'SELECT periodKey, status, completedSubtasks FROM task_records WHERE taskId = ? ORDER BY periodKey DESC LIMIT 400;',
          args: [taskRow.id],
        });

        return jsonResponse(
          {
            success: true,
            accepted: true,
            task: {
              period: taskRow.period,
              intervalValue: Number(taskRow.intervalValue) || 1,
              subtaskCount: Number(taskRow.subtaskCount) || 1,
              createdAt: Number(taskRow.createdAt) || null,
            },
            records: (recordsRes?.rows || []).map((r) => ({
              periodKey: r.periodKey,
              status: r.status,
              completedSubtasks: Number(r.completedSubtasks) || 0,
            })),
          },
          200,
          corsHeaders
        );
      } catch (err) {
        const isAuth =
          err.name?.startsWith('JWT') ||
          err.name?.startsWith('JWS') ||
          err.message?.includes('Authorization') ||
          err.message?.includes('Token');
        if (isAuth) {
          return jsonResponse({ error: 'UNAUTHORIZED', message: 'Oturum doğrulanamadı.' }, 401, corsHeaders);
        }
        console.error('[Worker /assigned-tasks/:id/stats Error]:', err.message);
        return jsonResponse({ error: 'INTERNAL_ERROR', message: 'İstatistik alınamadı.' }, 500, corsHeaders);
      }
    }

    // ─── Bildirim zamanlamaları (kullanıcının kendi) ───────────────────────────
    // GET    /user/notification-schedules          → liste
    // POST   /user/notification-schedules          → ekle
    // PATCH  /user/notification-schedules/:id      → güncelle
    // DELETE /user/notification-schedules/:id      → sil
    // POST   /user/timezone                        → cihaz saat dilimini kaydet, zamanları yeniden hesapla
    const scheduleItemMatch = url.pathname.match(/^\/user\/notification-schedules\/([A-Za-z0-9_-]{1,64})$/);
    if (
      url.pathname === '/user/notification-schedules' ||
      scheduleItemMatch ||
      (request.method === 'POST' && url.pathname === '/user/timezone')
    ) {
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';
        const { uid } = await verifyFirebaseToken(authHeader, projectId);

        const controlClient = getControlPlaneClient(env);
        if (!controlClient) {
          return jsonResponse({ error: 'CONFIG_ERROR', message: 'Sunucu yapılandırması eksik.' }, 500, corsHeaders);
        }
        await ensureControlPlaneUsersIndexSchema(controlClient);
        const now = Date.now();

        const toScheduleJson = (row) => ({
          id: row.id,
          weekdays: parseWeekdaysJson(row.weekdays),
          hour: Number(row.hour),
          minute: Number(row.minute),
          label: row.label || '',
          nextFireAt: row.next_fire_at != null ? Number(row.next_fire_at) : null,
        });

        const parseScheduleBody = (body) => {
          const weekdays = Array.isArray(body?.weekdays)
            ? [...new Set(body.weekdays.map(Number))].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort((a, b) => a - b)
            : [];
          const hour = Number(body?.hour);
          const minute = Number(body?.minute);
          if (weekdays.length === 0) return { error: 'En az bir gün seçilmelidir.' };
          if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { error: 'Saat 0-23 arasında olmalıdır.' };
          if (!Number.isInteger(minute) || minute < 0 || minute > 59) return { error: 'Dakika 0-59 arasında olmalıdır.' };
          return {
            weekdays,
            hour,
            minute,
            label: cleanNotificationText(typeof body?.label === 'string' ? body.label : '', 120),
            timeZone: normalizeTimeZone(body?.timeZone),
          };
        };

        // POST /user/timezone
        if (url.pathname === '/user/timezone') {
          const body = await request.json().catch(() => ({}));
          const timeZone = normalizeTimeZone(body?.timeZone);

          const userRes = await controlClient.execute({
            sql: 'SELECT reminder_enabled, reminder_hour FROM admin_users_index WHERE uid = ? LIMIT 1;',
            args: [uid],
          });
          const userRow = userRes?.rows?.[0];
          const stmts = [];
          if (userRow) {
            const reminderNext = Number(userRow.reminder_enabled) === 1
              ? computeNextDailyFireAt(Number(userRow.reminder_hour), timeZone, now)
              : null;
            stmts.push({
              sql: 'UPDATE admin_users_index SET timezone = ?, reminder_next_at = ?, updated_at = ? WHERE uid = ?;',
              args: [timeZone, reminderNext, now, uid],
            });
          } else {
            stmts.push({
              sql: `INSERT INTO admin_users_index (uid, timezone, created_at, updated_at) VALUES (?, ?, ?, ?)
                    ON CONFLICT(uid) DO UPDATE SET timezone = excluded.timezone, updated_at = excluded.updated_at;`,
              args: [uid, timeZone, now, now],
            });
          }

          const schedulesRes = await controlClient.execute({
            sql: 'SELECT id, weekdays, hour, minute FROM notification_schedules WHERE uid = ?;',
            args: [uid],
          });
          for (const row of schedulesRes?.rows || []) {
            const next = computeScheduleNextFireAt({ ...row, timezone: timeZone }, now);
            stmts.push({
              sql: 'UPDATE notification_schedules SET timezone = ?, next_fire_at = ?, updated_at = ? WHERE id = ? AND uid = ?;',
              args: [timeZone, next, now, row.id, uid],
            });
          }
          await controlClient.batch(stmts, 'write');
          return jsonResponse({ success: true, timeZone }, 200, corsHeaders);
        }

        // GET /user/notification-schedules
        if (request.method === 'GET' && !scheduleItemMatch) {
          const res = await controlClient.execute({
            sql: 'SELECT id, weekdays, hour, minute, label, next_fire_at FROM notification_schedules WHERE uid = ? ORDER BY hour, minute, created_at;',
            args: [uid],
          });
          return jsonResponse({ success: true, schedules: (res?.rows || []).map(toScheduleJson) }, 200, corsHeaders);
        }

        // POST /user/notification-schedules
        if (request.method === 'POST' && !scheduleItemMatch) {
          const parsed = parseScheduleBody(await request.json().catch(() => ({})));
          if (parsed.error) {
            return jsonResponse({ error: 'VALIDATION_ERROR', message: parsed.error }, 400, corsHeaders);
          }
          const countRes = await controlClient.execute({
            sql: 'SELECT COUNT(*) AS c FROM notification_schedules WHERE uid = ?;',
            args: [uid],
          });
          if (Number(countRes?.rows?.[0]?.c || 0) >= MAX_SCHEDULES_PER_USER) {
            return jsonResponse(
              { error: 'LIMIT_REACHED', message: `En fazla ${MAX_SCHEDULES_PER_USER} bildirim zamanlaması ekleyebilirsin.` },
              400,
              corsHeaders
            );
          }
          const id = crypto.randomUUID();
          const next = computeNextWeeklyFireAt(parsed.weekdays, parsed.hour, parsed.minute, parsed.timeZone, now);
          await controlClient.execute({
            sql: `INSERT INTO notification_schedules (id, uid, weekdays, hour, minute, label, timezone, next_fire_at, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            args: [id, uid, JSON.stringify(parsed.weekdays), parsed.hour, parsed.minute, parsed.label, parsed.timeZone, next, now, now],
          });
          return jsonResponse(
            { success: true, schedule: toScheduleJson({ id, ...parsed, weekdays: parsed.weekdays, next_fire_at: next }) },
            200,
            corsHeaders
          );
        }

        // PATCH /user/notification-schedules/:id
        if (request.method === 'PATCH' && scheduleItemMatch) {
          const parsed = parseScheduleBody(await request.json().catch(() => ({})));
          if (parsed.error) {
            return jsonResponse({ error: 'VALIDATION_ERROR', message: parsed.error }, 400, corsHeaders);
          }
          const next = computeNextWeeklyFireAt(parsed.weekdays, parsed.hour, parsed.minute, parsed.timeZone, now);
          const res = await controlClient.execute({
            sql: `UPDATE notification_schedules
                  SET weekdays = ?, hour = ?, minute = ?, label = ?, timezone = ?, next_fire_at = ?, updated_at = ?
                  WHERE id = ? AND uid = ?;`,
            args: [JSON.stringify(parsed.weekdays), parsed.hour, parsed.minute, parsed.label, parsed.timeZone, next, now, scheduleItemMatch[1], uid],
          });
          if (!res.rowsAffected) {
            return jsonResponse({ error: 'NOT_FOUND', message: 'Zamanlama bulunamadı.' }, 404, corsHeaders);
          }
          return jsonResponse(
            { success: true, schedule: toScheduleJson({ id: scheduleItemMatch[1], ...parsed, weekdays: parsed.weekdays, next_fire_at: next }) },
            200,
            corsHeaders
          );
        }

        // DELETE /user/notification-schedules/:id
        if (request.method === 'DELETE' && scheduleItemMatch) {
          await controlClient.execute({
            sql: 'DELETE FROM notification_schedules WHERE id = ? AND uid = ?;',
            args: [scheduleItemMatch[1], uid],
          });
          return jsonResponse({ success: true }, 200, corsHeaders);
        }

        return jsonResponse({ error: 'METHOD_NOT_ALLOWED', message: 'Desteklenmeyen istek.' }, 405, corsHeaders);
      } catch (err) {
        const isAuth =
          err.name?.startsWith('JWT') ||
          err.name?.startsWith('JWS') ||
          err.message?.includes('Authorization') ||
          err.message?.includes('Token');
        if (isAuth) {
          return jsonResponse({ error: 'UNAUTHORIZED', message: 'Oturum doğrulanamadı.' }, 401, corsHeaders);
        }
        console.error('[Worker /user/notification-schedules Error]:', err.message);
        return jsonResponse({ error: 'INTERNAL_ERROR', message: 'Bildirim zamanlamaları işlenemedi.' }, 500, corsHeaders);
      }
    }

    // POST /test/trigger-reminders (Giriş yapmış kullanıcının KENDİ hatırlatıcı push bildirimini test etmesi)
    if (request.method === 'POST' && url.pathname === '/test/trigger-reminders') {
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

        // 1. ZORUNLU KİMLİK DOĞRULAMA (Açık/anonim erişim KESİNLİKLE yasaktır)
        if (!authHeader) {
          return jsonResponse({ error: 'UNAUTHORIZED', message: 'Yetkilendirme başlığı eksik.' }, 401, corsHeaders);
        }

        const { uid } = await verifyFirebaseToken(authHeader, projectId);
        if (!uid) {
          return jsonResponse({ error: 'UNAUTHORIZED', message: 'Geçersiz oturum.' }, 401, corsHeaders);
        }

        // 2. KÖTÜYE KULLANIM ÖNLEME / RATE LIMIT (Kullanıcı başına dakikada en fazla 5 test isteği)
        const isRateLimitOk = await checkPushRateLimit(env, `reminder_test:${uid}`, 5);
        if (!isRateLimitOk) {
          return jsonResponse(
            { error: 'RATE_LIMITED', message: 'Çok sık test isteği gönderildi. Lütfen bir dakika bekleyin.' },
            429,
            corsHeaders
          );
        }

        // 3. SIKI KORUMA: YALNIZCA doğrulanmış kullanıcının KENDİ hesabı hedeflenir.
        // Dışarıdan gelen body parametreleri asla başka bir kullanıcıyı hedefleyemez.
        const result = await runReminderTestForUser(env, uid);

        return jsonResponse(
          {
            success: true,
            uid,
            result,
          },
          200,
          corsHeaders
        );
      } catch (err) {
        const isAuth =
          err.name?.startsWith('JWT') ||
          err.name?.startsWith('JWS') ||
          err.message?.includes('Authorization') ||
          err.message?.includes('Token') ||
          err.message?.includes('token');

        if (isAuth) {
          return jsonResponse({ error: 'UNAUTHORIZED', message: 'Oturum doğrulanamadı.' }, 401, corsHeaders);
        }

        console.error('[Worker POST /test/trigger-reminders Error]:', err.message);
        return jsonResponse({ error: 'TEST_TRIGGER_ERROR', message: 'Test bildirimi gönderilemedi.' }, 500, corsHeaders);
      }
    }

    return jsonResponse({ error: 'NOT_FOUND', message: 'Endpoint bulunamadı' }, 404, corsHeaders);
    } catch (fatalError) {
      // Teknik detaylar (stack trace, dosya yolları vb.) sadece Worker konsoluna yazılır
      console.error('[Worker Fatal Error]:', fatalError);

      // Yanıtta stack trace veya gizli bilgi sızdırmadan temiz, genel ve güvenli hata dönülür
      let safeMessage = 'Sunucu içi beklenmeyen bir hata oluştu.';
      if (fatalError.message?.includes('FIREBASE_SERVICE_ACCOUNT')) {
        safeMessage = 'FIREBASE_SERVICE_ACCOUNT yapılandırması eksik veya geçersiz. Lütfen worker/.dev.vars dosyasını kontrol edin.';
      } else if (fatalError.message?.includes('TURSO_PLATFORM_TOKEN') || fatalError.message?.includes('TURSO_ORG')) {
        safeMessage = 'Turso Platform API veya organizasyon yapılandırması eksik. Lütfen worker/.dev.vars dosyasını kontrol edin.';
      } else if (fatalError.message?.includes('TURSO_CONTROL_DB_TOKEN')) {
        safeMessage = 'Turso Control Plane yapılandırması eksik. Lütfen worker/.dev.vars dosyasını kontrol edin.';
      } else if (fatalError.name === 'TypeError' || fatalError.name === 'ReferenceError') {
        safeMessage = 'Sunucu tarafında dahili bir çalışma zamanı hatası oluştu.';
      }

      return jsonResponse(
        {
          error: 'WORKER_INTERNAL_ERROR',
          message: safeMessage,
        },
        500,
        corsHeaders
      );
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduledTick(env));
  },
};
