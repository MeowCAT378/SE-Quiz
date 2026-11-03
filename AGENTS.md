# AGENTS.md

## Scope and source of truth

This file applies to the whole repository; no nested `AGENTS.md` files currently exist. **MUST** and **MUST NOT** mark required rules; **SHOULD** marks guidance.

Inspect tracked implementation and configuration before changing behavior. README and documents under `docs/superpowers/` describe setup or past plans, not authoritative current behavior. Do not infer current test results from `docs/auth-user-management-verification.md` or the dated `LLM_VERIFICATION.md` report.

## Project overview

**SE Quiz** is a self-hosted live quiz and classroom activity platform derived from Fuiz. Existing package names, Rust crates, wire types, and storage names retain Fuiz identifiers; preserve those compatibility identifiers.

The repository contains a SvelteKit application and a six-crate Rust workspace, not a JavaScript package workspace. Root `package.json` has no scripts and provides Playwright tooling. `website/package.json` is the application manifest; the Cloudflare counter has its own package manifest.

- Web: Svelte 5 runes, SvelteKit 2, strict TypeScript, Vite, Bun (manifest requires >=1.2.0), Inlang/Paraglide, Biome, ESLint, Vitest.
- Runtime: Rust 2024, Actix Web native services and Cloudflare Workers/Durable Objects targets.
- Persistence: PostgreSQL through `Bun.SQL`, filesystem blobs, account-scoped IndexedDB caches, optional Google Drive sync; D1/R2/KV adapters also exist.
- Root Compose defines **six** services: `nginx`, `web`, `game-server`, `corkboard`, `postgres`, and `pgadmin`. Nginx provides HTTP path routing; TLS termination is deployment-specific.

## Repository map

All paths in this table are relative to the repository root. Later `src/`, `scripts/`, and `messages/` references are relative to `website/` unless stated otherwise. Route names such as `/api/add` are logical application paths; public URLs prepend `BASE_PATH` (default `/SEQuiz` in Compose).

| Path | Responsibility |
| --- | --- |
| `website/src/hooks.server.ts` | Session resolution, provider composition, route policy, localization, private-response caching |
| `website/svelte.config.js`, `website/vite.config.ts`, `website/src/lib/navigation/basePath.ts` | Compiled application base, Paraglide URL patterns and logical-path normalization |
| `website/src/routes/[[lang=locale]]/` | Localized home, login/logout, create/edit, library, publish, host/play, reports, and administrator pages |
| `website/src/params/locale.ts` | Locale route matcher; the exact route directory is `[[lang=locale]]` |
| `website/src/routes/api/` | Private resources, accounts, AI, hosting, public discovery, OAuth, library publishing/sync |
| `website/src/routes/admin-api/` | Administrator aliases; inspect corresponding `api/admin/`, `api/quiz/`, and active-game routes before editing |
| `website/src/lib/server/` | Account, host-game, private-resource and LLM stores/guards; PostgreSQL and D1 implementations; bounded request parsing and LLM transport |
| `website/src/lib/db/`, `website/src/lib/blob/`, `website/src/lib/kv/` | Public-library database, payload/media blobs, shares and publish-job KV providers |
| `website/src/lib/ai/` | Keyword AI and optional structured activity generation, validation, LLM settings/capabilities, operation cancellation |
| `website/src/lib/admin/` | Administrator LLM settings UI and shared LLM dropdown; used by the localized `/admin/llm` page |
| `website/src/lib/git/`, `website/src/lib/scripts/` | GitLab integration and public-library synchronization |
| `website/src/lib/storage/` | Account-bound API persistence, IndexedDB cache, save queue, legacy import support, optional Drive sync |
| `website/src/lib/types.ts`, `website/src/lib/clientOnly.ts` | Serialized activity types, browser import/export, limits, ID/time conversion, game submission |
| `website/src/lib/question-types/` | Editor, preview, host, player, shared components and linting per question type |
| `website/src/lib/ui/`, `website/src/lib/layout/`, `website/src/lib/feedback/` | Shared controls, layout/header, dialogs and feedback |
| `website/src/schema.postgres.sql`, `website/src/schema.sql` | PostgreSQL and D1 schema sources |
| `website/scripts/` | Database setup/D1 provisioning, PostgreSQL smoke checks and locale validation |
| `website/messages/`, `website/project.inlang/settings.json` | Locale sources and Paraglide configuration |
| `website/tests/` | Vitest, PostgreSQL integration, isolated browser and HTTP/WebSocket acceptance harnesses |
| `game-backend/game/`, `game-backend/corkboard/` | Each contains `logic`, `server`, and `cloudflare` crates |
| `game-backend/game/cloudflare/counter/` | Separate Wrangler counter Worker package |
| `docker-compose.yml`, `website/Dockerfile`, `game-backend/Dockerfile` | Self-hosted service wiring and image builds |
| `docker/nginx/default.conf`, `docker/nginx/entrypoint.sh` | Nginx template, public endpoint allowlist and prefix validation before substitution |
| `.env.example`, `generate_config.sh` | Configuration template and non-overwriting POSIX environment generator |
| `playwright.config.ts`, `tests/example.spec.ts` | Root Playwright example configuration; tests target playwright.dev, not SE Quiz |

## Architecture and domain boundaries

### Application prefix and proxy routing

Compose uses `BASE_PATH` for the web build, Nginx template, web health check and private host callback. It defaults to `/SEQuiz`. Prefixes use `/`-separated ASCII letters, digits, `_` or `-`, with no empty segments or trailing slash. Nginx redirects the exact base to its trailing-slash URL with 308, retaining the query. Standalone SvelteKit tooling defaults to an empty base when `BASE_PATH` is absent; the auth/LLM fixtures explicitly build with `BASE_PATH=''`.

