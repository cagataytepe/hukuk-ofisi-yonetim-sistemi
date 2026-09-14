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
- Hesaplama araçları: `interest_rates`, `attorney_fee_tariffs`, `attorney_fee_brackets`, `calculation_parameters`

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

## Merkezi Hesaplama Araçları

Hesaplama araçları herhangi bir dosyaya bağlı ayar değildir. Yönetim yüzeyi `Ayarlar → Hesaplama Araçları` altındadır ve veri akışı diğer modüllerle aynıdır:

```text
Dosya formu / Dosya detayı / Kapak hesabı
↓
browserRepositoryBridge
↓
SupabaseRepository
↓
interest_rates / attorney_fee_tariffs / attorney_fee_brackets / calculation_parameters
```

- Faiz ve vekâlet ücreti tarifelerinde geçmiş satır overwrite edilmez; yeni yürürlük tarihi yeni bir dönem oluşturur ve önceki dönem bir gün önce kapanır.
- Aynı tür/kapsam ve yürürlük tarihindeki mükerrer kayıt benzersiz indeksle engellenir. Dönem oluşturma ve güvenli gelecek dönem pasifleştirme işlemleri transaction içindeki `SECURITY DEFINER` RPC fonksiyonlarıyla yapılır.
- Hesaplama tabloları authenticated aktif profiller tarafından okunabilir. Doğrudan INSERT/UPDATE/DELETE kapalıdır; yönetim RPC'leri aktif profil ve `manageUsers` izni doğrular.
- İcra dosyası merkezi faiz türünü ve dosyaya özgü başlangıç tarihini saklar. Merkezi oran dosyaya kopyalanmaz; özel/sözleşmesel oran yalnızca merkezi tarifesi olmayan türlerde dosyaya özgü değer olarak kalır.
- Güncel kapak hesabı hesap tarihinde yürürlükte olan merkezi tarife geçmişini yeniden okur. Faiz dönemleri başlangıç günü hariç, hesap günü dahil ve merkezi gün bazıyla hesaplanır.
- Vekâlet ücreti mevcut iş kuralı gereği hesap tarihindeki tarifeyi, takipte kesinleşen tutarı hesap tabanı ve asıl alacağı üst sınır olarak kullanır.
- Harç takipte kesinleşen tutar üzerinden; takip sonrası faiz yalnızca asıl alacak üzerinden hesaplanır.
- Toplu tahsilat değeri hesap sonunda bakiyeden düşülür. Tarihçeli kısmi tahsilat ve mahsup sırası mevcut veri modelinde bulunmadığından bu katman yeni bir hukuki varsayım üretmez.
- Ekrandaki kapak hesabı canlı hesaptır. Oluşturulan PDF hesap anındaki dönem/tarife dökümünü içerir; daha önce kaydedilmiş PDF dosyaları yeniden yazılmaz.

## Gelecek Geliştirme Kuralı

Yeni modül veya değişikliklerde önce bu doküman okunmalı; kararlar yukarıdaki veri akışı ve tablo merkezli mimariye göre verilmelidir.

## Üretkenlik Katmanı

- Komut paleti `Ctrl/Cmd + K` ile açılır; komutlar oturumdaki işlem yetkilerine göre gösterilir.
- Evrensel arama `appRepository.globalSearch()` üzerinden gerçek Supabase tablolarında çalışır. En az iki karakter, debounce ve grup başına sonuç sınırı uygular.
- Arama geçmişinde yalnızca güvenli arayüz metadatası tutulabilir. Token, parola, TCKN/VKN veya kayıt gövdesi tarayıcı depolamasına yazılmaz.
- Bildirimler kalıcı kopyalar halinde saklanmaz; duruşma, süreli iş, görev, taksit ve ofis gideri tablolarından dinamik üretilir.
- Kullanıcı bazlı okundu durumu `user_notification_reads` tablosunda `(profile_id, notification_key)` benzersizliğiyle tutulur. RLS kullanıcının yalnızca kendi kayıtlarına erişmesine izin verir.
- Bildirim merkezi polling veya Realtime kullanmaz; oturum açılışında ve çekmece açıldığında yenilenir.
