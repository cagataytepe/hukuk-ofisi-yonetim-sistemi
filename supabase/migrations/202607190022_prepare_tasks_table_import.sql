-- Prepare public.tasks for safe settings JSON task import.
-- Forward-only, non-destructive migration.

begin;

alter table if exists public.tasks
  add column if not exists priority text,
  add column if not exists created_by_profile_id uuid,
  add column if not exists import_batch_id text;

do $$
begin
  if to_regclass('public.tasks') is not null
     and to_regclass('public.profiles') is not null
     and not exists (
       select 1
       from pg_constraint c
       join pg_attribute a
         on a.attrelid = c.conrelid
        and a.attnum = any(c.conkey)
       where c.conrelid = 'public.tasks'::regclass
         and c.confrelid = 'public.profiles'::regclass
         and c.contype = 'f'
         and a.attname = 'created_by_profile_id'
     ) then
    alter table public.tasks
      add constraint tasks_created_by_profile_id_fkey
      foreign key (created_by_profile_id)
      references public.profiles(id)
      on delete set null;
  end if;
end $$;

comment on column public.tasks.priority is
  'Settings JSON state.tasks importundan gelen gorev onceligi. Nullable text.';

comment on column public.tasks.created_by_profile_id is
  'Gorevi olusturan profil UUID degeri. Eski JSON createdBy alani eslesirse doldurulur.';

comment on column public.tasks.import_batch_id is
  'Gorev settings JSON import calistirmasinin batch id degeri.';

create index if not exists idx_tasks_priority
  on public.tasks(priority)
  where deleted_at is null and priority is not null and btrim(priority) <> '';

create index if not exists idx_tasks_created_by_profile
  on public.tasks(created_by_profile_id)
  where deleted_at is null and created_by_profile_id is not null;

create index if not exists idx_tasks_import_batch
  on public.tasks(import_batch_id)
  where deleted_at is null and import_batch_id is not null;

create index if not exists idx_tasks_type_file_due
  on public.tasks(task_type, file_id, due_date)
  where deleted_at is null;

create index if not exists idx_tasks_created_by_import_batch
  on public.tasks((metadata ->> 'createdByImportBatchId'))
  where deleted_at is null and metadata ? 'createdByImportBatchId';

create index if not exists idx_tasks_last_import_batch
  on public.tasks((metadata ->> 'lastTasksImportBatchId'))
  where deleted_at is null and metadata ? 'lastTasksImportBatchId';

do $$
begin
  if to_regclass('public.tasks') is not null
     and not exists (
       select 1
       from pg_indexes
       where schemaname = 'public'
         and indexname = 'idx_tasks_legacy_id_unique_active'
     ) then
    if not exists (
      select legacy_id
      from public.tasks
      where deleted_at is null
        and legacy_id is not null
        and btrim(legacy_id) <> ''
      group by legacy_id
      having count(*) > 1
    ) then
      create unique index idx_tasks_legacy_id_unique_active
        on public.tasks(legacy_id)
        where deleted_at is null
          and legacy_id is not null
          and btrim(legacy_id) <> '';
    else
      raise notice 'public.tasks has duplicate active legacy_id values; unique index was not created.';
    end if;
  end if;
end $$;

commit;
