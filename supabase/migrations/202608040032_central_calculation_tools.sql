-- Central, auditable calculation tools for the single-tenant BKT application.
-- Forward-only: existing interest and attorney fee history is preserved.

alter table public.interest_rates
  add column if not exists is_active boolean not null default true,
  add column if not exists description text,
  add column if not exists created_by_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by_profile_id uuid references public.profiles(id) on delete set null;

alter table public.attorney_fee_tariffs
  add column if not exists tariff_year integer,
  add column if not exists scope text not null default 'İcra',
  add column if not exists maximum_amount numeric(14,2),
  add column if not exists is_active boolean not null default true,
  add column if not exists description text,
  add column if not exists created_by_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by_profile_id uuid references public.profiles(id) on delete set null;

alter table public.attorney_fee_brackets
  add column if not exists is_active boolean not null default true,
  add column if not exists created_by_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by_profile_id uuid references public.profiles(id) on delete set null;

update public.attorney_fee_tariffs
set tariff_year = coalesce(
  nullif(substring(name from '[0-9]{4}'), '')::integer,
  extract(year from from_date)::integer
)
where tariff_year is null;

create table if not exists public.calculation_parameters (
  id uuid primary key default gen_random_uuid(),
  parameter_group text not null,
  parameter_key text not null,
  label text not null,
  numeric_value numeric(14,4),
  text_value text,
  unit text,
  from_date date,
  to_date date,
  is_active boolean not null default true,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint calculation_parameters_value_required check (numeric_value is not null or nullif(btrim(text_value), '') is not null),
  constraint calculation_parameters_date_order check (to_date is null or from_date is null or to_date >= from_date)
);

drop trigger if exists set_calculation_parameters_updated_at on public.calculation_parameters;
create trigger set_calculation_parameters_updated_at
before update on public.calculation_parameters
for each row execute function public.set_updated_at();

create unique index if not exists uq_interest_rates_type_from
  on public.interest_rates ((lower(btrim(interest_type))), from_date)
  where deleted_at is null;

create unique index if not exists uq_attorney_fee_tariffs_scope_from
  on public.attorney_fee_tariffs ((lower(btrim(scope))), from_date)
  where deleted_at is null;

create unique index if not exists uq_calculation_parameters_key_from
  on public.calculation_parameters ((lower(btrim(parameter_key))), (coalesce(from_date, date '0001-01-01')))
  where deleted_at is null;

create index if not exists idx_interest_rates_effective
  on public.interest_rates ((lower(btrim(interest_type))), from_date, to_date)
  where deleted_at is null and is_active = true;

create index if not exists idx_attorney_fee_tariffs_effective
  on public.attorney_fee_tariffs ((lower(btrim(scope))), from_date, to_date)
  where deleted_at is null and is_active = true;

create index if not exists idx_calculation_parameters_effective
  on public.calculation_parameters ((lower(btrim(parameter_key))), from_date, to_date)
  where deleted_at is null and is_active = true;

insert into public.calculation_parameters
  (parameter_group, parameter_key, label, numeric_value, unit, description, metadata)