Use the existing `$app/paths` `base`/`resolve` and localization helpers for navigation, assets, fetches, redirects and generated links. `stripBase()` removes the deployed prefix when classifying logical routes or checking signed service paths. Preserve exact prefix boundaries, safe login/OAuth return URLs, account/session binding and same-origin checks; `ORIGIN` remains an origin without a path.

Nginx forwards the full base path to `web:3000`, including `/api/` and `/admin-api/`. It strips only the public `/backend` or `/media` prefix for the native services. The browser allowlist is GET `/backend/alive/{code}`, GET/WebSocket `/backend/watch/{code}/{watcher}`, POST `/media/upload`, and GET `/media/get/{id}`, all below `BASE_PATH`. Keep runtime `/add`, `/internal/host/*`, corkboard `/thumbnail`, and web `/api/host/authorize` and `/api/host/completed` callbacks internal. Preserve WebSocket upgrades, upload limits and unbuffered streaming.

For hostname, prefix, TLS or proxy changes, read [docs/NGINX.md](docs/NGINX.md), inspect the template and its callers, and use the isolated Nginx harness below. Changing the prefix requires a web rebuild and Nginx/game-server recreation. `NGINX_ENVSUBST_FILTER` deliberately substitutes only `BASE_PATH`, preserving Nginx request variables; retain validation before rendering and LF endings for its shell entrypoint.

### Request and authorization flow

`src/hooks.server.ts` verifies `admin_session`, reloads an active account from the selected account store, and compares `session_version`. It populates `locals.user`, `locals.session`, and the ADMIN-only compatibility flag `locals.isAdmin`. Account-store failures **MUST** fail closed; a valid signature alone does not authorize a request.

The hook supplies optional database, blob, share-KV and publish-job-KV services. Factories honor explicit provider settings, otherwise use available Cloudflare bindings or self-hosted providers. Activity AI and lazy publication keyword AI load the active saved LLM configuration through `server/llmService.ts`; neither is supplied through `locals`. Endpoints **MUST** check unavailable services before using them.

`src/lib/server/authPolicy.ts` classifies delocalized routes after base removal. Protected pages redirect to login; APIs reject unauthenticated requests. `guards.ts` provides `requireUser`, `requireAdmin`, and exact `requireSameOrigin` checks. Some routes, including AI and internal host authorization, enforce their own guards; adding a route requires checking both policy and handler. Nonlocalized routes reject localized aliases.

| Actor | Effective access |
| --- | --- |
| Anonymous participant | Public home/library discovery, joining/playing, and public share reads; no authoring or host-management access |
| `TEACHER` | Authenticated authoring, hosting, reports and publishing, subject to ownership checks |
| `ADMIN` | User administration, imports, administrator library mutations and shared LLM configuration, plus normal authenticated workflows; private ownership checks still apply |

`admins` is the historical table name for **both roles**. Account IDs are immutable UUIDs; normalized email is reserved even after soft deletion. `deleted_at` disables an account; there is no separate enabled flag. Updates/deletion increment `session_version`. Preserve last-active-ADMIN protection and the ban on physical account deletion.

`auth.ts` uses an HMAC-SHA256 signed, HTTP-only, same-site-lax cookie with seven-day lifetime and HTTPS-dependent `secure`. Preserve constant-time signature comparison, purpose, expiry, future-time and version checks. `password.ts` handles PBKDF2; `accounts.ts` validates account inputs and coordinates persisted login throttling. Never return password hashes or session versions in public account data.

Logout is the same-origin POST action in `src/routes/[[lang=locale]]/logout/+page.server.ts`: revoke sessions, notify the game runtime and clear session/OAuth cookies. Preserve failure reporting and the administrator alias. GET navigation is not a substitute for logout.

### Persistence and ownership

Keep these boundaries separate:

- **Private creations/reports/media:** `privateRoutes.ts`, `privateValidation.ts`, `privateResources.ts` and PostgreSQL/D1 implementations authorize the actor and owner. `host_resources` holds versioned `creation` and `report` JSON. `host_media` records private blob ownership. Writes/deletes use expected versions; preserve conflict handling and exact retry semantics.
- **Browser cache:** `storage/index.ts` persists through `/api/creations`, `/api/reports`, and `/api/host/media/`. `storage/local.ts` opens `SEOpen-${accountId}` version 1. IndexedDB is an account cache, not the authoritative private store. `storage/account.ts` verifies identity before/after requests, sends account/session headers and closes bindings on account changes. A failed list request must not erase the cache or appear as a successful empty list.
- **Legacy data:** unowned `FuizDB` and legacy Google Drive records are not automatically assigned to the current user. Keep explicit administrator imports, provenance and deduplication in `host_imports`; preserve legacy bytes and ownership boundaries.
- **Public library:** `db/` indexes `fuizzes`, `blob/` holds payloads, and `active_games` supports public discovery. These are not proof of private resource/game ownership. KV namespaces `kv_share` and `kv_publish_jobs` isolate shares and publishing jobs.
- **Optional Drive:** account-bound synchronization supplements private server persistence. Preserve managed namespaces, owner validation and sync-warning behavior; do not turn a failed optional sync into a false server-save failure.
- **Activity LLM configuration:** `llm_configurations`, `llm_state` and `llm_audit` hold system-wide provider settings, active selection and administrator change history. These are separate from private creations; preserve version conflicts, encrypted credentials and atomic audit writes in both PostgreSQL and D1.

