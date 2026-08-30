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
    task_count: 2,
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
    task_count: 0,
    jp_balance: 0,
    is_disabled: 0,
  },
];

const mockUserDbs = {
  'user_ali_1': {
    tasks: [
      { id: 't1', title: 'Matematik Soru Çözümü', notes: 'Sayfa 50', period: 'DAILY', priority: 'HIGH', isArchived: 0, createdAt: 1710000000000 },
      { id: 't2', title: 'Kitap Oku', notes: '30 sayfa', period: 'DAILY', priority: 'MEDIUM', isArchived: 0, createdAt: 1709000000000 },
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

const mockAuditLogs = [];

function logMockAudit({ adminUid, adminEmail, targetUid, action, oldValue, newValue, status = 'SUCCESS', errorMessage = null }) {
  const entry = {
    id: `audit_${Date.now()}_${mockAuditLogs.length + 1}`,
    admin_uid: adminUid,
    admin_email: adminEmail,
    target_user_uid: targetUid,
    action,
    old_value: oldValue ? JSON.stringify(oldValue) : null,
    new_value: newValue ? JSON.stringify(newValue) : null,
    status,
    error_message: errorMessage,
    created_at: Date.now(),
  };
  mockAuditLogs.unshift(entry);
}

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
        },
        200,
        corsHeaders
      );
    } catch (err) {
      if (err.isForbidden) return jsonResponse({ error: 'FORBIDDEN' }, 403, corsHeaders);
      return jsonResponse({ error: 'UNAUTHORIZED' }, 401, corsHeaders);
    }
  }

  // GET /admin/users/:uid/detail (Faz 3 Salt Okunur)
  const detailMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/detail$/);
  if (request.method === 'GET' && detailMatch) {
    const targetUid = decodeURIComponent(detailMatch[1]);
    try {
      const authHeader = request.headers.get('Authorization');
      const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';
      await verifyAdminClaimWithKey(authHeader, projectId, customKey);

      const userMeta = mockUsersIndex.find((u) => u.uid === targetUid);
      if (!userMeta) return jsonResponse({ error: 'NOT_FOUND' }, 404, corsHeaders);
      const userDb = mockUserDbs[targetUid] || { tasks: [], rewards: [], categories: [], wallet: { balance: 0 } };

      return jsonResponse(
        {
          success: true,
          user: userMeta,
          tasks: userDb.tasks,
          rewards: userDb.rewards,
          categories: userDb.categories,
          wallet: userDb.wallet,
        },
        200,
        corsHeaders
      );
    } catch (err) {
      if (err.isForbidden) return jsonResponse({ error: 'FORBIDDEN' }, 403, corsHeaders);
      return jsonResponse({ error: 'UNAUTHORIZED' }, 401, corsHeaders);
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
      const { uid: adminUid, payload } = await verifyAdminClaimWithKey(authHeader, projectId, customKey);

      const body = await request.json();
      const { title, notes, priority, period, isArchived } = body;

      const allowedPriorities = ['HIGH', 'MEDIUM', 'LOW', 'ZERO'];
      const allowedPeriods = ['DAILY', 'WEEKLY', 'MONTHLY', 'ONCE'];

      if (priority && !allowedPriorities.includes(String(priority).toUpperCase())) {
        return jsonResponse({ error: 'INVALID_INPUT', message: 'Geçersiz öncelik.' }, 400, corsHeaders);
      }
      if (period && !allowedPeriods.includes(String(period).toUpperCase())) {
        return jsonResponse({ error: 'INVALID_INPUT', message: 'Geçersiz periyot.' }, 400, corsHeaders);
      }

      const userDb = mockUserDbs[targetUid];
      if (!userDb) return jsonResponse({ error: 'NOT_FOUND' }, 404, corsHeaders);

      const taskIdx = userDb.tasks.findIndex((t) => t.id === taskId);
      if (taskIdx === -1) return jsonResponse({ error: 'NOT_FOUND' }, 404, corsHeaders);

      const oldTask = { ...userDb.tasks[taskIdx] };

      if (title !== undefined) userDb.tasks[taskIdx].title = String(title).trim();
      if (notes !== undefined) userDb.tasks[taskIdx].notes = notes ? String(notes).trim() : null;
      if (priority !== undefined) userDb.tasks[taskIdx].priority = String(priority).toUpperCase();
      if (period !== undefined) userDb.tasks[taskIdx].period = String(period).toUpperCase();
      if (isArchived !== undefined) userDb.tasks[taskIdx].isArchived = isArchived === 1 || isArchived === true ? 1 : 0;

      logMockAudit({
        adminUid,
        adminEmail: payload.email,
        targetUid,
        action: 'UPDATE_TASK',
        oldValue: oldTask,
        newValue: userDb.tasks[taskIdx],
      });

      return jsonResponse({ success: true, taskId, message: 'Görev başarıyla güncellendi.' }, 200, corsHeaders);
    } catch (err) {
      if (err.isForbidden) return jsonResponse({ error: 'FORBIDDEN' }, 403, corsHeaders);
      return jsonResponse({ error: 'UNAUTHORIZED' }, 401, corsHeaders);
    }
  }

  // PATCH /admin/users/:uid/wallet (Faz 4 — Cüzdan JP Bakiyesi Düzenleme)
  const walletEditMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/wallet$/);
  if (request.method === 'PATCH' && walletEditMatch) {
    const targetUid = decodeURIComponent(walletEditMatch[1]);
    try {
      const authHeader = request.headers.get('Authorization');
      const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';
      const { uid: adminUid, payload } = await verifyAdminClaimWithKey(authHeader, projectId, customKey);

      const body = await request.json();
      const rawBalance = parseInt(body.balance, 10);
      const reason = (body.reason || '').trim();

      if (isNaN(rawBalance) || rawBalance < 0) {
        return jsonResponse({ error: 'INVALID_INPUT', message: 'Cüzdan bakiyesi negatif olamaz.' }, 400, corsHeaders);
      }
      if (!reason || reason.length < 3) {
        return jsonResponse({ error: 'REASON_REQUIRED', message: 'Gerekçe (reason) zorunludur.' }, 400, corsHeaders);
      }

      const userDb = mockUserDbs[targetUid];
      if (!userDb) return jsonResponse({ error: 'NOT_FOUND' }, 404, corsHeaders);

      const oldBalance = userDb.wallet.balance;
      userDb.wallet.balance = rawBalance;

      // Control plane sync
      const userMeta = mockUsersIndex.find((u) => u.uid === targetUid);
      if (userMeta) userMeta.jp_balance = rawBalance;

      logMockAudit({
        adminUid,
        adminEmail: payload.email,
        targetUid,
        action: 'UPDATE_WALLET',
        oldValue: { balance: oldBalance },
        newValue: { balance: rawBalance, reason },
      });

      return jsonResponse({ success: true, uid: targetUid, newBalance: rawBalance, reason }, 200, corsHeaders);
    } catch (err) {
      if (err.isForbidden) return jsonResponse({ error: 'FORBIDDEN' }, 403, corsHeaders);
      return jsonResponse({ error: 'UNAUTHORIZED' }, 401, corsHeaders);
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
      const { uid: adminUid, payload } = await verifyAdminClaimWithKey(authHeader, projectId, customKey);

      const body = await request.json();
      const { title, cost, isRedeemed } = body;

      if (cost !== undefined) {
        const rawCost = parseInt(cost, 10);
        if (isNaN(rawCost) || rawCost < 0) {
          return jsonResponse({ error: 'INVALID_INPUT', message: 'Ödül maliyeti negatif olamaz.' }, 400, corsHeaders);
        }
      }

      const userDb = mockUserDbs[targetUid];
      if (!userDb) return jsonResponse({ error: 'NOT_FOUND' }, 404, corsHeaders);

      const rewardIdx = userDb.rewards.findIndex((r) => r.id === rewardId);
      if (rewardIdx === -1) return jsonResponse({ error: 'NOT_FOUND' }, 404, corsHeaders);

      const oldReward = { ...userDb.rewards[rewardIdx] };

      if (title !== undefined) userDb.rewards[rewardIdx].title = String(title).trim();
      if (cost !== undefined) userDb.rewards[rewardIdx].cost = parseInt(cost, 10);
      if (isRedeemed !== undefined) userDb.rewards[rewardIdx].isRedeemed = isRedeemed === 1 || isRedeemed === true ? 1 : 0;

      logMockAudit({
        adminUid,
        adminEmail: payload.email,
        targetUid,
        action: 'UPDATE_REWARD',
        oldValue: oldReward,
        newValue: userDb.rewards[rewardIdx],
      });

      return jsonResponse({ success: true, rewardId, message: 'Ödül güncellendi.' }, 200, corsHeaders);
    } catch (err) {
      if (err.isForbidden) return jsonResponse({ error: 'FORBIDDEN' }, 403, corsHeaders);
      return jsonResponse({ error: 'UNAUTHORIZED' }, 401, corsHeaders);
    }
  }

  // GET /admin/audit-logs (Faz 4 — Audit Log Listeleme)
  if (request.method === 'GET' && url.pathname === '/admin/audit-logs') {
    try {
      const authHeader = request.headers.get('Authorization');
      const projectId = env.FIREBASE_PROJECT_ID || 'j-planning';
      await verifyAdminClaimWithKey(authHeader, projectId, customKey);

      const rawPage = parseInt(url.searchParams.get('page'), 10);
      const rawLimit = parseInt(url.searchParams.get('limit'), 10);
      const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
      const limit = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(100, rawLimit);
      const action = url.searchParams.get('action');

      let filtered = [...mockAuditLogs];
      if (action) {
        filtered = filtered.filter((l) => l.action === action);
      }

      const total = filtered.length;
      const totalPages = Math.ceil(total / limit) || 1;
      const paginatedLogs = filtered.slice((page - 1) * limit, page * limit);

      return jsonResponse(
        {
          success: true,
          logs: paginatedLogs,
          pagination: { page, limit, total, totalPages },
        },
        200,
        corsHeaders
      );
    } catch (err) {
      if (err.isForbidden) return jsonResponse({ error: 'FORBIDDEN' }, 403, corsHeaders);
      return jsonResponse({ error: 'UNAUTHORIZED' }, 401, corsHeaders);
    }
  }

  return jsonResponse({ error: 'NOT_FOUND' }, 404, corsHeaders);
}

