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
  const scheduled = new Date(at.getTime() - 3600_000);
  if (!isDue(now, scheduled)) return [];
  return [{ userId, eventType: 'hearing', entityId: hearing.id,
    reminderType: '1h', scheduledFor: scheduled.toISOString(),
    title: '1 Saat Sonra Duruşmanız Var', body: hearingBody(hearing), navigation: {
      route: 'file-detail', file_id: hearing.file_id, hearing_id: hearing.id
    } }];
}

export function hearingDigestEvents(records, now) {
  const today = localDate(now);
  const tomorrow = addDays(today, 1);
  const scheduled = localInstant(today, '17:00');
  if (!isDue(now, scheduled)) return [];
  const counts = new Map();
  for (const hearing of records) {
    if (!active(hearing) || hearing.hearing_date !== tomorrow || !hearing.files ||
        hearing.files.deleted_at || !hearing.hearing_time) continue;
    const userId = hearing.participant_profile_id || hearing.attendee_profile_id;
    if (!userId) continue;
    counts.set(userId, (counts.get(userId) || 0) + 1);
  }
  return [...counts].map(([userId, count]) => ({
    userId, eventType: 'hearing', entityId: userId, reminderType: 'tomorrow_digest',
    scheduledFor: scheduled.toISOString(),
    title: `Yarın ${count} Duruşmanız Var`,
    body: `Yarın toplam ${count} duruşmanız bulunmaktadır.`,
    navigation: { route: 'hearings', view: 'daily', date: tomorrow }
  }));
}

export function dailyEvents(records, type, now) {
  const today = localDate(now);
  const tomorrow = addDays(today, 1);
  const scheduled = localInstant(today);
  if (!isDue(now, scheduled)) return [];
  const groups = new Map();
  for (const row of records) {
    if (!active(row) || !row.responsible_profile_id ||
        (row.due_date !== today && row.due_date !== tomorrow)) continue;
    const reminderType = row.due_date === today ? 'today' : 'tomorrow';
    const key = `${row.responsible_profile_id}:${reminderType}`;
    const group = groups.get(key) || {
      userId: row.responsible_profile_id, reminderType, dueDate: row.due_date, count: 0
    };
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()].map(({ userId, reminderType, dueDate, count }) => {
    const deadline = type === 'deadline';
    const tomorrowEvent = reminderType === 'tomorrow';
    const subject = deadline ? 'süreli iş' : 'görev';
    const title = tomorrowEvent
      ? `Yarın Son Günü Olan ${deadline ? 'Süreli İşleriniz' : 'Görevleriniz'} Var`
      : deadline ? 'Bugün Son Gün' : 'Bugünkü Görevler';
    const body = tomorrowEvent
      ? `Yarın son günü olan ${count} ${subject}iniz bulunmaktadır.`
      : `Bugün son günü olan ${count === 1 ? 'bir' : count} ${subject}iniz bulunuyor.`;
    return {
      userId, eventType: type, entityId: userId, reminderType,
      scheduledFor: scheduled.toISOString(), title, body,
      navigation: { route: deadline ? 'deadlines' : 'tasks', date: dueDate }
    };
  });
}

export function eventKey(event) {
  return [event.eventType, event.entityId, event.reminderType, event.scheduledFor].join(':');
}

export function allowed(event, preference) {
  if (event.eventType === 'hearing') {
    if (preference?.hearings_enabled === false) return false;
    if (event.reminderType === '1h') return preference?.hearing_1h_enabled !== false;
    if (event.reminderType === '24h') return false;
    return event.reminderType === 'tomorrow_digest';
  }
  return preference?.[`${event.eventType}s_enabled`] !== false;
}
