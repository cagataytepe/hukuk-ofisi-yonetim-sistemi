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
    values (btrim(target_role_name), target_is_system, jsonb_build_object('source', '011_standard_roles'))
    returning id into target_role_id;
  else
    update public.roles
    set name = btrim(target_role_name),
        is_system = target_is_system,
        updated_at = now(),
        deleted_at = null,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('standardizedBy', '011_standard_roles')
    where id = target_role_id;
  end if;

  return target_role_id;
end;
$$;

alter table public.roles drop constraint if exists roles_name_key;
drop index if exists public.roles_name_key;

do $$
declare
  role_names text[] := array[
    'Yönetici / Partner',
    'Avukat',
    'Stajyer Avukat',
    'Sekreter / Asistan',
    'Muhasebe',
    'Yalnızca Görüntüleme'
  ];
  role_defaults jsonb := '{
    "Yönetici / Partner": {"view": true, "create": true, "edit": true, "delete": true, "reports": true, "manageUsers": true},
    "Avukat": {"view": true, "create": true, "edit": true, "delete": false, "reports": true, "manageUsers": false},
    "Stajyer Avukat": {"view": true, "create": true, "edit": true, "delete": false, "reports": false, "manageUsers": false},
    "Sekreter / Asistan": {"view": true, "create": true, "edit": true, "delete": false, "reports": false, "manageUsers": false},
    "Muhasebe": {"view": true, "create": false, "edit": true, "delete": false, "reports": true, "manageUsers": false},
    "Yalnızca Görüntüleme": {"view": true, "create": false, "edit": false, "delete": false, "reports": false, "manageUsers": false}
  }'::jsonb;
  permission_keys text[] := array['view', 'create', 'edit', 'delete', 'reports', 'manageUsers'];
  role_name text;
  permission_name text;
  canonical_role_id uuid;
  duplicate_role_ids uuid[];
  duplicate_role_id uuid;
  permission_row public.user_permissions%rowtype;
  target_permission_id uuid;
  permission_allowed boolean;
  role_order integer := 0;
begin
  foreach role_name in array role_names loop
    role_order := role_order + 1;
    canonical_role_id := public.ensure_role(role_name, true);

    update public.roles
    set name = role_name,
        is_system = true,
        deleted_at = null,
        updated_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object(
            'standardRole', true,
            'roleOrder', role_order,
            'standardizedBy', '011_standard_roles'
          )
    where id = canonical_role_id;

    select array_agg(id order by created_at nulls last, id)
    into duplicate_role_ids
    from public.roles
    where public.normalized_role_name(name) = public.normalized_role_name(role_name)
      and id <> canonical_role_id;

    if duplicate_role_ids is not null and array_length(duplicate_role_ids, 1) is not null then
      update public.profiles
      set role_id = canonical_role_id,
          title = role_name,
          updated_at = now()
      where role_id = any(duplicate_role_ids);

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
              metadata = coalesce(metadata, '{}'::jsonb)
                || jsonb_build_object('previousRoleId', permission_row.role_id, 'standardizedBy', '011_standard_roles')
          where id = permission_row.id;
        else
          update public.user_permissions
          set allowed = allowed or permission_row.allowed,
              deleted_at = case when deleted_at is null or permission_row.deleted_at is null then null else deleted_at end,
              updated_at = now(),
              metadata = coalesce(metadata, '{}'::jsonb)
                || jsonb_build_object('mergedPermissionId', permission_row.id, 'standardizedBy', '011_standard_roles')
          where id = target_permission_id;

          update public.user_permissions
          set deleted_at = coalesce(deleted_at, now()),
              updated_at = now(),
              metadata = coalesce(metadata, '{}'::jsonb)
                || jsonb_build_object(
                  'mergedIntoPermissionId',
                  target_permission_id,
                  'previousRoleId',
                  permission_row.role_id,
                  'standardizedBy',
                  '011_standard_roles'
                )
          where id = permission_row.id;
        end if;
      end loop;

      foreach duplicate_role_id in array duplicate_role_ids loop
        update public.roles
        set deleted_at = coalesce(deleted_at, now()),
            updated_at = now(),
            metadata = coalesce(metadata, '{}'::jsonb)
              || jsonb_build_object('mergedIntoRoleId', canonical_role_id, 'standardizedBy', '011_standard_roles')
        where id = duplicate_role_id;
      end loop;
    end if;

    foreach permission_name in array permission_keys loop
      permission_allowed := coalesce((role_defaults -> role_name ->> permission_name)::boolean, false);

      select id
      into target_permission_id
      from public.user_permissions
      where role_id = canonical_role_id
        and profile_id is null
        and user_permissions.permission_key = permission_name
      order by
        case when deleted_at is null then 0 else 1 end,
        updated_at desc nulls last,
        created_at desc nulls last,
        id desc
      limit 1;

      if target_permission_id is null then
        insert into public.user_permissions (profile_id, role_id, permission_key, allowed, metadata)
        values (
          null,
          canonical_role_id,
          permission_name,
          permission_allowed,
          jsonb_build_object('source', '011_standard_roles', 'roleDefault', true)
        )
        returning id into target_permission_id;
      else
        update public.user_permissions
        set allowed = permission_allowed,
            deleted_at = null,
            updated_at = now(),
            metadata = coalesce(metadata, '{}'::jsonb)
              || jsonb_build_object('source', '011_standard_roles', 'roleDefault', true)
        where id = target_permission_id;
      end if;

      update public.user_permissions
      set deleted_at = coalesce(deleted_at, now()),
          updated_at = now(),
          metadata = coalesce(metadata, '{}'::jsonb)
            || jsonb_build_object('mergedIntoPermissionId', target_permission_id, 'standardizedBy', '011_standard_roles')
      where role_id = canonical_role_id
        and profile_id is null
        and user_permissions.permission_key = permission_name
        and id <> target_permission_id;
    end loop;
  end loop;
