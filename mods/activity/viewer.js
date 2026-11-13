// Viewers for files the text editor can't show: images, PDFs, audio/video and
// other binary files. Each works on remote files too (they're downloaded to the
// cache first). PDFs are drawn page by page with poppler's pdftoppm, only the
// pages on screen, at the width they're shown.
import { div, image } from "gpui-kit";
import { IDEA, isIdea, uiSize, ideaUI } from "./idea-design.js";
import { T } from "./i18n.js";
import { v_flex, h_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { exec } from "herdr";
import { iconButton } from "./common.js";
import { fetchToCache, stat, sh, cacheDir, ensureCache, unique, CACHE_REL } from "./io.js";

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "tif", "tiff", "avif"]);
const MEDIA = new Set(["mp4", "mkv", "webm", "mov", "avi", "m4v", "mp3", "wav", "flac", "ogg", "m4a", "aac", "opus"]);
// Formats GPUI can't draw itself: converted to PNG with ffmpeg first.
const CONVERT = new Set(["tif", "tiff", "avif", "ico"]);

export const extOf = (path) => { const n = path.split("/").pop(); return n.includes(".") ? n.split(".").pop().toLowerCase() : ""; };
export function viewerKind(path) {
  const ext = extOf(path);
  if (ext === "pdf") return "pdf";
  if (IMAGE.has(ext)) return "image";
  if (MEDIA.has(ext)) return "media";
  return null;
}

