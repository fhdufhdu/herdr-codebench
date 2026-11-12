const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT", "WEBSOCKET", "GRPC", "GRAPHQL"];
const headers = ["Accept", "Authorization", "Content-Type", "User-Agent", "Cache-Control", "Cookie", "Origin", "Referer", "If-None-Match", "X-Request-ID"];
const values = { accept: ["application/json", "text/plain", "*/*"], "content-type": ["application/json", "application/x-www-form-urlencoded", "multipart/form-data", "text/plain"], authorization: ["Bearer ", "Basic "] };

// Analyze only the current buffer. Scripts and bodies are separate from headers.
export function analyzeHttp(text) {
  const diagnostics = [], tokens = [], symbols = [], contexts = [];
  let phase = "request", script = false;
  text.split("\n").forEach((source, line) => {
    const value = source.replace(/\r$/, ""), trimmed = value.trim();
    contexts.push(script ? "script" : phase);
    const color = category => tokens[line] = [[value.length, category]];
    const error = message => diagnostics.push({ line, col: 0, end_line: line, end_col: value.length, severity: 2, message });
    if (script) { if (trimmed.includes("%}")) script = false; return; }
    if (/^[<>]\s*\{%/.test(trimmed)) { script = !trimmed.includes("%}"); return; }
    if (/^###/.test(trimmed)) { phase = "request"; color("comment"); return; }
    if (/^(#|\/\/)/.test(trimmed)) { color("comment"); return; }
    if (phase === "request" && /^@/.test(trimmed)) { color("variable"); return; }
    if (!trimmed) { if (phase === "headers") phase = "body"; return; }
    if (phase === "request") {
      const request = /^(\S+)(?:\s+(\S+))?(?:\s+HTTP\/[\d.]+)?$/.exec(trimmed);
      const method = request?.[1], url = request?.[2];
      if (!methods.includes(method)) error("HTTP 메서드를 확인하세요. 예: GET, POST, PUT, DELETE");
      else if (!url) error("요청 URL이 필요합니다.");
      else if (!/^(https?:\/\/|wss?:\/\/|grpc[s]?:\/\/|\{\{|\/|localhost[:/])/.test(url) && method !== "CONNECT") error("URL의 프로토콜 또는 환경 변수 표기를 확인하세요.");
      if (methods.includes(method)) {
        const start = value.indexOf(method);
        tokens[line] = [[start, "punctuation"], [method.length, "keyword"], [value.length - start - method.length, "string"]];
        symbols.push({ name: trimmed, kind: "function", line, col: start });
      }
      phase = "headers";
    } else if (phase === "headers") {
      if (/^[<>]/.test(trimmed)) return;
      const header = /^([!#$%&'*+.^_`|~\w-]+)\s*:(.*)$/.exec(value);
      if (!header) error("헤더는 이름: 값 형식으로 입력하세요. 본문 앞에는 빈 줄이 필요합니다.");
      else tokens[line] = [[header[1].length, "variable"], [value.length - header[1].length, "string"]];
    }
  });
  return { diagnostics, tokens, symbols, contexts };
}

export function httpCompletions(text, offset) {
  const before = text.slice(0, offset), line = before.split("\n").length - 1;
  const current = before.slice(before.lastIndexOf("\n") + 1);
  const variable = /\{\{([\w$.-]*)$/.exec(current);
  let candidates = [], prefix = current.trimStart(), suffix = "", detail;
  if (variable) {
    prefix = variable[1]; suffix = text.slice(offset, offset + 2) === "}}" ? "" : "}}"; detail = "요청 변수";
    candidates = [...new Set([...text.matchAll(/^\s*@([\w.-]+)\s*=/gm)].map(match => match[1]))];
  } else {
    const phase = analyzeHttp(text).contexts[line];
    if (phase === "script" || phase === "body") return [];
    const header = /^([\w-]+):\s*(.*)$/.exec(current);
    if (header) { candidates = values[header[1].toLowerCase()] ?? []; prefix = header[2]; detail = "헤더 값"; }
    else if (phase === "headers") { candidates = headers; suffix = ": "; detail = "HTTP 헤더"; }
    else if (!/\s/.test(prefix)) { candidates = methods; suffix = " "; detail = "HTTP 메서드"; }
  }
  const character = current.length - prefix.length;
  return candidates.filter(value => value.toLowerCase().startsWith(prefix.toLowerCase())).map(value => ({
    label: value, detail, insert_text: value + suffix,
    text_edit: { range: { start: { line, character }, end: { line, character: current.length } }, newText: value + suffix },
  }));
}
