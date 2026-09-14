# BKT Hukuk Büro Yönetim Sistemi

BKT Hukuk ve Danışmanlık Bürosu için geliştirilen Supabase tabanlı hukuk bürosu yönetim sistemi.

## Hızlı Kullanım

- `Ctrl+K` (macOS: `Cmd+K`) komut paletini açar.
- Üst bardaki arama alanı dosya, müvekkil, duruşma, süreli iş, görev ve finans kayıtlarında evrensel arama yapar.
- Zil simgesi yaklaşan ve gecikmiş işlerden dinamik üretilen bildirim merkezini açar.
- Bildirim okundu bilgileri kullanıcıya özeldir; başka kullanıcıların durumu etkilenmez.

## Veri Kaynağı

Uygulamanın aktif veri kaynağı Supabase gerçek tablolarıdır. Ana iş verileri artık `public.settings` içindeki merkezi JSON kaydından okunmaz ve oraya yazılmaz.

Aktif tablolar:

- `files`
- `clients`
- `file_parties`
- `hearings`
- `deadlines`
- `tasks`
- `collections`
- `payment_plans`
- `payment_installments`
- `file_notes`
- `timeline_events`
- `profiles`
- `roles`
- `user_permissions`
- `office_expense_categories`
- `office_expenses`
- `office_expense_recurring_templates`
- `office_expense_budgets`
- `office_expense_partner_shares`
- `interest_rates`
- `attorney_fee_tariffs`
- `attorney_fee_brackets`
- `calculation_parameters`

`public.settings` yalnızca gerçek uygulama tercihi/ayar kaydı için kullanılmalıdır. Eski `hukukBurosuTakipDemo.v2` JSON kaydı migration yedeği olarak durabilir; temizleme işlemi dry-run scriptleriyle kontrollü yapılır.

## Kimlik Doğrulama

Giriş sistemi standart Supabase Auth e-posta + şifre akışıyla çalışır.

- Giriş: `supabase.auth.signInWithPassword()`
- Oturum geri yükleme: `supabase.auth.getSession()`
- Çıkış: `supabase.auth.signOut()`

Parola hiçbir zaman `localStorage`, `sessionStorage`, cookie veya JavaScript sabiti içinde saklanmaz.

## Repository Mimarisi

Frontend veri akışı:

```text
HTML ekranları
↓
services/browserRepositoryBridge.js
↓
repositories/SupabaseRepository.js
↓
Supabase tabloları / RPC fonksiyonları
```

Aktif runtime içinde `LocalStorageRepository` kullanılmaz. Supabase bağlantısı kurulamazsa kullanıcıya bağlantı uyarısı gösterilir; localStorage üzerine otomatik iş verisi yazılmaz.

## Ofis Giderleri

Ofis Giderleri modülü harcamaları, tekrarlayan gider şablonlarını, aylık/yıllık bütçeleri ve ortakların ofis adına yaptığı ödemeleri gerçek Supabase tablolarında tutar. Vadesi gelen tekrarlayan giderler `generate_due_office_expenses(date)` RPC fonksiyonuyla idempotent biçimde üretilir; aynı şablon ve vade tarihi için ikinci kayıt oluşmaz.

Silme işlemleri hard delete değildir; gider, şablon ve bütçe kayıtları yetki kontrollü RPC fonksiyonlarıyla `deleted_at` üzerinden kapatılır. Bütçe ve ortak payı yönetimi `manageUsers`, gider CRUD işlemleri mevcut `create/edit/delete` izinleriyle sınırlandırılır. Ortak paylarının toplamı yüzde 100 değilse mahsuplaşma hesaplanmaz.

Bu modülde belge, fiş veya PDF yükleme bulunmaz ve Supabase Storage kullanılmaz.

## Hesaplama Araçları

Faiz tarifeleri, vekâlet ücreti tarifeleri ve icra hesabında kullanılan genel parametreler sistem genelidir ve `Ayarlar → Hesaplama Araçları` altında yönetilir. İcra dosyası ekranında yalnızca dosyaya özgü faiz türü, faiz başlangıç tarihi, asıl alacak, takip öncesi faiz, harç seçimi, masraf ve tahsil edilen tutar gibi alanlar bulunur.

- Faiz oranları `interest_rates` tablosunda yürürlük başlangıç/bitiş tarihleriyle tarihçeli tutulur. Yeni oran geçmiş dönemi ezmez.
- Vekâlet ücreti tarifeleri ve nispi dilimleri `attorney_fee_tariffs` ile `attorney_fee_brackets` tablolarında tarihçeli tutulur.
- Tahsil harcı seçenekleri, çek tazminatı, bono komisyonu ve faiz gün bazı `calculation_parameters` tablosundan okunur.
- Merkezi tarifeler yalnızca `manageUsers` yetkili kullanıcıların çağırabildiği güvenli RPC fonksiyonlarıyla değiştirilebilir. Aktif kullanıcılar tarihçeyi salt okunur görebilir.
- Adi kanuni faiz dahil merkezi faizler, başlangıç günü hariç ve hesap günü dahil olacak şekilde yürürlük dönemlerine ayrılarak hesaplanır. Mevcut icra dosyasının güncel kapak hesabı yeniden açıldığında güncel tarihçe kullanılır.
- Dosyaya özgü özel/sözleşmesel oran, merkezi tarifesi bulunmayan faiz türlerinde ayrı tutulur; merkezi oranın yerine dosyaya genel oran snapshot'ı yazılmaz.
- Kapak hesabı ekranı ve yeni PDF çıktısı kullanılan faiz dönemleri ile vekâlet ücreti tarifesini denetim dökümünde gösterir. Daha önce oluşturulup dışarı kaydedilmiş PDF belgeleri kendiliğinden değişmez.

Mevcut tahsilat alanı tarihçeli ödeme hareketi değil, tek bir toplu “tahsil edilen/yatan para” değeridir. Bu nedenle gün bazlı kısmi tahsilat sonrası ana para azaltımı modellenmez; mevcut iş kuralı gereği toplam tahsilat hesap sonunda bakiyeden düşülür.

## Ortam Değişkenleri

Tarayıcı/runtime tarafında yalnızca publishable/anon key kullanılır:

```env
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_ANON_KEY=
```

Yerel bakım/import scriptleri gerektiğinde `.env` içinden `SUPABASE_SERVICE_ROLE_KEY` okuyabilir. Bu anahtar hiçbir zaman HTML, `src`, `services`, `outputs` veya deploy dosyalarına yazılmamalıdır.

## Komutlar

```powershell
npm.cmd run dev
npm.cmd run build
```

Eski settings JSON analizi ve kontrollü temizlik:

```powershell
npm.cmd run analyze:legacy-settings
npm.cmd run backup:legacy-settings
npm.cmd run backup:legacy-settings -- --execute
npm.cmd run cleanup:legacy-settings
npm.cmd run cleanup:legacy-settings -- --execute
npm.cmd run restore:legacy-settings -- --input "database/backup/legacy-settings-....json" --confirm
```

## Doğrulama SQL

Supabase SQL Editor içinde aşağıdaki dosya çalıştırılarak tablo sayıları, orphan kayıtlar, duplicate kayıtlar ve eski settings JSON kalıntıları kontrol edilebilir:

```text
database/migration/VERIFY_SUPABASE_DATA_CLEANUP.sql
```
