# T09 — Native drag/drop feasibility audit

Date: 2026-11-05. Scope: read-only source/type audit; no native implementation, installation, HMR, or runtime interaction performed.

## Conclusion

Mouse-driven project reorder and editor-tab reorder are feasible on eager native rows with the installed runtime. The current project picker uses deferred virtual rows and has an additional binding limitation described below. Herdr already ships mouse-driven space and terminal-tab reorder. A generic `on_drag` API is absent, but that does **not** mean native drag/drop is unavailable: `gpui-base` exposes a retained `DockArea` with native panel dragging, tab insertion, splitting, resizing, drop indicators, and persistence.

The existing Codebench/IDEA shell uses Herdr layout blocks, not `DockArea` panels. Native DockArea commands cannot simply be attached to those blocks or the current file-tab array. Keep the current layout/state owners for a small change; treat an entire DockArea conversion as a separate migration.

## Verified installed APIs

Sources below are the installed truth, not upstream assumptions. Line numbers refer to the files read for this audit.

| API | Exact supported behavior | Evidence |
| --- | --- | --- |
| `element.on_mouse_down("left", (event, cx) => …)` | Press reports `position`, optional `local_position`/`bounds`, `click_count`, modifiers. | `~/.config/herdr-app/gpui-kit.d.ts:482–498,756–767` |
| `element.on_mouse_move((event, cx) => …)` | Delivered while the element is hovered. Event has window-relative `position`, element-relative `local_position`, and `bounds`. | `gpui-kit.d.ts:473–480,721–722` |
| `element.on_mouse_up("left", (event, cx) => …)` | Release handler; not documented as a window-wide pointer capture. | `gpui-kit.d.ts:768–772` |
| `element.on_hover((hovered, cx) => …)` | Pointer entry/exit. | `gpui-kit.d.ts:727–728` |
| `element.on_mouse_down_out(…)` | Outside **press** in capture phase; not an outside release/cancel listener. | `gpui-kit.d.ts:774–781` |
| `element.on_drop((event, cx) => …)` | External files only: `{ paths: string[] }`, absolute paths, on a plain layout element. No arbitrary internal payload. | `gpui-kit.d.ts:782–783` |
| `run("space.move", { id, index })` | Core-owned space order, one-based index in `spaces()` as used by shipped sidebar; stays within its machine block. | `herdr.d.ts:52`, installed `AGENTS.md` model section, shipped spaces source below |
| `run("tab.move", { id, index })` | Core-owned terminal-tab order. Does not reorder Codebench file tabs. | `herdr.d.ts:55`, shipped tabs source below |
| `DockArea.new(id, {version?})` | Create retained dock state in `init`/event, never render; `release()` when owner is removed. | `gpui-kit.d.ts:21718–21810` |
| `DockArea.register_panel(name, Class)` / `area.add_panel(cx.new(Class), options)` | Panels are owned native view entities; serialized/deserialized by registered class. Options include name, placement, size, closable, zoomable, visible. | `gpui-kit.d.ts:21697–21810` |
| `element.drag_tab(group, index)` | Native source for Base's own panel payload. | `gpui-kit.d.ts:1293–1298` |
| `element.drop_tab(group, index?)` | Accept that panel payload; omitted index appends. | `gpui-kit.d.ts:1299–1303` |
| `dock_area(area).tab_bar(…).empty_group(…).drop_indicator(…).dock(…)` | Native docking with application-supplied chrome. Handlers receive resolved dock state, not drag coordinates. Chrome must use native commands, not register script event handlers. | `gpui-kit.d.ts:21811–21849` |
| `select_tab`, `close_panel`, `toggle_zoom`, `toggle_dock`, `resize_dock` | Native chrome commands on div/h_flex/v_flex, not Button. | `gpui-kit.d.ts:1274–1311` |
| `area.on("layout_changed", …)`, `dump()`, `load(state)` | Persist native arrangement, including per-panel `serialize()` payload. Edits become readable after the originating call returns; use layout_changed to observe the result. | `gpui-kit.d.ts:21728–21799` |

Dock placements are `center`, `left`, `right`, `bottom`; drop indicators also expose within-group splitting placement, window bounds, and relative placeholder bounds (`DockDrop`). Native panel group state exposes `locked`, `draggable`, `droppable`, and stable tab ids. No generic drag payload, pointer-capture, window-wide mouse-up, or drag-cancel registration is declared in the installed public types.

Herdr's layout engine independently supplies draggable split boundaries (`resizable`) and pane rearrangement (`movable`). A pane's built-in top-center grip swaps on center drop or splits at an edge. It excludes zoomed/one-pane tabs and composition terminal blocks; it is not a custom project/tab/tool drag handler. See installed `AGENTS.md`, Layouts section.

## Existing safe reuse

### Projects

Installed `mods/spaces/main.js:371–415` keeps source id and hovered target id, shows an insertion line, checks matching `machine`, and commits `space.move` only on release. Its root scroll container clears the pending press on release (`:462`). This is direct evidence that in-view project dragging works with the current binding.

Repository `mods/codenav/project-order.js` already keeps manual order in the core rather than another persistent list. `sortedProjects` groups by machine; `projectMove` validates adjacent moves and returns the same one-based command shape. Reuse this ownership for drag-to-target as well. The current arrows in `mods/codenav/tools.js` are an alternate input for the same operation, not a reason to invent new project order state.

### Tabs

