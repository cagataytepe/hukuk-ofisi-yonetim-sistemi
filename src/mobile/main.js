import "../../outputs/supabase-config.js";
import {
  accountDateInTimeZone,
  calculateMobileEnforcementAccount
} from "../calculations/enforcementAccountAdapters.js";

let repository = null;
const app = document.querySelector("#mobileApp");
const toast = document.querySelector("#mobileToast");

const state = {
  user: null,
  route: "home",
  previousRoute: "home",
  menuReturnRoute: "home",
  detailId: "",
  deadlineDetailId: "",
  taskDetailId: "",
  clientDetailId: "",
  detailTab: "general",
  fileFilter: "all",
  fileSearch: "",
  filePage: 1,
  clientFilter: "all",
  clientSearch: "",
  taskFilter: "active",
  deadlineFilter: "active",
  hearingView: "week",
  hearingAnchor: new Date(),
  hearingRows: [],
  calendarDate: new Date(),
  selectedDate: localIso(new Date()),
  cache: new Map(),
  loading: false
};

const MOBILE_FILE_PAGE_SIZE = 10;

const icons = {
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  kebab: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  files: '<path d="M3 6h6l2 2h10v11H3z"/><path d="M3 6V4h6l2 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  calendarDay: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><circle cx="12" cy="15.5" r="2.5"/><path d="M12 14v3"/>',
  calendarWeek: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M7 13h2m2 0h2m2 0h2M7 17h2m2 0h2m2 0h2"/>',
  tasks: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 12 2 2 5-5M8 6h8M8 18h8"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.5"/>',
  eyeOff: '<path d="m3 3 18 18M10.6 6.2A10.8 10.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.2 2.9M6.2 6.2C3.8 7.8 2.5 12 2.5 12s3.5 6 9.5 6a9 9 0 0 0 3.2-.6M10 10a2.8 2.8 0 0 0 4 4"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 12h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 9v4M12 17h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  building: '<path d="M4 21V4h12v17M16 9h4v12M8 8h4M8 12h4M8 16h4"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  refresh: '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 11M5.5 15A7 7 0 0 0 18 17.5l2-4.5"/>',
  logout: '<path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  money: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M7 10h.01M17 15h.01M8 15c2-4 6-4 8-5"/>',
  note: '<path d="M5 3h14v18H5zM9 8h6M9 12h6M9 16h4"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1v.1h-4v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4h-.1v-4H3A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1v-.1h4V3A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.13.38.34.72.6 1 .28.25.62.39 1 .4h.1v4H21a1.7 1.7 0 0 0-1.6.6z"/>',
  shield: '<path d="M12 3 4 6v5c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6z"/><path d="m9 12 2 2 4-5"/>',
  palette: '<path d="M12 3a9 9 0 0 0 0 18h1.5a1.5 1.5 0 0 0 0-3H12a2 2 0 0 1 0-4h3a6 6 0 0 0 0-12z"/><circle cx="7.5" cy="10" r=".7"/><circle cx="10" cy="6.5" r=".7"/><circle cx="15" cy="7" r=".7"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.7 2.7 0 1 1 4.2 2.3c-1.2.7-1.7 1.2-1.7 2.2M12 17h.01"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>',
  arrow: '<path d="m9 18 6-6-6-6"/>'
};

function icon(name, className = "") {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.more}</svg>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function localIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function addDaysIso(days, referenceDate = new Date()) {
  const date = new Date(referenceDate);
  date.setDate(date.getDate() + days);
  return localIso(date);
}

function localDate(value = new Date()) {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12);
  const [year, month, day] = String(value || "").slice(0, 10).split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day, 12) : new Date();
}

function hearingDateRange() {
  const anchor = localDate(state.hearingAnchor);
  if (state.hearingView === "day") {
    return {
      dateFrom: localIso(anchor),
      dateTo: localIso(anchor),
      label: formatDate(localIso(anchor), { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    };
  }
  if (state.hearingView === "month") {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12);
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 12);
    return {
      dateFrom: localIso(start),
      dateTo: localIso(end),
      label: new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(start)
    };
  }
  const start = new Date(anchor);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 4);
  return {
    dateFrom: localIso(start),
    dateTo: localIso(end),
    label: `${formatDate(localIso(start), { day: "2-digit", month: "short" })} - ${formatDate(localIso(end), { day: "2-digit", month: "short", year: "numeric" })}`
  };
}

function formatDate(value, options = { day: "2-digit", month: "short", year: "numeric" }) {
  if (!value) return "Belirtilmedi";
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("tr-TR", options).format(new Date(year, month - 1, day));
}

function formatTime(value) {
  return String(value || "").slice(0, 5) || "--:--";
}

function formatCurrency(value, currency = "TRY") {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency, maximumFractionDigits: 2 }).format(parseAmount(value));
}

function parseAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const clean = String(value ?? "").trim().replace(/[^\d,.-]/g, "");
  if (!clean) return 0;
  const normalized = clean.includes(",") && clean.includes(".")
    ? clean.replaceAll(".", "").replace(",", ".")
    : clean.replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function fileTypeClass(file = {}) {
  const type = String(file.file_type || file.record_kind || file.metadata?.file_type || "").toLocaleLowerCase("tr-TR");
  if (type.includes("ceza")) return "criminal";
  if (type.includes("hukuk") || type.includes("dava")) return "law";
  if (type.includes("icra")) return "enforcement";
  return "other";
}

