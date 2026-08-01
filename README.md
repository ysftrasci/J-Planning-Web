# J-Planning — Web (PWA)

J-Planning'in mobil (React Native/Expo) uygulamasının web/PWA versiyonu.
Mevcut mobil projeye dokunulmadan, ayrı ve yeni bir proje olarak kuruldu.

## Teknolojiler

- **Framework:** React + Vite
- **Yönlendirme:** react-router-dom
- **Veritabanı (yerel/offline):** sql.js + IndexedDB (idb)
- **Kimlik Doğrulama / Backend:** Firebase (Firestore + Authentication) —
  mobil ile aynı proje/anahtarlar
- **PWA:** Service worker + manifest (ana ekrana ekleme desteği)

## Kurulum

```bash
npm install
cp .env.example .env   # Firebase anahtarlarını doldurun
npm run dev
```

## Durum

**Proje tamamlandı.**

- Kimlik doğrulama: e-posta/şifre ile giriş-kayıt, şifre sıfırlama
- Çekirdek görev sistemi: görev ekleme, kategoriler, görev detay,
  geçmişe dönük "Tamamlandı" işaretleme (7 günlük düzeltme penceresi),
  streak (seri) takibi
- Ödül/Puan sistemi: puan kazanımı, ödül hedefleri, ödül geçmişi
- Arkadaşlık / Sosyal sistem: arkadaş ekleme (Kullanıcı ID ile),
  arkadaşa görev atama, arkadaşa ödül hedefi atama
- Odaklanma Modu: odaklanma seansları, ses entegrasyonu, geçmiş
- Profil ve Ayarlar: profil düzenleme, bildirim ayarları, Tehlikeli Alan
- PWA: manifest, service worker, ana ekrana ekleme istemi
- Tema: Koyu/Açık tema desteği

## Proje Yapısı

```
src/
  theme.css         Renk, tipografi, spacing tanımları (CSS custom properties)
  services/         Firebase bağlantısı, kimlik doğrulama, arkadaşlık,
                    görev/ödül atama, bildirimler, fotoğraf yükleme,
                    veri yedekleme, odaklanma sesleri
  context/          AuthContext (giriş durumu + kullanıcıya özel veritabanı başlatma)
  db/               sql.js/IndexedDB motoru, SQL şeması, repository'ler
                    (task / category / reward / focusSession / userProfile)
  components/       Ortak UI bileşenleri (AppButton, AppModal, TaskCard,
                    AssignedTaskModal, EmptyState, PWAInstallPrompt, ...)
  router/           Sayfa yönlendirme (react-router-dom) yapısı + auth koruması
  pages/            Sayfa bileşenleri (görevler, kategoriler, ödüller,
                    arkadaşlar, odaklanma, profil, ayarlar, tehlikeli alan, ...)
```
