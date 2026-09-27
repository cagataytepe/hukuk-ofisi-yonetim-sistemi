export function registrationPlan({ permissionGranted, token, currentUserId, registeredToken, registeredUserId }) {
  if (!currentUserId || !token) return { action: 'none' };
  if (!permissionGranted) return { action: 'disable', token };
  return {
    action: 'register', token,
    previousToken: registeredUserId === currentUserId && registeredToken !== token ? registeredToken : null
  };
}

export function createNavigationQueue() {
  let pending = null;
  let consuming = false;
  return {
    capture(target) {
      if (target) pending = target;
      return pending;
    },
    peek() {
      return pending;
    },
    async consume({ authenticated, navigate }) {
      if (!authenticated || !pending || !navigate || consuming) return false;
      const target = pending;
      consuming = true;
      try {
        await navigate(target);
        if (pending === target) pending = null;
        return true;
      } finally {
        consuming = false;
      }
    }
  };
}
