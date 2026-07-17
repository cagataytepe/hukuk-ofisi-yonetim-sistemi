begin;

create or replace function public.normalized_role_name(role_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(
    regexp_replace(
      regexp_replace(btrim(coalesce(role_name, '')), '\s*/\s*', ' / ', 'g'),
      '\s+',
      ' ',
      'g'
    )
  )
$$;

create or replace function public.ensure_role(
  target_role_name text,
  target_is_system boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role_id uuid;
  normalized_target_name text := public.normalized_role_name(target_role_name);
begin
  select id
  into target_role_id
  from public.roles
  where public.normalized_role_name(name) = normalized_target_name
  order by
    case when deleted_at is null then 0 else 1 end,
    case when name = btrim(target_role_name) then 0 else 1 end,
    created_at nulls last,
    id
  limit 1;

  if target_role_id is null then
    insert into public.roles (name, is_system, metadata)
    values (btrim(target_role_name), target_is_system, '{"source":"ensure_role_normalized"}'::jsonb)
    returning id into target_role_id;
  else
    update public.roles
    set name = btrim(target_role_name),
        is_system = target_is_system,
        updated_at = now(),
        deleted_at = null,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('normalizedBy', '010_dedupe_roles')
    where id = target_role_id;
  end if;

  return target_role_id;
end;
$$;

do $$
declare
  duplicate_group record;
begin
  for duplicate_group in
    select public.normalized_role_name(name) as normalized_name,
           array_agg(id order by created_at nulls last, id) as role_ids,
           array_agg(name order by created_at nulls last, id) as role_names
    from public.roles
    where deleted_at is null
    group by public.normalized_role_name(name)
    having count(*) > 1
  loop
    raise notice '010_dedupe_roles: aktif mükerrer rol grubu: %, kayıtlar: %, adlar: %',
      duplicate_group.normalized_name,
      duplicate_group.role_ids,
      duplicate_group.role_names;
  end loop;
end;
$$;

do $$
declare
  canonical_role_id uuid;
  duplicate_role_ids uuid[];
  duplicate_role_id uuid;
  permission_row public.user_permissions%rowtype;
  target_permission_id uuid;
  moved_profiles integer := 0;
  moved_permissions integer := 0;
  archived_permissions integer := 0;
begin
  select id
  into canonical_role_id
  from public.roles
  where public.normalized_role_name(name) = public.normalized_role_name('Yönetici / Partner')
  order by
    case when deleted_at is null then 0 else 1 end,
    case when name = 'Yönetici / Partner' then 0 else 1 end,
    created_at nulls last,
    id
  limit 1;

  if canonical_role_id is null then
    insert into public.roles (name, is_system, metadata)
    values ('Yönetici / Partner', true, jsonb_build_object('source', '010_dedupe_roles'))
    returning id into canonical_role_id;
  end if;

  update public.roles
  set name = 'Yönetici / Partner',
      is_system = true,
      deleted_at = null,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('canonicalRole', true, 'normalizedBy', '010_dedupe_roles')
  where id = canonical_role_id;

  select array_agg(id order by created_at nulls last, id)
  into duplicate_role_ids
  from public.roles
  where public.normalized_role_name(name) = public.normalized_role_name('Yönetici / Partner')
    and id <> canonical_role_id;

  if duplicate_role_ids is null or array_length(duplicate_role_ids, 1) is null then
    raise notice '010_dedupe_roles: Yönetici / Partner için mükerrer rol bulunamadı. Kanonik rol: %', canonical_role_id;
    return;
  end if;

  update public.profiles
  set role_id = canonical_role_id,
      title = 'Yönetici / Partner',
      updated_at = now()
  where role_id = any(duplicate_role_ids);
  get diagnostics moved_profiles = row_count;

  for permission_row in
    select *
    from public.user_permissions
    where role_id = any(duplicate_role_ids)
  loop
    select id
    into target_permission_id
    from public.user_permissions target
    where target.role_id = canonical_role_id
      and target.permission_key = permission_row.permission_key
      and target.profile_id is not distinct from permission_row.profile_id
      and target.id <> permission_row.id
    order by
      case when target.deleted_at is null then 0 else 1 end,
      target.updated_at desc nulls last,
      target.created_at desc nulls last,
      target.id desc
    limit 1;

    if target_permission_id is null then
      update public.user_permissions
      set role_id = canonical_role_id,
          updated_at = now(),
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('previousRoleId', permission_row.role_id, 'normalizedBy', '010_dedupe_roles')
      where id = permission_row.id;
      moved_permissions := moved_permissions + 1;
    else
      update public.user_permissions
      set allowed = allowed or permission_row.allowed,
          deleted_at = case when deleted_at is null or permission_row.deleted_at is null then null else deleted_at end,
          updated_at = now(),
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('mergedPermissionId', permission_row.id, 'normalizedBy', '010_dedupe_roles')
      where id = target_permission_id;

      if permission_row.profile_id is not null then
        update public.user_permissions
        set role_id = null,
            updated_at = now(),
            metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('mergedIntoPermissionId', target_permission_id, 'previousRoleId', permission_row.role_id, 'normalizedBy', '010_dedupe_roles')
        where id = permission_row.id;
      else
        update public.user_permissions
        set deleted_at = coalesce(deleted_at, now()),
            updated_at = now(),
            metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('mergedIntoPermissionId', target_permission_id, 'previousRoleId', permission_row.role_id, 'normalizedBy', '010_dedupe_roles')
        where id = permission_row.id;
        archived_permissions := archived_permissions + 1;
      end if;
    end if;
  end loop;

  foreach duplicate_role_id in array duplicate_role_ids loop
    update public.roles
    set deleted_at = coalesce(deleted_at, now()),
        updated_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('mergedIntoRoleId', canonical_role_id, 'normalizedBy', '010_dedupe_roles')
    where id = duplicate_role_id;
  end loop;

  update public.profiles
  set role_id = canonical_role_id,
      title = 'Yönetici / Partner',
      is_active = true,
      deleted_at = null,
      updated_at = now()
  where display_name in ('Av. Çağatay Tepe', 'Av. İlayda Karakaş Tepe', 'Av. Yusuf Abdullah Ballı');

  raise notice '010_dedupe_roles: Kanonik rol %, pasife alınan mükerrer roller %, taşınan profil %, taşınan yetki %, arşivlenen mükerrer rol-yetkisi %',
    canonical_role_id,
    duplicate_role_ids,
    moved_profiles,
    moved_permissions,
    archived_permissions;
end;
$$;

commit;
