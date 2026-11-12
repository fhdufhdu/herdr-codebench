# T54 one central document strip

`mods/ade/editor-host.js` retains the fresh file and database editors in embedded mode and owns one mixed canonical tab strip. File buffers, SQL buffers, table edits, undo and close prompts stay with their original child owners. Dirty markers cover both kinds. Tab close activates its owner and delegates the existing save/discard or Apply/discard prompt; generic Save never submits database mutations.

The host observes current project plus file/database document metadata and editor mode through a coalesced task-descriptor queue. Shared document opening therefore does not depend on command broadcast delivery. Render creates no handles, performs no I/O and does not notify. Cross-project callbacks are rejected, and a database body from a stale child context is withheld until asynchronous synchronization completes.

The file child exposes document/title/dirty/activate/closePath/refresh APIs and omits its own strip in embedded mode. Hidden file buffers cannot autofocus, publish an active outline or navigate over a database document when delayed semantic replies arrive. Lifecycle release awaits both child cleanup promises, including file LSP leases.

`check_ade_editor_host.mjs` passes single-strip composition, dirty preservation/prompts, explicit DB write boundary, asynchronous metadata opening without broadcast, project guards and awaited cleanup. Existing editor/results tests remain passing. Native check is separate from actual deferred layout/typing; root owns installation and visual integration verification.
