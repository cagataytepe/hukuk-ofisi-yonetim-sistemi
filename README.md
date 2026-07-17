# BKT Hukuk Büro Yönetim Sistemi

Bu proje BKT Hukuk ve Danışmanlık Bürosu için Supabase tabanlı hukuk bürosu yönetim sistemidir.

## Runtime Veri Kaynağı

Uygulamanın varsayılan veri kaynağı Supabase'dir. Ana Sayfa, Dosyalar, Duruşmalar, Süreli İşler, Görevler, Müvekkiller, Belgeler, Ödeme Takibi, Takvim, Raporlar ve Ayarlar ekranları merkezi Supabase state kaydından okunur ve değişiklikleri Supabase'e yazar.

LocalStorage varsayılan veri kaynağı değildir. Yalnızca Supabase bağlantısı kurulamadığında çevrimdışı yedek/fallback olarak kullanılır.

## Ortam Değişkenleri

Runtime ve tarayıcı tarafında yalnızca publishable/anon key kullanılır:

```env
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_ANON_KEY=
```

Service role key tarayıcı, HTML, hosting veya mobil uygulama tarafına yazılmaz.

## Supabase Auth

Giriş sistemi standart Supabase Auth e-posta + şifre yöntemiyle çalışır.

Kullanıcı oluşturma yalnızca Supabase Auth üzerinden yapılır:

```js
supabase.auth.signUp()
```

Giriş yalnızca Supabase Auth üzerinden yapılır:

```js
supabase.auth.signInWithPassword()
```

Uygulama artık username tabanlı giriş, `@bkt.local` e-posta eşlemesi veya SQL ile Auth kullanıcısı oluşturma akışı kullanmaz. `profiles` tablosu yalnızca uygulama içi kullanıcı bilgilerini tutar.

## SQL Migration

Supabase SQL Editor veya CLI için kullanılan aktif migration dosyaları:

- `database/migration/001_initial_schema.sql`
- `database/migration/002_auth_profiles.sql`
- `database/migration/003_remove_multi_tenant.sql`
- `database/migration/007_profiles_display_names_and_permissions.sql`
- `database/migration/008_standardize_bkt_profile_display_names.sql`

Supabase CLI uyumlu tarihli kopyalar:

- `supabase/migrations/202607150001_initial_schema.sql`
- `supabase/migrations/202607150002_auth_profiles.sql`
- `supabase/migrations/202607150003_remove_multi_tenant.sql`
- `supabase/migrations/202607150007_profiles_display_names_and_permissions.sql`
- `supabase/migrations/202607150008_standardize_bkt_profile_display_names.sql`

`auth.users` veya `auth.identities` tablolarına SQL ile kullanıcı yazılmaz.

## Repository Katmanı

- `SupabaseRepository` varsayılan repository'dir.
- `LocalStorageRepository` yalnızca offline fallback olarak kullanılır.
- Tarayıcı uygulaması `services/browserRepositoryBridge.js` üzerinden Supabase `settings` tablosunu okur/yazar.
- Supabase bağlantısı kurulamazsa kullanıcıya bağlantı uyarısı gösterilir ve yerel yedek devreye girer.

## Çalıştırma

```bash
npm run dev
```

PowerShell execution policy engeline takılırsanız:

```powershell
npm.cmd run dev
```
