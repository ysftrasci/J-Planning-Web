# J-Planning Cloudflare Worker (Backend & Control Plane)

Bu dizin, J-Planning projesinin kullanıcı veritabanı tahsisini (Turso provision), oturum yönetimini, push bildirimlerini ve yönetici (admin) işlemlerini yürüten Cloudflare Worker kodlarını içerir.

## Yerel Geliştirme (Local Development)

Worker yerel geliştirme modunda (`npm run dev` veya `wrangler dev`) çalışırken gizli ortam değişkenlerini (secrets) `.dev.vars` dosyasından okur.

### Kurulum Adımları:

1. Bu dizindeki `.dev.vars.example` dosyasını kopyalayarak aynı dizinde `.dev.vars` adında yeni bir dosya oluşturun:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
   *(Windows PowerShell için: `Copy-Item .dev.vars.example .dev.vars`)*

2. `.dev.vars` dosyasını açıp gerçek değerlerinizi yazın:
   - `FIREBASE_SERVICE_ACCOUNT`: Firebase Console'dan indirilen Service Account JSON içeriğinin tek satırlık hali.
   - `TURSO_CONTROL_DB_TOKEN`: Control Plane DB okuma/yazma token'ı.
   - `TURSO_PLATFORM_TOKEN`: Turso Platform API token'ı.

3. **ÖNEMLİ:** `.dev.vars` dosyası `.gitignore` listesindedir ve gizli anahtarlar içerdiğinden kesinlikle git'e commit edilmemelidir.

4. Geliştirme sunucusunu başlatın:
   ```bash
   npm run dev
   ```
