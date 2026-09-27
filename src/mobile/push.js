import { addPluginListener, invoke, isTauri } from '@tauri-apps/api/core';
import { createNavigationQueue, registrationPlan } from './push-state.mjs';

const android = () => isTauri() && /Android/i.test(navigator.userAgent);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const navigationQueue = createNavigationQueue();
let repository = null;
let navigate = null;
let currentUserId = null;
let currentToken = null;
let registeredUserId = null;

export function normalizePushNavigation(value) {
  if (!value || typeof value !== 'object') return null;
  const fileId = value.fileId || value.file_id;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value.date || '') ? value.date : null;
  if (value.route === 'file-detail' && uuid.test(fileId || '')) {
    return { route: 'file-detail', fileId };
  }
  if (value.route === 'hearings' && value.view === 'daily' && date) {
    return { route: 'hearings', view: 'daily', date };
  }
  if (value.route === 'deadlines' || value.route === 'tasks') {
    return { route: value.route, ...(date ? { date } : {}) };
  }
  return null;
}

async function navigatePending() {
  return navigationQueue.consume({ authenticated: Boolean(currentUserId), navigate });
}

async function captureNativePending(fallback = null) {
  const stored = normalizePushNavigation(await invoke('plugin:push|get_pending_navigation'));
  navigationQueue.capture(stored || normalizePushNavigation(fallback));
  return navigatePending();
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
  await captureNativePending();
  await addPluginListener('push', 'navigation', async (value) => {
    await captureNativePending(value);
  });
  await addPluginListener('push', 'tokenRefreshed', async () => {
    try { await registerCurrentToken(); } catch { /* retry on next resume */ }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      captureNativePending().catch(() => {});
      registerCurrentToken().catch(() => {});
    }
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
}