Stored creation/report records use `uniqueId` and `versionId`; local numeric IDs are cache aliases. Reports snapshot questions/results/responses and may link to creation/version and verified `gameInstanceId`. Do not fabricate missing historical linkage or answers. Preserve formula-injection sanitization in spreadsheet exports.

### Real-time hosting

`clientOnly.ts` strips editor IDs and converts configured seconds to milliseconds. Browser game creation goes through `/api/add`, which verifies the user and optional creation ownership, signs a short-lived `create-game` grant and calls the private runtime `/add`. Ownership is recorded in `host_games`; failure to record triggers runtime cleanup.

Host/player sockets use `PUBLIC_WS_URL/watch/{code}/{watcherId}`. Hosts additionally obtain scoped `host-game` authorization through `/api/host/games/[code]/authorization`; Rust validates grants and checks current authorization through `/api/host/authorize`. `hostAuthorization.ts` and `hostRuntime.ts` implement shared-secret grants and signed service notifications. A game code or watcher ID alone never grants host privileges. Public active-game discovery exposes separately computed `ownedGameCodes` for management UI.

Protocol types/handlers live in both `src/routes/[[lang=locale]]/host/` and `src/routes/[[lang=locale]]/play/`; `Host.svelte` and `Play.svelte` dispatch messages. Protocol changes **MUST** update affected Rust logic/native/Worker transports, both web contracts/handlers/components, and `tests/messageDispatch.test.ts`.

### Activity types and editor lifecycle

Wire discriminators in `types.ts` are `MultipleChoice`, `TypeAnswer`, `Slider`, `Pin`, `Order`, `Poll`, `Scale`, `FreeText`, `Brainstorm`, and `InfoSlide`. `FreeText` modes include `WordCloud` and `OpenEnded`. True/false is represented through `MultipleChoice`, not a new wire type. Preserve PascalCase discriminators and snake_case fields shared with Rust.

Question changes require checking `create/slideTemplates.ts`, `question-types/lint.ts`, `lintMessages.ts`, all affected editor/preview/host/player modes, localization, serialization and protocol consumers. Reuse existing templates and `clientOnly.ts` limits.

`create/Editor.svelte` uses a 500-ms save queue and `SaveState` values `unsaved`, `saving`, `saved`, `error`. Preserve `storage/saveQueue.ts`, `saveNavigation.ts`, retry feedback and server acknowledgement before declaring a save successful.

### Public-library publishing

Git-backed publication uses GitLab OAuth, `api/library/publish-init`, streaming publish progress, a branch/merge request, and protected synchronization after merge. `src/lib/scripts/syncLibrary.ts` updates the public cache. Administrator publish/delete routes provide separate direct mutations. Inspect aliases before changing either flow; runtime GitLab merge requests are not this repository's contributor workflow.

OAuth state is one-time; preserve callback state validation, account binding where implemented, cookie cleanup and secure OAuth cookies. Plain-HTTP OAuth is not a verified workflow. Webhooks validate `X-Gitlab-Token`; manual sync validates a bearer token against `GIT_WEBHOOK_SECRET` with timing-safe comparison.

## AI/LLM integration

Both AI workflows use the same ADMIN-selected database configuration:

| Workflow | Implementation and settings |
| --- | --- |
| Library keyword generation | Lazy `createAI(event)` in `ai/factory.ts` loads the active snapshot through `server/llmService.ts`, reuses its structured provider and concurrency limits, and omits optional keywords when AI is unavailable; `AI_PROVIDER`, `OPENAI_*`, `AI_MODEL` and Cloudflare AI bindings are no longer runtime sources |
| Editor activity drafts | `loadActivitySnapshot()` in `server/llmService.ts` loads the active, enabled database configuration managed by ADMIN at `/admin/llm`; `server/llmProviders.ts` supports `ollama`, `vllm`, `openai`, `gemini`, `claude` and `custom` |
| Legacy activity configuration import | `importLegacyLlm()` in `server/llmService.ts` accepts explicit `LLM_BASE_URL` and `LLM_MODEL`, optional `LLM_API_KEY`, and an absent or `openai-compatible` `LLM_PROVIDER`; `LLM_ENABLED=false` imports a disabled configuration. These values are never a runtime fallback |

Saved activity settings use `temperature`, `topP`, `maxOutputTokens`, `requestTimeoutSeconds`, `generationTimeoutSeconds`, `batchSize` and `maxConcurrentOperations`. Read validation bounds, defaults and provider/model restrictions in `ai/llmConfiguration.ts`; unsupported sampling fields must be `null`. `activityAvailable()` checks whether a usable configuration snapshot can be loaded, not live provider health. Missing, disabled or unreadable activity configuration must leave normal authoring/startup available. Do not hard-code a local model or silently substitute models; discover the served ID through the provider's `/models` endpoint when configuring it.

Legacy import also reads `LLM_TIMEOUT_MS`, `LLM_GENERATION_TIMEOUT_MS`, `LLM_MAX_OUTPUT_TOKENS`, `LLM_TEMPERATURE`, `LLM_TOP_P` and `LLM_BATCH_SIZE`, converting milliseconds to saved seconds. Read import defaults in `server/llmService.ts`; they can differ from defaults for a new configuration, and commented example values are not necessarily defaults. Import is an explicit, one-time ADMIN action before saved configurations are established; it does not activate the imported configuration. Editing legacy environment values does not update saved settings or disable an active configuration.

