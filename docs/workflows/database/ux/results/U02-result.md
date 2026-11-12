# U02 result — macOS Keychain passwords

Implemented in `engine/database.go`, `engine/database_password.go`, and
`engine/database_password_test.go`. Existing token-auth routes and source IDs are
unchanged. No dependencies, release artifacts, UI files, or build scripts changed
by this task.

## Behavior

- macOS credentials use service `dev.herdr.codebench.database` and the existing
  opaque 32-hex source ID as account. Only that exact account is read/deleted.
- `/usr/bin/security` is fixed. A single interactive add command carries a
  versioned base64 payload through stdin; no password enters argv, environment,
  temporary files, public responses, metadata, or diagnostics. Encoding preserves
  Unicode, embedded newline/quote/backslash/NUL and trailing whitespace.
- `password_storage` reports `keychain`, `session`, or `none`; `has_password`
  remains compatible. Only the non-secret Keychain marker is persisted. Client
  markers are ignored. List and password-omitting rename never read Keychain.
- Saved credentials survive restart, with per-source lazy reads at connection.
  An explicit save promotes an available existing in-memory session credential;
  list/startup/connect never promotes credentials.
- Omitted password preserves the credential; an explicit empty string removes
  it. Profile deletion removes the matching credential. An externally removed
  item can be repaired by explicit password save, clear, or delete.
- Non-macOS retains session credentials and reports their actual availability;
  copied Keychain metadata does not claim a locally available credential.

## Failure and concurrency

The manager lock serializes metadata and credential mutation. A manager-wide
credential revision rejects a connection snapshot taken before an edit, including
delete/recreate. Keychain failures are explicit and never silently fall back to
session/plaintext. Draft connection tests propagate credential lookup failures.

Credential replacement/clear/delete reads only its own previous credential to
allow compensation if atomic metadata replacement fails. Metadata failure
restores the previous credential; rollback failure returns an explicit repair
error. Cancellation after a successful credential mutation compensates before
returning. Compensation uses manager lifetime rather than the cancelled request.

Every actual security command has a 15-second deadline. OS-process termination
cannot guarantee whether a command committed immediately before being killed;
such failures are reported, never presented as successful saves. Metadata and
Keychain cannot form a crash-atomic transaction; a crash between their commits
can leave an orphan or an outdated marker. No unrelated item is inspected to
reconcile this. Explicit profile save/clear/delete is the repair path.

The Apple CLI has a 4096-byte line buffer, so an encoded command at/over that size
is rejected explicitly rather than truncated. Accounts outside the product's
generated 32-hex ID format are rejected for credential operations.

## Validation

- `go test -race ./...`: passed, including existing backend/HTTP tests and new
  fake-store restart, omission, replace, clear, delete, marker spoofing, session
  promotion, metadata rollback, rollback failure, missing item repair,
  cancellation, concurrent saves, stale revision, and encoding/size tests.
- `go vet ./...`: passed.
- Six `CGO_ENABLED=0` builds passed: darwin/linux/windows × amd64/arm64.
  Outputs are disposable `/private/tmp/herdr-u02-*` files, not releases.
- Ordinary Go tests force a session-only default store and never access a user's
  Keychain. Dedicated tests inject an isolated fake.
- Added opt-in `TestDatabaseKeychainLiveOwnItem` using one new random account
  only. It validates complex-string roundtrip, replacement/delete, missing status,
  and interactive command error propagation, with own-item cleanup even on failure.
  The host run passed (2026-11-05, 0.21s): own-item set/get/replace/delete and
  interactive failure status, with fixture removal confirmed. No user account
  was read. The earlier sandbox failure is superseded by this actual host result.
- Actual UI verification is owned by parent.

Implementation evidence for the line parser and exit flow:
[Apple SecurityTool security.c](https://github.com/apple-oss-distributions/SecurityTool/blob/main/security.c).
