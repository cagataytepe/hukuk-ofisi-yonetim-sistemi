begin;

alter table public.clients
  add column if not exists national_id text,
  add column if not exists import_batch_id text,
  add column if not exists client_type text not null default 'unknown',
  add column if not exists deleted_at timestamptz;

alter table public.clients
  alter column client_type set default 'unknown';

alter table public.file_parties
  add column if not exists role_label text,
  add column if not exists side text,
  add column if not exists is_primary boolean not null default false,
  add column if not exists import_batch_id text,
  add column if not exists deleted_at timestamptz;

comment on column public.clients.national_id is
  'Taraf migration icin TC kimlik numarasi. VKN public.clients.tax_id alaninda tutulur.';

comment on column public.clients.import_batch_id is
  'Taraf migration import batch takibi. Rollback sadece bu batch ile olusturulan kayitlari hedefler.';

comment on column public.file_parties.import_batch_id is
  'Taraf migration import batch takibi. Rollback sadece bu batch ile olusturulan kayitlari hedefler.';

comment on column public.file_parties.side is
  'Tarafin dosyadaki yonu: represented, opposing, neutral veya other.';

create index if not exists idx_clients_national_id
  on public.clients(national_id)
  where deleted_at is null
    and national_id is not null
    and btrim(national_id) <> '';

create index if not exists idx_clients_import_batch_column
  on public.clients(import_batch_id)
  where deleted_at is null
    and import_batch_id is not null
    and btrim(import_batch_id) <> '';

create index if not exists idx_clients_name_type_active
  on public.clients((lower(btrim(name))), client_type)
  where deleted_at is null
    and name is not null
    and btrim(name) <> '';

create index if not exists idx_file_parties_file_client_active
  on public.file_parties(file_id, client_id)
  where deleted_at is null;

create index if not exists idx_file_parties_side_active
  on public.file_parties(side)
  where deleted_at is null;

create index if not exists idx_file_parties_import_batch_column
  on public.file_parties(import_batch_id)
  where deleted_at is null
    and import_batch_id is not null
    and btrim(import_batch_id) <> '';

do $$
begin
  if not exists (
    select 1
    from public.clients
    where deleted_at is null
      and national_id is not null
      and btrim(national_id) <> ''
    group by regexp_replace(national_id, '\s+', '', 'g')
    having count(*) > 1
  ) then
    execute $sql$
      create unique index if not exists clients_national_id_active_unique
      on public.clients((regexp_replace(national_id, '\s+', '', 'g')))
      where deleted_at is null
        and national_id is not null
        and btrim(national_id) <> ''
    $sql$;
  else
    raise notice 'clients.national_id duplicates exist; clients_national_id_active_unique was not created.';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from public.file_parties
    where deleted_at is null
      and file_id is not null
      and client_id is not null
      and party_type is not null
      and btrim(party_type) <> ''
    group by file_id, client_id, lower(btrim(party_type))
    having count(*) > 1
  ) then
    execute $sql$
      create unique index if not exists file_parties_file_client_party_active_unique
      on public.file_parties(file_id, client_id, (lower(btrim(party_type))))
      where deleted_at is null
        and file_id is not null
        and client_id is not null
        and party_type is not null
        and btrim(party_type) <> ''
    $sql$;
  else
    raise notice 'file_parties file_id/client_id/party_type duplicates exist; unique index was not created.';
  end if;
end;
$$;

commit;