function fileStatusTone(status) {
  const normalized = String(status || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ");

  if (["açık", "acik", "aktif", "devam ediyor"].includes(normalized)) return "success";
  if (["kapalı", "kapali", "kapandı", "kapandi"].includes(normalized)) return "";
  if (normalized.includes("karara çıkmış") || normalized.includes("karara cikmis") || normalized.includes("sonuçlandı") || normalized.includes("sonuclandi")) return "file-status-decision";
  if (normalized.includes("istinaf")) return "file-status-appeal";
  if (normalized.includes("yargıtay") || normalized.includes("yargitay") || normalized.includes("temyiz")) return "file-status-supreme";
  if (normalized.includes("durdurulmuş") || normalized.includes("durdurulmus") || normalized.includes("beklemede")) return "file-status-paused";
  if (normalized.includes("tahsilat") || normalized.includes("ödeme plan") || normalized.includes("odeme plan")) return "file-status-collection";
  if (normalized.includes("infaz")) return "file-status-execution";
  return "";
}

function fileSequence(file = {}) {
  const value = String(file.display_id || file.legacy_id || "");
  const match = value.match(/(\d+)(?!.*\d)/);
  return match ? Number(match[1]) : 0;
}

function maskIdentity(value) {
  const clean = String(value || "").replace(/\s+/g, "");
  if (!clean) return "Belirtilmedi";
  if (clean.length <= 5) return clean;
  return `${clean.slice(0, 3)}${"•".repeat(Math.max(3, clean.length - 5))}${clean.slice(-2)}`;
}

function isCompleted(status) {
  return ["completed", "tamamlandı", "tamamlandi", "done", "closed"].includes(String(status || "").toLocaleLowerCase("tr-TR"));
}

function statusBadge(status, dueDate = "") {
  if (isCompleted(status)) return '<span class="mobile-badge success">Tamamlandı</span>';
  if (dueDate && dueDate < localIso(new Date())) return '<span class="mobile-badge danger">Gecikti</span>';
  return `<span class="mobile-badge">${escapeHtml(status || "Aktif")}</span>`;
}

function dueDatePresentation(row = {}) {
  if (isCompleted(row.status)) {
    const completedDate = String(row.completed_at || "").slice(0, 10);
    const completedLate = Boolean(row.completed_late || (completedDate && row.due_date && completedDate > row.due_date));
    return {
      label: completedLate ? "Süresi Dışında Tamamlandı" : "Süresi İçinde Tamamlandı",
      tone: completedLate ? "danger" : "success"
    };
  }
  if (!row.due_date) return { label: "Son gün belirtilmedi", tone: "" };
  const remaining = Math.round((localDate(row.due_date) - localDate(new Date())) / 86400000);
  if (remaining < 0) return { label: `${Math.abs(remaining)} gün geçti`, tone: "danger" };
  if (remaining === 0) return { label: "Bugün son gün", tone: "danger" };
  if (remaining === 1) return { label: "1 gün kaldı", tone: "warn" };
  return { label: `${remaining} gün kaldı`, tone: remaining <= 3 ? "warn" : "" };
}

function responsibleDisplayName(row = {}) {
  return row.responsible_profile?.display_name || row.responsible_profile?.displayName || row.responsible_name || "Sorumlu belirtilmedi";
}

function linkedFileLabel(row = {}, fallback = "Dosyadan bağımsız") {
  const file = row.file;
  if (!file) return fallback;
  return [file.display_id || file.legacy_id, file.court_or_office, file.file_no].filter(Boolean).join(" · ") || fallback;
}

function dueBadge(row = {}) {
  const presentation = dueDatePresentation(row);
  return `<span class="mobile-badge ${presentation.tone}">${escapeHtml(presentation.label)}</span>`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function skeleton(count = 3) {
  return `<div class="mobile-list">${Array.from({ length: count }, () => '<div class="skeleton"></div>').join("")}</div>`;
}

function emptyState(title, copy) {
  return `<div class="mobile-state"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span></div>`;
}

function userInitials() {
  return String(state.user?.displayName || "BK")
    .replace(/^Av\.\s*/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join("")
    .toLocaleUpperCase("tr-TR");
}

function safeAvatarUrl(value) {
  try {
    const url = new URL(String(value || ""), window.location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function profileAvatarMarkup(className = "", allowImage = true) {
  const avatarUrl = allowImage ? safeAvatarUrl(state.user?.avatarUrl) : "";
  const gender = String(state.user?.gender || "").toLocaleLowerCase("tr-TR");
  const genderClass = ["female", "kadın", "kadin"].includes(gender) ? "female" : ["male", "erkek"].includes(gender) ? "male" : "neutral";
  const content = avatarUrl
    ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(state.user?.displayName || "Kullanıcı")}" />`
    : genderClass === "neutral" ? escapeHtml(userInitials()) : icon("user");
  return `<span class="profile-avatar ${genderClass} ${className}">${content}</span>`;
}

function topbar() {
  const titles = { home: "Ana Sayfa", files: "Dosyalar", "file-detail": "Dosya Detayı", "deadline-detail": "Süreli İş Detayı", "task-detail": "Görev Detayı", "client-detail": "Müvekkil Kartı", calendar: "Takvim", tasks: "Görevler", more: "Diğer", clients: "Müvekkiller", hearings: "Duruşmalar", deadlines: "Süreli İşler", payments: "Ödeme Takibi", expenses: "Ofis Giderleri", notifications: "Bildirimler", profile: "Profilim" };
  const mainRoutes = new Set(["home", "files", "calendar", "hearings", "deadlines", "more"]);
  const nested = !mainRoutes.has(state.route);
  return `<header class="mobile-topbar">
    <div class="mobile-topbar-row">
      <div class="mobile-topbar-leading">${nested ? `<button class="icon-button" data-action="back" aria-label="Geri">${icon("chevronLeft")}</button>` : `<button class="icon-button" data-route="more" aria-label="Menü">${icon("menu")}</button>`}</div>
      <div class="mobile-topbar-title"><h1>${escapeHtml(titles[state.route] || "BKT Hukuk")}</h1></div>
      <div class="mobile-topbar-actions"><button class="icon-button" data-route="notifications" aria-label="Bildirimler">${icon("bell")}</button><button class="topbar-profile-button" data-route="profile" aria-label="Profilim">${profileAvatarMarkup("topbar-avatar", false)}</button></div>
    </div>
  </header>`;
}

const navItems = [
  ["home", "home", "Ana Sayfa"],
  ["files", "files", "Dosyalar"],
  ["calendar", "calendar", "Takvim"],
  ["hearings", "briefcase", "Duruşmalar"],
  ["deadlines", "clock", "Süreli İşler"]
];

function bottomNav() {
  return `<nav class="mobile-bottom-nav" aria-label="Ana navigasyon">${navItems.map(([route, iconName, label]) => `
    <button class="mobile-nav ${state.route === route ? "active" : ""}" data-route="${route}" aria-label="${label}">${icon(iconName)}<span>${label}</span></button>`).join("")}</nav>`;
}

function shell(content) {
  app.innerHTML = `<div class="mobile-shell">${topbar()}<main class="mobile-content">${content}</main>${bottomNav()}</div>`;
}

function pageHead(title, copy = "", back = false) {
  return copy ? `<div class="mobile-page-head"><p>${escapeHtml(copy)}</p></div>` : "";
}

async function loadCached(key, loader, force = false) {
  if (!force && state.cache.has(key)) return state.cache.get(key);
  const value = await loader();
  state.cache.set(key, value);
  return value;
}

function liveEnforcementAccount(file, calculationTools, paymentEvents = []) {
  if (fileTypeClass(file) !== "enforcement") return null;
  return calculateMobileEnforcementAccount({
    ...file,
    payment_events: paymentEvents
  }, calculationTools, accountDateInTimeZone());
}

async function renderHome(force = false) {
  const routeAtStart = state.route;
  shell(`<div class="welcome-card"><h1>Hoş geldiniz, ${escapeHtml(state.user.displayName || "Kullanıcı")}</h1><small>${formatDate(localIso(new Date()), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</small></div>${skeleton(4)}`);
  try {
    const data = await loadCached("dashboard", () => repository.getDashboardData({ profileId: state.user.id }), force);
    const currentDate = new Date();
    const today = localIso(currentDate);
    const hearingLimit = addDaysIso(2, currentDate);
    const deadlineLimit = addDaysIso(7, currentDate);
    const weekStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 4);
    const weekStartIso = localIso(weekStart);
    const weekEndIso = localIso(weekEnd);
    const todayHearings = data.upcomingHearings.filter(item => item.hearing_date === today);
    const weeklyHearings = data.upcomingHearings.filter(item => item.hearing_date >= weekStartIso && item.hearing_date <= weekEndIso);
    const profilesById = new Map((data.profiles || []).map(profile => [profile.id, profile]));
    const filesById = new Map((data.files || []).map(file => [file.id, file]));
    const upcomingHearings = data.upcomingHearings
      .filter(item => item.hearing_date >= today && item.hearing_date <= hearingLimit)
      .map(item => ({
        ...item,
        file: filesById.get(item.file_id) || null,
        participant_profile: profilesById.get(item.participant_profile_id) || profilesById.get(item.attendee_profile_id) || null
      }));
    const enrichWorkItem = item => ({
      ...item,
      file: filesById.get(item.file_id) || null,
      responsible_profile: profilesById.get(item.responsible_profile_id) || null
    });
    const upcomingDeadlines = data.deadlines
      .filter(item => !isCompleted(item.status) && item.due_date >= today && item.due_date <= deadlineLimit)
      .map(enrichWorkItem);
    const assignedTasks = data.assignedTasks.filter(item => !isCompleted(item.status)).map(enrichWorkItem);
    if (state.route !== routeAtStart) return;
    shell(`<div class="welcome-card"><h1>Hoş geldiniz, ${escapeHtml(state.user.displayName || "Kullanıcı")}</h1><small>${formatDate(today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</small></div>
      <section class="metric-grid">
        ${metric(icon("calendarDay"), todayHearings.length, ["Bugünkü", "Duruşmalar"], "blue")}
        ${metric(icon("calendarWeek"), weeklyHearings.length, ["Haftanın", "Duruşmaları"], "green")}
        ${metric(icon("tasks"), assignedTasks.length, ["Bana Atanmış", "Görevler"], "purple")}
        ${metric(icon("clock"), upcomingDeadlines.length, ["Yaklaşan", "Süreler"], "orange")}
      </section>
      ${homeSection("Yaklaşan Duruşmalar", "hearings", upcomingHearings, hearingCard, "Yaklaşan duruşma bulunmuyor.")}
      ${homeSection("Yaklaşan Süreler", "deadlines", upcomingDeadlines, deadlineCard, "Yaklaşan süreli iş bulunmuyor.")}
      ${homeSection("Bana Atanmış Görevler", "tasks", assignedTasks.slice(0, 2), taskCard, "Size atanmış aktif görev bulunmuyor.")}`);
  } catch (error) {
    if (state.route !== routeAtStart) return;
    console.error("[BKT mobile] Dashboard yüklenemedi.", { message: error?.message || String(error) });
    shell(`<div class="welcome-card"><small>${formatDate(localIso(new Date()))}</small><h1>BKT Hukuk</h1><p>Günlük operasyon merkezi</p></div>${emptyState("Ana sayfa yüklenemedi", "İnternet bağlantınızı kontrol edip yeniden deneyin.")}`);
  }
}

function metric(iconHtml, value, labelLines, tone) {
  const labels = (Array.isArray(labelLines) ? labelLines : [labelLines]).map(label => `<span>${escapeHtml(label)}</span>`).join("");
  return `<article class="metric-card ${tone}"><div class="metric-label">${labels}</div><div class="metric-value">${value}</div><div class="metric-card-head"><span class="metric-icon">${iconHtml}</span></div></article>`;
}

function homeSection(title, route, rows, renderer, emptyText) {
  return `<section class="mobile-section home-section-${escapeHtml(route)}"><div class="section-heading"><h2>${title}</h2><button data-route="${route}">Tümünü Gör</button></div>${rows.length ? `<div class="mobile-list">${rows.map(renderer).join("")}</div>` : emptyState(emptyText, "Yeni kayıtlar oluştuğunda burada gösterilir.")}</section>`;
}

function hearingCard(row) {
  const court = row.court || row.file?.court_or_office || "Mahkeme belirtilmedi";
  const fileNo = row.case_file_no || row.file?.file_no || "Dosya no yok";
  const participant = row.participant_profile?.display_name || row.participant_profile?.displayName || row.participant_name || row.attendee_name || "Belirtilmedi";
  const rawExcuse = String(row.excuse_type || "").trim();
  const excuse = !rawExcuse || ["yok", "hayır", "hayir", "none", "no"].includes(rawExcuse.toLocaleLowerCase("tr-TR")) ? "Mazeret Yok" : rawExcuse;
  return `<article class="mobile-list-card hearing-card hearing-${fileTypeClass(row.file || row)}"><span class="hearing-time"><strong>${formatTime(row.hearing_time)}</strong><small>${formatDate(row.hearing_date, { day: "2-digit", month: "short" })}</small></span><div class="list-content"><span class="list-title hearing-title">${escapeHtml(court)} · ${escapeHtml(fileNo)}</span><div class="list-meta hearing-meta"><span>${escapeHtml(excuse)} - ${escapeHtml(participant)}</span></div></div></article>`;
}

function deadlineCard(row) {
  return `<button type="button" class="mobile-list-card mobile-record-card" data-deadline-id="${escapeHtml(row.id || "")}"><span class="list-icon">${icon("clock")}</span><span class="list-content"><span class="list-title">${escapeHtml(row.title || row.task || "Süreli iş")}</span><span class="list-note record-file-label">${escapeHtml(linkedFileLabel(row))}</span><span class="list-meta"><span>Son gün: ${formatDate(row.due_date)}</span><span>${escapeHtml(responsibleDisplayName(row))}</span></span></span>${dueBadge(row)}</button>`;
}

function taskCard(row) {
  const fileLabel = row.file ? `Dosyaya Bağlı Görev · ${linkedFileLabel(row)}` : "Ofis Görevi";
  return `<button type="button" class="mobile-list-card mobile-record-card" data-task-id="${escapeHtml(row.id || "")}"><span class="list-icon">${icon("tasks")}</span><span class="list-content"><span class="list-title">${escapeHtml(row.title || "Görev")}</span><span class="list-note record-file-label">${escapeHtml(fileLabel)}</span><span class="list-meta"><span>Son gün: ${formatDate(row.due_date)}</span><span>${escapeHtml(responsibleDisplayName(row))}</span></span>${row.description ? `<span class="list-note">${escapeHtml(row.description)}</span>` : ""}</span>${dueBadge(row)}</button>`;
}

async function loadWorkItemDetail(kind, id, force = false) {
  const key = `${kind}-detail:${id}`;
  return loadCached(key, async () => {
    const row = kind === "deadline" ? await repository.getDeadline(id) : await repository.getTask(id);
    if (!row) return null;
    const [file, profiles] = await Promise.all([
      row.file_id ? repository.getFile(row.file_id) : Promise.resolve(null),
      repository.listProfiles().catch(error => {
        console.error(`[BKT mobile] ${kind} sorumlu profili yüklenemedi.`, { message: error?.message || String(error) });
        return [];
      })
    ]);
    return {
      ...row,
      file,
      responsible_profile: profiles.find(profile => profile.id === row.responsible_profile_id) || null
    };
  }, force);
}

function workItemDetailMarkup(row, kind) {
  const due = dueDatePresentation(row);
  const isTask = kind === "task";
  const file = row.file;
  const fileType = isTask ? (file ? "Dosyaya Bağlı Görev" : "Ofis Görevi") : "Süreli İş";
  const detailRows = [
    [isTask ? "Görev Türü" : "Kayıt Türü", fileType],
    ["Dosya ID", file?.display_id || file?.legacy_id],
    ["Mahkeme / İcra Dairesi", file?.court_or_office],
    ["Dosya No", file?.file_no],
    ["Başlangıç Tarihi", !isTask ? formatDate(row.start_date) : ""],
    ["Son Gün", formatDate(row.due_date)],
    ["Kalan Süre", due.label],
    ["Sorumlu", responsibleDisplayName(row)],
    ["Durum", row.status || (isCompleted(row.status) ? "Tamamlandı" : "Aktif")],
    ["Tamamlanma Tarihi", row.completed_at ? formatDate(row.completed_at) : ""]
  ];
  const completeAction = isTask && !isCompleted(row.status) && state.user.permissions?.edit
    ? `<button class="mobile-primary mobile-detail-action" type="button" data-complete-task="${escapeHtml(row.id)}">Görevi Tamamla</button>`
    : "";
  return `<section class="record-detail-hero"><span class="list-icon">${icon(isTask ? "tasks" : "clock")}</span><div><small>${escapeHtml(fileType)}</small><h2>${escapeHtml(row.title || row.task || (isTask ? "Görev" : "Süreli İş"))}</h2></div>${dueBadge(row)}</section>${row.description ? `<section class="record-description"><span>Açıklama</span><p>${escapeHtml(row.description)}</p></section>` : ""}${infoCard(detailRows)}${completeAction}`;
}

async function renderDeadlineDetail(force = false) {
  const routeAtStart = state.route;
  shell(skeleton(3));
  try {
    const row = await loadWorkItemDetail("deadline", state.deadlineDetailId, force);
    if (state.route !== routeAtStart) return;
    if (!row) throw new Error("Süreli iş bulunamadı.");
    shell(workItemDetailMarkup(row, "deadline"));
  } catch (error) {
    if (state.route !== routeAtStart) return;
    console.error("[BKT mobile] Süreli iş detayı yüklenemedi.", { message: error?.message || String(error) });
    shell(emptyState("Süreli iş detayı yüklenemedi", "Kayıt silinmiş veya bağlantı kesilmiş olabilir."));
  }
}

async function renderTaskDetail(force = false) {
  const routeAtStart = state.route;
  shell(skeleton(3));
  try {
    const row = await loadWorkItemDetail("task", state.taskDetailId, force);
    if (state.route !== routeAtStart) return;
    if (!row) throw new Error("Görev bulunamadı.");
    shell(workItemDetailMarkup(row, "task"));
  } catch (error) {
    if (state.route !== routeAtStart) return;
    console.error("[BKT mobile] Görev detayı yüklenemedi.", { message: error?.message || String(error) });
    shell(emptyState("Görev detayı yüklenemedi", "Kayıt silinmiş veya bağlantı kesilmiş olabilir."));
  }
}

async function renderFiles(force = false) {
  const routeAtStart = state.route;
  shell(`${pageHead("Dosyalar", "Dava ve icra dosyalarınızı mobil kartlarla inceleyin.")}<div class="mobile-search">${icon("search")}<input id="mobileFileSearch" type="search" placeholder="Dosya no, mahkeme veya müvekkil ara" value="${escapeHtml(state.fileSearch)}" /></div>${fileChips()}${skeleton(4)}`);
  try {
    const [files, calculationTools, collections] = await Promise.all([loadCached("files", async () => {
      const [fileRows, partyRows] = await Promise.all([
        repository.getFiles(),
        repository.getFileParties({ representedByOffice: true }).catch(error => {
          console.error("[BKT mobile] Dosya taraf sıfatları yüklenemedi.", { message: error?.message || String(error) });
          return [];
        })
      ]);
      const primaryPartyByFile = new Map();
      partyRows.forEach(party => {
        if (party.file_id && !primaryPartyByFile.has(party.file_id)) primaryPartyByFile.set(party.file_id, party);
      });
      return fileRows.map(file => ({ ...file, represented_party: primaryPartyByFile.get(file.id) || null }));
    }, force), loadCached("calculation-tools", () => repository.getCalculationTools(), force), loadCached("collections", () => repository.getCollections(), force)]);
    if (state.route !== routeAtStart) return;
    const collectionsByFile = new Map();
    collections.forEach(collection => {
      if (!collection.file_id) return;
      if (!collectionsByFile.has(collection.file_id)) collectionsByFile.set(collection.file_id, []);
      collectionsByFile.get(collection.file_id).push(collection);
    });
    renderFileResults(files.map(file => ({
      ...file,
      calculated_enforcement_account: liveEnforcementAccount(file, calculationTools, collectionsByFile.get(file.id) || [])
    })));
  } catch (error) {
    if (state.route !== routeAtStart) return;
    console.error("[BKT mobile] Dosyalar yüklenemedi.", { message: error?.message || String(error) });
    shell(`${pageHead("Dosyalar")}${emptyState("Dosyalar yüklenemedi", "Bağlantınızı kontrol edip yeniden deneyin.")}`);
  }
}

function fileChips() {
  return `<div class="chip-row"><button class="filter-chip ${state.fileFilter === "all" ? "active" : ""}" data-file-filter="all">Tümü</button><button class="filter-chip ${state.fileFilter === "law" ? "active" : ""}" data-file-filter="law">Hukuk</button><button class="filter-chip ${state.fileFilter === "criminal" ? "active" : ""}" data-file-filter="criminal">Ceza</button><button class="filter-chip ${state.fileFilter === "enforcement" ? "active" : ""}" data-file-filter="enforcement">İcra</button></div>`;
}

function renderFileResults(files) {
  const query = state.fileSearch.trim().toLocaleLowerCase("tr-TR");
  const filtered = [...files].sort((left, right) => {
    const sequenceDifference = fileSequence(right) - fileSequence(left);
    if (sequenceDifference) return sequenceDifference;
    return Date.parse(right.created_at || 0) - Date.parse(left.created_at || 0);
  }).filter(file => {
    const type = String(file.file_type || file.record_kind || "").toLocaleLowerCase("tr-TR");
    const enforcement = type.includes("icra");
    if (state.fileFilter === "law" && !type.includes("hukuk")) return false;
    if (state.fileFilter === "criminal" && !type.includes("ceza")) return false;
    if (state.fileFilter === "enforcement" && !enforcement) return false;
    return !query || [file.display_id, file.legacy_id, file.file_no, file.court_or_office, file.client_name, file.subject].some(value => String(value || "").toLocaleLowerCase("tr-TR").includes(query));
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / MOBILE_FILE_PAGE_SIZE));
  state.filePage = Math.min(Math.max(1, state.filePage), totalPages);
  const pageStart = (state.filePage - 1) * MOBILE_FILE_PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + MOBILE_FILE_PAGE_SIZE);
  const content = `${pageHead("Dosyalar", `${filtered.length} kayıt görüntüleniyor.`)}<div class="mobile-search">${icon("search")}<input id="mobileFileSearch" type="search" placeholder="Dosya no, mahkeme veya müvekkil ara" value="${escapeHtml(state.fileSearch)}" /></div>${fileChips()}${filtered.length ? `<div class="mobile-list">${pageRows.map(fileCard).join("")}</div>${filePagination(state.filePage, totalPages)}` : emptyState("Dosya bulunamadı", "Arama veya filtre seçiminizi değiştirin.")}`;
  shell(content);
  const search = document.querySelector("#mobileFileSearch");
  search?.setSelectionRange(search.value.length, search.value.length);
}

function filePagination(currentPage, totalPages) {
  if (totalPages <= 1) return "";
  const start = Math.max(1, Math.min(currentPage - 1, totalPages - 2));
  const end = Math.min(totalPages, start + 2);
  const pages = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  return `<nav class="mobile-pagination" aria-label="Dosya sayfaları"><button data-file-page="1" ${currentPage === 1 ? "disabled" : ""}>İlk</button><button data-file-page="${Math.max(1, currentPage - 1)}" ${currentPage === 1 ? "disabled" : ""}>Geri</button>${pages.map(page => `<button class="${page === currentPage ? "active" : ""}" data-file-page="${page}" aria-label="${page}. sayfa">${page}</button>`).join("")}<button data-file-page="${Math.min(totalPages, currentPage + 1)}" ${currentPage === totalPages ? "disabled" : ""}>İleri</button><button data-file-page="${totalPages}" ${currentPage === totalPages ? "disabled" : ""}>Son</button></nav>`;
}

function fileCard(file) {
  const enforcement = fileTypeClass(file) === "enforcement";
  const displayId = file.display_id || file.legacy_id || file.file_no || "Dosya";
  const court = file.court_or_office || "Mahkeme / icra dairesi belirtilmedi";
  const fileNo = file.file_no || "Dosya no yok";
  const representedParty = file.represented_party || {};
  const clientName = representedParty.client?.name || representedParty.name || file.client_name || "Müvekkil belirtilmedi";
  const partyRole = representedParty.role_label || representedParty.role || representedParty.party_type || file.metadata?.partyRole || (enforcement ? "Alacaklı" : "");
  const partyText = [clientName, partyRole].filter(Boolean).join(" · ");
  const accountInfo = file.account_info && typeof file.account_info === "object" ? file.account_info : {};
  const currentDebt = file.calculated_enforcement_account?.currentDebt ?? accountInfo.currentDebt ?? accountInfo.current_debt ?? file.currentDebt;
  const statusTone = fileStatusTone(file.status);
  const leading = `<span class="file-card-leading"><span class="list-icon">${icon(enforcement ? "files" : "briefcase")}</span><span class="file-card-id">${escapeHtml(displayId)}</span></span>`;
  const detailLines = enforcement
    ? `<span class="list-note file-card-party">${escapeHtml(partyText)}</span><span class="list-note file-card-account">Güncel Kapak Hesabı: ${currentDebt === undefined || currentDebt === null || currentDebt === "" ? "Belirtilmedi" : escapeHtml(formatCurrency(currentDebt, accountInfo.currency || "TRY"))}</span>`
    : `<span class="list-note file-card-subject">${escapeHtml(file.subject || "Konu belirtilmedi")}</span><span class="list-note file-card-party">${escapeHtml(partyText)}</span>`;
  return `<button class="mobile-list-card file-list-card ${enforcement ? "is-enforcement" : "is-lawsuit"}" data-file-id="${file.id}">${leading}<span class="list-content"><span class="list-title file-card-title">${escapeHtml(court)} · ${escapeHtml(fileNo)}</span>${detailLines}</span><span class="list-tail"><span class="mobile-badge ${statusTone}">${escapeHtml(file.status || (enforcement ? "İcra" : "Dava"))}</span><span class="chevron">›</span></span></button>`;
}

async function renderFileDetail(force = false) {
  const routeAtStart = state.route;
  shell(`${pageHead("Dosya Detayı", "", true)}${skeleton(4)}`);
  try {
    const key = `file-detail:${state.detailId}`;
    const data = await loadCached(key, async () => {
      const file = await repository.getFile(state.detailId);
      if (!file) return { file: null, parties: [], hearings: [], deadlines: [], tasks: [], collections: [], plans: [], notes: [], timeline: [] };
      const enforcement = fileTypeClass(file) === "enforcement";
      const [parties, hearings, deadlines, tasks, collections, plans, notes, timeline] = await Promise.all([
        repository.getFileParties({ fileId: state.detailId }),
        enforcement ? Promise.resolve([]) : repository.getHearings({ fileId: state.detailId }),
        enforcement ? Promise.resolve([]) : repository.getDeadlines({ fileId: state.detailId }),
        enforcement ? Promise.resolve([]) : repository.getTasks({ fileId: state.detailId }),
        repository.getCollections({ fileId: state.detailId }),
        repository.getPaymentPlans({ fileId: state.detailId }),
        repository.getFileNotes({ fileId: state.detailId }),
        repository.getTimelineEvents({ fileId: state.detailId })
      ]);
      return { file, parties, hearings, deadlines, tasks, collections, plans, notes, timeline };
    }, force);
    if (state.route !== routeAtStart) return;
    if (!data.file) throw new Error("Dosya bulunamadı.");
    const file = data.file;
    const enforcement = fileTypeClass(file) === "enforcement";
    const calculationTools = enforcement
      ? await loadCached("calculation-tools", () => repository.getCalculationTools(), force)
      : null;
    const viewData = {
      ...data,
      enforcementAccount: enforcement ? liveEnforcementAccount(file, calculationTools, data.collections) : null
    };
    if (state.route !== routeAtStart) return;
    const tabs = enforcement
      ? [["general","Genel Bilgi"],["parties","Taraflar"],["account","Dosya Hesabı"],["payments","Ödemeler"],["notes","Notlar"],["timeline","Zaman Çizelgesi"]]
      : [["general","Genel Bilgi"],["parties","Taraflar"],["hearings","Duruşmalar"],["deadlines","Süreler"],["tasks","Görevler"],["notes","Notlar"],["timeline","Zaman Çizelgesi"]];
    if (!tabs.some(([id]) => id === state.detailTab)) state.detailTab = "general";
    const displayId = file.display_id || file.legacy_id || "Dosya ID belirtilmedi";
    const court = file.court_or_office || "Mahkeme / icra dairesi belirtilmedi";
    const fileNo = file.file_no || "Dosya no yok";
    shell(`${pageHead("Dosya Detayı", "", true)}<section class="file-hero"><h1>${escapeHtml(court)} · ${escapeHtml(fileNo)}</h1><div class="file-hero-meta"><span class="mobile-badge">ID: ${escapeHtml(displayId)}</span><span class="mobile-badge">${escapeHtml(file.file_type || file.record_kind || "Dosya")}</span><span class="mobile-badge ${fileStatusTone(file.status)}">${escapeHtml(file.status || "Durum belirtilmedi")}</span></div></section><div class="detail-tabs">${tabs.map(([id,label]) => `<button class="detail-tab ${state.detailTab === id ? "active" : ""}" data-detail-tab="${id}">${label}</button>`).join("")}</div><section class="detail-panel">${detailPanel(viewData)}</section>`);
  } catch (error) {
    if (state.route !== routeAtStart) return;
    console.error("[BKT mobile] Dosya detayı yüklenemedi.", { message: error?.message || String(error) });
    shell(`${pageHead("Dosya Detayı", "", true)}${emptyState("Dosya detayı yüklenemedi", "Kayıt silinmiş veya bağlantı kesilmiş olabilir.")}`);
  }
}

function detailPanel(data) {
  const file = data.file;
  if (state.detailTab === "general") return infoCard([["Dosya ID", file.display_id || file.legacy_id],["Mahkeme / Daire", file.court_or_office],["Dosya No", file.file_no],["Müvekkil", file.client_name],["Karşı Taraf", file.opponent_name],["Konu", file.subject],["Sorumlu", file.responsible_profile?.display_name || file.responsible_name],["Açılış", formatDate(file.opening_date)],["Durum", file.status]]);
  if (state.detailTab === "parties") return data.parties.length ? `<div class="mobile-list">${data.parties.map(party => `<article class="mobile-list-card"><span class="list-icon">${icon(party.client?.client_type === "legal" ? "building" : "user")}</span><div class="list-content"><span class="list-title">${escapeHtml(party.client?.name || party.name || "Taraf")}</span><div class="list-meta"><span>${escapeHtml(party.role_label || party.role || party.party_type || "Rol belirtilmedi")}</span><span>${party.represented_by_office ? "Büromuzca temsil ediliyor" : "Karşı taraf"}</span></div></div></article>`).join("")}</div>` : emptyState("Taraf bulunmuyor", "Bu dosyaya bağlı taraf kaydı yok.");
  if (state.detailTab === "account") return enforcementAccountPanel(file, data.enforcementAccount);
  if (state.detailTab === "hearings") return listOrEmpty(data.hearings, hearingCard, "Duruşma bulunmuyor");
  if (state.detailTab === "deadlines") return listOrEmpty(data.deadlines, deadlineCard, "Süreli iş bulunmuyor");
  if (state.detailTab === "tasks") return listOrEmpty(data.tasks, taskCard, "Görev bulunmuyor");
  if (state.detailTab === "payments") return listOrEmpty([...data.collections, ...data.plans], paymentCard, "Ödeme kaydı bulunmuyor");
  if (state.detailTab === "notes") return listOrEmpty(data.notes, noteCard, "Not bulunmuyor");
  return listOrEmpty(data.timeline, timelineCard, "Zaman çizelgesi kaydı bulunmuyor");
}

function infoCard(rows) {
  return `<dl class="info-card">${rows.filter(([,value]) => value).map(([label,value]) => `<div class="info-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
}

function enforcementAccountPanel(file, calculatedAccount = null) {
  const account = file.account_info && typeof file.account_info === "object" ? file.account_info : {};
  const currency = account.currency || "TRY";
  const money = value => value === undefined || value === null || value === "" ? "Belirtilmedi" : formatCurrency(value, currency);
  return `<section class="enforcement-account-card"><div class="enforcement-account-total"><span>Güncel Kapak Hesabı</span><strong>${money(calculatedAccount?.currentDebt ?? account.currentDebt ?? account.current_debt)}</strong></div>${infoCard([
    ["Asıl Alacak", money(account.principal)],
    ["Takip Öncesi Faiz", money(account.preInterest ?? account.pre_interest)],
    ["Takipte Kesinleşen Tutar", money(calculatedAccount?.finalizedAmount ?? account.finalizedAmount ?? account.finalized_amount)],
    ["Takip Sonrası Faiz", money(calculatedAccount?.postInterest ?? account.postInterest ?? account.post_interest)],
    ["Harç", money(calculatedAccount?.fees ?? account.fees)],
    ["Masraf", money(account.expenses)],
    ["Vekalet Ücreti", money(calculatedAccount?.attorneyFee ?? account.attorneyFee ?? account.attorney_fee)],
    ["Tahsil Edilen", money(calculatedAccount?.totalPayments ?? account.payments)]
  ])}</section>`;
}
function listOrEmpty(rows, renderer, title) { return rows.length ? `<div class="mobile-list">${rows.map(renderer).join("")}</div>` : emptyState(title, "Yeni kayıtlar masaüstü uygulamasından yönetilir."); }
function paymentCard(row) { return `<article class="mobile-list-card"><span class="list-icon">${icon("money")}</span><div class="list-content"><span class="list-title">${escapeHtml(row.party_name || row.title || row.description || row.plan_type || "Ödeme")}</span><div class="list-meta"><span>${escapeHtml(row.file?.file_no || row.plan_type || row.payment_kind || "Finans kaydı")}</span><span>${formatDate(row.collection_date || row.payment_date || row.due_date || row.created_at)}</span></div></div><strong class="mobile-badge">${formatCurrency(row.amount || row.agreement_amount || row.total_amount, row.currency || "TRY")}</strong></article>`; }
function paymentPlanTotalsMobile(plan = {}) {
  const agreement = parseAmount(plan.agreement_amount ?? plan.agreementAmount);
  const initial = parseAmount(plan.initial_payment ?? plan.initialPayment);
  const installmentPaid = (plan.installments || []).reduce((sum, installment) => sum + parseAmount(installment.paid_amount ?? installment.paidAmount), 0);
  const collected = Math.min(agreement, initial + installmentPaid);
  return { agreement, collected, remaining: Math.max(0, agreement - collected) };
}
function paymentPlanStatusMobile(plan = {}) {
  const totals = paymentPlanTotalsMobile(plan);
  if (totals.remaining <= 0.005) return { label: "Tamamlandı", tone: "success" };
  const today = localIso(new Date());
  const overdue = (plan.installments || []).some(installment => {
    const amount = parseAmount(installment.amount);
    const paid = parseAmount(installment.paid_amount ?? installment.paidAmount);
    const dueDate = installment.due_date || installment.dueDate;
    return paid + 0.005 < amount && dueDate && dueDate < today;
  });
  return overdue ? { label: "Gecikmiş", tone: "danger" } : { label: "Aktif", tone: "success" };
}
function paymentPlanCard(plan) {
  const totals = paymentPlanTotalsMobile(plan);
  const status = paymentPlanStatusMobile(plan);
  const partyName = plan.party_name || plan.client?.name || "Ödeme planı";
  const nextInstallment = (plan.installments || []).find(installment => parseAmount(installment.paid_amount ?? installment.paidAmount) + 0.005 < parseAmount(installment.amount));
  const nextDueDate = nextInstallment?.due_date || nextInstallment?.dueDate || plan.first_due_date || plan.firstDueDate;
  return `<article class="mobile-list-card mobile-payment-plan-card"><span class="list-icon">${icon("money")}</span><div class="list-content"><span class="list-title">${escapeHtml(partyName)}</span><div class="list-meta"><span>${escapeHtml(plan.plan_type || plan.type || "Ödeme Planı")}</span><span>Sonraki vade: ${formatDate(nextDueDate)}</span></div><div class="list-note">Tahsil: ${escapeHtml(formatCurrency(totals.collected, plan.currency || "TRY"))} · Kalan: ${escapeHtml(formatCurrency(totals.remaining, plan.currency || "TRY"))}</div></div><span class="mobile-badge ${status.tone}">${status.label}</span></article>`;
}
function expenseCard(row, categoryMap = new Map()) { return `<article class="mobile-list-card"><span class="list-icon">${icon("briefcase")}</span><div class="list-content"><span class="list-title">${escapeHtml(row.title || row.description || categoryMap.get(row.category_id) || "Ofis gideri")}</span><div class="list-meta"><span>${escapeHtml(categoryMap.get(row.category_id) || row.category_name || "Kategori belirtilmedi")}</span><span>${formatDate(row.expense_date || row.due_date)}</span><span>${escapeHtml(row.payment_source_label || row.payment_source || "Ödeme kaynağı belirtilmedi")}</span></div></div><strong class="mobile-badge ${isCompleted(row.status) ? "success" : "warn"}">${formatCurrency(row.amount, row.currency || "TRY")}</strong></article>`; }
function noteCard(row) { return `<article class="mobile-list-card"><span class="list-icon">${icon("note")}</span><div class="list-content"><span class="list-title">${escapeHtml(row.title || "Dosya Notu")}</span><div class="list-note">${escapeHtml(row.content || row.note || "")}</div><div class="list-meta"><span>${formatDate(row.created_at)}</span></div></div></article>`; }
function timelineCard(row) { return `<article class="mobile-list-card"><span class="list-icon">${icon("clock")}</span><div class="list-content"><span class="list-title">${escapeHtml(row.title || row.event_type || "İşlem")}</span><div class="list-note">${escapeHtml(row.description || "")}</div><div class="list-meta"><span>${formatDate(row.event_date || row.created_at)}</span></div></div></article>`; }

async function renderHearings(force = false) {
  const routeAtStart = state.route;
  const range = hearingDateRange();
  shell(`${hearingControls(range)}${skeleton(4)}`);
  try {
    const key = `mobile-hearings:${state.hearingView}:${range.dateFrom}:${range.dateTo}`;
    const hearings = await loadCached(key, () => repository.getHearings({ dateFrom: range.dateFrom, dateTo: range.dateTo }), force);
    if (state.route !== routeAtStart) return;
    state.hearingRows = hearings;
    shell(`${hearingControls(range)}${hearings.length ? `<div class="mobile-list">${hearings.map(hearingCard).join("")}</div>` : emptyState("Duruşma bulunmuyor", "Seçili tarih aralığında aktif duruşma yok.")}`);
  } catch (error) {
    if (state.route !== routeAtStart) return;
    state.hearingRows = [];
    console.error("[BKT mobile] Duruşmalar yüklenemedi.", { message: error?.message || String(error) });
    shell(`${hearingControls(range)}${emptyState("Duruşmalar yüklenemedi", "Bağlantınızı kontrol edip yeniden deneyin.")}`);
  }
}

function hearingControls(range) {
  const views = [["day", "Günlük"], ["week", "Haftalık"], ["month", "Aylık"]];
  return `<div class="hearing-view-toolbar"><div class="view-switch" role="group" aria-label="Duruşma görünümü">${views.map(([value, label]) => `<button class="${state.hearingView === value ? "active" : ""}" data-hearing-view="${value}">${label}</button>`).join("")}</div></div><div class="period-nav"><button data-hearing-move="-1" aria-label="Önceki dönem">‹</button><strong>${escapeHtml(range.label)}</strong><button class="period-today" data-hearing-move="0">Bugün</button><button data-hearing-move="1" aria-label="Sonraki dönem">›</button></div>`;
}

function hearingParticipant(row) {
  return row.participant_profile?.display_name || row.participant_profile?.displayName || row.participant_name || row.attendee_name || "Belirtilmedi";
}

function hearingExcuse(row) {
  const value = String(row.excuse_type || "").trim();
  return !value || ["yok", "hayır", "hayir", "none", "no"].includes(value.toLocaleLowerCase("tr-TR")) ? "Mazeret Yok" : value;
}

function hearingPrintSlots(range) {
  if (state.hearingView === "day") {
    return [{ start: range.dateFrom, end: range.dateTo, title: formatDate(range.dateFrom, { weekday: "long", day: "2-digit", month: "long", year: "numeric" }) }];
  }
  if (state.hearingView === "week") {
    const start = localDate(range.dateFrom);
    return Array.from({ length: 5 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const iso = localIso(date);
      return { start: iso, end: iso, title: formatDate(iso, { weekday: "long", day: "2-digit", month: "long", year: "numeric" }) };
    });
  }
  const slots = [];
  const monthStart = localDate(range.dateFrom);
  const monthEnd = localDate(range.dateTo);
  const cursor = new Date(monthStart);
  cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
  let week = 1;
  while (cursor <= monthEnd) {
    const start = new Date(cursor);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    slots.push({
      start: localIso(start),
      end: localIso(end),
      title: `${week}. Hafta · ${formatDate(localIso(start), { day: "2-digit", month: "short" })} - ${formatDate(localIso(end), { day: "2-digit", month: "short", year: "numeric" })}`
    });
    cursor.setDate(cursor.getDate() + 7);
    week += 1;
  }
  return slots;
}

function hearingPrintTitle(range) {
  if (state.hearingView === "month") return `${range.label} Duruşma Listesi`;
  const start = formatDate(range.dateFrom, { day: "2-digit", month: "long", year: "numeric" });
  const end = formatDate(range.dateTo, { day: "2-digit", month: "long", year: "numeric" });
  return `${start}${range.dateFrom === range.dateTo ? "" : ` - ${end}`} Duruşma Listesi`;
}

function hearingPrintPanel(range, rows) {
  const slots = hearingPrintSlots(range);
  const sortedRows = [...rows].sort((left, right) => `${left.hearing_date || ""}${left.hearing_time || ""}`.localeCompare(`${right.hearing_date || ""}${right.hearing_time || ""}`));
  return `<section class="mobile-print-hearings print-${state.hearingView}" aria-hidden="true"><h1>${escapeHtml(hearingPrintTitle(range))}</h1><div class="mobile-print-calendar">${slots.map(slot => {
    const slotRows = sortedRows.filter(row => row.hearing_date >= slot.start && row.hearing_date <= slot.end);
    return `<section class="mobile-print-day"><h2>${escapeHtml(slot.title)}</h2>${slotRows.length ? slotRows.map(row => {
      const court = row.court || row.file?.court_or_office || "Mahkeme belirtilmedi";
      const fileNo = row.case_file_no || row.file?.file_no || "Dosya no yok";
      const party = [row.client_name, row.party_role].filter(Boolean).join(" · ");
      const responsible = row.file?.responsible_name || "";
      return `<article class="mobile-print-hearing"><strong>${escapeHtml(formatDate(row.hearing_date))} · ${escapeHtml(formatTime(row.hearing_time))} · ${escapeHtml(hearingParticipant(row))}</strong><span>${escapeHtml(court)} · ${escapeHtml(fileNo)}</span>${party ? `<span>${escapeHtml(party)}</span>` : ""}<span>${escapeHtml([hearingExcuse(row), responsible].filter(Boolean).join(" · "))}</span>${row.note ? `<span>${escapeHtml(row.note)}</span>` : ""}</article>`;
    }).join("") : `<div class="mobile-print-empty">Kayıt yok</div>`}</section>`;
  }).join("")}</div></section>`;
}

function printMobileHearings() {
  if (!document.querySelector(".mobile-print-hearings")) {
    showToast("PDF çıktısı hazırlanamadı.");
    return;
  }
  document.body.dataset.mobileRestoreTitle = document.title;
  document.title = "";
  document.body.classList.add("mobile-printing-hearings");
  window.print();
}

async function renderDeadlines(force = false) {
  const routeAtStart = state.route;
  shell(`${deadlineChips()}${skeleton(4)}`);
  try {
    const deadlines = await loadCached("mobile-deadlines", () => repository.getDeadlines({}), force);
    if (state.route !== routeAtStart) return;
    const filtered = deadlines.filter(deadline => state.deadlineFilter === "completed" ? isCompleted(deadline.status) : !isCompleted(deadline.status));
    shell(`${deadlineChips()}${filtered.length ? `<div class="mobile-list">${filtered.map(deadlineCard).join("")}</div>` : emptyState(state.deadlineFilter === "completed" ? "Tamamlanan süreli iş bulunmuyor" : "Aktif süreli iş bulunmuyor", "Seçili listede gösterilecek kayıt yok.")}`);
  } catch (error) {
    if (state.route !== routeAtStart) return;
    console.error("[BKT mobile] Süreli işler yüklenemedi.", { message: error?.message || String(error) });
    shell(`${deadlineChips()}${emptyState("Süreli işler yüklenemedi", "Bağlantınızı kontrol edip yeniden deneyin.")}`);
  }
}

function deadlineChips() {
  return `<div class="view-switch list-status-switch" role="group" aria-label="Süreli iş listesi"><button class="${state.deadlineFilter === "active" ? "active" : ""}" data-deadline-filter="active">Aktif İşler</button><button class="${state.deadlineFilter === "completed" ? "active" : ""}" data-deadline-filter="completed">Tamamlananlar</button></div>`;
}

async function renderTasks(force = false) {
  const routeAtStart = state.route;
  shell(`${pageHead("Görevler", "Size atanmış ofis ve dosya görevleri.")}${taskChips()}${skeleton(4)}`);
  try {
    const tasks = await loadCached("tasks", () => repository.getTasks({ responsibleProfileId: state.user.id }), force);
    if (state.route !== routeAtStart) return;
    const filtered = tasks.filter(task => state.taskFilter === "completed" ? isCompleted(task.status) : !isCompleted(task.status));
    shell(`${pageHead("Görevler", `${filtered.length} görev görüntüleniyor.`)}${taskChips()}${filtered.length ? `<div class="mobile-list">${filtered.map(task => taskActionCard(task)).join("")}</div>` : emptyState("Görev bulunmuyor", "Seçili filtreye uygun göreviniz yok.")}`);
  } catch (error) {
    if (state.route !== routeAtStart) return;
    console.error("[BKT mobile] Görevler yüklenemedi.", { message: error?.message || String(error) });
    shell(`${pageHead("Görevler")}${emptyState("Görevler yüklenemedi", "Bağlantınızı kontrol edip yeniden deneyin.")}`);
  }
}

function taskChips() {
  return `<div class="view-switch list-status-switch" role="group" aria-label="Görev listesi"><button class="${state.taskFilter === "active" ? "active" : ""}" data-task-filter="active">Aktif Görevler</button><button class="${state.taskFilter === "completed" ? "active" : ""}" data-task-filter="completed">Tamamlananlar</button></div>`;
}

function taskActionCard(task) {
  const canComplete = !isCompleted(task.status) && Boolean(state.user.permissions?.edit);
  const fileLabel = task.file ? `Dosyaya Bağlı Görev · ${linkedFileLabel(task)}` : "Ofis Görevi";
  return `<article class="mobile-list-card mobile-action-card"><button type="button" class="mobile-card-main" data-task-id="${escapeHtml(task.id || "")}"><span class="list-icon">${icon("tasks")}</span><span class="list-content"><span class="list-title">${escapeHtml(task.title || "Görev")}</span><span class="list-note record-file-label">${escapeHtml(fileLabel)}</span><span class="list-meta"><span>Son gün: ${formatDate(task.due_date)}</span><span>${escapeHtml(responsibleDisplayName(task))}</span></span>${task.description ? `<span class="list-note">${escapeHtml(task.description)}</span>` : ""}</span></button><span class="mobile-card-aside">${dueBadge(task)}${canComplete ? `<button class="mobile-complete-button" type="button" data-complete-task="${escapeHtml(task.id)}">${icon("check")}<span>Tamamla</span></button>` : ""}</span></article>`;
}

async function renderCalendar(force = false) {
  const routeAtStart = state.route;
  const monthStart = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth(), 1);
  const monthEnd = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + 1, 0);
  shell(`${pageHead("Takvim", "Duruşmaları ve günlük işlerinizi takip edin.")}${skeleton(4)}`);
  try {
    const key = `calendar:${localIso(monthStart)}`;
    const data = await loadCached(key, async () => {
      const [hearings, deadlines, tasks] = await Promise.all([repository.getHearings({ dateFrom: localIso(monthStart), dateTo: localIso(monthEnd) }), repository.getDeadlines({ dateFrom: localIso(monthStart), dateTo: localIso(monthEnd) }), repository.getTasks({ responsibleProfileId: state.user.id, dateFrom: localIso(monthStart), dateTo: localIso(monthEnd) })]);
      return { hearings, deadlines, tasks };
    }, force);
    if (state.route !== routeAtStart) return;
    shell(`${pageHead("Takvim", "Bir gün seçerek kayıtları görüntüleyin.")}${calendarMarkup(data)}${calendarDayList(data)}`);
  } catch (error) {
    if (state.route !== routeAtStart) return;
    console.error("[BKT mobile] Takvim yüklenemedi.", { message: error?.message || String(error) });
    shell(`${pageHead("Takvim")}${emptyState("Takvim yüklenemedi", "Bağlantınızı kontrol edip yeniden deneyin.")}`);
  }
}

function calendarMarkup(data) {
  const year = state.calendarDate.getFullYear();
  const month = state.calendarDate.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - startOffset);
  const eventDates = new Set([...data.hearings.map(x => x.hearing_date), ...data.deadlines.map(x => x.due_date), ...data.tasks.map(x => x.due_date)]);
  const days = Array.from({ length: 42 }, (_, index) => { const date = new Date(gridStart); date.setDate(date.getDate() + index); return date; });
  return `<section class="calendar-card"><div class="calendar-head"><button data-calendar-move="-1" aria-label="Önceki ay">‹</button><strong>${new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(first)}</strong><button data-calendar-move="1" aria-label="Sonraki ay">›</button></div><div class="calendar-week">${["Pzt","Sal","Çar","Per","Cum","Cmt","Paz"].map(day => `<span>${day}</span>`).join("")}</div><div class="calendar-grid">${days.map(date => { const iso = localIso(date); return `<button class="calendar-day ${date.getMonth() !== month ? "other" : ""} ${eventDates.has(iso) ? "has-event" : ""} ${iso === state.selectedDate ? "selected" : ""}" data-calendar-day="${iso}">${date.getDate()}</button>`; }).join("")}</div></section>`;
}

