-- Move deadline soft delete into an explicit, permission-checked RPC.
-- This keeps hard delete disabled and avoids direct PATCH RLS edge cases.

create or replace function public.soft_delete_deadline(p_deadline_id uuid)
returns table(id uuid, deleted_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile record;
  v_has_permission boolean := false;
  v_updated_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.'
      using errcode = '28000';
  end if;

  select
    p.id,
    p.role_id,
    p.is_active,
    p.deleted_at,
    r.name as role_name
  into v_profile
  from public.profiles p
  left join public.roles r
    on r.id = p.role_id
   and r.deleted_at is null
  where p.id = v_user_id
  limit 1;

  if v_profile.id is null or v_profile.deleted_at is not null or coalesce(v_profile.is_active, false) = false then
    raise exception 'Aktif kullanici profili bulunamadi.'
      using errcode = '28000';
  end if;

  select
    coalesce(v_profile.role_name in ('Yönetici / Partner', 'Tam Yetkili'), false)
    or exists (
      select 1
      from public.user_permissions up
      where up.deleted_at is null
        and up.allowed = true
        and up.permission_key in ('delete', 'manageUsers')
        and (
          up.profile_id = v_profile.id
          or (up.profile_id is null and up.role_id = v_profile.role_id)
        )
    )
  into v_has_permission;

  if not coalesce(v_has_permission, false) then
    raise exception 'Sureli is silme yetkiniz yok.'
      using errcode = '42501';
  end if;

  return query
    update public.deadlines d
       set deleted_at = now(),
           updated_at = now()
     where d.id = p_deadline_id
       and d.deleted_at is null
     returning d.id, d.deleted_at;

  get diagnostics v_updated_count = row_count;

  if v_updated_count = 0 then
    raise exception 'Sureli is kaydi bulunamadi veya zaten silinmis.'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.soft_delete_deadline(uuid) from public;
revoke all on function public.soft_delete_deadline(uuid) from anon;
grant execute on function public.soft_delete_deadline(uuid) to authenticated;
