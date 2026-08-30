#!/usr/bin/env node

/**
 * J-Planning — Firebase Admin Custom Claim Atama Betiği
 * 
 * Belirtilen e-posta veya UID'ye { admin: true } özel yetkisi (custom claim) atar.
 * 
 * Gereksinim:
 *   Firebase Console -> Project Settings -> Service Accounts -> "Generate new private key"
 *   İndirilen dosyayı proje köküne "serviceAccountKey.json" adıyla kaydedin (.gitignore'a eklidir).
 * 
 * Kullanım:
 *   node scripts/set-admin-claim.js --email=admin@example.com
 *   node scripts/set-admin-claim.js --uid=USER_UID
 *   node scripts/set-admin-claim.js --email=user@example.com --revoke
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const args = process.argv.slice(2);
  const emailArg = args.find((a) => a.startsWith('--email='))?.split('=')[1];
  const uidArg = args.find((a) => a.startsWith('--uid='))?.split('=')[1];
  const isRevoke = args.includes('--revoke') || args.includes('--remove');
  const serviceAccountPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.resolve(__dirname, '../serviceAccountKey.json');

  if (!emailArg && !uidArg) {
    console.error('❌ HATA: Lütfen bir e-posta veya UID belirtin.');
    console.log('   Kullanım: node scripts/set-admin-claim.js --email=admin@example.com');
    console.log('             node scripts/set-admin-claim.js --uid=FIREBASE_UID');
    console.log('             node scripts/set-admin-claim.js --email=admin@example.com --revoke');
    process.exit(1);
  }

  if (!fs.existsSync(serviceAccountPath)) {
    console.error(`❌ HATA: Firebase servis hesabı anahtarı bulunamadı: ${serviceAccountPath}`);
    console.log('\n📌 Nasıl Alınır?');
    console.log('1. Firebase Console (https://console.firebase.google.com) -> Proje Ayarları -> Service accounts sekmesine gidin.');
    console.log('2. "Generate new private key" butonuna tıklayıp indirin.');
    console.log('3. İndirdiğiniz dosyayı proje kök dizinine "serviceAccountKey.json" adıyla kaydedin.');
    process.exit(1);
  }

  let admin;
  try {
    const adminModule = await import('firebase-admin');
    admin = adminModule.default || adminModule;
  } catch (err) {
    console.error('❌ HATA: firebase-admin paketi bulunamadı.');
    console.log('   Lütfen "npm install -D firebase-admin" komutunu çalıştırın.');
    process.exit(1);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  let targetUid = uidArg;
  if (!targetUid && emailArg) {
    try {
      const userRecord = await admin.auth().getUserByEmail(emailArg);
      targetUid = userRecord.uid;
      console.log(`👤 Kullanıcı bulundu: ${userRecord.email} (UID: ${targetUid})`);
    } catch (err) {
      console.error(`❌ Kullanıcı bulunamadı (${emailArg}):`, err.message);
      process.exit(1);
    }
  }

  const existingClaims = (await admin.auth().getUser(targetUid)).customClaims || {};

  if (isRevoke) {
    const updatedClaims = { ...existingClaims };
    delete updatedClaims.admin;
    await admin.auth().setCustomUserClaims(targetUid, updatedClaims);
    console.log(`✅ [${targetUid}] kullanıcısının admin yetkisi kaldırıldı.`);
  } else {
    const updatedClaims = { ...existingClaims, admin: true };
    await admin.auth().setCustomUserClaims(targetUid, updatedClaims);
    console.log(`👑 [${targetUid}] kullanıcısına "admin: true" yetkisi başarıyla atandı!`);
  }

  console.log('\n💡 ÖNEMLİ BİLGİ:');
  console.log('Admin yetkisinin tarayıcıda hemen geçerli olması için kullanıcının çıkış yapıp tekrar girmesi veya token yenilemesi gerekir.');
}

main().catch((err) => {
  console.error('❌ Beklenmeyen hata:', err);
  process.exit(1);
});
