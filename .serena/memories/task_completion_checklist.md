# Task Completion Checklist

Before finishing a change:
1. Run backend tests: `go test ./...` (or at least targeted package tests).
2. If backend behavior changed, run `go vet ./...` and ensure formatting with `gofmt`.
3. If frontend touched, run `npm -C frontend run build`.
4. For integrated feature changes, run app locally (`go run .` or `make run`) and verify affected workflow.
5. Keep commits focused and include concise change rationale.
6. If change impacts feature usage, update docs/wiki mirror references as needed.

Notes:
- Optional SSO-dependent features require local `.env` credentials.
- Default bind should remain localhost-safe unless intentionally changed.
