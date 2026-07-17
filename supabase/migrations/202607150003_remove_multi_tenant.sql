begin;

drop trigger if exists on_auth_user_created on auth.users;

do $$
declare
  target_table text;
  policy_name text;
begin
  foreach target_table in array array[
    'law_firms', 'offices', 'roles', 'profiles', 'user_permissions', 'clients',
    'files', 'file_parties', 'hearings', 'deadlines', 'tasks', 'documents',
    'payment_plans', 'payment_installments', 'collections', 'interest_rates',
    'attorney_fee_tariffs', 'attorney_fee_brackets', 'timeline_events',
    'file_notes', 'supporting_documents', 'enforcement_accounts', 'settings',
    'migration_logs'
  ]
  loop
    if to_regclass(format('public.%I', target_table)) is not null then
      foreach policy_name in array array[
        'law_firms_member_select',
        'law_firms_authenticated_insert',
        'law_firms_member_update',
        'profiles_member_select',
        'profiles_self_insert',
        'profiles_member_update',
        'profiles_single_tenant_select',
        'profiles_single_tenant_insert',
        'profiles_single_tenant_update',
        'profiles_single_tenant_delete',
        'firm_member_access',
        'single_tenant_select',
        'single_tenant_insert',
        'single_tenant_update',
        'single_tenant_delete'
      ]
      loop
        execute format('drop policy if exists %I on public.%I', policy_name, target_table);
      end loop;
    end if;
  end loop;
end;
$$;

drop function if exists public.bootstrap_first_admin(text, text);
drop function if exists public.handle_new_auth_user();
drop function if exists public.grant_profile_permissions(uuid, uuid, uuid, text[]);
drop function if exists public.grant_profile_permissions(uuid, uuid, text[]);
drop function if exists public.ensure_law_firm_role(uuid, text, boolean);
drop function if exists public.ensure_role(text, boolean);
drop function if exists public.current_law_firm_id();
drop function if exists public.is_law_firm_member(uuid);
drop function if exists public.is_active_profile();
drop function if exists public.has_permission(text);
drop function if exists public.has_any_permission(text[]);

do $$
declare
  item record;
begin
  for item in
    select conrelid::regclass as table_name, conname
    from pg_constraint
    where connamespace = 'public'::regnamespace
      and pg_get_constraintdef(oid) ilike '%law_firm_id%'
  loop
    execute format('alter table %s drop constraint if exists %I', item.table_name, item.conname);
  end loop;
end;
$$;

do $$
declare
  item record;
begin
  for item in
    select schemaname, indexname
    from pg_indexes
    where schemaname = 'public'
      and indexdef ilike '%law_firm_id%'
  loop
    execute format('drop index if exists %I.%I', item.schemaname, item.indexname);
  end loop;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'offices', 'roles', 'profiles', 'user_permissions', 'clients', 'files',
    'file_parties', 'hearings', 'deadlines', 'tasks', 'documents',
    'payment_plans', 'payment_installments', 'collections', 'interest_rates',
    'attorney_fee_tariffs', 'attorney_fee_brackets', 'timeline_events',
    'file_notes', 'supporting_documents', 'enforcement_accounts', 'settings',
    'migration_logs'
  ]
  loop
    if exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = target_table
        and c.column_name = 'law_firm_id'
    ) then
      execute format('alter table public.%I drop column if exists law_firm_id', target_table);
    end if;
  end loop;
end;
$$;

do $$
begin
  if to_regclass('public.law_firms') is not null then
    drop table public.law_firms;
  end if;
end;
$$;

do $$ begin
  if to_regclass('public.roles') is not null
     and not exists (select 1 from pg_constraint where conname = 'roles_name_key' and connamespace = 'public'::regnamespace) then
    alter table public.roles add constraint roles_name_key unique (name);
  end if;
exception when unique_violation then
  raise notice 'roles.name has duplicates; roles_name_key was not created.';
end $$;

do $$ begin
  if to_regclass('public.profiles') is not null
     and not exists (select 1 from pg_constraint where conname = 'profiles_username_key' and connamespace = 'public'::regnamespace) then
    alter table public.profiles add constraint profiles_username_key unique (username);
  end if;
