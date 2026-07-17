select to_regclass('public.law_firms') as law_firms_table;

select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and column_name = 'law_firm_id'
order by table_name;

select routine_schema, routine_name, security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'current_law_firm_id',
    'is_law_firm_member',
    'ensure_law_firm_role',
    'is_active_profile',
    'has_permission',
    'has_any_permission',
    'handle_new_auth_user',
    'bootstrap_first_admin'
  )
order by routine_name;

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles',
    'roles',
    'user_permissions',
    'settings',
    'files',
    'hearings',
    'deadlines',
    'tasks',
    'documents',
    'payment_plans'
  )
order by tablename, policyname;

select p.id, p.email, p.display_name, p.username, r.name as role_name
from public.profiles p
left join public.roles r on r.id = p.role_id
where p.deleted_at is null
order by p.created_at desc;
