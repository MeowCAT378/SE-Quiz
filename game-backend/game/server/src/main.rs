//! Fuiz game server.

mod authorization;
mod clashmap;
mod game_manager;
#[path = "../../host_authorization.rs"]
mod host_authorization;

use actix_web::{
    App, HttpRequest, HttpResponse, HttpServer, Responder, get,
    middleware::Logger,
    post,
    web::{self, Data},
};
use authorization::{Authorizer, now};
use figment::{
    Figment,
    providers::{Env, Serialized},
};
use fuiz::game::{IncomingGhostMessage, Options};
use fuiz::{
    fuiz::config::Fuiz,
    game::{IncomingMessage, UpdateMessage},
    game_id::GameId,
    session::Tunnel,
    watcher::Id,
};
use futures_util::StreamExt;
use game_manager::GameManager;
use garde::Validate;
use host_authorization::{DeferredOutput, Grant, TrafficGate};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    sync::{
        Arc, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

extern crate pretty_env_logger;
#[macro_use]
extern crate log;

/// Server configuration loaded from environment variables with sensible defaults.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ServerConfig {
    /// Hostname to bind to.
    hostname: String,
    /// Port to bind to.
    port: u16,
    /// Allowed CORS origins. Empty means permissive.
    allowed_origins: Vec<String>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            hostname: "0.0.0.0".into(),
            port: 8080,
            allowed_origins: Vec::new(),
        }
    }
}

/// A WebSocket session wrapper.
#[derive(Clone)]
pub struct Session {
    session: actix_ws::Session,
    connection: Id,
    gate: Arc<parking_lot::Mutex<TrafficGate>>,
    identity: Arc<parking_lot::Mutex<Option<Grant>>>,
    deferred: Arc<parking_lot::Mutex<DeferredOutput>>,
}

impl Session {
    /// Creates a new session from an actix WebSocket session.
    pub fn new(session: actix_ws::Session) -> Self {
        Self {
            session,
            connection: Id::new(),
            gate: Arc::default(),
            identity: Arc::default(),
            deferred: Arc::default(),
        }
    }

    fn text(&self, message: String) {
        let this = self.clone();
        actix_web::rt::spawn(async move {
            let permitted = this.gate.lock().permits(now());
            if permitted {
                let _ = this.session.clone().text(message).await;
            } else if !this.gate.lock().closed && this.identity.lock().is_some() && !this.deferred.lock().push(message)
            {
                this.deny();
            }
        });
    }
    fn authorize(&self, started: u64, expires: u64) {
        self.gate.lock().authorize(started, expires);
        let queued = self.deferred.lock().take();
        for message in queued {
            self.text(message);
        }
    }
    fn deny(&self) {
        self.gate.lock().close();
        self.deferred.lock().take();
        let session = self.session.clone();
        actix_web::rt::spawn(async move {
            let _ = session
                .close(Some(actix_ws::CloseReason {
                    code: actix_ws::CloseCode::Other(4403),
                    description: None,
                }))
                .await;
        });
    }
}

type MessageScheduler = Box<dyn Fn(fuiz::AlarmMessage, Duration)>;

impl fuiz::session::Tunnel for Session {
    fn send_message(&self, message: &fuiz::UpdateMessage) {
        self.text(serde_json::to_string(message).expect("message serializes"));
    }
    fn send_state(&self, state: &fuiz::SyncMessage) {
        self.text(serde_json::to_string(state).expect("state serializes"));
    }

    fn close(self) {
        actix_web::rt::spawn(async move {
            let _ = self.session.close(None).await;
        });
    }
}

struct AppState {
    game_manager: GameManager,
    settings: fuiz::settings::Settings,
    authorization: Authorizer,
}

#[derive(serde::Deserialize, Validate)]
#[garde(context(fuiz::settings::Settings))]
struct GameRequest {
    #[garde(dive)]
    config: Fuiz,
    #[garde(dive)]
    options: Options,
}