function calendarDayList(data) {
  const hearings = data.hearings.filter(row => row.hearing_date === state.selectedDate);
  const deadlines = data.deadlines.filter(row => row.due_date === state.selectedDate);
  const tasks = data.tasks.filter(row => row.due_date === state.selectedDate);
  const rows = [...hearings.map(row => ({ type: "hearing", row })), ...deadlines.map(row => ({ type: "deadline", row })), ...tasks.map(row => ({ type: "task", row }))];
  return `<section class="mobile-section"><div class="section-heading"><h2>${formatDate(state.selectedDate, { weekday: "long", day: "numeric", month: "long" })}</h2></div>${rows.length ? `<div class="mobile-list">${rows.map(item => item.type === "hearing" ? hearingCard(item.row) : item.type === "deadline" ? deadlineCard(item.row) : taskCard(item.row)).join("")}</div>` : emptyState("Bu güne ait kayıt yok", "Başka bir gün seçebilirsiniz.")}</section>`;
}

async function renderClients(force = false) {
  const routeAtStart = state.route;
  shell(`${pageHead("Müvekkiller", "Yalnızca büromuzca temsil edilen kişi ve kurumlar.")}${clientControls()}${skeleton(4)}`);
  try {
    const [clients, parties] = await Promise.all([loadCached("clients", () => repository.getRepresentedClients(), force), loadCached("represented-parties", () => repository.getFileParties({ representedByOffice: true }), force)]);
    if (state.route !== routeAtStart) return;
    const counts = new Map();
    parties.forEach(party => {
      if (!counts.has(party.client_id)) counts.set(party.client_id, new Set());
      if (party.file_id) counts.get(party.client_id).add(party.file_id);
    });
    state.cache.set("client-file-counts", counts);
    renderClientResults(clients);
  } catch (error) {
    if (state.route !== routeAtStart) return;
    console.error("[BKT mobile] Müvekkiller yüklenemedi.", { message: error?.message || String(error) });
    shell(`${pageHead("Müvekkiller")}${emptyState("Müvekkiller yüklenemedi", "Bağlantınızı kontrol edip yeniden deneyin.")}`);
  }
}

