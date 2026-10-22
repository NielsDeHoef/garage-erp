export const euro = new Intl.NumberFormat("nl-BE", {
  style: "currency",
  currency: "EUR",
});

export const dateFmt = new Intl.DateTimeFormat("nl-BE", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export const dateTimeFmt = new Intl.DateTimeFormat("nl-BE", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const timeFmt = new Intl.DateTimeFormat("nl-BE", {
  hour: "2-digit",
  minute: "2-digit",
});

export function normalizePlate(plate) {
  return String(plate ?? "")
    .toUpperCase()
    .replace(/[\s.\-]/g, "");
}

export function h(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function customerPhones(row) {
  return [row?.phone, row?.phone2, row?.phone3]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

export function uid() {
  return crypto.randomUUID();
}

export function todayIso(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isoDate(ms) {
  return todayIso(new Date(ms));
}

export function invoiceStatusLabel(id) {
  return { concept: "Concept", verzonden: "Verzonden", betaald: "Betaald" }[id] ?? id;
}

export const QUOTE_STATUSES = [
  { id: "concept", label: "Concept" },
  { id: "verzonden", label: "Verzonden" },
  { id: "aanvaard", label: "Aanvaard" },
  { id: "geweigerd", label: "Geweigerd" },
];

export function quoteStatusLabel(id) {
  return QUOTE_STATUSES.find((s) => s.id === id)?.label ?? id;
}

export function toDatetimeLocal(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function startOfDay(ms = Date.now()) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function mondayOf(ms = Date.now()) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function addDays(ms, days) {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function parseIsoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!m) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

export function endOfDay(ms = Date.now()) {
  const d = new Date(ms);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function startOfMonth(ms = Date.now()) {
  const d = new Date(ms);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const WORK_STATUSES = [
  { id: "gepland", label: "Gepland" },
  { id: "in_uitvoering", label: "In uitvoering" },
  { id: "wacht_op_goedkeuring_offerte", label: "Wacht op goedkeuring offerte" },
  { id: "wacht_op_onderdeel", label: "Wacht op onderdeel" },
  { id: "klaar", label: "Klaar" },
  { id: "gefactureerd", label: "Gefactureerd" },
];

export function statusLabel(id) {
  return WORK_STATUSES.find((s) => s.id === id)?.label ?? id;
}

export const FUELS = ["benzine", "diesel", "hybride", "elektrisch", "lpg"];
export const EQUIPMENT_TYPES = [
  { id: "brug", label: "Hefbrug" },
  { id: "balanceermachine", label: "Balanceermachine" },
  { id: "bandenmachine", label: "Bandenmachine" },
  { id: "diagnose", label: "Diagnose-apparatuur" },
  { id: "compressor", label: "Compressor" },
  { id: "andere", label: "Andere" },
];

export function equipmentLabel(id) {
  return EQUIPMENT_TYPES.find((s) => s.id === id)?.label ?? id;
}