- **Administrator workflow:** the localized `/admin/llm` page uses `admin/LlmSettings.svelte` and `LlmDropdown.svelte`. GET `/api/admin/llm` lists settings; POST `/api/admin/llm/[action]` supports `save`, `select`, `delete`, `test`, `models`, `import` and `audit` through `server/llmManagement.ts`. Preserve ADMIN/session checks, exact same-origin checks, 32-KiB JSON limits, account/session binding and `no-store` responses. Saving, testing and activation are separate actions; model discovery returns at most 100 IDs and never selects a model automatically. Edits invalidate the UI's test result, and stale responses must not restore settings or credentials after an account change.
- **Persisted state:** `getLlmStore()` follows `DB_PROVIDER` and selects PostgreSQL or D1. The stores recheck current ADMIN authority and expected configuration/selection versions; stale writes return `configuration_conflict` (409). Configuration, selection and audit changes use atomic PostgreSQL transactions or D1 batches with `first-primary` sessions. An operation keeps one configuration snapshot across its batches; later operations observe saved changes, activation or disablement.
- **Deletion:** removal requires current configuration and selection versions. Both stores soft-delete the configuration, clear its encrypted key and retain audit history. Deleting the active configuration clears the selection without choosing a fallback; deleting an inactive configuration preserves the current selection. Keep confirmation, dirty-form protection and stale-write handling in the administrator UI.
- **Credentials:** Self-hosted web automatically persists a dedicated canonical-base64 32-byte AES-256-GCM key at `STORAGE_PATH/.llm-secrets/encryption.key` on first credential use. An existing `LLM_CONFIG_ENCRYPTION_KEY` bootstraps that file, which is authoritative thereafter; Worker deployments still require that secret. `server/llmSecret.ts` publishes the file atomically and rejects missing keys when encrypted credentials already exist. `server/llmCrypto.ts` binds ciphertext to the configuration ID; share the persistent key across web instances and back it up separately from the database. Never reuse the session-signing secret or return plaintext/ciphertext to the browser; public settings expose only `hasApiKey`. Preserve `keep`/`replace`/`remove` actions, require an explicit credential decision when changing a saved key's provider or endpoint, and retain the ability to disable an unreadable configuration while preserving its ciphertext.
- **Destinations and transport:** ADMIN approves exact API base URLs, including local/private services, by saving, testing or discovering models at `/admin/llm`; `LLM_ALLOWED_ENDPOINTS` is no longer read. Runtime generation uses only the active saved configuration. Preserve metadata/address rejection, base-path confinement, numeric DNS connection pinning with the original TLS identity on Bun/Node, redirect rejection and the 1-MiB response limit in `llmTransport.ts`/`llmTransportNode.ts`. Public services require HTTPS. Worker transport requires a reachable HTTPS destination; the deployment host's loopback/LAN is not a Worker endpoint. The encryption key remains a deployment secret. See `LLM_CONFIGURATION.md` for operator guidance.

- POST `/api/ai/activities` requires a current user, same origin, bounded JSON, UUID operation/creation IDs, and an owned existing creation. It rechecks access after generation and returns drafts without writing resources. Cancellation uses POST `/api/ai/activities/cancel`, scoped to operation and login identity.
- `activityGeneration.ts` defines 13 `ACTIVITY_TYPES`: `multiple_choice`, `true_false`, `short_answer`, `slider`, `ordering`, `pin_answer`, `poll`, `agreement_scale`, `nps`, `drop_pin`, `word_cloud`, `open_ended`, and `brainstorm`. `MAX_ACTIVITY_ITEMS=10` limits requests to 1–10 drafts; the dialog also respects remaining slide capacity. `InfoSlide` remains a manual editor template. Request languages are `auto`/`en`/`th`, with 2–4 choices where applicable and `easy`/`medium`/`hard`/`mixed` difficulty for scored activities. The dialog defaults to `auto` and mixed difficulty; auto mode requires an `en`/`th` fallback chosen from the UI locale.
- In auto mode, the first valid batch resolves a language from `CONTENT_LANGUAGES` in `contentLanguages.ts`, independently of the two enabled UI locales. The prompt gives an explicit language request in teacher instructions priority, then the language of the instructions, then the topic, then the fallback. Later batches reuse the resolved language. Responses include `resolvedLanguage` and, for auto true/false, localized `answerLabels` in True/False order; preserve these through draft review and slide conversion. Validation checks the language code and structure, not whether all generated text actually uses that language.
- `openai.ts` requests non-streaming chat completions with strict JSON schema for compatible providers; `server/llmProviders.ts` uses native Gemini `generateContent` and Claude `messages` requests. Provider schema subsets do not weaken application validation. Reject tool calls, truncated/empty responses, code fences and thinking markers. Parsing is strict `JSON.parse`, not markdown extraction or JSON repair. Validate exact fields, count, text limits, distinct items/choices, correct-answer indices and planned difficulty.
- Generation batches requests, allows at most two attempts per batch for retryable failures, and has per-call and overall deadlines. Preserve errors such as `ai_unavailable`, `ai_busy`, `provider_unavailable`, `invalid_response`, and `cancelled`; avoid leaking provider bodies or credentials.
- `activityOperations.ts` admits activity generation using the snapshot's `maxConcurrentOperations` (default 2) **per process**, plus one active operation per `accountId:sessionIssuedAt`. ADMIN test generations share this registry using the settings being tested. Busy requests are rejected rather than queued, and lowering the limit does not cancel existing operations. Cancellation remains in memory. This is not a distributed lock/queue; replicas and Worker isolates need deliberate coordination and operation routing.
- `create/AiActivityDialog.svelte` keeps editable drafts outside `config.slides`, cancels on closure/account changes, and ignores stale responses. Pin Answer and Drop Pin require a valid attached image; Pin Answer also requires a valid correct area before addition. Only **Add to Activity** calls `create/aiActivitySlides.ts`, revalidates, appends through existing templates, preserves the title and enters normal autosave. Human review remains necessary; structural validation does not establish factual correctness.

