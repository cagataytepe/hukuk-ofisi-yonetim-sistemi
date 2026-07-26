-- Fix public.hearings soft delete RLS.
-- The PATCH sets deleted_at from NULL to NOW(); therefore WITH CHECK must not
-- require deleted_at to remain NULL after the update.
-- Forward-only and scoped only to public.hearings.

alter table if exists public.hearings enable row level security;

drop policy if exists single_tenant_update on public.hearings;
drop policy if exists hearings_single_tenant_update on public.hearings;
drop policy if exists hearings_single_tenant_edit_update on public.hearings;
drop policy if exists hearings_single_tenant_soft_delete on public.hearings;
drop policy if exists hearings_single_tenant_edit_update_v2 on public.hearings;
drop policy if exists hearings_single_tenant_soft_delete_v2 on public.hearings;

create policy hearings_single_tenant_edit_update_v2 on public.hearings
for update to authenticated
using (
  public.is_active_profile()
  and deleted_at is null
  and public.has_any_permission(array['edit', 'manageUsers'])
)
with check (
  public.is_active_profile()
  and deleted_at is null
  and public.has_any_permission(array['edit', 'manageUsers'])
);

create policy hearings_single_tenant_soft_delete_v2 on public.hearings
for update to authenticated
using (
  public.is_active_profile()
  and deleted_at is null
  and public.has_any_permission(array['delete', 'manageUsers'])
)
with check (
  public.is_active_profile()
  and public.has_any_permission(array['delete', 'manageUsers'])
);
