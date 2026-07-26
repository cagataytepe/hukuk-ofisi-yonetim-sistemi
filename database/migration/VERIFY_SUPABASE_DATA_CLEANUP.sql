-- BKT Hukuk - Supabase veri temizliği doğrulama raporu
-- Sadece okuma yapar; veri değiştirmez.

with table_counts as (
  select 'files' as table_name, count(*) filter (where deleted_at is null) as active_rows, count(*) as total_rows from public.files
  union all select 'clients', count(*) filter (where deleted_at is null), count(*) from public.clients
  union all select 'file_parties', count(*) filter (where deleted_at is null), count(*) from public.file_parties
  union all select 'hearings', count(*) filter (where deleted_at is null), count(*) from public.hearings
  union all select 'deadlines', count(*) filter (where deleted_at is null), count(*) from public.deadlines
  union all select 'tasks', count(*) filter (where deleted_at is null), count(*) from public.tasks
  union all select 'collections', count(*) filter (where deleted_at is null), count(*) from public.collections
  union all select 'payment_plans', count(*) filter (where deleted_at is null), count(*) from public.payment_plans
  union all select 'payment_installments', count(*) filter (where deleted_at is null), count(*) from public.payment_installments
  union all select 'file_notes', count(*) filter (where deleted_at is null), count(*) from public.file_notes
  union all select 'timeline_events', count(*) filter (where deleted_at is null), count(*) from public.timeline_events
)
select 'table_counts' as check_name, jsonb_agg(to_jsonb(table_counts) order by table_name) as result
from table_counts;

select 'settings_legacy_business_json' as check_name,
       jsonb_build_object(
         'legacy_settings_exists', exists (
           select 1 from public.settings
           where setting_key = 'hukukBurosuTakipDemo.v2'
             and deleted_at is null
         ),
         'legacy_json_bytes', coalesce((
           select octet_length(setting_value::text)
           from public.settings
           where setting_key = 'hukukBurosuTakipDemo.v2'
             and deleted_at is null
           limit 1
         ), 0),
         'business_keys_present', coalesce((
           select jsonb_agg(key order by key)
           from public.settings s,
                jsonb_object_keys(s.setting_value) as key
           where s.setting_key = 'hukukBurosuTakipDemo.v2'
             and s.deleted_at is null
             and key in (
               'files','cases','hearings','deadlines','tasks','documents',
               'clients','collections','paymentPlans','calculationSettings',
               'users','migrations'
             )
         ), '[]'::jsonb)
       ) as result;

select 'orphan_checks' as check_name,
       jsonb_build_object(
         'file_parties_without_file', (select count(*) from public.file_parties fp left join public.files f on f.id = fp.file_id where fp.deleted_at is null and f.id is null),
         'file_parties_without_client', (select count(*) from public.file_parties fp left join public.clients c on c.id = fp.client_id where fp.deleted_at is null and fp.client_id is not null and c.id is null),
         'hearings_without_file', (select count(*) from public.hearings h left join public.files f on f.id = h.file_id where h.deleted_at is null and h.file_id is not null and f.id is null),
         'deadlines_without_file', (select count(*) from public.deadlines d left join public.files f on f.id = d.file_id where d.deleted_at is null and d.file_id is not null and f.id is null),
         'tasks_without_file', (select count(*) from public.tasks t left join public.files f on f.id = t.file_id where t.deleted_at is null and t.file_id is not null and f.id is null),
         'collections_without_file', (select count(*) from public.collections c left join public.files f on f.id = c.file_id where c.deleted_at is null and c.file_id is not null and f.id is null),
         'payment_plans_without_file', (select count(*) from public.payment_plans p left join public.files f on f.id = p.file_id where p.deleted_at is null and p.file_id is not null and f.id is null),
         'payment_installments_without_plan', (select count(*) from public.payment_installments i left join public.payment_plans p on p.id = i.payment_plan_id where i.deleted_at is null and p.id is null),
         'timeline_events_without_file', (select count(*) from public.timeline_events te left join public.files f on f.id = te.file_id where te.deleted_at is null and te.file_id is not null and f.id is null)
       ) as result;

select 'duplicate_checks' as check_name,
       jsonb_build_object(
         'files_duplicate_legacy_id', (
           select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
           from (
             select legacy_id, count(*) as count
             from public.files
             where deleted_at is null and legacy_id is not null
             group by legacy_id
             having count(*) > 1
             order by count(*) desc, legacy_id
           ) x
         ),
         'file_parties_exact_duplicates', (
           select count(*)
           from (
             select file_id, client_id, party_type, side, role_label, count(*)
             from public.file_parties
             where deleted_at is null
             group by file_id, client_id, party_type, side, role_label
             having count(*) > 1
           ) duplicates
         )
       ) as result;