## Development commands

These commands are grounded in manifests, configuration or tracked harnesses. Their presence is **not** evidence that they passed on the current machine. Root npm tooling and the Bun application have separate lockfiles; no ORM/client-generation command exists.

| Working directory | Command | Purpose / prerequisite |
| --- | --- | --- |
| Repository root | `npm ci` | Install root Playwright tooling from `package-lock.json` |
| Repository root | `./generate_config.sh localhost` | POSIX shell, OpenSSL and explicit administrator seed inputs; refuses an existing `.env` |
| Repository root | `docker compose config --quiet` | Validate Compose without printing interpolated secrets |
| Repository root | `docker compose up --build -d` | Build application images/start all six services; valid environment required |
| Repository root | `docker compose exec nginx nginx -t` / `docker compose exec nginx nginx -s reload` | Validate rendered Nginx configuration / refresh upstream addresses after recreating services |
| Repository root | `docker compose up -d postgres` | Start internal PostgreSQL; no host port is published |
| Repository root | `docker compose up -d game-server corkboard` | Start native services; authenticated hosting also needs web authorization |
| `website/` | `bun install --frozen-lockfile` | Install application dependencies |
| `website/` | `bun run --bun dev --port 9300 --host 0.0.0.0` | Vite development server on Bun; explicitly supply environment and reachable services |
| `website/` | `bun run check` / `bun run check:watch` | SvelteKit sync and Svelte/TypeScript checks |
| `website/` | `bun run lint` | Biome format check, Biome check, then ESLint |
| `website/` | `bun run format` / `bun run lint:fix` | Mutating formatter/fix commands; keep unrelated files untouched |
| `website/` | `bun run lang` | Key parity/order, untranslated and unused-message checks |
| `website/` | `bun run test` / `bun run test:watch` | Vitest; targeted files can be passed to `bun run test -- <test-path>` |
| `website/` | `bun run test:postgres` | Disposable `TEST_DATABASE_URL`; includes accounts, host games and private resources |
| `website/` | `bun run db:setup` | Mutating PostgreSQL upgrade/schema/seed operation, also run by web container startup |
| `website/` | `bun run db:seed:users` | Explicit development-account seeder; requires the intended PostgreSQL target and preserves existing matching accounts |
| `website/` | `bun scripts/provision-d1-accounts.ts <database-name> [--remote]` | Explicit maintenance provisioning; defaults local, remote must be deliberate |
| `website/` | `bun run build` / `bun run preview` | Production build / Vite preview; adapter defaults to Cloudflare |
| `game-backend/` | `cargo build` / `cargo test --workspace` | Build/test the Rust workspace |
| `game-backend/` | `cargo run -p fuiz-server` / `cargo run -p corkboard-server` | Native runtime services with configured environment |
| `game-backend/` | `cargo fmt --all -- --check` / `cargo clippy --workspace --all-targets -- -D warnings` | Rust formatting and lint checks |
| `game-backend/game/cloudflare/counter/` | `npm run dev` / `npm run deploy` / `npm run cf-typegen` | Counter's Wrangler scripts; deployment needs the intended account |

For a self-hosted web build, select `ADAPTER=node` and the intended `BASE_PATH` before `bun run build` (PowerShell: `$env:ADAPTER='node'; $env:BASE_PATH='/SEQuiz'`). Docker already selects the adapter and supplies the prefix; output is `website/build/`, run with Bun because PostgreSQL uses `Bun.SQL`. Default Cloudflare output is `.svelte-kit/cloudflare/`. Use Node.js 24 or later for the documented web/acceptance tooling; the root and website dependencies have separate engine requirements.

### Additional verification harnesses

