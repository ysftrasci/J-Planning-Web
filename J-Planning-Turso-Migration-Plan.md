# J-Planning Web — Kişisel Veri Katmanını Turso'ya Taşıma Projesi

## AI Ajanı İçin Genel Talimatlar (LÜTFEN ÖNCE BUNU OKU)

Bu doküman, **J-Planning-Web** adlı bir React/Vite projesinin veri mimarisini
değiştirmek için hazırlanmış, adım adım uygulanacak bir plandır. Sen (yapay
zeka ajanı) bu planı **sırasıyla, hiçbir adımı atlamadan** uygulayacaksın.

### Kesin Kurallar (bunları asla ihlal etme)

1. **HİÇBİR ücretli servis, ücretli plan, kredi kartı isteyen adım önerme
   veya uygulama.** Bu projenin tek ve en önemli kısıtı budur. Firebase
   Blaze, Firebase Cloud Functions, Cloudinary'nin ücretli planları, Turso'nun
   ücretli planı, Cloudflare Workers Paid planı — bunların HİÇBİRİ
   kullanılmayacak. Sadece ücretsiz (free tier) katmanlar kullanılacak.
2. **Firebase Authentication'a DOKUNMA.** `src/services/firebase.js` ve
   `src/context/AuthContext.jsx` içindeki auth mantığı (e-posta doğrulama,
   oturum açma/kapama, `onAuthStateChanged`) olduğu gibi kalacak.
3. **Firestore'daki şu koleksiyonlara DOKUNMA:** `users`, `userCodes`,
   `friendships`, `assignedTasks`, `assignedRewards`. Bunlar "sosyal/paylaşılan
   veri" katmanıdır ve bu migrasyonun kapsamı dışındadır.
4. **Sadece şu değişecek:** Şu anda tarayıcıda `sql.js` + `IndexedDB` ile
   tutulan KİŞİSEL veri (görevler, kategoriler, ödüller, cüzdan, odaklanma
   seansları, günlük notlar) artık bulutta, **Turso** adlı SQLite-uyumlu bir
   veritabanı servisinde tutulacak.
5. **Emin olmadığın bir API, bir kütüphane fonksiyonu, bir fiyatlandırma
   rakamı varsa UYDURMA.** Resmi dokümantasyonu (Turso docs, Cloudflare
   Workers docs, `@libsql/client` npm sayfası) kontrol et. Kontrol
   edemiyorsan, kullanıcıya (bana) sor ve o adımda dur.
6. **Her fazın sonunda çalışan bir uygulama olmalı.** Büyük patlamalı
   (big-bang) bir geçiş yapma. Fazları sırayla tamamla, her fazdan sonra
   test et, sonra bir sonraki faza geç.
7. **Var olan hiçbir kullanıcı verisini kaybetme.** Faz 6'da (veri taşıma)
   özellikle dikkatli ol — geri dönüşü olmayan silme işlemlerinden önce her
   zaman yedek al ve bana onaylat.
8. **Değişiklik yapmadan önce ilgili dosyanın güncel halini oku.** Bu
   dokümandaki kod parçaları YÖN GÖSTERİCİDİR, birebir kopyala-yapıştır
   değildir. Gerçek dosyadaki güncel isimlendirme/yapıyla uyumlu hale getir.
9. Her faz bittiğinde bana (kullanıcıya) kısa bir özet ver: ne yaptın, ne
   test ettin, bir sonraki fazda ne olacak. Onay almadan bir sonraki faza
   geçme.

---

## 1. Proje Bağlamı (Context)

### 1.1 Bu proje ne?

J-Planning-Web, günlük hayatı planlama (görev, kategori, ödül, odaklanma
modu, arkadaşlarla görev paylaşımı) sunan bir React 19 + Vite 8 web
uygulaması. Firebase üzerine kurulu. Şu an tek geliştirici tarafından
geliştiriliyor, "arkadaş çevresi" ölçeğinden "herkese açık" ölçeğe
geçiriliyor.

### 1.2 Mevcut mimari (migrasyon ÖNCESİ)

```
┌─────────────────────────────────────────────────────────┐
│                     Tarayıcı (Client)                     │
│                                                             │
│  Firebase Auth ──────► kimlik doğrulama (DEĞİŞMEYECEK)    │
│                                                             │
│  Firestore ───────────► profil, arkadaşlık, atanan         │
│                          görev/ödül (DEĞİŞMEYECEK)          │
│                                                             │
│  sql.js (WASM) + IndexedDB ──► KİŞİSEL veri:               │
│                          görevler, kategoriler, ödüller,    │
│                          cüzdan, odaklanma seansları,       │
│                          günlük notlar                      │
│                          (BU KATMAN DEĞİŞECEK → Turso)      │
│                                                             │
│  cloudSyncService.js ──► sql.js verisini Firestore'a       │
│                          checksum'lı yedekleme/senkron      │
│                          (BU MEKANİZMA SADELEŞTİRİLECEK)    │
└─────────────────────────────────────────────────────────┘
```