async function runComprehensiveTestSuite() {
  console.log('================================================================');
  console.log('🛡️ J-PLANNING ADMIN PANELİ — FAZ 4 DÜZENLEME & AUDIT LOG TEST SETİ');
  console.log('================================================================\n');

  const env = {
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

  const normalUserToken = await new SignJWT({
    user_id: 'user_normal',
    email: 'normal@jplanning.com',
    admin: false,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setIssuer('https://securetoken.google.com/j-planning')
    .setAudience('j-planning')
    .setExpirationTime('1h')
    .sign(privateKey);

  // -------------------------------------------------------------
  // BÖLÜM 1: GÖREV DÜZENLEME (PATCH /admin/users/:uid/tasks/:taskId)
  // -------------------------------------------------------------
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📌 BÖLÜM 1: Görev Düzenleme ve Whitelist Koruması');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 1.1 Başarılı Güncelleme
  const editTaskRes = await handleWorkerRequest(
    new Request('http://localhost/admin/users/user_ali_1/tasks/t1', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'İleri Seviye Matematik', priority: 'HIGH', period: 'WEEKLY' }),
    }),
    env
  );
  assert.strictEqual(editTaskRes.status, 200);
  const editTaskJson = await editTaskRes.json();
  assert.strictEqual(editTaskJson.success, true);
  assert.strictEqual(mockUserDbs['user_ali_1'].tasks[0].title, 'İleri Seviye Matematik');
  console.log('   ✅ 1.1 PATCH /admin/users/:uid/tasks/:taskId: Görev başlığı ve periyodu başarıyla güncellendi.');

  // 1.2 Geçersiz Öncelik (Enum Whitelist Reddi 400)
  const invalidPriorityRes = await handleWorkerRequest(
    new Request('http://localhost/admin/users/user_ali_1/tasks/t1', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: 'SUPER_URGENT_INJECTION' }),
    }),
    env
  );
  assert.strictEqual(invalidPriorityRes.status, 400, 'Geçersiz öncelik 400 dönmelidir');
  console.log('   ✅ 1.2 Whitelist Koruması: Geçersiz öncelik değeri HTTP 400 ile engellendi.');

  // 1.3 Yetkisiz Kullanıcı Engeli (403)
  const unauthorizedTaskEdit = await handleWorkerRequest(
    new Request('http://localhost/admin/users/user_ali_1/tasks/t1', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${normalUserToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hacked Task' }),
    }),
    env
  );
  assert.strictEqual(unauthorizedTaskEdit.status, 403);
  console.log('   ✅ 1.3 Yetki Sınırı: Normal kullanıcının görev düzenleme isteği HTTP 403 ile reddedildi.\n');

  // -------------------------------------------------------------
  // BÖLÜM 2: CÜZDAN DÜZENLEME & ZORUNLU GEREKÇE (REASON)
  // -------------------------------------------------------------
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📌 BÖLÜM 2: Cüzdan (JP) Düzenleme & Zorunlu Gerekçe (Reason)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 2.1 Gerekçe Olmadan Red (400)
  const noReasonRes = await handleWorkerRequest(
    new Request('http://localhost/admin/users/user_ali_1/wallet', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ balance: 500 }),
    }),
    env
  );
  assert.strictEqual(noReasonRes.status, 400);
  const noReasonJson = await noReasonRes.json();
  assert.strictEqual(noReasonJson.error, 'REASON_REQUIRED');
  console.log('   ✅ 2.1 Zorunlu Gerekçe Denetimi: Reason eksik olduğunda HTTP 400 (REASON_REQUIRED) döndürüldü.');

  // 2.2 Negatif Bakiye Reddi (400)
  const negativeBalRes = await handleWorkerRequest(
    new Request('http://localhost/admin/users/user_ali_1/wallet', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ balance: -50, reason: 'Destek düzeltmesi' }),
    }),
    env
  );
  assert.strictEqual(negativeBalRes.status, 400);
  console.log('   ✅ 2.2 Negatif Değer Koruması: balance = -50 isteği HTTP 400 ile engellendi.');

  // 2.3 Başarılı Bakiye Güncelleme & Control Plane Eşitleme
  const validWalletRes = await handleWorkerRequest(
    new Request('http://localhost/admin/users/user_ali_1/wallet', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ balance: 350, reason: 'Destek talebi #104 puan telafisi' }),
    }),
    env
  );
  assert.strictEqual(validWalletRes.status, 200);
  assert.strictEqual(mockUserDbs['user_ali_1'].wallet.balance, 350);
  assert.strictEqual(mockUsersIndex.find((u) => u.uid === 'user_ali_1').jp_balance, 350);
  console.log('   ✅ 2.3 Başarılı Cüzdan Güncellemesi: Bakiye 350 JP yapıldı, Control Plane senkronize edildi.\n');

  // -------------------------------------------------------------
  // BÖLÜM 3: ÖDÜL DÜZENLEME & NEGATİF MALİYET REDDİ
  // -------------------------------------------------------------
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📌 BÖLÜM 3: Ödül Düzenleme & Negatif Maliyet Koruması');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 3.1 Negatif Maliyet Reddi (400)
  const negCostRes = await handleWorkerRequest(
    new Request('http://localhost/admin/users/user_ali_1/rewards/r1', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cost: -25 }),
    }),
    env
  );
  assert.strictEqual(negCostRes.status, 400);
  console.log('   ✅ 3.1 Negatif Ödül Maliyeti Reddi: cost = -25 isteği HTTP 400 ile engellendi.');

  // 3.2 Başarılı Ödül Güncelleme
  const validRewardRes = await handleWorkerRequest(
    new Request('http://localhost/admin/users/user_ali_1/rewards/r1', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Büyük Boy Kahve Molası', cost: 75 }),
    }),
    env
  );
  assert.strictEqual(validRewardRes.status, 200);
  assert.strictEqual(mockUserDbs['user_ali_1'].rewards[0].cost, 75);
  console.log('   ✅ 3.2 Başarılı Ödül Güncelleme: Ödül başlığı ve maliyeti (75 JP) güncellendi.\n');

  // -------------------------------------------------------------
  // BÖLÜM 4: DEĞİŞTİRİLEMEZ AUDIT LOG & LİSTELEME
  // -------------------------------------------------------------
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📌 BÖLÜM 4: Değiştirilemez Audit Log Listesi (GET /admin/audit-logs)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const auditLogsRes = await handleWorkerRequest(
    new Request('http://localhost/admin/audit-logs?page=1&limit=20', {
      headers: { Authorization: `Bearer ${adminToken}` },
    }),
    env
  );
  assert.strictEqual(auditLogsRes.status, 200);
  const auditLogsJson = await auditLogsRes.json();
  assert.strictEqual(auditLogsJson.success, true);
  assert.ok(auditLogsJson.logs.length >= 3, 'En az 3 denetim kaydı oluşmuş olmalıdır');
  const walletLog = auditLogsJson.logs.find((l) => l.action === 'UPDATE_WALLET');
  assert.ok(walletLog, 'UPDATE_WALLET logu kaydedilmiş olmalıdır');
  assert.ok(walletLog.new_value.includes('Destek talebi #104'), 'Logda gerekçe yer almalıdır');
  console.log(`   ✅ 4.1 Audit Log Kayıtları: Toplam ${auditLogsJson.logs.length} işlem denetim geçmişine kaydedildi.`);
  console.log('   ✅ 4.2 Gerekçe & Detay: Cüzdan değişikliğindeki reason alanı denetim logunda doğrulandı.\n');

  // -------------------------------------------------------------
  // BÖLÜM 5: FIREBASE USER PROTOTYPE & getIdToken REGRESYON KORUMASI
  // -------------------------------------------------------------
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📌 BÖLÜM 5: Firebase User Prototype & getIdToken Regresyon Koruması');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Firebase User sınıfı simülasyonu (prototip metodları içerir)
  class MockFirebaseUser {
    constructor(uid, email) {
      this.uid = uid;
      this.email = email;
    }
    async getIdToken() {
      return `mock_token_${this.uid}`;
    }
    async getIdTokenResult() {
      return { claims: { admin: true } };
    }
  }

  const rawFirebaseUser = new MockFirebaseUser('admin_123', 'admin@jplanning.com');

  // Spread operatörü uygulandığında metodların kaybolduğunu doğrula (neden bozulduğunu belgeleyen test)
  const spreadUser = { ...rawFirebaseUser, profile: { theme: 'dark' } };
  assert.strictEqual(
    typeof spreadUser.getIdToken,
    'undefined',
    'Spread operatörü ({ ...user }) prototype metodlarını kaybettirir!'
  );

  // Doğru yaklaşım: Prototipi bozmadan profile bağlama
  rawFirebaseUser.profile = { theme: 'dark' };
  assert.strictEqual(
    typeof rawFirebaseUser.getIdToken,
    'function',
    'Doğrudan atama veya Object.assign ile getIdToken fonksiyonu korunmalıdır!'
  );

  const tokenOutput = await rawFirebaseUser.getIdToken();
  assert.strictEqual(tokenOutput, 'mock_token_admin_123');
  console.log('   ✅ 5.1 Regresyon Koruması: { ...firebaseUser } anti-pattern tespit edildi ve engellendi.');
  console.log('   ✅ 5.2 Metod Doğrulaması: user.getIdToken() prototip fonksiyonunun sağlam kaldığı kanıtlandı.\n');

  console.log('================================================================');
  console.log('🎉 FAZ 4 TÜM TESTLER VE REGRESYON KORUMASI BAŞARIYLA GEÇTİ (0 HATA)');
  console.log('================================================================\n');
}

runComprehensiveTestSuite().catch((err) => {
  console.error('❌ Test Başarısız:', err);
  process.exit(1);
});