- For proxy routing, use `website/tests/nginx.compose.yml` with `--env-file .env.example -p seopen-nginx-acceptance`. It exposes only Nginx on `127.0.0.1:9399` and uses synthetic credentials, tmpfs and no named volumes. `node website/tests/nginx.acceptance.mjs` covers pages/locales/assets, login/POST logout, saving, media, authorization, share/join links and host/player WebSockets. Set the same `BASE_PATH` for every build, Compose and browser command; verify the default and a custom prefix separately using [docs/NGINX.md](docs/NGINX.md). `BROWSER_EXECUTABLE` overrides Windows Chrome. `node website/tests/nginxConfig.smoke.mjs` checks prefix validation, generator URLs/custom ports and no-overwrite behavior with temporary synthetic files; it needs installed website dependencies and POSIX sh/OpenSSL.
- From root, `docker compose -p seopen-auth-task7 -f website/tests/auth.compose.yml config --quiet` validates the disposable acceptance fixture. `up --build -d` with the same project/file starts it; `node website/tests/auth.acceptance.mjs` uses Node 24 and fixed loopback web/runtime ports 9397/9897. It mutates synthetic data and must never target live services. The fixture uses temporary storage and has no corkboard service despite a configured corkboard URL.
- From `website/`, start `node node_modules/vite/bin/vite.js --config tests/browser.vite.config.ts`, then run `node tests/accountStorage.browser.mjs`. This is an isolated mocked-API component/IndexedDB harness on 9396, not full-stack acceptance. `BROWSER_EXECUTABLE` overrides its Windows Chrome default; `BROWSER_TEST_URL` selects the harness URL.
- The LLM fixture is `website/tests/llm.compose.yml`: from root, `docker compose -p seopen-llm-browser -f website/tests/llm.compose.yml up --build -d` starts it. Browser scripts are `node website/tests/llm.browser.mjs`, `node website/tests/llmAuthoring.browser.mjs` and `node website/tests/llmAvailability.browser.mjs`; `node website/tests/llmConcurrency.acceptance.mjs` checks concurrent requests. Authoring requires an enabled, active fixture configuration. The admin browser script exercises `LlmDropdown.svelte` with pointer/keyboard input, provider logos, focus return, viewport bounds, English desktop/tablet/mobile and configured additional mobile locales (currently Thai; Arabic cases are skipped). It covers save/test/reset/discard/activation, deletion and version conflicts; screenshots and results are written under timestamped `test-results/llm/browser-*` directories. These root-path fixtures build with `BASE_PATH=''`, mutate synthetic data at fixed loopback web/provider ports 9398/11435, and use a mock provider and temporary storage. Inspect browser executable assumptions and never target application data.
- From `website/`, `bun tests/llm.postgres.integration.ts` requires a separate disposable `TEST_DATABASE_URL` at `127.0.0.1:55439`; it is not included in `bun run test:postgres`. LLM Vitest suites cover configuration, credentials, routes, providers, transport and runtime; `tests/llmStore.test.ts` uses real local Miniflare D1. These checks do not certify live provider quality, throughput or deployed Cloudflare behavior.
- `bun tests/config.smoke.ts` tests synthetic environment quoting with POSIX shell/OpenSSL, Docker and a built `se-quiz-web:local` image. `tests/auth.smoke.ts` is a legacy live-stack harness that assumes unprefixed `/admin/login` and root URLs; it is not suitable for the default Nginx deployment. Prefer the isolated Nginx acceptance harness for prefixed authentication and inspect mutations/targets before running any live-stack script.
- Native and Worker transport harnesses are `game-backend/game/server/tests/host_transport.py` and `game-backend/game/cloudflare/tests/host_transport.mjs`; inspect their build/runtime prerequisites before use.
- Root `npx playwright test` runs the external example suite only. Do not cite it as application E2E coverage.

## Environment and database workflow

`.env.example` is the root template for a **new** private `.env`; replace placeholders before use. The generator creates core service/seed/CORS settings with `BASE_PATH` and `NGINX_PORT`, but emits HTTP/WS URLs and omits pgAdmin settings; consult the example for pgAdmin and the routing guide for HTTPS. New self-hosted AI settings are managed through the administrator UI, not an activity `LLM_*` environment block. Preserve existing environment files.

Compose loads root `.env`; native development from `website/` needs the relevant variables explicitly loaded/exported. Root Compose environment loading does not imply Vite/Bun in a subdirectory receives it.

| Group | Current variable names / behavior |
| --- | --- |
| Public routing | `BASE_PATH` is compiled into web and rendered into Nginx; `PUBLIC_PLAY_URL`, `PUBLIC_BACKEND_URL`, `PUBLIC_WS_URL`, `PUBLIC_CORKBOARD_URL`, `PUBLIC_SELF_HOSTED` are runtime browser settings. `PUBLIC_DISPLAY_PLAY_URL` remains in templates but has no application caller |
| Compose/origin | `NGINX_PORT` publishes the HTTP proxy (default 80); `ORIGIN` is the external origin without a path. `WEB_PORT`/`GAME_SERVER_PORT` no longer control published ports. `FUIZ_DOMAIN` is generator metadata, not a runtime hostname resolver |
| CORS/native bind | `FUIZ_ALLOWED_ORIGINS`, `CORKBOARD_ALLOWED_ORIGINS` are JSON arrays; `FUIZ_HOSTNAME`, `FUIZ_PORT`, `CORKBOARD_HOSTNAME`, `CORKBOARD_PORT` configure native listeners |
| Database/KV | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, private `DATABASE_URL`, `DB_PROVIDER` (`postgres`/`d1`), `KV_PROVIDER` (`postgres`/`cloudflare`) |
| Blobs/media | `STORAGE_PROVIDER` (`filesystem`/`r2`), `STORAGE_PATH`, `CORKBOARD_STORAGE_DIR`, private `CORKBOARD_INTERNAL_URL` |
| Accounts/hosting | `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD`, `ADMIN_SESSION_SECRET`, `SEED_DEMO_GAMES`, `GAME_SERVER_INTERNAL_URL`, `HOST_AUTHORIZATION_URL` |
| pgAdmin | `SEOPEN_PGADMIN_EMAIL`, `SEOPEN_PGADMIN_PASSWORD` initialize pgAdmin credentials; access uses Nginx `/pgadmin/` |
| Optional OAuth/Git | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_GOOGLE_REDIRECT_URI`; `GIT_PROVIDER`, `GIT_REPO_OWNER`, `GIT_REPO_NAME`, `GIT_DEFAULT_BRANCH`, `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET`, `GITLAB_REDIRECT_URI`, `GIT_WEBHOOK_SECRET`, `GIT_BOT_TOKEN` |
| LLM infrastructure | Self-hosted encryption key is managed automatically in persistent `STORAGE_PATH`; legacy private `LLM_CONFIG_ENCRYPTION_KEY` bootstraps it (still required on Workers). Both AI workflows use `/admin/llm`. `LLM_ALLOWED_ENDPOINTS`, `AI_PROVIDER`, `OPENAI_*` and `AI_MODEL` are ignored. Legacy `LLM_*` values above are explicit import inputs only |
| AI/testing/build | AI settings above; disposable `TEST_DATABASE_URL`; `ADAPTER`; browser harness variables above |

Keep `ORIGIN`, `PUBLIC_PLAY_URL` and both CORS entries origin-only. Join/share/canonical URLs combine `PUBLIC_PLAY_URL` with resolved, localized paths; the retained `PUBLIC_DISPLAY_PLAY_URL` setting does not control them. Backend/media/WebSocket URLs contain the base and their service suffix; HTTPS deployments use `wss://` sockets. The new template references `${BASE_PATH}` in browser service URLs; existing literal URLs or generator output must be aligned manually when changing the prefix. Compose fixes private URLs to `http://game-server:8080`, `http://corkboard:5040` and `http://web:3000${BASE_PATH}/api/host/authorize`; public hostname changes do not change those service addresses.

