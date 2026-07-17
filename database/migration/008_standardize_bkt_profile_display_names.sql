begin;

update public.profiles
set display_name = case lower(email)
    when 'av.cagataytepe@gmail.com' then 'Av. Çağatay Tepe'
    when 'av.yusufabdullahballi@gmail.com' then 'Av. Yusuf Abdullah Ballı'
    when 'ikarakas7788@gmail.com' then 'Av. İlayda Karakaş Tepe'
    else display_name
  end,
  title = 'Yönetici / Partner',
  is_active = true,
  updated_at = now()
where lower(email) in (
  'av.cagataytepe@gmail.com',
  'av.yusufabdullahballi@gmail.com',
  'ikarakas7788@gmail.com'
);

commit;
