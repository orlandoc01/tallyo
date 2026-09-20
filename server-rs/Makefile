.PHONY: lint test test-graphql-gen deadcode coverage check-codegen test-all generate sync-web

# sqlc v1.31.1: mise locally, pinned into the build-runner image, sqlc-dev/setup-sqlc on GitHub.
SQLC ?= sqlc

lint:
	cargo fmt --check
	cargo fmt --manifest-path tools/graphql-gen/Cargo.toml --check
	cargo clippy --all-targets -- -D warnings
	cargo clippy --locked --manifest-path tools/graphql-gen/Cargo.toml --all-targets -- -D warnings

test: test-graphql-gen
	cargo test

test-graphql-gen:
	cargo test --locked --manifest-path tools/graphql-gen/Cargo.toml

deadcode:
	cargo machete

coverage:
	cargo llvm-cov --fail-under-lines 75 --ignore-filename-regex '(main\.rs|database/queries\.rs)'

generate:
	$(SQLC) generate
	cargo run --quiet --locked --manifest-path tools/graphql-gen/Cargo.toml -- ../schema src/schema/generated.rs
	rustfmt --edition 2024 src/database/queries.rs src/schema/generated.rs src/schema/generated/objects.rs src/schema/generated/roots.rs

sync-web:
	rm -rf web/dist
	cp -r ../web/dist web/dist
	touch web/dist/.gitkeep

check-codegen: generate
	git diff --exit-code -- src/database/queries.rs src/schema/generated.rs src/schema/generated/objects.rs src/schema/generated/roots.rs

test-all: check-codegen lint deadcode coverage test-graphql-gen
