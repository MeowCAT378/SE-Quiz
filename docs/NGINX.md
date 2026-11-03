# Nginx deployment with a configurable prefix

Root Compose uses `BASE_PATH` for the SvelteKit build, Nginx routing, web health
check and private host callbacks. It defaults to `/SEQuiz`, including for existing
environments without that variable, and publishes Nginx on `NGINX_PORT` (default 80).
The prefix is case-sensitive. Nginx forwards the complete
application path to web, and strips only the backend/media prefixes below. This
table shows the default prefix; application routes use the configured `BASE_PATH`.
pgAdmin uses the fixed `/pgadmin/` path on the same listener.

| Public path | Upstream | Behavior |
| --- | --- | --- |
| `/pgadmin` | Nginx | 308 redirect to `/pgadmin/`, retaining the query |
| `/pgadmin/…` | `pgadmin:80/…` | Separate pgAdmin login, pages and assets |
| `/SEQuiz` | Nginx | 308 redirect to `/SEQuiz/`, retaining the query |
| `/SEQuiz/…` | `web:3000/SEQuiz/…` | Pages, assets, APIs and streaming publication |
| `/SEQuiz/backend/alive/{code}` | `game-server:8080/alive/{code}` | GET room existence |
| `/SEQuiz/backend/watch/{code}/{watcher}` | `game-server:8080/watch/{code}/{watcher}` | GET WebSocket upgrade |
| `/SEQuiz/media/upload` | `corkboard:5040/upload` | POST transient runtime images |
| `/SEQuiz/media/get/{id}` | `corkboard:5040/get/{id}` | GET runtime images |

Other backend/media paths return 404. Runtime `/add`, `/internal/host/*`, corkboard
`/thumbnail`, and web `/api/host/authorize` and `/api/host/completed` callbacks are
reachable only through private service addresses. Browser game creation still uses
the authenticated web `/SEQuiz/api/add` route. Private media remains owned through
the web `/SEQuiz/api/host/media/*` API.

For a **new** local environment, copy `.env.example` to `.env` and replace its
credential placeholders, or run `generate_config.sh localhost` with explicit
administrator seed inputs and add the pgAdmin settings from the example. Both
templates use this routing block:

```dotenv
NGINX_PORT=80
BASE_PATH=/SEQuiz
ORIGIN=http://localhost
PUBLIC_PLAY_URL=http://localhost
PUBLIC_DISPLAY_PLAY_URL=localhost/SEQuiz
PUBLIC_BACKEND_URL=http://localhost/SEQuiz/backend
PUBLIC_WS_URL=ws://localhost/SEQuiz/backend
PUBLIC_CORKBOARD_URL=http://localhost/SEQuiz/media
FUIZ_ALLOWED_ORIGINS=["http://localhost"]
CORKBOARD_ALLOWED_ORIGINS=["http://localhost"]
```

`ORIGIN`, `PUBLIC_PLAY_URL` and CORS values contain the origin without `/SEQuiz`;
application links add the compiled base. Backend/media/WS URLs contain their public
prefixes without a trailing slash. A custom Nginx port must appear in every origin
and public URL. Compose keeps `GAME_SERVER_INTERNAL_URL=http://game-server:8080`,
`CORKBOARD_INTERNAL_URL=http://corkboard:5040`, and
`HOST_AUTHORIZATION_URL=http://web:3000/SEQuiz/api/host/authorize` private.

To deploy below a faculty path such as `/informatics/SEQuiz`, use the complete
external prefix, including every parent segment:

```dotenv
BASE_PATH=/informatics/SEQuiz
ORIGIN=https://university.example
PUBLIC_PLAY_URL=https://university.example
PUBLIC_DISPLAY_PLAY_URL=university.example/informatics/SEQuiz
PUBLIC_BACKEND_URL=https://university.example/informatics/SEQuiz/backend
PUBLIC_WS_URL=wss://university.example/informatics/SEQuiz/backend
PUBLIC_CORKBOARD_URL=https://university.example/informatics/SEQuiz/media
FUIZ_ALLOWED_ORIGINS=["https://university.example"]
CORKBOARD_ALLOWED_ORIGINS=["https://university.example"]
```

Use slash-separated segments containing only ASCII letters, digits, `_` or `-`,
with no trailing slash. Build/startup validation rejects other forms. Nginx renders
its template with only `BASE_PATH` substituted, preserving its request variables.
The new `.env.example` references `${BASE_PATH}` in browser service URLs; old
environments or generator output with literal URLs must update those URLs to match.
For a new generated environment, export `BASE_PATH` before running the generator.

Changing the prefix requires rebuilding web and recreating Nginx and game-server;
the private callback path changes automatically. Keep the university proxy forwarding
the complete `/informatics/SEQuiz/...` path. Mounting this app at a new external
prefix while stripping that prefix would leave generated links and assets incorrect.
Local use can stay at `http://localhost/SEQuiz/` with the default prefix.