Only public values belong in `$env/dynamic/public`; secrets remain in `$env/dynamic/private` or server-side process environments. Agents **MAY** read ignored environment files when required and use values internally, but **MUST NOT** print, log, copy into documentation, or commit passwords, hashes, tokens, cookies, connection credentials or signing secrets.

Agents **MUST NOT** modify environment-controlled behavior unless the user explicitly requests the change or approves the concrete variable changes first. Explain variable names, reason and intended effect without revealing values. After approval, change only those values and verify affected services use them. If approval is declined, preserve configuration and report the limitation.

### Schema, upgrades and seeding

There is no ORM or numbered SQL migration directory. `scripts/setup-database.ts` waits for PostgreSQL, runs `server/accountUpgrade.ts`, applies `src/schema.postgres.sql`, then checks administrator seeding. Upgrade code installs additive compatibility changes/invariants; reading only the CREATE TABLE script is insufficient.

Seeding creates an ADMIN only when **no active ADMIN exists**. It preserves existing accounts/passwords and rejects a conflicting reserved email; changing seed variables is not a password reset. `SEED_DEMO_GAMES=true` enables demo seeding; the generator enables it for localhost/127.0.0.1 while the example defaults false.

`scripts/seed-users.ts` is a separate, explicit development-account operation using `server/seedUsers.ts`; startup never invokes it. It preserves matching active accounts and rejects reserved emails with a different role or deleted account. `server/demoGames.ts` defines 15 Thai activities, owned by the oldest active ADMIN (otherwise TEACHER), with stable IDs and account-owned pin images; repeat seeding preserves existing creations and does not publish them.

D1 also authenticates persisted managed accounts. `scripts/provision-d1-accounts.ts` uses `accountUpgradeD1.ts` and `schema.sql`; `ADMIN_USERNAME`/`ADMIN_PASSWORD` are legacy **provisioning inputs**, not request-time login fallback. Remote provisioning must be explicit.

Tables include `fuizzes`, `active_games`, `admins`, `auth_login_limits`, `host_resources`, `host_games`, `host_media`, `host_imports`, `llm_configurations`, `llm_state` and `llm_audit`; PostgreSQL additionally implements KV through `kv_entries`. LLM schema creation does not seed operational provider settings or credentials. Preserve relevant schema, upgrade, PostgreSQL/D1 store and shared-type parity when changing a contract; do not mechanically modify unrelated adapters.

Database setup is a real mutation: back up and verify the target before upgrades. PostgreSQL integration uses only a disposable `TEST_DATABASE_URL`: schema setup occurs outside rollback, and imported suites perform their own setup/cleanup. Never point it at application data or assume transaction rollback protects the entire suite.

## UI, localization and coding conventions

- Use Svelte 5 runes and DOM properties such as `onclick`; reuse `ui/`, `layout/` and `feedback/` components. Shared `FancyButtonBase.svelte` and `FancyAnchorButtonBase.svelte` size intrinsically; use their explicit `fill` behavior/action containers when full width is needed.
- Styling is component CSS plus shared CSS custom properties in the root layout. Check shared primitives before page-specific overrides. Breakpoints are component-specific (`MainHeader.svelte` uses 1200/950/600px), not a universal framework grid.
- Preserve loading, empty, unavailable, save-error/retry and optional-sync warning states. UI visibility must reflect effective role/ownership without replacing backend enforcement.
- Retain native labels, keyboard operation, focus-visible feedback and dialog accessibility. **Visual changes MUST be checked in a real browser** at desktop, tablet and mobile widths (for example 1440, 768 and 375px), with console errors, overflow, focus and primary actions checked. Report actual PASS/FAIL/BLOCKED evidence.
- Use generated `m.<key>()` Paraglide functions for user-facing text. Edit `messages/*.json`, never generated `src/lib/paraglide/`. `project.inlang/settings.json` enables only `th` and `en`, with Thai as the base locale. Retained translation files or RTL helpers do not enable extra UI routes. `contentLanguages.ts` is a separate quiz-content list.
- Keep locale keys in English-key order and run `bun run lang` (includes `scripts/check-messages.js`, `find-untranslated.js`, `find-unused-messages.js`). Use the locale matcher and localized link helpers; APIs stay nonlocalized except intentionally localized route files such as library search/share.
- TypeScript is strict, with `checkJs` enabled. Biome config uses tabs, 100-column width, single quotes and **no trailing commas**. ESLint uses the Svelte recommended rules. Avoid broad autoformat changes to unrelated files.
- Use PascalCase component/type names, camelCase values, SvelteKit `+page`/`+layout`/`+server` naming, and `$lib`, `$app`, `$env`, generated `./$types` imports. Keep browser-only storage/DOM code out of server modules.
- Reuse `requestBody.ts` bounded parsing and domain validators. Preserve parameterized SQL, `json`/`error`/`redirect` semantics and meaningful status codes; do not mask persistence failures with successful empty responses.
- Log safe status/timing metadata, not request bodies containing credentials or AI prompts/provider secrets. Reuse existing abstractions and shared types before adding parallel logic/dependencies.