select seed.parameter_group, seed.parameter_key, seed.label, seed.numeric_value, seed.unit, seed.description, seed.metadata
from (values
  ('Tahsil Harcı', 'collection_fee_rate_9_10', 'Tahsil Harcı %9,10', 9.10::numeric, '%', 'Dosya formundaki seçilebilir harç oranı.', '{"catalog":true,"sortOrder":1}'::jsonb),
  ('Tahsil Harcı', 'collection_fee_rate_4_55', 'Tahsil Harcı %4,55', 4.55::numeric, '%', 'Dosya formundaki seçilebilir harç oranı.', '{"catalog":true,"sortOrder":2}'::jsonb),
  ('Tahsil Harcı', 'collection_fee_rate_2_275', 'Tahsil Harcı %2,275', 2.275::numeric, '%', 'Dosya formundaki seçilebilir harç oranı.', '{"catalog":true,"sortOrder":3}'::jsonb),
  ('Tahsil Harcı', 'collection_fee_rate_11_38', 'Tahsil Harcı %11,38', 11.38::numeric, '%', 'Dosya formundaki seçilebilir harç oranı.', '{"catalog":true,"sortOrder":4}'::jsonb),
  ('Kambiyo', 'cheque_compensation_rate', 'Çek Tazminatı Oranı', 10::numeric, '%', 'Kambiyo takibinde isteğe bağlı çek tazminatı oranı.', '{"sortOrder":10}'::jsonb),
  ('Kambiyo', 'promissory_note_commission_rate', 'Bono Komisyonu Oranı', 0.3::numeric, '%', 'Kambiyo takibinde isteğe bağlı bono komisyonu oranı.', '{"sortOrder":11}'::jsonb),
  ('Faiz Hesabı', 'interest_day_basis', 'Faiz Gün Bazı', 365::numeric, 'gün', 'Basit faiz hesabında kullanılan yıllık gün paydası.', '{"sortOrder":20}'::jsonb)
) as seed(parameter_group, parameter_key, label, numeric_value, unit, description, metadata)
where not exists (
  select 1
  from public.calculation_parameters existing
  where lower(btrim(existing.parameter_key)) = lower(btrim(seed.parameter_key))
    and existing.from_date is null
    and existing.deleted_at is null
);

alter table public.interest_rates enable row level security;
alter table public.attorney_fee_tariffs enable row level security;
alter table public.attorney_fee_brackets enable row level security;
alter table public.calculation_parameters enable row level security;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('interest_rates', 'attorney_fee_tariffs', 'attorney_fee_brackets', 'calculation_parameters')
  loop
    execute format('drop policy if exists %I on %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end
$$;

create policy calculation_interest_rates_select
on public.interest_rates for select to authenticated
using (public.is_active_profile() and deleted_at is null);

create policy calculation_attorney_tariffs_select
on public.attorney_fee_tariffs for select to authenticated
using (public.is_active_profile() and deleted_at is null);

create policy calculation_attorney_brackets_select
on public.attorney_fee_brackets for select to authenticated
using (public.is_active_profile() and deleted_at is null);

create policy calculation_parameters_select
on public.calculation_parameters for select to authenticated
using (public.is_active_profile() and deleted_at is null);

revoke all on public.interest_rates, public.attorney_fee_tariffs, public.attorney_fee_brackets, public.calculation_parameters from anon;
revoke insert, update, delete on public.interest_rates, public.attorney_fee_tariffs, public.attorney_fee_brackets, public.calculation_parameters from authenticated;
grant select on public.interest_rates, public.attorney_fee_tariffs, public.attorney_fee_brackets, public.calculation_parameters to authenticated;

create or replace function public.create_interest_rate_period(
  p_interest_type text,
  p_rate numeric,
  p_effective_from date,
  p_description text default null,
  p_source text default 'Manuel'
)
returns public.interest_rates
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_type text := btrim(p_interest_type);
  previous_row public.interest_rates%rowtype;
  next_row public.interest_rates%rowtype;
  inserted_row public.interest_rates%rowtype;
begin
  if actor_id is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if not public.is_active_profile() or not public.has_permission('manageUsers') then
    raise exception 'Hesaplama araçlarını yönetme yetkiniz yok.' using errcode = '42501';
  end if;
  if normalized_type = '' or p_effective_from is null or p_rate is null or p_rate <= 0 then
    raise exception 'Faiz türü, pozitif oran ve yürürlük tarihi zorunludur.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('interest_rate:' || lower(normalized_type)));
  if exists (
    select 1 from public.interest_rates
    where lower(btrim(interest_type)) = lower(normalized_type)
      and from_date = p_effective_from
      and deleted_at is null
  ) then
    raise exception 'Aynı faiz türü ve yürürlük tarihi için kayıt zaten var.' using errcode = '23505';
  end if;

  select * into previous_row
  from public.interest_rates
  where lower(btrim(interest_type)) = lower(normalized_type)
    and from_date < p_effective_from
    and deleted_at is null
  order by from_date desc
  limit 1
  for update;

  select * into next_row
  from public.interest_rates
  where lower(btrim(interest_type)) = lower(normalized_type)
    and from_date > p_effective_from
    and deleted_at is null
  order by from_date asc
  limit 1
  for update;

  if previous_row.id is not null then
    update public.interest_rates
    set to_date = p_effective_from - 1,
        updated_by_profile_id = actor_id,
        updated_at = now()
    where id = previous_row.id;
  end if;

  insert into public.interest_rates
    (interest_type, from_date, to_date, rate, source, description, is_active, created_by_profile_id, updated_by_profile_id)
  values
    (normalized_type, p_effective_from, case when next_row.id is null then null else next_row.from_date - 1 end,
     p_rate, nullif(btrim(p_source), ''), nullif(btrim(p_description), ''), true, actor_id, actor_id)
  returning * into inserted_row;

  return inserted_row;
end;
$$;

create or replace function public.deactivate_interest_rate_period(p_interest_rate_id uuid)
returns public.interest_rates
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_row public.interest_rates%rowtype;
  previous_row public.interest_rates%rowtype;
begin
  if actor_id is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if not public.is_active_profile() or not public.has_permission('manageUsers') then
    raise exception 'Hesaplama araçlarını yönetme yetkiniz yok.' using errcode = '42501';
  end if;
  select * into target_row from public.interest_rates where id = p_interest_rate_id and deleted_at is null for update;
  if target_row.id is null then raise exception 'Faiz dönemi bulunamadı.' using errcode = 'P0002'; end if;
  if target_row.from_date <= current_date then
    raise exception 'Yürürlüğe girmiş faiz dönemi pasifleştirilemez.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.interest_rates
    where lower(btrim(interest_type)) = lower(btrim(target_row.interest_type))
      and from_date > target_row.from_date and deleted_at is null
  ) then
    raise exception 'Yalnızca en son gelecek dönem pasifleştirilebilir.' using errcode = '22023';
  end if;
  update public.interest_rates
  set is_active = false, deleted_at = now(), updated_at = now(), updated_by_profile_id = actor_id
  where id = target_row.id
  returning * into target_row;

  select * into previous_row
  from public.interest_rates
  where lower(btrim(interest_type)) = lower(btrim(target_row.interest_type))
    and from_date < target_row.from_date and deleted_at is null
  order by from_date desc limit 1 for update;
  if previous_row.id is not null then
    update public.interest_rates
    set to_date = null, updated_at = now(), updated_by_profile_id = actor_id
    where id = previous_row.id;
  end if;
  return target_row;
