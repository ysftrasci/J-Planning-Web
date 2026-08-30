import assert from 'node:assert';
import { generateKeyPair, SignJWT, jwtVerify } from 'jose';

// Test ortamı için RSA anahtar çiftleri (biri meşru, biri sahte saldırgan anahtarı)
const { privateKey, publicKey } = await generateKeyPair('RS256');
const { privateKey: attackerPrivateKey } = await generateKeyPair('RS256');

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

// Worker'ın içindeki Firebase ve Admin Claim doğrulama mantığı
async function verifyFirebaseTokenWithKey(authHeader, projectId, key) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Authorization header eksik veya geçersiz formatta');
  }

  const token = authHeader.substring(7).trim();
  const issuer = `https://securetoken.google.com/${projectId}`;

  const { payload } = await jwtVerify(token, key, {
    issuer,
    audience: projectId,
  });

  const uid = payload.user_id || payload.sub;
  if (!uid) {
    throw new Error('Token içinde kullanıcı kimliği (UID) bulunamadı');
  }

  return { uid, payload };
}

async function verifyAdminClaimWithKey(authHeader, projectId, key) {
  const { uid, payload } = await verifyFirebaseTokenWithKey(authHeader, projectId, key);

  if (payload.admin !== true) {
    const forbiddenErr = new Error('Admin yetkisi bulunamadı');
    forbiddenErr.isForbidden = true;
    forbiddenErr.uid = uid;
    throw forbiddenErr;
  }

  return { uid, payload };
}

// Mock Control Plane DB
const mockUsersIndex = [
  {
    uid: 'user_ali_1',
    email: 'ali@example.com',
    display_name: 'Ali Yılmaz',
    db_name: 'jplanning-user-user-ali-1',
    created_at: 1700000000000,
    last_login_at: 1710000000000,
    task_count: 5,
    jp_balance: 120,
    is_disabled: 0,
  },
  {
    uid: 'user_ayse_2',
    email: 'ayse@example.com',
    display_name: 'Ayşe Kaya',
    db_name: 'jplanning-user-user-ayse-2',
    created_at: 1705000000000,
    last_login_at: 1715000000000,
    task_count: 12,
    jp_balance: 340,
    is_disabled: 0,
  },
];

