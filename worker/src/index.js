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
  // Turso Platform API dokümantasyonu:
  // POST /v1/organizations/{org}/databases/{db}/auth/tokens?expiration=1h&authorization=full-access
  // NOT: Turso Platform API'sinde expiration ve authorization QUERY PARAMETER olarak gönderilmelidir!
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
  async fetch(request, env) {
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

    // POST /session (Firebase Token -> Turso DB & Scoped Token)
    if (request.method === 'POST' && url.pathname === '/session') {
      try {
        const authHeader = request.headers.get('Authorization');
        const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

        // 1. Firebase Token Doğrulama
        const { uid } = await verifyFirebaseToken(authHeader, projectId);

        // 2. Kullanıcıya özel DB adı
        const dbName = getDbNameForUser(uid);

        // 3. DB kontrolü / oluşturma & scoped token üretimi
        const sessionInfo = await ensureUserDatabase(dbName, env);

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
          err.name === 'JWTExpired' ||
          err.name === 'JWTClaimValidationFailed' ||
          err.name === 'JWSSignatureVerificationFailed' ||
          err.message.includes('Authorization') ||
          err.message.includes('Token');

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
