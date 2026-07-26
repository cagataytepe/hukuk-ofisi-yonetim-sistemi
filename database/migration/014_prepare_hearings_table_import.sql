-- Prepare public.hearings for safe settings JSON hearing import.
-- Forward-only, non-destructive migration.

alter table if exists public.hearings
  add column if not exists status text not null default 'scheduled',
  add column if not exists import_batch_id text,
  add column if not exists participant_profile_id uuid,
  add column if not exists participant_name text;

do $$
begin
  if to_regclass('public.hearings') is not null
     and to_regclass('public.profiles') is not null
     and not exists (
       select 1
       from pg_constraint
       where conname = 'hearings_participant_profile_id_fkey'
         and conrelid = 'public.hearings'::regclass
     ) then
    alter table public.hearings
      add constraint hearings_participant_profile_id_fkey
      foreign key (participant_profile_id)
      references public.profiles(id)
      on delete set null;
  end if;
end $$;

update public.hearings
set
  participant_profile_id = coalesce(participant_profile_id, attendee_profile_id),
  participant_name = coalesce(participant_name, attendee_name),
  updated_at = now()
where deleted_at is null
  and (participant_profile_id is null or participant_name is null);

create index if not exists idx_hearings_import_batch
  on public.hearings(import_batch_id)
  where deleted_at is null and import_batch_id is not null;

create index if not exists idx_hearings_participant_profile
  on public.hearings(participant_profile_id)
  where deleted_at is null and participant_profile_id is not null;

create index if not exists idx_hearings_file_date_time
  on public.hearings(file_id, hearing_date, hearing_time)
  where deleted_at is null;

do $$
begin
  if to_regclass('public.hearings') is not null
     and not exists (
       select 1
       from pg_indexes
       where schemaname = 'public'
         and indexname = 'idx_hearings_legacy_id_unique_active'
     ) then
    if not exists (
      select legacy_id
      from public.hearings
      where deleted_at is null
        and legacy_id is not null
      group by legacy_id
      having count(*) > 1
    ) then
      create unique index idx_hearings_legacy_id_unique_active
        on public.hearings(legacy_id)
        where deleted_at is null
          and legacy_id is not null;
    else
      raise notice 'public.hearings has duplicate active legacy_id values; unique index was not created.';
    end if;
  end if;
end $$;
