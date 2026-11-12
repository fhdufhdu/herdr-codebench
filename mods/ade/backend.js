// Transport only: the installed engine is a service boundary, not a UI owner.
import { home, appHome, readTextFile, hc, exec } from "herdr";
import { platform, arch } from "os";

const IDENTITY = "herdr-codebench-go";
const failure = (message, code) => Object.assign(new Error(message), { code });
const statePath = () => `${home()}/.cache/herdr-codenav/engine.json`;
async function readState(path) {
  const text = await readTextFile(path);
  if (text == null) return null;
  let value;
  try { value = JSON.parse(text); } catch (_) { throw new Error("엔진 상태 파일을 해석할 수 없습니다."); }
  if (value.engine !== IDENTITY || !Number.isInteger(value.pid) || value.pid <= 0 || !Number.isInteger(value.port)
    || value.port <= 0 || value.port > 65535 || typeof value.token !== "string" || !value.token || typeof value.version !== "string") {
    throw new Error("엔진 상태 파일의 서비스 식별자가 올바르지 않습니다.");
  }
  return value;
}
async function post(state, method, body) {
  let response, envelope;
  try {
    response = await fetch(`http://127.0.0.1:${state.port}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Codenav-Token": state.token }, body: JSON.stringify(body ?? {}),
    });
    envelope = await response.json();
  } catch (_) { throw failure("로컬 엔진에 연결하지 못했습니다. 요청을 자동 재실행하지 않았습니다.", "engine_unavailable"); }
  if (!response.ok || envelope?.ok !== true) {
    const detail = String(envelope?.error || `HTTP ${response.status}`).split(state.token).join("[redacted]");
    const code = /document owner conflict/.test(detail) ? "owner_conflict" : /session is closed/.test(detail) ? "owner_closed"
      : /stale.*revision|conflicting document revision|text conflicts/.test(detail) ? "stale_revision"
      : /document is not open/.test(detail) ? "lease_missing" : response.status === 401 || /engine stopped/.test(detail) ? "engine_unavailable" : "request_failed";
    throw failure(`엔진 요청 실패: ${detail}`, code);
  }
  return envelope.result;
}
async function healthy(state) {
  const health = await post(state, "health", {});
  if (health?.engine !== IDENTITY || health.pid !== state.pid || health.version !== state.version) {
    throw new Error("엔진 응답의 서비스 식별자가 상태 파일과 일치하지 않습니다.");
  }
  return { ...state, started: health.started };
}
async function discover(cx, onPhase) {
  onPhase?.("read-state");
  try { const state = await readState(statePath()); if (state) { onPhase?.("health"); return await healthy(state); } }
  catch (error) { throw failure("기존 엔진이 응답하지 않거나 식별자가 다릅니다. 실행 중인 엔진을 재시작하지 않았습니다.", error.code === "engine_unavailable" ? "engine_unavailable" : "engine_identity"); }
  if (!cx?.sleep) throw new Error("엔진을 시작할 작업 컨텍스트가 없습니다.");
  let occupied = false;
  try { await fetch("http://127.0.0.1:47822/health", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); occupied = true; }
  catch (_) { /* A missing singleton may now be launched; binding still checks races. */ }
  if (occupied) throw failure("기본 엔진 포트 47822가 사용 중이지만 상태 파일이 없습니다. 기존 프로세스에 접근하거나 재시작하지 않았습니다.", "engine_unavailable");
  const directory = `${appHome()}/data/codebench-engine`, config = `${appHome()}/mods/codenav/bridge/servers.json`;
  const manifestText = await readTextFile(`${directory}/manifest.json`);
  if (!manifestText) throw new Error(`설치된 엔진이 없습니다: ${directory}`);
  let manifest;
  try { manifest = JSON.parse(manifestText); } catch (_) { throw new Error("설치된 엔진 manifest를 해석할 수 없습니다."); }
  const os = { darwin: "darwin", macos: "darwin", linux: "linux", win32: "windows", windows: "windows" }[platform()];
  const cpu = { arm64: "arm64", aarch64: "arm64", x64: "amd64", x86_64: "amd64", amd64: "amd64" }[arch()];
  const target = manifest.targets?.find(item => item.os === os && item.arch === cpu);
  if (manifest.engine !== IDENTITY || !target || !/^(darwin|linux|windows)-(arm64|amd64)\/herdr-engine(\.exe)?$/.test(target.file)) {
    throw new Error("현재 운영체제에 맞는 설치 엔진을 찾지 못했습니다.");
  }
  if (await readTextFile(config) == null) throw new Error(`설치된 언어 서버 구성이 없습니다: ${config}`);
  const binary = `${directory}/${target.file}`;
  let version;
  try { version = await exec(binary, ["--version"]); } catch (_) { throw new Error(`설치된 엔진을 실행할 수 없습니다: ${binary}`); }
  if (version.code !== 0 || !version.stdout.startsWith(`${IDENTITY} ${manifest.version} `)) throw new Error("설치된 엔진 버전 검증에 실패했습니다.");
  const ready = await readState(statePath());
  if (ready) return healthy(ready); // Another request may have started the singleton while version verification ran.
  const started = await hc(["run", "--json", "--bg", "--no-parent", "--no-notify", "--label", "ade.backend=owned",
    "--", binary, "--port", "47822", "--state", statePath(), "--config", config]);
  if (started.code !== 0) throw new Error("공유 엔진을 시작하지 못했습니다. 기본 포트와 설치 경로를 확인하세요.");
  for (let attempt = 0; attempt < 30; attempt++) {
    await cx.sleep(100);
    const state = await readState(statePath());
    if (state) return await healthy(state);
  }
  throw failure("공유 엔진이 준비되지 않았습니다. 기본 포트 47822와 설치 상태를 확인하세요. 기존 프로세스는 변경하지 않았습니다.", "engine_unavailable");
}
export async function backend(method, body = {}, cx, { shouldSend, onSend, onEngine, onPhase } = {}) {
  if (!/^[a-z_]+$/.test(method)) throw new Error("올바르지 않은 엔진 메서드입니다.");
  // No cross-view discovery promise or credential cache. The task that reads
  // state may be cancelled when its overlay closes; subsequent callers must
  // never inherit that task's unresolved promise.
  const state = await discover(cx, onPhase);
  if (shouldSend && !shouldSend()) throw new Error("문서 세션이 종료되어 동기화 요청을 보내지 않았습니다.");
  onEngine?.({ engine: state.engine, pid: state.pid, version: state.version, started: state.started });
  onSend?.();
  onPhase?.("request");
  const result = await post(state, method, body); // Never replay a request, including DB mutations.
  onPhase?.("reply");
  return result;
}
export async function backendStatus(cx) {
  const state = await readState(statePath());
  if (!state) throw failure("기존 엔진 상태를 아직 확인할 수 없습니다.", "engine_unavailable");
  const verified = await healthy(state);
  return { engine: verified.engine, pid: verified.pid, version: verified.version, started: verified.started };
}
export async function backendCleanup(method, body, _cx, { engine } = {}) {
  if (method !== "document_close") throw new Error("정리 전송은 문서 lease 해제만 지원합니다.");
  // A final close must not await a discovery/fetch promise owned by an earlier
  // task: HMR may already have cancelled that task. Never start a service here.
  const state = await readState(statePath());
  if (!state) throw new Error("기존 엔진 상태가 없어 문서 lease 해제를 확인하지 못했습니다.");
  const current = await healthy(state);
  // A lease belongs to one engine lifetime. Never replay a retired engine's
  // cleanup against a new window/editor lease in the replacement service.
  if (engine && (engine.pid !== current.pid || engine.version !== current.version || engine.started !== current.started)) {
    return { closed: true, path: body.path, document_owner: body.document_owner, revision: body.revision, engine_changed: true };
  }
  return post(state, method, body);
}
