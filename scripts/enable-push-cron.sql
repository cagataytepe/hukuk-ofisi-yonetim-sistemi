-- MANUAL RELEASE STEP ONLY. Do not run before Firebase, migration, Edge Function,
-- PUSH_CRON_TOKEN and Vault entries are configured and approved.
-- In Supabase Vault create named secrets bkt_push_edge_url (full function URL)
-- and bkt_push_cron_token (same random value as Edge secret PUSH_CRON_TOKEN).
-- Verify pg_cron and pg_net availability in the target project first.
select cron.schedule('bkt_push_dispatch_v1', '*/5 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'bkt_push_edge_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-bkt-push-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'bkt_push_cron_token')
    ),
    body := '{}'::jsonb
  );
$$);
