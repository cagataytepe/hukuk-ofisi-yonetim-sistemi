-- Ensure authenticated users with create/manageUsers permission can insert
-- hearings. Scoped only to public.hearings.

alter table if exists public.hearings enable row level security;

drop policy if exists hearings_single_tenant_insert_v2 on public.hearings;

create policy hearings_single_tenant_insert_v2 on public.hearings
for insert to authenticated
with check (
  public.is_active_profile()
  and public.has_any_permission(array['create', 'manageUsers'])
);