function clientControls() {
  return `<div class="mobile-search">${icon("search")}<input id="mobileClientSearch" type="search" placeholder="Müvekkil ara" value="${escapeHtml(state.clientSearch)}" /></div><div class="chip-row"><button class="filter-chip ${state.clientFilter === "all" ? "active" : ""}" data-client-filter="all">Tümü</button><button class="filter-chip ${state.clientFilter === "person" ? "active" : ""}" data-client-filter="person">Gerçek Kişi</button><button class="filter-chip ${state.clientFilter === "legal" ? "active" : ""}" data-client-filter="legal">Tüzel Kişi</button></div>`;
}

function isLegalClient(client) {
  return ["legal", "company", "tüzel kişi", "tuzel kisi"].includes(String(client.client_type || "").toLocaleLowerCase("tr-TR"));
}

function renderClientResults(clients) {
  const query = state.clientSearch.trim().toLocaleLowerCase("tr-TR");
  const counts = state.cache.get("client-file-counts") || new Map();
  const filtered = clients.filter(client => {
    const legal = isLegalClient(client);
    if (state.clientFilter === "person" && legal) return false;
    if (state.clientFilter === "legal" && !legal) return false;
    return !query || [client.name, client.email, client.phone, client.national_id, client.tax_id].some(value => String(value || "").toLocaleLowerCase("tr-TR").includes(query));
  });
  shell(`${pageHead("Müvekkiller", `${filtered.length} müvekkil görüntüleniyor.`)}${clientControls()}${filtered.length ? `<div class="mobile-list">${filtered.map(client => clientCard(client, counts.get(client.id)?.size || 0)).join("")}</div>` : emptyState("Müvekkil bulunmuyor", "Arama veya filtre seçiminizi değiştirin.")}`);
}

