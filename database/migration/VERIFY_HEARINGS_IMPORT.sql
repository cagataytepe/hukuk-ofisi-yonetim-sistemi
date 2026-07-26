-- Verification queries for hearings import.
-- Run in Supabase SQL Editor after applying migration/import.

select 'total_hearings' as check_name, count(*)::text as result
from public.hearings;

select 'active_hearings' as check_name, count(*)::text as result
from public.hearings
where deleted_at is null;

select 'unique_active_legacy_id' as check_name, count(distinct legacy_id)::text as result
from public.hearings
where deleted_at is null
  and legacy_id is not null;

select 'duplicate_active_legacy_id' as check_name, coalesce(jsonb_agg(row_to_json(duplicates)), '[]'::jsonb)::text as result
from (
  select legacy_id, count(*) as duplicate_count
  from public.hearings
  where deleted_at is null
    and legacy_id is not null
  group by legacy_id
  having count(*) > 1
  order by duplicate_count desc, legacy_id
) duplicates;

select 'orphan_file_id' as check_name, count(*)::text as result
from public.hearings h
left join public.files f on f.id = h.file_id and f.deleted_at is null
where h.deleted_at is null
  and f.id is null;

select 'invalid_participant_profile_id' as check_name, count(*)::text as result
from public.hearings h
left join public.profiles p on p.id = h.participant_profile_id and p.deleted_at is null
where h.deleted_at is null
  and h.participant_profile_id is not null
  and p.id is null;

select 'null_file_id' as check_name, count(*)::text as result
from public.hearings
where deleted_at is null
  and file_id is null;

select 'null_hearing_date' as check_name, count(*)::text as result
from public.hearings
where deleted_at is null
  and hearing_date is null;

select 'invalid_hearing_time_format' as check_name, count(*)::text as result
from public.hearings
where deleted_at is null
  and hearing_time is not null
  and hearing_time::text !~ '^\d{2}:\d{2}:\d{2}$';

select 'import_batch_counts' as check_name, coalesce(jsonb_agg(row_to_json(batch_counts)), '[]'::jsonb)::text as result
from (
  select
    coalesce(import_batch_id, '(no batch)') as import_batch_id,
    count(*) as total,
    count(*) filter (where deleted_at is null) as active,
    count(*) filter (where deleted_at is not null) as deleted
  from public.hearings
  group by coalesce(import_batch_id, '(no batch)')
  order by max(created_at) desc nulls last
) batch_counts;

select
  h.legacy_id,
  h.hearing_date,
  h.hearing_time,
  h.court,
  h.case_file_no,
  f.legacy_id as file_legacy_id,
  h.participant_name,
  p.display_name as participant_display_name,
  h.import_batch_id
from public.hearings h
left join public.files f on f.id = h.file_id
left join public.profiles p on p.id = h.participant_profile_id
where h.deleted_at is null
order by h.hearing_date, h.hearing_time, h.legacy_id
limit 100;
