-- Verification queries for public.tasks import.
-- Run after a dry-run review and after an executed import.

select
  'tasks_total' as check_name,
  count(*) as value
from public.tasks;

select
  'tasks_active_not_deleted' as check_name,
  count(*) as value
from public.tasks
where deleted_at is null;

select
  'tasks_soft_deleted' as check_name,
  count(*) as value
from public.tasks
where deleted_at is not null;

select
  'tasks_completed' as check_name,
  count(*) as value
from public.tasks
where deleted_at is null
  and lower(coalesce(status, '')) in ('tamamlandı', 'tamamlandi', 'completed', 'done');

select
  'tasks_overdue_active' as check_name,
  count(*) as value
from public.tasks
where deleted_at is null
  and due_date < current_date
  and lower(coalesce(status, '')) not in ('tamamlandı', 'tamamlandi', 'completed', 'done', 'iptal', 'İptal', 'cancelled', 'canceled');

select
  'tasks_unique_legacy_id' as check_name,
  count(distinct legacy_id) as value
from public.tasks
where deleted_at is null
  and legacy_id is not null
  and btrim(legacy_id) <> '';

select
  legacy_id,
  count(*) as duplicate_count
from public.tasks
where deleted_at is null
  and legacy_id is not null
  and btrim(legacy_id) <> ''
group by legacy_id
having count(*) > 1
order by duplicate_count desc, legacy_id;

select
  'file_bound_tasks_with_null_file_id' as check_name,
  count(*) as value
from public.tasks
where deleted_at is null
  and lower(coalesce(task_type, '')) in ('file', 'dosya', 'dosyaya bağlı', 'dosyaya bagli', 'dosyaya bağlı görev', 'dosyaya bagli gorev')
  and file_id is null;

select
  t.id,
  t.legacy_id,
  t.file_id
from public.tasks t
left join public.files f on f.id = t.file_id
where t.deleted_at is null
  and t.file_id is not null
  and f.id is null
order by t.created_at desc;

select
  t.id,
  t.legacy_id,
  t.responsible_profile_id
from public.tasks t
left join public.profiles p on p.id = t.responsible_profile_id
where t.deleted_at is null
  and t.responsible_profile_id is not null
  and p.id is null
order by t.created_at desc;

select
  t.id,
  t.legacy_id,
  t.created_by_profile_id
from public.tasks t
left join public.profiles p on p.id = t.created_by_profile_id
where t.deleted_at is null
  and t.created_by_profile_id is not null
  and p.id is null
order by t.created_at desc;

select
  'tasks_null_title' as check_name,
  count(*) as value
from public.tasks
where deleted_at is null
  and (title is null or btrim(title) = '');

select
  'tasks_null_due_date' as check_name,
  count(*) as value
from public.tasks
where deleted_at is null
  and due_date is null;

select
  coalesce(task_type, '(null)') as task_type,
  count(*) as count
from public.tasks
where deleted_at is null
group by coalesce(task_type, '(null)')
order by count desc, task_type;

select
  coalesce(status, '(null)') as status,
  count(*) as count
from public.tasks
where deleted_at is null
group by coalesce(status, '(null)')
order by count desc, status;

select
  coalesce(priority, '(null)') as priority,
  count(*) as count
from public.tasks
where deleted_at is null
group by coalesce(priority, '(null)')
order by count desc, priority;

select
  coalesce(import_batch_id, metadata ->> 'importBatchId', '(no batch)') as batch_id,
  count(*) as count
from public.tasks
where deleted_at is null
group by coalesce(import_batch_id, metadata ->> 'importBatchId', '(no batch)')
order by count desc, batch_id;

select
  metadata ->> 'createdByImportBatchId' as created_by_import_batch_id,
  count(*) as count
from public.tasks
where metadata ? 'createdByImportBatchId'
group by metadata ->> 'createdByImportBatchId'
order by count desc, created_by_import_batch_id;

select
  metadata ->> 'lastTasksImportBatchId' as last_tasks_import_batch_id,
  count(*) as count
from public.tasks
where metadata ? 'lastTasksImportBatchId'
group by metadata ->> 'lastTasksImportBatchId'
order by count desc, last_tasks_import_batch_id;
