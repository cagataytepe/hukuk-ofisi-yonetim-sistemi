# Mimari Kararlar

Bu proje BKT Hukuk ve Danışmanlık Bürosu için single-tenant çalışan Supabase tabanlı bir hukuk bürosu yönetim sistemidir.

## Temel İlkeler

- Uygulama yalnızca BKT Hukuk için çalışır; multi-tenant `law_firm` mantığı kullanılmaz.
- Kimlik doğrulama Supabase Auth ile yapılır.
- Uygulama içi profil, rol ve yetkiler `profiles`, `roles` ve `user_permissions` tablolarından yönetilir.
- Ana iş verileri `public.settings` içindeki merkezi JSON kaydında tutulmaz.
- `localStorage` aktif veri kaynağı veya offline fallback değildir.
- Soft delete standardı `deleted_at` alanıdır; hard delete yalnızca özel rollback/import bakım scriptlerinde ve açık onayla kullanılabilir.
- Frontend doğrudan Supabase SDK çağırmaz; veri erişimi repository katmanından geçer.

## Veri Akışı

```text
outputs/hukuk-burosu-takip-sistemi.html
↓
services/browserRepositoryBridge.js
↓
repositories/SupabaseRepository.js
↓
Supabase tabloları ve RPC fonksiyonları
```

## Aktif Veri Modelleri

- Dosyalar: `files`
- Taraflar: `clients`, `file_parties`
- Duruşmalar: `hearings`
- Süreli işler: `deadlines`
- Görevler: `tasks`
- Tahsilatlar: `collections`
- Ödeme planları: `payment_plans`, `payment_installments`
- Dosya notları: `file_notes`
- Zaman çizelgesi: `timeline_events`
- Kullanıcılar/yetkiler: `profiles`, `roles`, `user_permissions`
- Ofis giderleri: `office_expense_categories`, `office_expenses`, `office_expense_recurring_templates`, `office_expense_budgets`, `office_expense_partner_shares`

## Settings Kullanımı

`public.settings` sadece gerçek uygulama tercihi ve küçük yapılandırma verileri için kullanılmalıdır. Eski `hukukBurosuTakipDemo.v2` kaydı migration yedeği olarak değerlendirilmeli, ana iş verisi kaynağı yapılmamalıdır.

Temizlik için:

- `npm.cmd run analyze:legacy-settings`
- `npm.cmd run backup:legacy-settings -- --execute`
- `npm.cmd run cleanup:legacy-settings -- --execute`
- `npm.cmd run restore:legacy-settings -- --input "<backup>" --confirm`

## Belgeler

Bağımsız Belgeler modülü aktif mimarinin parçası değildir. Dava ve icra evrakları UYAP’ta tutulur. Takip dayanağı evrak bilgileri dosya hesabı/iş mantığı için metadata niteliğinde korunabilir; bu, belge arşivi veya Supabase Storage kullanımı anlamına gelmez.

## Ofis Giderleri

- Gider, kategori, tekrarlayan şablon, bütçe ve ortak payları ayrı tablolarda tutulur.
- Frontend yalnızca `appRepository` kullanır; doğrudan Supabase çağrısı yapmaz.
- Vadesi gelen şablonlar authenticated ve yetkili kullanıcı tarafından güvenli RPC ile üretilir.
- `(recurring_template_id, due_date)` benzersizliği üretimi idempotent kılar.
- Gider, şablon ve bütçe silme işlemleri soft-delete RPC fonksiyonları üzerinden yürür.
- Bütçe gerçekleşmesi ilgili dönemdeki gerçek ve silinmemiş giderlerden hesaplanır.
- Ortak mahsuplaşması yalnızca aktif payların toplamı yüzde 100 olduğunda gösterilir.
- Belge yükleme ve Supabase Storage bu modülün kapsamı dışındadır.

## Güvenlik

- Tarayıcı tarafında service-role veya secret key bulunmaz.
- RLS authenticated kullanıcı ve profil/yetki kontrolleri üzerinden çalışır.
- Silme işlemleri soft delete veya güvenli RPC fonksiyonları üzerinden yapılır.
- Teknik hata ayrıntıları kullanıcıya değil, geliştirici konsoluna yazılır.

## Gelecek Geliştirme Kuralı

Yeni modül veya değişikliklerde önce bu doküman okunmalı; kararlar yukarıdaki veri akışı ve tablo merkezli mimariye göre verilmelidir.

## Üretkenlik Katmanı

- Komut paleti `Ctrl/Cmd + K` ile açılır; komutlar oturumdaki işlem yetkilerine göre gösterilir.
- Evrensel arama `appRepository.globalSearch()` üzerinden gerçek Supabase tablolarında çalışır. En az iki karakter, debounce ve grup başına sonuç sınırı uygular.
- Arama geçmişinde yalnızca güvenli arayüz metadatası tutulabilir. Token, parola, TCKN/VKN veya kayıt gövdesi tarayıcı depolamasına yazılmaz.
- Bildirimler kalıcı kopyalar halinde saklanmaz; duruşma, süreli iş, görev, taksit ve ofis gideri tablolarından dinamik üretilir.
- Kullanıcı bazlı okundu durumu `user_notification_reads` tablosunda `(profile_id, notification_key)` benzersizliğiyle tutulur. RLS kullanıcının yalnızca kendi kayıtlarına erişmesine izin verir.
- Bildirim merkezi polling veya Realtime kullanmaz; oturum açılışında ve çekmece açıldığında yenilenir.
