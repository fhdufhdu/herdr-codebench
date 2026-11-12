// Dedicated core processes: never create/select application terminal tabs.
import { hc } from "herdr";

const LABEL = "codebench.execution";
const processName = id => `cb-run-${id.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-24)}`;
const checked = result => { if (result.code) throw new Error(result.stderr || result.stdout || "Run process request failed."); return result; };
const json = result => JSON.parse(checked(result).stdout || "{}");
export async function launchRunProcess(entry, command) {
  const args = ["run", "--bg", "--no-parent", "--no-notify", "--json", "--name", processName(entry.id), "--label", `${LABEL}=${entry.id}`];
  if (entry.folder) args.push("--cwd", entry.folder);
  if (entry.machine) args.push("--on", entry.machine);
  args.push("--", command);
  const result = json(await hc(args));
  if (!result.address) throw new Error("The run process did not return a terminal address.");
  return result.address;
}
export async function inspectRunProcess(entry, { captureOutput = true } = {}) {
  let terminal = entry.terminal;
  if (!terminal) {
    const listing = json(await hc(["ls", "--all", "--json", "--label", `${LABEL}=${entry.id}`]));
    // `hc ls` is intentionally compact and does not expose labels. Find our
    // unique name first, then verify the execution label with `hc get` below.
    const matches = (listing.terminals || []).filter(item => item.name === processName(entry.id));
    if (matches.length > 1) throw new Error("More than one process owns this execution ID.");
    terminal = matches[0]?.address;
    if (!terminal) {
      if (entry.launching && Date.now() - entry.startedAt < 10000) return { state: "queued", launching: true, output: entry.output || "", elapsed_ms: Date.now() - entry.startedAt };
      throw new Error("The execution process could not be recovered. The command was not run again.");
    }
  }
  const detail = json(await hc(["get", terminal, "--json"]));
  if (detail.labels?.[LABEL] !== entry.id) throw new Error("This terminal no longer belongs to this execution.");
  // The layout terminal block owns live TTY output. Avoid copying its running
  // screen into persisted JSON just to refresh status; retain a final fallback.
  const output = captureOutput || detail.state === "finished" ? checked(await hc(["read", terminal, "--lines", "2000"])).stdout || "" : entry.output || "";
  const elapsed_ms = (detail.finished_ms || Date.now()) - (detail.created_ms || entry.startedAt);
  if (detail.state !== "finished") return { terminal, launching: false, nativeState: detail.state, state: "running", output, elapsed_ms };
  const cancelled = Boolean(entry.stopRequested || entry.stopConfirmed);
  return { terminal, launching: false, nativeState: "finished", state: cancelled ? "cancelled" : detail.exit_code === 0 ? "completed" : "error", exitCode: detail.exit_code ?? null, output, elapsed_ms,
    error: !cancelled && detail.exit_code !== 0 ? detail.reason || `Exit code ${detail.exit_code ?? "unknown"}` : null };
}
export async function stopRunProcess(entry) {
  const current = await inspectRunProcess(entry);
  if (current.state !== "running") return current;
  checked(await hc(["interrupt", current.terminal, "--json", "--timeout", "1"]));
  let status = await inspectRunProcess({ ...entry, terminal: current.terminal, stopRequested: true });
  if (status.state === "running") {
    checked(await hc(["kill", current.terminal]));
    status = await inspectRunProcess({ ...entry, terminal: current.terminal, stopRequested: true });
  }
  if (status.state === "running") throw new Error("The run process has not confirmed stopping.");
  return status;
}
// Finished core terminals cannot be attached: the host emits Ended and removes
// their chrome block. Their final captured transcript belongs in the mod body.
export const runTerminalContent = entry => entry?.processOwned && entry.terminal && ["queued", "running"].includes(entry.state) && entry.nativeState !== "finished" ? { terminal: entry.terminal } : null;
export async function retireRunProcess(entry) {
  if (!entry.processOwned || !entry.terminal) return;
  const detail = json(await hc(["get", entry.terminal, "--json"]));
  if (detail.labels?.[LABEL] === entry.id && detail.state === "finished") checked(await hc(["rm", entry.terminal]));
}
