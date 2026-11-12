// Serializable execution snapshots outlive the selected editor document.
import { shared, setShared, hc } from "herdr";
import { editorKey } from "./common.js";
import { toggleTool } from "./tool-windows.js";
import { inspectRunProcess, stopRunProcess, retireRunProcess } from "./run-process.js";

const KEY = "codenav.executionResults";
export const EXECUTION_HISTORY_LIMIT = 20;
const HISTORY_BYTES = 32 * 1024 * 1024;
// Runtime-only ownership intentionally resets when the mod VM reloads.
const polling = new Set();
const pollKey = (id, scope) => JSON.stringify([scope, id]);
export function claimExecution(id, scope = editorKey()) { const key = pollKey(id, scope); if (polling.has(key)) return false; polling.add(key); return true; }
export function releaseExecution(id, scope = editorKey()) { polling.delete(pollKey(id, scope)); }
function snapshot(value) { const text = JSON.stringify(value); return { ...JSON.parse(text), historyBytes: text.length * 2 }; }
export const executionBusy = entry => ["queued", "running"].includes(entry?.state);
export const executionStore = (scope = editorKey()) => (shared(KEY) || {})[scope] || { entries: [], selected: null, sequence: 0 };
function save(scope, state) {
  let completed = 0, bytes = 0;
  // Evict whole older completed executions, never partially truncate rows.
  const entries = [...state.entries].reverse().filter(entry => {
    const protectedEntry = entry.id === state.selected || executionBusy(entry);
    if (protectedEntry) return true;
    const size = entry.historyBytes || 0;
    if (++completed > EXECUTION_HISTORY_LIMIT || bytes + size > HISTORY_BYTES) return false;
    bytes += size; return true;
  }).reverse();
  setShared(KEY, { ...(shared(KEY) || {}), [scope]: { ...state, entries } });
  for (const entry of state.entries) if (!entries.some(item => item.id === entry.id) && entry.processOwned) retireRunProcess(entry).catch(() => {});
}
export function beginExecution(value, scope = editorKey(), { claim = false } = {}) {
  const state = executionStore(scope), sequence = state.sequence + 1;
  const entry = snapshot({ ...value, id: `run-result:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`, sequence, startedAt: Date.now(), state: "queued", output: "" });
  if (claim) claimExecution(entry.id, scope);
  save(scope, { entries: [...state.entries, entry], selected: entry.id, sequence });
  toggleTool("run-results", true);
  return entry.id;
}
export function updateExecution(id, patch, scope = editorKey()) {
  const state = executionStore(scope);
  if (!state.entries.some(entry => entry.id === id)) return;
  save(scope, { ...state, entries: state.entries.map(entry => entry.id === id ? snapshot({ ...entry, ...patch }) : entry) });
}
export function selectExecution(id, scope = editorKey()) {
  const state = executionStore(scope);
  if (state.entries.some(entry => entry.id === id)) save(scope, { ...state, selected: id });
}
export function closeExecution(id, scope = editorKey()) {
  const state = executionStore(scope), at = state.entries.findIndex(entry => entry.id === id);
  if (at < 0 || executionBusy(state.entries[at])) return false;
  const entries = state.entries.filter(entry => entry.id !== id);
  save(scope, { ...state, entries, selected: state.selected === id ? entries[Math.min(at, entries.length - 1)]?.id || null : state.selected });
  if (state.entries[at].processOwned) retireRunProcess(state.entries[at]).catch(() => {});
  return true;
}
export async function interruptExecution(entry, scope = editorKey()) {
  updateExecution(entry.id, { stopRequested: true }, scope);
  try {
    if (entry.processOwned) {
      const status = await stopRunProcess({ ...entry, stopRequested: true });
      updateExecution(entry.id, { ...status, stopConfirmed: status.state === "cancelled", stopRequested: status.state === "queued" }, scope);
      return status;
    }
    const result = await hc(["interrupt", entry.terminal, "--json"]);
    if (result.code) throw new Error(result.stderr || "Could not interrupt the run terminal.");
    const { outcome } = JSON.parse(result.stdout || "{}");
    if (!["stopped", "exited"].includes(outcome)) throw new Error("The terminal has not confirmed stopping. Try Stop again.");
    updateExecution(entry.id, { stopConfirmed: true, ...(entry.state === "untracked" ? { state: "cancelled" } : {}) }, scope);
    markUntrackedSession(entry, false);
  } catch (error) { updateExecution(entry.id, { stopRequested: false }, scope); throw error; }
}
export function markUntrackedSession(entry, untracked = true) {
  const sessions = shared("codenav.runSessions") || {};
  let changed = false;
  const next = Object.fromEntries(Object.entries(sessions).map(([scope, configurations]) => [scope, Object.fromEntries(Object.entries(configurations).map(([id, session]) => {
    if (session.terminal !== entry.terminal || id !== entry.configuration) return [id, session];
    changed = true; return [id, { ...session, untracked }];
  }))]));
  if (changed) setShared("codenav.runSessions", next);
}
// Existing terminal reads only; no commands are sent while recovering status.
export async function inspectExecutionTerminal(entry) {
  if (entry.processOwned) return inspectRunProcess(entry, { captureOutput: false });
  const read = await hc(["read", entry.terminal, "--lines", "2000"]);
  if (read.code) throw new Error(read.stderr || "Could not read the run terminal.");
  const output = (read.stdout || "").trimEnd(), lines = output.split("\n").map(line => line.replace(/\r$/, ""));
  const footer = entry.marker && lines.find(line => line.startsWith(entry.marker + ":") && /^-?\d+$/.test(line.slice(entry.marker.length + 1)));
  if (entry.stopConfirmed || footer) {
    const exitCode = footer ? Number(footer.slice(entry.marker.length + 1)) : null;
    return { output, state: entry.stopConfirmed ? "cancelled" : exitCode ? "error" : "completed", exitCode,
      ...(exitCode && !entry.stopConfirmed ? { error: `Exit code ${exitCode}` } : {}) };
  }
  const result = await hc(["get", entry.terminal, "--json"]);
  if (result.code) throw new Error(result.stderr || "Could not inspect the run terminal.");
  const detail = JSON.parse(result.stdout || "{}");
  return { output, ...(detail.state === "finished" ? { state: detail.exit_code === 0 ? "completed" : "error", exitCode: detail.exit_code ?? null,
    ...(detail.exit_code !== 0 ? { error: detail.reason || `Exit code ${detail.exit_code ?? "unknown"}` } : {}) } : {}) };
}