end;
$$;

create or replace function public.create_attorney_fee_tariff(
  p_name text,
  p_tariff_year integer,
  p_scope text,
  p_effective_from date,
  p_regular_minimum numeric,
  p_eviction_minimum numeric,
  p_maximum_amount numeric default null,
  p_description text default null,
  p_brackets jsonb default '[]'::jsonb
)
returns public.attorney_fee_tariffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_scope text := coalesce(nullif(btrim(p_scope), ''), 'İcra');
  previous_row public.attorney_fee_tariffs%rowtype;
  next_row public.attorney_fee_tariffs%rowtype;
  inserted_row public.attorney_fee_tariffs%rowtype;
  bracket_row record;
  bracket_count integer;
begin
  if actor_id is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if not public.is_active_profile() or not public.has_permission('manageUsers') then
    raise exception 'Hesaplama araçlarını yönetme yetkiniz yok.' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null or p_tariff_year is null or p_effective_from is null
     or p_regular_minimum < 0 or p_eviction_minimum < 0 or (p_maximum_amount is not null and p_maximum_amount < 0) then
    raise exception 'Tarife başlığı, yılı, tarihi ve geçerli tutarlar zorunludur.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_brackets) <> 'array' or jsonb_array_length(p_brackets) = 0 then
    raise exception 'En az bir tarife dilimi zorunludur.' using errcode = '22023';
  end if;
  select count(*) into bracket_count
  from jsonb_array_elements(p_brackets) item
  where nullif(item->>'limit', '') is null;
  if bracket_count <> 1 or nullif((p_brackets -> -1)->>'limit', '') is not null then
    raise exception 'Yalnızca son tarife dilimi üst sınırsız olabilir.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_brackets) item
    where coalesce(nullif(item->>'rate', '')::numeric, 0) <= 0
       or (nullif(item->>'limit', '') is not null and (item->>'limit')::numeric <= 0)
  ) then
    raise exception 'Tarife dilimi tutar ve oranlarını kontrol edin.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('attorney_tariff:' || lower(normalized_scope)));
  if exists (
    select 1 from public.attorney_fee_tariffs
    where lower(btrim(scope)) = lower(normalized_scope)
      and from_date = p_effective_from and deleted_at is null
  ) then
    raise exception 'Aynı kapsam ve yürürlük tarihi için tarife zaten var.' using errcode = '23505';
  end if;

  select * into previous_row
  from public.attorney_fee_tariffs
  where lower(btrim(scope)) = lower(normalized_scope)
    and from_date < p_effective_from and deleted_at is null
  order by from_date desc limit 1 for update;
  select * into next_row
  from public.attorney_fee_tariffs
  where lower(btrim(scope)) = lower(normalized_scope)
    and from_date > p_effective_from and deleted_at is null
  order by from_date asc limit 1 for update;

  if previous_row.id is not null then
    update public.attorney_fee_tariffs
    set to_date = p_effective_from - 1, updated_at = now(), updated_by_profile_id = actor_id
    where id = previous_row.id;
  end if;

  insert into public.attorney_fee_tariffs
    (name, tariff_year, scope, from_date, to_date, regular_minimum, eviction_minimum,
     maximum_amount, is_active, description, created_by_profile_id, updated_by_profile_id)
  values
    (btrim(p_name), p_tariff_year, normalized_scope, p_effective_from,
     case when next_row.id is null then null else next_row.from_date - 1 end,
     p_regular_minimum, p_eviction_minimum, p_maximum_amount, true,
     nullif(btrim(p_description), ''), actor_id, actor_id)
  returning * into inserted_row;

  for bracket_row in
    select item, ordinality
    from jsonb_array_elements(p_brackets) with ordinality as rows(item, ordinality)
  loop
    insert into public.attorney_fee_brackets
      (tariff_id, sequence_no, limit_amount, rate, is_active, created_by_profile_id, updated_by_profile_id)
    values
      (inserted_row.id, bracket_row.ordinality,
       nullif(bracket_row.item->>'limit', '')::numeric,
       (bracket_row.item->>'rate')::numeric, true, actor_id, actor_id);
  end loop;
  return inserted_row;
