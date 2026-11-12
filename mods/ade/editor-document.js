// Transient document identity and snapshots; never persisted to shared state.
export const documentKey = (project, path) => JSON.stringify([project.id, project.root, project.machine ?? null, path]);
export const isDirty = doc => Boolean(doc?.state && doc.state.value() !== doc.saved);
export const markdownFile = path => /\.(md|markdown|mdx)$/i.test(path ?? "");
export const sourceHTML = text => `<pre>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;

// LSP file: locations may point outside the project or into installed packages.
export function externalSource(path, root) {
  const normalize = value => String(value ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  const file = normalize(path), base = normalize(root);
  return /(?:^|\/)node_modules(?:\/|$)/.test(file) || Boolean(base && file !== base && !file.startsWith(base + "/"));
}
