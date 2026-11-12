-- iOS cihazları APNs jetonuyla kaydedilir; jeton mevcut fcm_token sütununda tutulur.
-- Prepared only. Do not apply without release approval.
alter table public.push_devices drop constraint if exists push_devices_platform_check;
alter table public.push_devices
  add constraint push_devices_platform_check check (platform in ('android', 'ios'));
alter table public.push_devices
  add column if not exists apns_environment text
    check (apns_environment in ('sandbox', 'production'));
alter table public.push_devices
  drop constraint if exists push_devices_ios_environment_check;
alter table public.push_devices
  add constraint push_devices_ios_environment_check
    check (platform <> 'ios' or apns_environment is not null);

drop function if exists public.register_push_device(text, text);

create function public.register_push_device(
  p_token text,
  p_previous_token text default null,
  p_platform text default 'android',
  p_environment text default null
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_environment text;
begin
  if auth.uid() is null or length(trim(p_token)) < 20 or length(p_token) > 4096
     or coalesce(p_platform, '') not in ('android', 'ios')
     or not exists (select 1 from public.profiles where id = auth.uid() and is_active and deleted_at is null) then
    raise exception 'Invalid push registration';
  end if;
  v_environment := case when p_platform = 'ios' then coalesce(p_environment, 'production') end;
  if v_environment is not null and v_environment not in ('sandbox', 'production') then
    raise exception 'Invalid push registration';
  end if;
  if p_previous_token is not null and p_previous_token <> p_token then
    update public.push_devices set enabled = false, disabled_at = now(), updated_at = now()
      where user_id = auth.uid() and fcm_token = p_previous_token;
  end if;
  insert into public.push_devices (user_id, fcm_token, platform, apns_environment)
    values (auth.uid(), p_token, p_platform, v_environment)
    on conflict (fcm_token) do update set user_id = excluded.user_id,
      platform = excluded.platform, apns_environment = excluded.apns_environment,
      enabled = true, disabled_at = null, last_seen_at = now(), updated_at = now()
    returning id into v_id;
  return v_id;
end $$;
revoke all on function public.register_push_device(text, text, text, text) from public, anon;
grant execute on function public.register_push_device(text, text, text, text) to authenticated;
