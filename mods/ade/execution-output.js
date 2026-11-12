// Keep process output intact in storage and format complete JSON lines for display.
export function readableOutput(output) {
  return String(output ?? "").split("\n").map(line => {
    const text = line.trim();
    if (!text.startsWith("{") && !text.startsWith("[")) return line;
    try { return JSON.stringify(JSON.parse(text), null, 2); }
    catch (_) { return line; }
  }).join("\n");
}
