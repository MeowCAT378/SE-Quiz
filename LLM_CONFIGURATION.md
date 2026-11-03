# Activity LLM configuration

Activity generation and library keyword generation use the same active database configuration managed at `/admin/llm`. ADMIN can change provider, endpoint, API key, model, sampling, token limits, timeouts, batching, concurrency and active selection without editing `.env` or restarting the web service. Ordinary authoring and publishing do not require AI. ADMIN management uses current session/role checks; teachers retain the existing owned-creation generation workflow and review drafts before adding them.

## Provisioning and migration

Back up and verify the database target before running the existing PostgreSQL setup or D1 provisioning command. The schemas add `llm_configurations`, `llm_state`, and `llm_audit`; repeated setup never seeds or replaces operational settings. Keep backups of the database and the encryption secret separately.

Self-hosted web automatically creates a dedicated AES-256-GCM key on first credential use and persists it at `STORAGE_PATH/.llm-secrets/encryption.key` outside the database. The standard Compose web storage volume retains it across container recreation. The directory/file use owner-only permissions on Unix. Back up this file separately from the database and restore both together; do not publish its contents. Replicas must share the same persistent key storage.

If an existing deployment provides `LLM_CONFIG_ENCRYPTION_KEY`, its canonical-base64 32-byte key is copied into that file on first use, preserving existing ciphertext. Once the file exists, it is authoritative and changes to the environment key have no effect. A missing key with existing encrypted credentials, an invalid key file, or an unwritable storage directory fails closed instead of generating an incompatible replacement. Restore the original key before editing unreadable credentials.

An ADMIN approves a service by entering its API base URL at `/admin/llm` and saving, testing, or discovering models. This grants access to that exact service, including local/private networks on the self-hosted runtime; it does not authorize request paths outside its base path. For example, use `http://host.docker.internal:1234/v1` for a host-local OpenAI-compatible server, or `https://llm.internal:8443/v1` for a private HTTPS service. No environment allowlist or restart is required when changing endpoints. `LLM_ALLOWED_ENDPOINTS` is no longer read; existing values may remain without effect. Never approve a hostname controlled by an untrusted party, a general internal proxy, or an endpoint that forwards user-selected destinations.

The application does not write `.env`. No LLM environment variables are needed for a new self-hosted setup. The encryption key remains server-side and is not an editable UI setting. Cloudflare Workers have no persistent filesystem and still provision `LLM_CONFIG_ENCRYPTION_KEY` as a dedicated Worker secret. Private host routing such as `host.docker.internal` is for the self-hosted web runtime; a Worker needs an ADMIN-configured reachable HTTPS gateway.

After schema setup, an ADMIN can preview and explicitly import valid legacy `LLM_*` settings once. Legacy defaults are preserved: temperature 0.7 and output-token limit 2048 when those legacy variables were absent; explicit values remain unchanged. Timeout values are converted from milliseconds to the UI's seconds. Invalid settings require correction or manual creation, never silent substitution. Keys remain server-side during preview and import. Import saves but does not activate a configuration.

The first successful manual save or import permanently establishes database authority. Later startups do not import, reseed, or fall back to environment configuration. Existing legacy environment variables may remain untouched; they no longer control generation. Until an ADMIN selects an enabled, usable configuration, AI is unavailable. Database or credential failures do not enable an environment fallback.

Do not discard the encryption key: without it, stored credentials cannot be recovered. The UI can disable a configuration while preserving its encrypted key. Keyless local services do not need an encryption key. Rotate provider API keys through the UI; replacing the infrastructure key alone is not a credential-rotation procedure. `AI_PROVIDER`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `AI_MODEL` and the Cloudflare AI binding are no longer keyword configuration sources.

## Settings and operation semantics

New configurations are disabled and inactive. Application defaults are temperature 0.5, Top P 0.95, 4096 output tokens per batch request, 240-second request timeout, 900-second overall timeout, and batch size 3. Model restrictions take precedence: unsupported sampling controls explicitly use `null` (provider controlled), rather than sending unsupported values. Claude configurations use at most one adjustable sampling parameter.

Reset changes only these six parameters in the editable form. It preserves identity, destination, model, key state and pending key actions, enabled status, and active selection. Save is required to persist; Discard restores the last loaded configuration. Save, activation, and connection testing are separate actions. Version conflicts require reloading and reconciling edits; they do not silently overwrite another administrator's work.