### 1.3 Hedef mimari (migrasyon SONRASI)

```
┌─────────────────────────────────────────────────────────┐
│                     Tarayıcı (Client)                     │
│                                                             │
│  Firebase Auth ──────► kimlik doğrulama (DEĞİŞMEDİ)        │
│                                                             │
│  Firestore ───────────► profil, arkadaşlık, atanan         │
│                          görev/ödül (DEĞİŞMEDİ)             │
│                                                             │
│  @libsql/client ──────► KİŞİSEL veriyi doğrudan Turso'daki │
│                          kullanıcıya özel veritabanına      │
│                          okur/yazar (YENİ)                  │
└──────────────────────────┬──────────────────────────────┘
                            │ (1) Firebase ID token gönderir
                            ▼
                ┌───────────────────────────┐
                │   Cloudflare Worker (YENİ)  │
                │  - Firebase ID token'ı      │
                │    doğrular (JWT verify)    │
                │  - Kullanıcının Turso        │
                │    veritabanı yoksa oluşturur│
                │  - Kapsamı sınırlı, kısa     │
                │    ömürlü bir Turso token'ı  │
                │    üretip döner              │
                └──────────────┬────────────┘
                               │ (2) DB URL + scoped token döner
                               ▼
                ┌───────────────────────────┐
                │   Turso (YENİ)              │
                │  Her kullanıcı için ayrı     │
                │  bir SQLite veritabanı       │
                │  (jplanning-user-{uid})     │
                └───────────────────────────┘
```

**Neden doğrudan tarayıcıdan Turso'ya bağlanmıyoruz?** Çünkü Turso'da yeni
bir veritabanı oluşturmak ve ona erişim token'ı üretmek için "platform API
token" adında güçlü yetkili bir anahtar gerekiyor. Bu anahtar ASLA tarayıcı
koduna (client-side) konulamaz — konulursa herkes onu görüp tüm
kullanıcıların veritabanlarına erişebilir. Bu yüzden bu işlemi yapacak,
güvenli bir yerde (Cloudflare Worker) çalışan küçük bir aracıya ihtiyacımız
var. Cloudflare Workers, Firebase Cloud Functions'ın aksine **kredi kartı
istemeden** bu işi görür.

### 1.4 Neden Firebase Cloud Functions kullanmıyoruz?

Çünkü Firebase Cloud Functions, kullanım miktarı ne olursa olsun, Blaze
(ödemeli) plana geçişi ve kredi kartı kaydını ZORUNLU kılıyor. Bu projenin
en önemli kısıtı (kart girmemek) buna izin vermiyor. Cloudflare Workers'ın
ücretsiz planı ise kredi kartı istemeden günlük 100.000 isteğe kadar
çalışıyor — bizim ihtiyacımız için fazlasıyla yeterli.

---

## 2. Mevcut Veri Şeması (Referans)

Aşağıdaki tablolar şu anda `src/db/database.js` içindeki `initDatabase(uid)`
fonksiyonunda tanımlı. Turso'ya taşırken bu şema BİREBİR korunacak (sütun
isimleri, tipleri, foreign key'ler, unique kısıtlar dahil):

- `categories` (id, name, color, createdAt)
- `tasks` (id, title, description, categoryId, priority, period,
  ownerUserId, assignedByUserId, assignedByName, assignedToUserId,
  assignedToName, assignmentDirection, firestoreAssignmentId,
  assignmentStatus, subtaskCount, subtaskLabels, isArchived, createdAt)
- `task_records` (id, taskId, periodKey, status, completedSubtasks,
  completedAt, isLateMarked, lateMarkedAt, jpEarned, streakBonusEarned)
- `wallet` (userId, balance)
- `wallet_transactions` (id, userId, amount, reason, relatedTaskId,
  relatedRewardId, createdAt)
- `rewards` (id, title, description, cost, ownerUserId, assignedByUserId,
  assignedByName, assignmentStatus, isRedeemed, redeemedAt, createdAt)
- `friends` (id, friendUserId, friendDisplayName, friendCode, status,
  createdAt)
- `focus_sessions` (id, durationMinutes, soundKey, jpEarned, monthKey,
  completedAt)
- `task_study_logs` (id, taskId, periodKey, studyTimeText, createdAt,
  updatedAt)
- `daily_notes` (id, dateKey, content, createdAt, ...)