exception when unique_violation then
  raise notice 'profiles.username has duplicates; profiles_username_key was not created.';
end $$;

do $$ begin
  if to_regclass('public.user_permissions') is not null
     and not exists (select 1 from pg_constraint where conname = 'user_permissions_profile_role_permission_key' and connamespace = 'public'::regnamespace) then
    alter table public.user_permissions add constraint user_permissions_profile_role_permission_key unique (profile_id, role_id, permission_key);
  end if;
exception when unique_violation then
  raise notice 'user_permissions has duplicates; profile/role/permission unique constraint was not created.';
end $$;

do $$ begin
  if to_regclass('public.settings') is not null
     and not exists (select 1 from pg_constraint where conname = 'settings_setting_key_key' and connamespace = 'public'::regnamespace) then
    alter table public.settings add constraint settings_setting_key_key unique (setting_key);
  end if;
exception when unique_violation then
  raise notice 'settings.setting_key has duplicates; settings_setting_key_key was not created.';
end $$;

do $$ begin
  if to_regclass('public.migration_logs') is not null
     and not exists (select 1 from pg_constraint where conname = 'migration_logs_migration_key_key' and connamespace = 'public'::regnamespace) then
    alter table public.migration_logs add constraint migration_logs_migration_key_key unique (migration_key);
  end if;
exception when unique_violation then
  raise notice 'migration_logs.migration_key has duplicates; migration_logs_migration_key_key was not created.';
end $$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'clients', 'files', 'file_parties', 'hearings', 'deadlines', 'tasks',
    'documents', 'payment_plans', 'collections', 'interest_rates',
    'attorney_fee_tariffs', 'timeline_events', 'file_notes',
    'supporting_documents'
  ]
  loop
    if to_regclass(format('public.%I', target_table)) is not null then
      begin
        execute format('alter table public.%I add constraint %I unique (legacy_id)', target_table, target_table || '_legacy_id_key');
      exception
        when duplicate_object then null;
        when unique_violation then
          raise notice '%.legacy_id has duplicates; unique constraint was not created.', target_table;
      end;
    end if;
  end loop;
end;
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
  )
$$;

create or replace function public.has_permission(permission_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    left join public.roles r on r.id = p.role_id and r.deleted_at is null
    where p.id = auth.uid()
      and p.deleted_at is null
      and p.is_active = true
      and (
        r.name in ('Yönetici / Partner', 'Tam Yetkili')
        or exists (
          select 1
          from public.user_permissions up
          where up.deleted_at is null
            and up.allowed = true
            and up.permission_key = permission_name
            and (
              up.profile_id = p.id
              or (up.profile_id is null and up.role_id = p.role_id)
            )
        )
      )
  )
$$;