Delete configuration requires confirmation and a current saved version. It removes the configuration from the list, clears its stored API key, and retains its change history using a deletion marker. Deleting the selected configuration also clears active selection: new AI operations are unavailable until another configuration is activated, while running operations retain their existing snapshot. Deleting an inactive configuration preserves the active selection. Deleting all configurations does not reopen legacy import or enable an environment fallback. PostgreSQL startup and explicit D1 provisioning add the nullable deletion marker to existing installations without rewriting settings or credentials.

Each generation reads one complete configuration snapshot, including credentials, directly from the database. D1 starts freshness-sensitive reads at the primary. Batches and retries retain that snapshot through completion or cancellation. Saving affects subsequent operations without restart. Disabling the selected configuration prevents new operations and does not switch providers or stop existing work.

Batch size counts items, not parallel calls: ten items with batch size three issue 3, 3, 3, and 1 sequentially. At most two attempts are allowed per batch for retryable failures. The output-token limit applies to each attempt; retries may cost more. Each attempt has its request deadline. The overall deadline includes every batch and retry and may expire before all possible attempts finish. Timeout and explicit cancellation remain distinct errors. No partial results are inserted into an activity.

Activity generation, connection tests and keyword generation share the saved concurrency limit (default two) per process, plus one operation per login identity. Keyword generation makes one bounded structured request using the same model and credentials; unavailable/busy/invalid responses omit optional keywords without failing publication. Cancellation must reach that process. There is no distributed queue, automatic provider failover, or process-local configuration cache. Use the existing deployment routing constraints for multiple instances.

## Providers and connection tests

Provider identity is separate from protocol. Ollama, vLLM, OpenAI, and custom compatible services use the shared Chat Completions adapter; Gemini uses GenerateContent and Claude uses Messages. No model IDs are invented. Optional discovery returns up to 100 models from the provider's first response; manual model entry remains available.

Compatibility rules were checked against official documentation on 2026-09-23:

- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and [model guidance](https://developers.openai.com/api/docs/guides/latest-model): model-dependent sampling and completion-token parameters. Reasoning model defaults use provider-controlled sampling; this feature does not add a reasoning-effort control.
- [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility): local OpenAI-compatible structured responses, optional bearer authentication for authenticated deployments.
- [vLLM compatibility](https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/): JSON-schema response format; server/model support still needs a real test.
- [Gemini generation](https://ai.google.dev/api/generate-content): `x-goog-api-key`, generation configuration and completion indicators.
- [Claude structured output](https://platform.claude.com/docs/en/build-with-claude/structured-outputs): native output schema, schema subset and model restrictions. Provider schemas omit unsupported constraints while application validation retains all original bounds, exact fields, counts, difficulty and duplicate checks.
- [D1 consistency](https://developers.cloudflare.com/d1/best-practices/read-replication/): primary-first reads for newly saved configuration.

The explicit connection test validates the current form, securely resolves any retained credential, and sends one small structured arithmetic example with the selected model and parameters. It does not save or activate. It has no retries and a deadline equal to the minimum of both configured timeouts and 60 seconds. The configured token limit remains in force, and responses are bounded to 1 MiB. Tests may incur charges. Form changes invalidate test results, and stale responses are ignored. Success demonstrates only that request's compatibility, not factual accuracy or sustained performance.

HTTP redirects are rejected and credentials are never forwarded to a redirected destination. Node/Bun resolves and validates addresses, then connects to a pinned numeric address while retaining the original HTTP Host and TLS identity. Metadata destinations are always forbidden. Remote credential-bearing services require HTTPS. Provider error bodies, prompts, plaintext keys and ciphertext never appear in management responses or audit history.

## Verification

`website/tests/llm*.test.ts` covers configuration/security, D1, provider protocol mocks, generation snapshots, deadlines and management routes. `website/tests/llm.postgres.integration.ts` requires the dedicated disposable PostgreSQL target on loopback port 55439. Never point mutation tests at application data.

`docker compose -p seopen-llm-browser -f website/tests/llm.compose.yml up --build -d` starts a disposable web/PostgreSQL fixture on loopback port 9398, with public synthetic credentials and an in-container mock model. It never loads the application's `.env` or mounts application volumes. Browser results from this fixture are mocked-provider evidence, not live-model verification.

Run the browser acceptance scripts from the repository root: `node website/tests/llm.browser.mjs` and `node website/tests/llmAuthoring.browser.mjs`. They target only the disposable fixture on port 9398. Override `BROWSER_EXECUTABLE` for the settings browser harness when needed. See [verification evidence](LLM_VERIFICATION.md) for the results and explicit limitations of this implementation run.
