select trigger_name, event_object_schema, event_object_table, action_statement
from information_schema.triggers
where event_object_schema = 'auth'
  and event_object_table = 'users'
  and trigger_name = 'on_auth_user_created';

select routine_schema, routine_name, security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'is_active_profile',
    'has_permission',
    'has_any_permission',
    'handle_new_auth_user',
    'bootstrap_first_admin',
    'ensure_role',
    'grant_profile_permissions'
  )
order by routine_name;

select routine_schema, routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'current_law_firm_id',
    'is_law_firm_member',
    'ensure_law_firm_role'
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
