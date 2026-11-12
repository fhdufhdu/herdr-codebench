# Herdr Codebench Go engine

Standalone Go engine for the Herdr `idea` and `codebench` layouts. It manages
external language servers, source-based Spring navigation and database tools.
It does not execute a Spring application or embed IntelliJ code.

## Install a prebuilt engine

The repository includes `dist/{darwin,linux,windows}-{amd64,arm64}/herdr-engine`
(`.exe` on Windows). `dist/manifest.json` records the source digest, build Go
version and every binary's SHA-256/size.

```sh
python3 engine/install.py --verify-only
python3 engine/install.py
```

The installer verifies the host artifact and installs it under
`~/.config/herdr-app/data/codebench-engine`, outside the UI mod reload tree.
`--app-home PATH` or `HERDR_APP_HOME` selects another Herdr home. Existing engine
files are backed up. No Go compiler is required to use the prebuilt executable.
On Windows with a running old executable, stop only the owned engine helper
before installing an update if the OS refuses its replacement.

The repository's `install.sh` installs the engine and mods together. Herdr starts
the host executable lazily as the named `codenav-engine` helper; it verifies the
installed version and process identity. The old exact Python helper is retired
after Go is healthy. Workspace terminals are preserved.

## LSP support and prerequisites

`mods/codenav/bridge/servers.json` defines command candidates for Java (JDT LS),
Kotlin, TypeScript/JavaScript, Go, Swift, Rust, Python, JSON/JSONC, YAML,
HTML, CSS/SCSS/Less, Bash/sh, C/C++, Markdown, TOML and XML. These are actual external
LSP programs, installed separately with their SDK/toolchains. Cross-compiling this
engine does not bundle those servers or establish that every toolchain runs on
every OS. `/info` reports availability without starting a language server.

Common web/configuration servers can be installed outside any workspace with:

```sh
npm install -g vscode-langservers-extracted yaml-language-server bash-language-server
```

