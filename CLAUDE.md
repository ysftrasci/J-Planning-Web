# J-Planning-Web — Claude Code talimatları

Bu dosyayı her oturumun başında oku ve uygula.

## İlk iş

1. `docs/PROJE-OZETI.md` dosyasını oku: uygulamanın ne yaptığı, mimari, verinin nerede durduğu, önemli dosyalar, deploy yolları.
2. `docs/DURUM.md` dosyasını oku: ne yapıldı, ne bekliyor, açık işler.
3. Kullanıcı bir plan dosyası söylerse (`docs/plan-<konu>.md`) onu da oku.

## Oturumun türü: isteğin niyetine bak

- **Uygulama** (düzelt, ekle, yap, uygula, test et, commit at...): İsteneni yap.
  - İlgili bir `docs/plan-<konu>.md` varsa ona uy; planın dışına çıkma. Plan yetersizse dur ve sor.
- **Görüş** (soru, öneri, değerlendirme, "ne dersin"): Sadece konuş, dosya değiştirme.
- **Emin değilsen:** Başlamadan önce tek cümleyle sor.

## Kurallar

- Kullanıcıyla Türkçe konuş.
- **Commit, push ve deploy yalnızca kullanıcı onaylayınca.** Deploy üç ayrı adımdır (Worker, Firestore kuralları, Netlify); her biri ayrı onay ister.
- Kullanıcı her güncellemeyi Netlify'a almadan önce localhost'ta test eder.
- Çalışma şekli: işi baştan sona kendin yap, yapabildiğin kontrolleri (build, lint) kendin çalıştır, sonra kullanıcıya rapor ver. Raporda ne yaptığını ve kullanıcının localhost'ta kontrol edeceği maddeleri numaralı liste halinde yaz. Kullanıcı onaylayınca commit at.
- Depo herkese açık. `docs/` git'e girmez; güvenlik açıklarını, gizli bilgileri veya iç planları git'e giren dosyalara yazma.
- Commit öncesi `git status` çıktısını kullanıcıya göster. `git add -A` veya `git add .` kullanma; dosyaları tek tek ekle. Geçici, test veya çıktı dosyalarını commit'e katma.
- Her değişiklikte sınır durumlarını düşün (boş veri, bağlantı kopması, gece yarısı, eşzamanlı işlem, misafir modu).
- Dosyalar Windows satır sonu (CRLF) kullanıyor; mevcut biçimi koru.
- Gizli dosyalara (`.env*`, `worker/.dev.vars`, `serviceAccountKey.json`) dokunma, içeriklerini yazdırma.

## İş bitince

`docs/DURUM.md` dosyasını güncelle:
- Yapılanları "Tamamlananlar" bölümüne taşı (tarih ile).
- Neyin test edildiğini, neyin beklediğini yaz.
- Yeni bulunan sorunları "Açık işler"e, kalıcı sınırlamaları "Bilinen sınırlar"a ekle.
- "Şu anki durum" bölümünü (son commit, commit edilmemiş değişiklik var mı) güncelle.

Mimari veya deploy yolu değiştiyse `docs/PROJE-OZETI.md` dosyasını da güncelle.