#[post("/add")]
async fn add(data: Data<AppState>, http: HttpRequest, request: web::Json<GameRequest>) -> impl Responder {
    let Some(token) = http
        .headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    else {
        return HttpResponse::Unauthorized().finish();
    };
    let Some(grant) = data.authorization.authorize(token, "create-game").await else {
        return HttpResponse::Unauthorized().finish();
    };
    let request = request.into_inner();

    if let Err(e) = request.validate_with(&data.settings) {
        return HttpResponse::BadRequest().body(e.to_string());
    }

    let GameRequest { config, options } = request;

    let Some(binding) = data.game_manager.add_owned_game(config, options, grant, &data.settings) else {
        return HttpResponse::Conflict().finish();
    };
    let game_id = binding.code;
    let host_id = binding.watcher;

    let cleanup_instance = binding.grant.instance_id.clone();
    let timeout_binding = binding.clone();
    // Independent of slide alarms and of the lifetime of any host socket.
    actix_web::rt::spawn(async move {
        let mut summary_announced = false;
        loop {
            actix_web::rt::time::sleep(Duration::from_secs(1)).await;
            match data.game_manager.poll_host_timeout(&timeout_binding) {
                Some(false) => {}
                Some(true) => {
                    // Let queued Summary output pass its existing authorization
                    // gate before the web callback invalidates this binding.
                    if !summary_announced || !data.game_manager.completion_ready(&timeout_binding) {
                        summary_announced = true;
                        continue;
                    }
                    data.authorization.complete(&timeout_binding).await;
                    actix_web::rt::time::sleep(Duration::from_mins(1)).await;
                    info!("clearing, {game_id}");
                    data.game_manager.remove_instance(&cleanup_instance);
                    break;
                }
                _ => break,
            }
        }
    });

    HttpResponse::Ok().json(json!({
        "game_id": game_id,
        "watcher_id": host_id,
        "instance_id": binding.grant.instance_id
    }))
}

#[post("/internal/host/revoke")]
async fn revoke(data: Data<AppState>, request: HttpRequest, body: web::Bytes) -> HttpResponse {
    if body.len() > 4096 || !data.authorization.service(&request, &body) {
        return HttpResponse::Unauthorized().finish();
    }
    let Ok(revocation) = serde_json::from_slice::<host_authorization::Revocation>(&body) else {
        return HttpResponse::BadRequest().finish();
    };
    data.game_manager.revoke(&revocation);
    HttpResponse::NoContent().finish()
}
#[post("/internal/host/games/remove")]
async fn remove_instance(data: Data<AppState>, request: HttpRequest, body: web::Bytes) -> HttpResponse {
    if body.len() > 4096 || !data.authorization.service(&request, &body) {
        return HttpResponse::Unauthorized().finish();
    }
    let Ok(removal) = serde_json::from_slice::<host_authorization::Removal>(&body) else {
        return HttpResponse::BadRequest().finish();
    };
    data.game_manager.remove_instance(&removal.instance_id);
    HttpResponse::NoContent().finish()
}

#[get("/alive/{game_id}")]
async fn alive(data: web::Data<AppState>, game_id: web::Path<GameId>) -> impl Responder {
    data.game_manager.exists(game_id.into_inner()).is_ok().to_string()
}

fn websocket_heartbeat_verifier(mut session: actix_ws::Session) -> impl Fn(bytes::Bytes) -> bool {
    let latest_value = Arc::new(AtomicU64::new(0));

    let sender_latest_value = latest_value.clone();
    actix_web::rt::spawn(async move {
        loop {
            actix_web::rt::time::sleep(Duration::from_secs(5)).await;
            let new_value = fastrand::u64(0..u64::MAX);
            sender_latest_value.store(new_value, Ordering::SeqCst);
            if session.ping(&new_value.to_ne_bytes()).await.is_err() {
                break;
            }
        }
    });

    move |bytes: bytes::Bytes| {
        let last_value = latest_value.load(Ordering::SeqCst);
        if let Ok(actual_bytes) = bytes.into_iter().collect::<Vec<_>>().try_into()
            && u64::from_ne_bytes(actual_bytes) == last_value
        {
            return false;
        }
        true
    }
}

