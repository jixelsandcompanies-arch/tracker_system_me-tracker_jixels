export function normalizeKenyanAgentPhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  return null;
}