**Görev:** `src/db/database.js` dosyasının TAMAMINI oku ve şemanın geri
kalanını (daily_notes tablosunun tam hali ve varsa gördüğün başka
tablolar/index'ler/migration mantığı) çıkar. `CURRENT_SCHEMA_VERSION`
değişkenine ve varsa migration (ALTER TABLE) bloklarına özellikle dikkat et.

---

## 3. Etkilenen Dosyaların Listesi (Referans)

Bu dosyalar bu migrasyondan doğrudan etkilenecek:

| Dosya | Şu anki rolü | Bu migrasyondaki değişim |
|---|---|---|
| `src/db/sqliteEngine.js` | sql.js + IndexedDB motoru | Turso client'a dönüşecek |
| `src/db/database.js` | Şema oluşturma, `initDatabase(uid)` | Turso bağlantısı kuracak şekilde güncellenecek |
| `src/db/taskRepository.js` | Görev CRUD işlemleri | Sync çağrılar async'e çevrilecek |
| `src/db/categoryRepository.js` | Kategori CRUD | Sync çağrılar async'e çevrilecek |
| `src/db/rewardRepository.js` | Ödül CRUD | Sync çağrılar async'e çevrilecek |
| `src/db/focusSessionRepository.js` | Odaklanma seansı CRUD | Sync çağrılar async'e çevrilecek |
| `src/db/dailyNoteRepository.js` | Günlük not CRUD | Sync çağrılar async'e çevrilecek |
| `src/context/AuthContext.jsx` | `initDatabase(uid)` çağrısı | Turso oturum/token akışı eklenecek |
| `src/services/cloudSyncService.js` | Firestore'a yedekleme/senkron | Sadeleştirilecek/kısmen kaldırılacak |
| `src/db/userProfileRepository.js` | Firestore profil işlemleri | **DOKUNULMAYACAK** |

**Görev:** Bu tabloyu referans al ama listelenmeyen başka dosyalarda da
`getDb()`, `execSync`, `runSync`, `getFirstSync`, `getAllSync` çağrısı olup
olmadığını proje genelinde ara (`grep -rn "Sync(" src/`). Bulduğun her
kullanım yeri güncellenmesi gereken bir yerdir.

---

## FAZ 0 — Hazırlık ve Hesap Açma

**Amaç:** Gerekli tüm hesapları kartsız şekilde açmak.

### Adımlar

1. `turso.tech` üzerinden ücretsiz bir hesap oluştur (GitHub ile giriş
   yapılabilir). Kredi kartı istenmediğini doğrula. İstenirse DURUP bana
   haber ver.
2. Turso CLI'ı kur:
   ```bash
   curl -sSfL https://get.tur.so/install.sh | bash
   ```
   Kurulumdan sonra `turso --version` ile doğrula.
3. Turso CLI ile giriş yap: `turso auth login`
4. `dash.cloudflare.com` üzerinden ücretsiz bir Cloudflare hesabı oluştur.
   Kredi kartı istenmediğini doğrula.
5. Cloudflare Workers CLI aracı olan **Wrangler**'ı kur (proje bağımlılığı
   olarak, global değil):
   ```bash
   npm install --save-dev wrangler
   ```
6. Bu adımların hepsi tamamlandığında bana şunu raporla: hangi hesaplar
   açıldı, hangi CLI araçları kuruldu, herhangi bir yerde kredi kartı
   istenip istenmediği.

**DUR ve bana raporla. Onay almadan Faz 1'e geçme.**

---

## FAZ 1 — Turso Veritabanı Yapısını Tasarlama

**Amaç:** "Kullanıcı başına bir veritabanı" mimarisini Turso'da kurmak.

### Kavramsal arka plan

Turso'da bir **organizasyon** (senin hesabın) altında birden fazla
**veritabanı grubu (database group)** olabilir, her grubun altında da
birden fazla **veritabanı** olabilir. Biz şu yaklaşımı kullanacağız:

- Tek bir grup oluştur: `jplanning`
- Bu grup İÇİNDE, yeni kayıt olan her kullanıcı için otomatik olarak yeni
  bir veritabanı oluşturulacak (isimlendirme: `jplanning-user-{uid}` —
  `{uid}` Firebase kullanıcı ID'sinin güvenli karakterlere indirgenmiş hali,
  tıpkı mevcut kodun `dbNameForUser` fonksiyonundaki mantığı gibi).