Installed `mods/tabs/main.js:55–66` records a pressed terminal-tab index and calls `tab.move` when released over another tab. It stops press propagation so the titlebar does not move the window; close buttons stop their own presses. Root release clears pending state (`:93`). A new implementation should improve on its captured index by storing stable source/target ids and revalidating the live list at commit.

Repository `mods/codenav/tabs.js` owns file/review order in `shared("codenav.tabs")[editorKey()]` through `setTabs`. Reorder that array, preserving whole tab objects, current active file/review, pinned metadata, dirty state, history, and invisible review entries. `run("tab.move")` targets the wrong model. `uiTab` and `uiTabStrip` remain the shared appearance/scroll owners; add a common drag state/affordance there only as needed by actual callers.

### Tool windows

`mods/codenav/tool-windows.js` already owns `SIDES`, `sideOf`, `toolsOn`, `moveTool`, and `arrange`. The five current destinations are left upper/lower, right upper/lower, and bottom. `moveTool(name, to)` updates saved placement and invokes `arrange`; `arrange` moves the existing block node in a cloned live layout. Reuse that operation when committing a tool drop rather than duplicating layout manipulation in each header or stripe. Preserve native panel sizes, active/hidden state, terminal content and island chrome. `islands.js` remains chrome owner; tool bodies must not add a second header.

## Project picker integration constraint

The current `Projects` popup in `mods/codenav/tools.js` uses shared `uiMenu`, which uses `v_virtual_list`. Installed `gpui-kit.d.ts:830–846` explicitly prohibits registering handlers inside a deferred item renderer: callbacks lack a row-scoped lifetime and would accumulate. The list exposes only `on_item_click(key, cx)` and `on_item_secondary_click(key, event, cx)` (`:832–875`), with no stable-key left press/move/release hooks. `VirtualListScrollHandle` exposes only scroll-to-item/bottom and release (`:21300–21313`), with no offset getter to safely derive a row from a wrapper's y-coordinate after manual scrolling.

Consequently, the shipped eager sidebar's drag pattern cannot simply be attached to the current virtual project menu. Keeping its native scroll, stable row identity, long-menu keyboard behavior and shared component architecture calls for a small runtime extension: list-level `on_item_mouse_down/move/up` events carrying stable key and row-local coordinates, registered once outside the deferred renderer. General capture/cancel hooks would strengthen outside-release behavior as a separate addition. Alternatively, replace the shared menu's virtual viewport with a specifically designed pointer-aware eager viewport, including owned scroll and keyboard ensureVisible; that is a larger shared-component change and must not silently remove long-list behavior.

No project drag implementation was applied during this audit. In particular, there are no forbidden deferred-row event registrations, inferred scroll offsets, or production claims based on the HTML demo.

## Minimal implementation plan

1. First expose stable-key left pointer hooks on native virtual lists, then start project dragging inside the current project picker/list. Record `{sourceId, machine, startPosition}` on press, use a small movement threshold to distinguish clicks, and update only hovered target/insertion position on move. On release validate both ids against fresh `spaces()`, enforce the machine boundary, issue one `space.move`, and select Custom Order when committing from Name/Recently Used mode. Leave the current manual core order untouched on cancellation. Keep keyboard reorder actions available without displaying arrow buttons as the primary interaction.
2. Add file-tab reorder within the existing strip using stable ids and the current `editorKey`. Recompute the insertion against fresh tab state at commit, including before/after half hit-testing. Cancel if the owning space changes, source/target closes, or the pointer leaves the usable strip and no valid target is released. Preserve middle-click close and close-button propagation. Use the existing TabViewport; avoid replacing its scroll state on redraw.
3. For tool movement within one owning view, present definite drop zones for existing SIDES and invoke `moveTool` at release. Current headers/stripes are separate mod copies; a drag from one to another needs an explicitly designed shared drag session, recipient hover/release coordination and reliable cancellation. Do not claim a source-local mouse handler will observe the other mod or a release outside the window.
4. If richer free docking is required, prototype a single owned DockArea with representative panel views and shared Islands chrome, native `drag_tab`/`drop_tab`, and dump/load before migrating production views. Existing Herdr blocks, terminal data, view focus, command routing, upper/lower slots and native panel persistence must be mapped explicitly. Validate preservation before any whole-shell replacement.

## Runtime boundary and validation

No runtime change is required for scoped same-view project reorder on eager rows, file-tab reorder, or invoking existing tool placement operations. The existing virtual project picker needs the list-level pointer extension above, or a deliberate shared viewport replacement, to preserve its current menu guarantees. Native docking of newly owned DockArea panel views is also already supported.

A robust generic drag session across arbitrary existing mod/layout boundaries needs capabilities not documented by the public binding: typed source payload/receiver APIs, movement/release capture beyond the source, and authoritative cancellation on Escape, window exit/focus loss, reload, or source destruction. These should be added to the runtime, or an existing app-owned docking mechanism extended, before promising seamless arbitrary tool docking with the current block shell. Cross-window dragging and dragging tabs into new OS windows are likewise not exposed by these APIs. DockArea alone does not establish either capability.

Because this was source-only, runtime delivery/capture, native DockArea behavior, visual feedback, and cancellation have not been verified interactively. Before a native implementation is called complete: generate/check shared UI, run design system checks and `herdr-app check` for changed mods, then inspect actual project/tab drag, long scrolling lists, machine boundaries, close-during-drag, Escape/outside release, layout switches, restored sizes/visibility/order, retained terminal data and unchanged codebench behavior. A self-contained HTML demonstration establishes intended interaction only; browser Pointer Events/HTML DnD are not APIs available to native mods.
