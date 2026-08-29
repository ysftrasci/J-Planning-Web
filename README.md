# J-Planning — Web (PWA)

J-Planning'in mobil (React Native/Expo) uygulamasının web/PWA versiyonu.
Mevcut mobil projeye dokunulmadan, ayrı ve modern bir bulut SQLite altyapısıyla kurulmuştur.

## Teknolojiler

- **Framework:** React + Vite
- **Yönlendirme:** react-router-dom
- **Birincil Veritabanı (Bulut SQLite):** Turso Cloud SQLite (`@libsql/client/web`) — her kullanıcıya özel bağımsız veritabanı, scoped JWT token ile güvenli erişim.
- **Eski Veri Katmanı (Geçiş Amaçlı):** `sql.js` + `IndexedDB` — yalnızca eski sürümlerden gelen geçmiş verilerin ilk açılışta Turso'ya taşınması ve geriye dönük uyumluluk için korunmaktadır.
- **Backend / Proxy (Serverless):** Cloudflare Worker — Firebase Auth doğrulaması, kullanıcı başına Turso DB provisioning ve scoped token üretimi.
- **Sosyal Katman & Kimlik Doğrulama:** Firebase (Authentication + Firestore) — profil bilgileri, arkadaşlık sistemi ve gerçek zamanlı görev/ödül atamaları.
- **PWA:** Service worker + manifest (ana ekrana ekleme desteği)

## Kurulum ve Çalıştırma

```bash
# Bağımlılıkları yükleyin
npm install

# Çevre değişkenlerini ayarlayın (.env)
cp .env.example .env

# Geliştirme sunucusunu başlatın
npm run dev
```

### Worker (Cloudflare) Kurulumu

```bash
cd worker
npm install
npx wrangler deploy
```

## Durum

**Proje ve Turso Bulut Veritabanı Geçişi (Faz 0-6) tamamlandı.**

- **Turso Cloud SQLite Entegrasyonu:** Kullanıcı başına izole bulut veritabanı, süreli scoped JWT token güvenliği, token süresi dolmadan otomatik yenileme mekanizması.
- **Veri Migrasyonu & Bütünlük:** Eski `IndexedDB` ve `Firestore` verilerinin 10/10 tabloda %100 Primary Key denetimiyle kayıpsız taşınması.
- **Performans Optimizasyonu:** N+1 sorgu şelalesini önlemek için bellek içi indeksleme, toplu veri çekme ve görev tamamlama durumunun arayüze anında yansıtılması.
- **Kimlik Doğrulama:** E-posta/şifre ile giriş-kayıt, şifre sıfırlama, e-posta doğrulama.
- **Çekirdek Görev Sistemi:** Görev ekleme, kategoriler, alt adımlar (subtasks), geçmişe dönük işaretleme penceresi, seri (streak) takibi ve seri dondurma rozeti.
- **Ödül & Cüzdan Sistemi:** JP puan kazanımı, harcama, cüzdan hareket geçmişi, ödül hedefleri.
- **Sosyal / Arkadaşlık Sistemi:** Kullanıcı Kodu ile arkadaş ekleme, arkadaşa gerçek zamanlı görev/ödül atama.
- **Odaklanma Modu (Pomodoro):** Odaklanma seansları, ortam sesleri, aylık geçmiş.
- **Günlük Notlar:** Günün özeti, ders çalışma süresi takibi ve aylık geçmiş arşivi.
- **Profil & Ayarlar:** Profil düzenleme, bildirim ayarları, JSON veri dışa/içe aktarma, Tehlikeli Alan (hesap silme).
- **PWA & Tema:** Koyu (Dark) ve Açık (Light) tema desteği, responsive tasarım.

## Proje Yapısı

```
J-Planning-Web/
├── schema.sql              Kanonik 10 veri tablosu + app_meta SQLite şeması
├── worker/                 Cloudflare Worker (Auth doğrulama + Turso DB provisioning)
│   ├── src/index.js        Worker giriş noktası (/session endpoint)
│   └── wrangler.jsonc      Cloudflare Worker yapılandırması
├── src/
│   ├── theme.css           Renk, tipografi, spacing tanımları (CSS custom properties)
│   ├── services/           Firebase bağlantısı, arkadaşlık, görev atama,
│   │                       bildirimler, veri yedekleme (.json), sesler
│   ├── context/            AuthContext (oturum durumu, profil senkronu, DB başlatma)
│   ├── db/                 Turso bağlantı katmanı, repository'ler ve migrasyon
│   │   ├── sqliteEngine.js         TursoConnection (@libsql/client/web) motoru
│   │   ├── database.js             initDatabase, token yönetimi, session önbellekleme
│   │   ├── migrationService.js     IndexedDB/Firestore -> Turso veri taşıma servisi
│   │   ├── taskRepository.js       Görevler, periyot kayıtları ve cüzdan işlemleri
│   │   ├── categoryRepository.js   Kategori yönetimi
│   │   ├── rewardRepository.js     Ödül hedefleri
│   │   ├── dailyNoteRepository.js  Günlük notlar ve çalışma süreleri
│   │   ├── focusSessionRepository.js  Odaklanma seans geçmişi
│   │   └── userProfileRepository.js   Firestore kullanıcı profili önbellek işlemleri
│   ├── components/         Ortak UI bileşenleri (AppButton, AppModal, TaskCard, ...)
│   ├── router/             Sayfa yönlendirme (AppRouter, AppLayout) + auth koruması
│   └── pages/              Sayfa bileşenleri (görevler, kategoriler, ödüller,
│                           arkadaşlar, odaklanma, profil, ayarlar, tehlikeli alan, ...)
```
