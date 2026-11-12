# T41 ADE execution

`mods/ade/execution.js` independently implements configuration drafts and execution history. It imports only ADE workspace identity, generated canonical UI and native runtime APIs. No legacy controller is copied or imported.

- Configurations use `ade.run-configurations[projectKey]` with `configurations` and `selectedId`. Other project/namespace fields survive Apply. Cancel only closes the overlay. The canonical ADE managed list supplies navigation, scroll and add/remove/copy/up/down actions; retained native inputs supply details.
- Executions use `ade.execution[projectKey]` with bounded 20-record history and 2,000-line output snapshots. Unique owner and project labels are verified with `hc get` before reading, interrupting or killing. Commands launch independently using background/no-parent/no-notify, without terminal adoption or reuse. Closing a tab/view never stops a process.
- Restart recovery inspects the saved address or unique process name. Missing ownership becomes an explicit unknown state, with a state-check retry that does not execute the command again. Finished records preserve exit code, signal and reason. Running records alone schedule 1.5-second observation; unchanged output does not write shared state.

Validation:

- `node --experimental-vm-modules design/idea/check_ade_execution.mjs` passes ownership rejection, cancellation, bounded history/output, idle timers, recovery without relaunch and draft/unknown-field preservation.
- Adding `--process-fixtures` passes against real herdr-core with freshly owned fixtures only: failure exit 7 with transcript and cancellation terminating via signal 2 (null exit code preserved). Cleanup addresses only these fixture IDs.
- `herdr-app check mods/ade` passes. A separate temporary native fixture rendering populated results and configuration details also passes; its fake state is isolated from the user's shared state.

Integrated UI inspection and installation belong to the root integration task; native check does not establish deferred layout or interaction parity.
