# J-Planning — Web (PWA)

J-Planning'in mobil (React Native/Expo) uygulamasının web/PWA versiyonu.
Mevcut mobil projeye dokunulmadan, ayrı ve yeni bir proje olarak kuruldu.

Dönüşüm planı ve ilerleme durumu için proje köküne eklenecek olan
`J-Planning-Web-Yapilacaklar.pdf` dosyasına bakın.

## Teknolojiler

- **Framework:** React + Vite
- **Yönlendirme:** react-router-dom
- **Veritabanı (Aşama 1'de):** sql.js + IndexedDB (idb)
- **Kimlik Doğrulama / Backend:** Firebase (Firestore + Authentication) —
  mobil ile aynı proje/anahtarlar

## Kurulum

```bash
npm install
cp .env.example .env   # Firebase anahtarlarını doldurun
npm run dev
```

## Durum

**Aşama 0 — Hazırlık ve İskelet: tamamlandı**

- Boş Vite + React projesi oluşturuldu
- Gerekli paketler kuruldu (firebase, react-router-dom, sql.js, idb)
- Firebase web SDK bağlantısı kuruldu (`src/services/firebase.js`) —
  mobildeki `AsyncStorage` kalıcılığı yerine web'in kendi
  `browserLocalPersistence`'ı kullanılıyor, davranış aynı (oturum kapanmıyor)
- Temel sayfa yönlendirme (routing) yapısı kuruldu (`src/router/`) —
  alt sekme (tab) iskeleti ve yer tutucu (placeholder) sayfalarla
- Tema (renkler, tipografi, spacing) dosyası web CSS'e uyarlandı
  (`src/theme.css`, CSS custom properties olarak)

**Aşama 1 — Veritabanı Katmanı: tamamlandı**

- sql.js + IndexedDB motoru yazıldı (`src/db/sqliteEngine.js`) — expo-sqlite'ın
  senkron API'sini (execSync/runSync/getFirstSync/getAllSync/closeSync) taklit
  eden bir sarmalayıcı; ilk yükleme ve IndexedDB okuma/yazma asenkron
- SQL şeması (`src/db/database.js`) mobildeki ile birebir taşındı, kullanıcı
  başına ayrı veritabanı (`jplanning_{uid}.db`) ve migration mantığı korundu
- Repository dosyaları (task / category / reward / focusSession /
  userProfile) mobil koddan neredeyse değişmeden taşındı

**Aşama 2 — Kimlik Doğrulama: tamamlandı**

- `src/services/emailAuth.js` mobil koddan birebir taşındı (platformdan
  bağımsız, Firebase Auth email/password akışı)
- `src/context/AuthContext.jsx` web'e uyarlandı — Firebase Auth durumunu
  dinlemenin yanı sıra, kullanıcı giriş yaptığında o kullanıcıya özel sql.js
  veritabanını da başlatıyor (`initDatabase(uid)`, async)
- `src/pages/LoginPage.jsx` mobildeki `LoginScreen`in web formuna
  dönüştürülmüş hali (giriş/kayıt modu geçişi, şifre sıfırlama)
- Yönlendirmeye (`AppRouter.jsx`) kimlik doğrulama koruması eklendi:
  giriş yapılmamışsa `/login`'e yönlendirilir, giriş yapılmışsa `/login`
  ana ekrana yönlendirir
- `AppLayout.jsx`e geçici "Çıkış yap" bağlantısı eklendi (kalıcı yeri
  Aşama 7'deki ProfileScreen olacak)

Sıradaki adım: **Aşama 3 — Çekirdek Görev Ekranları**.

## Proje Yapısı

```
src/
  theme.css         Renk, tipografi, spacing tanımları (CSS custom properties)
  services/         Firebase bağlantısı, e-posta ile kimlik doğrulama
  context/          AuthContext (giriş durumu + kullanıcıya özel veritabanı başlatma)
  db/                sql.js/IndexedDB motoru, SQL şeması, repository'ler
  components/       Ortak UI bileşenleri (AppButton, ...)
  router/           Sayfa yönlendirme (react-router-dom) yapısı + auth koruması
  pages/            Sayfa bileşenleri (LoginPage hazır; diğerleri Aşama 3-7'de dolacak)
```
