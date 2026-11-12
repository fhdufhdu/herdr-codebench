# Settings Database and Markdown polish

The settings sidebar now includes Database. It links to the existing fresh `ade` database-manager overlay and explains application-wide profiles plus macOS Keychain/other-platform session password storage. Opening that manager neither applies nor discards screen/tool/keymap drafts. Its connection changes retain the manager's own Apply/Cancel boundary.

Markdown no longer acquires an unsupported LSP lease or reports that lack of server support as an error. The same live buffer supplies a neutral Markdown status and ATX/Setext heading metadata for the outline; fenced code headings are excluded. Edits/reloads refresh that metadata, and preview/source retain the same document. This local outline does not fabricate diagnostics or semantic navigation.

`check_ade_settings.mjs` passes manager routing, draft preservation, cancellation and absence of external writes. `check_ade_editor.mjs` passes Markdown lease omission, real heading updates and existing editor guards. Native mod check passes. Actual settings/Markdown visual inspection remains with root; no installation, user profiles or external files were changed in this polish.
