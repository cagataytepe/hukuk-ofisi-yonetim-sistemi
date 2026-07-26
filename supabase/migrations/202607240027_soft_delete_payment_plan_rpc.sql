-- Move payment plan soft delete into an explicit, permission-checked RPC.
-- Hard delete remains disabled; the row is kept and only deleted_at is filled.

create or replace function public.soft_delete_payment_plan(p_payment_plan_id uuid)
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
    raise exception 'Odeme plani silme yetkiniz yok.'
      using errcode = '42501';
  end if;

  update public.payment_installments i
     set deleted_at = now(),
         updated_at = now()
   where i.payment_plan_id = p_payment_plan_id
     and i.deleted_at is null;

  return query
    update public.payment_plans p
       set deleted_at = now(),
           updated_at = now()
     where p.id = p_payment_plan_id
       and p.deleted_at is null
     returning p.id, p.deleted_at;

  get diagnostics v_updated_count = row_count;

  if v_updated_count = 0 then
    raise exception 'Odeme plani kaydi bulunamadi veya zaten silinmis.'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.soft_delete_payment_plan(uuid) from public;
revoke all on function public.soft_delete_payment_plan(uuid) from anon;
grant execute on function public.soft_delete_payment_plan(uuid) to authenticated;
