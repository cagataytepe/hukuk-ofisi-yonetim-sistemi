begin;

alter table public.clients
  add column if not exists client_type text not null default 'person';

alter table public.file_parties
  add column if not exists role_label text;

comment on column public.clients.client_type is
  'Dosyalar JSON gecisinde tarafin kisi/kurum tipi. Ornek: person, company, unknown.';

comment on column public.file_parties.role_label is
  'Eski JSON kaydindaki taraf rolunun ekranda gorunen etiketi. Ornek: Davaci, Davali, Alacakli, Borclu.';

create index if not exists idx_clients_client_type
  on public.clients(client_type)
  where deleted_at is null;

create index if not exists idx_file_parties_party_type
  on public.file_parties(party_type)
  where deleted_at is null;

create index if not exists idx_file_parties_role_label
  on public.file_parties(role_label)
  where deleted_at is null;

create index if not exists idx_files_import_batch
  on public.files((metadata ->> 'importBatchId'))
  where deleted_at is null and metadata ? 'importBatchId';

create index if not exists idx_files_created_by_import_batch
  on public.files((metadata ->> 'createdByImportBatchId'))
  where deleted_at is null and metadata ? 'createdByImportBatchId';

create index if not exists idx_clients_import_batch
  on public.clients((metadata ->> 'importBatchId'))
  where deleted_at is null and metadata ? 'importBatchId';

create index if not exists idx_clients_created_by_import_batch
  on public.clients((metadata ->> 'createdByImportBatchId'))
  where deleted_at is null and metadata ? 'createdByImportBatchId';

create index if not exists idx_file_parties_import_batch
  on public.file_parties((metadata ->> 'importBatchId'))
  where deleted_at is null and metadata ? 'importBatchId';

create index if not exists idx_file_parties_created_by_import_batch
  on public.file_parties((metadata ->> 'createdByImportBatchId'))
  where deleted_at is null and metadata ? 'createdByImportBatchId';

do $$
begin
  if not exists (
    select 1
    from public.files
    where deleted_at is null
      and legacy_id is not null
      and btrim(legacy_id) <> ''
    group by legacy_id
    having count(*) > 1
  ) then
    execute $sql$create unique index if not exists files_legacy_id_active_unique on public.files(legacy_id) where deleted_at is null and legacy_id is not null and btrim(legacy_id) <> ''$sql$;
  else
    raise notice 'files.legacy_id duplicates exist; files_legacy_id_active_unique was not created.';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from public.clients
    where deleted_at is null
      and legacy_id is not null
      and btrim(legacy_id) <> ''
    group by legacy_id
    having count(*) > 1
  ) then
    execute $sql$create unique index if not exists clients_legacy_id_active_unique on public.clients(legacy_id) where deleted_at is null and legacy_id is not null and btrim(legacy_id) <> ''$sql$;
  else
    raise notice 'clients.legacy_id duplicates exist; clients_legacy_id_active_unique was not created.';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from public.file_parties
    where deleted_at is null
      and legacy_id is not null
      and btrim(legacy_id) <> ''
    group by legacy_id
    having count(*) > 1
  ) then
    execute $sql$create unique index if not exists file_parties_legacy_id_active_unique on public.file_parties(legacy_id) where deleted_at is null and legacy_id is not null and btrim(legacy_id) <> ''$sql$;
  else
    raise notice 'file_parties.legacy_id duplicates exist; file_parties_legacy_id_active_unique was not created.';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from public.clients
    where deleted_at is null
      and tax_id is not null
      and btrim(tax_id) <> ''
    group by regexp_replace(tax_id, '\s+', '', 'g')
    having count(*) > 1
  ) then
    execute $sql$create unique index if not exists clients_tax_id_active_unique on public.clients((regexp_replace(tax_id, '\s+', '', 'g'))) where deleted_at is null and tax_id is not null and btrim(tax_id) <> ''$sql$;
  else
    raise notice 'clients.tax_id duplicates exist; clients_tax_id_active_unique was not created.';
  end if;
end;
$$;

commit;