#[get("/watch/{game_id}/{watcher_id}")]
#[allow(clippy::too_many_lines)]
async fn watch(
    data: web::Data<AppState>,
    req: HttpRequest,
    body: web::Payload,
    params: web::Path<(GameId, String)>,
) -> Result<HttpResponse, actix_web::Error> {
    let (response, mut session, mut msg_stream) = actix_ws::handle(&req, body)?;

    let (game_id, ref url_watcher) = *params;
    let url_watcher = url_watcher.parse::<Id>().ok();

    data.game_manager.exists(game_id)?;

    let own_session = Session::new(session.clone());

    let mismatch = websocket_heartbeat_verifier(session.clone());

    let data_thread = data.clone();

    actix_web::rt::spawn(async move {
        let schedule_thread = data_thread.clone();

        let schedule_message: Arc<OnceLock<MessageScheduler>> = Arc::default();

        let thread_schedule_message = schedule_message.clone();
        let bound_host = data.game_manager.binding(game_id).map(|b| b.watcher);

        let temp_schedule_message = move |alarm_message: fuiz::AlarmMessage, duration: Duration| {
            let schedule_thread = schedule_thread.clone();
            let schedule_message = thread_schedule_message.clone();
            actix_web::rt::spawn(async move {
                actix_web::rt::time::sleep(duration).await;
                let _ = schedule_thread.game_manager.receive_alarm(
                    game_id,
                    bound_host,
                    &alarm_message,
                    |alarm, duration| {
                        schedule_message.get().expect("schedule is unintialized")(alarm, duration);
                    },
                );
            });
        };

        schedule_message
            .as_ref()
            .get_or_init(|| Box::new(temp_schedule_message));

        let mut watcher_id = None;
        let mut admission_error = None;
        let mut host: Option<(String, Grant)> = None;
        let mut idle = actix_web::rt::time::interval(Duration::from_millis(100));
        loop {
            let next = futures_util::future::select(Box::pin(msg_stream.next()), Box::pin(idle.tick())).await;
            let msg = match next {
                futures_util::future::Either::Left((Some(Ok(msg)), _)) => msg,
                futures_util::future::Either::Left(_) => break,
                futures_util::future::Either::Right(_) => {
                    if own_session.gate.lock().closed {
                        break;
                    }
                    if let Some((token, grant)) = &host
                        && now() >= own_session.gate.lock().until
                    {
                        let started = now();
                        own_session.gate.lock().pause();
                        let decision = data.authorization.authorize(token, "host-game").await;
                        if !decision.as_ref().is_some_and(|d| d.same_host(grant))
                            || !data.game_manager.current_tunnel(
                                grant.watcher_id.as_ref().unwrap().parse().unwrap(),
                                own_session.connection,
                            )
                        {
                            own_session.deny();
                            break;
                        }
                        own_session.authorize(started, grant.expires_at);
                    }
                    continue;
                }
            };
            if data.game_manager.exists(game_id).is_err() {
                break;
            }

            match msg {
                actix_ws::Message::Pong(bytes) => {
                    if mismatch(bytes) {
                        break;
                    }
                }
                actix_ws::Message::Ping(bytes) => {
                    if session.pong(&bytes).await.is_err() {
                        break;
                    }
                }
                actix_ws::Message::Text(s) => {
                    let Ok(value) = serde_json::from_str::<serde_json::Value>(s.as_ref()) else {
                        continue;
                    };
                    if let Some(token) = value.get("Authorization").and_then(serde_json::Value::as_str) {
                        if value.as_object().is_none_or(|v| v.len() != 1) || (watcher_id.is_some() && host.is_none()) {
                            own_session.deny();
                            break;
                        }
                        let started = now();
                        own_session.gate.lock().pause();
                        let Some(grant) = data.authorization.authorize(token, "host-game").await else {
                            own_session.deny();
                            break;
                        };
                        let Some(binding) = data.game_manager.binding(game_id) else {
                            own_session.deny();
                            break;
                        };
                        if !binding.matches(&grant)
                            || url_watcher != Some(binding.watcher)
                            || host.as_ref().is_some_and(|(_, old)| !old.same_host(&grant))
                            || own_session.gate.lock().closed
                        {
                            own_session.deny();
                            break;
                        }
                        if watcher_id.is_some()
                            && !data
                                .game_manager
                                .current_tunnel(binding.watcher, own_session.connection)
                        {
                            own_session.deny();
                            break;
                        }
                        *own_session.identity.lock() = Some(grant.clone());
                        own_session.authorize(started, grant.expires_at);
                        host = Some((token.to_owned(), grant));
                        continue;
                    }
                    let Ok(message) = serde_json::from_value::<IncomingMessage>(value) else {
                        continue;
                    };
                    // Idle polling gates outgoing traffic; each host command still needs a fresh
                    // account decision before it can mutate the game.
                    if let Some((token, grant)) = &host {
                        let started = now();
                        own_session.gate.lock().pause();
                        let decision = data.authorization.authorize(token, "host-game").await;
                        if !decision.as_ref().is_some_and(|d| d.same_host(grant))
                            || own_session.gate.lock().closed
                            || !data
                                .game_manager
                                .binding(game_id)
                                .is_some_and(|binding| binding.matches(grant))
                        {
                            own_session.deny();
                            break;
                        }
                        if let Some(id) = watcher_id
                            && !data.game_manager.current_tunnel(id, own_session.connection)
                        {
                            own_session.deny();
                            break;
                        }
                        own_session.authorize(started, grant.expires_at);
                    } else if matches!(message, IncomingMessage::Host(_))
                        || url_watcher.is_some_and(|id| data.game_manager.is_host(id))
                    {
                        own_session.deny();
                        break;
                    }
                    match watcher_id {
                        None => match message {
                            IncomingMessage::Ghost(IncomingGhostMessage::ClaimId(id)) => {
                                if data.game_manager.is_host(id)
                                    && host
                                        .as_ref()
                                        .is_none_or(|(_, grant)| grant.watcher_id.as_deref() != Some(&id.to_string()))
                                {
                                    own_session.deny();
                                    break;
                                }
                                if host
                                    .as_ref()
                                    .is_some_and(|(_, grant)| grant.watcher_id.as_deref() != Some(&id.to_string()))
                                {
                                    own_session.deny();
                                    break;
                                }
                                if host.is_none() {
                                    own_session.authorize(u64::MAX - host_authorization::POLL_MS, u64::MAX);
                                }
                                data.game_manager.set_tunnel(id, own_session.clone());
                                watcher_id = Some(id);
                                match data.game_manager.rejoin(game_id, id) {
                                    Ok(Ok(())) => {}
                                    Ok(Err(error)) => {
                                        admission_error = Some(error);
                                        break;
                                    }
                                    Err(_) => break,
                                }
                            }
                            IncomingMessage::Ghost(IncomingGhostMessage::DemandId) if host.is_none() => {
                                let id = Id::new();
                                own_session.authorize(u64::MAX - host_authorization::POLL_MS, u64::MAX);
                                watcher_id = Some(id);
                                own_session.send_message(&UpdateMessage::IdAssign(id).into());
                                data.game_manager.set_tunnel(id, own_session.clone());
                                match data.game_manager.add_unassigned(game_id, id) {
                                    Ok(Ok(())) => {}
                                    Ok(Err(error)) => {
                                        admission_error = Some(error);
                                        break;
                                    }
                                    Err(_) => break,
                                }
                            }
                            _ => {
                                own_session.deny();
                                break;
                            }
                        },
                        Some(id) => {
                            if !data.game_manager.current_tunnel(id, own_session.connection) {
                                own_session.deny();
                                break;
                            }
                            if !matches!(message, IncomingMessage::Ghost(_)) {
                                let _ = data
                                    .game_manager
                                    .receive_message(game_id, id, message, |alarm, duration| {
                                        schedule_message.get().expect("schedule initialized")(alarm, duration);
                                    });
                            }
                        }
                    }
                }
                _ => break,
            }
        }

        if let Some(watcher_id) = watcher_id {
            data.game_manager.detach(game_id, watcher_id, own_session.connection);
        }
        // Await the refusal before closing: Tunnel::send_message spawns a task
        // which can otherwise lose the race to the close frame.
        if let Some(error) = admission_error {
            let message: fuiz::UpdateMessage = UpdateMessage::CannotJoin(error).into();
            session
                .text(serde_json::to_string(&message).expect("message serializes"))
                .await
                .ok();
        }
        session.close(None).await.ok();
    });

    Ok(response)
}

