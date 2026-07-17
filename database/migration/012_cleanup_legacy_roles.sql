begin;

create or replace function public.normalized_role_name(role_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(
    regexp_replace(
      regexp_replace(
        replace(
          replace(
            replace(
              replace(
                replace(btrim(coalesce(role_name, '')), chr(160), ' '),
                chr(8203),
                ''
              ),
              chr(8204),
              ''
            ),
            chr(8205),
            ''
          ),
          chr(65279),
          ''
        ),
        '\s*/\s*',
        ' / ',
        'g'
      ),
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
    case when coalesce(metadata ->> 'standardRole', 'false') = 'true' then 0 else 1 end,
    case when name = btrim(target_role_name) then 0 else 1 end,
    created_at nulls last,
    id
  limit 1;

  if target_role_id is null then
    insert into public.roles (name, is_system, metadata)
    values (btrim(target_role_name), target_is_system, jsonb_build_object('source', '012_cleanup_legacy_roles'))
    returning id into target_role_id;
  else
    update public.roles
    set name = btrim(target_role_name),
        is_system = target_is_system,
        deleted_at = null,
        updated_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('standardizedBy', '012_cleanup_legacy_roles')
    where id = target_role_id;
  end if;

  return target_role_id;
end;
$$;

create or replace function public.bkt_move_role_references(
  target_role_id uuid,
  source_role_ids uuid[],
  target_role_name text,
  migration_source text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  permission_row public.user_permissions%rowtype;
  target_permission_id uuid;
  moved_profiles integer := 0;
  moved_permissions integer := 0;
  archived_permissions integer := 0;
  archived_roles integer := 0;
begin
  if source_role_ids is null or array_length(source_role_ids, 1) is null then
    return jsonb_build_object('profiles', 0, 'permissions', 0, 'archivedPermissions', 0, 'archivedRoles', 0);
  end if;

  update public.profiles
  set role_id = target_role_id,
      title = target_role_name,
      updated_at = now()
  where role_id = any(source_role_ids);
  get diagnostics moved_profiles = row_count;

  for permission_row in
    select *
    from public.user_permissions
    where role_id = any(source_role_ids)
      and deleted_at is null
  loop
    if permission_row.profile_id is null then
      update public.user_permissions
      set deleted_at = coalesce(deleted_at, now()),
          updated_at = now(),
          metadata = coalesce(metadata, '{}'::jsonb)
            || jsonb_build_object('archivedRoleId', permission_row.role_id, 'movedToRoleId', target_role_id, 'movedBy', migration_source)
      where id = permission_row.id;
      archived_permissions := archived_permissions + 1;
      continue;
    end if;

    select id
    into target_permission_id
    from public.user_permissions target
    where target.profile_id = permission_row.profile_id
      and target.role_id = target_role_id
      and target.permission_key = permission_row.permission_key
      and target.deleted_at is null
      and target.id <> permission_row.id
    order by target.updated_at desc nulls last, target.created_at desc nulls last, target.id desc
    limit 1;

    if target_permission_id is null then
      update public.user_permissions
      set role_id = target_role_id,
          updated_at = now(),
          metadata = coalesce(metadata, '{}'::jsonb)
            || jsonb_build_object('previousRoleId', permission_row.role_id, 'movedBy', migration_source)
      where id = permission_row.id;
      moved_permissions := moved_permissions + 1;
    else
      update public.user_permissions
      set allowed = allowed or permission_row.allowed,
          updated_at = now(),
          metadata = coalesce(metadata, '{}'::jsonb)
            || jsonb_build_object('mergedPermissionId', permission_row.id, 'movedBy', migration_source)
      where id = target_permission_id;

      update public.user_permissions
      set deleted_at = coalesce(deleted_at, now()),
          updated_at = now(),
          metadata = coalesce(metadata, '{}'::jsonb)
            || jsonb_build_object('mergedIntoPermissionId', target_permission_id, 'previousRoleId', permission_row.role_id, 'movedBy', migration_source)
      where id = permission_row.id;
      archived_permissions := archived_permissions + 1;
    end if;
  end loop;

  update public.roles
  set deleted_at = coalesce(deleted_at, now()),
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('mergedIntoRoleId', target_role_id, 'movedBy', migration_source)
  where id = any(source_role_ids);
  get diagnostics archived_roles = row_count;

  return jsonb_build_object(
    'profiles',
    moved_profiles,
    'permissions',
    moved_permissions,
    'archivedPermissions',
    archived_permissions,
    'archivedRoles',
    archived_roles
  );
end;
$$;

alter table public.roles drop constraint if exists roles_name_key;
drop index if exists public.roles_name_key;
drop index if exists public.roles_name_trim_ci_active_unique;
drop index if exists public.roles_normalized_name_active_unique;

create temp table bkt_standard_roles (
  role_name text primary key,
  role_order integer not null,
  defaults jsonb not null,
  role_id uuid
) on commit drop;

insert into bkt_standard_roles (role_name, role_order, defaults)
values
  ('Yönetici / Partner', 1, '{"view": true, "create": true, "edit": true, "delete": true, "reports": true, "manageUsers": true}'::jsonb),
  ('Avukat', 2, '{"view": true, "create": true, "edit": true, "delete": false, "reports": true, "manageUsers": false}'::jsonb),
  ('Stajyer Avukat', 3, '{"view": true, "create": true, "edit": true, "delete": false, "reports": false, "manageUsers": false}'::jsonb),
  ('Sekreter / Asistan', 4, '{"view": true, "create": true, "edit": true, "delete": false, "reports": false, "manageUsers": false}'::jsonb),
  ('Muhasebe', 5, '{"view": true, "create": false, "edit": true, "delete": false, "reports": true, "manageUsers": false}'::jsonb),
  ('Yalnızca Görüntüleme', 6, '{"view": true, "create": false, "edit": false, "delete": false, "reports": false, "manageUsers": false}'::jsonb);

update bkt_standard_roles
set role_id = public.ensure_role(role_name, true);

update public.roles r
set name = s.role_name,
    is_system = true,
    deleted_at = null,
    updated_at = now(),
    metadata = coalesce(r.metadata, '{}'::jsonb)
      || jsonb_build_object('standardRole', true, 'roleOrder', s.role_order, 'standardizedBy', '012_cleanup_legacy_roles')
from bkt_standard_roles s
where r.id = s.role_id;

do $$
declare
  standard_row record;
  duplicate_role_ids uuid[];
  move_result jsonb;
begin
  for standard_row in
    select *
    from bkt_standard_roles
    order by role_order
  loop
    select array_agg(id order by created_at nulls last, id)
    into duplicate_role_ids
    from public.roles
    where public.normalized_role_name(name) = public.normalized_role_name(standard_row.role_name)
      and id <> standard_row.role_id;

    move_result := public.bkt_move_role_references(
      standard_row.role_id,
      duplicate_role_ids,
      standard_row.role_name,
      '012_cleanup_legacy_roles:standard_duplicate'
    );

    if duplicate_role_ids is not null then
      raise notice '012_cleanup_legacy_roles: standart rol mükerreri taşındı: %, kaynak roller: %, sonuç: %',
        standard_row.role_name,
        duplicate_role_ids,
        move_result;
    end if;
  end loop;
end;
$$;

do $$
declare
  legacy_role record;
  target_role record;
  move_result jsonb;
begin
  for legacy_role in
    select id, name, public.normalized_role_name(name) as normalized_name
    from public.roles
    where deleted_at is null
      and public.normalized_role_name(name) not in (
        select public.normalized_role_name(role_name)
        from bkt_standard_roles
      )
    order by created_at nulls last, id
  loop
    select *
    into target_role
    from bkt_standard_roles
    where role_name = case
      when legacy_role.normalized_name in ('tam yetkili', 'yönetici', 'yonetici', 'admin', 'partner')
        or legacy_role.normalized_name like '%tam%yetkili%'
        or legacy_role.normalized_name like '%yönetici%'
        or legacy_role.normalized_name like '%yonetici%'
        then 'Yönetici / Partner'
      when legacy_role.normalized_name like '%stajyer%' then 'Stajyer Avukat'
      when legacy_role.normalized_name like '%avukat%' then 'Avukat'
      when legacy_role.normalized_name like '%sekreter%'
        or legacy_role.normalized_name like '%asistan%'
        then 'Sekreter / Asistan'
      when legacy_role.normalized_name like '%muhasebe%' then 'Muhasebe'
      else 'Yalnızca Görüntüleme'
    end;

    move_result := public.bkt_move_role_references(
      target_role.role_id,
      array[legacy_role.id],
      target_role.role_name,
      '012_cleanup_legacy_roles:legacy_role'
    );

    raise notice '012_cleanup_legacy_roles: eski rol taşındı: % (%) -> %, sonuç: %',
      legacy_role.name,
      legacy_role.id,
      target_role.role_name,
      move_result;
  end loop;
end;
$$;

do $$
declare
  standard_row record;
  permission_name text;
  permission_allowed boolean;
  target_permission_id uuid;
begin
  for standard_row in
    select *
    from bkt_standard_roles
    order by role_order
  loop
    foreach permission_name in array array['view', 'create', 'edit', 'delete', 'reports', 'manageUsers'] loop
      permission_allowed := coalesce((standard_row.defaults ->> permission_name)::boolean, false);

      select id
      into target_permission_id
      from public.user_permissions
      where role_id = standard_row.role_id
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
          standard_row.role_id,
          permission_name,
          permission_allowed,
          jsonb_build_object('source', '012_cleanup_legacy_roles', 'roleDefault', true)
        )
        returning id into target_permission_id;
      else
        update public.user_permissions
        set allowed = permission_allowed,
            deleted_at = null,
            updated_at = now(),
            metadata = coalesce(metadata, '{}'::jsonb)
              || jsonb_build_object('source', '012_cleanup_legacy_roles', 'roleDefault', true)
        where id = target_permission_id;
      end if;

      update public.user_permissions
      set deleted_at = coalesce(deleted_at, now()),
          updated_at = now(),
          metadata = coalesce(metadata, '{}'::jsonb)
            || jsonb_build_object('mergedIntoPermissionId', target_permission_id, 'dedupedBy', '012_cleanup_legacy_roles')
      where role_id = standard_row.role_id
        and profile_id is null
        and user_permissions.permission_key = permission_name
        and id <> target_permission_id;
    end loop;
  end loop;
end;
$$;

do $$
declare
  admin_role_id uuid;
  partner_profile record;
  permission_name text;
begin
  select role_id
  into admin_role_id
  from bkt_standard_roles
  where role_name = 'Yönetici / Partner';

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
          role_id = admin_role_id,
          deleted_at = null,
          updated_at = now(),
          metadata = coalesce(metadata, '{}'::jsonb)
            || jsonb_build_object('source', '012_cleanup_legacy_roles', 'partnerFullAccess', true)
      where profile_id = partner_profile.id
        and user_permissions.permission_key = permission_name;

      if not found then
        insert into public.user_permissions (profile_id, role_id, permission_key, allowed, metadata)
        values (
          partner_profile.id,
          admin_role_id,
          permission_name,
          true,
          jsonb_build_object('source', '012_cleanup_legacy_roles', 'partnerFullAccess', true)
        );
      end if;
    end loop;
  end loop;
end;
$$;

do $$
declare
  active_role_count integer;
  non_standard_count integer;
begin
  select count(*)
  into active_role_count
  from public.roles
  where deleted_at is null;

  select count(*)
  into non_standard_count
  from public.roles
  where deleted_at is null
    and public.normalized_role_name(name) not in (
      select public.normalized_role_name(role_name)
      from bkt_standard_roles
    );

  if active_role_count <> 6 or non_standard_count <> 0 then
    raise exception '012_cleanup_legacy_roles: rol temizliği tamamlanamadı. Aktif rol: %, standart dışı aktif rol: %',
      active_role_count,
      non_standard_count;
  end if;
end;
$$;

create unique index roles_name_trim_ci_active_unique
on public.roles (lower(btrim(name)))
where deleted_at is null;

create unique index roles_normalized_name_active_unique
on public.roles (public.normalized_role_name(name))
where deleted_at is null;

drop function if exists public.bkt_move_role_references(uuid, uuid[], text, text);

commit;
