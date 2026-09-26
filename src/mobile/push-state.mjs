export function registrationPlan({ permissionGranted, token, currentUserId, registeredToken, registeredUserId }) {
  if (!currentUserId || !token) return { action: 'none' };
  if (!permissionGranted) return { action: 'disable', token };
  return {
    action: 'register', token,
    previousToken: registeredUserId === currentUserId && registeredToken !== token ? registeredToken : null
  };
}
