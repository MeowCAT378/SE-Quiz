<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="website/src/lib/assets/logo_dark.svg">
    <img src="website/src/lib/assets/logo.svg" alt="SE Quiz — By Fuiz" width="280">
  </picture>
</p>

# SE Quiz

SE Quiz is a self-hosted classroom quiz and live activity platform derived from Fuiz. Teachers create and host activities, participants join through their browsers, and results are saved for review and export.

[Features](#features) · [Quick Start](#quick-start) · [AI Configuration](#ai-configuration) · [Demo Data](#demo-data) · [Development](#development) · [Documentation](#documentation)

## Features

- **Create activities** with autosave and private, account-owned creations.
- **Host live sessions** with quizzes, polls, word clouds, brainstorming and presentation slides.
- **Invite participants** to join through their browsers without an account.
- **Share activities and review results** with a public library and Excel/CSV report exports.
- **Draft with AI** using an optional provider, with teacher review before adding questions.
- **Work in Thai or English** with teacher and administrator accounts.

## Quick Start

**Requirements:** Git and Docker with Compose v2.

### 1. Clone and configure

For a new checkout:

```bash
git clone https://github.com/SE-Final-Project/se-open-quizer.git
cd se-open-quizer
cp .env.example .env
```

Edit the root `.env` copied from [`.env.example`](.env.example). Keep the default `BASE_PATH=/SEQuiz` and localhost settings for local use. Replace these placeholders before starting:

| Setting | What to provide |
| --- | --- |
| `POSTGRES_PASSWORD` and the password in `DATABASE_URL` | The same random, URL-safe password |
| `ADMIN_SESSION_SECRET` | A strong random signing secret |
| `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` | Initial administrator credentials; password must have at least 12 characters |
| `SEOPEN_PGADMIN_EMAIL` / `SEOPEN_PGADMIN_PASSWORD` | Separate pgAdmin credentials |

Keep `.env` private and preserve it when updating an existing installation. AI and OAuth integrations are optional.

### 2. Start the stack

```bash
docker compose config --quiet
docker compose up --build -d
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
```

Open **[http://localhost/SEQuiz/](http://localhost/SEQuiz/)** and sign in with your initial administrator account. Startup initializes the database and creates an administrator only when no active ADMIN exists.

Compose starts Nginx, web, game-server, corkboard, PostgreSQL and pgAdmin. Browser traffic uses `/SEQuiz/` through Nginx; PostgreSQL stays internal. Database administration is available at [localhost/pgadmin/](http://localhost/pgadmin/) through Nginx with separate pgAdmin credentials; port 5050 is no longer published.

<details>
<summary>After the first startup: administrator seed settings</summary>

`ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD` are optional once an active ADMIN exists. To remove them from an existing `.env`, recreate the web container afterwards:

```bash
docker compose up -d --no-deps --force-recreate web
docker compose exec nginx nginx -s reload
```

Login reads stored accounts from PostgreSQL; removing or changing seed variables does not delete accounts or reset passwords. Keep `ADMIN_SESSION_SECRET` configured.

</details>

## AI Configuration

AI is optional; normal authoring and hosting work without it. An administrator configures activity drafts and library keyword generation at `/SEQuiz/admin/llm`:

1. Create a configuration and choose Ollama, vLLM, OpenAI, Gemini, Claude or OpenAI-compatible.
2. Enter the API base URL, the model ID actually served by the provider, an API key if required, and generation settings.
3. Enable and save the configuration, test the connection, then activate it. Saving and testing do not activate it automatically.

Both workflows use the active saved configuration. Changes take effect without editing `.env` or restarting web. Activity generation supports 13 types and 1–10 drafts per request; teachers review drafts before adding them to an activity.

For local AI, [llmster](https://lmstudio.ai/docs/developer/core/headless) runs the LM Studio core without a desktop GUI. See the [AI configuration guide](LLM_CONFIGURATION.md) for provider connections, credential backups and legacy settings.

## Demo Data

The repository includes **15 Thai Software Engineering activities** and optional development accounts. Run these commands from the repository root after `web` is running.

<details>
<summary>Seed development accounts</summary>

```bash
docker compose exec web bun run db:seed:users
```

This explicit command adds the predefined ADMIN and TEACHER accounts in [seedUsers.ts](website/src/lib/server/seedUsers.ts), preserving existing matching accounts. It does not read `ADMIN_SEED_*` or run at startup. Use these accounts only for development/demo deployments; manage normal accounts through the administrator UI.

</details>

<details>
<summary>Seed demo activities</summary>

Back up the database and web storage before running setup on an existing installation. To seed activities once:

```bash
docker compose exec -e SEED_DEMO_GAMES=true web bun run db:setup
```

This runs database setup and the demo seeder without changing `.env`. For automatic seeding at web startup, set `SEED_DEMO_GAMES=true` in `.env` and recreate `web`; the example defaults to `false`.

[demoGames.ts](website/src/lib/server/demoGames.ts) covers the editor's question/activity templates, presentation slides and a satisfaction survey. Activities belong to the oldest active ADMIN, falling back to the oldest active TEACHER. Sign in as that owner and open **Create**. Repeated seeding preserves existing activities and edits; it does not publish them to the public library.

</details>

## Development

For web tooling, install Bun >=1.2 and Node.js 24 or later. From the repository root:

```bash
cd website
bun install --frozen-lockfile
```

Run these commands from `website/`:

| Command | Purpose |
| --- | --- |
| `bun run --bun dev --port 9300` | Start the development server using the Bun runtime |
| `bun run check` | Check Svelte and TypeScript |
| `bun run test` | Run Vitest tests |
| `bun run lint` | Run Biome and ESLint |
| `bun run build` | Build the web application |

Host-based development needs explicitly loaded environment settings and reachable PostgreSQL, game and media services. The root `.env` is not loaded automatically, and Compose's service names are container-only. Standalone tooling defaults to an empty `BASE_PATH`; set it and the matching public URLs when developing under a prefix.

For Docker development, rebuild the web image from the repository root after source changes:

```bash
docker compose up --build -d web
docker compose exec nginx nginx -s reload
```

With Rust installed, run `cargo test --workspace` from `game-backend/`. For application checks through Nginx, use the [isolated acceptance fixture](docs/NGINX.md). Root `npx playwright test` runs the external example suite, not SE Quiz acceptance.

## Project Structure

| Path | Purpose |
| --- | --- |
| [`website/`](website/) | Svelte 5 / SvelteKit 2 application, TypeScript APIs, Bun tooling and web tests |
| [`game-backend/`](game-backend/) | Rust / Actix Web game and media services, WebSockets and Cloudflare targets |
| [`docker/`](docker/) | Nginx routing and container support files |
| [`docker-compose.yml`](docker-compose.yml) | Self-hosted stack with PostgreSQL 17 and persistent filesystem storage |

## Deployment

For a public address such as `https://example.com/SEQuiz/`, configure the public URLs, CORS and HTTPS/WSS using the [Nginx deployment guide](docs/NGINX.md). `ORIGIN` is the public origin without a path; `BASE_PATH` controls the case-sensitive application prefix. Changing the prefix requires rebuilding web and recreating Nginx and game-server.

Docker selects `ADAPTER=node` and runs web on Bun; standalone builds default to Cloudflare. Back up PostgreSQL, web/media storage and the LLM encryption key before upgrades. Preserve named volumes; restarting game-server interrupts live games.

## Documentation

| Guide | Contents |
| --- | --- |
| [Environment template](.env.example) | Local defaults and required configuration placeholders |
| [Nginx deployment](docs/NGINX.md) | Public routing, custom domains, HTTPS, WebSockets and isolated acceptance checks |
| [AI configuration](LLM_CONFIGURATION.md) | Providers, saved settings, credential storage and migration |

## License

Derived from Fuiz. See [LICENSE](LICENSE) for the GNU Affero General Public License v3.
