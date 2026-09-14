begin;

create or replace function public.update_interest_rate_period_end(
  p_interest_rate_id uuid,
  p_effective_to date,
  p_description text default null
)
returns public.interest_rates
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_row public.interest_rates%rowtype;
  next_row public.interest_rates%rowtype;
  updated_row public.interest_rates%rowtype;
begin
  if actor_id is null then
    raise exception 'Oturum gerekli.' using errcode = '42501';
  end if;
  if not public.is_active_profile() or not public.has_permission('manageUsers') then
    raise exception 'Hesaplama araçlarını yönetme yetkiniz yok.' using errcode = '42501';
  end if;

  select * into target_row
  from public.interest_rates
  where id = p_interest_rate_id
    and deleted_at is null
    and is_active = true
  for update;

  if target_row.id is null then
    raise exception 'Faiz dönemi bulunamadı.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtext('interest_rate:' || lower(btrim(target_row.interest_type))));

  select * into next_row
  from public.interest_rates
  where lower(btrim(interest_type)) = lower(btrim(target_row.interest_type))
    and from_date > target_row.from_date
    and deleted_at is null
    and is_active = true
  order by from_date asc
  limit 1
  for update;

  if p_effective_to is not null and p_effective_to < target_row.from_date then
    raise exception 'Bitiş tarihi yürürlük tarihinden önce olamaz.' using errcode = '22023';
  end if;

  if next_row.id is not null then
    if p_effective_to is null or p_effective_to <> next_row.from_date - 1 then
      raise exception 'Sonraki dönem bulunduğunda bitiş tarihi yeni dönemin başlangıcından bir gün önce olmalıdır.' using errcode = '22023';
    end if;
  end if;

  update public.interest_rates
  set to_date = p_effective_to,
      description = nullif(btrim(p_description), ''),
      updated_at = now(),
      updated_by_profile_id = actor_id
  where id = target_row.id
  returning * into updated_row;

  return updated_row;
end;
$$;

alter function public.update_interest_rate_period_end(uuid, date, text) owner to postgres;
revoke all on function public.update_interest_rate_period_end(uuid, date, text) from public, anon;
grant execute on function public.update_interest_rate_period_end(uuid, date, text) to authenticated;

commit;