end;
$$;

create or replace function public.deactivate_attorney_fee_tariff(p_tariff_id uuid)
returns public.attorney_fee_tariffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_row public.attorney_fee_tariffs%rowtype;
  previous_row public.attorney_fee_tariffs%rowtype;
begin
  if actor_id is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if not public.is_active_profile() or not public.has_permission('manageUsers') then
    raise exception 'Hesaplama araçlarını yönetme yetkiniz yok.' using errcode = '42501';
  end if;
  select * into target_row from public.attorney_fee_tariffs where id = p_tariff_id and deleted_at is null for update;
  if target_row.id is null then raise exception 'Tarife bulunamadı.' using errcode = 'P0002'; end if;
  if target_row.from_date <= current_date then
    raise exception 'Yürürlüğe girmiş tarife pasifleştirilemez.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.attorney_fee_tariffs
    where lower(btrim(scope)) = lower(btrim(target_row.scope))
      and from_date > target_row.from_date and deleted_at is null
  ) then
    raise exception 'Yalnızca en son gelecek tarife pasifleştirilebilir.' using errcode = '22023';
  end if;
  update public.attorney_fee_tariffs
  set is_active = false, deleted_at = now(), updated_at = now(), updated_by_profile_id = actor_id
  where id = target_row.id returning * into target_row;
  select * into previous_row
  from public.attorney_fee_tariffs
  where lower(btrim(scope)) = lower(btrim(target_row.scope))
    and from_date < target_row.from_date and deleted_at is null
  order by from_date desc limit 1 for update;
  if previous_row.id is not null then
    update public.attorney_fee_tariffs
    set to_date = null, updated_at = now(), updated_by_profile_id = actor_id
    where id = previous_row.id;
  end if;
  return target_row;
end;
$$;