function clientCard(client, fileCount) {
  const legal = isLegalClient(client);
  const identity = legal ? client.tax_id : client.national_id;
  const initials = String(client.name || "M").split(/\s+/).slice(0, 2).map(part => part[0]).join("").toLocaleUpperCase("tr-TR");
  return `<button type="button" class="mobile-list-card mobile-record-card client-list-card" data-client-id="${escapeHtml(client.id || "")}"><span class="profile-avatar">${escapeHtml(initials)}</span><span class="list-content"><span class="list-title">${escapeHtml(client.name || "Müvekkil")}</span><span class="list-meta"><span>${legal ? "Tüzel Kişi" : "Gerçek Kişi"}</span><span>${legal ? "VKN" : "TCKN"}: ${escapeHtml(maskIdentity(identity))}</span></span><span class="list-note">Telefon: ${escapeHtml(client.phone || "Belirtilmedi")}</span><span class="list-note">E-posta: ${escapeHtml(client.email || "Belirtilmedi")}</span></span><span class="mobile-badge">${fileCount} dosya</span></button>`;
}

async function renderClientDetail(force = false) {
  const routeAtStart = state.route;
  shell(skeleton(3));
  try {
    const key = `client-detail:${state.clientDetailId}`;
    const data = await loadCached(key, async () => {
      const [clients, parties, files] = await Promise.all([
        repository.getClients(),
        repository.getFileParties({ clientId: state.clientDetailId, representedByOffice: true }),
        repository.getFiles()
      ]);
      const client = clients.find(item => item.id === state.clientDetailId) || null;
      const filesById = new Map((files || []).map(file => [file.id, file]));
      const representedFiles = [];
      const seenFileIds = new Set();
      (parties || []).forEach(party => {
        if (!party.file_id || seenFileIds.has(party.file_id)) return;
        const file = filesById.get(party.file_id);
        if (!file) return;
        seenFileIds.add(party.file_id);
        representedFiles.push({ file, party });
      });
      return { client, representedFiles };
    }, force);
    if (state.route !== routeAtStart) return;
    if (!data.client) throw new Error("Müvekkil bulunamadı.");
    const client = data.client;
    const legal = isLegalClient(client);
    const identity = legal ? client.tax_id : (client.national_id || client.tax_id);
    const closedCount = data.representedFiles.filter(({ file }) => ["kapalı", "kapali", "sonuçlandı", "sonuclandi", "closed"].includes(String(file.status || "").trim().toLocaleLowerCase("tr-TR"))).length;
    const fileRows = data.representedFiles.length
      ? `<div class="mobile-list client-file-list">${data.representedFiles.map(({ file, party }) => `<button type="button" class="mobile-list-card" data-file-id="${escapeHtml(file.id || "")}"><span class="list-icon">${icon(fileTypeClass(file) === "enforcement" ? "files" : "briefcase")}</span><span class="list-content"><span class="list-title">${escapeHtml(file.court_or_office || "Mahkeme / icra dairesi belirtilmedi")} · ${escapeHtml(file.file_no || "Dosya no yok")}</span><span class="list-meta"><span>${escapeHtml(file.display_id || file.legacy_id || "ID belirtilmedi")}</span><span>${escapeHtml(party.role_label || party.role || party.party_type || "Taraf rolü belirtilmedi")}</span><span>${escapeHtml(file.status || "Durum belirtilmedi")}</span></span></span><span class="chevron" aria-hidden="true">›</span></button>`).join("")}</div>`
      : emptyState("Bağlı dosya bulunmuyor", "Bu müvekkile bağlı aktif dosya kaydı yok.");
    shell(`<section class="record-detail-hero client-detail-hero"><span class="profile-avatar">${escapeHtml(String(client.name || "M").split(/\s+/).slice(0, 2).map(part => part[0]).join("").toLocaleUpperCase("tr-TR"))}</span><div><small>${legal ? "Tüzel Kişi" : "Gerçek Kişi"}</small><h2>${escapeHtml(client.name || "Müvekkil")}</h2></div><span class="mobile-badge">${data.representedFiles.length} dosya</span></section>${infoCard([[legal ? "VKN" : "TCKN", maskIdentity(identity)],["Telefon", client.phone || "Belirtilmedi"],["E-posta", client.email || "Belirtilmedi"],["Adres", client.address || "Belirtilmedi"],["Aktif Dosyalar", String(Math.max(0, data.representedFiles.length - closedCount))],["Kapanan Dosyalar", String(closedCount)]])}<section class="mobile-section"><div class="section-heading"><h2>Bağlı Dosyalar</h2></div>${fileRows}</section>`);
  } catch (error) {
    if (state.route !== routeAtStart) return;
    console.error("[BKT mobile] Müvekkil kartı yüklenemedi.", { message: error?.message || String(error) });
    shell(emptyState("Müvekkil kartı yüklenemedi", "Kayıt silinmiş veya bağlantı kesilmiş olabilir."));
  }
}