create or replace function public.has_any_permission(permission_names text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from unnest(permission_names) permission_name
    where public.has_permission(permission_name)
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
begin
  select id
  into target_role_id
  from public.roles
  where name = target_role_name
  order by created_at nulls last, id
  limit 1;

  if target_role_id is null then
    insert into public.roles (name, is_system, metadata)
    values (target_role_name, target_is_system, '{"source":"single-tenant-auth"}'::jsonb)
    returning id into target_role_id;
  else
    update public.roles
    set is_system = target_is_system,
        updated_at = now(),
        deleted_at = null
    where id = target_role_id;
  end if;

  return target_role_id;
end;
$$;

create or replace function public.grant_profile_permissions(
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
    update public.user_permissions
    set allowed = true,
        updated_at = now(),
        deleted_at = null
    where profile_id = target_profile_id
      and role_id = target_role_id
      and permission_key = permission_name;

    if not found then
      insert into public.user_permissions (
        profile_id,
        role_id,
        permission_key,
        allowed,
        metadata
      )
      values (
        target_profile_id,
        target_role_id,
        permission_name,
        true,
        '{"source":"single-tenant-auth"}'::jsonb
      );
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
    selected_role_id,
    new.id::text,
    display_name,
    user_name,
    case when is_first_profile then 'Yönetici / Partner' else null end,
    new.email,
    true,
    jsonb_build_object('source', 'auth.users trigger single tenant', 'firstProfile', is_first_profile)
  )
  on conflict (id)
  do update set
    role_id = excluded.role_id,
    display_name = excluded.display_name,
    username = excluded.username,
    email = excluded.email,
    is_active = true,
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
  admin_role_id uuid;
  profile_row public.profiles;
  other_admin_exists boolean;
begin
  if current_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  admin_role_id := public.ensure_role('Yönetici / Partner', true);

  select exists (
    select 1
    from public.profiles p
    left join public.roles r on r.id = p.role_id
    where p.id <> current_user_id
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
    admin_role_id,
    u.id::text,
    coalesce(nullif(p_display_name, ''), u.raw_user_meta_data ->> 'display_name', split_part(u.email, '@', 1)),
    coalesce(nullif(p_username, ''), u.raw_user_meta_data ->> 'username', split_part(u.email, '@', 1)),
    'Yönetici / Partner',
    u.email,
    true,
    '{"source":"bootstrap_first_admin_single_tenant"}'::jsonb
  from auth.users u
  where u.id = current_user_id
  on conflict (id)
  do update set
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
    current_user_id,
    admin_role_id,
    array['create', 'edit', 'delete', 'reports', 'manageUsers']
  );

  return profile_row;
end;
$$;

revoke all on function public.is_active_profile() from public, anon;
revoke all on function public.has_permission(text) from public, anon;
revoke all on function public.has_any_permission(text[]) from public, anon;
revoke all on function public.ensure_role(text, boolean) from public, anon;
revoke all on function public.grant_profile_permissions(uuid, uuid, text[]) from public, anon;
revoke all on function public.bootstrap_first_admin(text, text) from public, anon;

grant execute on function public.is_active_profile() to authenticated;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.has_any_permission(text[]) to authenticated;
grant execute on function public.bootstrap_first_admin(text, text) to authenticated;

alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.user_permissions enable row level security;

create policy profiles_single_tenant_select on public.profiles
for select to authenticated
using (public.is_active_profile());

create policy profiles_single_tenant_insert on public.profiles
for insert to authenticated
with check (id = auth.uid() or public.has_permission('manageUsers'));

create policy profiles_single_tenant_update on public.profiles
for update to authenticated
using (id = auth.uid() or public.has_permission('manageUsers'))
with check (id = auth.uid() or public.has_permission('manageUsers'));

create policy profiles_single_tenant_delete on public.profiles
for delete to authenticated
using (public.has_permission('manageUsers'));

do $$
declare
  target_table text;
begin
  foreach target_table in array array['roles', 'user_permissions']
  loop
    execute format('create policy single_tenant_select on public.%I for select to authenticated using (public.is_active_profile())', target_table);
    execute format('create policy single_tenant_insert on public.%I for insert to authenticated with check (public.has_permission(''manageUsers''))', target_table);
    execute format('create policy single_tenant_update on public.%I for update to authenticated using (public.has_permission(''manageUsers'')) with check (public.has_permission(''manageUsers''))', target_table);
    execute format('create policy single_tenant_delete on public.%I for delete to authenticated using (public.has_permission(''manageUsers''))', target_table);
  end loop;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'offices', 'clients', 'files', 'file_parties', 'hearings', 'deadlines',
    'tasks', 'documents', 'payment_plans', 'payment_installments',
    'collections', 'interest_rates', 'attorney_fee_tariffs',
    'attorney_fee_brackets', 'timeline_events', 'file_notes',
    'supporting_documents', 'enforcement_accounts', 'settings',
    'migration_logs'
  ]
  loop
    if to_regclass(format('public.%I', target_table)) is not null then
      execute format('alter table public.%I enable row level security', target_table);
      execute format('create policy single_tenant_select on public.%I for select to authenticated using (public.is_active_profile() and deleted_at is null)', target_table);
      execute format('create policy single_tenant_insert on public.%I for insert to authenticated with check (public.has_any_permission(array[''create'', ''manageUsers'']))', target_table);
      execute format('create policy single_tenant_update on public.%I for update to authenticated using (public.has_any_permission(array[''edit'', ''delete'', ''manageUsers'']) and deleted_at is null) with check (public.has_any_permission(array[''create'', ''edit'', ''delete'', ''manageUsers'']))', target_table);
      execute format('create policy single_tenant_delete on public.%I for delete to authenticated using (public.has_any_permission(array[''delete'', ''manageUsers'']))', target_table);
    end if;
  end loop;
