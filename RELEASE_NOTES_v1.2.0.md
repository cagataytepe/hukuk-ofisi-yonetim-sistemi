# BKT Hukuk v1.2.0

Bu sürüm, günlük iş akışlarını hızlandıran üretkenlik merkezini ve kullanıcıya özel bildirim deneyimini getirir.

## Komut Paleti

- `Ctrl+K` ve macOS üzerinde `Cmd+K` ile açılan merkezi komut paleti eklendi.
- Ana modüllere hızlı navigasyon ve yeni dosya, duruşma, süreli iş, görev, tahsilat ve ofis gideri komutları eklendi.
- Komut görünürlüğü oturum açan kullanıcının işlem yetkilerine göre sınırlandırıldı.
- Klavye ile gezinme, seçim ve kapatma davranışları masaüstü ve mobil düzenle uyumlu hale getirildi.

## Evrensel Arama

- Dosyalar, müvekkiller, duruşmalar, süreli işler, görevler, ödeme planları, tahsilatlar ve ofis giderleri tek arama alanında birleştirildi.
- Arama sonuçları veri türüne göre gruplandırıldı ve ilgili uygulama bölümüne yönlendirildi.
- Son aramalar ve son kullanılan kayıtlar için yalnızca güvenli arayüz metadatası saklandı.
- TCKN/VKN, parola, token veya kayıt gövdesi tarayıcı geçmişine yazılmıyor.

## Bildirim Merkezi

- Duruşma, süreli iş, görev, ödeme taksiti ve ofis gideri kayıtlarından dinamik bildirimler üretildi.
- Tümü, Acil, Bugün ve Yaklaşan filtreleri eklendi.
- Kullanıcıya özel okundu bilgisi ve toplu okundu işaretleme desteği eklendi.
- `public.user_notification_reads` tablosu, benzersizlik kuralı ve kullanıcıya özel RLS politikaları oluşturuldu.
- Bildirim çekmecesi ve okunmamış bildirim rozeti mobil ekranlara uyarlandı.

## Stabilizasyon

- Oturum geçişinde görev ve süreli iş profil zenginleştirme sorgularının oluşturduğu yarış koşulu giderildi.
- Frontend veri akışı `Frontend -> browserRepositoryBridge -> Repository -> Supabase` mimarisini koruyor.
- Service-role veya secret anahtar tarayıcı koduna eklenmedi.

## Doğrulama

- Production build başarılı.
- Playwright E2E: **17 passed, 0 failed, 0 flaky, 0 skipped**.
- Masaüstü ve mobil senaryolar doğrulandı.
- Yinelenen HTML ID ve frontend içinde doğrudan `supabase.from(...)` kullanımı bulunmuyor.

## Bilinen Durum

- Vite build sırasında ana uygulama paketinin 500 kB sınırını aştığına ilişkin performans uyarısı devam etmektedir. İşlevsel bir hata değildir.

## Sonraki Aşama

- Windows/Tauri masaüstü uygulaması.
