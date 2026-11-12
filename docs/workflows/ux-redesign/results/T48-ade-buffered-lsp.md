# T48 buffered LSP in the ADE editor

The ADE editor now creates one fresh `LspSession` for each local CodeInput buffer. Loading, committed edits and save callbacks synchronize the current in-memory text/revision; selection callbacks update the cursor without reparsing unchanged text. Remote documents remain read-only and do not reach the local engine.

Engine token lines are converted from UTF-16 length/category spans to absolute offsets using the canonical `herdr.ux.syntax` palette. Current-revision diagnostics populate CodeInput's inline underline/hover API. One bottom information area shows actual LSP state/errors, diagnostic confidence, hover content and a canonical keyboard-managed list of references/diagnostics. Diagnostic activation selects and reveals the exact range. Hover/definition/references actions use the current native cursor; no invented cursor or fake diagnostics are supplied.

Symbols use the buffered endpoint and publish metadata only to `ade.outline[projectKey]`: `{path,revision,status,error,items}`. Each item includes name/detail/kind/depth and zero-based line/col. Background files cannot overwrite the currently selected file's outline. Definitions and search navigation use `ade.navigation[projectKey]` with one-based line/column and unique `at`; the editor applies each target once, switches to source and reveals the selected row. Navigation callbacks from stale projects cannot change the current project.

The editor never retains an event/render Context. Its initial task waits on a descriptor queue; render can enqueue work, but native state, I/O and selection changes execute in task/event contexts. Load generations prevent older reload responses replacing newer buffers. `release(cx)`/`close(cx)` synchronously dispose native state and return an awaitable lease-cleanup promise. Lease close is started directly from the final lifecycle context or the retained task-owned AsyncContext when the runtime omits the close argument, rather than spawning/queueing cleanup and returning early.

Validation:

- `node --experimental-vm-modules design/idea/check_ade_editor.mjs` passes document identity, stale reads/revisions/projects, CAS saves/conflicts, dirty close, canonical token/diagnostic conversion, native cursor navigation, remote read-only behavior and awaited lease cleanup.
- `node --experimental-vm-modules design/idea/check_ade_lsp.mjs` passes ordered revision sync, selection without reparse, stale replies, pending-write close, buffered symbols/diagnostics and transport boundaries.
- `herdr-app check mods/ade` passes. `python3 design/idea/make_ade_editor_fixture.py` creates an isolated populated native fixture; its `herdr-app check` also passes with real CodeInput/inline diagnostics/reference list. The fixture contains generated test content only.

These checks do not establish actual LSP toolchain behavior or deferred visual layout. Root integration owns installation and live typing/diagnostic/navigation inspection. Final native cleanup remains subject to the runtime's documented 250 ms lifecycle limit for newly started cleanup I/O; it no longer waits for earlier synchronization tasks.

Live integration subsequently exposed an initially blank source viewport despite passing native checks. The editor body now uses an explicit vertical flex parent; CodeInput's owner is supplying measured viewport/list bounds. This correction requires another root installation and visual inspection before source rendering can be reported verified. Newly selected/loading documents also publish an empty loading outline immediately from the task queue, preventing previous-document symbols remaining in that slot.

A subsequent actual HMR check exposed an owner conflict from the no-argument close path: cleanup had been queued and could be cancelled before lease release. That path now directly awaits close through the initial task-owned AsyncContext. The regression test explicitly omits the lifecycle argument and holds a close gate to prove its returned promise waits. An old orphaned fixture lease is not stolen or cleared; root will use a fresh fixture path and will not restart the shared engine.

The critical follow-up in T45 removes LspSession.close's wait on old serial/discovery promises entirely. Native lifecycle now starts exact-owner cleanup through the fresh existing-engine transport. The previous no-argument context fix alone did not solve cancellation of an already-started synchronization promise.
