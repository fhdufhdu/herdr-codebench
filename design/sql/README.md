# Headless SQL parser vendor

`npm ci --ignore-scripts && npm run build` reproducibly emits
`mods/ade/sql-parser-vendor.js`; `npm run check` verifies the bundle and notices.
Run `node --experimental-vm-modules design/ade/check_sql_completion.mjs` from
the repository root for completion and host-isolation coverage. Run
`node design/sql/check-native.mjs` to execute representative completions inside
Herdr's actual JavaScript runtime without installing a mod or changing UI state.

The MIT-licensed `@codemirror/lang-sql` **6.10.0** supplies its generated Lezer
grammar, error recovery, tokenizer and dialect definitions. Exact transitive
versions are locked in `package-lock.json`; runtime packages are
`@lezer/common` **1.5.5** and `@lezer/lr` **1.4.12**. esbuild **0.28.2** is build
only. Full notices are in `THIRD_PARTY_LICENSES.md` and the deployed bundle.

The package normally integrates with a DOM editor. `build.mjs` checks the SHA256
of the pinned upstream source, removes editor highlighting/indent/folding props,
and replaces the language-service wrapper with its parser descriptor. It leaves
the generated grammar, lexical tokenizer, dialect specifications and parser
recovery unchanged. Tree shaking removes the editor completion sources and all
editor dependencies. Lezer's optional host debug logging is disabled at build
time. The bundle imports no host modules and works in an empty JavaScript realm.

Primary upstream references:

- [SQL dialect API and implementation](https://github.com/codemirror/lang-sql/blob/main/src/sql.ts)
- [SQL grammar](https://github.com/codemirror/lang-sql/blob/main/src/sql.grammar)
- [SQL tokenizer](https://github.com/codemirror/lang-sql/blob/main/src/tokens.ts)
- [Lezer parser runtime](https://github.com/lezer-parser/lr)

`completeSQL` is a best-effort editor resolver, not a validating SQL compiler.
Its scope pass consumes Lezer nodes rather than reparsing SQL with regular
expressions. It resolves catalog relations, aliases, CTEs, derived projections,
query nesting and correlated/lateral visibility. It never executes SQL or
queries metadata itself. `referencedTables` lets the UI load only columns of
base relations in the current statement, including CTE and derived bodies.

Resource bounds: 250,000 UTF16 code units, 20,000 syntax nodes, 64 nesting/
projection expansion levels and 100 output candidates. Exceeding input/node
bounds returns empty candidates with `incomplete: true` and a `reason`; a
candidate cap also sets `incomplete: true`.

Deliberate limits: catalog/alias lookup is case insensitive (quoted output and
escaping are preserved); no expression type inference, procedure bodies,
table-valued function schemas, parenthesized join groups, or dialect-specific
PIVOT/UNPIVOT/MATCH_RECOGNIZE semantics. Unnamed computed projections expose no
invented output column. Recursive CTEs use explicit columns or their anchor
projection. Ambiguous unqualified catalog table names expose no columns until
qualified. Keyword/function fallback is a small common SQL vocabulary.
