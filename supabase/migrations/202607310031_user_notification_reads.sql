begin;

create table if not exists public.user_notification_reads (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  notification_key text not null,
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_notification_reads_profile_key_unique unique (profile_id, notification_key)
);

create index if not exists idx_user_notification_reads_profile
  on public.user_notification_reads(profile_id, read_at desc);

alter table public.user_notification_reads enable row level security;

drop policy if exists user_notification_reads_select_own on public.user_notification_reads;
create policy user_notification_reads_select_own
  on public.user_notification_reads for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists user_notification_reads_insert_own on public.user_notification_reads;
create policy user_notification_reads_insert_own
  on public.user_notification_reads for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists user_notification_reads_update_own on public.user_notification_reads;
create policy user_notification_reads_update_own
  on public.user_notification_reads for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

revoke all on public.user_notification_reads from anon;
grant select, insert, update on public.user_notification_reads to authenticated;

commit;
