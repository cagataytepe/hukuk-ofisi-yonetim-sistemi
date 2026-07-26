-- Prepare public.deadlines for safe settings JSON deadline import.
-- Forward-only, non-destructive migration.

begin;

alter table if exists public.deadlines
  add column if not exists task text,
  add column if not exists import_batch_id text;

update public.deadlines
set
  task = title,
  updated_at = now()
where deleted_at is null
  and (task is null or btrim(task) = '')
  and title is not null
  and btrim(title) <> '';

comment on column public.deadlines.task is
  'Süreli işler JSON geçişinde eski state.deadlines.task alanı. title ile uyumlu tutulur.';

comment on column public.deadlines.import_batch_id is
  'Süreli işler settings JSON import çalıştırmasının batch id değeri.';

create index if not exists idx_deadlines_import_batch
  on public.deadlines(import_batch_id)
  where deleted_at is null and import_batch_id is not null;

create index if not exists idx_deadlines_file_due
  on public.deadlines(file_id, due_date)
  where deleted_at is null;

create index if not exists idx_deadlines_task
  on public.deadlines(task)
  where deleted_at is null and task is not null and btrim(task) <> '';

create index if not exists idx_deadlines_created_by_import_batch
  on public.deadlines((metadata ->> 'createdByImportBatchId'))
  where deleted_at is null and metadata ? 'createdByImportBatchId';

create index if not exists idx_deadlines_last_import_batch
  on public.deadlines((metadata ->> 'lastDeadlinesImportBatchId'))
  where deleted_at is null and metadata ? 'lastDeadlinesImportBatchId';

do $$
begin
  if to_regclass('public.deadlines') is not null
     and not exists (
       select 1
       from pg_indexes
       where schemaname = 'public'
         and indexname = 'idx_deadlines_legacy_id_unique_active'
     ) then
    if not exists (
      select legacy_id
      from public.deadlines
      where deleted_at is null
        and legacy_id is not null
        and btrim(legacy_id) <> ''
      group by legacy_id
      having count(*) > 1
    ) then
      create unique index idx_deadlines_legacy_id_unique_active
        on public.deadlines(legacy_id)
        where deleted_at is null
          and legacy_id is not null
          and btrim(legacy_id) <> '';
    else
      raise notice 'public.deadlines has duplicate active legacy_id values; unique index was not created.';
    end if;
  end if;
end $$;

commit;