function renderMore() {
  shell(`${pageHead("Diğer", "Ofisinizin diğer mobil görünümleri.")}<div class="settings-list more-menu">${moreRow("tasks", "tasks", "Görevler", "Size atanmış görevler")}${moreRow("clients", "people", "Müvekkiller", "Kişi ve kurum kartları")}${moreRow("payments", "money", "Ödeme Takibi", "Finansal planları görüntüle")}${moreRow("expenses", "briefcase", "Ofis Giderleri", "Ofis harcamalarını görüntüle")}${moreRow("notifications", "bell", "Bildirimler", "Kişisel bildirim merkezi")}<button class="settings-row" data-action="refresh"><span class="list-icon">${icon("refresh")}</span><span style="flex:1"><strong>Veri ve Senkronizasyon</strong><span>Güncel kayıtları yeniden yükle</span></span>${icon("arrow")}</button><button class="settings-row danger" data-action="logout"><span class="list-icon">${icon("logout")}</span><span style="flex:1"><strong>Çıkış Yap</strong><span>Güvenli biçimde oturumu kapat</span></span></button></div>`);
}

function moreRow(route, iconName, title, copy) { return `<button class="settings-row" data-route="${route}"><span class="list-icon">${icon(iconName)}</span><span style="flex:1"><strong>${title}</strong><span>${copy}</span></span>${icon("arrow")}</button>`; }

