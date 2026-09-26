import { addPluginListener, invoke, isTauri } from '@tauri-apps/api/core';
import { registrationPlan } from './push-state.mjs';

const android = () => isTauri() && /Android/i.test(navigator.userAgent);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let pending = null;
let repository = null;
let navigate = null;
let currentUserId = null;
let currentToken = null;
let registeredUserId = null;

export function normalizePushNavigation(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.route === 'file-detail' && uuid.test(value.fileId || '')) {
    return { route: 'file-detail', fileId: value.fileId };
  }
  if (value.route === 'deadlines' || value.route === 'tasks') return { route: value.route };
  return null;
}

async function navigatePending() {
  if (!currentUserId || !pending || !navigate) return;
  const target = pending;
  pending = null;
  await navigate(target);
}

async function registerCurrentToken() {
  if (!android() || !currentUserId || !repository) return;
  const { granted } = await invoke('plugin:push|get_permission_state');
  const { token } = await invoke('plugin:push|get_token');
  const plan = registrationPlan({ permissionGranted: granted, token, currentUserId,
    registeredToken: currentToken, registeredUserId });
  if (plan.action === 'disable') {
    await repository.disablePushDevice(plan.token);
    currentToken = null;
    registeredUserId = null;
  } else if (plan.action === 'register') {
    await repository.registerPushDevice(plan.token, plan.previousToken);
    currentToken = plan.token;
    registeredUserId = currentUserId;
  }
}

export async function initializePush(onNavigate) {
  if (!android()) return;
  navigate = onNavigate;
  pending = normalizePushNavigation(await invoke('plugin:push|get_pending_navigation'));
  await addPluginListener('push', 'navigation', async (value) => {
    pending = normalizePushNavigation(value);
    await navigatePending();
  });
  await addPluginListener('push', 'tokenRefreshed', async () => {
    try { await registerCurrentToken(); } catch { /* retry on next resume */ }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registerCurrentToken().catch(() => {});
  });
}

export async function authenticatedPush(repo, userId) {
  if (!android()) return;
  repository = repo;
  currentUserId = userId;
  await navigatePending();
  try {
    const state = await invoke('plugin:push|get_permission_state');
    if (!state.granted && localStorage.getItem('bkt.push.permission-prompted') !== 'true') {
      localStorage.setItem('bkt.push.permission-prompted', 'true');
      await invoke('plugin:push|request_permission');
    }
    await registerCurrentToken();
  } catch {
    console.warn('[BKT push] Device registration deferred.');
  }
}

export async function logoutPush() {
  if (!android()) return;
  const { token } = await invoke('plugin:push|get_token');
  if (token && repository && currentUserId) await repository.disablePushDevice(token);
  currentUserId = null;
  currentToken = null;
  registeredUserId = null;
  repository = null;
  pending = null;
}
