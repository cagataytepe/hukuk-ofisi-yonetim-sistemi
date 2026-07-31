begin;

alter table public.office_expenses
  add column if not exists payment_source text,
  add column if not exists contributes_to_partner_share boolean not null default false;

alter table public.office_expense_recurring_templates
  add column if not exists payment_source text,
  add column if not exists contributes_to_partner_share boolean not null default false;

alter table public.office_expenses
  drop constraint if exists office_expenses_payment_source_check,
  add constraint office_expenses_payment_source_check
    check (payment_source is null or payment_source in ('office_account', 'office_cash', 'partner_personal')) not valid,
  drop constraint if exists office_expenses_partner_contribution_check,
  add constraint office_expenses_partner_contribution_check check (
    payment_source is null
    or (
      payment_source in ('office_account', 'office_cash')
      and contributes_to_partner_share = false
      and paid_by_profile_id is null
    )
    or (
      payment_source = 'partner_personal'
      and contributes_to_partner_share = true
      and paid_by_profile_id is not null
    )
  ) not valid;

alter table public.office_expense_recurring_templates
  drop constraint if exists office_expense_recurring_payment_source_check,
  add constraint office_expense_recurring_payment_source_check
    check (payment_source is null or payment_source in ('office_account', 'office_cash', 'partner_personal')) not valid,
  drop constraint if exists office_expense_recurring_partner_contribution_check,
  add constraint office_expense_recurring_partner_contribution_check check (
    payment_source is null
    or (
      payment_source in ('office_account', 'office_cash')
      and contributes_to_partner_share = false
      and default_paid_by_profile_id is null
    )
    or (
      payment_source = 'partner_personal'
      and contributes_to_partner_share = true
      and default_paid_by_profile_id is not null
    )
  ) not valid;

create or replace function public.enforce_office_expense_payment_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.payment_source is null then
    new.payment_source := case
      when new.payment_method = 'office_account' then 'office_account'
      when new.paid_by_profile_id is not null then 'partner_personal'
      when new.payment_method = 'cash' then 'office_cash'
      else 'office_account'
    end;
  end if;

  if new.payment_source in ('office_account', 'office_cash') then
    new.contributes_to_partner_share := false;
    new.paid_by_profile_id := null;
  elsif new.payment_source = 'partner_personal' then
    if new.paid_by_profile_id is null then
      raise exception 'Kisisel hesap odemesinde ortak secimi zorunludur.' using errcode = '23514';
    end if;
    new.contributes_to_partner_share := true;
  else
    raise exception 'Gecersiz odeme kaynagi.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_recurring_office_expense_payment_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.payment_source is null then
    new.payment_source := case
      when new.payment_method = 'office_account' then 'office_account'
      when new.default_paid_by_profile_id is not null then 'partner_personal'
      when new.payment_method = 'cash' then 'office_cash'
      else 'office_account'
    end;
  end if;

  if new.payment_source in ('office_account', 'office_cash') then
    new.contributes_to_partner_share := false;
    new.default_paid_by_profile_id := null;
  elsif new.payment_source = 'partner_personal' then
    if new.default_paid_by_profile_id is null then
      raise exception 'Kisisel hesap odemesinde ortak secimi zorunludur.' using errcode = '23514';
    end if;
    new.contributes_to_partner_share := true;
  else
    raise exception 'Gecersiz odeme kaynagi.' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_office_expense_payment_source on public.office_expenses;
create trigger enforce_office_expense_payment_source
before insert or update of payment_source, payment_method, paid_by_profile_id, contributes_to_partner_share
on public.office_expenses
for each row execute function public.enforce_office_expense_payment_source();

drop trigger if exists enforce_recurring_office_expense_payment_source on public.office_expense_recurring_templates;
create trigger enforce_recurring_office_expense_payment_source
before insert or update of payment_source, payment_method, default_paid_by_profile_id, contributes_to_partner_share
on public.office_expense_recurring_templates
for each row execute function public.enforce_recurring_office_expense_payment_source();

create index if not exists idx_office_expenses_partner_contribution
  on public.office_expenses(paid_by_profile_id, expense_date)
  where deleted_at is null and contributes_to_partner_share = true;

create or replace function public.generate_due_office_expenses(p_until date default current_date)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  template_row public.office_expense_recurring_templates%rowtype;
  due_value date;
  generated_count integer := 0;
begin
  if auth.uid() is null or not public.is_active_profile() then raise exception 'Aktif oturum bulunamadi.' using errcode = '28000'; end if;
  if not public.has_any_permission(array['edit','manageUsers']) then raise exception 'Tekrarlayan gider uretme yetkiniz yok.' using errcode = '42501'; end if;
  if p_until is null or p_until > current_date + 366 then raise exception 'Gecersiz uretim tarihi.' using errcode = '22007'; end if;

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
        status, payment_method, payment_source, contributes_to_partner_share,
        paid_by_profile_id, vendor, recurring_template_id, created_by_profile_id, metadata
      ) values (
        template_row.title, template_row.description, due_value, due_value, template_row.amount,
        template_row.category_id, template_row.subcategory_id, 'pending', template_row.payment_method,
        template_row.payment_source, template_row.contributes_to_partner_share,
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

revoke all on function public.generate_due_office_expenses(date) from public, anon;
grant execute on function public.generate_due_office_expenses(date) to authenticated;

commit;

