# Claude Code Kickoff — remember-api MVP

## Assignment

You are taking over the production implementation of remember-api. Your first milestone is to finish the **usable V1 Stateful API**: a Web control plane plus an OpenAI-compatible Server gateway that lets multiple AI clients share one user-owned memory context.

> **Core product invariant:** `BASE_URL / API_KEY / MODEL` is the whole client integration story. Everything else belongs inside remember-api.

## Read Before Editing

Read these files in order before changing code:

1. [`docs/PRODUCT-DIRECTION.md`](./PRODUCT-DIRECTION.md)
2. [`docs/V1-STATEFUL-API.md`](./V1-STATEFUL-API.md)
3. [`docs/SERVER-GATEWAY-SPEC.md`](./SERVER-GATEWAY-SPEC.md)
4. [`docs/WEB-CONSOLE-UX.md`](./WEB-CONSOLE-UX.md)
5. [`docs/CLAUDE_CODE_HANDOFF_REMEMBER_API.md`](./CLAUDE_CODE_HANDOFF_REMEMBER_API.md)
6. `apps/api/src/services/chat.ts`
7. `packages/core/src/context-builder.ts`
8. `packages/memory/src/`
9. `apps/web/app/(app)/`

## First milestone scope

Implement Phase 0 through Phase 3 from the handoff. Do not begin team workspace, automatic project detection, `/v1/responses`, intelligent model routing, Memory ROI, or complex merge review until the V1 Web + Gateway loop is reliable.

| Workstream | Required output |
|---|---|
| Gateway | Stable `/v1/models` and `/v1/chat/completions` with stream/non-stream, request-level remember controls, and OpenAI-compatible errors. |
| Context | Correct Profile/Project/Memory/Skill injection with budget and token breakdown. |
| Memory | DB fallback plus Mem0 bridge; Memory CRUD works from Web and API. |
| Usage | Every successful request records token/cost/latency. Dashboard and Usage read from the same API data. |
| Web shell | Responsive sidebar/topbar layout with pages for Dashboard, Profiles, Projects, Memories, Skills, Usage, API Keys, Providers, Docs, Settings. |
| Web CRUD | User can create enough resources to connect a real client without touching SQL manually. |
| Docs | Quick Start and acceptance checklists remain current with code. |

## Non-negotiable technical rules

1. Do not add an autonomous Agent loop to remember-api.
2. Do not let `/api` accept `rma_` keys.
3. Do not let `/v1` accept Supabase JWT as model API auth.
4. Do not return API Key hashes or Provider encrypted secrets to Web.
5. Do not inject memory from unrelated Projects.
6. Apply Memory Budget before Context Builder.
7. Preserve original harness messages after generated context.
8. Keep Provider and Memory integrations behind adapters.
9. Do not expose unimplemented provider choices as working Profile options.
10. Do not mark the cross-Harness demo complete without using two client configurations.

## Web acceptance criteria

The console should feel like a compact developer dashboard:

- Navigation works at desktop and mobile widths.
- Profile creation uses real controls for Project and Skill binding.
- Memory page supports create, edit, delete, pin, type filter, Project filter, and search.
- API Keys page shows full key only once.
- Providers page stores API keys without returning them in list responses.
- Usage page uses the same cost unit and fields as backend.
- Docs page gives the exact connection triplet: Base URL, API Key, Model.

## API acceptance criteria

- `GET /health` returns public service status.
- `GET /v1/models` lists only current user Profiles.
- `POST /v1/chat/completions` works with `stream: false`.
- `POST /v1/chat/completions` works with `stream: true`.
- Invalid API key returns OpenAI-compatible 401.
- Unknown Profile returns `model_not_found`.
- Unknown request-level Project returns `project_not_found`.
- Usage is recorded after provider success.
- Memory write failure does not break the model response.

## Required verification before reporting completion

Run and report:

```bash
pnpm typecheck
pnpm build
```

When environment variables and seed data are available, also run:

```bash
bash scripts/security-smoke.sh
bash scripts/e2e.sh
```

Manually verify:

- Login page renders.
- App shell navigation is usable.
- Memory CRUD can create and edit one global memory and one Project memory.
- `/v1/chat/completions` can be called with the generated API Key.

## Completion report format

Report: gateway behaviour, context/memory isolation, Web pages changed, docs changed, commands/tests run, manual browser checks, environment assumptions, remaining gaps, and recommended next phase. Do not claim deployment, multi-provider support, automatic project detection, or cross-Harness validation unless they are actually completed and verified.