end;
$$;

do $$
declare
  duplicate_group record;
  canonical_role_id uuid;
  duplicate_role_ids uuid[];
  permission_row public.user_permissions%rowtype;
  target_permission_id uuid;
begin
  for duplicate_group in
    select public.normalized_role_name(name) as normalized_name,
           (array_agg(id order by created_at nulls last, id))[1] as canonical_id,
           (array_agg(id order by created_at nulls last, id))[2:array_length(array_agg(id), 1)] as duplicate_ids
    from public.roles
    where deleted_at is null
    group by public.normalized_role_name(name)
    having count(*) > 1
  loop
    canonical_role_id := duplicate_group.canonical_id;
    duplicate_role_ids := duplicate_group.duplicate_ids;

    if duplicate_role_ids is null or array_length(duplicate_role_ids, 1) is null then
      continue;
    end if;

    update public.profiles
    set role_id = canonical_role_id,
        updated_at = now()
    where role_id = any(duplicate_role_ids);

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
            metadata = coalesce(metadata, '{}'::jsonb)
              || jsonb_build_object('previousRoleId', permission_row.role_id, 'dedupedBy', '011_standard_roles')
        where id = permission_row.id;
      else
        update public.user_permissions
        set allowed = allowed or permission_row.allowed,
            deleted_at = case when deleted_at is null or permission_row.deleted_at is null then null else deleted_at end,
            updated_at = now(),
            metadata = coalesce(metadata, '{}'::jsonb)
              || jsonb_build_object('mergedPermissionId', permission_row.id, 'dedupedBy', '011_standard_roles')
        where id = target_permission_id;

        update public.user_permissions
        set deleted_at = coalesce(deleted_at, now()),
            updated_at = now(),
            metadata = coalesce(metadata, '{}'::jsonb)
              || jsonb_build_object('mergedIntoPermissionId', target_permission_id, 'dedupedBy', '011_standard_roles')
        where id = permission_row.id;
      end if;
    end loop;

    update public.roles
    set deleted_at = coalesce(deleted_at, now()),
        updated_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object('mergedIntoRoleId', canonical_role_id, 'dedupedBy', '011_standard_roles')
    where id = any(duplicate_role_ids);
  end loop;
end;
$$;

do $$
declare
  admin_role_id uuid := public.ensure_role('Yönetici / Partner', true);
  permission_name text;
  partner_profile record;
begin
  update public.profiles
  set role_id = admin_role_id,
      title = 'Yönetici / Partner',
      is_active = true,
      deleted_at = null,
      updated_at = now()
  where display_name in ('Av. Çağatay Tepe', 'Av. İlayda Karakaş Tepe', 'Av. Yusuf Abdullah Ballı')
     or email in ('av.cagataytepe@gmail.com', 'ikarakas7788@gmail.com', 'av.yusufabdullahballi@gmail.com');

  for partner_profile in
    select id
    from public.profiles
    where deleted_at is null
      and (
        display_name in ('Av. Çağatay Tepe', 'Av. İlayda Karakaş Tepe', 'Av. Yusuf Abdullah Ballı')
        or email in ('av.cagataytepe@gmail.com', 'ikarakas7788@gmail.com', 'av.yusufabdullahballi@gmail.com')
      )
  loop
    foreach permission_name in array array['view', 'create', 'edit', 'delete', 'reports', 'manageUsers'] loop
      update public.user_permissions
      set allowed = true,
          deleted_at = null,
          updated_at = now(),
          metadata = coalesce(metadata, '{}'::jsonb)
            || jsonb_build_object('source', '011_standard_roles', 'partnerFullAccess', true)
      where profile_id = partner_profile.id
        and user_permissions.permission_key = permission_name;

      if not found then
        insert into public.user_permissions (profile_id, role_id, permission_key, allowed, metadata)
        values (
          partner_profile.id,
          admin_role_id,
          permission_name,
          true,
          jsonb_build_object('source', '011_standard_roles', 'partnerFullAccess', true)
        );
      end if;
    end loop;
  end loop;
end;
$$;

create unique index if not exists roles_name_trim_ci_active_unique
on public.roles (lower(btrim(name)))
where deleted_at is null;

create unique index if not exists roles_normalized_name_active_unique
on public.roles (public.normalized_role_name(name))
where deleted_at is null;

commit;