If OAuth is enabled, its registered callback and matching environment setting must
also include the base: `AUTH_GOOGLE_REDIRECT_URI=https://HOST/SEQuiz/api/gdrive/callback`
and `GITLAB_REDIRECT_URI=https://HOST/SEQuiz/api/git/callback`. Keep the return URL
inside the configured prefix; callback state and account validation still apply.
For a nested deployment, replace `/SEQuiz` in both registered callbacks with
`/informatics/SEQuiz`.

Existing `.env` files are preserved; review only the routing variables when moving
an existing deployment. Keep its credentials and named volumes. Rebuilding/restarting
the game server interrupts in-memory games. Web, game and corkboard have no published
host ports. PostgreSQL and pgAdmin remain internal; access pgAdmin through
`http://localhost/pgadmin/` using its existing pgAdmin credentials. Nginx strips
`/pgadmin/` and sets `X-Script-Name` and `X-Scheme` so generated URLs stay under
that path. `SEOPEN_PGADMIN_PORT` is no longer used; existing `.env` files and
the `pgadmin_data` volume are preserved. The SE Quiz login does not authorize
pgAdmin. For public deployments, restrict `/pgadmin/` to administrators at the
edge proxy or VPN, and forward this path as well as the application prefix.

To update only the affected services in an existing installation:

```sh
docker compose up -d --no-deps --force-recreate pgadmin nginx
docker compose exec nginx nginx -t
```

The supplied listener is HTTP. For HTTPS, configure certificate termination in
Nginx, publish its HTTPS port, and use `https://` origins and `wss://` sockets. The
current proxy overwrites forwarded scheme headers with its own connection scheme;
placing it behind another TLS proxy requires deliberate trusted-proxy configuration.
It also replaces the client address header; web trusts exactly that one proxy hop
for login throttling. Nginx and the web adapter allow bodies up to 32 MiB while
the existing endpoint validators retain their smaller per-operation limits.

Run from the repository root after configuring the intended environment:

```sh
docker compose config --quiet
docker compose up --build -d
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
curl -I http://localhost/SEQuiz
curl -I http://localhost/SEQuiz/
curl -I http://localhost/pgadmin/
curl -I http://localhost/SEQuiz/backend/add
```

The redirect is 308, the application returns successfully, and the denied runtime
path is 404. Reload Nginx after recreating upstream containers to refresh their
Compose DNS addresses. Do not use `down -v`; all existing database, web, corkboard and pgAdmin
volumes retain their identities.

The isolated acceptance fixture uses only public synthetic credentials and temporary
storage, with Nginx exposed at `127.0.0.1:9399`:

```sh
docker compose --env-file .env.example -p seopen-nginx-acceptance -f website/tests/nginx.compose.yml config --quiet
docker compose --env-file .env.example -p seopen-nginx-acceptance -f website/tests/nginx.compose.yml up --build -d --wait
docker compose --env-file .env.example -p seopen-nginx-acceptance -f website/tests/nginx.compose.yml exec -T nginx nginx -t
node website/tests/nginx.acceptance.mjs
docker compose --env-file .env.example -p seopen-nginx-acceptance -f website/tests/nginx.compose.yml down
```

Run the same fixture and browser checks for a nested prefix with `BASE_PATH` set in
the shell for **every** Compose and browser command. The fixture derives its build,
public URLs, health check and private callback from that value:

```sh
export BASE_PATH=/informatics/SEQuiz
docker compose --env-file .env.example -p seopen-nginx-acceptance -f website/tests/nginx.compose.yml up --build -d --wait
docker compose --env-file .env.example -p seopen-nginx-acceptance -f website/tests/nginx.compose.yml exec -T nginx nginx -t
node website/tests/nginx.acceptance.mjs
docker compose --env-file .env.example -p seopen-nginx-acceptance -f website/tests/nginx.compose.yml down
unset BASE_PATH
```

PowerShell uses `$env:BASE_PATH='/informatics/SEQuiz'` and removes the shell override
with `Remove-Item Env:BASE_PATH`. These commands use only the disposable fixture;
do not run its synthetic acceptance script against application data.

This exercises the production Nginx configuration without targeting live data.
It covers pgAdmin prefix redirects, assets, login/logout and header spoofing,
Thai/English pages at desktop/tablet/mobile widths, login and cross-tab
POST logout, a 600-KiB image uploaded through the editor, persisted creations,
ownership/CSRF rejection, share/join URLs, host/player WebSockets, answers and signed
completion callbacks. Screenshots and results are written under `test-results/nginx/`.
Live OAuth, GitLab publication streaming, and HTTPS termination need separate verification.
The existing root-path auth/LLM fixtures explicitly build with `BASE_PATH=''`.
`node website/tests/nginxConfig.smoke.mjs` checks new-environment routing for default
and nested prefixes/custom ports, rejects invalid build prefixes and verifies
existing environments remain unchanged; it requires POSIX sh/OpenSSL and uses
temporary synthetic files only.
