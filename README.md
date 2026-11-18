# J-Planning — Web (PWA)

Telefona yüklenebilen (PWA), Türkçe bir gün planlama ve alışkanlık uygulaması: tekrarlayan görevler, seri takibi, JP puanı ve ödüller, odaklanma kronometresi, günlük notlar ve arkadaşlarla görev paylaşımı.

## Teknolojiler

- **Ön yüz:** React 19 + Vite, react-router, PWA (service worker + manifest)
- **Kişisel veri:** Turso (bulut SQLite, `@libsql/client/web`) — her kullanıcıya ayrı veritabanı, Worker'dan alınan kısa süreli token ile erişim.
- **Misafir modu:** `sql.js` + IndexedDB — kayıt olmadan veriler yalnızca tarayıcıda tutulur; kayıt olunca buluta taşınır.
- **Sunucu:** Cloudflare Worker (`worker/`) — oturum ve token üretimi, push bildirimi gönderme, günlük hatırlatıcı (cron), yönetici uç noktaları, hesap silme.
- **Kimlik ve sosyal veri:** Firebase Authentication (e-posta/şifre) + Firestore (profil, arkadaşlık, görev/ödül atamaları).
- **Bildirimler:** Firebase Cloud Messaging.
- **Barındırma:** Netlify (`netlify.toml`; `/api/worker/*` istekleri Worker'a yönlendirilir).

## Kurulum ve Çalıştırma

```bash
# Bağımlılıkları yükleyin
npm install

# Çevre değişkenlerini ayarlayın (.env)
cp .env.example .env

# Geliştirme sunucusunu başlatın
npm run dev
```

#### Yerel Worker ile Birlikte Çalışma (Opsiyonel)

Frontend varsayılan olarak canlı Cloudflare Worker'a bağlanır. Eğer geliştirmeyi yerel worker (`wrangler dev` — `http://127.0.0.1:8787`) ile birlikte test etmek isterseniz:

```bash
# .env.local dosyanıza yerel worker hedefini tanımlayın (bkz: .env.local.example)
VITE_WORKER_PROXY_TARGET=http://127.0.0.1:8787
```

### Worker (Cloudflare) Kurulumu

```bash
cd worker
npm install

# Yerel geliştirme için .dev.vars dosyasını oluşturun (bkz: worker/README.md)
cp .dev.vars.example .dev.vars
npm run dev

# Canlı ortama deploy için
npx wrangler deploy
```

### Diğer komutlar

```bash
npm run lint      # oxlint
npm run build     # üretim derlemesi (dist/)
```

### Canlıya alma

Üç ayrı adımdır:

1. **Worker:** `cd worker` → `npx wrangler deploy`
2. **Firestore kuralları:** proje kökünde `node scripts/deploy-rules.mjs` (Firebase servis hesabı anahtarı gerekir; anahtar depoya girmez)
3. **Site:** Netlify deploy

Her yayında `public/sw.js` içindeki `CACHE_NAME` sürümü artırılmalıdır.

## Özellikler

- **Görevler:** Günlük / haftalık / aylık ve "N günde bir" tekrarlayan ya da tek seferlik görevler; öncelik veya zorluk, kategori, alt adımlar, geçmişe dönük işaretleme, seri ve tamamlanma oranı.
- **JP ve ödüller:** Görev tamamlayınca JP kazanılır, kullanıcının tanımladığı ödüllere harcanır; cüzdan hareket geçmişi.
- **Odaklanma:** Yukarı sayan kronometre, ortam sesleri, belirli sürelerde JP ödülü, aylık geçmiş.
- **Günlük notlar:** Günün notu, çalışma süresi, aylık arşiv.
- **Sosyal:** Kullanıcı kodu veya davet linkiyle arkadaş ekleme, arkadaşa görev/ödül atama, "Attıklarım" sayfasında ilerleme takibi.
- **Bildirimler:** Arkadaşlık ve atama bildirimleri, günlük hatırlatıcı, cihaza özel zamanlamalar.
- **Profil:** Açık/koyu tema, JSON yedek indirme/yükleme, hesap silme.
- **Yönetici paneli** (`/admin`): yalnızca yetkili hesaplar.

## Proje Yapısı

```
J-Planning-Web/
├── schema.sql              Kullanıcı veritabanı şeması (Turso / SQLite)
├── firestore.rules         Firestore güvenlik kuralları
├── scripts/                Kural deploy'u ve yönetici betikleri
├── public/                 sw.js, manifest, ikonlar
├── worker/                 Cloudflare Worker
│   ├── src/index.js        Worker giriş noktası (oturum, push, hatırlatıcı, admin)
│   └── wrangler.jsonc      Cloudflare Worker yapılandırması
├── src/
│   ├── theme.css           Renk, tipografi, spacing tanımları (CSS custom properties)
│   ├── services/           Firebase bağlantısı, arkadaşlık, görev atama,
│   │                       bildirimler, veri yedekleme (.json), sesler
│   ├── context/            AuthContext (oturum durumu, profil senkronu, DB başlatma)
│   ├── db/                 Turso bağlantı katmanı, repository'ler ve migrasyon
│   │   ├── sqliteEngine.js         TursoConnection (@libsql/client/web) motoru
│   │   ├── database.js             initDatabase, token yönetimi, session önbellekleme
│   │   ├── localSqliteEngine.js    Misafir modu (sql.js + IndexedDB)
│   │   ├── migrationService.js     Misafir verisini Turso'ya taşıma
│   │   ├── taskRepository.js       Görevler, periyot kayıtları ve cüzdan işlemleri
│   │   ├── categoryRepository.js   Kategori yönetimi
│   │   ├── rewardRepository.js     Ödül hedefleri
│   │   ├── dailyNoteRepository.js  Günlük notlar ve çalışma süreleri
│   │   ├── focusSessionRepository.js  Odaklanma seans geçmişi
│   │   └── userProfileRepository.js   Firestore kullanıcı profili önbellek işlemleri
│   ├── components/         Ortak UI bileşenleri (AppButton, AppModal, TaskCard, ...)
│   ├── router/             Sayfa yönlendirme (AppRouter, AppLayout) + auth koruması
│   └── pages/              Sayfa bileşenleri (görevler, kategoriler, ödüller,
│                           arkadaşlar, odaklanma, profil, ayarlar, admin, ...)
```
