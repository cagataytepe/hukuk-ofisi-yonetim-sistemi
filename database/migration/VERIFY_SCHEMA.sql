select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'offices', 'profiles', 'roles', 'user_permissions',
    'clients', 'files', 'file_parties', 'hearings', 'deadlines',
    'tasks', 'documents', 'payment_plans', 'payment_installments',
    'collections', 'interest_rates', 'attorney_fee_tariffs',
    'attorney_fee_brackets', 'timeline_events', 'file_notes',
    'supporting_documents', 'enforcement_accounts', 'settings',
    'migration_logs'
  )
order by table_name;

select to_regclass('public.law_firms') as law_firms_table;

select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and column_name = 'law_firm_id'
order by table_name;

select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'offices', 'profiles', 'roles', 'user_permissions',
    'clients', 'files', 'file_parties', 'hearings', 'deadlines',
    'tasks', 'documents', 'payment_plans', 'payment_installments',
    'collections', 'interest_rates', 'attorney_fee_tariffs',
    'attorney_fee_brackets', 'timeline_events', 'file_notes',
    'supporting_documents', 'enforcement_accounts', 'settings',
    'migration_logs'
  )
order by tablename;

select tc.table_name, tc.constraint_name, tc.constraint_type
from information_schema.table_constraints tc
where tc.table_schema = 'public'
  and tc.constraint_type in ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE')
  and tc.table_name in (
    'offices', 'profiles', 'roles', 'user_permissions',
    'clients', 'files', 'file_parties', 'hearings', 'deadlines',
    'tasks', 'documents', 'payment_plans', 'payment_installments',
    'collections', 'interest_rates', 'attorney_fee_tariffs',
    'attorney_fee_brackets', 'timeline_events', 'file_notes',
    'supporting_documents', 'enforcement_accounts', 'settings',
    'migration_logs'
  )
order by tc.table_name, tc.constraint_type, tc.constraint_name;

select
  (select count(*) from public.files) as files,
  (select count(*) from public.hearings) as hearings,
  (select count(*) from public.deadlines) as deadlines,
  (select count(*) from public.tasks) as tasks,
  (select count(*) from public.payment_plans) as payment_plans,
  (select count(*) from public.settings) as settings;
