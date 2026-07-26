# v0.9.0 Release Notes

## Ozet

Bu surum, BKT Hukuk ve Danismanlik Burosu yonetim sisteminin localStorage/demo mimarisinden Supabase tabanli gercek veri mimarisine gecisini tamamlar. Ana is akislarinda Supabase Auth, rol/yetki yapisi, tablo merkezli veri modeli, soft-delete ve E2E test kapsami stabilize edilmistir.

## Tamamlanan Basliklar

- Supabase Auth e-posta ve sifre girisi aktif hale getirildi.
- Kullanici profilleri, roller ve yetkiler `profiles`, `roles` ve `user_permissions` tablolari uzerinden yonetilecek sekilde duzenlendi.
- Dosyalar, durusmalar, sureli isler, gorevler, taraflar, tahsilatlar, odeme planlari, dosya notlari ve zaman cizelgesi gercek Supabase tablolarina tasindi.
- Dosya Detayi alt sekmeleri Supabase kaynakli CRUD ve soft-delete akislarina baglandi.
- Dashboard, Takvim ve Raporlar settings JSON yerine gercek tablolardan veri okuyacak hale getirildi.
- Odeme planlari, taraflar ve dosya iliskileri tablo merkezli yapida dogrulandi.
- Legacy JSON/localStorage aktif veri kaynagi olmaktan cikarildi; bakim ve cleanup scriptleri eklendi.
- Bagimsiz Belgeler modulu aktif uygulamadan kaldirildi. Takip dayanagi evrak bilgileri yalnizca is mantigi metadata alani olarak korunur.
- RLS ve soft-delete icin gerekli RPC fonksiyonlari eklendi.
- Vite kok giris noktasi, merkezi Supabase client ve Playwright E2E altyapisi hazirlandi.

## Test Durumu

- Playwright E2E paketi iki ardil tam kosuda basarili oldu.
- Birinci tam kosu: 13 passed, 0 failed, 0 flaky, 0 skipped.
- Ikinci tam kosu: 13 passed, 0 failed, 0 flaky, 0 skipped.
- Mobil responsive smoke testi geciyor.
- `npm.cmd run build` basarili.

## Bilinen Notlar

- Vite production build sirasinda buyuk bundle uyarisi goruluyor. Bu uyarinin uygulama calismasini engelleyen bir etkisi yoktur.
- Daha onceki E2E denemelerinden kalan soft-delete edilemeyen yan test kayitlari icin ileride ayrica guvenli bakim/RPC temizligi planlanabilir.

## Sonraki Asama

- v0 arayuz donusumu: mevcut islevleri bozmadan daha modern ve sade bir kullanici arayuzune gecis.
