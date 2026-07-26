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

## Settings Kullanımı

`public.settings` sadece gerçek uygulama tercihi ve küçük yapılandırma verileri için kullanılmalıdır. Eski `hukukBurosuTakipDemo.v2` kaydı migration yedeği olarak değerlendirilmeli, ana iş verisi kaynağı yapılmamalıdır.

Temizlik için:

- `npm.cmd run analyze:legacy-settings`
- `npm.cmd run backup:legacy-settings -- --execute`
- `npm.cmd run cleanup:legacy-settings -- --execute`
- `npm.cmd run restore:legacy-settings -- --input "<backup>" --confirm`

## Belgeler

Bağımsız Belgeler modülü aktif mimarinin parçası değildir. Dava ve icra evrakları UYAP’ta tutulur. Takip dayanağı evrak bilgileri dosya hesabı/iş mantığı için metadata niteliğinde korunabilir; bu, belge arşivi veya Supabase Storage kullanımı anlamına gelmez.

## Güvenlik

- Tarayıcı tarafında service-role veya secret key bulunmaz.
- RLS authenticated kullanıcı ve profil/yetki kontrolleri üzerinden çalışır.
- Silme işlemleri soft delete veya güvenli RPC fonksiyonları üzerinden yapılır.
- Teknik hata ayrıntıları kullanıcıya değil, geliştirici konsoluna yazılır.

## Gelecek Geliştirme Kuralı

Yeni modül veya değişikliklerde önce bu doküman okunmalı; kararlar yukarıdaki veri akışı ve tablo merkezli mimariye göre verilmelidir.
