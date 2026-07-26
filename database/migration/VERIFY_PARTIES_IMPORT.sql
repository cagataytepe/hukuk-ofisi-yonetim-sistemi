select
  'clients_total' as check_name,
  count(*)::text as result
from public.clients
where deleted_at is null
union all
select
  'file_parties_total',
  count(*)::text
from public.file_parties
where deleted_at is null
union all
select
  'orphan_file_parties_without_file',
  count(*)::text
from public.file_parties fp
left join public.files f on f.id = fp.file_id and f.deleted_at is null
where fp.deleted_at is null
  and f.id is null
union all
select
  'orphan_file_parties_without_client',
  count(*)::text
from public.file_parties fp
left join public.clients c on c.id = fp.client_id and c.deleted_at is null
where fp.deleted_at is null
  and fp.client_id is not null
  and c.id is null
union all
select
  'clients_with_national_id',
  count(*)::text
from public.clients
where deleted_at is null
  and national_id is not null
  and btrim(national_id) <> ''
union all
select
  'clients_with_tax_id',
  count(*)::text
from public.clients
where deleted_at is null
  and tax_id is not null
  and btrim(tax_id) <> ''
union all
select
  'duplicate_client_national_id',
  count(*)::text
from (
  select regexp_replace(national_id, '\s+', '', 'g') as normalized_national_id
  from public.clients
  where deleted_at is null
    and national_id is not null
    and btrim(national_id) <> ''
  group by regexp_replace(national_id, '\s+', '', 'g')
  having count(*) > 1
) duplicates
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
) duplicates
union all
select
  'duplicate_file_party_file_client_party_type',
  count(*)::text
from (
  select file_id, client_id, lower(btrim(party_type)) as party_type
  from public.file_parties
  where deleted_at is null
    and client_id is not null
    and party_type is not null
    and btrim(party_type) <> ''
  group by file_id, client_id, lower(btrim(party_type))
  having count(*) > 1
) duplicates;

select
  client_type,
  count(*) as total
from public.clients
where deleted_at is null
group by client_type
order by total desc, client_type;

select
  party_type,
  side,
  count(*) as total
from public.file_parties
where deleted_at is null
group by party_type, side
order by total desc, party_type, side;

select
  import_batch_id,
  count(*) as file_party_count
from public.file_parties
where deleted_at is null
  and import_batch_id is not null
group by import_batch_id
order by import_batch_id desc;

select
  fp.id,
  fp.legacy_id,
  f.display_id,
  f.file_no,
  f.court_or_office,
  c.name as client_name,
  fp.name as party_name,
  fp.party_type,
  fp.side,
  fp.role_label,
  fp.is_primary
from public.file_parties fp
left join public.files f on f.id = fp.file_id
left join public.clients c on c.id = fp.client_id
where fp.deleted_at is null
order by fp.created_at desc
limit 50;
