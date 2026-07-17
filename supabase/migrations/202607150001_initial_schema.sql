create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.law_firms (
  id uuid primary key default gen_random_uuid(),
  legacy_id text,
  name text not null,
  slug text unique,
  tax_id text,
  phone text,
  email text,
  address text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.offices (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  legacy_id text,
  name text not null,
  phone text,
  email text,
  address text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  legacy_id text,
  name text not null,
  description text,
  is_system boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (law_firm_id, name)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  office_id uuid references public.offices(id) on delete set null,
  role_id uuid references public.roles(id) on delete set null,
  legacy_id text,
  display_name text not null,
  username text,
  title text,
  phone text,
  email text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (law_firm_id, username)
);

create table if not exists public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  role_id uuid references public.roles(id) on delete cascade,
  permission_key text not null,
  allowed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (law_firm_id, profile_id, role_id, permission_key),
  check (profile_id is not null or role_id is not null)
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  legacy_id text,
  name text not null,
  tax_id text,
  phone text,
  email text,
  address text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  office_id uuid references public.offices(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  responsible_profile_id uuid references public.profiles(id) on delete set null,
  legacy_id text,
  display_id text,
  record_kind text not null,
  file_type text not null,
  follow_type text,
  file_no text,
  court_or_office text,
  decision_no text,
  subject text,
  status text not null default 'Açık',
  opening_date date,
  responsible_name text,
  client_name text,
  opponent_name text,
  description text,
  account_info jsonb not null default '{}'::jsonb,
  instrument_info jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (law_firm_id, legacy_id)
);

create table if not exists public.file_parties (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  legacy_id text,
  party_type text not null,
  side text not null,
  role text,
  name text not null,
  tax_id text,
  phone text,
  email text,
  is_primary boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.hearings (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  attendee_profile_id uuid references public.profiles(id) on delete set null,
  legacy_id text,
  court text,
  case_file_no text,
  hearing_date date not null,
  hearing_time time,
  client_name text,
  party_role text,
  excuse_type text,
  attendee_name text,
  note text,
  outcome jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.deadlines (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  responsible_profile_id uuid references public.profiles(id) on delete set null,
  legacy_id text,
  title text not null,
  description text,
  responsible_name text,
  start_date date,
  due_date date not null,
  status text not null default 'Aktif',
  completed_at timestamptz,
  completed_late boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  file_id uuid references public.files(id) on delete set null,
  responsible_profile_id uuid references public.profiles(id) on delete set null,
  legacy_id text,
  task_type text not null default 'office',
  title text not null,
  description text,
  responsible_name text,
  due_date date,
  status text not null default 'Aktif',
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  file_id uuid references public.files(id) on delete set null,
  legacy_id text,
  name text not null,
  category text,
  document_date date,
  description text,
  file_name text,
  storage_bucket text,
  storage_path text,
  mime_type text,
  size_bytes bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.payment_plans (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  file_id uuid references public.files(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  legacy_id text,
  plan_type text not null,
  party_name text not null,
  agreement_amount numeric(14,2) not null default 0,
  initial_payment numeric(14,2) not null default 0,
  installment_count integer not null default 1,
  first_due_date date,
  currency text not null default 'TRY',
  status text not null default 'Aktif',
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.payment_installments (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  payment_plan_id uuid not null references public.payment_plans(id) on delete cascade,
  legacy_id text,
  sequence_no integer not null,
  due_date date not null,
  amount numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  paid_date date,
  status text not null default 'Bekliyor',
  payments jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (payment_plan_id, sequence_no)
);

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  file_id uuid references public.files(id) on delete set null,
  payment_plan_id uuid references public.payment_plans(id) on delete set null,
  payment_installment_id uuid references public.payment_installments(id) on delete set null,
  legacy_id text,
  amount numeric(14,2) not null default 0,
  currency text not null default 'TRY',
  collection_date date not null,
  payment_kind text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.interest_rates (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  legacy_id text,
  interest_type text not null,
  from_date date not null,
  to_date date,
  rate numeric(9,4) not null default 0,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.attorney_fee_tariffs (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  legacy_id text,
  name text not null,
  from_date date not null,
  to_date date,
  regular_minimum numeric(14,2) not null default 0,
  eviction_minimum numeric(14,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.attorney_fee_brackets (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  tariff_id uuid not null references public.attorney_fee_tariffs(id) on delete cascade,
  sequence_no integer not null,
  limit_amount numeric(14,2),
  rate numeric(9,4) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tariff_id, sequence_no)
);

create table if not exists public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  legacy_id text,
  event_type text not null,
  title text not null,
  description text,
  event_date timestamptz not null default now(),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.file_notes (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  legacy_id text,
  note_text text not null,
  author_profile_id uuid references public.profiles(id) on delete set null,
  author_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.supporting_documents (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  legacy_id text,
  document_type text not null,
  title text,
  bank text,
  branch text,
  document_no text,
  issue_date date,
  due_date date,
  issue_place text,
  issuer text,
  beneficiary text,
  amount numeric(14,2),
  original_with_client boolean not null default false,
  storage_bucket text,
  storage_path text,
  file_name text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.enforcement_accounts (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  file_id uuid not null unique references public.files(id) on delete cascade,
  legacy_id text,
  principal numeric(14,2) not null default 0,
  pre_interest numeric(14,2) not null default 0,
  finalized_amount numeric(14,2) not null default 0,
  interest_type text,
  interest_rate numeric(9,4),
  interest_start date,
  account_date date,
  post_interest numeric(14,2) not null default 0,
  fee_rate numeric(9,4),
  fees numeric(14,2) not null default 0,
  expenses numeric(14,2) not null default 0,
  attorney_fee numeric(14,2) not null default 0,
  payments numeric(14,2) not null default 0,
  instrument_charge numeric(14,2) not null default 0,
  instrument_charge_label text,
  current_debt numeric(14,2) not null default 0,
  currency text not null default 'TRY',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  legacy_id text,
  setting_key text not null,
  setting_value jsonb not null default '{}'::jsonb,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (law_firm_id, setting_key)
);

create table if not exists public.migration_logs (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid references public.law_firms(id) on delete cascade,
  migration_key text not null,
  source text,
  status text not null default 'pending',
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (law_firm_id, migration_key)
);

do $$ begin
  alter table public.clients add constraint clients_law_firm_legacy_id_key unique (law_firm_id, legacy_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.file_parties add constraint file_parties_law_firm_legacy_id_key unique (law_firm_id, legacy_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.hearings add constraint hearings_law_firm_legacy_id_key unique (law_firm_id, legacy_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.deadlines add constraint deadlines_law_firm_legacy_id_key unique (law_firm_id, legacy_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.tasks add constraint tasks_law_firm_legacy_id_key unique (law_firm_id, legacy_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.documents add constraint documents_law_firm_legacy_id_key unique (law_firm_id, legacy_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.payment_plans add constraint payment_plans_law_firm_legacy_id_key unique (law_firm_id, legacy_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.collections add constraint collections_law_firm_legacy_id_key unique (law_firm_id, legacy_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.interest_rates add constraint interest_rates_law_firm_legacy_id_key unique (law_firm_id, legacy_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.attorney_fee_tariffs add constraint attorney_fee_tariffs_law_firm_legacy_id_key unique (law_firm_id, legacy_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.timeline_events add constraint timeline_events_law_firm_legacy_id_key unique (law_firm_id, legacy_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.file_notes add constraint file_notes_law_firm_legacy_id_key unique (law_firm_id, legacy_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.supporting_documents add constraint supporting_documents_law_firm_legacy_id_key unique (law_firm_id, legacy_id);
exception when duplicate_object then null; end $$;

create or replace function public.current_law_firm_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.law_firm_id
  from public.profiles p
  where p.id = auth.uid()
    and p.deleted_at is null
    and p.is_active = true
  limit 1
$$;

create or replace function public.is_law_firm_member(target_law_firm_id uuid)
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
      and p.law_firm_id = target_law_firm_id
      and p.deleted_at is null
      and p.is_active = true
  )
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'law_firms', 'offices', 'roles', 'profiles', 'user_permissions', 'clients',
    'files', 'file_parties', 'hearings', 'deadlines', 'tasks', 'documents',
    'payment_plans', 'payment_installments', 'collections', 'interest_rates',
    'attorney_fee_tariffs', 'attorney_fee_brackets', 'timeline_events',
    'file_notes', 'supporting_documents', 'enforcement_accounts', 'settings',
    'migration_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop trigger if exists set_%I_updated_at on public.%I', table_name, table_name);
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end;
$$;

create policy law_firms_member_select on public.law_firms
for select to authenticated
using (id = public.current_law_firm_id() and deleted_at is null);

create policy law_firms_authenticated_insert on public.law_firms
for insert to authenticated
with check (auth.uid() is not null);

create policy law_firms_member_update on public.law_firms
for update to authenticated
using (id = public.current_law_firm_id() and deleted_at is null)
with check (id = public.current_law_firm_id());

create policy profiles_member_select on public.profiles
for select to authenticated
using (public.is_law_firm_member(law_firm_id) and deleted_at is null);

create policy profiles_self_insert on public.profiles
for insert to authenticated
with check (id = auth.uid());

create policy profiles_member_update on public.profiles
for update to authenticated
using (public.is_law_firm_member(law_firm_id) and deleted_at is null)
with check (public.is_law_firm_member(law_firm_id));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'offices', 'roles', 'user_permissions', 'clients', 'files', 'file_parties',
    'hearings', 'deadlines', 'tasks', 'documents', 'payment_plans',
    'payment_installments', 'collections', 'interest_rates',
    'attorney_fee_tariffs', 'attorney_fee_brackets', 'timeline_events',
    'file_notes', 'supporting_documents', 'enforcement_accounts', 'settings',
    'migration_logs'
  ]
  loop
    execute format('drop policy if exists firm_member_access on public.%I', table_name);
    execute format('create policy firm_member_access on public.%I for all to authenticated using (public.is_law_firm_member(law_firm_id) and deleted_at is null) with check (public.is_law_firm_member(law_firm_id))', table_name);
  end loop;
end;
$$;

create index if not exists idx_offices_law_firm on public.offices(law_firm_id) where deleted_at is null;
create index if not exists idx_profiles_law_firm on public.profiles(law_firm_id) where deleted_at is null;
create index if not exists idx_profiles_role on public.profiles(role_id) where deleted_at is null;
create index if not exists idx_roles_law_firm on public.roles(law_firm_id) where deleted_at is null;
create index if not exists idx_user_permissions_profile on public.user_permissions(profile_id) where deleted_at is null;
create index if not exists idx_user_permissions_role on public.user_permissions(role_id) where deleted_at is null;
create index if not exists idx_clients_name on public.clients(law_firm_id, name) where deleted_at is null;
create index if not exists idx_clients_tax_id on public.clients(law_firm_id, tax_id) where deleted_at is null;
create index if not exists idx_files_law_firm on public.files(law_firm_id) where deleted_at is null;
create index if not exists idx_files_legacy_id on public.files(law_firm_id, legacy_id) where deleted_at is null;
create index if not exists idx_files_type_status on public.files(law_firm_id, file_type, status) where deleted_at is null;
create index if not exists idx_files_follow_type on public.files(law_firm_id, follow_type) where deleted_at is null;
create index if not exists idx_files_file_no on public.files(law_firm_id, file_no) where deleted_at is null;
create index if not exists idx_files_responsible on public.files(responsible_profile_id) where deleted_at is null;
create index if not exists idx_file_parties_file on public.file_parties(file_id) where deleted_at is null;
create index if not exists idx_file_parties_client on public.file_parties(client_id) where deleted_at is null;
create index if not exists idx_file_parties_name on public.file_parties(law_firm_id, name) where deleted_at is null;
create index if not exists idx_file_parties_tax_id on public.file_parties(law_firm_id, tax_id) where deleted_at is null;
create index if not exists idx_hearings_file on public.hearings(file_id) where deleted_at is null;
create index if not exists idx_hearings_date on public.hearings(law_firm_id, hearing_date) where deleted_at is null;
create index if not exists idx_hearings_attendee on public.hearings(attendee_profile_id) where deleted_at is null;
create index if not exists idx_deadlines_file on public.deadlines(file_id) where deleted_at is null;
create index if not exists idx_deadlines_due on public.deadlines(law_firm_id, due_date) where deleted_at is null;
create index if not exists idx_deadlines_status on public.deadlines(law_firm_id, status) where deleted_at is null;
create index if not exists idx_deadlines_responsible on public.deadlines(responsible_profile_id) where deleted_at is null;
create index if not exists idx_tasks_file on public.tasks(file_id) where deleted_at is null;
create index if not exists idx_tasks_due on public.tasks(law_firm_id, due_date) where deleted_at is null;
create index if not exists idx_tasks_status on public.tasks(law_firm_id, status) where deleted_at is null;
create index if not exists idx_tasks_responsible on public.tasks(responsible_profile_id) where deleted_at is null;
create index if not exists idx_documents_file on public.documents(file_id) where deleted_at is null;
create index if not exists idx_documents_category on public.documents(law_firm_id, category) where deleted_at is null;
create index if not exists idx_payment_plans_file on public.payment_plans(file_id) where deleted_at is null;
create index if not exists idx_payment_plans_client on public.payment_plans(client_id) where deleted_at is null;
create index if not exists idx_payment_installments_plan on public.payment_installments(payment_plan_id) where deleted_at is null;
create index if not exists idx_payment_installments_due on public.payment_installments(law_firm_id, due_date) where deleted_at is null;
create index if not exists idx_collections_file on public.collections(file_id) where deleted_at is null;
create index if not exists idx_collections_plan on public.collections(payment_plan_id) where deleted_at is null;
create index if not exists idx_collections_date on public.collections(law_firm_id, collection_date) where deleted_at is null;
create index if not exists idx_interest_rates_type_dates on public.interest_rates(law_firm_id, interest_type, from_date, to_date) where deleted_at is null;
create index if not exists idx_attorney_fee_tariffs_dates on public.attorney_fee_tariffs(law_firm_id, from_date, to_date) where deleted_at is null;
create index if not exists idx_attorney_fee_brackets_tariff on public.attorney_fee_brackets(tariff_id) where deleted_at is null;
create index if not exists idx_timeline_events_file_date on public.timeline_events(file_id, event_date) where deleted_at is null;
create index if not exists idx_file_notes_file on public.file_notes(file_id) where deleted_at is null;
create index if not exists idx_supporting_documents_file on public.supporting_documents(file_id) where deleted_at is null;
create index if not exists idx_enforcement_accounts_file on public.enforcement_accounts(file_id) where deleted_at is null;
create index if not exists idx_settings_key on public.settings(law_firm_id, setting_key) where deleted_at is null;
create index if not exists idx_migration_logs_key on public.migration_logs(law_firm_id, migration_key) where deleted_at is null;
