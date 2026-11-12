// Shared HTTP execution, scripts, private snapshots and in-memory client globals.
import { shared, setShared, readTextFile, writeTextFile, exec } from "herdr";
const T = value => value;

const METHOD = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT|WEBSOCKET|GRPC|GRAPHQL)\s+\S/;
export const isHttp = (path) => /\.(http|rest)$/i.test(path ?? "");
const dirOf = (p) => p.replace(/\/[^/]*$/, "");

// Each request: the line of its method, and its block (from its ### to the next).
export function httpRequests(lines) {
  const out = [];
  let start = 0, seen = false;
  lines.forEach((l, i) => {
    if (/^###/.test(l)) { start = i; seen = false; }
    else if (!seen && METHOD.test(l)) { out.push({ line: i, start }); seen = true; }
  });
  return out.map((r) => {
    const next = lines.findIndex((l, i) => i > r.line && /^###/.test(l));
    return { ...r, end: next === -1 ? lines.length : next };
  });
}

// The environment files nearest the .http file, and the names in them.
export async function httpEnvs(path, root) {
  let dir = dirOf(path);
  const files = {};
  for (;;) {
    for (const [k, name] of [["pub", "http-client.env.json"], ["priv", "http-client.private.env.json"]]) {
      if (files[k]) continue;
      const text = await readTextFile(`${dir}/${name}`).catch(() => null);
      if (text !== null) files[k] = { path: `${dir}/${name}`, text };
    }
    if (files.pub || !root || dir === root || !dir.startsWith(root) || !dir.includes("/")) break;
    dir = dirOf(dir);
  }
  const names = new Set();
  for (const f of [files.pub, files.priv]) {
    // Names go into a command typed into the terminal: none with control characters.
    try { for (const k of Object.keys(JSON.parse(f?.text ?? "{}"))) if (k !== "$shared" && !CONTROL.test(k)) names.add(k); } catch {}
  }
  return { pub: files.pub?.path ?? null, priv: files.priv?.path ?? null, names: [...names] };
}

const store = () => shared("codenav.httpEnv") ?? {};
export const chosenEnv = (path, envs) => { const e = store()[dirOf(path)]; return envs.names.includes(e) ? e : envs.names[0] ?? null; };
const CONTROL = /[\u0000-\u001f\u007f]/;
const sq = (x) => `'${String(x).replace(/'/g, `'\\''`)}'`;

// client.global, kept between runs as IntelliJ keeps it: in memory only (they can be
// keys), by folder, until Herdr restarts. Each run starts by setting the values kept
// before, and its response handlers name a passing test after the globals the file's
// scripts set (ijhttp shows no client.log), read back from the run's JUnit report.
const MARK = "@@CODENAV-GLOBALS ";
const kept = new Map();
// A JS literal that can't end the {% %} block it is written into.
const literal = (v) => JSON.stringify(v).replace(/%/g, "\\u0025");
const globalNames = (lines) => [...new Set([...lines.join("\n").matchAll(/client\.global\.set\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]))];

// One request's block with the saved globals set first and the named ones logged after.
function withGlobals(block, saved, names, first) {
  const out = [...block], method = out.findIndex((l) => METHOD.test(l));
  if (method === -1) return out;
  const sets = first ? Object.entries(saved).map(([k, v]) => `client.global.set(${literal(k)}, ${literal(v)});`) : [];
  let at = method;
  if (sets.length) {
    const pre = out.findIndex((l, i) => i < method && /^<\s*\{%/.test(l));
    if (pre === -1) { out.splice(method, 0, "< {%", ...sets, "%}"); at = method + sets.length + 2; }
    else out.splice(pre + 1, 0, ...sets), at = method + sets.length;
  }
  if (names.length) {
    const log = `client.test(${literal(MARK)} + JSON.stringify({ ${names.map((n) => `${literal(n)}: client.global.get(${literal(n)})`).join(", ")} }), function () {});`;
    const post = out.findIndex((l, i) => i > at && /^>\s*\{%/.test(l));
    const close = post === -1 ? -1 : out.findIndex((l, i) => i >= post && /%\}\s*$/.test(l));
    if (close === -1) out.push("", "> {%", log, "%}");
    else if (close === post) out[close] = out[close].replace(/%\}\s*$/, `; ${log} %}`);
    else out.splice(close, 0, log);
  }
  return out;
}

const fresh = (dir, ext) => `${dir}/.codenav-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${ext}`;
const sh = (script, ...args) => exec("sh", ["-c", script, "sh", ...args]).then((r) => r.code === 0).catch(() => false);

// Java's bundled CA file can omit a company CA trusted by macOS. Keep TLS
// validation enabled and respect explicit JVM trust-store configuration.
export const HTTP_TLS_SETUP = [
  'if [ "$(uname -s)" = Darwin ]; then',
  '  case "${IJHTTP_JAVA_OPTS-} ${JAVA_TOOL_OPTIONS-} ${_JAVA_OPTIONS-}" in',
  '    *javax.net.ssl.trustStore*) ;;',
  '    *) IJHTTP_JAVA_OPTS="${IJHTTP_JAVA_OPTS-} -Djavax.net.ssl.trustStoreType=KeychainStore -Djavax.net.ssl.trustStore=NONE"; export IJHTTP_JAVA_OPTS ;;',
  '  esac',
  'fi',
].join("\n");

// The run's copy beside the .http file, private and with nothing in argv: written
// inside a fresh 0700 folder (the run's report folder), made 0600 there, then moved
// beside the file without replacing anything (a link included) already there.
async function privateCopy(dir, text) {
  const report = fresh(dir, ""), staged = `${report}/request.http`, copy = fresh(dir, ".http");
  if (!await sh('umask 077 && mkdir "$1"', report)) return null;
  const ok = await writeTextFile(staged, text, null).then(() => true).catch(() => false)
    && await sh('chmod 600 "$1"', staged)
    && await sh('[ ! -e "$2" ] && [ ! -L "$2" ] && mv -n "$1" "$2" && [ -f "$2" ] && [ ! -e "$1" ]', staged, copy);
  if (!ok) { await exec("rm", ["-rf", report]).catch(() => {}); return null; }
  return { copy, report };
}

// Runs one request (req) or the whole file.
export async function runHttp(path, lines, envs, req, after, { launch, notify, environment }) {
  const dir = dirOf(path), env = environment === undefined ? chosenEnv(path, envs) : environment;
  if ([path, envs.pub, envs.priv, env].some((x) => x && CONTROL.test(x))) return;
  const opts = ["ijhttp", "-L", "VERBOSE", "--no-progress", ...(env ? ["-e", sq(env)] : []), ...(envs.pub ? ["-v", sq(envs.pub)] : []), ...(envs.priv ? ["-p", sq(envs.priv)] : [])].join(" ");
  // An earlier build kept globals in shared state (on disk): drop them.
  if (shared("codenav.httpGlobals")) setShared("codenav.httpGlobals", null);
  const saved = kept.get(dir) ?? {}, names = globalNames(lines);
  const reqs = req ? [req] : httpRequests(lines);
  if (!reqs.length) { notify({ group: "codenav.http", title: T("No HTTP requests in this file"), level: "warning" }); return; }
  const text = [...(req ? [] : lines.slice(0, reqs[0]?.start ?? 0)), ...reqs.flatMap((r, i) => withGlobals(lines.slice(r.start, r.end), saved, names, i === 0))].join("\n") + "\n";
  const made = await privateCopy(dir, text);
  if (!made) { notify({ group: "codenav.http", title: T("Could not prepare HTTP request"), body: T("Check that the request folder is writable."), level: "error" }); return; }
  const { copy: tmp, report } = made;
  // The copy holds kept values: gone when the run ends, even by Ctrl+C.
  try { await launch({ name: "HTTP", command: `(trap ${sq(`rm -f ${sq(tmp)}`)} EXIT INT TERM; ${HTTP_TLS_SETUP}\n${opts} -r ${sq(report)} ${sq(tmp)})`, folder: dir }, after); }
  catch (error) { await exec("rm", ["-f", tmp]).catch(() => {}); await exec("rm", ["-rf", report]).catch(() => {}); throw error; }
  // The run's report, once written: the globals it ended with.
  const unxml = (x) => x.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  for (let i = 0; i < 900; i++) {
    await exec("sleep", ["1"]).catch(() => {});
    const out = await readTextFile(`${report}/report.xml`).catch(() => null);
    if (out === null) continue;
    // Only the names the file's scripts set, and only plain values.
    const found = {};
    for (const m of out.matchAll(/name="@@CODENAV-GLOBALS ([^"]*)"/g)) {
      let got; try { got = JSON.parse(unxml(m[1])); } catch { continue; }
      for (const n of names) if (Object.hasOwn(got ?? {}, n) && ["string", "number", "boolean"].includes(typeof got[n])) found[n] = got[n];
    }
    if (Object.keys(found).length) kept.set(dir, { ...saved, ...found });
    break;
  }
  await exec("rm", ["-rf", report]).catch(() => {});
}