async function renderSimpleList(route, force = false) {
  const routeAtStart = state.route;
  const configs = {
    hearings: ["Duruşmalar", "Tüm aktif duruşmalar", () => repository.getHearings({}), hearingCard],
    deadlines: ["Süreli İşler", "Aktif ve tamamlanan süreli işler", () => repository.getDeadlines({}), deadlineCard],
    payments: ["Ödeme Takibi", "Aktif ödeme planları", () => repository.getPaymentPlans({}), paymentPlanCard],
    expenses: ["Ofis Giderleri", "Ofis harcamalarının mobil görünümü", () => repository.getOfficeExpenseDashboardData({}), expenseCard],
    notifications: ["Bildirimler", "Kritik duruşma, süre, görev ve finans uyarıları", () => repository.getNotificationCenterData(), notificationCard]
  };
  const [title, copy, loader, renderer] = configs[route];
  shell(`${pageHead(title, copy, true)}${skeleton(4)}`);
  try {
    const raw = await loadCached(route, loader, force);
    if (state.route !== routeAtStart) return;
    let rows = Array.isArray(raw) ? raw : raw?.notifications || [];
    let summary = "";
    let renderRow = renderer;
    if (route === "payments") {
      const plans = Array.isArray(raw) ? raw : [];
      rows = plans;
      const totals = plans.reduce((result, plan) => {
        const planTotals = paymentPlanTotalsMobile(plan);
        result.agreement += planTotals.agreement;
        result.collected += planTotals.collected;
        result.remaining += planTotals.remaining;
        return result;
      }, { agreement: 0, collected: 0, remaining: 0 });
      summary = financeSummary([["Toplam alacak", totals.agreement, ""], ["Tahsil edilen", totals.collected, "success"], ["Kalan", totals.remaining, totals.remaining ? "danger" : "success"]]);
    }
    if (route === "expenses") {
      rows = raw?.expenses || [];
      const categoryMap = new Map((raw?.categories || []).map(category => [category.id, category.name]));
      renderRow = row => expenseCard(row, categoryMap);
      const monthPrefix = localIso(new Date()).slice(0, 7);
      const monthlyRows = rows.filter(row => String(row.expense_date || row.due_date || "").startsWith(monthPrefix));
      const monthlyTotal = monthlyRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const pending = monthlyRows.filter(row => !isCompleted(row.status)).reduce((sum, row) => sum + Number(row.amount || 0), 0);
      summary = financeSummary([["Bu ay toplam", monthlyTotal, ""], ["Bekleyen", pending, pending ? "danger" : "success"]]);
    }
    shell(`${pageHead(title, copy, true)}${summary}${rows.length ? `<div class="mobile-list">${rows.map(renderRow).join("")}</div>` : emptyState(`${title} bulunmuyor`, "Gösterilecek aktif kayıt yok.")}`);
  } catch (error) {
    if (state.route !== routeAtStart) return;
    console.error(`[BKT mobile] ${title} yüklenemedi.`, { message: error?.message || String(error) });
    shell(`${pageHead(title, "", true)}${emptyState(`${title} yüklenemedi`, "Bağlantınızı kontrol edip yeniden deneyin.")}`);
  }
}

function financeSummary(items) {
  return `<section class="finance-summary">${items.map(([label, value, tone]) => `<article class="finance-summary-item ${tone}"><span>${escapeHtml(label)}</span><strong>${formatCurrency(value)}</strong></article>`).join("")}</section>`;
}

function notificationCard(row) { return `<article class="mobile-list-card"><span class="list-icon">${icon("bell")}</span><div class="list-content"><span class="list-title">${escapeHtml(row.title || "Bildirim")}</span><div class="list-note">${escapeHtml(row.message || row.description || "")}</div></div>${row.read ? '<span class="mobile-badge">Okundu</span>' : '<span class="mobile-badge danger">Yeni</span>'}</article>`; }

function renderProfile() {
  shell(`${pageHead("Profilim", "", true)}<section class="profile-overview profile-overview-compact"><div><strong>${escapeHtml(state.user.displayName || "Kullanıcı")}</strong><span>${escapeHtml(state.user.roleName || "Rol belirtilmedi")}</span></div></section>${infoCard([["Ad Soyad", state.user.displayName || "Belirtilmedi"], ["E-posta", state.user.email || "Belirtilmedi"], ["Rol", state.user.roleName || "Belirtilmedi"], ["Hesap Durumu", state.user.active === false ? "Pasif" : "Aktif"]])}<button class="settings-row danger profile-logout-link settings-icon-row" data-action="logout"><span class="list-icon">${icon("logout")}</span><span style="flex:1"><strong>Çıkış Yap</strong><span>Güvenli biçimde oturumu kapat</span></span></button>`);
}

async function renderRoute(force = false) {
  window.scrollTo({ top: 0, behavior: "instant" });
  if (state.route === "home") return renderHome(force);
  if (state.route === "files") return renderFiles(force);
  if (state.route === "file-detail") return renderFileDetail(force);
  if (state.route === "deadline-detail") return renderDeadlineDetail(force);
  if (state.route === "task-detail") return renderTaskDetail(force);
  if (state.route === "client-detail") return renderClientDetail(force);
  if (state.route === "hearings") return renderHearings(force);
  if (state.route === "deadlines") return renderDeadlines(force);
  if (state.route === "tasks") return renderTasks(force);
  if (state.route === "calendar") return renderCalendar(force);
  if (state.route === "clients") return renderClients(force);
  if (state.route === "more") return renderMore();
  if (state.route === "profile") return renderProfile();
  return renderSimpleList(state.route, force);
}

