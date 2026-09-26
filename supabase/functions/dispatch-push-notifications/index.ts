import { createClient } from 'jsr:@supabase/supabase-js@2';
import { addDays, allowed, dailyEvents, eventKey, hearingEvents, localDate } from './logic.mjs';
import { sendFcm } from './fcm.mjs';
import { failurePlan } from './delivery.mjs';

const required = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const get = async (query: any) => {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
};

const failureUpdate = async (db: any, delivery: any, result: any) => {
  const attempts = delivery.attempt_count;
  const plan = failurePlan(attempts, result.kind);
  const { error } = await db.from('push_notification_deliveries').update({
    ...plan,
    last_error: String(result.code || 'FCM unavailable').slice(0, 100), updated_at: new Date().toISOString()
  }).eq('id', delivery.id);
  if (error) throw error;
  if (result.kind === 'invalid') {
    await get(db.from('push_devices').update({ enabled: false, disabled_at: new Date().toISOString() })
      .eq('id', delivery.device_id));
  }
};

async function dispatch(db: any, serviceAccount: any, delivery: any, device: any) {
  let result;
  try {
    result = await sendFcm(serviceAccount, device, delivery);
  } catch {
    result = { kind: 'retry', code: 'transport_or_oauth_failure' };
  }
  if (result.kind === 'sent') {
    const { error } = await db.from('push_notification_deliveries').update({
      status: 'sent', sent_at: new Date().toISOString(),
      provider_message_id: result.messageId, last_error: null, updated_at: new Date().toISOString()
    }).eq('id', delivery.id);
    if (error) throw error;
  } else {
    await failureUpdate(db, delivery, result);
  }
  return result.kind;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST' || !Deno.env.get('PUSH_CRON_TOKEN') ||
      request.headers.get('x-bkt-push-cron') !== Deno.env.get('PUSH_CRON_TOKEN')) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    const secretKeys = JSON.parse(required('SUPABASE_SECRET_KEYS'));
    const db = createClient(required('SUPABASE_URL'), secretKeys.default || required('PUSH_SUPABASE_SECRET_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const serviceAccount = JSON.parse(required('FIREBASE_SERVICE_ACCOUNT_JSON'));
    const now = new Date();
    const today = localDate(now);
    const hearingRows = await get(db.from('hearings').select(
      'id,file_id,participant_profile_id,attendee_profile_id,hearing_date,hearing_time,court,case_file_no,client_name,status,deleted_at,files!inner(id,display_id,file_no,court_or_office,client_name,deleted_at)'
    ).gte('hearing_date', today).lte('hearing_date', addDays(today, 2)).is('deleted_at', null));
    const deadlines = await get(db.from('deadlines').select(
      'id,responsible_profile_id,due_date,status,completed_at,deleted_at'
    ).eq('due_date', today).is('deleted_at', null).is('completed_at', null));
    const tasks = await get(db.from('tasks').select(
      'id,responsible_profile_id,due_date,status,completed_at,deleted_at'
    ).eq('due_date', today).is('deleted_at', null).is('completed_at', null));
    const events = [
      ...hearingRows.flatMap((row: any) => hearingEvents(row, now)),
      ...dailyEvents(deadlines, 'deadline', now), ...dailyEvents(tasks, 'task', now)
    ];
    const ids = [...new Set(events.map((item: any) => item.userId))];
    const devices = ids.length ? await get(db.from('push_devices').select('id,user_id,fcm_token')
      .in('user_id', ids).eq('enabled', true)) : [];
    const preferences = ids.length ? await get(db.from('push_notification_preferences').select('*')
      .in('user_id', ids)) : [];
    const profiles = ids.length ? await get(db.from('profiles').select('id').in('id', ids)
      .eq('is_active', true).is('deleted_at', null)) : [];
    const activeUsers = new Set(profiles.map((row: any) => row.id));
    const preferenceMap = new Map(preferences.map((row: any) => [row.user_id, row]));
    let sent = 0;
    let queued = 0;
    for (const event of events) {
      if (!activeUsers.has(event.userId) || !allowed(event, preferenceMap.get(event.userId))) continue;
      for (const device of devices.filter((row: any) => row.user_id === event.userId)) {
        const { data, error } = await db.from('push_notification_deliveries').insert({
          user_id: event.userId, device_id: device.id, event_key: eventKey(event),
          event_type: event.eventType, entity_id: event.entityId, reminder_type: event.reminderType,
          scheduled_for: event.scheduledFor, title: event.title, body: event.body,
          navigation: event.navigation
        }).select('*').single();
        if (error?.code === '23505') continue;
        if (error) throw error;
        const result = await dispatch(db, serviceAccount, data, device);
        if (result === 'sent') sent++; else queued++;
      }
    }
    const retries = await get(db.from('push_notification_deliveries')
      .select('*,push_devices!inner(id,user_id,fcm_token,enabled)')
      .eq('status', 'retry').lte('next_attempt_at', now.toISOString())
      .lt('attempt_count', 5).limit(100));
    const retryUserIds = [...new Set(retries.map((row: any) => row.user_id))];
    const retryProfiles = retryUserIds.length ? await get(db.from('profiles').select('id')
      .in('id', retryUserIds).eq('is_active', true).is('deleted_at', null)) : [];
    const retryPreferences = retryUserIds.length ? await get(db.from('push_notification_preferences')
      .select('*').in('user_id', retryUserIds)) : [];
    const retryActiveUsers = new Set(retryProfiles.map((row: any) => row.id));
    const retryPreferenceMap = new Map(retryPreferences.map((row: any) => [row.user_id, row]));
    for (const row of retries) {
      if (!row.push_devices?.enabled || !retryActiveUsers.has(row.user_id) ||
          !allowed({ eventType: row.event_type, reminderType: row.reminder_type },
            retryPreferenceMap.get(row.user_id))) {
        await get(db.from('push_notification_deliveries').update({ status: 'failed',
          last_error: 'recipient_or_preference_disabled', updated_at: new Date().toISOString() })
          .eq('id', row.id).eq('status', 'retry'));
        continue;
      }
      const { data, error } = await db.from('push_notification_deliveries').update({
        status: 'processing', attempt_count: row.attempt_count + 1, updated_at: new Date().toISOString()
      }).eq('id', row.id).eq('status', 'retry').eq('attempt_count', row.attempt_count)
        .select('*').maybeSingle();
      if (error) throw error;
      if (!data) continue;
      const result = await dispatch(db, serviceAccount, data, row.push_devices);
      if (result === 'sent') sent++; else queued++;
    }
    return Response.json({ sent, queued, candidates: events.length });
  } catch (error) {
    // Do not log notification contents, tokens, or service-account material.
    console.error('Push dispatch failed', error instanceof Error ? error.name : 'unknown');
    return new Response('Dispatch failed', { status: 500 });
  }
});
