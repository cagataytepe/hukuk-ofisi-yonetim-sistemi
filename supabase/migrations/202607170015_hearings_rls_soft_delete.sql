-- Tighten public.hearings update policy so soft delete requires delete/manageUsers.
-- Forward-only and scoped only to hearings.

alter table if exists public.hearings enable row level security;

drop policy if exists single_tenant_update on public.hearings;

create policy hearings_single_tenant_update on public.hearings
for update to authenticated
using (
  public.is_active_profile()
  and deleted_at is null
  and public.has_any_permission(array['edit', 'delete', 'manageUsers'])
)
with check (
  public.is_active_profile()
  and (
    (
      deleted_at is null
      and public.has_any_permission(array['edit', 'manageUsers'])
    )
    or (
      deleted_at is not null
      and public.has_any_permission(array['delete', 'manageUsers'])
    )
  )
);