## Deployment and constraints

| Service | Default published port | Persistent storage / health |
| --- | --- | --- |
| `nginx` | `${NGINX_PORT:-80}:80` | Validated template rendered at startup; browser application traffic enters here |
| `web` | None; `web:3000` internally | `web-data` at `/data/storage`; Compose checks HTTP `${BASE_PATH}/`; startup runs `db:setup` then Bun build output |
| `game-server` | None; `game-server:8080` internally | Live native game state is in process; `/hello` is an internal smoke endpoint |
| `corkboard` | None; `corkboard:5040` internally | `corkboard-data` at `/data`; `/hello` is an internal smoke endpoint |
| `postgres` | No host publication; `postgres:5432` inside Compose | `postgres-data-v2` at `/var/lib/postgresql/data`; `pg_isready` |
| `pgadmin` | None; Nginx `/pgadmin/` | `pgadmin_data` at `/var/lib/pgadmin`; attached to default and internal database networks |

Nginx waits for web health and Rust/pgAdmin service start; web/pgAdmin wait for PostgreSQL health, and web also waits for Rust service start. Use `postgres:5432` from pgAdmin, not localhost. pgAdmin uses Nginx `/pgadmin/` with its own login and no published host port; `SEOPEN_PGADMIN_PORT` is no longer used. `docker/pgadmin/servers.json` exists but is not mounted by current Compose. Existing pgAdmin volume accounts are not reset by changing default-credential variables.

Browser URLs must be reachable from the browser; container-private URLs use service DNS. Native development outside Compose cannot resolve `postgres` automatically and root Compose publishes no database port. For a host-local AI server under Docker Desktop, use reachable host routing such as `host.docker.internal`; container localhost points to the container. Keep `ORIGIN`, browser URLs and CORS consistent; allowing an origin in Rust CORS does not bypass web same-origin checks.

The supplied Nginx listener is HTTP and overwrites forwarded protocol/client-IP headers with its own connection values; web trusts one forwarded client-IP hop (`ADDRESS_HEADER=X-Forwarded-For`, `XFF_DEPTH=1`). External HTTPS/WSS termination or another proxy requires deliberate trusted-proxy configuration and full-path forwarding. `NGINX_PORT` is the host listener port; behind an HTTPS proxy, public URLs use that proxy's external origin. OAuth callback environment values and provider registrations must include the external base. Nginx/web permit up to 32 MiB bodies; endpoint-specific smaller limits still apply.

Rebuild images for source/dependency/Dockerfile/build changes; recreate services as appropriate for changed runtime settings. Validate Nginx with `nginx -t` and reload it after recreating upstream containers to refresh Compose DNS addresses. After changes affecting a service, **MUST** verify status, startup logs, relevant smoke/behavior checks and that the deployed code/configuration is current. Documentation-only changes outside image build contexts affect no runtime service and require no restart.

Native game state is not persisted by PostgreSQL ownership records. Restarting the runtime interrupts live games; do not assume multiple native instances share rooms. Cloudflare instead uses Worker/Durable Object code and migrations declared in its Wrangler files. `website/wrangler.toml` declares D1/R2/KV/AI/counter bindings; game/corkboard Wrangler files build with `worker-build`. Checked-in upstream domains/binding IDs are deployment configuration, not proof of an available target account. Host authorization requires matching private secrets and reachable callbacks there too. No tracked CI/CD workflow currently exists.

Persistent volumes **MUST NOT** be deleted or reset without explicit data-loss authorization and a recovery plan; never use `docker compose down -v` for routine maintenance. Preserve legacy volumes. File backups can use `docker compose cp web:/data ./backup-web-data` and `docker compose cp corkboard:/data ./backup-corkboard-data`; PostgreSQL requires a database backup as well. Retain the LLM encryption key with the web-storage backup.

## Change safety and completion checks

1. Inspect `git status` before editing. Existing uncommitted changes are user-owned: do not revert them, run destructive Git commands, or create commits unless explicitly requested. Keep the final diff scoped.
2. Read full changed files and trace callers, duplicate route families, provider variants, and Rust/web protocol consumers. Preserve backend authorization, ownership, cache isolation and data compatibility.
3. Add focused Vitest regressions for nontrivial TypeScript behavior. Use relevant suites for accounts/guards/private resources, AI, save queue, reports/XLSX, templates, TOML and protocol dispatch. Verify both affected provider variants/aliases.
4. For application changes, run targeted tests, `bun run check`, `bun run lint`, and the affected build; run locale checks when UI/messages change. Run isolated PostgreSQL or transport tests for affected persistence/protocol behavior, and real-browser verification for UI. Report unrelated baseline failures separately; do not silently suppress checks.
5. For documentation-only work, validate documented paths/scripts/configuration and Markdown, review the complete document and run `git diff --check`; application builds and data mutations are not required merely to edit this guide. A listed script is configuration evidence, not a passing execution result.
6. Do not edit or commit dependencies/generated output: `node_modules/`, `website/.svelte-kit/`, `website/build/`, `website/src/lib/paraglide/`, `game-backend/target/`, `.wrangler/`. Private `.env` changes follow the explicit authorization rule above. Avoid casual changes to vendored `src/lib/qrcodegen.ts`.
7. After service-affecting changes, rebuild/restart and verify deployment as above. Run `docker compose config --quiet` for Compose/environment-shape changes without dumping interpolated configuration.
8. Review `git diff` and `git status` at completion. State exactly what ran and passed, failed or was blocked. Distinguish mocked AI tests, provider reachability and real-model quality/throughput; never claim live deployment, OAuth, browser or model verification from a build alone.
