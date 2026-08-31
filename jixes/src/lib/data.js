import { createClient } from "@supabase/supabase-js";
import { getSession } from "./auth";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseKey);
export const supabase = hasSupabaseConfig ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const allowedTables = new Set(["customers", "bikes", "trackers", "tracker_heartbeats", "payments", "finance_accounts", "screening_applications", "support_cases", "support_case_history", "alerts", "audit_logs", "chat_messages", "reports", "service_status", "workspace_settings", "profiles"]);
const QUEUE_KEY = "jixels_pending_writes";
export const DATA_BATCH_SIZE = 1000;
const asError = (error, fallback) => error instanceof Error ? error : new Error(error?.message || fallback);
function reportNetworkError(error) {
  if (typeof window !== "undefined" && /network|fetch|offline|load failed/i.test(error?.message || "")) window.dispatchEvent(new Event("jixels:data-offline"));
}

async function client() {
  if (!supabase) return null;
  const session = getSession();
  if (session?.accessToken && session?.refreshToken) await supabase.auth.setSession({ access_token: session.accessToken, refresh_token: session.refreshToken });
  if (session?.accessToken) supabase.realtime.setAuth(session.accessToken);
  return supabase;
}
function queue(operation) { try { const queued = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); localStorage.setItem(QUEUE_KEY, JSON.stringify([...queued, operation].slice(-100))); } catch { /* cache is optional */ } }
export function pendingWriteCount() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]").length; } catch { return 0; } }
function canRetryLater(error) {
  return !navigator.onLine || /network|fetch|load failed|timeout|timed out/i.test(error?.message || "");
}

export async function listRecords(table, { page = 0, pageSize = 25, order = "created_at", ascending = false, filters = {}, from = "", to = "", dateColumn = "created_at" } = {}) {
  if (!allowedTables.has(table)) return { data: [], count: 0, error: new Error("Table is not allowed") };
  try {
    const db = await client();
    if (!db) return { data: [], count: 0, error: new Error("Supabase is not configured") };
    const safePage = Math.max(0, Number(page) || 0);
    const safePageSize = Math.min(DATA_BATCH_SIZE, Math.max(1, Number(pageSize) || 25));
    let query = db.from(table).select("*", { count: "exact" }).order(order, { ascending }).range(safePage * safePageSize, safePage * safePageSize + safePageSize - 1);
    Object.entries(filters).forEach(([key, value]) => { if (value !== "" && value != null) query = query.eq(key, value); });
    if (from) query = query.gte(dateColumn, `${from}T00:00:00.000Z`);
    if (to) query = query.lte(dateColumn, `${to}T23:59:59.999Z`);
    const { data, error, count } = await query;
    reportNetworkError(error);
    return { data: data || [], count: count || 0, error };
  } catch (error) {
    reportNetworkError(error);
    return { data: [], count: 0, error: asError(error, `Could not load ${table}`) };
  }
}

export async function createRecord(table, record, { queueWhenOffline = true } = {}) {
  if (!allowedTables.has(table)) return { data: null, error: new Error("Table is not allowed") };
  const db = await client();
  if (!db || !navigator.onLine) { if (queueWhenOffline) queue({ table, record, createdAt: new Date().toISOString() }); return { data: null, error: new Error("Saved for retry when online"), queued: true }; }
  const payload = table === "audit_logs" && !record.actor_id ? { ...record, actor_id: getSession()?.userId } : record;
  const { data, error } = await db.from(table).insert(payload).select();
  if (error && queueWhenOffline && canRetryLater(error)) queue({ table, record, createdAt: new Date().toISOString() });
  return { data: data?.[0] || null, error, queued: Boolean(error && queueWhenOffline && canRetryLater(error)) };
}

export async function updateRecord(table, id, changes) {
  if (!allowedTables.has(table) || !id) return { data: null, error: new Error("Invalid record") };
  try {
    const db = await client();
    if (!db || !navigator.onLine) return { data: null, error: new Error("Connect to Supabase to update records") };
    const { data, error } = await db.from(table).update(changes).eq("id", id).select();
    return { data: data?.[0] || null, error };
  } catch (error) { return { data: null, error: asError(error, "Could not update record") }; }
}

export async function deleteRecord(table, id) {
  if (!allowedTables.has(table) || !id) return { error: new Error("Invalid record") };
  try {
    const db = await client();
    if (!db || !navigator.onLine) return { error: new Error("Connect to Supabase to delete this record") };
    const { error } = await db.from(table).delete().eq("id", id);
    return { error };
  } catch (error) { return { error: asError(error, "Could not delete record") }; }
}

export async function invokeFunction(name, body) {
  const db = await client();
  if (!db || !navigator.onLine) return { data: null, error: new Error("Connect to Supabase to complete this action") };
  const { data, error } = await db.functions.invoke(name, { body });
  return { data, error };
}

export async function flushPendingWrites() {
  if (!navigator.onLine || !hasSupabaseConfig) return { flushed: 0, remaining: pendingWriteCount() };
  let queued; try { queued = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch { return { flushed: 0, remaining: 0 }; }
  const remaining = [];
  for (const item of queued) { const result = await createRecord(item.table, item.record, { queueWhenOffline: false }); if (result.error) remaining.push(item); }
  localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  return { flushed: queued.length - remaining.length, remaining: remaining.length };
}

export function subscribeToTable(table, callback) {
  if (!supabase || !allowedTables.has(table)) return () => {};
  const channel = supabase.channel(`${table}-changes`).on("postgres_changes", { event: "*", schema: "public", table }, callback).subscribe();
  return () => supabase.removeChannel(channel);
}
export async function importRecords(table, records) {
  if (!records.length) return { data: [], error: null };
  if (!navigator.onLine || !hasSupabaseConfig) { records.forEach((record) => queue({ table, record, createdAt: new Date().toISOString() })); return { data: [], error: new Error("Saved locally; will sync when online"), queued: true }; }
  const db = await client(); const { data, error } = await db.from(table).insert(records).select();
  if (error && canRetryLater(error)) records.forEach((record) => queue({ table, record, createdAt: new Date().toISOString() }));
  return { data: data || [], error, queued: Boolean(error && canRetryLater(error)) };
}
