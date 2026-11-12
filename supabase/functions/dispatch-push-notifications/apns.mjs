import { deliveryData } from './fcm.mjs';

// Apple sağlayıcı jetonları 60 dakika geçerlidir ve 20 dakikadan sık yenilenmemelidir.
const providerTokenLifetimeMs = 50 * 60_000;
let cached;

function base64url(bytes) {
  let data = '';
  for (const byte of bytes) data += String.fromCharCode(byte);
  return btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function apnsConfigFromEnv(getEnv) {
  const privateKey = getEnv('APNS_PRIVATE_KEY_P8');
  const keyId = getEnv('APNS_KEY_ID');
  const teamId = getEnv('APNS_TEAM_ID');
  if (!privateKey || !keyId || !teamId) return null;
  return { privateKey, keyId, teamId, topic: getEnv('APNS_TOPIC') || 'tr.com.bkthukuk.ofisyonetim' };
}

export async function providerToken(config, now = Date.now()) {
  if (cached && cached.keyId === config.keyId && cached.expires > now) return cached.value;
  const binary = atob(config.privateKey.replace(/-----[^-]+-----|\s/g, ''));
  const der = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'ES256', kid: config.keyId })));
  const claims = base64url(new TextEncoder().encode(JSON.stringify({
    iss: config.teamId, iat: Math.floor(now / 1000)
  })));
  const content = `${header}.${claims}`;
  // WebCrypto ECDSA imzası JWT'nin beklediği r||s (64 bayt) biçimindedir.
  const signature = base64url(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key,
    new TextEncoder().encode(content))));
  cached = { keyId: config.keyId, value: `${content}.${signature}`, expires: now + providerTokenLifetimeMs };
  return cached.value;
}

export function resetProviderToken() {
  cached = undefined;
}

export async function sendApns(config, device, delivery, fetcher = fetch, tokenProvider = providerToken) {
  if (!config) return { kind: 'retry', code: 'APNS_NOT_CONFIGURED' };
  const jwt = await tokenProvider(config);
  const host = device.apns_environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  const headers = {
    authorization: `bearer ${jwt}`,
    'apns-topic': config.topic,
    'apns-push-type': 'alert',
    'apns-priority': '10',
    'content-type': 'application/json'
  };
  // apns-collapse-id en fazla 64 bayt olabilir; daha uzun anahtarlar gruplanmadan gönderilir.
  if (delivery.event_key && new TextEncoder().encode(delivery.event_key).length <= 64) {
    headers['apns-collapse-id'] = delivery.event_key;
  }
  const response = await fetcher(`https://${host}/3/device/${encodeURIComponent(device.fcm_token)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      aps: {
        alert: { title: delivery.title, body: delivery.body },
        sound: 'default',
        'thread-id': delivery.event_type
      },
      ...deliveryData(delivery)
    })
  });
  if (response.ok) return { kind: 'sent', messageId: response.headers.get('apns-id') };
  const reason = (await response.json().catch(() => ({}))).reason;
  if (response.status === 410 || ['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'].includes(reason)) {
    return { kind: 'invalid', code: reason || 'Unregistered' };
  }
  if (response.status === 403 && ['ExpiredProviderToken', 'InvalidProviderToken'].includes(reason)) {
    resetProviderToken();
  }
  return { kind: 'retry', code: reason || `HTTP_${response.status}` };
}
