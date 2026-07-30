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

Sıradaki adım: **Aşama 1 — Veritabanı Katmanı**.

## Proje Yapısı

```
src/
  theme.css        Renk, tipografi, spacing tanımları (CSS custom properties)
  services/         Firebase bağlantısı (sonraki aşamalarda diğer servisler eklenecek)
  router/           Sayfa yönlendirme (react-router-dom) yapısı
  pages/            Sayfa bileşenleri (şu an yer tutucu, Aşama 3-7'de dolacak)
```
