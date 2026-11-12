// Native Go engine owns LSP processes and Spring navigation; the UI owns buffers.
import { hc, exec, appHome, home, readTextFile, window } from "herdr";
const PORT = 47822, ENGINE = "herdr-codebench-go", NAME = "codenav-engine";
const STATE = () => `${home()}/.cache/herdr-codenav/engine.json`;
const DIRECTORY = () => `${appHome()}/data/codebench-engine`;
let starting = null, state = null, prepared = null, verified = null;
async function readState() {
  try { state = JSON.parse(await readTextFile(STATE())); } catch { state = null; }
  return state;
}
async function post(method, body) {
  if (!state) await readState();
  if (!state?.token || state.port !== PORT || state.engine !== ENGINE) throw new Error("connect: no Go engine");
  const response = await fetch(`http://127.0.0.1:${PORT}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Codenav-Token": state.token }, body: JSON.stringify(body ?? {}),
  });
  if (response.status === 401 || response.status === 403) { state = null; verified = null; prepared = null; throw new Error("connect: engine identity changed"); }
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || "Engine request failed");
  return data.result;
}
async function prepare() {
  if (prepared) return prepared;
  const manifest = JSON.parse(await readTextFile(`${DIRECTORY()}/manifest.json`).catch(() => "null"));
  if (!manifest?.version) throw new Error("Go engine is not installed. Run python3 engine/install.py.");
  const platform = window()?.platform, os = platform === "macos" ? "darwin" : platform;
  const result = platform === "windows"
    ? await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", "[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()"])
    : await exec("uname", ["-m"]);
  if (result.code) throw new Error("Cannot determine engine architecture");
  const value = result.stdout.trim().toLowerCase(), arch = { arm64: "arm64", aarch64: "arm64", x86_64: "amd64", amd64: "amd64", x64: "amd64" }[value];
  if (!arch || !manifest.targets?.some(target => target.os === os && target.arch === arch)) throw new Error(`Unsupported engine platform: ${os}/${value}`);
  const binary = `${DIRECTORY()}/${os}-${arch}/herdr-engine${os === "windows" ? ".exe" : ""}`;
  const check = await exec(binary, ["--version"]);
  if (check.code || !check.stdout.includes(manifest.version)) throw new Error("Installed engine does not match its manifest. Run python3 engine/install.py.");
  prepared = { binary, version: manifest.version }; return prepared;
}
async function health() {
  try { await readState(); const value = await post("health"); return value?.pid === state?.pid && value?.engine === ENGINE ? value : null; }
  catch { return null; }
}
const samePath = (a, b) => typeof a === "string" && a.replace(/\\/g, "/") === b.replace(/\\/g, "/");
async function ownedHelpers(name, binary, pid) {
  const listing = JSON.parse((await hc(["ls", "--json"])).stdout || "{}");
  const matches = [];
  for (const item of listing.terminals ?? []) {
    if (item.name !== name) continue;
    const detail = JSON.parse((await hc(["get", item.address, "--json"])).stdout || "{}");
    const owns = name === NAME ? samePath(detail.argv?.[0], binary) && detail.pid === pid
      : detail.argv?.includes("-I") && detail.argv.some(argument => samePath(argument, `${appHome()}/mods/codenav/bridge/lsp_bridge.py`));
    if (detail.name === name && owns) matches.push(item.address);
  }
  return matches;
}
async function retirePython() {
  try { for (const address of await ownedHelpers("codenav-lsp")) await hc(["kill", address]); } catch { /* Go is already usable. */ }
}
function ensureEngine(sleep) {
  if (!starting) starting = (async () => {
    const config = await prepare(), existing = await health();
    if (existing?.version === config.version) { verified = existing.pid; await retirePython(); return true; }
    if (existing) {
      const owned = await ownedHelpers(NAME, config.binary, existing.pid);
      if (!owned.length) throw new Error("Another engine owns this port; it was left running.");
      for (const address of owned) await hc(["kill", address]);
      for (let attempt = 0; attempt < 50; attempt++) {
        await sleep(100);
        if (!(await health())) break;
        if (attempt === 49) throw new Error("Previous engine is still shutting down");
      }
      state = null;
    }
    const launched = await hc(["run", "--bg", "--no-parent", "--name", NAME, "--", config.binary,
      "--port", String(PORT), "--state", STATE(), "--config", `${appHome()}/mods/codenav/bridge/servers.json`]);
    if (launched.code) throw new Error(launched.stderr || "Could not start Go engine");
    for (let attempt = 0; attempt < 40; attempt++) {
      await sleep(100);
      const current = await health();
      if (current?.version === config.version) { verified = current.pid; await retirePython(); return true; }
    }
    throw new Error("Go engine did not become ready");
  })().finally(() => { starting = null; });
  return starting;
}
export async function lsp(method, body, sleep) {
  if (!verified) await ensureEngine(sleep);
  try { return await post(method, body); }
  catch (error) {
    if (!/fetch|connect|refused|network/i.test(String(error.message ?? error))) throw error;
    verified = null; state = null; prepared = null;
    // A database write may have reached the server even if its reply was lost.
    // Replaying it could duplicate changes. Let the caller refresh/reconcile.
    if (method.startsWith("db_")) throw new Error(`Database request could not be confirmed. Refresh before retrying. ${error.message ?? error}`);
    await ensureEngine(sleep); return post(method, body);
  }
}
// Status polling never starts a service.
export async function peek(method, body) {
  try { return await post(method, body); } catch { return null; }
}
