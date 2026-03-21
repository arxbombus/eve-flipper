# Suggested Commands (Darwin/macOS)

## Setup
- `npm -C frontend install`
- `npm -C frontend run build`

## Run App
- `go run .`
- `make run`

## Build
- `make build`
- `go build -o build/eve-flipper .`

## Frontend Dev
- `npm -C frontend run dev`

## Test & Quality
- `go test ./...`
- `make test`
- `go vet ./...`
- `gofmt -w <files>`

## Desktop Variant
- `make wails`
- `make wails-run`

## Release/Cross Build
- `make cross`

## Useful Local Utilities
- `git status`, `git diff`, `git log --oneline -n 20`
- `ls`, `cd`, `pwd`
- `rg <pattern> <path>`
