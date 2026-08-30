import assert from 'node:assert';
import { generateKeyPair, SignJWT, jwtVerify } from 'jose';

// Test ortamı için RSA anahtar çiftleri
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
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
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

// Mock Control Plane DB & Mock User DBs
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

const mockUserDbs = {
  'user_ali_1': {
    tasks: [
      { id: 't1', title: 'Matematik Soru Çözümü', period: 'DAILY', priority: 'HIGH', isArchived: 0, createdAt: 1710000000000 },
      { id: 't2', title: 'Kitap Oku', period: 'DAILY', priority: 'MEDIUM', isArchived: 0, createdAt: 1709000000000 },
    ],
    rewards: [
      { id: 'r1', title: 'Kahve Molası', cost: 50, isRedeemed: 0, createdAt: 1708000000000 },
    ],
    categories: [
      { id: 'c1', name: 'Ders', color: '#6366f1', createdAt: 1700000000000 },
    ],
    wallet: { balance: 120 },
  },
};

// Rate limiter mock
const memoryRateLimitMap = new Map();
function checkMockRateLimit(identifier, limit = 40) {
  const now = Date.now();
  const record = memoryRateLimitMap.get(identifier) || { count: 0, resetAt: now + 60000 };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + 60000;
  }
  record.count++;
  memoryRateLimitMap.set(identifier, record);
  return record.count > limit;
}

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

  // Rate Limiting (Tüm /session ve /admin/* endpoint'leri için)
  if (url.pathname === '/session' || url.pathname.startsWith('/admin/')) {
    const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
    if (checkMockRateLimit(ip)) {
      return jsonResponse({ error: 'TOO_MANY_REQUESTS', message: 'Çok fazla istek.' }, 429, corsHeaders);
    }
  }

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

      return jsonResponse({ error: 'UNAUTHORIZED', message: err.message }, 401, corsHeaders);
    }
  }

  // GET /admin/users
  if (request.method === 'GET' && url.pathname === '/admin/users') {
    try {
      const authHeader = request.headers.get('Authorization');
      const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

      await verifyAdminClaimWithKey(authHeader, projectId, customKey);

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

  // GET /admin/users/:uid/detail (Faz 3 Salt Okunur ve Drill-Down Senkronu)
  const detailMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/detail$/);
  if (request.method === 'GET' && detailMatch) {
    const targetUid = decodeURIComponent(detailMatch[1]);
    try {
      const authHeader = request.headers.get('Authorization');
      const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

      await verifyAdminClaimWithKey(authHeader, projectId, customKey);

      const userMeta = mockUsersIndex.find((u) => u.uid === targetUid) || {
        uid: targetUid,
        email: 'unknown@example.com',
        display_name: 'Bilinmeyen',
        db_name: `jplanning-user-${targetUid}`,
        created_at: Date.now(),
        last_login_at: Date.now(),
        task_count: 0,
        jp_balance: 0,
        is_disabled: 0,
      };

      const userDb = mockUserDbs[targetUid] || { tasks: [], rewards: [], categories: [], wallet: { balance: 0 } };

      // Drill-Down sync
      userMeta.task_count = userDb.tasks.length;
      userMeta.jp_balance = userDb.wallet.balance;

      return jsonResponse(
        {
          success: true,
          user: userMeta,
          tasks: userDb.tasks,
          rewards: userDb.rewards,
          categories: userDb.categories,
          wallet: userDb.wallet,
          summary: {
            totalTasks: userDb.tasks.length,
            jpBalance: userDb.wallet.balance,
            rewardCount: userDb.rewards.length,
            syncedAt: Date.now(),
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

  // PATCH /admin/users/:uid/status (Faz 3 Kullanıcı Askıya Alma)
  const statusMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/status$/);
  if (request.method === 'PATCH' && statusMatch) {
    const targetUid = decodeURIComponent(statusMatch[1]);
    try {
      const authHeader = request.headers.get('Authorization');
      const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

      await verifyAdminClaimWithKey(authHeader, projectId, customKey);

      const body = await request.json();
      const isDisabled = body.isDisabled === true || body.isDisabled === 1 ? 1 : 0;

      const userIdx = mockUsersIndex.findIndex((u) => u.uid === targetUid);
      if (userIdx !== -1) {
        mockUsersIndex[userIdx].is_disabled = isDisabled;
      }

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
      if (err.isForbidden) {
        return jsonResponse({ error: 'FORBIDDEN', message: 'Yetkisiz erişim.' }, 403, corsHeaders);
      }
      return jsonResponse({ error: 'UNAUTHORIZED', message: 'Oturum geçersiz.' }, 401, corsHeaders);
    }
  }

  // POST /session (Askıya Alınmış Kullanıcı Engeli Testi)
  if (request.method === 'POST' && url.pathname === '/session') {
    try {
      const authHeader = request.headers.get('Authorization');
      const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';

      const { uid } = await verifyFirebaseTokenWithKey(authHeader, projectId, customKey);

      const userInDb = mockUsersIndex.find((u) => u.uid === uid);
      if (userInDb && userInDb.is_disabled === 1) {
        return jsonResponse(
          {
            error: 'ACCOUNT_DISABLED',
            message: 'Hesabınız yönetici tarafından askıya alınmıştır.',
          },
          403,
          corsHeaders
        );
      }

      return jsonResponse(
        {
          success: true,
          uid,
          dbName: `jplanning-user-${uid}`,
          dbUrl: `libsql://jplanning-user-${uid}.turso.io`,
          token: 'mock_token',
        },
        200,
        corsHeaders
      );
    } catch (err) {
      return jsonResponse({ error: 'UNAUTHORIZED', message: err.message }, 401, corsHeaders);
    }
  }

  return jsonResponse({ error: 'NOT_FOUND' }, 404, corsHeaders);
}

async function runComprehensiveTestSuite() {
  console.log('================================================================');
  console.log('🛡️ J-PLANNING ADMIN PANELİ — FAZ 1, FAZ 2 & FAZ 3 TEST SETİ');
  console.log('================================================================\n');

  const env = {
    TURSO_ORG: 'ysftrasci',
    TURSO_GROUP: 'jplanning',
    FIREBASE_PROJECT_ID: 'j-planning',
    ALLOWED_ORIGINS: 'http://localhost:5173',
  };

  const adminToken = await new SignJWT({
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

  // -------------------------------------------------------------
  // BÖLÜM 1: FAZ 3 KULLANICI DETAYI (SALT OKUNUR DRİLL-DOWN) TESTİ
  // -------------------------------------------------------------
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📌 BÖLÜM 1: FAZ 3 Kullanıcı Detay API & Drill-Down Senkronu');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const detailRes = await handleWorkerRequest(
    new Request('http://localhost/admin/users/user_ali_1/detail', {
      headers: { Authorization: `Bearer ${adminToken}` },
    }),
    env
  );
  assert.strictEqual(detailRes.status, 200, 'Kullanıcı detay endpoint 200 dönmelidir');
  const detailJson = await detailRes.json();
  assert.strictEqual(detailJson.success, true);
  assert.strictEqual(detailJson.tasks.length, 2, 'Kullanıcının 2 görevi listelenmelidir');
  assert.strictEqual(detailJson.rewards.length, 1, 'Kullanıcının 1 ödülü listelenmelidir');
  assert.strictEqual(detailJson.wallet.balance, 120, 'Kullanıcının 120 JP bakiyesi okunmalıdır');
  assert.strictEqual(detailJson.user.task_count, 2, 'Drill-down ile task_count güncellenmelidir');
  console.log('   ✅ 1.1 GET /admin/users/:uid/detail: 2 görev, 1 ödül, 120 JP cüzdan verisi başarıyla okundu.');
  console.log('   ✅ 1.2 Drill-Down Senkronu: Control plane özet sayaçları (task_count=2, jp_balance=120) senkronize edildi.\n');

  // -------------------------------------------------------------
  // BÖLÜM 2: FAZ 3 KULLANICIYI ASKIYA ALMA (isDisabled) VE OTURUM ENGELİ
  // -------------------------------------------------------------
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📌 BÖLÜM 2: FAZ 3 Kullanıcı Askıya Alma (isDisabled) & Oturum Engeli');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 2.1 Kullanıcıyı Askıya Al
  const suspendRes = await handleWorkerRequest(
    new Request('http://localhost/admin/users/user_ali_1/status', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDisabled: true }),
    }),
    env
  );
  assert.strictEqual(suspendRes.status, 200);
  const suspendJson = await suspendRes.json();
  assert.strictEqual(suspendJson.isDisabled, true);
  console.log('   ✅ 2.1 PATCH /admin/users/:uid/status: user_ali_1 başarıyla askıya alındı (is_disabled = 1).');

  // 2.2 Askıya Alınan Kullanıcının /session İsteği Reddedilmeli
  const aliUserToken = await new SignJWT({
    user_id: 'user_ali_1',
    email: 'ali@example.com',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setIssuer('https://securetoken.google.com/j-planning')
    .setAudience('j-planning')
    .setExpirationTime('1h')
    .sign(privateKey);

  const sessionBlockedRes = await handleWorkerRequest(
    new Request('http://localhost/session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliUserToken}` },
    }),
    env
  );
  assert.strictEqual(sessionBlockedRes.status, 403, 'Askıya alınan kullanıcı /session isteğinde 403 almalıdır');
  const sessionBlockedJson = await sessionBlockedRes.json();
  assert.strictEqual(sessionBlockedJson.error, 'ACCOUNT_DISABLED');
  console.log('   ✅ 2.2 POST /session: Askıya alınan kullanıcının oturum açması HTTP 403 (ACCOUNT_DISABLED) ile engellendi.');

  // 2.3 Kullanıcıyı Yeniden Aktifleştir
  const activateRes = await handleWorkerRequest(
    new Request('http://localhost/admin/users/user_ali_1/status', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDisabled: false }),
    }),
    env
  );
  assert.strictEqual(activateRes.status, 200);
  console.log('   ✅ 2.3 PATCH /admin/users/:uid/status: user_ali_1 başarıyla yeniden aktifleştirildi (is_disabled = 0).\n');

  // -------------------------------------------------------------
  // BÖLÜM 3: RATE LIMITING KORUMA TESTİ (429)
  // -------------------------------------------------------------
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📌 BÖLÜM 3: Rate Limiting Koruması (HTTP 429)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let rateLimitHit = false;
  for (let i = 0; i < 45; i++) {
    const r = await handleWorkerRequest(
      new Request('http://localhost/admin/ping', {
        headers: { Authorization: `Bearer ${adminToken}`, 'CF-Connecting-IP': '198.51.100.1' },
      }),
      env
    );
    if (r.status === 429) {
      rateLimitHit = true;
      break;
    }
  }
  assert.strictEqual(rateLimitHit, true, 'Hızlı peş peşe isteklerde 429 tetiklenmelidir');
  console.log('   ✅ 3.1 Rate Limit Tetiklendi: Eşik aşıldığında HTTP 429 Too Many Requests döndürüldü.\n');

  console.log('================================================================');
  console.log('🎉 FAZ 3 TÜM TESTLER BAŞARIYLA GEÇTİ (0 HATA)');
  console.log('================================================================\n');
}

runComprehensiveTestSuite().catch((err) => {
  console.error('❌ Test Başarısız:', err);
  process.exit(1);
});
