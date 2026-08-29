import assert from 'node:assert';
import { generateKeyPair, SignJWT, jwtVerify } from 'jose';

// Test ortamı için RSA anahtar çifti
const { privateKey, publicKey } = await generateKeyPair('RS256');

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

// Worker'ın içindeki doğrulama mantığı
async function verifyAdminClaimWithKey(authHeader, projectId, key) {
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

  if (payload.admin !== true) {
    const forbiddenErr = new Error('Admin yetkisi bulunamadı');
    forbiddenErr.isForbidden = true;
    forbiddenErr.uid = uid;
    throw forbiddenErr;
  }

  return { uid, payload };
}

// Worker router simülatörü
async function handleWorkerRequest(request, env, customKey = publicKey) {
  const corsHeaders = getCorsHeaders(request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  const url = new URL(request.url);

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

  return jsonResponse({ error: 'NOT_FOUND' }, 404, corsHeaders);
}

// Frontend Route Guard Mantık Simülasyonu
function simulateRouteGuard({ user, isAdmin, initializing, targetPath }) {
  if (initializing) return 'LOADING';
  if (!user) return '/login';
  if (!user.emailVerified) return '/verify-email';
  if (user?.profile?.isDeleting === true) return 'DELETION_MODAL';

  if (targetPath === '/admin') {
    if (!isAdmin) return '/'; // Sessizce anasayfaya yönlendir
    return '/admin (GÖSTERİLDİ)';
  }

  return targetPath;
}

async function runAllTests() {
  console.log('====================================================');
  console.log('🧪 J-PLANNING FAZ 1 GÜVENLİK VE ENDPOINT TESTLERİ');
  console.log('====================================================\n');

  const env = {
    TURSO_ORG: 'ysftrasci',
    TURSO_GROUP: 'jplanning',
    FIREBASE_PROJECT_ID: 'j-planning',
    ALLOWED_ORIGINS: 'http://localhost:5173',
  };

  // 1. CORS Preflight Testi
  console.log('1️⃣ [OPTIONS /admin/ping] CORS Preflight Testi');
  const corsReq = new Request('http://localhost/admin/ping', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'GET',
    },
  });
  const corsRes = await handleWorkerRequest(corsReq, env);
  assert.strictEqual(corsRes.status, 204);
  assert.strictEqual(corsRes.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173');
  console.log('   ✅ HTTP 204 No Content, CORS Headers OK.\n');

  // 2. Tokensız İstek -> 401 Unauthorized
  console.log('2️⃣ [GET /admin/ping] Tokensız İstek (Header Yok)');
  const noTokenReq = new Request('http://localhost/admin/ping', {
    method: 'GET',
    headers: { Origin: 'http://localhost:5173' },
  });
  const noTokenRes = await handleWorkerRequest(noTokenReq, env);
  const noTokenJson = await noTokenRes.json();
  assert.strictEqual(noTokenRes.status, 401);
  assert.strictEqual(noTokenJson.error, 'UNAUTHORIZED');
  console.log(`   ✅ HTTP ${noTokenRes.status} UNAUTHORIZED: "${noTokenJson.message}"\n`);

  // 3. Geçersiz Token ile İstek -> 401 Unauthorized
  console.log('3️⃣ [GET /admin/ping] Geçersiz / Bozuk Token');
  const invalidTokenReq = new Request('http://localhost/admin/ping', {
    method: 'GET',
    headers: {
      Authorization: 'Bearer invalid.fake.token',
      Origin: 'http://localhost:5173',
    },
  });
  const invalidTokenRes = await handleWorkerRequest(invalidTokenReq, env);
  const invalidTokenJson = await invalidTokenRes.json();
  assert.strictEqual(invalidTokenRes.status, 401);
  assert.strictEqual(invalidTokenJson.error, 'UNAUTHORIZED');
  console.log(`   ✅ HTTP ${invalidTokenRes.status} UNAUTHORIZED: "${invalidTokenJson.message}"\n`);

  // 4. Normal Kullanıcı Token'ı (admin: false / claimsiz) -> 403 Forbidden
  console.log('4️⃣ [GET /admin/ping] Normal Kullanıcı Token\'ı (admin: false)');
  const nonAdminToken = await new SignJWT({
    user_id: 'user_regular_101',
    email: 'ogrenci@jplanning.com',
    admin: false,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setIssuer('https://securetoken.google.com/j-planning')
    .setAudience('j-planning')
    .setExpirationTime('1h')
    .sign(privateKey);

  const nonAdminReq = new Request('http://localhost/admin/ping', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${nonAdminToken}`,
      Origin: 'http://localhost:5173',
    },
  });
  const nonAdminRes = await handleWorkerRequest(nonAdminReq, env);
  const nonAdminJson = await nonAdminRes.json();
  assert.strictEqual(nonAdminRes.status, 403, 'Admin olmayan kullanıcı 403 Forbidden almalıdır');
  assert.strictEqual(nonAdminJson.error, 'FORBIDDEN');
  console.log(`   ✅ HTTP ${nonAdminRes.status} FORBIDDEN: "${nonAdminJson.message}"\n`);

  // 5. Admin Kullanıcı Token'ı (admin: true) -> 200 OK
  console.log('5️⃣ [GET /admin/ping] Admin Kullanıcı Token\'ı (admin: true)');
  const adminToken = await new SignJWT({
    user_id: 'admin_master_001',
    email: 'admin@jplanning.com',
    admin: true,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setIssuer('https://securetoken.google.com/j-planning')
    .setAudience('j-planning')
    .setExpirationTime('1h')
    .sign(privateKey);

  const adminReq = new Request('http://localhost/admin/ping', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      Origin: 'http://localhost:5173',
    },
  });
  const adminRes = await handleWorkerRequest(adminReq, env);
  const adminJson = await adminRes.json();
  assert.strictEqual(adminRes.status, 200, 'Admin kullanıcı 200 OK almalıdır');
  assert.strictEqual(adminJson.success, true);
  assert.strictEqual(adminJson.uid, 'admin_master_001');
  assert.strictEqual(adminJson.email, 'admin@jplanning.com');
  console.log(`   ✅ HTTP ${adminRes.status} OK: "${adminJson.message}" (UID: ${adminJson.uid}, Email: ${adminJson.email})\n`);

  // 6. Frontend Route Guard Testleri
  console.log('6️⃣ [Frontend Guard] RequireAdmin Yönlendirme Senaryoları');
  
  // Senaryo A: Giriş yapmamış kullanıcı /admin route'una giderse
  const resA = simulateRouteGuard({ user: null, isAdmin: false, initializing: false, targetPath: '/admin' });
  assert.strictEqual(resA, '/login');
  console.log('   ✅ Giriş yapmamış kullanıcı -> /login rotasına yönlendirildi.');

  // Senaryo B: Normal kullanıcı (admin değil) /admin route'una giderse
  const resB = simulateRouteGuard({
    user: { uid: 'user_regular_101', emailVerified: true },
    isAdmin: false,
    initializing: false,
    targetPath: '/admin',
  });
  assert.strictEqual(resB, '/');
  console.log('   ✅ Normal kullanıcı (admin: false) -> Sessizce "/" (Anasayfa) rotasına yönlendirildi.');

  // Senaryo C: Admin kullanıcı (admin: true) /admin route'una giderse
  const resC = simulateRouteGuard({
    user: { uid: 'admin_master_001', emailVerified: true },
    isAdmin: true,
    initializing: false,
    targetPath: '/admin',
  });
  assert.strictEqual(resC, '/admin (GÖSTERİLDİ)');
  console.log('   ✅ Admin kullanıcı (admin: true) -> "/admin" paneline başarıyla erişti.');

  console.log('\n====================================================');
  console.log('🎯 TÜM GÜVENLİK VE ROTA TESTLERİ KANITLANMIŞ VE BAŞARILI!');
  console.log('====================================================\n');
}

runAllTests().catch((err) => {
  console.error('❌ Test Başarısız:', err);
  process.exit(1);
});
