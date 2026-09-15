# remember-api

English | [简体中文](README.zh-CN.md)

**A personal AI gateway you run yourself.**

Website: <https://remember-api.cn>

remember-api puts your identity, preferences, project memory, and model routing behind an OpenAI-compatible API. Codex, Claude Code, Cursor, Cherry Studio, Open WebUI, and other clients can connect to the same personal state layer instead of each keeping an isolated memory.

Your memory belongs to you. Models are interchangeable compute providers.

![remember-api overview](docs/assets/remember-api-overview.svg)

## What it is

One sentence: **switch tools without losing memory; switch models without re-explaining your projects.**

- **OpenAI-compatible gateway** — exposes `/v1/models` and `/v1/chat/completions`; clients only need a Base URL, an API Key, and a Model.
- **Profile-as-Model** — the client `model` is a remember-api Profile, not necessarily a vendor model id. The Profile decides provider, upstream model, system prompt, and memory budget.
- **API Key isolation** — each API Key is bound to one Profile, so multiple personal models do not leak into each other.
- **Project-scoped memory** — long-term preferences can be reused while project context stays bounded.
- **Observable memory cost** — Memory Budget controls how much memory is injected per request, and usage records memory tokens, latency, and estimated cost.
- **Provider-independent routing** — upstream credentials and provider configuration are separated from client configuration.
- **Swappable memory backend** — the built-in DB memory provider works by default; Mem0 bridge can be enabled when needed.

![profile as model](docs/assets/profile-as-model.svg)

remember-api is **not** another chat app, not plain RAG, and not just a memory SDK. It is the portable personal-state layer between AI clients and model providers.

## Public API surface

The runtime product surface is intentionally small:

| Endpoint | Purpose | Auth |
| --- | --- | --- |
| `/v1/*` | OpenAI-compatible gateway | Bearer API Key |
| `/health` | Static health check | None |

The old management `/api` surface and Web console have been removed.

Client configuration uses three values:

| Field | Meaning |
| --- | --- |
| Base URL | Your remember-api instance, ending in `/v1` |
| API Key | A key bound to one Profile |
| Model | A Profile name; the default seeded name is `default` |

Claude Code speaks Anthropic protocol natively, so it cannot connect directly to this OpenAI-compatible `/v1/chat/completions` endpoint. To share remember-api memory with Claude Code, put an Anthropic → OpenAI translation layer in front of it.

## License

[MIT](LICENSE)