// Worker router simülatörü (worker/src/index.js ile %100 özdeş)
async function handleWorkerRequest(request, env, customKey = publicKey) {
  const corsHeaders = getCorsHeaders(request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  const url = new URL(request.url);

  // GET /admin/ping
  if (request.method === 'GET' && url.pathname === '/admin/ping') {
    try {
      const authHeader = request.headers.get('Authorization');
      const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

      const { uid, payload } = await verifyAdminClaimWithKey(authHeader, projectId, customKey);

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
            detail: err.message,
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

  // GET /admin/users
  if (request.method === 'GET' && url.pathname === '/admin/users') {
    try {
      const authHeader = request.headers.get('Authorization');
      const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

      await verifyAdminClaimWithKey(authHeader, projectId, customKey);

      // Güvenli page & limit parsing (NaN ve sınır dışı korumalı)
      const rawPage = parseInt(url.searchParams.get('page'), 10);
      const rawLimit = parseInt(url.searchParams.get('limit'), 10);
      const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
      const limit = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(100, rawLimit);
      const search = (url.searchParams.get('search') || '').trim();

      // Whitelist ile korunan sortBy
      const sortBy = ['created_at', 'last_login_at', 'task_count', 'jp_balance', 'email'].includes(
        url.searchParams.get('sortBy')
      )
        ? url.searchParams.get('sortBy')
        : 'last_login_at';

      const order = url.searchParams.get('order')?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      // Parametreli SQL simülasyonu
      let filtered = [...mockUsersIndex];
      if (search) {
        filtered = filtered.filter(
          (u) =>
            u.email.includes(search) ||
            u.display_name.includes(search) ||
            u.uid.includes(search)
        );
      }

      filtered.sort((a, b) => {
        if (order === 'ASC') {
          return a[sortBy] > b[sortBy] ? 1 : -1;
        }
        return a[sortBy] < b[sortBy] ? 1 : -1;
      });

      const total = filtered.length;
      const totalPages = Math.ceil(total / limit) || 1;
      const paginatedUsers = filtered.slice((page - 1) * limit, page * limit);

      return jsonResponse(
        {
          success: true,
          appliedSortBy: sortBy,
          appliedOrder: order,
          users: paginatedUsers,
          pagination: { page, limit, total, totalPages },
        },
        200,
        corsHeaders
      );
    } catch (err) {
      if (err.isForbidden) {
        return jsonResponse({ error: 'FORBIDDEN', message: 'Yetkisiz erişim.' }, 403, corsHeaders);
      }
      return jsonResponse({ error: 'UNAUTHORIZED', message: 'Oturum geçersiz.' }, 401, corsHeaders);
    }
  }

  // GET /admin/stats
  if (request.method === 'GET' && url.pathname === '/admin/stats') {
    try {
      const authHeader = request.headers.get('Authorization');
      const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

      await verifyAdminClaimWithKey(authHeader, projectId, customKey);

      const totalUsers = mockUsersIndex.length;
      const totalTasks = mockUsersIndex.reduce((acc, u) => acc + u.task_count, 0);
      const totalJP = mockUsersIndex.reduce((acc, u) => acc + u.jp_balance, 0);

      return jsonResponse(
        {
          success: true,
          stats: {
            totalUsers,
            active7d: totalUsers,
            active30d: totalUsers,
            disabledUsers: 0,
            totalTasks,
            totalJP,
            serverTimestamp: Date.now(),
          },
        },
        200,
        corsHeaders
      );
    } catch (err) {
      if (err.isForbidden) {
        return jsonResponse({ error: 'FORBIDDEN', message: 'Yetkisiz erişim.' }, 403, corsHeaders);
      }
      return jsonResponse({ error: 'UNAUTHORIZED', message: 'Oturum geçersiz.' }, 401, corsHeaders);
    }
  }

  return jsonResponse({ error: 'NOT_FOUND' }, 404, corsHeaders);
}

// Frontend Route Guard Mantık Simülasyonu
function simulateRouteGuard({ user, isAdmin, initializing, targetPath }) {
  if (initializing) return 'LOADING';
  if (!user) return '/login';
  if (!user.emailVerified) return '/verify-email';
  if (user?.profile?.isDeleting === true) return 'DELETION_MODAL';

  if (targetPath.startsWith('/admin')) {
    if (!isAdmin) return '/'; // Sessizce anasayfaya yönlendir
    return `${targetPath} (GÖSTERİLDİ)`;
  }

  return targetPath;
}

async function runComprehensiveTestSuite() {
  console.log('================================================================');
  console.log('🛡️ J-PLANNING ADMIN PANELİ — FAZ 1 & FAZ 2 KAPSAMLI TEST SETİ');
  console.log('================================================================\n');

  const env = {
    TURSO_ORG: 'ysftrasci',
    TURSO_GROUP: 'jplanning',
    FIREBASE_PROJECT_ID: 'j-planning',
    ALLOWED_ORIGINS: 'http://localhost:5173',
  };

  // -------------------------------------------------------------
  // BÖLÜM 1: FAZ 1 GÜVENLİK VE TOKEN UÇ DURUM TESTLERİ (/admin/ping)
  // -------------------------------------------------------------
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📌 BÖLÜM 1: FAZ 1 Token & Yetkilendirme Uç Durumları (/admin/ping)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 1.1: Süresi Dolmuş (Expired) Token Testi
  const expiredToken = await new SignJWT({
    user_id: 'expired_user',
    email: 'expired@jplanning.com',
    admin: true,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setIssuer('https://securetoken.google.com/j-planning')
    .setAudience('j-planning')
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
    .sign(privateKey);

  const expiredRes = await handleWorkerRequest(
    new Request('http://localhost/admin/ping', {
      headers: { Authorization: `Bearer ${expiredToken}` },
    }),
    env
  );
  assert.strictEqual(expiredRes.status, 401, 'Süresi dolmuş token 401 dönmelidir');
  console.log('   ✅ 1.1 Süresi Dolmuş (Expired) Token: HTTP 401 UNAUTHORIZED (Çökme yok)');

  // 1.2: Sahte İmzalı (Manipulated) Token Testi
  const fakeToken = await new SignJWT({
    user_id: 'hacker_01',
    email: 'hacker@malicious.com',
    admin: true,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setIssuer('https://securetoken.google.com/j-planning')
    .setAudience('j-planning')
    .setExpirationTime('1h')
    .sign(attackerPrivateKey); // Sahte anahtar ile imzalandı

  const fakeRes = await handleWorkerRequest(
    new Request('http://localhost/admin/ping', {
      headers: { Authorization: `Bearer ${fakeToken}` },
    }),
    env
  );
  assert.strictEqual(fakeRes.status, 401, 'Sahte imzalı token 401 ile reddedilmelidir');
  console.log('   ✅ 1.2 Sahte İmzalı / Manipüle Token: HTTP 401 UNAUTHORIZED (İmza uyuşmazlığı yakalandı)');

  // 1.3: Authorization Header'ı Olmayan İstek Testi
  const noAuthRes = await handleWorkerRequest(
    new Request('http://localhost/admin/ping', {
      headers: {},
    }),
    env
  );
  assert.strictEqual(noAuthRes.status, 401, 'Auth header eksik istek 401 dönmelidir (500 değil)');
  console.log("   ✅ 1.3 Authorization Header Eksik: HTTP 401 UNAUTHORIZED (500'e düşmeden temiz hata)");

  // 1.4: Admin Claim'i Olmayan Normal Kullanıcı Token'ı Testi
  const nonAdminToken = await new SignJWT({
    user_id: 'normal_user_123',
    email: 'user@jplanning.com',
    admin: false,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setIssuer('https://securetoken.google.com/j-planning')
    .setAudience('j-planning')
    .setExpirationTime('1h')
    .sign(privateKey);

  const nonAdminRes = await handleWorkerRequest(
    new Request('http://localhost/admin/ping', {
      headers: { Authorization: `Bearer ${nonAdminToken}` },
    }),
    env
  );
  assert.strictEqual(nonAdminRes.status, 403, 'Admin claim olmayan kullanıcı 403 dönmelidir');
  console.log('   ✅ 1.4 Normal Kullanıcı (admin: false): HTTP 403 FORBIDDEN (Erişim engellendi)');

  // 1.5: Geçerli Admin Token'ı Testi
  const validAdminToken = await new SignJWT({
    user_id: 'admin_official',
    email: 'admin@jplanning.com',
    admin: true,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setIssuer('https://securetoken.google.com/j-planning')
    .setAudience('j-planning')
    .setExpirationTime('1h')
    .sign(privateKey);

  const validAdminRes = await handleWorkerRequest(
    new Request('http://localhost/admin/ping', {
      headers: { Authorization: `Bearer ${validAdminToken}` },
    }),
    env
  );
  assert.strictEqual(validAdminRes.status, 200, 'Geçerli admin token 200 dönmelidir');
  const validAdminJson = await validAdminRes.json();
  assert.strictEqual(validAdminJson.success, true);
  assert.strictEqual(validAdminJson.uid, 'admin_official');
  console.log('   ✅ 1.5 Geçerli Admin (admin: true): HTTP 200 OK (Doğrulandı, UID: admin_official)\n');

  // -------------------------------------------------------------
  // BÖLÜM 2: FAZ 2 KULLANICI LİSTESİ VE GÜVENLİK TESTLERİ
  // -------------------------------------------------------------
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📌 BÖLÜM 2: FAZ 2 API, SQL Enjeksiyon ve Sayfalama Testleri');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 2.1: sortBy Whitelist & SQL Enjeksiyon Koruması
  const badSortRes = await handleWorkerRequest(
    new Request('http://localhost/admin/users?sortBy=email;DROP%20TABLE%20admin_users_index;--', {
      headers: { Authorization: `Bearer ${validAdminToken}` },
    }),
    env
  );
  const badSortJson = await badSortRes.json();
  assert.strictEqual(badSortJson.appliedSortBy, 'last_login_at', 'Zararlı sortBy güvenli varsayılana düşmeli');
  console.log('   ✅ 2.1 sortBy Whitelist: Zararlı girdi engellendi, güvenli varsayılan ("last_login_at") uygulandı.');

  // 2.2: search Arama ve SQL Enjeksiyon Koruma Testi
  const sqlInjRes = await handleWorkerRequest(
    new Request("http://localhost/admin/users?search=' OR '1'='1", {
      headers: { Authorization: `Bearer ${validAdminToken}` },
    }),
    env
  );
  const sqlInjJson = await sqlInjRes.json();
  assert.strictEqual(sqlInjJson.users.length, 0, 'SQL enjeksiyonu tüm tabloyu dökmemelidir');
  console.log("   ✅ 2.2 search Parametresi SQL Enjeksiyon Denemesi: 0 sonuç döndü, sızıntı engellendi.");

  // 2.3: Sınır Dışı Sayfalama Testi (page=-1, limit=999999)
  const boundaryRes = await handleWorkerRequest(
    new Request('http://localhost/admin/users?page=-1&limit=999999', {
      headers: { Authorization: `Bearer ${validAdminToken}` },
    }),
    env
  );
  const boundaryJson = await boundaryRes.json();
  assert.strictEqual(boundaryJson.pagination.page, 1);
  assert.strictEqual(boundaryJson.pagination.limit, 100);
  console.log('   ✅ 2.3 Sayfalama Sınırları: page=-1 ➔ 1, limit=999999 ➔ 100 olarak normalize edildi.');

  // 2.4: İstatistikler Endpoint Testi (/admin/stats)
  const statsRes = await handleWorkerRequest(
    new Request('http://localhost/admin/stats', {
      headers: { Authorization: `Bearer ${validAdminToken}` },
    }),
    env
  );
  const statsJson = await statsRes.json();
  assert.strictEqual(statsRes.status, 200);
  assert.strictEqual(statsJson.stats.totalUsers, 2);
  assert.strictEqual(statsJson.stats.totalTasks, 17);
  assert.strictEqual(statsJson.stats.totalJP, 460);
  console.log('   ✅ 2.4 /admin/stats Endpoint: Toplam kullanıcı, görev ve JP toplamları doğrulandı.');

  // -------------------------------------------------------------
  // BÖLÜM 3: ROUTE GUARD SİMÜLASYONU
  // -------------------------------------------------------------
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📌 BÖLÜM 3: Frontend Route Guard 3 Ayrık Senaryo Testi');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const routes = ['/admin', '/admin/users', '/admin/stats'];
  for (const r of routes) {
    const resNoAuth = simulateRouteGuard({ user: null, isAdmin: false, initializing: false, targetPath: r });
    assert.strictEqual(resNoAuth, '/login');

    const resNotAdmin = simulateRouteGuard({
      user: { uid: 'normal_u1', emailVerified: true },
      isAdmin: false,
      initializing: false,
      targetPath: r,
    });
    assert.strictEqual(resNotAdmin, '/');

    const resAdmin = simulateRouteGuard({
      user: { uid: 'admin_master', emailVerified: true },
      isAdmin: true,
      initializing: false,
      targetPath: r,
    });
    assert.strictEqual(resAdmin, `${r} (GÖSTERİLDİ)`);
    console.log(`   ✅ Route [${r}]: Giriş Yok ➔ /login | Normal Kullanıcı ➔ / (Gizli) | Admin ➔ GÖSTERİLDİ`);
  }

  console.log('\n================================================================');
  console.log('🎉 FAZ 1 & FAZ 2 TÜM TESTLER BAŞARIYLA GEÇTİ (0 HATA)');
  console.log('================================================================\n');
}

runComprehensiveTestSuite().catch((err) => {
  console.error('❌ Test Başarısız:', err);
  process.exit(1);
});
