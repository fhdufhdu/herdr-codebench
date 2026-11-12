# Installed IntelliJ data editor follow-up

2026-11-05. Focused static corroboration for the actual IntelliJ UI investigation. This pass owns documentation only. Parent investigation supplies the runtime observations separately.

## Artifact and Evidence continuity

Reused the completed D01 archive investigation and its exported records. REA parent `ev_7995a250fce0fa52807c61325ef9cd146d01b275d6e1d2c548d88a65b742ea48` and summary `ev_1fd0796ebb04facf697c9d8d11543a717fd5e7014413f7c599e7aa139a57deec` establish the selected DatabaseTools archive identity and bounded inventory. These IDs support artifact provenance only. The complete records remain in [rea-bundle.json](../evidence/rea-bundle.json), with a receipt in [rea-summary.json](../evidence/rea-summary.json).

The current REA server's `get_evidence_bundle(detail="summary", filters.operation="inspect_artifact")` returned zero retained records. This pass reused the exported evidence and opened no new binary session. No active IntelliJ runtime was attached, injected into, debugged, or automated by this worker.

Focused ordinary Python `zipfile` resource reads and the existing Android Studio JBR `javap -p -c` corroborated the action declarations below. Newly examined bytecode excerpts are retained inline in this document. This disassembly is ordinary static analysis, with no new REA Evidence ID. SHA-256 digests of the four relevant installed JARs were recalculated and matched [artifact-identities.json](../evidence/artifact-identities.json).

| JAR | SHA-256 |
| --- | --- |
| DatabaseTools/lib/database-plugin.jar | `d5178f9a63d4d432b653aa0aba1d99089cbc98cfefc72e21c1f5f4bdb05a88ef` |
| DatabaseTools/lib/modules/intellij.database.impl.jar | `a33e6f7cc9076d28313cce3a6b09fa36a252ae4507afe35bba05f514cf5218d9` |
| grid-core-plugin/lib/grid-core-plugin.jar | `b607de0d2e8d0ea8b78d3f9480bcf44476a2d5565f7c31495f4f48dcc72f43e7` |
| grid-core-plugin/lib/modules/intellij.grid.impl.jar | `5eb5eeb70231618ee3369c244346fceb8e9181101655f0752daede47fefd35e1` |

All paths are beneath `/Applications/IntelliJ IDEA.app/Contents/plugins/`.

## Finding ledger

