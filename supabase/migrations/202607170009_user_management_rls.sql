begin;

do $$
declare
  admin_role_id uuid;
  viewer_role_id uuid;
  partner_name text;
  permission_names text[] := array['view', 'create', 'edit', 'delete', 'reports', 'manageUsers'];
begin
  if to_regprocedure('public.ensure_role(text, boolean)') is null then
    raise exception 'public.ensure_role(text, boolean) fonksiyonu bulunamadı. Önce 003_remove_multi_tenant migration çalıştırılmalıdır.';
  end if;

  admin_role_id := public.ensure_role('Yönetici / Partner', true);
  viewer_role_id := public.ensure_role('Yalnızca Görüntüleme', true);

  update public.user_permissions
  set allowed = true,
      deleted_at = null,
      updated_at = now()
  where profile_id is null
    and role_id = viewer_role_id
    and permission_key = 'view';

  if not found then
    insert into public.user_permissions (profile_id, role_id, permission_key, allowed, metadata)
    values (null, viewer_role_id, 'view', true, jsonb_build_object('source', '009_user_management_rls'));
  end if;

  update public.profiles
  set role_id = admin_role_id,
      title = 'Yönetici / Partner',
      is_active = true,
      deleted_at = null,
      updated_at = now()
  where display_name in ('Av. Çağatay Tepe', 'Av. İlayda Karakaş Tepe', 'Av. Yusuf Abdullah Ballı');

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'role'
  ) then
    update public.profiles
    set "role" = 'Yönetici / Partner'
    where display_name in ('Av. Çağatay Tepe', 'Av. İlayda Karakaş Tepe', 'Av. Yusuf Abdullah Ballı');
  end if;

  foreach partner_name in array array['Av. Çağatay Tepe', 'Av. İlayda Karakaş Tepe', 'Av. Yusuf Abdullah Ballı']
  loop
    perform public.grant_profile_permissions(p.id, admin_role_id, permission_names)
    from public.profiles p
    where p.display_name = partner_name
      and p.deleted_at is null;
  end loop;
end;
$$;

create or replace function public.has_permission(permission_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when profile_override.allowed is not null then profile_override.allowed
      when r.name in ('Yönetici / Partner', 'Tam Yetkili') then true
      else exists (
        select 1
        from public.user_permissions role_permission
        where role_permission.deleted_at is null
          and role_permission.allowed = true
          and role_permission.profile_id is null
          and role_permission.role_id = p.role_id
          and role_permission.permission_key = permission_name
      )
    end
    from public.profiles p
    left join public.roles r on r.id = p.role_id and r.deleted_at is null
    left join lateral (
      select up.allowed
      from public.user_permissions up
      where up.deleted_at is null
        and up.profile_id = p.id
        and up.permission_key = permission_name
      order by up.updated_at desc nulls last, up.created_at desc nulls last, up.id desc
      limit 1
    ) profile_override on true
    where p.id = auth.uid()
      and p.deleted_at is null
      and p.is_active = true
  ), false)
$$;

create or replace function public.is_active_profile()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.deleted_at is null
      and p.is_active = true
      and public.has_permission('view')
  )
$$;

drop policy if exists profiles_member_select on public.profiles;
drop policy if exists profiles_self_insert on public.profiles;
drop policy if exists profiles_member_update on public.profiles;
drop policy if exists profiles_single_tenant_select on public.profiles;
drop policy if exists profiles_single_tenant_insert on public.profiles;
drop policy if exists profiles_single_tenant_update on public.profiles;
drop policy if exists profiles_single_tenant_delete on public.profiles;

create policy profiles_single_tenant_select on public.profiles
for select to authenticated
using (
  deleted_at is null
  and (
    id = auth.uid()
    or (is_active = true and public.is_active_profile())
    or public.has_permission('manageUsers')
  )
);

create policy profiles_single_tenant_insert on public.profiles
for insert to authenticated
with check (public.has_permission('manageUsers'));

create policy profiles_single_tenant_update on public.profiles
for update to authenticated
using (public.has_permission('manageUsers'))
with check (public.has_permission('manageUsers'));

create policy profiles_single_tenant_delete on public.profiles
for delete to authenticated
using (public.has_permission('manageUsers'));

do $$
declare
  target_table text;
begin
  foreach target_table in array array['roles', 'user_permissions']
  loop
    execute format('drop policy if exists single_tenant_select on public.%I', target_table);
    execute format('drop policy if exists single_tenant_insert on public.%I', target_table);
    execute format('drop policy if exists single_tenant_update on public.%I', target_table);
    execute format('drop policy if exists single_tenant_delete on public.%I', target_table);
    execute format('create policy single_tenant_select on public.%I for select to authenticated using (public.is_active_profile())', target_table);
    execute format('create policy single_tenant_insert on public.%I for insert to authenticated with check (public.has_permission(''manageUsers''))', target_table);
    execute format('create policy single_tenant_update on public.%I for update to authenticated using (public.has_permission(''manageUsers'')) with check (public.has_permission(''manageUsers''))', target_table);
    execute format('create policy single_tenant_delete on public.%I for delete to authenticated using (public.has_permission(''manageUsers''))', target_table);
  end loop;
end;
$$;

commit;
