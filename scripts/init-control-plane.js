#!/usr/bin/env node

/**
 * J-Planning — Control Plane DB Başlatma Betiği (Tek Seferlik Kurulum)
 * 
 * Bu betik:
 * 1. Turso Platform API kullanarak 'jplanning-control' veritabanını oluşturur (varsa atlar).
 * 2. worker/src/controlPlaneSchema.sql dosyasındaki tabloları ve indeksleri uygular.
 * 3. Worker'ın arka planda doğrudan bağlanabilmesi için uzun ömürlü bir auth token üretir.
 * 
 * Kullanım:
 *   TURSO_PLATFORM_TOKEN=... TURSO_ORG=ysftrasci node scripts/init-control-plane.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TURSO_ORG = process.env.TURSO_ORG || 'ysftrasci';
const TURSO_GROUP = process.env.TURSO_GROUP || 'jplanning';
const TURSO_PLATFORM_TOKEN = process.env.TURSO_PLATFORM_TOKEN;
const CONTROL_DB_NAME = 'jplanning-control';

async function main() {
  console.log('🚀 J-Planning Control Plane Kurulum Betiği Başlatılıyor...');
  console.log(`📌 Hedef DB: ${CONTROL_DB_NAME} (Org: ${TURSO_ORG}, Group: ${TURSO_GROUP})`);

  if (!TURSO_PLATFORM_TOKEN) {
    console.error('❌ HATA: TURSO_PLATFORM_TOKEN ortam değişkeni tanımlı değil.');
    console.log('   Örnek kullanım: TURSO_PLATFORM_TOKEN=your_token TURSO_ORG=ysftrasci node scripts/init-control-plane.js');
    process.exit(1);
  }

  const schemaPath = path.resolve(__dirname, '../worker/src/controlPlaneSchema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.error(`❌ HATA: Şema dosyası bulunamadı: ${schemaPath}`);
    process.exit(1);
  }
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  const headers = {
    Authorization: `Bearer ${TURSO_PLATFORM_TOKEN}`,
    'Content-Type': 'application/json',
  };

  // 1. DB Varlığını Kontrol Et
  let dbUrl = `libsql://${CONTROL_DB_NAME}-${TURSO_ORG}.turso.io`;
  const checkRes = await fetch(`https://api.turso.tech/v1/organizations/${TURSO_ORG}/databases/${CONTROL_DB_NAME}`, {
    headers,
  });

  if (checkRes.ok) {
    const data = await checkRes.json();
    const hostname = data?.database?.Hostname || data?.Hostname;
    if (hostname) dbUrl = hostname.startsWith('libsql://') ? hostname : `libsql://${hostname}`;
    console.log(`✅ ${CONTROL_DB_NAME} veritabanı zaten mevcut: ${dbUrl}`);
  } else if (checkRes.status === 404) {
    console.log(`⏳ ${CONTROL_DB_NAME} veritabanı oluşturuluyor...`);
    const createRes = await fetch(`https://api.turso.tech/v1/organizations/${TURSO_ORG}/databases`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: CONTROL_DB_NAME,
        group: TURSO_GROUP,
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error(`❌ DB oluşturulamadı (${createRes.status}):`, errText);
      process.exit(1);
    }

    const createdData = await createRes.json();
    const hostname = createdData?.database?.Hostname || createdData?.Hostname;
    if (hostname) dbUrl = hostname.startsWith('libsql://') ? hostname : `libsql://${hostname}`;
    console.log(`✅ ${CONTROL_DB_NAME} başarıyla oluşturuldu: ${dbUrl}`);
  } else {
    const errText = await checkRes.text();
    console.error(`❌ Turso durumu kontrol edilemedi (${checkRes.status}):`, errText);
    process.exit(1);
  }

  // 2. Auth Token Üret (Control Plane için)
  console.log('🔑 Control Plane için erişim token\'ı üretiliyor...');
  const tokenEndpoint = `https://api.turso.tech/v1/organizations/${TURSO_ORG}/databases/${CONTROL_DB_NAME}/auth/tokens?expiration=never&authorization=full-access`;
  const tokenRes = await fetch(tokenEndpoint, {
    method: 'POST',
    headers,
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error(`❌ Token üretilemedi (${tokenRes.status}):`, errText);
    process.exit(1);
  }

  const tokenData = await tokenRes.json();
  const dbToken = tokenData.jwt || tokenData.token;
  console.log('✅ Control Plane erişim token\'ı üretildi.');

  // 3. Şemayı Yükle
  console.log('📜 Control Plane şeması uygulanıyor...');
  const client = createClient({
    url: dbUrl,
    authToken: dbToken,
  });

  try {
    await client.executeMultiple(schemaSql);
    console.log('✅ Şema başarıyla uygulandı!');
    console.log('\n=========================================');
    console.log('🎉 Kurulum Tamamlandı!');
    console.log(`TURSO_CONTROL_DB_URL=${dbUrl}`);
    console.log(`TURSO_CONTROL_DB_TOKEN=${dbToken}`);
    console.log('=========================================\n');
    console.log('💡 İpucu: Bu değerleri Cloudflare Worker secret/vars alanına veya .dev.vars içine ekleyebilirsiniz:');
    console.log('wrangler secret put TURSO_CONTROL_DB_TOKEN');
  } catch (err) {
    console.error('❌ Şema uygulanırken hata oluştu:', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Beklenmeyen hata:', err);
  process.exit(1);
});