| Question | Static observation | Coverage and implication |
| --- | --- | --- |
| How does selected-cell editing start? | `grid-core-plugin.jar!/META-INF/plugin.xml` lines 262–266 declares `Console.TableResult.EditValue`, class `com.intellij.database.run.actions.EditValueAction`, with `$default` `ENTER`, `alt ENTER`, and `F2`. `EditValueAction.actionPerformed` calls `DataGrid.editSelectedCell()`. | Answered for shipped defaults/action delegation. Parent runtime independently observed F2. The effective macOS/user keymap can override or inherit these bindings. Preserve the effective repository keymap boundary when reconstructing. |
| Does finishing a cell editor equal submission? | `GridTableCellEditor.stopCellEditing()` invokes `GridCellEditor.stop()` and the superclass stop path. `cancelCellEditing()` invokes `GridCellEditor.cancel()` and the superclass cancel path. Separate `SubmitMutations.submitChangesIfExists()` calls `DataGrid.submit()`. | Answered for separate editor and submission entry points. Parent runtime reports Return staging a blue modified cell and moving row. Use distinct active-edit, staged-mutation, and submitted states. The full editor validation/mutation pipeline was outside this bounded follow-up. |
| How are Submit and DML preview exposed? | `intellij.database.impl.jar!/intellij.database.impl.xml` lines 591–598 declares `Console.TableResult.Submit` with `use-shortcut-of="Console.Jdbc.Execute"` and a separate `Console.TableResult.PreviewDml`. Both are referenced by the preview/submit group. | Answered for distinct actions and inherited binding. Parent runtime reports UPDATE DML preview and Submit. Do not infer a universal Cmd+Enter mapping from this declaration. |
| What does Escape do? | The examined cell editor exposes explicit cancellation, but these narrowly inspected resources and methods did not establish the Escape input route. | Partially answered. Cancellation exists. Exact Escape behavior remains a runtime question, including whether it discards an active edit or also affects previously staged changes. |
| Does double-clicking a table open data? | `intellij.database.impl.xml` lines 630–633 registers `Jdbc.OpenEditor.Data`, class `OpenEditorAction$OpenDataAction`, inheriting `EditSource`. | Partially answered for the Open Data action. This declaration alone does not establish pointer double-click dispatch. Parent runtime must establish the tree gesture and resulting data tab. |
| Are Copy and Export backed by common formatters? | `GridCopyProvider.createExtractor()` uses `DataExtractorFactories.getExtractorFactory()`, `ExtractorsHelper.createExtractorConfig()`, and `DataExtractorFactory.createExtractor()`. `performCopy()` sends that extractor to `GridUtil.extractSelectedValuesForCopy()`. `DumpHandler` uses `DataExtractorFactory.createExtractor()` with its configured extraction context. | Answered for shared abstraction. Reuse a format/configuration model across Copy and Export while keeping selected-cell scope and export source/destination explicit. The shared factory API alone does not prove identical persisted option values in every UI context. |
| Is a single cell always copied through the selected tabular extractor? | `GridCopyProvider.createExtractor()` branches when selected row count and column count are each one, calling `GridExtractorsUtilCore.getSingleValueExtractor()` with the object formatter. | Answered. Scalar copy has a dedicated path. Avoid assuming a CSV header or JSON document wrapper for every one-cell copy. |
| What supports Insert/Update/Where formats? | `DbExtractorsHelper.getBuiltInFactories()` constructs `SqlInsertsExtractorFactory`, `SqlUpdatesExtractorFactory`, `WhereClauseExtractorFactory`, and `XlsxExtractorFactory`. Shared resources register `Console.TableResult.ChooseExtractor`. | Answered for built-in factory existence. Parent runtime reports the CSV selector menu exposing Insert/Update/Where/JSON entries. Exact format byte semantics and complete menu ordering remain outside static coverage. |

The existing retained disassemblies support the shared extractor and submission findings. [GridCopyProvider.javap.txt](../evidence/GridCopyProvider.javap.txt), [DumpHandler.javap.txt](../evidence/DumpHandler.javap.txt), [DbExtractorsHelper.javap.txt](../evidence/DbExtractorsHelper.javap.txt), [SubmitMutations.javap.txt](../evidence/SubmitMutations.javap.txt).

## Focused new static excerpts

From `grid-core-plugin.jar!/META-INF/plugin.xml`, lines 262–266, read directly with Python `zipfile`.

```xml
<action id="Console.TableResult.EditValue" class="com.intellij.database.run.actions.EditValueAction">
  <keyboard-shortcut keymap="$default" first-keystroke="ENTER" />
  <keyboard-shortcut keymap="$default" first-keystroke="alt ENTER" />
  <keyboard-shortcut keymap="$default" first-keystroke="F2" />
</action>
```

Selected instructions from `javap -p -c -classpath /Applications/IntelliJ IDEA.app/Contents/plugins/grid-core-plugin/lib/modules/intellij.grid.impl.jar com.intellij.database.run.actions.EditValueAction com.intellij.database.run.ui.GridTableCellEditor`. Offsets below are method-local JVM bytecode offsets. Intervening instructions are omitted.

```text
EditValueAction.actionPerformed(AnActionEvent)
  24 invokeinterface DataGrid.editSelectedCell:()V

GridTableCellEditor.stopCellEditing()
  95 invokeinterface GridCellEditor.stop:()Z
 104 invokespecial AbstractTableCellEditor.stopCellEditing:()Z

GridTableCellEditor.cancelCellEditing()
  11 invokeinterface GridCellEditor.cancel:()V
  17 invokespecial AbstractTableCellEditor.cancelCellEditing:()V
```

These excerpts establish declarations and selected direct calls. They do not recover original source or establish complete callers, effective input dispatch, pointer behavior, transaction isolation, or executed database writes.
