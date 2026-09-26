-- Prepared only. Do not apply or schedule without release approval.
create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  fcm_token text not null unique,
  platform text not null default 'android' check (platform = 'android'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz
);
create index push_devices_user_enabled_idx on public.push_devices (user_id) where enabled;
alter table public.push_devices enable row level security;
create policy push_devices_select_own on public.push_devices for select to authenticated
  using (user_id = auth.uid());
revoke all on public.push_devices from anon, authenticated;
grant select on public.push_devices to authenticated;
grant all on public.push_devices to service_role;

create function public.register_push_device(p_token text, p_previous_token text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null or length(trim(p_token)) < 20 or length(p_token) > 4096
     or not exists (select 1 from public.profiles where id = auth.uid() and is_active and deleted_at is null) then
    raise exception 'Invalid push registration';
  end if;
  if p_previous_token is not null and p_previous_token <> p_token then
    update public.push_devices set enabled = false, disabled_at = now(), updated_at = now()
      where user_id = auth.uid() and fcm_token = p_previous_token;
  end if;
  insert into public.push_devices (user_id, fcm_token)
    values (auth.uid(), p_token)
    on conflict (fcm_token) do update set user_id = excluded.user_id,
      enabled = true, disabled_at = null, last_seen_at = now(), updated_at = now()
    returning id into v_id;
  return v_id;
end $$;
revoke all on function public.register_push_device(text,text) from public, anon;
grant execute on function public.register_push_device(text,text) to authenticated;

create function public.disable_push_device(p_token text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.push_devices set enabled = false, disabled_at = now(), updated_at = now()
    where user_id = auth.uid() and fcm_token = p_token;
end $$;
revoke all on function public.disable_push_device(text) from public, anon;
grant execute on function public.disable_push_device(text) to authenticated;

create table public.push_notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  hearings_enabled boolean not null default true,
  hearing_24h_enabled boolean not null default true,
  hearing_1h_enabled boolean not null default true,
  deadlines_enabled boolean not null default true,
  tasks_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.push_notification_preferences enable row level security;
create policy push_preferences_select_own on public.push_notification_preferences
  for select to authenticated using (user_id = auth.uid());
create policy push_preferences_insert_own on public.push_notification_preferences
  for insert to authenticated with check (user_id = auth.uid());
create policy push_preferences_update_own on public.push_notification_preferences
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.push_notification_preferences from anon;
grant select, insert, update on public.push_notification_preferences to authenticated;
grant all on public.push_notification_preferences to service_role;

create table public.push_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null references public.push_devices(id) on delete cascade,
  event_key text not null,
  event_type text not null check (event_type in ('hearing', 'deadline', 'task')),
  entity_id uuid not null,
  reminder_type text not null,
  scheduled_for timestamptz not null,
  title text not null,
  body text not null,
  navigation jsonb not null default '{}'::jsonb,
  status text not null default 'processing' check (status in ('processing', 'retry', 'sent', 'failed')),
  attempt_count integer not null default 1 check (attempt_count between 1 and 5),
  next_attempt_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, event_key)
);
create index push_delivery_retry_idx on public.push_notification_deliveries (next_attempt_at)
  where status = 'retry';
alter table public.push_notification_deliveries enable row level security;
revoke all on public.push_notification_deliveries from anon, authenticated;
grant all on public.push_notification_deliveries to service_role;
