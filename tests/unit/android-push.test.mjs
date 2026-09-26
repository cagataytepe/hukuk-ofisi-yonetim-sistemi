import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { addDays, allowed, dailyEvents, eventKey, hearingBody, hearingEvents,
  isDue, localDate, localInstant } from '../../supabase/functions/dispatch-push-notifications/logic.mjs';
import { sendFcm } from '../../supabase/functions/dispatch-push-notifications/fcm.mjs';
import { failurePlan } from '../../supabase/functions/dispatch-push-notifications/delivery.mjs';
import { registrationPlan } from '../../src/mobile/push-state.mjs';
import { normalizePushNavigation } from '../../src/mobile/push.js';

const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const fileId = '33333333-3333-4333-8333-333333333333';
const hearing = {
  id: '44444444-4444-4444-8444-444444444444', file_id: fileId,
  participant_profile_id: user, hearing_date: '2026-09-22', hearing_time: '13:30:00',
  court: 'Bakırköy 4. İş Mahkemesi', case_file_no: '2026/245',
  client_name: 'Ömer Şerif Turan', status: 'scheduled',
  files: { id: fileId, display_id: 'D-1007', file_no: '2026/245',
    court_or_office: 'Bakırköy 4. İş Mahkemesi', client_name: 'Ömer Şerif Turan' }
};

test('Istanbul hearing time and 24h/1h windows, delayed cron, separate keys', () => {
  assert.equal(localInstant('2026-09-22', '13:30').toISOString(), '2026-09-22T10:30:00.000Z');
  const day = hearingEvents(hearing, new Date('2026-09-21T10:33:00Z'));
  const hour = hearingEvents(hearing, new Date('2026-09-22T09:34:00Z'));
  assert.equal(day[0]?.reminderType, '24h');
  assert.equal(hour[0]?.reminderType, '1h');
  assert.notEqual(eventKey(day[0]), eventKey(hour[0]));
  assert.equal(hearingEvents(hearing, new Date('2026-09-22T09:46:00Z')).length, 0);
  assert.equal(isDue(new Date('2026-09-22T09:34:00Z'), new Date('2026-09-22T09:30:00Z')), true);
});

test('hearing body uses only its file and strips sensitive identifiers', () => {
  assert.match(hearingBody(hearing), /Bakırköy 4\. İş Mahkemesi.*2026\/245 E\./);
  assert.match(hearingBody(hearing), /13:30.*Ömer Şerif Turan/);
  assert.match(hearingBody(hearing), /D-1007/);
  const second = { ...hearing, id: other, client_name: null,
    files: { ...hearing.files, client_name: 'Başka Müvekkil', display_id: 'D-1008' } };
  assert.match(hearingBody(second), /Başka Müvekkil/);
  assert.doesNotMatch(hearingBody(second), /Ömer Şerif/);
  const unsafe = { ...hearing, files: { ...hearing.files,
    client_name: '12345678901 test@example.com +90 555 123 45 67 TR12 1234 5678 9012 3456 7890 12 100.000 TL' } };
  assert.doesNotMatch(hearingBody(unsafe), /12345678901|test@example|555 123|\+90|TR12|100\.000/);
  for (const status of ['completed', 'cancelled', 'iptal']) {
    assert.equal(hearingEvents({ ...hearing, status }, new Date('2026-09-22T09:34:00Z')).length, 0);
  }
  assert.equal(hearingEvents({ ...hearing, deleted_at: '2026-09-01' }, new Date('2026-09-22T09:34:00Z')).length, 0);
  assert.equal(hearingEvents({ ...hearing, hearing_time: null }, new Date('2026-09-22T09:34:00Z')).length, 0);
});