- Bu otomatik oluşturma işlemi FAZ 3'te yazılacak Cloudflare Worker
  tarafından, Turso'nun **Platform API**'si kullanılarak yapılacak (elle
  CLI'dan tek tek değil — çünkü yeni kullanıcılar sürekli kayıt olacak).

### Adımlar

1. Manuel olarak (CLI ile) bir test grubu oluştur:
   ```bash
   turso group create jplanning
   ```
2. Bu grup içinde, şemayı test etmek için manuel bir test veritabanı oluştur:
   ```bash
   turso db create jplanning-test-schema --group jplanning
   ```
3. `src/db/database.js` içindeki `initDatabase` fonksiyonundaki TÜM
   `CREATE TABLE IF NOT EXISTS` ifadelerini (Bölüm 2'de listelenen tüm
   tablolar) bu test veritabanına uygula:
   ```bash
   turso db shell jplanning-test-schema < schema.sql
   ```
   (Önce `database.js`'teki SQL'i ayrı bir `schema.sql` dosyasına çıkar.)
4. Şemanın doğru kurulduğunu doğrula:
   ```bash
   turso db shell jplanning-test-schema ".tables"
   ```
5. Turso'da bir **Platform API Token** (organizasyon düzeyinde, veritabanı
   oluşturma/silme yetkisi olan) üret:
   ```bash
   turso auth api-tokens mint jplanning-worker-token
   ```
   **BU TOKEN'I ASLA GİT'E COMMIT ETME, ASLA CLIENT-SIDE KODA KOYMA.**
   Bunu bir sonraki fazda Cloudflare Worker'ın "secret" (gizli ortam
   değişkeni) olarak saklayacağız.
6. Organizasyon adını (`turso org list` ile görebilirsin) not al, Faz 3'te
   lazım olacak.

**DUR ve bana raporla:** grup adı, test veritabanı şeması doğru kuruldu mu,
platform API token üretildi mi (token'ın kendisini bana YAPIŞTIRMA, sadece
"üretildi" de).

---

## FAZ 2 — `@libsql/client` Kütüphanesini Projeye Ekleme

**Amaç:** Tarayıcıdan Turso'ya bağlanabilmek için gereken resmi istemci
kütüphanesini kurmak.

### Adımlar

1. Projeye kütüphaneyi ekle:
   ```bash
   npm install @libsql/client
   ```
2. `@libsql/client`'ın tarayıcı (web) ortamında çalışan versiyonunun doğru
   şekilde import edildiğinden emin ol. Resmi dokümantasyonu kontrol et:
   tarayıcı için `@libsql/client/web` alt-paketi gerekebilir. Bunu UYDURMA,
   npm sayfasından veya resmi Turso dokümantasyonundan doğrula.
3. Basit bir bağlantı testi yap (geçici bir test dosyasında): sabit kodlanmış
   (Faz 1'de oluşturduğun test veritabanının) URL ve bir geçici tam yetkili
   token ile bağlanıp `SELECT 1` çalıştır. Bu SADECE bir bağlantı testidir,
   gerçek uygulama akışına dahil etme.
4. Test başarılıysa, test dosyasını sil.

**DUR ve bana raporla:** kütüphane kuruldu mu, test bağlantısı başarılı
oldu mu, hangi import yolunu kullandın.

---

## FAZ 3 — Cloudflare Worker: Kimlik Doğrulama + Veritabanı Sağlama Servisi

**Amaç:** Kullanıcının Firebase kimliğini doğrulayıp, ona ait Turso
veritabanını (yoksa oluşturarak) bulup, kapsamı sınırlı bir erişim token'ı
üreten bir servis kurmak.

### 3.1 Proje yapısı

Ana React projesinin İÇİNE değil, YANINA (örn. proje kök dizininde
`worker/` adlı ayrı bir klasöre) yeni bir Node.js projesi oluştur:

```
J-Planning-Web/
├── src/                  (mevcut React uygulaması — dokunulmayacak)
├── worker/               (YENİ — Cloudflare Worker projesi)
│   ├── src/
│   │   └── index.js      (Worker'ın ana kodu)
│   ├── wrangler.toml     (Worker yapılandırması)
│   └── package.json
└── ...
```

### 3.2 Worker'ın kurulumu

1. `worker/` klasörünü oluştur, içine gir.
2. Wrangler ile boş bir Worker projesi başlat:
   ```bash
   npm create cloudflare@latest . -- --type=hello-world
   ```
   (Resmi Cloudflare Workers dokümantasyonundaki güncel komutu kontrol et,
   bu komut zamanla değişebilir.)
3. Firebase ID token'ını doğrulamak için gereken kütüphaneyi ekle. İki
   seçenek var, resmi dokümantasyonlarını kontrol edip Cloudflare Workers
   (V8 isolate, Node.js API'lerinin tamamı yok) ortamıyla uyumlu olanı seç:
   - `jose` (genel amaçlı JWT doğrulama kütüphanesi, Workers'ta çalıştığı
     bilinen bir kütüphane) — Firebase'in genel anahtarlarını
     `https://www.googleapis.com/robot/v1/metadata/x509/[email protected]`
     adresinden çekip JWT imzasını buna karşı doğrulayacak şekilde
     kullanılabilir.
   - Firebase Admin SDK'nın Workers-uyumlu bir portu (varsa).
   Bu konuda emin değilsen UYDURMA, "jose ile Firebase ID token doğrulama
   Cloudflare Workers" şeklinde güncel dokümantasyon/örnek ara.
4. Turso'ya bağlanmak için `@libsql/client` kütüphanesini worker projesine
   de ekle (Platform API çağrıları için ayrıca düz `fetch` ile Turso
   Platform API'sine HTTP isteği atman gerekecek, bu bir REST API'dir).

### 3.3 Worker'ın yapması gerekenler (mantıksal akış)

Worker'da tek bir endpoint olacak: `POST /session`

**Girdi:** İstek başlığında (`Authorization: Bearer <firebase-id-token>`)
Firebase ID token'ı.

**Adımlar (Worker içinde):**

1. Gelen Firebase ID token'ını doğrula (imza, süre, `aud`/`iss` alanları
   projenin Firebase proje ID'siyle eşleşiyor mu). Doğrulama başarısızsa
   401 dön.
2. Token doğruysa, içinden kullanıcının `uid`'ini çıkar.
3. Turso Platform API'sini kullanarak, `jplanning-user-{uid}` isimli bir
   veritabanı olup olmadığını kontrol et.
   - **Varsa:** doğrudan bir sonraki adıma geç.
   - **Yoksa:** Turso Platform API ile bu grupta yeni bir veritabanı
     oluştur, ardından Faz 1'de hazırladığın şemayı (tüm `CREATE TABLE`
     ifadelerini) bu yeni veritabanına uygula. (Bu şemayı Worker kodunun
     içine bir sabit metin/string olarak göm, ya da Faz 1'deki test
     veritabanını "şablon" olarak kopyalayan bir Turso özelliği varsa
     resmi dokümantasyondan kontrol edip onu kullan.)
4. Bu veritabanı için, SADECE bu veritabanına erişimi olan, kısa ömürlü
   (örn. 1 saat geçerli) bir Turso erişim token'ı üret (Turso Platform
   API'sinin token üretme uç noktasını kullan — "kapsamı veritabanına
   sınırlı token" resmi dokümantasyonda nasıl isimlendiriliyor, öğrenip
   ona göre uygula, uydurma).
