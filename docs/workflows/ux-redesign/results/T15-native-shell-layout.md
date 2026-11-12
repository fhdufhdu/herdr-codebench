# T15 native shell layout result

2026-11-05. Shell-only implementation; settings and native result views are integrated by the parent task.

## Behavior

The five tool positions remain left upper/lower, right upper/lower, and bottom. Closing the final visible slot on either side hides the enclosing horizontal column. Opening a tool restores that column and its own slot without changing stored widths, split proportions, the other slot's hidden state, active stack children, or terminal payloads.

The existing `hideSlot` already hid an outer column after closing its last slot. The missing case was saved/migrated layout state where both slot columns were hidden but the enclosing `sidebar` or `tool-right` was still visible. Island migration previously retained that inconsistent combination and could leave an empty width reservation. `hideEmptyToolColumns` in `tool-layout.js` now repairs it. `ensureIdeaIslands` and tool `arrange` reuse the same operation. It only sets the outer hidden field when both known child slots explicitly have `hidden: true`; it never infers visibility from a tool list or changes child nodes. Missing/custom slot structures and codebench stay untouched.

`hideSlot` now compares side identity through its stable column id rather than object identity and checks the sibling state before dispatching commands, so a detached metadata snapshot works correctly too.

The tool registry includes `run-results` / `bottom-run-results`, defaulting to bottom, with content view `run-results` and shared-header Stop command `codenav.run-results-stop`. Existing registry-driven `addMissing` can add it; no duplicate body header or shell-wide restyling was introduced.

## Files and evidence

Changed shell sources: `mods/codenav/tool-layout.js`, `tool-windows.js`, `islands.js`. Extended `design/idea/check_workspace.mjs` and `check_system.mjs`.

Passing checks:

- `node --experimental-vm-modules design/idea/check_workspace.mjs`: close/reopen both secondary slots, last-slot outer collapse, original width/ratio/active/node payload and future metadata retention, terminal payload retention across tool moves, stale outer repair and idempotence, five-slot positioning, codebench isolation, Run Results registry.
- `node --experimental-vm-modules design/idea/check_system.mjs`: actual island-migration repair of both stale side columns, complete layout equality except expected outer visibility, idempotence, plus existing shared-component checks.

`herdr-app check mods/codenav` was attempted and failed because concurrent tools changes import `uiManagedList` before the generated `idea-design.js` exports it. Parent must generate shared UI and repeat this check after integration. No generated modules were edited, no installation/HMR was triggered, and no actual UI observation was performed in this shell subtask. Parent owns the batched generation, installation and native inspection.

## Dedicated settings page regression extension

The bounded settings follow-up changed only `design/idea/check_settings.mjs` and this result note. The fixture now links the new Select/Popup/shared-list/shared-menu/database-manager imports and models all five tool positions. Existing customization-tree, optimistic-save, shortcut, notification, conflict and preservation regressions remain passing. Existing tree tests now explicitly request the toolbars page; the dedicated windows page has separate route assertions.

New assertions invoke the real settings-owned callbacks passed into shared primitives: master-list selection, toolbar within-position reorder, show/hide, position popup open and each of its five option actions, actual footer Cancel and Apply. They verify staged edits never leak on Cancel; Apply moves only the edited project; current hidden state, future tool ids, future positions and concurrent unrelated order/visibility edits survive; moved tools occur once; selection reveals the moved row; filtered lists disable reorder; and Database settings calls its manager entry point. Shared UI primitives are mocked here, so this establishes settings callback/state ownership rather than native focus, popup geometry, or pointer delivery.

CLI evidence: `node --experimental-vm-modules design/idea/check_settings.mjs` exits 0, including the new dedicated-windows suite and every prior regression. No application source changes, generated files, installation or HMR were performed for this follow-up.
