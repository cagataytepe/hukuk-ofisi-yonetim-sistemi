select
  'files_total' as check_name,
  count(*)::text as result
from public.files
where deleted_at is null
union all
select
  'files_distinct_legacy_id',
  count(distinct legacy_id)::text
from public.files
where deleted_at is null
  and legacy_id is not null
  and btrim(legacy_id) <> ''
union all
select
  'file_parties_total',
  count(*)::text
from public.file_parties
where deleted_at is null
union all
select
  'clients_total',
  count(*)::text
from public.clients
where deleted_at is null
union all
select
  'orphan_file_parties',
  count(*)::text
from public.file_parties fp
left join public.files f on f.id = fp.file_id and f.deleted_at is null
where fp.deleted_at is null
  and f.id is null
union all
select
  'invalid_responsible_user_id',
  count(*)::text
from public.files f
left join public.profiles p on p.id = f.responsible_profile_id and p.deleted_at is null
where f.deleted_at is null
  and f.responsible_profile_id is not null
  and p.id is null
union all
select
  'duplicate_client_tax_id',
  count(*)::text
from (
  select regexp_replace(tax_id, '\s+', '', 'g') as normalized_tax_id
  from public.clients
  where deleted_at is null
    and tax_id is not null
    and btrim(tax_id) <> ''
  group by regexp_replace(tax_id, '\s+', '', 'g')
  having count(*) > 1
) duplicate_tax_ids
union all
select
  'duplicate_file_legacy_id',
  count(*)::text
from (
  select legacy_id
  from public.files
  where deleted_at is null
    and legacy_id is not null
    and btrim(legacy_id) <> ''
  group by legacy_id
  having count(*) > 1
) duplicate_legacy_ids;

select
  legacy_id,
  count(*) as duplicate_count
from public.files
where deleted_at is null
  and legacy_id is not null
  and btrim(legacy_id) <> ''
group by legacy_id
having count(*) > 1
order by duplicate_count desc, legacy_id;

select
  regexp_replace(tax_id, '\s+', '', 'g') as normalized_tax_id,
  array_agg(name order by name) as client_names,
  count(*) as duplicate_count
from public.clients
where deleted_at is null
  and tax_id is not null
  and btrim(tax_id) <> ''
group by regexp_replace(tax_id, '\s+', '', 'g')
having count(*) > 1
order by duplicate_count desc, normalized_tax_id;

select
  fp.id,
  fp.legacy_id,
  fp.file_id,
  fp.name,
  fp.party_type
from public.file_parties fp
left join public.files f on f.id = fp.file_id and f.deleted_at is null
where fp.deleted_at is null
  and f.id is null
order by fp.created_at desc;

select
  f.id,
  f.legacy_id,
  f.display_id,
  f.responsible_name,
  f.responsible_profile_id
from public.files f
left join public.profiles p on p.id = f.responsible_profile_id and p.deleted_at is null
where f.deleted_at is null
  and f.responsible_profile_id is not null
  and p.id is null
order by f.created_at desc;
