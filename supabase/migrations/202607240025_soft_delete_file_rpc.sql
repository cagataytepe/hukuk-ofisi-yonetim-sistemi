-- Move file soft delete into an explicit, permission-checked RPC.
-- Hard delete remains disabled; the row is kept and only deleted_at is filled.

create or replace function public.soft_delete_file(p_file_id uuid)
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
    p.deleted_at
  into v_profile
  from public.profiles p
  where p.id = v_user_id
  limit 1;

  if v_profile.id is null or v_profile.deleted_at is not null or coalesce(v_profile.is_active, false) = false then
    raise exception 'Aktif kullanici profili bulunamadi.'
      using errcode = '28000';
  end if;

  select public.has_permission('delete') or public.has_permission('manageUsers')
  into v_has_permission;

  if not coalesce(v_has_permission, false) then
    raise exception 'Dosya silme yetkiniz yok.'
      using errcode = '42501';
  end if;

  return query
    update public.files f
       set deleted_at = now(),
           updated_at = now(),
           updated_by = v_user_id
     where f.id = p_file_id
       and f.deleted_at is null
     returning f.id, f.deleted_at;

  get diagnostics v_updated_count = row_count;

  if v_updated_count = 0 then
    raise exception 'Dosya kaydi bulunamadi veya zaten silinmis.'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.soft_delete_file(uuid) from public;
revoke all on function public.soft_delete_file(uuid) from anon;
grant execute on function public.soft_delete_file(uuid) to authenticated;