5. Yanıt olarak şunu JSON formatında dön:
   ```json
   {
     "dbUrl": "libsql://jplanning-user-XXXX-<org-adı>.turso.io",
     "token": "<kısa ömürlü, veritabanına özel token>",
     "expiresAt": 1234567890
   }
   ```

### 3.4 Gizli bilgilerin saklanması

Turso Platform API token'ını Worker'ın koduna YAZMA. Wrangler'ın "secret"
mekanizmasını kullan:
```bash
npx wrangler secret put TURSO_PLATFORM_TOKEN
```
(Terminal senden değeri isteyecek, orada Faz 1'de ürettiğin token'ı gir.)

### 3.5 CORS ayarı

Worker, sadece J-Planning-Web'in çalıştığı domain'den (geliştirme sırasında
`localhost`, canlıda gerçek domain) gelen isteklere izin vermeli. Worker
kodunda uygun CORS başlıklarını (`Access-Control-Allow-Origin` vb.) ekle,
`*` (herkese açık) KULLANMA.

### 3.6 Test

1. Worker'ı lokal olarak çalıştır: `npx wrangler dev`
2. Gerçek bir Firebase ID token'ı (uygulamadan giriş yapıp tarayıcı
   konsolundan `await auth.currentUser.getIdToken()` ile alabilirsin) ile
   Worker'a bir istek at (örn. `curl` veya Postman ile).
3. Yanıtın beklenen formatta döndüğünü, gerçekten yeni bir Turso
   veritabanının oluşturulduğunu (`turso db list` ile kontrol et)
   doğrula.
4. Worker'ı Cloudflare'e deploy et: `npx wrangler deploy`

**DUR ve bana raporla:** Worker'ın URL'si, test isteğinin sonucu, yeni
veritabanının gerçekten oluşup oluşmadığı, CORS ayarının nasıl
yapılandırıldığı.

---

## FAZ 4 — İstemci Tarafı Entegrasyonu

**Amaç:** React uygulamasının artık sql.js yerine Turso'yu (Worker
üzerinden) kullanmasını sağlamak.

### 4.1 `src/db/sqliteEngine.js` dosyasının yeniden yazılması

Bu dosyanın görevi değişiyor: artık sql.js yüklemek yerine, Worker'dan
alınan bilgilerle bir `@libsql/client` bağlantısı kuracak.

**Önemli tasarım kararı:** Mevcut `SqliteConnection` sınıfı `execSync`,
`runSync`, `getFirstSync`, `getAllSync` gibi SENKRON metodlar sunuyordu.
`@libsql/client` ise ASENKRON çalışır (`await client.execute(...)`). Bu
yüzden:

