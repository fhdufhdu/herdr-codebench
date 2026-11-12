# T53 one lower results strip

`mods/ade/results.js` owns one canonical tab strip for shell executions and SQL jobs. Entries have stable kind-qualified IDs, sort by start time and keep each project's manual selection during status-only updates. A newly added execution becomes active. Closing delegates to the corresponding child/model close helper without killing a process or cancelling a query.

Both retained child views support embedded mode. The shell child omits its strip and keeps explicit Stop in its status toolbar; DatabaseResults omits its job strip and fetches the selected job's rows locally. The host does not add another tool title. Selected-record render overrides avoid shared-state mutation during render. Existing child polling/recovery stays with its owning view.

Cross-copy launch observation also has a five-second starting grace period: the results copy must not report a false ownership failure before the separate launcher copy has obtained its process address. Persisted older starting records still recover by uniquely owned process name.

`check_ade_results.mjs` passes mixed strip composition, kind-ID collisions, newest/manual selection, project isolation, delegated close and release. `check_ade_execution.mjs` passes embedded-strip omission and cross-copy launch grace with existing ownership/process bounds. Native mod checks pass; root owns actual mixed shell/SQL UI inspection and installation.

Actual restored-process inspection exposed a missed observation start when the core project became available after initial layout creation. ResultsHost now detects current-project/history metadata during render and queues one coalesced task refresh outside render. It does not rely on `executions-changed` being broadcast to every mod copy. Tests cover empty initial context followed by the actual project and a new shared running record without any command delivery. Final process-state correctness still requires root's actual restored-record check.
