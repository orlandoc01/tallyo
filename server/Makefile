.PHONY: test lint lint-fix deadcode coverage coverage-html sync-web generate-graphql generate-sql generate check-codegen test-sql test-all

COVER_DIR := /tmp/opencode
COVER_RAW := $(COVER_DIR)/tallyo.cover
COVER_FILTERED := $(COVER_DIR)/tallyo.handwritten.cover
COVER_MIN := 75.0
GO_TEST_PARALLEL ?= $(shell nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)
GOLANGCI_LINT_VERSION := v2.12.2
SQLC_VERSION := v1.31.1
GO_PACKAGES = $(shell go list ./... | grep -vE '/web(/|$$)')
test:
	go test $(GO_PACKAGES)

lint:
	go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_LINT_VERSION) run ./...

lint-fix:
	go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_LINT_VERSION) run --fix ./...

deadcode:
	@out=$$(go run golang.org/x/tools/cmd/deadcode@latest -test ./...); status=$$?; \
		if [ $$status -ne 0 ]; then printf '%s\n' "$$out"; exit $$status; fi; \
		if [ -n "$$out" ]; then printf '%s\n' "$$out"; exit 1; fi

generate-graphql:
	go run github.com/99designs/gqlgen generate

generate-sql:
	rm -rf internal/database/dbgen
	go run github.com/sqlc-dev/sqlc/cmd/sqlc@$(SQLC_VERSION) generate

generate: generate-graphql generate-sql

check-codegen:
	@set -e; \
		before=$$(mktemp); after=$$(mktemp); \
		trap 'rm -f "$$before" "$$after"' EXIT; \
		git status --short --untracked-files=all > "$$before"; \
		git diff --binary >> "$$before"; \
		$(MAKE) generate; \
		git status --short --untracked-files=all > "$$after"; \
		git diff --binary >> "$$after"; \
		if ! cmp -s "$$before" "$$after"; then \
			git status --short --untracked-files=all; \
			git diff --stat; \
			git diff; \
			exit 1; \
		fi

test-sql:
	go run github.com/sqlc-dev/sqlc/cmd/sqlc@$(SQLC_VERSION) vet

test-all: check-codegen test-sql lint deadcode coverage

coverage:
	@mkdir -p $(COVER_DIR)
	go test -race -count=1 -p=$(GO_TEST_PARALLEL) -parallel=$(GO_TEST_PARALLEL) $(GO_PACKAGES) -coverprofile=$(COVER_RAW)
	@awk 'NR==1 || ($$0 !~ /cmd\// && $$0 !~ /internal\/graph\/generated.go/ && $$0 !~ /internal\/graph\/model\/models_gen.go/ && $$0 !~ /internal\/database\/dbgen\//)' $(COVER_RAW) > $(COVER_FILTERED)
	@total=$$(go tool cover -func=$(COVER_FILTERED) | awk '/^total:/ { sub(/%/, "", $$3); print $$3 }'); \
		printf 'total: %s%% (minimum: %.1f%%)\n' "$$total" $(COVER_MIN); \
		awk -v total="$$total" -v min="$(COVER_MIN)" 'BEGIN { exit !(total + 0 >= min + 0) }'
	@printf 'filtered profile: %s\n' $(COVER_FILTERED)

coverage-html: coverage
	go tool cover -html=$(COVER_FILTERED)

sync-web:
	rm -rf web/dist
	cp -r ../web/dist web/dist
	touch web/dist/.gitkeep
