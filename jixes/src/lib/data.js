import { createClient } from "@supabase/supabase-js";
import { getSession } from "./auth";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseKey);
export const supabase = hasSupabaseConfig ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const allowedTables = new Set(["customers", "bikes", "trackers", "tracker_heartbeats", "payments", "finance_accounts", "screening_applications", "support_cases", "support_case_history", "alerts", "audit_logs", "chat_messages", "reports", "service_status", "workspace_settings", "profiles"]);
export const DATA_BATCH_SIZE = 1000;
const asError = (error, fallback) => error instanceof Error ? error : new Error(error?.message || fallback);
function reportNetworkError(error) {
  if (typeof window !== "undefined" && /network|fetch|offline|load failed/i.test(error?.message || "")) window.dispatchEvent(new Event("jixels:data-offline"));
}

async function client() {
  if (!supabase) return null;
  const session = getSession();
  // The shared login endpoint returns the full Supabase session. Applying it
  // before every query prevents the PostgREST client from falling back to the
  // anonymous key after a page refresh.
  if (session?.accessToken && session?.refreshToken) {
    const { error } = await supabase.auth.setSession({ access_token: session.accessToken, refresh_token: session.refreshToken });
    if (error) throw error;
  }
  if (session?.accessToken) supabase.realtime.setAuth(session.accessToken);
  return supabase;
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

export async function createRecord(table, record) {
  if (!allowedTables.has(table)) return { data: null, error: new Error("Table is not allowed") };
  const db = await client();
  if (!db || !navigator.onLine) return { data: null, error: new Error("Connect to Supabase to create records") };
  const payload = table === "audit_logs" && !record.actor_id ? { ...record, actor_id: getSession()?.userId } : record;
  const { data, error } = await db.from(table).insert(payload).select();
  reportNetworkError(error);
  return { data: data?.[0] || null, error };
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

export async function invokeApi(path, body) {
  const session = getSession();
  if (!supabaseUrl || !supabaseKey || !session?.accessToken || !navigator.onLine) return { data: null, error: new Error("Connect to Supabase to complete this action") };
  try {
    const result = await fetch(`${supabaseUrl}/functions/v1/api${path}`, {
      method: "POST",
      headers: { apikey: supabaseKey, Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await result.json().catch(() => ({}));
    return result.ok ? { data, error: null } : { data: null, error: new Error(data.message || "The request could not be completed") };
  } catch (error) { return { data: null, error: asError(error, "Could not complete the request") }; }
}

export function subscribeToTable(table, callback) {
  if (!supabase || !allowedTables.has(table) || typeof WebSocket === "undefined") return () => {};
  try {
    const channel = supabase.channel(`${table}-changes`).on("postgres_changes", { event: "*", schema: "public", table }, callback).subscribe();
    return () => supabase.removeChannel(channel).catch(() => {});
  } catch (error) {
    // Realtime is an enhancement. Initial REST loads must keep the operations
    // workspace usable when a browser or network blocks WebSockets.
    console.warn("Realtime subscription unavailable", error);
    return () => {};
  }
}
export async function importRecords(table, records) {
  if (!records.length) return { data: [], error: null };
  if (!navigator.onLine || !hasSupabaseConfig) return { data: [], error: new Error("Connect to Supabase to import records") };
  const db = await client(); const { data, error } = await db.from(table).insert(records).select();
  reportNetworkError(error);
  return { data: data || [], error };
}