test('production dispatcher has no manual device test path', () => {
  const source = fs.readFileSync(new URL(
    '../../supabase/functions/dispatch-push-notifications/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /device_test|BKT Hukuk Sunucu Testi/);
  assert.match(source, /x-bkt-push-cron/);
});

test('daily deadline/task: Istanbul date, ownership, active only, aggregate count', () => {
  const now = new Date('2026-09-22T06:04:00Z');
  assert.equal(localDate(now), '2026-09-22');
  assert.equal(addDays('2026-09-22', 1), '2026-09-23');
  const base = { responsible_profile_id: user, due_date: '2026-09-22', status: 'Aktif' };
  const rows = [base, base, { ...base, responsible_profile_id: other },
    { ...base, due_date: '2026-09-23' }, { ...base, due_date: '2026-09-21' },
    { ...base, status: 'Tamamlandı' }, { ...base, deleted_at: '2026-09-01' }];
  const deadlines = dailyEvents(rows, 'deadline', now);
  assert.equal(deadlines.find((item) => item.userId === user).body, 'Bugün son günü olan 2 süreli işiniz bulunuyor.');
  assert.equal(deadlines.length, 2);
  assert.equal(dailyEvents(rows, 'task', now).find((item) => item.userId === user).navigation.route, 'tasks');
  assert.equal(dailyEvents(rows, 'task', new Date('2026-09-22T06:16:00Z')).length, 0);
  assert.equal(allowed(deadlines[0], { deadlines_enabled: false }), false);
});

test('token lifecycle plans cover first, repeat, refresh, denied, logout and account switch', () => {
  const first = registrationPlan({ permissionGranted: true, token: 'token-A', currentUserId: user });
  assert.deepEqual(first, { action: 'register', token: 'token-A', previousToken: null });
  assert.equal(registrationPlan({ permissionGranted: true, token: 'token-A', currentUserId: user,
    registeredToken: 'token-A', registeredUserId: user }).previousToken, null);
  assert.equal(registrationPlan({ permissionGranted: true, token: 'token-B', currentUserId: user,
    registeredToken: 'token-A', registeredUserId: user }).previousToken, 'token-A');
  assert.equal(registrationPlan({ permissionGranted: false, token: 'token-A', currentUserId: user }).action, 'disable');
  assert.equal(registrationPlan({ permissionGranted: true, token: 'token-A', currentUserId: null }).action, 'none');
  assert.equal(registrationPlan({ permissionGranted: true, token: 'token-A', currentUserId: other,
    registeredToken: 'token-A', registeredUserId: user }).previousToken, null);
  const sql = fs.readFileSync(new URL('../../supabase/migrations/202609210034_android_push_notifications.sql', import.meta.url), 'utf8');
  assert.match(sql, /fcm_token text not null unique/);
  assert.match(sql, /where user_id = auth\.uid\(\) and fcm_token = p_token/);
  assert.match(sql, /unique \(device_id, event_key\)/);
});

test('delivery key and retry plan prevent repeated event sends and cap failures', () => {
  const one = hearingEvents(hearing, new Date('2026-09-22T09:34:00Z'))[0];
  const two = hearingEvents({ ...hearing, id: other }, new Date('2026-09-22T09:34:00Z'))[0];
  assert.equal(eventKey(one), eventKey({ ...one }));
  assert.notEqual(eventKey(one), eventKey(two));
  assert.deepEqual(failurePlan(1, 'retry', 0), {
    status: 'retry', next_attempt_at: '1970-01-01T00:02:00.000Z'
  });
  assert.equal(failurePlan(5, 'retry', 0).status, 'failed');
  assert.equal(failurePlan(1, 'invalid', 0).next_attempt_at, null);
});

test('notification tap rejects malformed file IDs and preserves login destination', () => {
  assert.deepEqual(normalizePushNavigation({ route: 'file-detail', fileId }), { route: 'file-detail', fileId });
  assert.equal(normalizePushNavigation({ route: 'file-detail', fileId: 'bad' }), null);
  assert.deepEqual(normalizePushNavigation({ route: 'deadlines' }), { route: 'deadlines' });
  assert.equal(normalizePushNavigation({ route: 'admin' }), null);
});

test('FCM HTTP v1 uses bearer auth, whitelisted data and classifies invalid/transient responses', async () => {
  const account = { project_id: 'unit-project' };
  const delivery = { title: 'Bugün Son Gün', body: 'Bir süreli işiniz bulunuyor.',
    event_type: 'deadline', entity_id: user, event_key: 'deadline:one', navigation: { route: 'deadlines' } };
  let payload;
  let endpoint;
  const fetcher = async (url, options) => {
    endpoint = url;
    assert.equal(options.headers.authorization, 'Bearer mock-oauth');
    payload = JSON.parse(options.body);
    return Response.json({ name: 'projects/unit-project/messages/one' });
  };
  const tokenProvider = async () => 'mock-oauth';
  const result = await sendFcm(account, { fcm_token: 'device-token' }, delivery, fetcher, tokenProvider);
  assert.equal(result.kind, 'sent');
  assert.equal(endpoint, 'https://fcm.googleapis.com/v1/projects/unit-project/messages:send');
  assert.deepEqual(payload.message.notification, { title: delivery.title, body: delivery.body });
  assert.deepEqual(payload.message.data, { route: 'deadlines', type: 'deadline', entity_id: user, event_key: 'deadline:one' });
  const invalid = await sendFcm(account, { fcm_token: 'device-token' }, delivery,
    async () => Response.json({ error: { details: [{ errorCode: 'UNREGISTERED' }] } }, { status: 404 }), tokenProvider);
  assert.equal(invalid.kind, 'invalid');
  const transient = await sendFcm(account, { fcm_token: 'device-token' }, delivery,
    async () => Response.json({ error: { status: 'UNAVAILABLE' } }, { status: 503 }), tokenProvider);
  assert.equal(transient.kind, 'retry');
});
