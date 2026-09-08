# Claude Code Handoff — remember-api Stateful API MVP

## Mission

Complete remember-api as a usable OpenAI-compatible Stateful Personal AI API. The first production milestone must let a user manage API Keys, Profiles, Projects, Memories, Skills, Providers, and Usage from the Web console, then connect at least two AI clients to the same Profile and shared memory state.

> **Non-negotiable product rule:** remember-api must not become an Agent harness. It injects personal/project context and records memory; Claude Code, Codex, Cursor, and other clients remain responsible for planning, tool use, code editing, and task execution.

## Reference documents

| Reference | Role |
|---|---|
| [`PRODUCT-DIRECTION.md`](./PRODUCT-DIRECTION.md) | Product invariants, locked nouns, deliberate refusals. |
| [`V1-STATEFUL-API.md`](./V1-STATEFUL-API.md) | V1 product scope and definition of done. |
| [`WEB-CONSOLE-UX.md`](./WEB-CONSOLE-UX.md) | Web information architecture, flows, responsive behaviour. |
| [`SERVER-GATEWAY-SPEC.md`](./SERVER-GATEWAY-SPEC.md) | API pipeline, endpoint contracts, context and memory rules. |
| [`quick-start.md`](./quick-start.md) | Local setup and client connection basics. |
| [`acceptance-checklist.md`](./acceptance-checklist.md) | Compact checkboxes for release readiness. |

## Decisions that must remain intact

| Decision | Production interpretation |
|---|---|
| **Profile is model** | Client `model` maps to Profile name; `/v1/models` lists Profiles. |
| **Project is boundary** | Project memory is isolated by user and project. Global memory is separate. |
| **Harness executes** | Do not add planner/tool loop/autonomous workflow into remember-api. |
| **Memory visible by default** | All persisted memory must be manageable in Web. |
| **Budget before injection** | Context Builder receives already-trimmed memories. |
| **Provider adapter boundary** | API/Web depend on `ModelProvider`, not DeepSeek internals. |
| **Memory adapter boundary** | API/Web depend on `MemoryProvider`, not Mem0/Hermes internals. |
| **Usage is product surface** | Token and cost accounting is not just logs; it appears in Dashboard/Usage. |

## Prototype currently in the repository

The current repository already includes a monorepo MVP:

| Area | Existing implementation |
|---|---|
| API | Fastify app with `/health`, `/v1/models`, `/v1/chat/completions`, `/api/*`. |
| Auth | API Key hook for `/v1`; Supabase JWT hook for `/api`. |
| Context | Context Builder with Profile/Preferences/Project/Relevant Memory/Skills sections. |
| Memory | DB fallback and Mem0 bridge implementation. |
| Provider | DeepSeek provider and MockProvider fallback. |
| Database | Drizzle PostgreSQL schema, migrations, seed. |
| Web | Responsive app shell and core management pages. |
| Docs | Loquar-style requirement organization added in `docs/`. |

## Delivery sequence

Implement in the following order. Each phase should leave `/v1` and Web usable.

### Phase 0 — Stabilize the baseline

Confirm the repo builds, typechecks, migrates, and seeds against a known Supabase user. Make `.env.example`, `apps/api/.env`, and `apps/web/.env.local` naming consistent. Ensure the Web app can reach Fastify through rewrites.

Do not start feature work until:

- `pnpm typecheck` passes.
- `pnpm build` passes.
- `/health` responds.
- `/v1/models` works with a seeded `rma_` key.

### Phase 1 — Harden the gateway

Make `/v1/chat/completions` reliable enough for coding Harnesses:

- Validate OpenAI request shape without rejecting common client fields unnecessarily.
- Preserve harness messages after generated system context.
- Return OpenAI-compatible errors.
- Request streaming usage from DeepSeek.
- Record usage for stream and non-stream paths.
- Support request-level `remember.project`, `remember.memory`, `remember.memoryBudget`.

### Phase 2 — Finish context correctness

Guarantee context injection is useful and isolated:

- Global pinned preferences load into L0.
- Current Project summary/architecture/status/decisions/known issues load into L1.
- Global and current Project memories are searched separately.
- No unrelated Project memory enters the prompt.
- Memory Budget ordering preserves pinned and higher-priority memory.
- Skill content is injected after memories.

### Phase 3 — Complete the Web control plane

Make Web configuration self-serve:

- Profiles: Provider/base model/project/system prompt/memory budget/skills/default params.
- Projects: summary, architecture, status, decisions, known issues.
- Memories: create, search, edit, delete, pin, project/type filters.
- API Keys: create once, mask, disable, delete, last used.
- Providers: DeepSeek key/base URL/default model, connection test.
- Usage: summary, recent requests, profile/project breakdown.
- Docs: quick connection card.

### Phase 4 — Close the memory loop

Improve automatic memory write without making it expensive:

- Keep heuristic writes for explicit preferences and status.
- Add structured extraction only if it can be cheap and bounded.
- Implement update/merge behaviour for similar memories.
- Surface source and updated time in Web.
- Add project summary/status update workflow after important tasks.

### Phase 5 — Make cost observable

Turn usage into a product surface:

- Daily token trend.
- Cost trend.
- Memory overhead trend.
- Cached token ratio.
- Request detail view.
- Provider pricing config.

### Phase 6 — Cross-Harness demo

Build a reproducible demo:

1. Harness A uses `remember-dev`.
2. Harness A completes a small project task and records a decision/status.
3. Web shows the resulting Memory and Usage.
4. Harness B uses the same Base URL, API Key, and Model.
5. Harness B receives enough context to continue.

### Phase 7 — Deployment hardening

Only after the demo works:

- Add Docker/deploy docs.
- Restrict CORS.
- Add rate limiting.
- Rotate default secrets.
- Add CI checks.
- Document Mem0 bridge deployment and model cache requirements.

## Required verification

| Layer | Automated check | Manual check |
|---|---|---|
| TypeScript | `pnpm typecheck` | No TS errors across workspace. |
| Build | `pnpm build` | API and Web production builds complete. |
| Gateway | `bash scripts/e2e.sh` | Client can call stream and non-stream. |
| Security | `bash scripts/security-smoke.sh` | Credential classes cannot cross boundaries. |
| Web | Browser smoke at desktop/mobile widths | Layout, navigation, forms, tables remain usable. |
| Memory | Seed + chat + memories list | New memory is visible and editable. |

## Definition of done for the first production milestone

The first production milestone is complete only when a user can configure the system entirely through Web, call remember-api from an OpenAI-compatible client, see memory and usage appear in the console, correct that memory manually, and then switch to a second client that continues with the same Project context.