- Yeni bağlantı sınıfının metodları `execAsync`, `runAsync`,
  `getFirstAsync`, `getAllAsync` gibi (Promise dönen) isimler alacak — ya
  da mevcut isimleri koruyup hepsini `async` yapacaksın (proje genelinde
  hangi deseni tercih edeceğine karar ver, ama TUTARLI ol).
- Bu değişiklik, bu metodları çağıran HER YERİN (tüm repository
  dosyalarının) güncellenmesini gerektirir. Bölüm 3'teki tabloyu referans
  al.

### 4.2 `src/db/database.js` dosyasının güncellenmesi

`initDatabase(uid)` fonksiyonu artık:
1. Kullanıcının güncel Firebase ID token'ını alacak
   (`auth.currentUser.getIdToken()`).
2. Bu token'ı Faz 3'te kurulan Worker'ın `/session` endpoint'ine gönderecek.
3. Dönen `dbUrl` ve `token` ile bir `@libsql/client` bağlantısı açacak.
4. Bu bağlantıyı `sqliteEngine.js`'teki gibi paylaşılan bir modül
   değişkeninde tutacak (`getDb()` fonksiyonu bunu dönmeye devam edecek).

Token'ın süresi dolduğunda (Faz 3'te ~1 saat dedik) otomatik olarak
Worker'dan yeni bir token isteyip bağlantıyı yenileyen bir mekanizma
ekle (örn. her istekten önce süresi kontrol et, dolmuşsa yenile).

### 4.3 Repository dosyalarının güncellenmesi

Şu dosyaların HER BİRİNİ aç, içindeki `execSync`/`runSync`/`getFirstSync`/
`getAllSync` çağrılarının hepsini yeni async metodlara çevir, bu
fonksiyonları çağıran YUKARI KATMANDAKİ (sayfa/component) kodların da
`await` ile çağırdığından emin ol:

- `src/db/taskRepository.js` (en büyük dosya, 662 satır — dikkatli ol)
- `src/db/categoryRepository.js`
- `src/db/rewardRepository.js`
- `src/db/focusSessionRepository.js`
- `src/db/dailyNoteRepository.js`

**Bu dosyaları çağıran sayfaları da bul ve güncelle:**
```bash
grep -rln "taskRepository\|categoryRepository\|rewardRepository\|focusSessionRepository\|dailyNoteRepository" src/pages src/components src/context
```
Bulduğun her dosyada, artık async olan repository fonksiyonlarının
`await` ile çağrıldığından, çağıran fonksiyonların da gerekiyorsa `async`
işaretlendiğinden emin ol.

### 4.4 `AuthContext.jsx` güncellemesi