create or replace function public.create_calculation_parameter_period(
  p_parameter_key text,
  p_numeric_value numeric,
  p_effective_from date,
  p_description text default null
)
returns public.calculation_parameters
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_key text := btrim(p_parameter_key);
  template_row public.calculation_parameters%rowtype;
  previous_row public.calculation_parameters%rowtype;
  next_row public.calculation_parameters%rowtype;
  inserted_row public.calculation_parameters%rowtype;
begin
  if actor_id is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
  if not public.is_active_profile() or not public.has_permission('manageUsers') then
    raise exception 'Hesaplama araçlarını yönetme yetkiniz yok.' using errcode = '42501';
  end if;
  if normalized_key = '' or p_numeric_value is null or p_numeric_value <= 0 or p_effective_from is null then
    raise exception 'Parametre, pozitif değer ve yürürlük tarihi zorunludur.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('calculation_parameter:' || lower(normalized_key)));
  select * into template_row
  from public.calculation_parameters
  where lower(btrim(parameter_key)) = lower(normalized_key) and deleted_at is null
  order by from_date desc nulls last, created_at desc limit 1;
  if template_row.id is null then raise exception 'Tanımlı hesaplama parametresi bulunamadı.' using errcode = 'P0002'; end if;
  if exists (
    select 1 from public.calculation_parameters
    where lower(btrim(parameter_key)) = lower(normalized_key)
      and from_date = p_effective_from and deleted_at is null
  ) then
    raise exception 'Aynı yürürlük tarihli parametre kaydı zaten var.' using errcode = '23505';
  end if;
  select * into previous_row
  from public.calculation_parameters
  where lower(btrim(parameter_key)) = lower(normalized_key)
    and (from_date is null or from_date < p_effective_from) and deleted_at is null
  order by from_date desc nulls last, created_at desc limit 1 for update;
  select * into next_row
  from public.calculation_parameters
  where lower(btrim(parameter_key)) = lower(normalized_key)
    and from_date > p_effective_from and deleted_at is null
  order by from_date asc limit 1 for update;
  if previous_row.id is not null then
    update public.calculation_parameters
    set to_date = p_effective_from - 1, updated_at = now(), updated_by_profile_id = actor_id
    where id = previous_row.id;
  end if;
  insert into public.calculation_parameters
    (parameter_group, parameter_key, label, numeric_value, text_value, unit, from_date, to_date,
     is_active, description, metadata, created_by_profile_id, updated_by_profile_id)
  values
    (template_row.parameter_group, template_row.parameter_key, template_row.label, p_numeric_value,
     template_row.text_value, template_row.unit, p_effective_from,
     case when next_row.id is null then null else next_row.from_date - 1 end,
     true, coalesce(nullif(btrim(p_description), ''), template_row.description), template_row.metadata,
     actor_id, actor_id)
  returning * into inserted_row;
  return inserted_row;
end;
$$;

alter function public.create_interest_rate_period(text, numeric, date, text, text) owner to postgres;
alter function public.deactivate_interest_rate_period(uuid) owner to postgres;
alter function public.create_attorney_fee_tariff(text, integer, text, date, numeric, numeric, numeric, text, jsonb) owner to postgres;
alter function public.deactivate_attorney_fee_tariff(uuid) owner to postgres;
alter function public.create_calculation_parameter_period(text, numeric, date, text) owner to postgres;

revoke all on function public.create_interest_rate_period(text, numeric, date, text, text) from public, anon;
revoke all on function public.deactivate_interest_rate_period(uuid) from public, anon;
revoke all on function public.create_attorney_fee_tariff(text, integer, text, date, numeric, numeric, numeric, text, jsonb) from public, anon;
revoke all on function public.deactivate_attorney_fee_tariff(uuid) from public, anon;
revoke all on function public.create_calculation_parameter_period(text, numeric, date, text) from public, anon;

grant execute on function public.create_interest_rate_period(text, numeric, date, text, text) to authenticated;
grant execute on function public.deactivate_interest_rate_period(uuid) to authenticated;
grant execute on function public.create_attorney_fee_tariff(text, integer, text, date, numeric, numeric, numeric, text, jsonb) to authenticated;
grant execute on function public.deactivate_attorney_fee_tariff(uuid) to authenticated;
grant execute on function public.create_calculation_parameter_period(text, numeric, date, text) to authenticated;
