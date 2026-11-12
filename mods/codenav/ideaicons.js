// IntelliJ's New UI icons (mods/codenav/idea-icons, Apache-2.0, see its NOTICE)
// for files, folders and symbols, as the idea layout shows them. The same file is
// mods/activity/ficons/idea.js (a mod can't import another's code): keep both alike.
import { image } from "gpui-kit";
import { uiIcon, uiIconPath } from "./ui-icons.js";

const DIR = "mods/codenav/idea-icons";
const EXT = {
  kt: "kotlin", kts: "kotlinScript", java: "java", class: "javaClass", js: "javaScript", mjs: "javaScript", cjs: "javaScript", jsx: "javaScript",
  ts: "typeScript", tsx: "typeScript", mts: "typeScript", json: "json", yml: "yaml", yaml: "yaml", xml: "xml", html: "html", htm: "html",
  css: "css", scss: "css", less: "css", md: "markdown", markdown: "markdown", mdx: "markdown", properties: "properties", gradle: "gradle",
  sh: "shell", bash: "shell", zsh: "shell", fish: "shell", sql: "sql", txt: "text", log: "text", toml: "toml", http: "http", rest: "http",
  png: "image", jpg: "image", jpeg: "image", gif: "image", svg: "image", webp: "image", ico: "image", bmp: "image",
  zip: "archive", jar: "archive", war: "archive", tar: "archive", gz: "archive", tgz: "archive", "7z": "archive",
  csv: "csv", swift: "swiftLang", vue: "vue", groovy: "groovy", c: "c", cpp: "cpp", cc: "cpp", h: "h", hpp: "h", cs: "Csharp",
  pl: "perl", patch: "patch", diff: "patch", ttf: "font", otf: "font", woff: "font", woff2: "font", ipynb: "jupyter", tf: "terraform",
  graphql: "graphql", gql: "graphql", xhtml: "xhtml", conf: "config", cfg: "config", ini: "config", env: "config", lock: "text",
};
const NAME = {
  dockerfile: "docker", ".dockerignore": "ignored", ".gitignore": "gitignore", ".editorconfig": "editorConfig", "manifest.mf": "manifest",
  "build.gradle.kts": "kotlinGradleScript", "settings.gradle.kts": "kotlinGradleScript", gradlew: "shell", "gradlew.bat": "shell",
};
const EXCLUDED = new Set(["build", "out", "target", ".gradle", "node_modules", "dist", ".next", "__pycache__", ".venv"]);
const SOURCE = /(^|\/)src\/([^/]+)\/(java|kotlin|groovy|scala|swift|go|ts|js)$/;
const RESOURCES = /(^|\/)src\/([^/]+)\/resources$/;
const isTest = (set) => /test/i.test(set);

/** The icon path (for image()) of a path relative to its project. */
export function ideaIcon(path, dir = false) {
  const lower = path.toLowerCase(), name = lower.split("/").pop();
  if (dir) {
    if (EXCLUDED.has(name)) return `${DIR}/excludeRoot.svg`;
    let m = SOURCE.exec(path);
    if (m) return `${DIR}/${isTest(m[2]) ? "testRoot" : "sourceRoot"}.svg`;
    m = RESOURCES.exec(path);
    if (m) return `${DIR}/${isTest(m[2]) ? "testResourcesRoot" : "resourcesRoot"}.svg`;
    // Folders below a source root are packages.
    if (/(^|\/)src\/[^/]+\/(java|kotlin|groovy|scala)\/./.test(path)) return `${DIR}/package.svg`;
    return `${DIR}/folder.svg`;
  }
  // A Kotlin or Java file named like a class shows as that class, as IntelliJ's Project view does.
  const base = path.split("/").pop();
  if (/^[A-Z][A-Za-z0-9_]*\.kt$/.test(base) && !/Application\.kt$/.test(base)) return `${DIR}/classKotlin.svg`;
  if (/^[A-Z][A-Za-z0-9_]*\.java$/.test(base)) return `${DIR}/class.svg`;
  const id = NAME[name] ?? EXT[name.includes(".") ? name.split(".").pop() : ""] ?? "anyType";
  return `${DIR}/${id}.svg`;
}
/** The name IntelliJ's Project view shows: a class-like Kotlin or Java file without its extension. */
export const ideaName = (name) => /^[A-Z][A-Za-z0-9_]*\.(kt|java)$/.test(name) && !/Application\.kt$/.test(name) ? name.replace(/\.(kt|java)$/, "") : name;
// IntelliJ's New UI dark file status colors (expUI_darkScheme.xml FILESTATUS_*), by git mark.
export const IDEA_STATUS = { M: "#70AEFF", A: "#73BD79", U: "#E88F89", I: "#D69A6B", "!": "#DE6A66", D: "#6F737A" };
export const ideaImage = (path, dir = false, size = 16) => image(ideaIcon(path, dir)).size(size).flex_none();

// Symbol kinds and legacy tool names share the canonical stroke family.
export const symbolIcon = (kind, _path = "") => uiIconPath(kind ?? "symbol");
export const symbolImage = (kind, _path, size = 16) => uiIcon(kind ?? "symbol", size);
// Selection color comes from the owning stripe/button, including its disabled state.
export const toolImage = (name, size = 16, _selected = false) => uiIcon(name, size);
