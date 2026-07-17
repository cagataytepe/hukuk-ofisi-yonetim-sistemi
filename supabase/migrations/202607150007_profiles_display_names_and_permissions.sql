begin;

alter table public.profiles
  add column if not exists "role" text,
  add column if not exists permissions jsonb not null default '{}'::jsonb;

create index if not exists idx_profiles_display_name_active_ci
  on public.profiles (lower(display_name))
  where deleted_at is null;

do $$
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'idx_profiles_username_active_ci'
  ) then
    if exists (
      select 1
      from public.profiles
      where username is not null
        and deleted_at is null
      group by lower(username)
      having count(*) > 1
    ) then
      raise notice 'profiles.username içinde mükerrer kayıt bulundu; idx_profiles_username_active_ci oluşturulmadı.';
    else
      create unique index idx_profiles_username_active_ci
        on public.profiles (lower(username))
        where username is not null and deleted_at is null;
    end if;
  end if;
end;
$$;

do $$
declare
  admin_role_id uuid;
  permission_names text[] := array['create', 'edit', 'delete', 'reports', 'manageUsers'];
  full_permissions jsonb := jsonb_build_object(
    'create', true,
    'edit', true,
    'delete', true,
    'reports', true,
    'manageUsers', true
  );
  profile_row record;
  permission_name text;
begin
  if to_regprocedure('public.ensure_role(text, boolean)') is null then
    raise exception 'public.ensure_role(text, boolean) fonksiyonu bulunamadı. Önce 003_remove_multi_tenant migration çalıştırılmalıdır.';
  end if;

  admin_role_id := public.ensure_role('Yönetici / Partner', true);

  update public.profiles
  set display_name = 'Av. Çağatay Tepe',
      username = coalesce(nullif(username, ''), 'cagatay'),
      role_id = admin_role_id,
      title = 'Yönetici',
      "role" = 'Yönetici',
      is_active = true,
      permissions = full_permissions,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('profileStandardizedAt', now(), 'source', '007_profiles_display_names_and_permissions'),
      deleted_at = null,
      updated_at = now()
  where deleted_at is null
    and (
      lower(coalesce(username, '')) in ('cagatay', 'av.cagataytepe', 'cagatay.tepe')
      or lower(split_part(coalesce(email, ''), '@', 1)) in ('cagatay', 'av.cagataytepe', 'cagatay.tepe')
      or lower(coalesce(display_name, '')) in ('av. çağatay tepe', 'çağatay tepe', 'cagatay', 'av.cagataytepe', 'cagatay.tepe')
    );

  update public.profiles
  set display_name = 'Av. İlayda Karakaş Tepe',
      username = coalesce(nullif(username, ''), 'ilayda'),
      role_id = admin_role_id,
      title = 'Yönetici',
      "role" = 'Yönetici',
      is_active = true,
      permissions = full_permissions,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('profileStandardizedAt', now(), 'source', '007_profiles_display_names_and_permissions'),
      deleted_at = null,
      updated_at = now()
  where deleted_at is null
    and (
      lower(coalesce(username, '')) in ('ilayda', 'av.ilaydakarakastepe', 'ilayda.karakas.tepe', 'ilayda.karakaş.tepe')
      or lower(split_part(coalesce(email, ''), '@', 1)) in ('ilayda', 'av.ilaydakarakastepe', 'ilayda.karakas.tepe', 'ilayda.karakaş.tepe')
      or lower(coalesce(display_name, '')) in ('av. ilayda karakaş tepe', 'av. i̇layda karakaş tepe', 'ilayda', 'i̇layda', 'av.ilaydakarakastepe', 'ilayda.karakas.tepe', 'ilayda.karakaş.tepe')
    );

  update public.profiles
  set display_name = 'Av. Yusuf Abdullah Ballı',
      username = coalesce(nullif(username, ''), 'yusuf'),
      role_id = admin_role_id,
      title = 'Yönetici',
      "role" = 'Yönetici',
      is_active = true,
      permissions = full_permissions,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('profileStandardizedAt', now(), 'source', '007_profiles_display_names_and_permissions'),
      deleted_at = null,
      updated_at = now()
  where deleted_at is null
    and (
      lower(coalesce(username, '')) in ('yusuf', 'av.yusufabdullahballi', 'av.yusufabdullahballı', 'yusuf.abdullah.balli', 'yusuf.abdullah.ballı')
      or lower(split_part(coalesce(email, ''), '@', 1)) in ('yusuf', 'av.yusufabdullahballi', 'av.yusufabdullahballı', 'yusuf.abdullah.balli', 'yusuf.abdullah.ballı')
      or lower(coalesce(display_name, '')) in ('av. yusuf abdullah ballı', 'yusuf', 'av.yusufabdullahballi', 'av.yusufabdullahballı', 'yusuf.abdullah.balli', 'yusuf.abdullah.ballı')
    );

  for profile_row in
    select id
    from public.profiles
    where deleted_at is null
      and display_name in ('Av. Çağatay Tepe', 'Av. İlayda Karakaş Tepe', 'Av. Yusuf Abdullah Ballı')
  loop
    if to_regprocedure('public.grant_profile_permissions(uuid, uuid, text[])') is not null then
      perform public.grant_profile_permissions(profile_row.id, admin_role_id, permission_names);
    else
      foreach permission_name in array permission_names loop
        insert into public.user_permissions (profile_id, role_id, permission_key, allowed, metadata)
        values (
          profile_row.id,
          admin_role_id,
          permission_name,
          true,
          jsonb_build_object('source', '007_profiles_display_names_and_permissions')
        )
        on conflict (profile_id, role_id, permission_key)
        do update set allowed = true, deleted_at = null, updated_at = now();
      end loop;
    end if;
  end loop;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_role_id uuid;
  viewer_role_id uuid;
  selected_role_id uuid;
  is_first_profile boolean;
  display_name text;
  user_name text;
  full_permissions jsonb := jsonb_build_object(
    'create', true,
    'edit', true,
    'delete', true,
    'reports', true,
    'manageUsers', true
  );