fn server_figment() -> Figment {
    Figment::new()
        .merge(Serialized::defaults(ServerConfig::default()))
        .merge(Env::prefixed("FUIZ_"))
}

fn settings_figment() -> Figment {
    Figment::new()
        .merge(fuiz::settings::Settings::default())
        .merge(Env::prefixed("FUIZ_SETTINGS_").split("__"))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    pretty_env_logger::init();

    let server_config: ServerConfig = server_figment()
        .extract()
        .expect("server configuration should be valid");

    let settings: fuiz::settings::Settings = settings_figment().extract().expect("game settings should be valid");

    let app_state = web::Data::new(AppState {
        game_manager: GameManager::default(),
        settings,
        authorization: Authorizer::default(),
    });

    let origins = server_config.allowed_origins;

    HttpServer::new(move || {
        let app = App::new()
            .wrap(Logger::default())
            .app_data(app_state.clone())
            .route("/hello", web::get().to(|| async { "Hello World!" }))
            .service(alive)
            .service(add)
            .service(watch)
            .service(revoke)
            .service(remove_instance);

        let mut cors = actix_cors::Cors::default()
            .allowed_methods(vec!["GET", "POST"])
            .allowed_headers(vec![
                actix_web::http::header::AUTHORIZATION,
                actix_web::http::header::ACCEPT,
            ])
            .allowed_header(actix_web::http::header::CONTENT_TYPE);
        if origins.is_empty() {
            cors = cors.allow_any_origin();
        } else {
            for origin in &origins {
                cors = cors.allowed_origin(origin);
            }
        }
        app.wrap(cors)
    })
    .bind((server_config.hostname.as_str(), server_config.port))?
    .run()
    .await
}

