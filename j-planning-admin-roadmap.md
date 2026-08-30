# J-Planning — Admin Panel Yol Haritası

## Bağlam ve Karar Alınan Mimari

- Mevcut sistem: Her kullanıcının kendi izole Turso (libSQL) veritabanı var (`jplanning-user-{uid}`), Firebase Auth ile kimlik doğrulama, tek bir Cloudflare Worker (`/session` endpoint'i) bu ilişkiyi yönetiyor.
- Admin panel **aynı React projesinde** `/admin` route'u olarak eklenecek (ayrı subdomain/proje değil).
- Kullanıcı bazlı veri izolasyonu **korunacak** — admin panel için ayrı bir **control plane** veritabanı (`jplanning-control`) eklenecek. Bu DB kullanıcı verisini kopyalamaz, sadece özet/meta bilgi tutar (kullanıcı listesi, özet istatistikler, audit log).
- Admin yetkisi **düzenleme dahil tam yetkili** olacak (kullanıcı verisini görüntüleme + düzeltme).
- Yetkilendirme: Firebase custom claims (`admin: true`) ile yapılacak.
- Her admin düzenleme işlemi **zorunlu olarak** audit log'a yazılacak (kim, ne zaman, neyi değiştirdi).
- İlk faz önceliği: kullanıcı listesi + temel istatistikler. Kullanıcı verisi düzenleme daha sonraki bir fazda gelecek.

## Bilinen Riskler (kabul edildi, faz planında ele alınacak)

1. Control plane'deki özet veriler (taskCount, jpBalance vb.) "yaklaşık/son bilinen" değerlerdir, gerçek veriyle senkron kalmayabilir — drill-down'da gerçek veri çekilerek telafi edilecek.
2. Control plane bir SPOF (tek nokta arıza) oluşturur ama yalnızca admin panelini etkiler, son kullanıcı deneyimini etkilemez.
3. Admin yetkilendirmesi zayıf kurgulanırsa ciddi güvenlik açığı oluşur (bir kullanıcı başka birinin verisine erişebilir) — bu yüzden Faz 1'de sıkı test edilecek.
4. Düzenleme yetkisi verildiği için audit log atlanamaz, zorunlu tutulacak.
5. Düzenleme yetkisi ("tam yetkili admin") kod olarak yazıldığı an, kullanıcı tabanı büyüdükçe kendiliğinden sıkılaşmaz — bunu somut bir eşiğe bağlamak gerekiyor (bkz. Faz 4 ve Faz 5 notları).
6. Admin endpoint'leri (`/admin/*`) hiçbir zaman "tüm kullanıcıları tara" tarzı toplu bir Turso DB taraması yapmamalı — bu kullanıcı sayısıyla doğru orantılı yavaşlar ve izolasyon mimarisinin avantajını boşa çıkarır. Toplu görünümler her zaman control plane'deki özet verilerle sınırlı kalmalı, kullanıcı bazlı derin veri okuma yalnızca tek bir `uid` için (Faz 3/4) yapılmalı.
7. `/session` ve `/admin/ping` gibi endpoint'lerde şu an rate limiting yok — çalınmış/sahte bir admin token'ıyla deneme-yanılma (brute force) riskine karşı bir noktada eklenmesi gerekecek (Cloudflare Rate Limiting kuralı veya basit bir KV sayaç yeterli olur).

---

## FAZ 1 — Temel Altyapı: Yetkilendirme + Control Plane DB

**Amaç:** Admin panelin güvenlik temelini ve veri kaynağını kurmak. Henüz arayüz yok, sadece altyapı.

**Kapsam:**
- [x] `jplanning-control` adında yeni bir Turso veritabanı oluştur (Turso Platform API üzerinden, worker'daki mevcut `ensureUserDatabase` mantığına benzer şekilde ama tek seferlik/statik).
- [x] Control plane şeması: `admin_users_index` (uid, email, displayName, dbName, createdAt, lastLoginAt, taskCount, jpBalance, isDisabled) ve `admin_audit_log` (id, adminUid, targetUserUid, action, detail, createdAt) tabloları.
- [x] Worker `/session` endpoint'ine, kullanıcı girişinde control plane'e upsert yapan fire-and-forget (await edilmeyen, hata olursa sessizce loglanan) bir adım ekle.
- [x] Firebase Admin SDK veya Firebase Console üzerinden kendi hesabına `admin: true` custom claim ata. **Not:** Bu işlem koda gömülmeyecek, tek seferlik elle yapılacak bir işlem olarak kalacak (ör. bir script veya Console üzerinden) — "kendi kendini admin yapan" bir endpoint asla eklenmeyecek.
- [x] Worker'a yeni bir yardımcı fonksiyon ekle: `verifyAdminClaim(authHeader)` — Firebase token'ı doğrular VE içindeki `admin: true` claim'ini kontrol eder. Claim yoksa 403 döner.
- [x] Bu fonksiyonu test etmek için basit bir `GET /admin/ping` endpoint'i ekle (sadece "admin doğrulandı mı" kontrolü yapan, veri döndürmeyen).
- [x] Frontend'de `/admin` route'unu React Router'a ekle, ama içine sadece "Admin Paneli — Yakında" yazan boş bir sayfa koy. Route guard: giriş yapmamış kullanıcı → login'e yönlendir. Giriş yapmış ama admin olmayan kullanıcı → ana sayfaya yönlendir (404 gibi davranmalı, admin route'unun varlığını belli etmemeli).

**Bitiş kriteri:** Sen giriş yapınca `/admin` sayfasını görebiliyorsun, başka bir hesapla giriş yapınca göremiyorsun. Worker'daki `/admin/ping` endpoint'i admin olmayan bir token ile 403 dönüyor.

**Test kapsamı (sadece "admin olmayan 403 alıyor" yeterli değil):**
- [x] Admin claim'i olmayan geçerli bir kullanıcı token'ı → 403.
- [x] Süresi dolmuş (expired) bir token → 401/403, çökme yok.
- [x] Manipüle edilmiş/sahte imzalı bir token → reddediliyor (401).
- [x] Authorization header'ı hiç olmayan istek → düzgün hata dönüyor (401, 500 değil).
- [x] Gerçek admin claim'i olan token → 200.

**Güvenlik notu:** `.env` dosyasında duran Turso Platform token ve Firebase key'lerin `.gitignore`'da olduğundan ve Antigravity'ye paylaşılacak repo/context'e dahil edilmediğinden emin ol. *(Doğrulandı: .gitignore ve git check-ignore ile koruma teyit edildi)*

---

## FAZ 2 — Kullanıcı Listesi ve Temel İstatistikler

**Amaç:** Senin öncelik verdiğin ana özellik: tüm kullanıcıları ve özet bilgilerini görebileceğin bir panel.

**Kapsam:**
- [x] Worker'a `GET /admin/users` endpoint'i ekle — `admin_users_index`'ten tüm kullanıcıları sayfalanmış (pagination) şekilde döndürür.
- [x] Worker'a `GET /admin/stats` endpoint'i ekle — toplam kullanıcı sayısı, aktif kullanıcı sayısı (son 7/30 gün), toplam görev sayısı (control plane'deki sayaçların toplamı) gibi genel özetler döndürür.
- [x] Frontend: `/admin` altına gerçek bir layout kur (basit bir sidebar/tab yapısı: Kullanıcılar, İstatistikler).
- [x] Kullanıcı listesi tablosu: email, kayıt tarihi, son giriş, görev sayısı, JP bakiyesi kolonları. Arama/filtreleme (email'e göre) ekle.
- [x] İstatistik sayfası: birkaç kart (toplam kullanıcı, aktif kullanıcı, toplam görev vb.) — basit sayısal göstergeler, grafik gerekmez bu fazda.

**Bitiş kriteri:** Admin panelde gerçek kullanıcı verisi görünüyor, arama çalışıyor, istatistikler doğru rakamları gösteriyor.

---

## FAZ 3 — Güvenlik Sıkılaştırma (Rate Limiting), Kullanıcı Detayı ve Salt Okunur Veri Görüntüleme

**Amaç:** Kullanıcı detay verilerine ve tekil kullanıcı DB'lerine erişim açılmadan önce rate limiting güvenliğini kurmak, ardından bir kullanıcıya tıklayınca gerçek verisini (görevler, ödüller) read-only görüntüleyebilmek — henüz düzenleme yok.

**Kapsam:**
- [ ] **/session ve /admin/* endpoint'leri için Rate Limiting mekanizması ekle** (Risk 7 — Tekil kullanıcı verilerine erişim açılmadan önce brute-force ve aşırı istek risklerine karşı güvenlik önlemi).
- [ ] Worker'a `GET /admin/users/:uid/detail` endpoint'i ekle — ilgili kullanıcının `dbName`'ini control plane'den bulur, o kullanıcının Turso DB'sine geçici bağlanır, görevler/ödüller/kategoriler gibi verileri okuyup döndürür.
- [ ] Bu endpoint'te performans için sınır koy (örn. son 50 görev, tüm geçmiş değil).
- [ ] Frontend: kullanıcı listesinde bir satıra tıklayınca detay sayfası/modalı açılsın, verileri düzenlenemez (read-only) şekilde göster.
- [ ] Kullanıcıyı geçici olarak devre dışı bırakma (`isDisabled` flag) özelliğini ekle — basit bir toggle, worker'da hem control plane'i günceller hem de (varsa) kullanıcının login akışında bu flag kontrol edilir.

**Bitiş kriteri:** Rate limiting devrede, bir kullanıcının gerçek görev/ödül verisini admin panelden görebiliyorsun, devre dışı bırakma çalışıyor.

**Performans notu:** Bu endpoint sadece tıklanan tek kullanıcı için bağlantı açmalı. Kullanıcı sayısı arttıkça bu fazın yavaşlamayacağı garanti altına alınmalı — "birden fazla kullanıcının detayını aynı anda çek" gibi bir toplu işlem bu fazın kapsamına asla girmemeli.

---

## FAZ 4 — Düzenleme Yetkisi ve Audit Log

**Amaç:** Destek amaçlı, admin'in kullanıcı verisini düzeltebilmesi — zorunlu audit log ile birlikte.

**Kapsam:**
- [ ] Worker'a `PATCH /admin/users/:uid/tasks/:taskId` gibi düzenleme endpoint'leri ekle (görev başlığı, durumu, JP bakiyesi düzeltme gibi en kritik senaryolarla başla — her şeyi aynı anda kapsamaya çalışma). Bu endpoint'ler **whitelist'lenmiş, spesifik alanlarla** sınırlı kalacak — admin'e serbest SQL çalıştırma imkanı veren genel amaçlı bir endpoint asla eklenmeyecek.
- [ ] Admin'in kullanıcı DB'sine bağlanırken kullandığı Turso token'ı, normal kullanıcı oturumundaki 1 saatlik token'dan daha kısa ömürlü (ör. 5 dakika) üretilecek; salt-okuma amaçlı erişimler (Faz 3) mümkünse read-only scope ile sınırlandırılacak.
- [ ] jpBalance gibi hassas alanlarda, düzenleme isteği önce audit log'a "pending" olarak yazılıp admin ikinci bir onay vermeden gerçek veriye yazılmayacak (basit bir "emin misin" adımı yeterli).
- [ ] Her düzenleme işleminde, işlem başarılı olsa da olmasa da `admin_audit_log`'a kayıt at (adminUid, targetUserUid, action, eski değer, yeni değer, zaman).
- [ ] `admin_audit_log` tablosuna hiçbir admin endpoint'i DELETE/UPDATE yapamayacak — audit log kayıtları oluşturulduktan sonra değiştirilemez/silinemez olacak (temizlik bahanesiyle bile).
- [ ] Frontend: kullanıcı detay sayfasında düzenlenebilir alanlar, kaydet butonu, işlem sonrası "işlem loglandı" bilgisi.
- [ ] Audit log'u görüntüleyebileceğin ayrı bir sayfa/tab ekle (`/admin` içinde "Aktivite Geçmişi" gibi).

**Bitiş kriteri:** Bir kullanıcının görevini admin panelden düzeltebiliyorsun, bu işlem audit log'da görünüyor.

**Büyüme eşiği (önemli):** Kullanıcı sayısı arttıkça ya da J-Planning'e senden başka biri admin olarak eklendiğinde, "tek admin / tam yetki" modeli yetersiz kalır. Aşağıdaki eşiklerden biri gerçekleştiğinde Faz 5 (rol yönetimi) ertelenmeden ele alınmalı:
  - Kullanıcı sayısı ~80-100'e yaklaştığında (aynı zamanda Turso plan yükseltme eşiği),
  - Senden başka bir kişiye admin yetkisi verilmesi gerektiğinde.

---

## FAZ 5 (opsiyonel, ileride) — Rol Yönetimi ve Genişletme

**Amaç:** "İleride büyüyebilir" dediğin senaryo için hazırlık — birden fazla admin, farklı yetki seviyeleri.

**Kapsam (yalnızca gerektiğinde ele alınacak, şimdiden detaylandırılmayacak):**
- [ ] Rol bazlı yetkilendirme (örn. sadece görüntüleme yapabilen "destek" rolü vs tam yetkili "admin" rolü).
- [ ] Yeni admin ekleme/çıkarma arayüzü.
- [ ] Daha gelişmiş istatistik/grafik görünümleri.

**Tetikleyici eşik:** Bu faz "ileride bakarız" değil, Faz 4'teki büyüme eşiklerinden biri gerçekleştiğinde devreye girecek (bkz. Faz 4 sonu).

---

## Maliyet / Ölçek Notları (ücretsiz kalma sınırları)

- **Turso (asıl darboğaz):** Free tier 100 database'e kadar ücretsiz (5GB toplam storage). Mimari "her kullanıcı = 1 database" olduğu için bu sınır doğrudan kullanıcı sayısına denk geliyor (+1 de `jplanning-control` için). ~80 kullanıcıya yaklaşınca Developer plana ($4.99/ay, unlimited database) geçiş planlanmalı.
- **Cloudflare Workers:** Free plan günde 100.000 istek ve invocation başına 10ms CPU süresi veriyor. Mevcut kullanım (auth + admin endpoint'leri) için uzun süre yeterli, ama kullanıcı sayısı ciddi artarsa izlenmeli.
- **Firebase Auth:** 50.000 aylık aktif kullanıcıya kadar ücretsiz (email/şifre girişi için) — pratikte sorun çıkarmaz.
- **Admin panelin kendisi ek maliyet getirmiyor** — yeni servis eklemiyor, mevcut Worker + Turso hesabına entegre oluyor. Tek somut etkisi: control plane için Turso'nun 100 database kotasından 1 tanesini kullanması.

---

## Antigravity ile Çalışma Yöntemi (hatırlatma)

Her faza başlamadan önce Antigravity'den şunu yapmasını isteyeceksin:
> "Faza başlamadan önce, bu fazda tam olarak hangi dosyaları oluşturacağını/değiştireceğini, hangi sırayla ilerleyeceğini ve olası riskleri bana maddeler halinde anlat. Onay vermeden kod yazmaya başlama."

Bu planı Claude'a (bana) gösterip değerlendirtecek, sonra sana Antigravity'ye vereceğin komutu söyleyeceğim. Böylece her faz başlamadan önce çift kontrol olacak.
