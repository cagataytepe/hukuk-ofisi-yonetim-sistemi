const zone = 'Europe/Istanbul';
const clock = new Intl.DateTimeFormat('en-US', {
  timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

export function parts(instant) {
  return Object.fromEntries(clock.formatToParts(instant).filter((item) => item.type !== 'literal')
    .map((item) => [item.type, Number(item.value)]));
}

export function localDate(instant) {
  const p = parts(instant);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function addDays(date, days) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function localInstant(date, time = '09:00') {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(guess));
    const observed = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += wanted - observed;
  }
  return new Date(guess);
}

export function isDue(now, scheduled, graceMinutes = 15) {
  const delta = now.getTime() - scheduled.getTime();
  return delta >= 0 && delta < graceMinutes * 60_000;
}

export function active(record) {
  const status = String(record.status || '').toLocaleLowerCase('tr-TR');
  return !record.deleted_at && !record.completed_at &&
    !['tamamlan', 'completed', 'cancel', 'iptal', 'pasif', 'ertelen'].some((word) => status.includes(word));
}

function safeLabel(value, max = 72) {
  return String(value || '').replace(/\bTR\d{2}[\d\s]{20,}\b/gi, '')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '')
    .replace(/\b(?:\d[\s.-]?){10,11}\b/g, '')
    .replace(/(?:\+90|0)\s*5\d{2}[\s-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g, '')
    .replace(/\b\d[\d., ]*\s*(?:TL|₺)\b/gi, '')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

export function hearingBody(hearing) {
  const file = hearing.files || {};
  const court = safeLabel(hearing.court || file.court_or_office);
  const number = safeLabel(hearing.case_file_no || file.file_no, 36);
  const client = safeLabel(file.client_name || hearing.client_name);
  const internal = safeLabel(file.display_id, 24);
  return [
    [court, number && (/(?:\bE\.)$/i.test(number) ? number : `${number} E.`)].filter(Boolean).join(' • '),
    [String(hearing.hearing_time || '').slice(0, 5), client].filter(Boolean).join(' • '),
    internal
  ].filter(Boolean).join('\n');
}

export function hearingEvents(hearing, now) {
  if (!active(hearing) || !hearing.files || hearing.files.deleted_at || !hearing.hearing_time) return [];
  const userId = hearing.participant_profile_id || hearing.attendee_profile_id;
  if (!userId) return [];
  const at = localInstant(hearing.hearing_date, hearing.hearing_time);
  return [
    ['24h', 24, 'Yarın Duruşmanız Var'],
    ['1h', 1, '1 Saat Sonra Duruşmanız Var']
  ].flatMap(([reminderType, hours, title]) => {
    const scheduled = new Date(at.getTime() - hours * 3600_000);
    if (!isDue(now, scheduled)) return [];
    return [{ userId, eventType: 'hearing', entityId: hearing.id,
      reminderType, scheduledFor: scheduled.toISOString(), title,
      body: hearingBody(hearing), navigation: {
        route: 'file-detail', file_id: hearing.file_id, hearing_id: hearing.id
      } }];
  });
}

export function dailyEvents(records, type, now) {
  const today = localDate(now);
  const scheduled = localInstant(today);
  if (!isDue(now, scheduled)) return [];
  const counts = new Map();
  for (const row of records) {
    if (!active(row) || row.due_date !== today || !row.responsible_profile_id) continue;
    counts.set(row.responsible_profile_id, (counts.get(row.responsible_profile_id) || 0) + 1);
  }
  return [...counts].map(([userId, count]) => ({
    userId, eventType: type, entityId: userId, reminderType: 'daily',
    scheduledFor: scheduled.toISOString(),
    title: type === 'deadline' ? 'Bugün Son Gün' : 'Bugünkü Görevler',
    body: type === 'deadline'
      ? `Bugün son günü olan ${count === 1 ? 'bir' : count} süreli işiniz bulunuyor.`
      : `Bugün son günü olan ${count === 1 ? 'bir' : count} göreviniz bulunuyor.`,
    navigation: { route: type === 'deadline' ? 'deadlines' : 'tasks' }
  }));
}

export function eventKey(event) {
  return [event.eventType, event.entityId, event.reminderType, event.scheduledFor].join(':');
}

export function allowed(event, preference) {
  if (event.eventType === 'hearing') return preference?.hearings_enabled !== false &&
    preference?.[`hearing_${event.reminderType}_enabled`] !== false;
  return preference?.[`${event.eventType}s_enabled`] !== false;
}
