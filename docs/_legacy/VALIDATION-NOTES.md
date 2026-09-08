# remember-api Validation Notes

This file records checks performed against the current MVP. Keep it factual: command, result, date, and any limitation.

## 2026-09-03 — Baseline code and Web layout

### Automated validation

| Check | Result | Notes |
|---|---|---|
| `pnpm typecheck` | Passed | All seven workspace packages passed. |
| `pnpm build` | Passed | API/packages built; Next production build completed. |
| `pnpm --filter @remember/web build` | Passed | Web app generated 15 routes. |

### Browser validation

| Route | Result | Notes |
|---|---|---|
| `/login` | Passed | Rendered centered Supabase login card at desktop width. |

### Completed implementation checks

- Web app shell now has responsive sidebar, topbar, constrained content width, and system dark-mode styling.
- Docs route exists in the Web console.
- Memory Web page supports create/edit/delete/pin/search/type filter/project filter.
- API has `POST /api/memories`.
- API chat path resolves request-level `remember.project`.
- Memory retrieval separates global preferences, global memories, and current Project memories.
- Memory Budget priority ordering now preserves pinned and higher-priority types.
- DeepSeek streaming requests ask for included usage.
- Mem0 bridge supports `PUT /memories/{id}`.

### Not yet validated

- `scripts/e2e.sh` was not run in this pass because it requires running API service, migrated Supabase database, seeded user, valid Supabase login credentials, and seeded API key.
- `scripts/security-smoke.sh` was not run for the same environment reason.
- Cross-Harness demo has not yet been performed.
- Mem0 bridge was not live-tested in this pass.
- DeepSeek real streaming usage was not live-tested in this pass.

## Validation rules going forward

| Situation | Required check |
|---|---|
| Server/API change | `pnpm typecheck`, targeted API smoke, e2e when env is ready. |
| Web layout/page change | `pnpm --filter @remember/web build`, browser smoke at desktop and narrow width. |
| Memory isolation change | Add or run tests for global vs Project memory retrieval. |
| Auth change | Run `scripts/security-smoke.sh`. |
| Provider change | Test real provider error and success paths, stream and non-stream. |