function renderLogin(message = "") {
  app.innerHTML = `<main class="mobile-login">
    <section class="mobile-login-hero" aria-label="BKT Hukuk ve Danışmanlık Bürosu">
      <div class="mobile-login-hero-inner">
        <div class="mobile-brand">
          <span class="mobile-brand-mark"><img src="/outputs/bkt-logo.png" alt="BKT Hukuk logosu"/></span>
          <span class="mobile-brand-copy">
            <strong>BKT</strong>
            <span>Hukuk ve Danışmanlık Bürosu</span>
            <small>Ofis Yönetim Sistemi</small>
          </span>
        </div>
      </div>
    </section>
    <section class="mobile-login-sheet" aria-label="Oturum açma formu">
      <div class="mobile-login-form-head">
        <h2>Hesabınıza giriş yapın</h2>
      </div>
      <form id="mobileLoginForm">
        <div class="mobile-field">
          <label for="mobileEmail">E-posta Adresi</label>
          <span class="mobile-input-shell">${icon("mail")}<input id="mobileEmail" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="ornek@bkt.com" required /></span>
        </div>
        <div class="mobile-field">
          <label for="mobilePassword">Şifre</label>
          <span class="mobile-input-shell mobile-password-shell">${icon("lock")}<input id="mobilePassword" name="password" type="password" autocomplete="current-password" placeholder="Şifrenizi girin" required /><button class="mobile-password-toggle" type="button" data-action="toggle-login-password" aria-label="Şifreyi göster" title="Şifreyi göster">${icon("eye")}</button></span>
        </div>
        <label class="mobile-remember"><input id="mobileRememberLogin" name="remember" type="checkbox" checked /><span>Beni Hatırla</span></label>
        <button id="mobileLoginButton" class="mobile-primary" type="submit"><span>Giriş Yap</span>${icon("arrow")}</button>
        <p id="mobileLoginError" class="mobile-login-error" role="alert">${escapeHtml(message)}</p>
      </form>
      <div class="mobile-login-foot">${icon("shield")}<span>Güvenli oturum · BKT Hukuk</span></div>
    </section>
  </main>`;
}

async function restoreSession() {
  renderLogin();
  try {
    state.user = await repository.restoreAuthUser();
    if (state.user) await renderRoute();
  } catch (error) {
    console.error("[BKT mobile] Oturum geri yüklenemedi.", { message: error?.message || String(error) });
    renderLogin(error.message || "Oturum açılamadı.");
  }
}

app.addEventListener("submit", async event => {
  if (event.target.id !== "mobileLoginForm") return;
  event.preventDefault();
  const button = event.target.querySelector("button[type=submit]");
  const errorNode = event.target.querySelector("#mobileLoginError");
  button.disabled = true;
  button.classList.add("is-loading");
  button.innerHTML = `<span class="mobile-login-spinner" aria-hidden="true"></span><span>Giriş yapılıyor...</span>`;
  errorNode.textContent = "";
  try {
    const form = new FormData(event.target);
    repository.setRememberSession?.(form.get("remember") === "on");
    await repository.signIn(form.get("email"), form.get("password"));
    state.user = await repository.getCurrentUser();
    if (!state.user) throw new Error("Bu kullanıcı için uygulama profili bulunamadı.");
    state.cache.clear();
    state.route = "home";
    await renderRoute(true);
  } catch (error) {
    console.error("[BKT mobile] Giriş başarısız.", { message: error?.message || String(error) });
    errorNode.textContent = error.message || "Giriş sırasında bir hata oluştu.";
    button.disabled = false;
    button.classList.remove("is-loading");
    button.innerHTML = `<span>Giriş Yap</span>${icon("arrow")}`;
  }
});

app.addEventListener("input", event => {
  if (event.target.id === "mobileFileSearch") {
    state.fileSearch = event.target.value;
    state.filePage = 1;
    renderFileResults(state.cache.get("files") || []);
    document.querySelector("#mobileFileSearch")?.focus();
  }
  if (event.target.id === "mobileClientSearch") {
    state.clientSearch = event.target.value;
    renderClientResults(state.cache.get("clients") || []);
    document.querySelector("#mobileClientSearch")?.focus();
  }
});

app.addEventListener("click", async event => {
  const routeTarget = event.target.closest("[data-route]");
  const fileTarget = event.target.closest("[data-file-id]");
  const deadlineTarget = event.target.closest("[data-deadline-id]");
  const taskTarget = event.target.closest("[data-task-id]");
  const clientTarget = event.target.closest("[data-client-id]");
  const actionTarget = event.target.closest("[data-action]");
  const detailTab = event.target.closest("[data-detail-tab]");
  const fileFilter = event.target.closest("[data-file-filter]");
  const filePage = event.target.closest("[data-file-page]");
  const clientFilter = event.target.closest("[data-client-filter]");
  const taskFilter = event.target.closest("[data-task-filter]");
  const deadlineFilter = event.target.closest("[data-deadline-filter]");
  const hearingView = event.target.closest("[data-hearing-view]");
  const hearingMove = event.target.closest("[data-hearing-move]");
  const taskComplete = event.target.closest("[data-complete-task]");
  const calendarMove = event.target.closest("[data-calendar-move]");
  const calendarDay = event.target.closest("[data-calendar-day]");

  if (routeTarget) {
    const targetRoute = routeTarget.dataset.route;
    if (targetRoute === "more") {
      if (state.route === "more") {
        state.route = state.menuReturnRoute || "home";
      } else {
        state.menuReturnRoute = state.route === "file-detail" ? "files" : state.route;
        state.previousRoute = state.menuReturnRoute;
        state.route = "more";
      }
    } else {
      state.previousRoute = state.route === "file-detail" ? "files" : state.route;
      state.route = targetRoute;
    }
    return renderRoute();
  }
  if (fileTarget) {
    state.previousRoute = state.route || "files";
    state.route = "file-detail";
    state.detailId = fileTarget.dataset.fileId;
    state.detailTab = "general";
    return renderRoute();
  }
  if (deadlineTarget) {
    state.previousRoute = state.route || "deadlines";
    state.route = "deadline-detail";
    state.deadlineDetailId = deadlineTarget.dataset.deadlineId;
    return renderRoute();
  }
  if (taskTarget) {
    state.previousRoute = state.route || "tasks";
    state.route = "task-detail";
    state.taskDetailId = taskTarget.dataset.taskId;
    return renderRoute();
  }
  if (clientTarget) {
    state.previousRoute = state.route || "clients";
    state.route = "client-detail";
    state.clientDetailId = clientTarget.dataset.clientId;
    return renderRoute();
  }
  if (detailTab) {
    state.detailTab = detailTab.dataset.detailTab;
    return renderRoute();
  }
  if (fileFilter) {
    state.fileFilter = fileFilter.dataset.fileFilter;
    state.filePage = 1;
    return renderFileResults(state.cache.get("files") || []);
  }
  if (filePage) {
    state.filePage = Number(filePage.dataset.filePage) || 1;
    return renderFileResults(state.cache.get("files") || []);
  }
  if (clientFilter) {
    state.clientFilter = clientFilter.dataset.clientFilter;
    return renderClientResults(state.cache.get("clients") || []);
  }
  if (taskFilter) {
    state.taskFilter = taskFilter.dataset.taskFilter;
    return renderTasks();
  }
  if (deadlineFilter) {
    state.deadlineFilter = deadlineFilter.dataset.deadlineFilter;
    return renderDeadlines();
  }
  if (hearingView) {
    state.hearingView = hearingView.dataset.hearingView;
    return renderHearings();
  }
  if (hearingMove) {
    const direction = Number(hearingMove.dataset.hearingMove);
    const anchor = direction === 0 ? localDate(new Date()) : localDate(state.hearingAnchor);
    if (direction !== 0) {
      if (state.hearingView === "month") anchor.setMonth(anchor.getMonth() + direction);
      else anchor.setDate(anchor.getDate() + direction * (state.hearingView === "week" ? 7 : 1));
    }
    state.hearingAnchor = anchor;
    return renderHearings();
  }
  if (calendarMove) {
    state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + Number(calendarMove.dataset.calendarMove), 1);
    state.selectedDate = localIso(state.calendarDate);
    return renderCalendar();
  }
  if (calendarDay) {
    state.selectedDate = calendarDay.dataset.calendarDay;
    return renderCalendar();
  }
  if (taskComplete) {
    try {
      const taskId = taskComplete.dataset.completeTask;
      const detailOpen = state.route === "task-detail";
      await repository.completeTask(taskId);
      state.cache.delete("tasks");
      state.cache.delete("dashboard");
      state.cache.delete(`task-detail:${taskId}`);
      showToast("Görev tamamlandı.");
      return detailOpen ? renderTaskDetail(true) : renderTasks(true);
    } catch (error) {
      console.error("[BKT mobile] Görev tamamlanamadı.", { message: error?.message || String(error) });
      return showToast("Görev tamamlanamadı.");
    }
  }
  if (!actionTarget) return;
  if (actionTarget.dataset.action === "toggle-login-password") {
    const input = document.querySelector("#mobilePassword");
    if (!input) return;
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    actionTarget.innerHTML = icon(visible ? "eye" : "eyeOff");
    actionTarget.setAttribute("aria-label", visible ? "Şifreyi göster" : "Şifreyi gizle");
    actionTarget.title = visible ? "Şifreyi göster" : "Şifreyi gizle";
    input.focus();
    return;
  }
  if (actionTarget.dataset.action === "back") {
    const currentRoute = state.route;
    state.route = state.previousRoute || "more";
    if (currentRoute === "file-detail" && state.route === "client-detail") state.previousRoute = "clients";
    return renderRoute();
  }
  if (actionTarget.dataset.action === "refresh") {
    state.cache.clear();
    showToast("Veriler yenileniyor...");
    return renderRoute(true);
  }
  if (actionTarget.dataset.action === "logout") {
    await repository.signOut();
    state.user = null;
    state.cache.clear();
    return renderLogin();
  }
});

window.addEventListener("afterprint", () => {
  if ("mobileRestoreTitle" in document.body.dataset) {
    document.title = document.body.dataset.mobileRestoreTitle;
    delete document.body.dataset.mobileRestoreTitle;
  }
  document.body.classList.remove("mobile-printing-hearings");
});

async function bootstrapMobile() {
  await import("../../services/browserRepositoryBridge.js");
  repository = window.BKTHukukRepository?.createBrowserRepository();
  if (!repository) throw new Error("Mobil veri katmanı başlatılamadı.");
  await restoreSession();
}

bootstrapMobile().catch(error => {
  console.error("[BKT mobile] Uygulama başlatılamadı.", { message: error?.message || String(error) });
  renderLogin("Uygulama başlatılamadı. Bağlantı ayarlarını kontrol edin.");
});
