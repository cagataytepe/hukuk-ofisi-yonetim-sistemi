begin;

create table if not exists public.office_expense_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.office_expense_categories(id),
  name text not null,
  slug text not null,
  icon text,
  color text,
  sort_order integer not null default 0,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.office_expense_recurring_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category_id uuid not null references public.office_expense_categories(id),
  subcategory_id uuid references public.office_expense_categories(id),
  amount numeric(14,2) not null check (amount > 0),
  frequency text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  interval_count integer not null default 1 check (interval_count > 0),
  day_of_month integer check (day_of_month between 1 and 31),
  month_of_year integer check (month_of_year between 1 and 12),
  start_date date not null,
  end_date date,
  next_due_date date,
  payment_method text check (payment_method is null or payment_method in ('cash', 'bank_transfer', 'credit_card', 'debit_card', 'office_account', 'other')),
  default_paid_by_profile_id uuid references public.profiles(id),
  vendor text,
  active boolean not null default true,
  created_by_profile_id uuid references public.profiles(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (end_date is null or end_date >= start_date)
);

create table if not exists public.office_expenses (
  id uuid primary key default gen_random_uuid(),
  legacy_id text,
  title text not null,
  description text,
  expense_date date not null,
  due_date date,
  paid_at timestamptz,
  amount numeric(14,2) not null check (amount > 0),
  category_id uuid not null references public.office_expense_categories(id),
  subcategory_id uuid references public.office_expense_categories(id),
  status text not null default 'pending' check (status in ('pending', 'paid', 'overdue', 'cancelled')),
  payment_method text check (payment_method is null or payment_method in ('cash', 'bank_transfer', 'credit_card', 'debit_card', 'office_account', 'other')),
  paid_by_profile_id uuid references public.profiles(id),
  vendor text,
  invoice_number text,
  recurring_template_id uuid references public.office_expense_recurring_templates(id),
  created_by_profile_id uuid references public.profiles(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.office_expense_budgets (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.office_expense_categories(id),
  year integer not null check (year between 2000 and 2200),
  month integer check (month between 1 and 12),
  budget_amount numeric(14,2) not null check (budget_amount > 0),
  warning_percent numeric(5,2) not null default 80 check (warning_percent > 0 and warning_percent <= 100),
  created_by_profile_id uuid references public.profiles(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.office_expense_partner_shares (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  share_percent numeric(7,4) not null check (share_percent > 0 and share_percent <= 100),
  effective_from date not null,
  effective_to date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists uq_office_expense_category_slug_active
  on public.office_expense_categories (lower(trim(slug)))
  where deleted_at is null;
create unique index if not exists uq_office_expense_recurring_due_active
  on public.office_expenses (recurring_template_id, due_date)
  where recurring_template_id is not null and deleted_at is null;
create unique index if not exists uq_office_expense_budget_period_active
  on public.office_expense_budgets (coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid), year, coalesce(month, 0))
  where deleted_at is null;
create index if not exists idx_office_expenses_date on public.office_expenses(expense_date) where deleted_at is null;
create index if not exists idx_office_expenses_due on public.office_expenses(due_date) where deleted_at is null;
create index if not exists idx_office_expenses_category on public.office_expenses(category_id) where deleted_at is null;
create index if not exists idx_office_expenses_status on public.office_expenses(status) where deleted_at is null;
create index if not exists idx_office_expenses_paid_by on public.office_expenses(paid_by_profile_id) where deleted_at is null;
create index if not exists idx_office_recurring_next_due on public.office_expense_recurring_templates(next_due_date) where deleted_at is null and active = true;
create index if not exists idx_office_partner_shares_period on public.office_expense_partner_shares(profile_id, effective_from, effective_to) where deleted_at is null and active = true;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'office_expense_categories',
    'office_expenses',
    'office_expense_recurring_templates',
    'office_expense_budgets',
    'office_expense_partner_shares'
  ]
  loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', table_name, table_name);
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end;
$$;

do $$
declare
  parent_row record;
  child_name text;
  child_index integer;
  parent_index integer := 0;
  category_map jsonb := '{
    "Ofis": ["Kira","Aidat","Stopaj","Tadilat","Mobilya","Demirbaş"],
    "Faturalar": ["Elektrik","Su","Doğalgaz","İnternet","Sabit Telefon","Cep Telefonu"],
    "Personel": ["Maaş","SGK","Yemek","Yol","Prim","Personel Yan Hakları"],
    "Mutfak": ["Çay","Kahve","İçme Suyu","Atıştırmalık","Mutfak Sarf Malzemesi"],
    "Temizlik": ["Temizlik Hizmeti","Temizlik Malzemesi","Kağıt Havlu","Tuvalet Kağıdı","Sabun ve Hijyen"],
    "Ofis Sarf": ["Kağıt","Toner","Kartuş","Kalem","Dosya","Klasör","Zarf","Kargo"],
    "Hukuki ve Mesleki": ["Baro Aidatı","E-İmza","KEP","Noter","Mali Müşavir","Arabuluculuk Gideri","Bilirkişi / Uzman","UYAP ile İlgili Giderler"],
    "Ulaşım": ["Yakıt","Otopark","HGS / OGS","Taksi","Toplu Taşıma","Şehirlerarası Ulaşım","Konaklama"],
    "Yazılım ve Teknoloji": ["Microsoft 365","OpenAI","Claude","GitHub","Supabase","Adobe","Domain","Hosting","Antivirüs","Diğer Yazılım","Bilgisayar / Donanım","Teknik Servis"],
    "Temsil ve Ağırlama": ["Müvekkil Yemeği","Hediye","Organizasyon","Toplantı Gideri","Kurumsal Temsil"],
    "Vergi ve Banka": ["Vergi","Banka Komisyonu","Kredi Kartı Komisyonu","POS Komisyonu","Finansman Gideri"],
    "Diğer": ["Diğer Gider","Açıklanmamış Gider"]
  }'::jsonb;
begin
  for parent_row in select key, value from jsonb_each(category_map)
  loop
    parent_index := parent_index + 1;
    insert into public.office_expense_categories (name, slug, sort_order, metadata)
    values (
      parent_row.key,
      lower(regexp_replace(translate(parent_row.key, 'ÇĞİÖŞÜçğıöşü /', 'CGIOSUcgiosu--'), '[^a-zA-Z0-9-]+', '-', 'g')),
      parent_index * 100,
      jsonb_build_object('source', '028_office_expenses_module', 'seed', true)
    )
    on conflict (lower(trim(slug))) where deleted_at is null
    do update set name = excluded.name, active = true, updated_at = now();

    child_index := 0;
    for child_name in select jsonb_array_elements_text(parent_row.value)
    loop
      child_index := child_index + 1;
      insert into public.office_expense_categories (parent_id, name, slug, sort_order, metadata)
      select
        p.id,
        child_name,
        lower(regexp_replace(translate(parent_row.key || '-' || child_name, 'ÇĞİÖŞÜçğıöşü /', 'CGIOSUcgiosu--'), '[^a-zA-Z0-9-]+', '-', 'g')),
        parent_index * 100 + child_index,
        jsonb_build_object('source', '028_office_expenses_module', 'seed', true)
      from public.office_expense_categories p
      where p.parent_id is null
        and p.name = parent_row.key
        and p.deleted_at is null
      limit 1
      on conflict (lower(trim(slug))) where deleted_at is null
      do update set name = excluded.name, parent_id = excluded.parent_id, active = true, updated_at = now();
    end loop;
  end loop;
end;
$$;

create or replace function public.guard_office_expense_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null
     and not (public.has_permission('delete') or public.has_permission('manageUsers')) then
    raise exception 'Silme yetkiniz yok.' using errcode = '42501';
  end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'office_expense_categories',
    'office_expenses',
    'office_expense_recurring_templates',
    'office_expense_budgets',
    'office_expense_partner_shares'
  ]
  loop
    execute format('drop trigger if exists guard_%I_soft_delete on public.%I', table_name, table_name);
    execute format('create trigger guard_%I_soft_delete before update on public.%I for each row execute function public.guard_office_expense_soft_delete()', table_name, table_name);
  end loop;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'office_expense_categories',
    'office_expenses',
    'office_expense_recurring_templates',
    'office_expense_budgets',
    'office_expense_partner_shares'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists office_expense_select on public.%I', table_name);
    execute format('drop policy if exists office_expense_insert on public.%I', table_name);
    execute format('drop policy if exists office_expense_update on public.%I', table_name);
    execute format('create policy office_expense_select on public.%I for select to authenticated using (deleted_at is null and public.is_active_profile())', table_name);
  end loop;
end;
$$;

create policy office_expense_insert on public.office_expenses
for insert to authenticated with check (public.has_any_permission(array['create','edit','manageUsers']));
create policy office_expense_update on public.office_expenses
for update to authenticated using (deleted_at is null and public.has_any_permission(array['edit','manageUsers']))
with check (public.has_any_permission(array['edit','delete','manageUsers']));

create policy office_expense_insert on public.office_expense_recurring_templates
for insert to authenticated with check (public.has_any_permission(array['create','edit','manageUsers']));
create policy office_expense_update on public.office_expense_recurring_templates
for update to authenticated using (deleted_at is null and public.has_any_permission(array['edit','manageUsers']))
with check (public.has_any_permission(array['edit','delete','manageUsers']));

do $$
declare
  table_name text;
begin
  foreach table_name in array array['office_expense_categories','office_expense_budgets','office_expense_partner_shares']
  loop
    execute format('create policy office_expense_insert on public.%I for insert to authenticated with check (public.has_permission(''manageUsers''))', table_name);
    execute format('create policy office_expense_update on public.%I for update to authenticated using (deleted_at is null and public.has_permission(''manageUsers'')) with check (public.has_permission(''manageUsers''))', table_name);
  end loop;
end;
$$;

create or replace function public.soft_delete_office_expense(p_id uuid)
returns table(id uuid, deleted_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_active_profile() then raise exception 'Aktif oturum bulunamadı.' using errcode = '28000'; end if;
  if not (public.has_permission('delete') or public.has_permission('manageUsers')) then raise exception 'Gider silme yetkiniz yok.' using errcode = '42501'; end if;
  return query update public.office_expenses set deleted_at = now(), updated_at = now() where office_expenses.id = p_id and office_expenses.deleted_at is null returning office_expenses.id, office_expenses.deleted_at;
  if not found then raise exception 'Gider bulunamadı veya zaten silinmiş.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.soft_delete_office_expense_recurring_template(p_id uuid)
returns table(id uuid, deleted_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_active_profile() then raise exception 'Aktif oturum bulunamadı.' using errcode = '28000'; end if;
  if not (public.has_permission('delete') or public.has_permission('manageUsers')) then raise exception 'Şablon silme yetkiniz yok.' using errcode = '42501'; end if;
  return query update public.office_expense_recurring_templates set deleted_at = now(), updated_at = now() where office_expense_recurring_templates.id = p_id and office_expense_recurring_templates.deleted_at is null returning office_expense_recurring_templates.id, office_expense_recurring_templates.deleted_at;
  if not found then raise exception 'Şablon bulunamadı veya zaten silinmiş.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.soft_delete_office_expense_budget(p_id uuid)
returns table(id uuid, deleted_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_active_profile() then raise exception 'Aktif oturum bulunamadı.' using errcode = '28000'; end if;
  if not public.has_permission('manageUsers') then raise exception 'Bütçe silme yetkiniz yok.' using errcode = '42501'; end if;
  return query update public.office_expense_budgets set deleted_at = now(), updated_at = now() where office_expense_budgets.id = p_id and office_expense_budgets.deleted_at is null returning office_expense_budgets.id, office_expense_budgets.deleted_at;
  if not found then raise exception 'Bütçe bulunamadı veya zaten silinmiş.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.generate_due_office_expenses(p_until date default current_date)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  template_row public.office_expense_recurring_templates%rowtype;
  due_value date;
  generated_count integer := 0;
begin
  if auth.uid() is null or not public.is_active_profile() then raise exception 'Aktif oturum bulunamadı.' using errcode = '28000'; end if;
  if not public.has_any_permission(array['edit','manageUsers']) then raise exception 'Tekrarlayan gider üretme yetkiniz yok.' using errcode = '42501'; end if;
  if p_until is null or p_until > current_date + 366 then raise exception 'Geçersiz üretim tarihi.' using errcode = '22007'; end if;

  for template_row in
    select * from public.office_expense_recurring_templates
    where deleted_at is null and active = true and coalesce(next_due_date, start_date) <= p_until
    for update
  loop
    due_value := coalesce(template_row.next_due_date, template_row.start_date);
    while due_value <= p_until and (template_row.end_date is null or due_value <= template_row.end_date)
    loop
      insert into public.office_expenses (
        title, description, expense_date, due_date, amount, category_id, subcategory_id,
        status, payment_method, paid_by_profile_id, vendor, recurring_template_id,
        created_by_profile_id, metadata
      ) values (
        template_row.title, template_row.description, due_value, due_value, template_row.amount,
        template_row.category_id, template_row.subcategory_id, 'pending', template_row.payment_method,
        template_row.default_paid_by_profile_id, template_row.vendor, template_row.id, auth.uid(),
        jsonb_build_object('generatedBy', 'generate_due_office_expenses')
      )
      on conflict (recurring_template_id, due_date) where recurring_template_id is not null and deleted_at is null
      do nothing;
      if found then generated_count := generated_count + 1; end if;

      due_value := case template_row.frequency
        when 'weekly' then (due_value + make_interval(days => 7 * template_row.interval_count))::date
        when 'monthly' then (due_value + make_interval(months => template_row.interval_count))::date
        when 'quarterly' then (due_value + make_interval(months => 3 * template_row.interval_count))::date
        when 'yearly' then (due_value + make_interval(years => template_row.interval_count))::date
      end;
    end loop;
    update public.office_expense_recurring_templates
      set next_due_date = due_value, updated_at = now()
      where id = template_row.id;
  end loop;
  return generated_count;
end;
$$;

revoke all on function public.soft_delete_office_expense(uuid) from public, anon;
revoke all on function public.soft_delete_office_expense_recurring_template(uuid) from public, anon;
revoke all on function public.soft_delete_office_expense_budget(uuid) from public, anon;
revoke all on function public.generate_due_office_expenses(date) from public, anon;
grant execute on function public.soft_delete_office_expense(uuid) to authenticated;
grant execute on function public.soft_delete_office_expense_recurring_template(uuid) to authenticated;
grant execute on function public.soft_delete_office_expense_budget(uuid) to authenticated;
grant execute on function public.generate_due_office_expenses(date) to authenticated;

grant select, insert, update on public.office_expense_categories to authenticated;
grant select, insert, update on public.office_expenses to authenticated;
grant select, insert, update on public.office_expense_recurring_templates to authenticated;
grant select, insert, update on public.office_expense_budgets to authenticated;
grant select, insert, update on public.office_expense_partner_shares to authenticated;

commit;
