export function failurePlan(attemptCount, kind, now = Date.now()) {
  const permanent = kind === 'invalid' || attemptCount >= 5;
  return {
    status: permanent ? 'failed' : 'retry',
    next_attempt_at: permanent ? null : new Date(now + Math.min(60, 2 ** attemptCount) * 60_000).toISOString()
  };
}
