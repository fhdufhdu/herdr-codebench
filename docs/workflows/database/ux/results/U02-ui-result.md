# U02 UI result — credential storage and removal

Updated `mods/codenav/database.js` for the engine's Keychain contract.

## Behavior

- Public source snapshots retain the storage status and availability flag. Secret values remain excluded from source snapshots and shared state.
- Existing Keychain credentials are described as stored in macOS Keychain. On macOS, new credentials are described as stored when saved, and session credentials offer promotion by saving the profile.
- Future-storage descriptions use the documented `herdr.window().platform` value from the installed `herdr.d.ts`. Actual saved-storage descriptions use engine metadata.
- Non-macOS descriptions retain the engine-session lifetime and restart requirement.
- Blank fields preserve existing credentials, including when a typed replacement is erased. Nonempty replacements stay in the masked native input until submitted.
- Clear Saved Password stages removal. Its pending description says removal occurs on Save. Only `db_save` receives the explicit empty string. Connection testing leaves the persisted credential intact.
- Editing another source resets staged removal. Typing into the field cancels staged removal. Closing the dialog discards the stage. Save failures leave the stage available to retry.
- The existing native mask, input cleanup, source IDs, common settings shell, and profile operations are retained.

## Validation

- JavaScript syntax check passed.
- `node --experimental-vm-modules design/idea/check_database_ui.mjs` passed.
- `python3 design/idea/sync_ui.py --check` passed.
- `node --experimental-vm-modules design/idea/check_system.mjs` passed.
- `herdr-app check mods/codenav` passed.

Parent owns new contract regression cases, translation entries, batch installation, and actual UI verification. This result records implementation and CLI checks only.
