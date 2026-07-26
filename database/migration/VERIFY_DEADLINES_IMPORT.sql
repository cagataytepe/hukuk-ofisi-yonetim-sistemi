-- Verification queries for settings JSON -> public.deadlines import.

select
  count(*) as total_deadlines,
  count(*) filter (where deleted_at is null) as active_rows,
  count(*) filter (where deleted_at is not null) as soft_deleted_rows
from public.deadlines;

select
  count(*) filter (
    where deleted_at is null
      and lower(status) not in ('tamamlandı', 'tamamlandi', 'completed', 'done', 'iptal', 'cancelled', 'canceled')
  ) as active_deadlines,
  count(*) filter (
    where deleted_at is null
      and lower(status) in ('tamamlandı', 'tamamlandi', 'completed', 'done')
  ) as completed_deadlines,
  count(*) filter (
    where deleted_at is null
      and lower(status) not in ('tamamlandı', 'tamamlandi', 'completed', 'done', 'iptal', 'cancelled', 'canceled')
      and due_date < current_date
  ) as overdue_deadlines
from public.deadlines;

select
  count(distinct legacy_id) as unique_legacy_id_count,
  count(*) filter (where legacy_id is null or btrim(legacy_id) = '') as null_or_empty_legacy_id_count
from public.deadlines
where deleted_at is null;

select
  legacy_id,
  count(*) as duplicate_count
from public.deadlines
where deleted_at is null
  and legacy_id is not null
  and btrim(legacy_id) <> ''
group by legacy_id
having count(*) > 1
order by duplicate_count desc, legacy_id;

select
  count(*) as null_file_id_count
from public.deadlines
where deleted_at is null
  and file_id is null;

select
  d.id,
  d.legacy_id,
  d.file_id
from public.deadlines d
left join public.files f on f.id = d.file_id and f.deleted_at is null
where d.deleted_at is null
  and d.file_id is not null
  and f.id is null
order by d.created_at desc;

select
  d.id,
  d.legacy_id,
  d.responsible_profile_id
from public.deadlines d
left join public.profiles p on p.id = d.responsible_profile_id and p.deleted_at is null
where d.deleted_at is null
  and d.responsible_profile_id is not null
  and p.id is null
order by d.created_at desc;

select
  count(*) as null_due_date_count
from public.deadlines
where deleted_at is null
  and due_date is null;

select
  coalesce(import_batch_id, metadata ->> 'importBatchId', 'no_batch') as batch_id,
  count(*) as row_count,
  count(*) filter (where metadata ->> 'createdByImportBatchId' is not null) as created_by_import_count,
  count(*) filter (where metadata ->> 'lastDeadlinesImportBatchId' is not null) as updated_by_import_count
from public.deadlines
where deleted_at is null
group by coalesce(import_batch_id, metadata ->> 'importBatchId', 'no_batch')
order by row_count desc, batch_id;