begin
  admin_role_id := public.ensure_role('Yönetici / Partner', true);
  viewer_role_id := public.ensure_role('Yalnızca Görüntüleme', true);

  select not exists (
    select 1
    from public.profiles
    where deleted_at is null
  )
  into is_first_profile;

  selected_role_id := case when is_first_profile then admin_role_id else viewer_role_id end;
  display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    split_part(new.email, '@', 1),
    'Kullanıcı'
  );
  user_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    split_part(new.email, '@', 1)
  );

  insert into public.profiles (
    id,
    role_id,
    legacy_id,
    display_name,
    username,
    title,
    "role",
    email,
    is_active,
    permissions,
    metadata
  )
  values (
    new.id,
    selected_role_id,
    new.id::text,
    display_name,
    user_name,
    case when is_first_profile then 'Yönetici' else null end,
    case when is_first_profile then 'Yönetici' else null end,
    new.email,
    true,
    case when is_first_profile then full_permissions else '{}'::jsonb end,
    jsonb_build_object('source', 'auth.users trigger single tenant', 'firstProfile', is_first_profile)
  )
  on conflict (id)
  do update set
    role_id = excluded.role_id,
    display_name = excluded.display_name,
    username = excluded.username,
    title = excluded.title,
    "role" = excluded."role",
    email = excluded.email,
    is_active = true,
    permissions = excluded.permissions,
    deleted_at = null,
    updated_at = now();

  if is_first_profile then
    perform public.grant_profile_permissions(
      new.id,
      admin_role_id,
      array['create', 'edit', 'delete', 'reports', 'manageUsers']
    );
  end if;

  return new;
end;
$$;

commit;
