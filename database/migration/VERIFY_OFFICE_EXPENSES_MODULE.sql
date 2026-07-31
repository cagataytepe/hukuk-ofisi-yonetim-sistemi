-- Salt okunur Ofis Giderleri modülü doğrulaması.
-- Bu dosya veri eklemez, güncellemez veya silmez.

select
  count(*) as total_categories,
  count(*) filter (where deleted_at is null) as non_deleted_categories,
  count(*) filter (where deleted_at is null and active = true) as active_categories,
  count(*) filter (where deleted_at is null and parent_id is null) as parent_categories,
  count(*) filter (where deleted_at is null and parent_id is not null) as child_categories
from public.office_expense_categories;

select
  id,
  parent_id,
  name,
  slug,
  active,
  sort_order,
  deleted_at
from public.office_expense_categories
where deleted_at is null
order by parent_id nulls first, sort_order, name;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'office_expense_categories',
    'office_expenses',
    'office_expense_recurring_templates',
    'office_expense_budgets',
    'office_expense_partner_shares'
  )
order by tablename, cmd, policyname;

select
  conrelid::regclass::text as table_name,
  conname as constraint_name,
  confrelid::regclass::text as referenced_table,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where contype = 'f'
  and conrelid in (
    'public.office_expense_categories'::regclass,
    'public.office_expenses'::regclass,
    'public.office_expense_recurring_templates'::regclass,
    'public.office_expense_budgets'::regclass,
    'public.office_expense_partner_shares'::regclass
  )
order by table_name, constraint_name;
