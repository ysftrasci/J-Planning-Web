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

---

## FAZ 1 — Temel Altyapı: Yetkilendirme + Control Plane DB

**Amaç:** Admin panelin güvenlik temelini ve veri kaynağını kurmak. Henüz arayüz yok, sadece altyapı.

**Kapsam:**
- [x] `jplanning-control` adında yeni bir Turso veritabanı oluştur (Turso Platform API üzerinden, worker'daki mevcut `ensureUserDatabase` mantığına benzer şekilde ama tek seferlik/statik).
- [x] Control plane şeması: `admin_users_index` (uid, email, displayName, dbName, createdAt, lastLoginAt, taskCount, jpBalance, isDisabled) ve `admin_audit_log` (id, adminUid, targetUserUid, action, detail, createdAt) tabloları.
- [x] Worker `/session` endpoint'ine, kullanıcı girişinde control plane'e upsert yapan fire-and-forget (await edilmeyen, hata olursa sessizce loglanan) bir adım ekle.
- [x] Firebase Admin SDK veya Firebase Console üzerinden kendi hesabına `admin: true` custom claim ata.
- [x] Worker'a yeni bir yardımcı fonksiyon ekle: `verifyAdminClaim(authHeader)` — Firebase token'ı doğrular VE içindeki `admin: true` claim'ini kontrol eder. Claim yoksa 403 döner.
- [x] Bu fonksiyonu test etmek için basit bir `GET /admin/ping` endpoint'i ekle (sadece "admin doğrulandı mı" kontrolü yapan, veri döndürmeyen).
- [x] Frontend'de `/admin` route'unu React Router'a ekle, ama içine sadece "Admin Paneli — Yakında" yazan boş bir sayfa koy. Route guard: giriş yapmamış kullanıcı → login'e yönlendir. Giriş yapmış ama admin olmayan kullanıcı → ana sayfaya yönlendir (404 gibi davranmalı, admin route'unun varlığını belli etmemeli).

**Bitiş kriteri:** Sen giriş yapınca `/admin` sayfasını görebiliyorsun, başka bir hesapla giriş yapınca göremiyorsun. Worker'daki `/admin/ping` endpoint'i admin olmayan bir token ile 403 dönüyor.

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

**Amaç:** Bir kullanıcıya tıklayınca detayına inip, o kullanıcının gerçek verisini (görevler, ödüller) görebilmek — henüz düzenleme yok.

**Kapsam:**
- [x] **/session ve /admin/* endpoint'leri için Cloudflare KV tabanlı Rate Limiting mekanizmasını kur ve deploy et** (`RATE_LIMIT_KV` binding'i ile 40 istek/dakika sınırı ve 429 koruması devrede).
- [x] Worker'a `GET /admin/users/:uid/detail` endpoint'i ekle — ilgili kullanıcının `dbName`'ini control plane'den bulur, o kullanıcının Turso DB'sine geçici bağlanır, görevler/ödüller/kategoriler/cüzdan verilerini okuyup döndürür ve Control Plane özet sayaçlarını otomatik günceller.
- [x] Bu endpoint'te performans için sınır koy (son 50 görev ve son 50 ödül sınırı uygulandı).
- [x] Frontend: kullanıcı listesinde bir satıra/butona tıklayınca detay modalı açılsın (`AdminUserDetailModal`), verileri düzenlenemez (read-only) şekilde göster.
- [x] Kullanıcıyı geçici olarak devre dışı bırakma (`isDisabled` flag) özelliğini ekle — `PATCH /admin/users/:uid/status` endpoint'i ve `/session` akışında `is_disabled === 1` engellemesi eklendi.

**Bitiş kriteri:** Rate limiting devrede, bir kullanıcının gerçek görev/ödül verisini admin panelden görebiliyorsun, devre dışı bırakma çalışıyor.

---

## FAZ 4 — Düzenleme Yetkisi ve Audit Log

**Amaç:** Destek amaçlı, admin'in kullanıcı verisini düzeltebilmesi — zorunlu audit log ile birlikte.

**Kapsam:**
- [ ] Worker'a `PATCH /admin/users/:uid/tasks/:taskId` gibi düzenleme endpoint'leri ekle (görev başlığı, durumu, JP bakiyesi düzeltme gibi en kritik senaryolarla başla — her şeyi aynı anda kapsamaya çalışma).
- [ ] Her düzenleme işleminde, işlem başarılı olsa da olmasa da `admin_audit_log`'a kayıt at (adminUid, targetUserUid, action, eski değer, yeni değer, zaman).
- [ ] Frontend: kullanıcı detay sayfasında düzenlenebilir alanlar, kaydet butonu, işlem sonrası "işlem loglandı" bilgisi.
- [ ] Audit log'u görüntüleyebileceğin ayrı bir sayfa/tab ekle (`/admin` içinde "Aktivite Geçmişi" gibi).

**Bitiş kriteri:** Bir kullanıcının görevini admin panelden düzeltebiliyorsun, bu işlem audit log'da görünüyor.

---

## FAZ 5 (opsiyonel, ileride) — Rol Yönetimi ve Genişletme

**Amaç:** "İleride büyüyebilir" dediğin senaryo için hazırlık — birden fazla admin, farklı yetki seviyeleri.

**Kapsam (yalnızca gerektiğinde ele alınacak, şimdiden detaylandırılmayacak):**
- [ ] Rol bazlı yetkilendirme (örn. sadece görüntüleme yapabilen "destek" rolü vs tam yetkili "admin" rolü).
- [ ] Yeni admin ekleme/çıkarma arayüzü.
- [ ] Daha gelişmiş istatistik/grafik görünümleri.

---

## Admin Panel Dışı, İleride Ayrıca İncelenecek (Bilgi Notu)

* **Görev Silme & Senkronizasyon Akışı:** Silme işlemi kod seviyesinde fiziksel hard delete (`DELETE FROM tasks`) yapmaktadır. İstemci-tarafı yerel SQLite ve Turso uzak senkronizasyonu arasındaki zamanlama veya cihazlar arası durumlar ilerleyen dönemde genel optimizasyon sürecinde ele alınabilir.
* **Görev Atama Mimarisi:** Görev atamaları Firestore (`assignedTasks`) köprüsü üzerinden yürütülmekte ve atanan kişinin bağımsız Turso veritabanına kopyalanmaktadır. Atayan kullanıcının kendi görev listesiyle atanan görevler görünümünün ayrımı genel kullanıcı deneyimi çerçevesinde değerlendirilebilir.

---

## Antigravity ile Çalışma Yöntemi (hatırlatma)

Her faza başlamadan önce Antigravity'den şunu yapmasını isteyeceksin:
> "Faza başlamadan önce, bu fazda tam olarak hangi dosyaları oluşturacağını/değiştireceğini, hangi sırayla ilerleyeceğini ve olası riskleri bana maddeler halinde anlat. Onay vermeden kod yazmaya başlama."

Bu planı Claude'a (bana) gösterip değerlendirtecek, sonra sana Antigravity'ye vereceğin komutu söyleyeceğim. Böylece her faz başlamadan önce çift kontrol olacak.