const rel = (abs) => `${CACHE_REL}/${abs.split("/").pop()}`;
export const human = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`;
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4];
const step = (z, d) => d > 0 ? ZOOMS.find((x) => x > z + 1e-6) ?? z : [...ZOOMS].reverse().find((x) => x < z - 1e-6) ?? z;

// Opens a file with the desktop's default app; a remote file is downloaded first.
export async function openExternally(path, on, local) {
  const file = local ?? (on ? await fetchToCache(path, on, extOf(path)) : path);
  await exec("xdg-open", [file]).catch(() => exec("open", [file]));
}

export class Viewer {
  constructor(kind, spec, opts = {}) {
    this.kind = kind; this.spec = spec; this.reason = opts.reason ?? null;
    this.id = unique("viewer");
    this.zoom = null; // null: fit
    this.box = { width: 0, height: 0 };
  }

  // Loads what the view needs. `alive()` says whether this load still matters.
  async load(cx, alive) {
    const { path, on } = this.spec;
    this.info = await stat(path, on);
    if (!alive()) return;
    if (!this.info) throw new Error("This file is no longer available");
    if (this.kind === "image") await this.loadImage(cx, alive);
    else if (this.kind === "pdf") await this.loadPdf(cx, alive);
    else if (this.kind === "media") await this.loadMedia(alive);
    else {
      const r = await sh('file -b -- "$1" 2>/dev/null', [path], { on }).catch(() => null);
      this.type = r?.stdout.trim() || null;
    }
  }

  dispose() {
    this.timer?.cancel(); this.timer = null; this.disposed = true;
  }

  // A local copy (remote: downloaded, with progress shown).
  async local(cx, alive) {
    const { path, on } = this.spec;
    if (!on && this.kind === "pdf") return path;
    this.progress = on ? 0 : null;
    const out = await fetchToCache(path, on, extOf(path), (n) => { if (alive()) { this.progress = n; cx.notify(); } });
    this.progress = null;
    return out;
  }

  async loadImage(cx, alive) {
    let file = await this.local(cx, alive);
    if (!alive()) return;
    const ext = extOf(this.spec.path);
    if (CONVERT.has(ext)) {
      const png = `${cacheDir()}/${unique("png")}`;
      const r = await exec("ffmpeg", ["-v", "error", "-y", "-i", file, "-frames:v", "1", png]).catch((e) => ({ code: 1, stderr: String(e) }));
      if (r.code !== 0) throw new Error(`Cannot convert this image: ${r.stderr.trim()}`);
      file = png;
    }
    let w = 0, h = 0;
    if (ext === "svg") {
      const head = (await exec("head", ["-c", "4096", file])).stdout;
      const num = (a) => { const m = new RegExp(`\\b${a}="([\\d.]+)(px)?"`).exec(head); return m ? Number(m[1]) : 0; };
      w = num("width"); h = num("height");
      const vb = /viewBox="[\d.\-]+[ ,]+[\d.\-]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(head);
      if ((!w || !h) && vb) { w = Number(vb[1]); h = Number(vb[2]); }
      if (!w || !h) { w = 512; h = 512; }
    } else {
      const r = await exec("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file]).catch(() => null);
      const m = /(\d+)x(\d+)/.exec(r?.stdout ?? "");
      if (m) { w = +m[1]; h = +m[2]; } else { w = 800; h = 600; }
    }
    if (!alive()) return;
    this.file = file; this.src = rel(file); this.w = w; this.h = h;
  }

  async loadMedia(alive) {
    const { path, on } = this.spec;
    // A frame and the stream summary, from ffprobe/ffmpeg where the file is (here only).
    if (on) return;
    const r = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height", "-of", "json", path]).catch(() => null);
    try {
      const j = JSON.parse(r?.stdout ?? "{}");
      this.duration = Number(j.format?.duration) || null;
      this.streams = (j.streams ?? []).map((s) => `${s.codec_type} ${s.codec_name}${s.width ? ` ${s.width}×${s.height}` : ""}`);
      const video = (j.streams ?? []).find((s) => s.codec_type === "video" && s.width);
      if (video) {
        await ensureCache();
        const png = `${cacheDir()}/${unique("png")}`;
        const at = this.duration ? String(Math.min(5, this.duration / 10)) : "0";
        const f = await exec("ffmpeg", ["-v", "error", "-y", "-ss", at, "-i", path, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", png]);
        if (f.code === 0 && alive()) { this.src = rel(png); this.w = Math.min(1280, video.width); this.h = Math.round(this.w * video.height / video.width); }
      }
    } catch { /* no details, the info card still shows */ }
  }

  async loadPdf(cx, alive) {
    const file = await this.local(cx, alive);
    if (!alive()) return;
    const r = await exec("pdfinfo", [file]).catch(() => null);
    if (!r || r.code !== 0) throw new Error(r ? r.stderr.trim() || "Not a readable PDF" : "pdfinfo is not installed (poppler-utils)");
    const pages = /^Pages:\s+(\d+)/m.exec(r.stdout), size = /^Page size:\s+([\d.]+) x ([\d.]+)/m.exec(r.stdout);
    this.file = file; this.pages = pages ? +pages[1] : 1;
    this.pw = size ? +size[1] : 612; this.ph = size ? +size[2] : 792;
    this.title = /^Title:\s+(.+)$/m.exec(r.stdout)?.[1]?.trim() || null;
    this.drawn = new Map(); this.drawing = new Set(); this.want = { start: 0, end: 1 };
    this.alive = alive;
    this.timer = cx.timer.every(120, (cx) => this.drawPages(cx));
  }

  // The width pages are shown at, in logical px.
  pageWidth() {
    const fit = Math.max(200, (this.box.width || 800) - 48);
    return Math.round(Math.min(fit, 1100) * (this.zoom ?? 1));
  }

  // Draws the pages in view (and the next one), two at a time.
  drawPages(cx) {
    if (this.disposed || !this.alive?.() || !this.file) return;
    const width = this.pageWidth();
    for (let n = this.want.start; n < Math.min(this.pages, this.want.end + 1); n++) {
      const done = this.drawn.get(n);
      if ((done && done.width === width) || this.drawing.has(n) || this.drawing.size >= 2) continue;
      this.drawing.add(n);
      cx.spawn(async (cx) => {
        try {
          await ensureCache();
          const out = `${cacheDir()}/${unique()}`;
          // Twice the shown width, for sharp text on high-density screens.
          const dpi = Math.max(36, Math.min(600, Math.round((width * 2) / (this.pw / 72))));
          const r = await exec("pdftoppm", ["-png", "-r", String(dpi), "-f", String(n + 1), "-l", String(n + 1), "-singlefile", this.file, out]);
          if (r.code !== 0) throw new Error(r.stderr.trim());
          const old = this.drawn.get(n);
          this.drawn.set(n, { src: rel(out + ".png"), width });
          if (old) exec("rm", ["-f", `${cacheDir()}/${old.src.split("/").pop()}`]).catch(() => {});
        } catch (e) { this.drawn.set(n, { error: String(e.message ?? e), width }); }
        finally { this.drawing.delete(n); cx.notify(); }
      });
    }
  }

  // Header buttons for this viewer.
  tools(cx, t) {
    const out = [];
    if (this.kind === "image" || this.kind === "pdf") {
      const z = this.zoom;
      out.push(iconButton("v-zoom-out", "minus", T("Zoom out"), (_e, cx) => { this.zoom = step(this.currentZoom(), -1); cx.notify(); }));
      out.push(div().id("v-zoom").px(6).h(isIdea() ? IDEA.inputHeight : 22).flex().items_center().rounded(isIdea() ? IDEA.controlRadius : 5).text_size(uiSize(11)).text_color(t.muted).cursor_pointer()
        .hover((s) => s.bg(t.hover)).tooltip(z === null ? "Fitted: click for 100%" : "Click to fit")
        .on_click((_e, cx) => { this.zoom = this.zoom === null ? 1 : null; cx.notify(); })
        .child(z === null ? "Fit" : `${Math.round(this.currentZoom() * 100)}%`));
      out.push(iconButton("v-zoom-in", "plus", T("Zoom in"), (_e, cx) => { this.zoom = step(this.currentZoom(), 1); cx.notify(); }));
    }
    out.push(iconButton("v-external", "external", T("Open with the system's app"), () => {
      openExternally(this.spec.path, this.spec.on, this.kind === "pdf" || this.kind === "image" ? this.file : null).catch(() => {});
    }));
    return out;
  }

  // Ctrl + wheel zooms (wheel up: in), like a browser. A mouse notch is one
  // step; trackpad pixels add up to one step per 60 px. Without Ctrl the event
  // goes on and scrolls. On the content, so it runs before the scroll container.
  wheelZoom(el) {
    return el.on_scroll_wheel((e, cx) => {
      if (!e.modifiers?.control) return;
      cx.stop_propagation();
      const dy = e.delta_lines ? Math.sign(e.delta_lines.y) * 60 : e.delta.y;
      this.wheel = (this.wheel ?? 0) + dy;
      if (Math.abs(this.wheel) < 60) return;
      const d = Math.sign(this.wheel); this.wheel = 0;
      const z = step(this.currentZoom(), d);
      if (z !== this.zoom) { this.zoom = z; cx.notify(); }
    });
  }

  currentZoom() {
    if (this.zoom !== null) return this.zoom;
    if (this.kind === "image" && this.w) return this.fitScale();
    return 1;
  }

  fitScale() {
    const bw = Math.max(50, (this.box.width || 800) - 32), bh = Math.max(50, (this.box.height || 600) - 32);
    return Math.min(1, bw / this.w, bh / this.h);
  }

  subtitle() {
    const size = this.info ? human(this.info.size) : "";
    if (this.kind === "image" && this.w) return `${this.w}×${this.h} · ${size}`;
    if (this.kind === "pdf" && this.pages) return `${this.pages} page${this.pages === 1 ? "" : "s"} · ${size}${this.title ? ` · ${this.title}` : ""}`;
    return size;
  }

  measured(el) {
    return el.on_size_change((s, cx) => {
      if (Math.abs(s.width - this.box.width) > 2 || Math.abs(s.height - this.box.height) > 2) { this.box = s; cx.notify(); }
    });
  }

  render(cx, t) {
    if (this.progress !== null && this.progress !== undefined) {
      return div().flex_1().p(16).text_color(t.dim)
        .child(`Downloading from ${this.spec.on}… ${human(this.progress)}${this.info ? ` of ${human(this.info.size)}` : ""}`);
    }
    if (this.kind === "image") return this.renderImage(t);
    if (this.kind === "pdf") return this.renderPdf(t);
    return this.renderInfo(t);
  }

  renderImage(t) {
    if (!this.src) return div().flex_1().p(16).text_color(t.dim).child(T("Loading…"));
    const s = this.currentZoom(), w = Math.max(1, Math.round(this.w * s)), h = Math.max(1, Math.round(this.h * s));
    return this.measured(div().id(`${this.id}-image-box`).flex_1().min_h(0).relative().bg(isIdea() ? t.surface : t.raised))
      .child(div().id(`${this.id}-image-scroll`).size_full().overflow_scroll()
        .child(this.wheelZoom(div().id(`${this.id}-image-content`).min_w_full().min_h_full().w(w + 32).h(h + 32).flex().items_center().justify_center())
          .child(image(this.src).w(w).h(h).flex_none())));
  }

  renderPdf(t) {
    if (!this.pages) return div().flex_1().p(16).text_color(t.dim).child(T("Loading…"));
    const width = this.pageWidth(), height = Math.round(width * this.ph / this.pw), gap = 12;
    const page = (n) => {
      const d = this.drawn.get(n);
      return div().id(`${this.id}-page-${n}`).w_full().h(height + gap).flex_none().flex().justify_center().pt(gap)
        .child(div().w(width).h(height).flex_none().bg("#ffffff").shadow_sm().relative()
          .when(Boolean(d?.src), (el) => el.child(image(d.src).w(width).h(height)))
          .when(!d?.src && !d?.error, (el) => el.child(div().p(12).text_color(t.dim).text_size(uiSize(12)).child(T("Loading…"))))
          .when(Boolean(d?.error), (el) => el.child(div().p(12).text_color("#b00020").text_size(uiSize(12)).child(d.error)))
          .child(div().absolute().bottom(4).right(8).text_size(uiSize(10)).text_color("#00000066").child(`${n + 1}`)));
    };
    const contentW = Math.max(width + 48, this.box.width || 0);
    const listId = `${this.id}-pdf`;
    return this.wheelZoom(this.measured(div().id(`${this.id}-pdf-box`).flex_1().min_h(0).relative().bg(isIdea() ? t.surface : t.raised)))
      .child(div().id(`${this.id}-pdf-x`).size_full().overflow_x_scrollbar()
        .child(div().w(contentW).h_full().child(v_virtual_list(listId, this.pages, height + gap, (i) => `p${i}`, (range) => {
          if (range.start !== this.want.start || range.end !== this.want.end) this.want = { start: range.start, end: range.end };
          const out = [];
          for (let n = range.start; n < range.end; n++) out.push(page(n));
          return out;
        }).size_full())))
      .child(Scrollbar.vertical(listId).viewport_from_layout().absolute().inset_0());
  }

  renderInfo(t) {
    const name = this.spec.path.split("/").pop();
    const line = (k, v) => h_flex().gap(12).child(div().w(80).flex_none().text_color(t.dim).child(k)).child(div().flex_1().min_w(0).child(v));
    const dur = this.duration ? `${Math.floor(this.duration / 60)}:${String(Math.round(this.duration % 60)).padStart(2, "0")}` : null;
    return ideaUI(v_flex().id("v-info").flex_1().min_h(0).overflow_y_scrollbar().p(24).gap(10).text_size(13))
      .when(Boolean(this.src), (el) => el.child(image(this.src).w(Math.min(640, this.w)).h(Math.min(640, this.w) * this.h / this.w).flex_none().rounded(6)))
      .child(div().text_size(uiSize(15)).font_semibold().child(name))
      .when(Boolean(this.reason), (el) => el.child(div().text_color(t.dim).child(this.reason)))
      .child(line("Size", this.info ? human(this.info.size) : "—"))
      .when(Boolean(this.type), (el) => el.child(line("Type", this.type)))
      .when(Boolean(dur), (el) => el.child(line("Duration", dur)))
      .when(Boolean(this.streams?.length), (el) => el.child(line("Streams", this.streams.join(", "))))
      .when(this.kind === "media" && Boolean(this.spec.on), (el) => el.child(div().text_color(t.dim).child(T("Open it with the system's app to play it (it's downloaded first)."))))
      .child(h_flex().pt(6).gap(8)
        .child(div().id("v-open-ext").px(10).py(4).when(isIdea(), (e) => e.h(IDEA.inputHeight).flex().items_center()).rounded(isIdea() ? IDEA.controlRadius : 5).bg(t.solid).text_color(t.solid_foreground).cursor_pointer()
          .on_click(() => openExternally(this.spec.path, this.spec.on).catch(() => {}))
          .child(this.spec.on ? "Download and open" : "Open with system app")));
  }
}