#[cfg(test)]
#[allow(clippy::result_large_err)]
mod tests {
    use super::*;

    #[test]
    fn server_config_defaults() {
        figment::Jail::expect_with(|_| {
            let config: ServerConfig = server_figment().extract()?;
            assert_eq!(config.hostname, "0.0.0.0");
            assert_eq!(config.port, 8080);
            assert!(config.allowed_origins.is_empty());
            Ok(())
        });
    }

    #[test]
    fn server_config_from_env() {
        figment::Jail::expect_with(|jail| {
            jail.set_env("FUIZ_HOSTNAME", "127.0.0.1");
            jail.set_env("FUIZ_PORT", "9000");

            let config: ServerConfig = server_figment().extract()?;
            assert_eq!(config.hostname, "127.0.0.1");
            assert_eq!(config.port, 9000);
            Ok(())
        });
    }

    #[test]
    fn server_config_multiple_origins() {
        figment::Jail::expect_with(|jail| {
            jail.set_env("FUIZ_ALLOWED_ORIGINS", r#"["https://fuiz.org","https://example.com"]"#);

            let config: ServerConfig = server_figment().extract()?;
            assert_eq!(config.allowed_origins, vec!["https://fuiz.org", "https://example.com"]);
            Ok(())
        });
    }

    #[test]
    fn settings_defaults() {
        figment::Jail::expect_with(|_| {
            let settings: fuiz::settings::Settings = settings_figment().extract()?;
            assert_eq!(settings.fuiz.max_player_count, 1000);
            assert_eq!(settings.question.max_time_limit, 240);
            Ok(())
        });
    }

    #[test]
    fn settings_from_env() {
        figment::Jail::expect_with(|jail| {
            jail.set_env("FUIZ_SETTINGS_FUIZ__MAX_PLAYER_COUNT", "500");
            jail.set_env("FUIZ_SETTINGS_QUESTION__MAX_TIME_LIMIT", "300");

            let settings: fuiz::settings::Settings = settings_figment().extract()?;
            assert_eq!(settings.fuiz.max_player_count, 500);
            assert_eq!(settings.question.max_time_limit, 300);
            Ok(())
        });
    }
}

#[cfg(test)]
mod authorization_tests {
    use super::*;

    #[actix_web::test]
    async fn direct_creation_requires_authorization() {
        let app = actix_web::test::init_service(
            App::new()
                .app_data(Data::new(AppState {
                    game_manager: GameManager::default(),
                    settings: fuiz::settings::Settings::default(),
                    authorization: Authorizer::new(String::new(), String::new()),
                }))
                .service(add),
        )
        .await;
        let req = actix_web::test::TestRequest::post()
            .uri("/add")
            .set_json(json!({
                "config":{"title":"Authorization regression","slides":[]},
                "options":Options::default()
            }))
            .to_request();
        let response = actix_web::test::call_service(&app, req).await;
        assert_eq!(response.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }
}
