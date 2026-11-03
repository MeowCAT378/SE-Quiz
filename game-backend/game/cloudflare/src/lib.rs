//! Fuiz game Cloudflare worker.

mod authorization;
mod game;
mod game_manager;
#[path = "../../host_authorization.rs"]
mod host_authorization;
mod journal;

use garde::Validate;
use serde::{Deserialize, Serialize};
use serde_json::json;
use worker::*;

/// A game manager durable object instance reference.
#[derive(Serialize, Deserialize)]
pub struct GameManagerInstance {
    /// The durable object ID.
    pub id: String,
    /// When the instance was created.
    pub created_at: chrono::DateTime<chrono::Utc>,
}

async fn fetch_instance(env: &Env, game_id: &str) -> Result<GameManagerInstance> {
    let game_manager = env
        .durable_object("GAME_MANAGER")?
        .id_from_name("default")?
        .get_stub()?;

    let mut response = game_manager
        .fetch_with_str(&format!("https://example.com/{game_id}"))
        .await?;

    let game_manager_instance = response.json().await?;

    Ok(game_manager_instance)
}

#[event(fetch)]
#[allow(clippy::too_many_lines)]
async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let router = Router::new();

    router
        .get("/hello", |_, _| Response::ok("Hello World!"))
        .post_async("/add", |mut req, ctx| async move {
            let Some(token) = authorization::token(&req) else {
                return Response::error("Unauthorized", 401);
            };
            if authorization::authorize(&ctx.env, &token, "create-game")
                .await
                .is_none()
            {
                return Response::error("Unauthorized", 401);
            }
            let body = req.text().await?;
            if body.len() > 4 * 1024 * 1024 {
                return Response::error("Too large", 413);
            }
            let game_request: game::GameRequest = serde_json::from_str(&body)?;
            if game_request
                .validate_with(&fuiz::settings::Settings::default())
                .is_err()
            {
                return Response::error("Invalid game", 400);
            }
            let body = serde_json::to_string(&json!({"grant":token,"game":game_request}))?;
            ctx.durable_object("GAME_MANAGER")?
                .id_from_name("default")?
                .get_stub()?
                .fetch_with_request(authorization::signed(&ctx.env, "/add", &body)?)
                .await
        })
        .post_async("/internal/host/revoke", |mut req, ctx| async move {
            let body = req.text().await?;
            if body.len() > 4096 || !authorization::service(&ctx.env, &req, body.as_bytes()) {
                return Response::error("Unauthorized", 401);
            }
            ctx.durable_object("GAME_MANAGER")?
                .id_from_name("default")?
                .get_stub()?
                .fetch_with_request(authorization::signed(&ctx.env, "/internal/host/revoke", &body)?)
                .await
        })
        .post_async("/internal/host/games/remove", |mut req, ctx| async move {
            let body = req.text().await?;
            if body.len() > 4096 || !authorization::service(&ctx.env, &req, body.as_bytes()) {
                return Response::error("Unauthorized", 401);
            }
            ctx.durable_object("GAME_MANAGER")?
                .id_from_name("default")?
                .get_stub()?
                .fetch_with_request(authorization::signed(&ctx.env, "/internal/host/games/remove", &body)?)
                .await
        })
        .get_async("/watch/:gameid/:watcherid", |req, ctx| async move {
            let Some(id) = ctx.param("gameid") else {
                return Response::error("Bad Request", 400);
            };

            let Ok(game_instance) = fetch_instance(&ctx.env, id).await else {
                return Response::error("Not Found", 404);
            };

            let game_stub = ctx
                .durable_object("GAME")?
                .id_from_string(&game_instance.id)?
                .get_stub()?;

            game_stub.fetch_with_request(req).await
        })
        .get_async("/watch/:gameid/", |req, ctx| async move {
            let Some(id) = ctx.param("gameid") else {
                return Response::error("Bad Request", 400);
            };

            let Ok(game_instance) = fetch_instance(&ctx.env, id).await else {
                return Response::error("Not Found", 404);
            };

            let namespace = ctx.durable_object("GAME")?;

            let stub = namespace.id_from_string(&game_instance.id)?.get_stub()?;

            stub.fetch_with_request(req).await
        })
        .get_async("/alive/:gameid", |req, ctx| async move {
            let Some(id) = ctx.param("gameid") else {
                return Response::error("Bad Request", 400);
            };

            let Ok(game_instance) = fetch_instance(&ctx.env, id).await else {
                return Response::ok("false");
            };

            let namespace = ctx.durable_object("GAME")?;

            let stub = namespace.id_from_string(&game_instance.id)?.get_stub()?;

            stub.fetch_with_request(req).await
        })
        .options("/add", |_, _| Response::ok(""))
        .run(req, env)
        .await?
        .with_cors(
            &Cors::default()
                .with_max_age(86400)
                .with_allowed_headers(["*"])
                .with_origins(vec!["https://fuiz.org"])
                .with_methods(vec![Method::Get, Method::Post, Method::Options]),
        )
}
