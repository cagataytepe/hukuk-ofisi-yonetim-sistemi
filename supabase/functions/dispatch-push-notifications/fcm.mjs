const scope = 'https://www.googleapis.com/auth/firebase.messaging';
let cached;

function base64url(bytes) {
  let data = '';
  for (const byte of bytes) data += String.fromCharCode(byte);
  return btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function accessToken(serviceAccount, fetcher = fetch, now = Date.now()) {
  if (cached && cached.expires > now + 60_000) return cached.value;
  const pem = serviceAccount.private_key;
  const binary = atob(pem.replace(/-----[^-]+-----|\s/g, ''));
  const der = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const issued = Math.floor(now / 1000);
  const claim = base64url(new TextEncoder().encode(JSON.stringify({
    iss: serviceAccount.client_email, sub: serviceAccount.client_email, scope,
    aud: 'https://oauth2.googleapis.com/token', iat: issued, exp: issued + 3600
  })));
  const content = `${header}.${claim}`;
  const signature = base64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key,
    new TextEncoder().encode(content))));
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${content}.${signature}` })
  });
  if (!response.ok) throw new Error(`OAuth exchange failed: ${response.status}`);
  const result = await response.json();
  cached = { value: result.access_token, expires: now + Math.min(result.expires_in || 3600, 3600) * 1000 };
  return cached.value;
}

export async function sendFcm(serviceAccount, device, delivery, fetcher = fetch, tokenProvider = accessToken) {
  const auth = await tokenProvider(serviceAccount, fetcher);
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.project_id)}/messages:send`;
  const data = Object.fromEntries(Object.entries({
    ...delivery.navigation, type: delivery.event_type, entity_id: delivery.entity_id,
    event_key: delivery.event_key
  }).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)]));
  const response = await fetcher(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: {
      token: device.fcm_token,
      notification: { title: delivery.title, body: delivery.body },
      data, android: { notification: { channel_id: 'bkt_reminders_v1', tag: delivery.event_key,
        visibility: 'PRIVATE' } }
    } })
  });
  if (response.ok) return { kind: 'sent', messageId: (await response.json()).name };
  const error = await response.json().catch(() => ({}));
  const code = (Array.isArray(error.error?.details) ? error.error.details : [])
    .find((item) => item.errorCode)?.errorCode;
  if (code === 'UNREGISTERED') return { kind: 'invalid', code };
  return { kind: 'retry', code: code || `HTTP_${response.status}` };
}
