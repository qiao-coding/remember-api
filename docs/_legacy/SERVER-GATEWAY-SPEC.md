# remember-api Server Gateway Spec

**Purpose.** Server 端对外保持 OpenAI-compatible，对内执行 remember-api 的 stateful context pipeline。

> **Non-negotiable technical rule:** `/v1` 只接受 remember API Key；`/api` 只接受 Supabase JWT。两套凭据不能互换。

## Request pipeline

```text
HTTP request
→ auth
→ profile resolver
→ project resolver
→ memory retrieval
→ memory budget
→ context builder
→ provider call
→ OpenAI-compatible response
→ usage record
→ async memory write
```

## Endpoints

| Endpoint | Auth | Required behaviour |
|---|---|---|
| `GET /health` | public | 返回服务存活状态。 |
| `GET /v1/models` | API Key | 返回当前用户 Profiles，Profile name 作为 model id。 |
| `POST /v1/chat/completions` | API Key | 支持 stream / non-stream，调用 Profile 的 base model。 |
| `GET /api/auth/me` | Supabase JWT | 返回当前管理用户。 |
| `/api/profiles` | Supabase JWT | Profile CRUD。 |
| `/api/projects` | Supabase JWT | Project CRUD。 |
| `/api/memories` | Supabase JWT | Memory list/search/create/update/delete。 |
| `/api/skills` | Supabase JWT | Skill CRUD。 |
| `/api/keys` | Supabase JWT | remember API Key CRUD。 |
| `/api/providers` | Supabase JWT | Provider config CRUD。 |
| `/api/usage/*` | Supabase JWT | Summary、requests、breakdown。 |

## OpenAI-compatible chat contract

Request:

```json
{
  "model": "remember-dev",
  "messages": [{ "role": "user", "content": "继续刚才的工作" }],
  "stream": false,
  "remember": {
    "memory": true,
    "memoryBudget": 1500,
    "project": "remember-api"
  }
}
```

Response must include:

- `id`
- `object`
- `created`
- `model`
- `choices`
- `usage.prompt_tokens`
- `usage.completion_tokens`
- `usage.total_tokens`
- `usage.prompt_tokens_details.cached_tokens`

Streaming response must be SSE:

```text
data: {...}

data: [DONE]
```

## Profile resolver

`model` is interpreted as Profile `name`.

| Field | Meaning |
|---|---|
| `provider` | V1: `deepseek` |
| `model` | base model, for example `deepseek-chat` |
| `projectId` | default project context |
| `systemPrompt` | profile-specific system text |
| `memoryEnabled` | default memory switch |
| `memoryBudget` | max memory tokens per request |
| `skillIds` | skills injected into context |
| `temperature/maxTokens` | default provider request params |

Request-level `remember.project` may override the Profile default. It can resolve by Project id or name and must belong to the current user.

## Memory retrieval

| Step | Required behaviour |
|---|---|
| Preferences | Search pinned global preference memories only. |
| Global memories | Search global memories related to the last user message. |
| Project memories | Search only the resolved current Project. |
| De-duplication | Remove duplicate memory ids before budget allocation. |
| Budget | Apply Memory Budget before Context Builder. |
| Isolation | Never retrieve unrelated project memory for a project-scoped request. |

## Context Builder

Final messages start with one generated system message:

```text
[Profile]
...

[User Preferences]
...

[Project]
...

[Relevant Memory]
...

[Skills]
...
```

Then append the original harness messages unchanged.

The builder must return token breakdown:

- profileTokens
- preferenceTokens
- projectTokens
- memoryTokens
- skillTokens
- messageTokens

## Memory write

V1 writes asynchronously after provider response. It may skip a turn. It should capture:

- explicit user preference
- architecture/technical decision
- task completion/status
- failed attempt/known issue

It must search for similar memory before creating a new one. It should not block the model response.

## Usage tracking

Every successful provider call should insert one `request_usage` row:

| Field | Meaning |
|---|---|
| inputTokens | Provider prompt tokens |
| outputTokens | Provider completion tokens |
| cachedTokens | Provider cached prompt tokens |
| memoryTokens | Estimated injected memory tokens |
| skillTokens | Estimated injected skill tokens |
| latencyMs | Provider call duration |
| estimatedCost | Cost estimate using configured rates |

## Required verification

| Layer | Automated check | Manual check |
|---|---|---|
| Type safety | `pnpm typecheck` | No package type errors. |
| Build | `pnpm build` | Web and API production bundles complete. |
| Gateway | `scripts/e2e.sh` | non-stream, stream, usage, memory loop work. |
| Security | `scripts/security-smoke.sh` | credential boundaries are enforced. |
| Web | Browser smoke | Login and dashboard routes render without broken layout. |

## Definition of done

Server V1 is complete when a valid `rma_` key can call `/v1/chat/completions`, the request resolves a Profile and Project, injects only allowed context within budget, streams or returns a DeepSeek response, records usage, and writes useful memory without blocking the client.
