import { isValidIsoDate } from "./userInput.mjs";

export function formatFilenameDate(value) {
  if (!isValidIsoDate(value)) return "";
  const [year, month, day] = String(value).split("-");
  return `${day}.${month}.${year}`;
}

export function datedReportFilename(start, end, label, extension = "") {
  const range = [formatFilenameDate(start), formatFilenameDate(end)].filter(Boolean).join(" - ");
  const base = [range, String(label || "Rapor").trim()].filter(Boolean).join(" ");
  const suffix = String(extension || "").trim().replace(/^\.+/, "");
  return suffix ? `${base}.${suffix}` : base;
}
