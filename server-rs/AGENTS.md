# Idiomatic Rust Patterns

* Prefer ? operator over explicit match statements for error propagation:
* Use if let instead of match when handling single patterns:
* Prefer match statements with guards over if/else if/else chains when selecting among multiple cases:
* Prefer iterator chains over manual loops:
* Use functional combinators (filter_map, flatten, fold, etc.) instead of intermediate collections
* Use ? operator over explicit error conversions when error types can be automatically converted via From trait or #[from] attribute:
* Use map_err only when you need custom error transformation that cannot be handled by the From trait:
* Use Result extensions like ok_or, and_then, or_else for complex flows
* Prefer destructuring assignments where appropriate
* Use .. spread operator in struct updates
* Leverage From/Into traits for conversions
* Use AsRef/AsMut bounds for flexible parameter types
* When a function returns more than two primitive scalar values, wrap them in a struct with named fields.
* Take database executors as `impl sqlx::Executor<'_, Database = sqlx::Sqlite>` (anonymous lifetime); never introduce a named lifetime parameter just for the executor.
* Group imports from same crate using curly braces:
* Use qualified paths sparingly - prefer imports over fully-qualified names in function signatures:

# Commands

Run from `server-rs/` (or `make -C server-rs <target>` from the repo root).

## Build
```
cargo build
cargo build --release
```

## Test
```
make test
```

## Lint
```
make lint          # cargo fmt --check + cargo clippy --all-targets -- -D warnings
make deadcode      # cargo machete
```

## Codegen
```
make generate      # regenerate database queries and GraphQL enums/input objects
make check-codegen # verify committed generated Rust sources are current
```

`make generate` and `make check-codegen` need `sqlc` v1.31.1 on the path (`mise use sqlc@1.31.1`
locally; the CI image pins the release binary). `sqlc.yaml` points at the `sqlc-gen-rust.wasm`
asset of a tagged release of https://github.com/orlandoc01/sqlc-gen-rust and pins its SHA-256
(a local build hashes differently). To bump the plugin, change the release tag in `wasm.url`
and update `sha256` from that release's `.sha256` asset.

`dynfilters.prepared` makes the plugin enumerate every SQL text a dynamic-filter query can
render and emit `prepare_dynfilter_variants`, which `database::open_database` runs on the pool's
single connection after migrations so every variant is prepared and cached before the first
request. Queries whose control combinations exceed the plugin's variant caps are listed in
`dynfilters.variants_skip` and keep the uncached path, as does every query with a `sqlc.slice`
parameter. `sqlx.compile_check` stays off.

`tools/graphql-gen` uses `apollo-compiler` to validate `../schema/*.graphql` and merge type
extensions, then emits enums and input objects into `src/schema/generated.rs`, output objects,
unions, the `Node` interface, and per-type field resolver traits into
`src/schema/generated/objects.rs`, and the `Query`/`Mutation` resolver traits into
`src/schema/generated/roots.rs`; never hand-write those types. Rust scalar mappings remain in the
emitter. `tools/graphql-gen/resolvers.toml` lists the object fields implemented by handwritten
resolver methods; every other object field becomes a plain struct member. Scope guards run inside
generated method bodies (a guarded plain field gets a generated accessor), and a failed guard or
resolver on a nullable field is recorded as a pathed error with the field resolving to null; the
`#[graphql(guard)]` attribute path would omit the field instead. Generation rejects,
rather than silently dropping: root fields without `@requiresScope`/`@requiresDynamicScope`,
argument-bearing object fields missing a `resolvers.toml` entry, argument defaults on any
resolver method, interfaces other than `Node`, and any `Node` shape other than an argument-free
`id: ID!`. `make test` and `make test-all` include generator tests that compile and run generated
Rust; `make lint` checks both packages.

## Everything
```
make test-all      # check-codegen + lint + deadcode + coverage + generator tests
```

# Standards

* Follow standard Rust naming conventions (snake_case for functions/variables, CamelCase for types)
* Use anyhow with message strings for errors; do not add thiserror error enums (the crate does not depend on thiserror)
* Prefer ? operator over match for error propagation
* Prefer `anyhow::ensure!(cond, MESSAGE)` over conditional `bail!(...)` or `if !cond { return Err(...) }` for validation — declarative, no nested returns. Reserve `bail!(...)` for unconditional error exits. When a test asserts the message, define it as a module-level `&str` constant shared by the implementation and the test (`assert_eq!(err.to_string(), MESSAGE)`); otherwise inline the format string.
* Use async/await for I/O operations
* Derive common traits: Debug, Clone, PartialEq where applicable
* Keep visibility to the narrowest scope: private for an item used only by its module and children, `pub(super)` for parent-only use, `pub(crate)` for crate-wide use, and `pub` only for crate-root re-exports; `unreachable_pub` enforces this.
* Validate meaningful string values with newtypes that implement `TryFrom<String>` at the configuration or input boundary. Map absent optional values to `Option<Newtype>`; do not assign them an empty-string sentinel. Downstream functions accept the validated type.
Documentation
* Use /// for public API documentation
* Include examples in doc comments
* Document panics and errors
* Write unit tests in #[cfg(test)] modules
* Use tempfile for filesystem tests
* Use assert_cmd for CLI integration tests
* Upon completion of each task that involves Rust code, AI agents MUST run the following to ensure code quality and consistency:
    - cargo fmt: autofix formatting before checks
    - make test-all: work is done only when check-codegen, lint, deadcode, and coverage all pass — `cargo test` alone is not enough