Use a Node version supported by those packages (YAML2 requires Node22.13+).
The [VS Code server extraction](https://github.com/hrsh7th/vscode-langservers-extracted)
supplies the JSON, HTML and CSS servers;
[YAML LS](https://github.com/redhat-developer/yaml-language-server) handles YAML;
[Bash LS](https://github.com/bash-lsp/bash-language-server) handles `.sh`/`.bash`.
Bash lint diagnostics additionally require ShellCheck on PATH; formatting requires
shfmt. Bash LS does not support zsh/fish. C/C++ uses
[clangd](https://clangd.llvm.org/installation); accurate project analysis needs
existing compilation flags (for example `compile_commands.json`). Herdr does not
run a project build to generate them. `.h` uses the C document ID by default;
clangd uses compilation flags to determine the header's actual language.

Markdown uses [Marksman](https://github.com/artempyanykh/marksman) (`marksman server`).
TOML uses [Taplo](https://taplo.tamasfe.dev/cli/usage/language-server.html)
(`taplo lsp stdio`); install an LSP-enabled native build, since the npm build does
not include the language server. XML/XSD/XSLT/SVG uses
[LemMinX](https://github.com/eclipse-lemminx/lemminx): expose its native stdio
executable as `lemminx` on PATH, or set a cache override command to your installed
Java launcher, for example `["java","-jar","/absolute/path/to/org.eclipse.lemminx-uber.jar"]`.
On macOS the Homebrew formulae install Marksman, LSP-enabled Taplo and Bash's
lint/format helpers outside any workspace:

```sh
brew install marksman taplo shellcheck shfmt
```

These optional servers are not bundled or installed by the mod installer.
Markdown assistance covers document links/headings; it is not a general prose linter.

Extensions select a server family, while `didOpen.languageId` identifies the
actual dialect: TSX/JSX, JavaScript, JSONC, SCSS and Less keep their distinct IDs.
YAML `.yml`, HTML `.htm`, Python `.pyi`, and TypeScript `.mts`/`.cts` map to their
standard language IDs. Unknown extensions retain the explicit unsupported state;
plain text and every template language are not claimed as analyzed. Diagnostics,
completion, hover and hints vary by the selected server and available schemas/SDKs;
adding a server does not add a separate linter or inlay-hint renderer. JSON/YAML
schema-aware suggestions require schema associations supported by that server.
Use the existing `setup_status {lang}` endpoint to distinguish configured but
missing executables from unsupported file types; it does not start a process.

Click **LSP** in the status bar, use Find Action → **Language Server Setup**, or
open Settings → Tools → Language Servers. The guide asks for Java, Kotlin,
TypeScript, JavaScript, Go, Swift or Rust, shows the current OS's SDK/LSP install
steps with copyable commands and official documentation, checks executable
discovery, then starts the real server for the chosen project. Install commands
are guidance and are not executed automatically. JavaScript and TypeScript use
the same TypeScript language server.

The engine owns each stdio language-server process. Do not launch another stdio
server manually in a terminal; use **Start LSP** after installing its executable.
The readiness result requires a successful LSP initialize exchange. Discovering
an executable alone does not establish that the SDK, project or server works.

The engine supports hover, definition/type/implementation, references,
document/workspace symbols, diagnostics and super declarations. Positions and
token spans use zero-based UTF-16. Syntax colors use a lightweight lexical scanner;
semantic navigation always comes from LSP. Three server/root instances at most
are retained; idle servers stop after ten minutes and the idle engine after an
hour. Repeated failed startup requires explicit retry.

Per-language overrides can be placed in `~/.cache/herdr-codenav/servers.json`.
They merge fields with the repository configuration and remain untouched by
`install.sh`; the mod-local bridge JSON is the shipped base and is replaced on
installation, so keep personal changes in the cache override. `env` values apply only to
the language-server subprocess. The JVM running JDT may need a newer Java runtime
than the project's Java target: the installed JDT1.63 tested here requires Java25,
and passed using a host-local JDK27 override. Portable configuration contains no
machine-specific JDK paths. Kotlin's native watcher can be unavailable in a
sandboxed process even when the Herdr/core-launched server works.

## Unsaved editor documents (memory only)

The authenticated POST endpoints `document_sync` and `document_close` add an
explicit local buffer lease. They do not save text, change LSP configuration,
install an engine or start a second transport. Every response keeps the existing
`{"ok":true,"result":...}` / `{"ok":false,"error":"..."}` envelope. Domain conflicts
use that error envelope at HTTP200; malformed JSON/types use the existing HTTP400
handling. Authentication and the8MiB request bound are unchanged.

Sync example (replace the path with an absolute path on the engine's machine):

```json
{"path":"/workspace/app/main.go","document_owner":"editor-session-unique-id","revision":0,"text":"package main\n","retry":false}
```

`POST /document_sync` returns:

```json
{"ok":true,"result":{"path":"/workspace/app/main.go","document_owner":"editor-session-unique-id","revision":0,"version":1}}
```

`document_owner` must be nonblank and stable for one buffer session; `revision`
is a required nonnegative integer (zero is valid); `text` is a required string
(empty is valid). Paths are absolute local filesystem paths, lexically cleaned;
there is no remote-machine routing or symlink/inode identity unification. The
old `owner:{line,col}` field used by super navigation stays separate and unchanged.
Callers must never send remote-file paths to this local buffer API.

Buffered sync requires the server to advertise openClose support; unsupported
servers return an explicit error instead of a successful text-delivery ack.
The first sync acquires the path lease. Another owner is rejected. The same owner
can increase revision, or retry an identical revision/text. A lower revision or
the same revision with different text is rejected. Accepted text stays in engine
memory if server startup/transport fails: retry the identical sync (with `retry`
when restarting a failed server), or close that accepted revision. A lost sync
response therefore does not imply the lease was never acquired.

Supported buffered semantic endpoints are `hover`, `definition` (including
`typeDefinition`/`implementation` kind), `references`, `symbols`, `workspace_symbols`
and `diagnostics`, plus `related` with `kind:"super"`. Send the exact current owner/revision, and existing position
or query fields as appropriate. Omit text; if supplied, it must exactly match the
leased text. For example `POST /hover`:

```json
{"path":"/workspace/app/main.go","document_owner":"editor-session-unique-id","revision":0,"line":0,"col":8}
```

The result is wrapped with the snapshot synchronized before the LSP request:

```json
{"ok":true,"result":{"value":{"markdown":"..."},"path":"/workspace/app/main.go","document_owner":"editor-session-unique-id","revision":0,"version":1}}
```

`value` has exactly the endpoint's existing result shape. `revision` belongs to
the UI buffer; `version` belongs to that LSP process and can restart at1 after a
server restart. Syncing the same owner/revision/text, or requesting semantics for
the current lease, rehydrates a restarted server from memory without reading disk.
Engine process restart loses all leases/text; the caller must sync its buffer
again before semantic requests.

Lease validation and text synchronization are ordered, but no document lock is
held while awaiting a semantic RPC. A newer edit or close can finish while a
hover/reference request is pending. A reply may describe the server's later
state; it is labeled with the request snapshot, not certified as an immutable
server snapshot. **The caller must discard replies whose owner/revision no
longer match its current buffer**, including after close. The HTTP/RPC mechanism
retains its existing timeout and cancellation behavior.

Buffered definition/reference result previews use an active target buffer's
current memory text when available, falling back to disk otherwise. Legacy
previews keep their disk behavior. This also applies to another owner's target
buffer, but does not certify that the LSP analyzed that target revision or that
its range belongs to that preview snapshot. The source wrapper is unchanged;
callers must still discard stale source replies.

Buffered `diagnostics` returns this shape inside `value`:

```json
{"items":[],"busy":[],"diagnostic_version":null,"version_confidence":"pending"}
```

Syncing changed text clears its old diagnostics immediately. A versioned publish
that differs from the buffered LSP document version is rejected and cannot
overwrite newer diagnostics. `matched` means a publish supplied the matching LSP
version; `pending` means no eligible publish has arrived; `unversioned` means a
new publish arrived after cache invalidation but supplied no document version.
Unversioned items are returned with that explicit confidence. They **do not prove
which revision the server analyzed**: a delayed versionless publish from earlier
analysis cannot be perfectly distinguished. The UI must keep this distinction
visible and must not label unversioned diagnostics as revision-confirmed. A server
restart establishes a new version sequence in that process.

Close the exact current lease with `POST /document_close`:

```json
{"path":"/workspace/app/main.go","document_owner":"editor-session-unique-id","revision":0}
```

Success returns `{"ok":true,"result":{"closed":true,"path":"/workspace/app/main.go",
"document_owner":"editor-session-unique-id","revision":0}}`. The engine sends
`didClose` when the synchronized server supports it, clears that document cache
and releases the lease; it never starts a server just to close. Wrong owners,
stale revisions and already-closed leases return errors. A closed(path,owner)
session is retired for the engine lifetime, preventing delayed sync retries from
resurrecting a closed buffer. Reopening uses a **new** owner id. Retirement stores
identity only, not document text. Disk navigation is allowed again after close.

Ownerless saved-file navigation keeps its original response shape when no lease
is active. It is rejected for a leased primary path instead of overwriting unsaved
text with disk content. The native server's `Open` also refuses to replace an
already-owned document during legacy multi-file navigation. Buffered `related` supports `kind:"super"`: its primary declaration header uses
the source text snapshot; active parent buffers in the same language/root server
are synchronized/read from memory. A parent that changes or closes during the
operation causes an explicit stale-target error. Active parents belonging to
another server/root are explicitly unsupported; this addition does not move a
lease across servers. Legacy super navigation remains disk-based. Other buffered
`related` kinds and buffered Spring requests remain unsupported; their existing
explicit-text/disk contracts stay separate. `tokens` remains lexical analysis with its existing
explicit `text` input; it is not an LSP document request. Rename and arbitrary
workspace edit application remain outside this addition.


## Buffered completion and formatting

`completion`, `completion_resolve` and `formatting` require the current document
owner and revision, just like other buffered language requests. Completion uses
UTF16 `line`/`col`; formatting accepts `tab_size` (1–16, default 4) and
`insert_spaces` (default true). Responses retain the snapshot identity envelope.
Server capability checks return an explicit unsupported result when unavailable.

Completion returns at most 100 normalized items (4 MiB total). Plain text,
`textEdit`, and same-document `additionalTextEdits` are supported. The selected
item may be resolved when the server advertises resolve support. Basic snippets
are flattened to plain text: tabstops disappear, placeholders use their initial
defaults, choices select the first value, and escaped literals remain literal.
There is no interactive tabstop session or variable expansion. Variables,
transforms, malformed/deep/oversized snippets, commands, insert/replace variants,
cross-file edits, invalid UTF16 ranges and overlapping edits are rejected or
disabled. Additional edits remain plain text. Completion commands are never executed. Server formatting edits are
validated against the owned snapshot as well.

ADE keeps candidates in local editor memory and applies the primary edit plus
additional imports as one revision-checked undo operation. Formatting changes the
buffer without saving. Ctrl+Space requests completion on every platform;
Cmd+Alt+L on macOS or Ctrl+Alt+L elsewhere formats. The bounded completion panel
keeps native text input focused: arrows select, Enter/Tab accept and Escape closes.
After a manual request discovers server trigger characters, committed trigger
input can request completion after 180 ms. This is not a snippet engine or an
arbitrary workspace-edit executor.

## Spring features

Java/Kotlin source indexing provides:

- Bean declarations, stereotype names, `@Bean` aliases/factory types and reverse
  navigation to injection sites.
- Typed constructor/field injection candidates, qualifiers, by-name `@Resource`,
  `@Primary`, basic interface/supertype matching and explicit ambiguity.
- Constant Spring MVC endpoint method/path locations.
- `@Value` references to application properties/YAML key declarations. Values
  are omitted from the results.

Use Find Action → **Spring Beans**, **Spring Endpoints**, or **Spring Configuration
Keys**. Source gutters distinguish bean/injection/config navigation. Multiple
candidates remain a chooser. The index skips build/generated `bin` mirrors,
hidden/vendor directories, symlinks and secret file types, caps2,000 files/16MiB,
and caches bounded source results. Unsaved text can be supplied explicitly.

This is static source navigation: runtime profiles/conditions, composed
annotations, dynamic paths, exact generic arguments and full Boot metadata
completion are not resolved. Conditional candidates remain labeled. No endpoint
requests are sent and no project code is executed by the Spring index.

## Database tools

Open **Database** on the right stripe, then **Add Data Source** or **Manage Data
Sources**. Find Action also exposes **Data Sources…**. MySQL, MariaDB,
PostgreSQL, SQL Server and SQLite drivers are included in the executable; no
JVM, database CLI or separate driver installation is required. Server databases
still require a reachable server and its connection details. SQLite uses an
absolute file path.

Profiles are global across workspaces. Metadata is stored atomically with mode
0600 in the engine cache's `database-sources.json`. On macOS, saved passwords
use Keychain under `dev.herdr.codebench.database`, with one opaque profile ID
per item. Metadata and API responses contain only storage status, never the
password. Blank input preserves a saved password; **Clear Saved Password**
stages removal until Save. Other platforms retain passwords in engine memory
and require re-entry after restart. Existing session credentials can be promoted
by saving before restart; an already restarted session needs one-time re-entry.
Network connections
default to certificate verification, with explicit TLS settings in the form.

Expand a connection to browse databases, schemas, tables/views and columns.
Double-click a table or press Cmd+Down to open its data tab. Navigate cells with
arrow keys; Enter/F2 or double-click edits a cell. Enter stages its value and
moves down, Escape cancels the cell editor, and Set NULL stages a SQL NULL.
Apply or Revert the staged changes. Updates/deletes require a primary key and compare original
values in one transaction. Conflicts roll the transaction back. Imports can
insert into tables without a primary key.

The tree menu opens SQL consoles and generates DDL from mixed database/schema/
table selections. In a console, **SQL Edit** uses the native editor; **Select
and Run** uses the source viewer for exact drag selection. Cmd+Enter shows the
execution candidates; edit mode lists statements because the native editor
does not expose its caret/selection. Block buttons run individual statements.
Jobs report actual state, current statement and elapsed time, with cancellation.

Copy and export share CSV, TSV, JSON, SQL INSERT/UPDATE/WHERE, Markdown, HTML
and XML extractors. The transfer dialog previews output and writes to the
clipboard or a file. CSV/TSV/JSON import previews columns and inserts all reviewed
rows in one transaction; a changed file requires a new preview.

Current bounds: grid pages default to 200 and cap at 1,000 rows; import caps at
1,000 rows per transaction; query/export results cap at 16 MiB. Query jobs have
a 120-second timeout and bounded concurrency/history. DDL responses warn about
unsupported advanced objects; they are not full database backups. SQL Server's
schema picker does not change the login default schema, so qualify SQL names.
See [requirements and limits](../docs/workflows/database/02-requirements.md) and
the [request contract](../docs/workflows/database/04-contracts.md).

## Build and verify

Building requires Go 1.26 or later. Driver modules and checksums are recorded
in `go.mod`/`go.sum`; the installer includes Go and dependency license notices.

```sh
cd engine
go test -race ./...
go vet ./...
cd ..
python3 engine/build.py
python3 engine/check_release.py
python3 design/database/check_api.py --binary engine/dist/darwin-arm64/herdr-engine
```

Builds use `CGO_ENABLED=0`, `-trimpath`, no VCS stamp, stripped symbols and an empty
build ID. The version includes the Go/config source digest. `--target OS-ARCH`
supports a focused rebuild; only matching-version artifacts are merged into the
manifest. All six binaries are cross-built and checksum-verified; execution
verification is performed on the host architecture only.

## Local request contract

Direct use:

```sh
./engine/dist/darwin-arm64/herdr-engine --port 47822 \
  --config ./mods/codenav/bridge/servers.json
```

Replace the executable path with the host build. The default private state file is
`~/.cache/herdr-codenav/engine.json` (0600); it contains PID/port/version and the
random token. Do not commit or log this state file. Requests are JSON POSTs to
`http://127.0.0.1:47822/METHOD` with `X-Codenav-Token` from that file. Responses
are `{ "ok": true, "result": ... }` or `{ "ok": false, "error": "..." }`.

Methods: `health`, `status`, `setup_status`, `setup_start`, `tokens`, `info`, `hover`, `definition`, `references`,
`symbols`, `diagnostics`, `workspace_symbols`, `related`, `spring_markers`,
`spring_project`. Source requests use `{path,line,col}`; `related` adds
`kind:"super"` and optional `{owner:{line,col},name}`, or Spring marker fields.
`spring_project` uses `{path,root,kind:"beans"|"endpoints"|"properties",query?}`.
Location records contain `path,line,col,end_line,end_col` and optional
`name,detail,text,external`.

The listener binds IPv4 loopback only, rejects browser Origin/non-loopback Host,
requires a token, bounds request/frame sizes and cleans up its owned state and
child servers on shutdown. The engine does not change project-file permissions
or global environment settings.

Setup requests use `{lang,root}`: `lang` is a configured engine language ID and
`root` is the absolute existing project folder (optional for `setup_status`).
The response is `{lang,installed,command,root,running,error}` inside the existing
envelope. `installed` means executable discovery; only `running` confirms actual
initialization. Status never starts a language server. Start does not create or
open a synthetic file; it applies the normal workspace-root rules and returns
the server's actual root. Explicit user overrides remain authoritative.


## Project preparation and readonly external analysis

ADE starts `project_prepare {root,retry?}` when opening a local project. The job scans bounded local sources, resolves configured language/project roots and initializes the existing pooled servers. One representative source per context triggers lazy project loading; an advertised workspace-symbol query may warm the workspace. `project_status {root}` reports scanning/preparing/ready/partial/error, file/source counts, truncation, per-context errors and live server progress. Ready means initialization and supported warmup finished, not proof of a universal complete index. Foreground file opening remains independent.

Limits: 50,000 files, 100,001 entries, 16 contexts, 2 concurrent preparations, 3-minute job and 90-second context deadlines. Dependency/build/cache/VCS and agent metadata/worktree directories are excluded. At the 3-server pool limit background preparation refuses to evict foreground servers and reports partial/error; explicit retry is available. Foreground-owned documents are never replaced by a warmup snapshot. File IO occurs outside foreground locks; TryLock skips busy locks and notification holds are bounded to 1 second. Completed preparation metadata retains the latest 12 roots and does not retain evicted server objects.

JAR/JDT and file-based external library source caches retain private original URI/language/root metadata plus a content digest. Readonly `info`, `hover`, `definition`, `references`, `symbols` use that URI on the original project server. Cached files are never didOpen/didChange documents. File-based servers that require an open document receive the verified original file URI through the shared saved-document synchronization path; active editor leases are preserved and concurrent buffer changes invalidate the result. Source-origin metadata survives engine restart and is validated within the cache. Old caches without metadata require definition navigation from project source once. Buffered writes, completion/formatting and source lease endpoints reject cached libraries. External-source diagnostics are explicitly unsupported rather than represented as a clean file; pure syntax tokens remain available. File-based targets outside the project or under node_modules use the same original-server association. Their original file content must still match the cached digest; changed dependencies require reopening the definition.