`src/context/AuthContext.jsx` içinde `initDatabase(firebaseUser.uid)`
çağrısı zaten `await` ile yapılıyor (mevcut kodda böyle). Bu satırın
davranışı aynı kalacak, sadece `initDatabase` fonksiyonunun İÇİ
değişiyor (Turso'ya bağlanacak şekilde). Bu dosyada başka bir değişikliğe
muhtemelen gerek yok — ama dosyayı oku ve emin ol.

**Test:** Bu fazın sonunda uygulama tamamen çalışır durumda olmalı: giriş
yap, yeni görev ekle, tamamla, kategori oluştur — hepsi artık Turso'ya
yazıyor olmalı. `turso db shell jplanning-user-{uid}` ile veritabanına
girip verinin gerçekten oraya yazıldığını doğrula.

**DUR ve bana raporla:** hangi dosyalar değişti, hangi testleri yaptın,
karşılaştığın hatalar oldu mu.

---

## FAZ 5 — Var Olan Kullanıcı Verilerinin Taşınması

**Amaç:** Migrasyon öncesi kayıt olmuş kullanıcıların, tarayıcılarındaki
(IndexedDB) veya Firestore'daki (`users/{uid}/user_backup`) yedeklenmiş
verilerinin kaybolmamasını sağlamak.

**ÖNEMLİ:** Bu faza geçmeden önce bana şunu sor: "Şu anda kaç kayıtlı
kullanıcı var, hepsinin verisini taşımak mı istiyorsun yoksa bu ilk
sürümde sıfırdan mı başlıyoruz?" Eğer proje henüz canlıya alınmadıysa ve
gerçek kullanıcı verisi yoksa, BU FAZI ATLA ve doğrudan Faz 6'ya geç.

### Eğer taşınacak gerçek kullanıcı verisi varsa:

1. `src/services/cloudSyncService.js` dosyasını oku, Firestore'daki
   `user_backup` alt koleksiyonunun tam veri formatını (hangi tablo
   verisi nasıl bir JSON yapısında saklanıyor) çıkar.
2. Tek seferlik, elle çalıştırılacak bir Node.js script'i yaz (proje
   içinde geçici bir `scripts/migrate-users.js` dosyası olarak). Bu
   script:
   - Firebase Admin SDK ile (bu SADECE bir kerelik lokal script olduğu
     için, Firebase Functions gerektirmez, senin kendi bilgisayarında
     çalışır) tüm kullanıcıları listeler.
   - Her kullanıcı için `user_backup` verisini okur.
   - Faz 3'teki Worker'ın veritabanı-oluşturma mantığını (ya da doğrudan
     Turso Platform API'sini) kullanarak o kullanıcı için Turso
     veritabanını oluşturur (yoksa).
   - Firestore'dan okunan veriyi, uygun `INSERT` ifadeleriyle yeni Turso
     veritabanına yazar.
   - Her kullanıcı için işlem sonucunu (başarılı/başarısız) logla.
3. Script'i ÖNCE tek bir test kullanıcısı üzerinde dene, sonucu bana
   göster, onay al.
4. Onay sonrası tüm kullanıcılar için çalıştır.
5. Taşıma sonrası birkaç kullanıcı için (en az 2-3 tanesi) uygulamaya o
   kullanıcı olarak giriş yapıp verilerin doğru göründüğünü elle doğrula.

**DUR ve bana raporla:** kaç kullanıcı taşındı, hata alan oldu mu, doğrulama
sonucu nasıldı.

---

## FAZ 6 — `cloudSyncService.js`'in Sadeleştirilmesi

**Amaç:** Artık gereksiz hale gelen kod karmaşıklığını azaltmak.

### Dikkat

`cloudSyncService.js` içindeki mantığın BİR KISMI hâlâ gerekli olabilir —
dosyayı dikkatlice oku ve şunları ayır:

- **Artık gereksiz olan kısım:** Kişisel görev/kategori/ödül verisinin
  IndexedDB'den Firestore'a checksum'lı yedeklenmesi/senkronize edilmesi
  mantığı. Bu artık Turso'nun kendisi "tek doğruluk kaynağı" olduğu için
  gereksiz.
- **Hâlâ gerekli olabilecek kısım:** `taskAssignmentService.js` ile
  bağlantılı, arkadaşlar arası görev atama/kabul etme akışı Firestore
  üzerinden yürüyor olabilir — BUNA DOKUNMA, bu sosyal özellik
  kapsamımızın dışında.

**Görev:**
1. `cloudSyncService.js`'i satır satır oku.
2. Hangi fonksiyonların SADECE kişisel veri yedeklemesiyle ilgili olduğunu,
   hangilerinin sosyal/paylaşım özellikleriyle ilgili olduğunu ayır.
3. Bu dosyayı çağıran yerleri bul (`grep -rn "cloudSyncService" src/`).
4. Sadece kişisel veri yedeklemesiyle ilgili fonksiyonları ve bunların
   çağrıldığı yerleri KALDIR.
5. Emin olmadığın bir fonksiyonu SİLME — bana sorup onay al.

**DUR ve bana raporla:** hangi fonksiyonları kaldırdın, hangilerini
koruman gerektiğine karar verdin ve neden.

---

## FAZ 7 — Güvenlik Kontrolleri

**Amaç:** Herkese açık bir siteye uygun güvenlik seviyesine ulaşmak.

### Kontrol listesi

1. Worker'daki CORS ayarının gerçekten sadece izin verilen domain(ler)e
   açık olduğunu tekrar doğrula.
2. Turso Platform API token'ının SADECE Cloudflare Worker secret olarak
   var olduğunu, hiçbir dosyada (git geçmişi dahil) açık yazılı olmadığını
   doğrula: `git log -p | grep -i "turso"` gibi bir arama yap.
3. Worker'ın `/session` endpoint'inin, geçersiz/sahte bir Firebase token'ı
   ile çağrıldığında gerçekten 401 döndüğünü test et.
4. Bir kullanıcının, BAŞKA bir kullanıcının `uid`'sini tahmin edip onun
   veritabanına erişim token'ı alıp alamayacağını test et (almaması
   gerekiyor — çünkü token, Firebase ID token'ın İÇİNDEN çıkarılan uid'e
   göre üretiliyor, kullanıcı bunu değiştiremez).
5. `.env` dosyasının `.gitignore` içinde olduğunu doğrula (muhtemelen
   zaten öyledir, kontrol et).

**DUR ve bana raporla:** her kontrol maddesi için sonucu (geçti/geçmedi).

---

## FAZ 8 — Uçtan Uca Test

**Amaç:** Tüm sistemin gerçek kullanım senaryolarında sorunsuz çalıştığını
doğrulamak.

