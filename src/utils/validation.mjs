export const normalizeEmail = value => String(value ?? "").trim().toLowerCase();

export const isValidEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));

export const isStrongPassword = value => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s])\S{8,}$/.test(String(value ?? ""));

export const isValidOtp = value => /^\d{6}$/.test(String(value ?? ""));

export function normalizeKenyanMpesaPhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  const normalized = digits.startsWith("0") ? `254${digits.slice(1)}` : digits.startsWith("7") || digits.startsWith("1") ? `254${digits}` : digits;
  return /^254(?:7|1)\d{8}$/.test(normalized) ? normalized : null;
}

export function upsertById(items, item) {
  if (!item?.id) return items;
  const index = items.findIndex(existing => existing.id === item.id);
  if (index < 0) return [item, ...items];
  const next = [...items];
  next[index] = { ...next[index], ...item };
  return next;
}

export function dedupeById(items) {
  const seen = new Set();
  return items.filter(item => item?.id && !seen.has(item.id) && seen.add(item.id));
}
