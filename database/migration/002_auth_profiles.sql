create or replace function public.ensure_law_firm_role(
  target_law_firm_id uuid,
  target_role_name text,
  target_is_system boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  role_id uuid;
begin
  insert into public.roles (law_firm_id, name, is_system, metadata)
  values (target_law_firm_id, target_role_name, target_is_system, '{"source":"auth-bootstrap"}'::jsonb)
  on conflict (law_firm_id, name)
  do update set updated_at = now()
  returning id into role_id;

  return role_id;
end;
$$;

create or replace function public.grant_profile_permissions(
  target_law_firm_id uuid,
  target_profile_id uuid,
  target_role_id uuid,
  permission_names text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  permission_name text;
begin
  foreach permission_name in array permission_names loop
    insert into public.user_permissions (
      law_firm_id,
      profile_id,
      role_id,
      permission_key,
      allowed,
      metadata
    )
    values (
      target_law_firm_id,
      target_profile_id,
      target_role_id,
      permission_name,
      true,
      '{"source":"auth-bootstrap"}'::jsonb
    )
    on conflict (law_firm_id, profile_id, role_id, permission_key)
    do update set allowed = excluded.allowed, updated_at = now(), deleted_at = null;
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
  target_law_firm_id uuid;
  admin_role_id uuid;
  viewer_role_id uuid;
  selected_role_id uuid;
  is_first_profile boolean;
  display_name text;
  user_name text;
begin
  select id
  into target_law_firm_id
  from public.law_firms
  where deleted_at is null
  order by created_at asc
  limit 1;

  if target_law_firm_id is null then
    return new;
  end if;

  admin_role_id := public.ensure_law_firm_role(target_law_firm_id, 'Yönetici / Partner', true);
  viewer_role_id := public.ensure_law_firm_role(target_law_firm_id, 'Yalnızca Görüntüleme', true);

  select not exists (
    select 1 from public.profiles
    where law_firm_id = target_law_firm_id
      and deleted_at is null
  )
  into is_first_profile;

  selected_role_id := case when is_first_profile then admin_role_id else viewer_role_id end;
  display_name := coalesce(
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'full_name',
    split_part(new.email, '@', 1),
    'Kullanıcı'
  );
  user_name := coalesce(
    new.raw_user_meta_data ->> 'username',
    split_part(new.email, '@', 1)
  );

  insert into public.profiles (
    id,
    law_firm_id,
    role_id,
    legacy_id,
    display_name,
    username,
    title,
    email,
    is_active,
    metadata
  )
  values (
    new.id,
    target_law_firm_id,
    selected_role_id,
    new.id::text,
    display_name,
    user_name,
    case when is_first_profile then 'Yönetici / Partner' else null end,
    new.email,
    true,
    jsonb_build_object('source', 'auth.users trigger', 'firstProfile', is_first_profile)
  )
  on conflict (id)
  do update set
    law_firm_id = excluded.law_firm_id,
    role_id = excluded.role_id,
    display_name = excluded.display_name,
    username = excluded.username,
    email = excluded.email,
    is_active = true,
    deleted_at = null,
    updated_at = now();

  if is_first_profile then
    perform public.grant_profile_permissions(
      target_law_firm_id,
      new.id,
      admin_role_id,
      array['create', 'edit', 'delete', 'reports', 'manageUsers']
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.bootstrap_first_admin(
  p_display_name text default null,
  p_username text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_law_firm_id uuid;
  admin_role_id uuid;
  profile_row public.profiles;
  other_admin_exists boolean;
begin
  if current_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  select id
  into target_law_firm_id
  from public.law_firms
  where deleted_at is null
  order by created_at asc
  limit 1;

  if target_law_firm_id is null then
    raise exception 'law_firms kaydı bulunamadı.';
  end if;

  admin_role_id := public.ensure_law_firm_role(target_law_firm_id, 'Yönetici / Partner', true);

  select exists (
    select 1
    from public.profiles p
    left join public.roles r on r.id = p.role_id
    where p.law_firm_id = target_law_firm_id
      and p.id <> current_user_id
      and p.deleted_at is null
      and (
        r.name in ('Yönetici / Partner', 'Tam Yetkili')
        or exists (
          select 1
          from public.user_permissions up
          where up.profile_id = p.id
            and up.permission_key = 'manageUsers'
            and up.allowed = true
            and up.deleted_at is null
        )
      )
  )
  into other_admin_exists;

  if other_admin_exists then
    raise exception 'İlk yönetici kurulumu daha önce tamamlanmış.';
  end if;

  insert into public.profiles (
    id,
    law_firm_id,
    role_id,
    legacy_id,
    display_name,
    username,
    title,
    email,
    is_active,
    metadata
  )
  select
    u.id,
    target_law_firm_id,
    admin_role_id,
    u.id::text,
    coalesce(nullif(p_display_name, ''), u.raw_user_meta_data ->> 'display_name', split_part(u.email, '@', 1)),
    coalesce(nullif(p_username, ''), u.raw_user_meta_data ->> 'username', split_part(u.email, '@', 1)),
    'Yönetici / Partner',
    u.email,
    true,
    '{"source":"bootstrap_first_admin"}'::jsonb
  from auth.users u
  where u.id = current_user_id
  on conflict (id)
  do update set
    law_firm_id = excluded.law_firm_id,
    role_id = excluded.role_id,
    display_name = excluded.display_name,
    username = excluded.username,
    title = excluded.title,
    email = excluded.email,
    is_active = true,
    deleted_at = null,
    updated_at = now()
  returning * into profile_row;

  perform public.grant_profile_permissions(
    target_law_firm_id,
    current_user_id,
    admin_role_id,
    array['create', 'edit', 'delete', 'reports', 'manageUsers']
  );

  return profile_row;
end;
$$;

grant execute on function public.bootstrap_first_admin(text, text) to authenticated;
