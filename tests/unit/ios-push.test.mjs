import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { apnsConfigFromEnv, providerToken, resetProviderToken, sendApns } from '../../supabase/functions/dispatch-push-notifications/apns.mjs';
import { deliveryData } from '../../supabase/functions/dispatch-push-notifications/fcm.mjs';

const user = '11111111-1111-4111-8111-111111111111';
const delivery = {
  title: 'Bugün Son Gün', body: 'Bir süreli işiniz bulunuyor.', event_type: 'deadline',
  entity_id: user, event_key: 'deadline:one', navigation: { route: 'deadlines' }
};
const config = { privateKey: 'unused', keyId: 'ABC123DEFG', teamId: 'TEAM123456', topic: 'tr.com.bkthukuk.ofisyonetim' };

function fromBase64url(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0));
}

test('APNs provider token is a verifiable ES256 JWT for the team and key', async () => {
  resetProviderToken();
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8))}\n-----END PRIVATE KEY-----\n`;
  const now = Date.UTC(2026, 9, 11, 9, 0, 0);
  const jwt = await providerToken({ ...config, privateKey: pem }, now);
  const [header, claims, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(fromBase64url(header))), { alg: 'ES256', kid: config.keyId });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(fromBase64url(claims))), { iss: config.teamId, iat: now / 1000 });
  assert.equal(fromBase64url(signature).length, 64);
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey,
    fromBase64url(signature), new TextEncoder().encode(`${header}.${claims}`));
  assert.equal(valid, true);
  assert.equal(await providerToken({ ...config, privateKey: pem }, now + 30 * 60_000), jwt, 'token is reused within its lifetime');
  resetProviderToken();
});

test('APNs request carries alert, routing data and production headers', async () => {
  let request;
  const fetcher = async (url, options) => {
    request = { url, options };
    return new Response(null, { status: 200, headers: { 'apns-id': 'apns-message-1' } });
  };
  const result = await sendApns(config, { fcm_token: 'a'.repeat(64), apns_environment: 'production' }, delivery,
    fetcher, async () => 'mock-jwt');
  assert.deepEqual(result, { kind: 'sent', messageId: 'apns-message-1' });
  assert.equal(request.url, `https://api.push.apple.com/3/device/${'a'.repeat(64)}`);
  assert.equal(request.options.headers.authorization, 'bearer mock-jwt');
  assert.equal(request.options.headers['apns-topic'], 'tr.com.bkthukuk.ofisyonetim');
  assert.equal(request.options.headers['apns-push-type'], 'alert');
  assert.equal(request.options.headers['apns-collapse-id'], 'deadline:one');
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.aps.alert, { title: delivery.title, body: delivery.body });
  assert.equal(body.bkt_push_route, 'deadlines');
  assert.equal(body.event_key, 'deadline:one');
  assert.deepEqual({ ...body, aps: undefined }, { ...deliveryData(delivery), aps: undefined });
});

test('APNs sandbox devices use the sandbox host and long event keys skip collapse', async () => {
  let request;
  const fetcher = async (url, options) => { request = { url, options }; return new Response(null, { status: 200 }); };
  await sendApns(config, { fcm_token: 'b'.repeat(64), apns_environment: 'sandbox' },
    { ...delivery, event_key: 'x'.repeat(65) }, fetcher, async () => 'mock-jwt');
  assert.match(request.url, /^https:\/\/api\.sandbox\.push\.apple\.com\/3\/device\//);
  assert.equal(request.options.headers['apns-collapse-id'], undefined);
});

test('APNs failures map to invalid devices or retries', async () => {
  const device = { fcm_token: 'c'.repeat(64), apns_environment: 'production' };
  const reply = (status, reason) => async () => Response.json({ reason }, { status });
  const tokenProvider = async () => 'mock-jwt';
  assert.deepEqual(await sendApns(config, device, delivery, reply(410, 'Unregistered'), tokenProvider),
    { kind: 'invalid', code: 'Unregistered' });
  assert.equal((await sendApns(config, device, delivery, reply(400, 'BadDeviceToken'), tokenProvider)).kind, 'invalid');
  assert.deepEqual(await sendApns(config, device, delivery, reply(403, 'ExpiredProviderToken'), tokenProvider),
    { kind: 'retry', code: 'ExpiredProviderToken' });
  assert.deepEqual(await sendApns(config, device, delivery, reply(429, 'TooManyRequests'), tokenProvider),
    { kind: 'retry', code: 'TooManyRequests' });
  assert.deepEqual(await sendApns(null, device, delivery), { kind: 'retry', code: 'APNS_NOT_CONFIGURED' });
});

test('APNs configuration requires key, key ID and team ID', () => {
  const env = { APNS_PRIVATE_KEY_P8: 'pem', APNS_KEY_ID: 'KEY', APNS_TEAM_ID: 'TEAM' };
  assert.deepEqual(apnsConfigFromEnv((name) => env[name]),
    { privateKey: 'pem', keyId: 'KEY', teamId: 'TEAM', topic: 'tr.com.bkthukuk.ofisyonetim' });
  assert.equal(apnsConfigFromEnv((name) => (name === 'APNS_TEAM_ID' ? undefined : env[name])), null);
});

test('iOS device migration keeps Android registrations compatible', () => {
  const sql = fs.readFileSync('supabase/migrations/202610110036_ios_push_devices.sql', 'utf8');
  assert.equal(sql, fs.readFileSync('database/migration/036_ios_push_devices.sql', 'utf8'));
  assert.match(sql, /check \(platform in \('android', 'ios'\)\)/);
  assert.match(sql, /drop function if exists public\.register_push_device\(text, text\);/);
  assert.match(sql, /p_previous_token text default null,\s*p_platform text default 'android'/);
  assert.match(sql, /grant execute on function public\.register_push_device\(text, text, text, text\) to authenticated/);
});

test('Swift plugin exposes every command the Rust bridge calls on iOS', () => {
  const swift = fs.readFileSync('src-tauri/plugins/push/ios/Sources/PushPlugin.swift', 'utf8');
  const rust = fs.readFileSync('src-tauri/plugins/push/src/mobile.rs', 'utf8');
  for (const command of ['getToken', 'getPendingNavigation', 'getPermissionState', 'requestNotificationPermission']) {
    assert.ok(rust.includes(`"${command}"`), `Rust calls ${command}`);
    assert.match(swift, new RegExp(`@objc public func ${command}\\(_ invoke: Invoke\\)`), `Swift defines ${command}`);
  }
  assert.match(rust, /ios_plugin_binding!\(init_plugin_push\)/);
  assert.match(swift, /@_cdecl\("init_plugin_push"\)/);
  for (const key of ['route', 'file_id', 'hearing_id', 'view', 'date']) {
    assert.ok(swift.includes(`"${key}"`) && deliveryData({ navigation: { [key]: 'v' } }), key);
  }
});
