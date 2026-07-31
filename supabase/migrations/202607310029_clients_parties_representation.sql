begin;

alter table public.clients
  add column if not exists repair_batch_id text;

update public.clients
set client_type = case lower(btrim(coalesce(client_type, '')))
  when 'company' then 'organization'
  when 'corporate' then 'organization'
  when 'institution' then 'organization'
  when 'organization' then 'organization'
  when 'person' then 'person'
  else 'unknown'
end
where client_type is null
   or lower(btrim(client_type)) not in ('person', 'organization', 'unknown');

alter table public.clients
  alter column client_type set default 'unknown';

alter table public.clients
  drop constraint if exists clients_client_type_check;

alter table public.clients
  add constraint clients_client_type_check
  check (client_type in ('person', 'organization', 'unknown'));

alter table public.file_parties
  add column if not exists represented_by_office boolean,
  add column if not exists notes text,
  add column if not exists repair_batch_id text;

comment on column public.clients.client_type is
  'Ana taraf kaydinin turu: person, organization veya manuel inceleme bekleyen unknown.';
comment on column public.clients.national_id is
  'Gercek kisiler icin T.C. kimlik numarasi. Telefon bilgisinden bagimsizdir.';
comment on column public.clients.tax_id is
  'Kurumlar icin vergi kimlik numarasi. Telefon bilgisinden bagimsizdir.';
comment on column public.file_parties.represented_by_office is
  'Bu dosya tarafinin BKT Hukuk tarafindan temsil edilip edilmedigi. NULL eski kayitta manuel karar gerektigini belirtir.';
comment on column public.file_parties.side is
  'Dosyadaki iliski yonu. represented_by_office yerine kullanilmaz.';
comment on column public.file_parties.role_label is
  'Dosya turune gore taraf rolu: davaci, davali, sanik, alacakli, borclu vb.';

create index if not exists idx_file_parties_represented_active
  on public.file_parties(represented_by_office, client_id)
  where deleted_at is null;

create index if not exists idx_clients_repair_batch
  on public.clients(repair_batch_id)
  where repair_batch_id is not null;

create index if not exists idx_file_parties_repair_batch
  on public.file_parties(repair_batch_id)
  where repair_batch_id is not null;

update public.file_parties
set represented_by_office = case
      when metadata ? 'representedByOffice' then (metadata ->> 'representedByOffice')::boolean
      when metadata ? 'represented_by_office' then (metadata ->> 'represented_by_office')::boolean
      when metadata ? 'isClient' then (metadata ->> 'isClient')::boolean
      when metadata ? 'is_client' then (metadata ->> 'is_client')::boolean
      else represented_by_office
    end,
    updated_at = now()
where represented_by_office is null
  and (
    jsonb_typeof(metadata -> 'representedByOffice') = 'boolean'
    or jsonb_typeof(metadata -> 'represented_by_office') = 'boolean'
    or jsonb_typeof(metadata -> 'isClient') = 'boolean'
    or jsonb_typeof(metadata -> 'is_client') = 'boolean'
  );

commit;