### Test senaryoları (hepsini elle veya otomatik test ile dene)

- [ ] Yeni kullanıcı kaydı → e-posta doğrulama → ilk giriş → Turso
      veritabanının otomatik oluşturulduğunu doğrula
- [ ] Görev oluşturma, düzenleme, silme, tamamlama
- [ ] Kategori oluşturma, düzenleme, silme
- [ ] Ödül oluşturma, satın alma (cüzdan bakiyesi düşüyor mu)
- [ ] Odaklanma seansı başlatma, tamamlama, geçmişte görünmesi
- [ ] Günlük not ekleme/düzenleme
- [ ] Arkadaşlık/görev atama akışı (Firestore tarafı — bunun HİÇ
      bozulmadığını doğrula)
- [ ] Çıkış yapıp tekrar giriş yapma — verilerin kaybolmadığını doğrula
- [ ] Farklı bir tarayıcıdan/cihazdan aynı hesaba girme — aynı verilerin
      göründüğünü doğrula (bu, Turso'ya geçişin GERÇEK KAZANCI —
      önceden bu senaryo cloudSync'e bağımlıydı, şimdi doğrudan çalışmalı)
- [ ] Hesap silme akışı (`DangerZonePage`) — kullanıcının Turso
      veritabanının da silindiğini doğrula (bu akışı da güncellemen
      gerekebilir, `deleteAccountService.js` dosyasını kontrol et)

**DUR ve bana raporla:** test sonuçlarının tam listesi, başarısız olan
varsa detayı.

---

## FAZ 9 — Yayına Alma

**Amaç:** Değişiklikleri canlı ortama almak.

### Adımlar

1. Cloudflare Worker'ın production'a deploy edildiğinden emin ol
   (`npx wrangler deploy`), production URL'sini not al.
2. React uygulamasındaki Worker URL'sini, ortam değişkeni (`.env`) olarak
   tanımla (örn. `VITE_WORKER_URL`), sabit kodlama.
3. `.env.example` dosyasını (varsa) yeni değişkenle güncelle.
4. Uygulamayı normal build/deploy sürecinle yayına al.
5. Yayın sonrası Faz 8'deki test senaryolarının bir kısmını canlı ortamda
   tekrar dene.

**DUR ve bana son bir özet raporla:** tüm migrasyonun özeti, hangi
servislerin (Firebase Auth, Firestore, Turso, Cloudflare Workers,
Cloudinary varsa) hangi amaçla kullanıldığı, hiçbirinde kredi kartı
gerekip gerekmediğinin son kontrolü.

---

## Ek A — Halüsinasyon Önleme Notları

- Turso'nun, Cloudflare Workers'ın ücretsiz plan limitleri ZAMANLA
  DEĞİŞEBİLİR. Bu dokümanda geçen "günlük 100.000 istek", "5GB depolama"
  gibi rakamları KESİN doğru kabul etme — işleme başlamadan önce ilgili
  servisin GÜNCEL resmi fiyatlandırma sayfasını kontrol et.
- `@libsql/client`'ın API'si (fonksiyon isimleri, import yolları) bu
  dokümanın yazıldığı tarihten sonra değişmiş olabilir. Kod yazmadan önce
  resmi npm sayfasını/dokümantasyonu kontrol et.
- Turso Platform API'sinin uç nokta (endpoint) isimleri, kimlik doğrulama
  yöntemi tahmin ETME — resmi Turso Platform API dokümantasyonundan
  (genelde `docs.turso.tech` altında) doğrula.
- Bir adımda "resmi dokümantasyonu kontrol et" yazıyorsa ve buna erişimin
  yoksa veya sonuç belirsizse, o adımı UYDURARAK tamamlama — bana durumu
  bildir ve nasıl ilerlemek istediğimi sor.
- Kod yazarken, projenin mevcut kod stilini (Türkçe yorum satırları,
  değişken isimlendirme kalıpları) koru.

## Ek B — Faz Sırası Özeti (Hızlı Referans)

| Faz | Ne yapılıyor | Onay gerekli mi |
|---|---|---|
| 0 | Hesap açma, CLI kurulumu | Evet |
| 1 | Turso veritabanı/şema tasarımı | Evet |
| 2 | `@libsql/client` kurulumu ve test | Evet |
| 3 | Cloudflare Worker (auth + provisioning) | Evet |
| 4 | İstemci tarafı entegrasyonu (repository'ler) | Evet |
| 5 | Var olan kullanıcı verisi taşıma | Evet (koşullu — veri yoksa atla) |
| 6 | cloudSyncService sadeleştirme | Evet |
| 7 | Güvenlik kontrolleri | Evet |
| 8 | Uçtan uca test | Evet |
| 9 | Yayına alma | Evet |