end;
$$;

create index if not exists idx_profiles_role on public.profiles(role_id) where deleted_at is null;
create index if not exists idx_profiles_email on public.profiles(email) where deleted_at is null;
create index if not exists idx_user_permissions_profile on public.user_permissions(profile_id) where deleted_at is null;
create index if not exists idx_user_permissions_role on public.user_permissions(role_id) where deleted_at is null;
create index if not exists idx_clients_name on public.clients(name) where deleted_at is null;
create index if not exists idx_clients_tax_id on public.clients(tax_id) where deleted_at is null;
create index if not exists idx_files_legacy_id on public.files(legacy_id) where deleted_at is null;
create index if not exists idx_files_type_status on public.files(file_type, status) where deleted_at is null;
create index if not exists idx_files_follow_type on public.files(follow_type) where deleted_at is null;
create index if not exists idx_files_file_no on public.files(file_no) where deleted_at is null;
create index if not exists idx_file_parties_file on public.file_parties(file_id) where deleted_at is null;
create index if not exists idx_file_parties_name on public.file_parties(name) where deleted_at is null;
create index if not exists idx_file_parties_tax_id on public.file_parties(tax_id) where deleted_at is null;
create index if not exists idx_hearings_file on public.hearings(file_id) where deleted_at is null;
create index if not exists idx_hearings_date on public.hearings(hearing_date) where deleted_at is null;
create index if not exists idx_deadlines_file on public.deadlines(file_id) where deleted_at is null;
create index if not exists idx_deadlines_due on public.deadlines(due_date) where deleted_at is null;
create index if not exists idx_deadlines_status on public.deadlines(status) where deleted_at is null;
create index if not exists idx_tasks_file on public.tasks(file_id) where deleted_at is null;
create index if not exists idx_tasks_due on public.tasks(due_date) where deleted_at is null;
create index if not exists idx_tasks_status on public.tasks(status) where deleted_at is null;
create index if not exists idx_documents_file on public.documents(file_id) where deleted_at is null;
create index if not exists idx_documents_category on public.documents(category) where deleted_at is null;
create index if not exists idx_payment_plans_file on public.payment_plans(file_id) where deleted_at is null;
create index if not exists idx_payment_installments_plan on public.payment_installments(payment_plan_id) where deleted_at is null;
create index if not exists idx_payment_installments_due on public.payment_installments(due_date) where deleted_at is null;
create index if not exists idx_collections_file on public.collections(file_id) where deleted_at is null;
create index if not exists idx_collections_payment_plan on public.collections(payment_plan_id) where deleted_at is null;
create index if not exists idx_collections_date on public.collections(collection_date) where deleted_at is null;
create index if not exists idx_interest_rates_type_dates on public.interest_rates(interest_type, from_date, to_date) where deleted_at is null;
create index if not exists idx_attorney_fee_tariffs_dates on public.attorney_fee_tariffs(from_date, to_date) where deleted_at is null;
create index if not exists idx_timeline_events_file on public.timeline_events(file_id) where deleted_at is null;
create index if not exists idx_file_notes_file on public.file_notes(file_id) where deleted_at is null;
create index if not exists idx_supporting_documents_file on public.supporting_documents(file_id) where deleted_at is null;
create index if not exists idx_enforcement_accounts_file on public.enforcement_accounts(file_id) where deleted_at is null;
create index if not exists idx_settings_key on public.settings(setting_key) where deleted_at is null;
create index if not exists idx_migration_logs_key on public.migration_logs(migration_key) where deleted_at is null;

commit;
