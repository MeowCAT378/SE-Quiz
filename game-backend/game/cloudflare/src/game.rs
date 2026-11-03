use std::{
    cell::{Cell, RefCell, RefMut},
    str::FromStr,
    time::Duration,
};

use garde::Validate;
use serde::{Deserialize, Serialize};
use worker::*;

use fuiz::tick::Tick;
use fuiz::wal::Event;
use fuiz::{
    game,
    session::Tunnel,
    watcher::{self},
};
use rustc_hash::FxHashSet;

use crate::journal::Journal;
use crate::{
    authorization as auth,
    host_authorization::{CANCELLATION_MS, DeferredOutput, Grant, Removal, Revocation, TrafficGate},
};

#[derive(Deserialize)]
struct Creation {
    grant: String,
    game: GameRequest,
    code: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Owner {
    grant: Grant,
    code: String,
    watcher: watcher::Id,
}
impl Owner {
    fn matches(&self, grant: &Grant) -> bool {
        self.grant.user_id == grant.user_id
            && self.grant.instance_id == grant.instance_id
            && grant.game_code.as_deref() == Some(&self.code)
            && grant.watcher_id.as_deref() == Some(&self.watcher.to_string())
    }
}
#[derive(Clone, Serialize, Deserialize)]
struct HostSession {
    token: String,
    grant: Grant,
    gate: TrafficGate,
}
#[derive(Clone, Serialize, Deserialize)]
struct Attachment {
    #[serde(default)]
    connection: watcher::Id,
    #[serde(default)]
    closed: bool,
    watcher: watcher::Id,
    connected: bool,
    host: Option<HostSession>,
}
fn attachment(ws: &WebSocket) -> Option<Attachment> {
    ws.deserialize_attachment::<Attachment>().ok().flatten().or_else(|| {
        ws.deserialize_attachment::<watcher::Id>()
            .ok()
            .flatten()
            .map(|watcher| Attachment {
                connection: watcher,
                closed: false,
                watcher,
                connected: true,
                host: None,
            })
    })
}
fn deny(ws: &WebSocket) {
    if let Some(mut value) = attachment(ws) {
        value.closed = true;
        if let Some(host) = &mut value.host {
            host.gate.close();
        }
        let _ = ws.serialize_attachment(value);
    }
    let _ = ws.close(Some(4403), None::<String>);
}

#[derive(Debug, serde::Deserialize, garde::Validate, Serialize)]
#[garde(context(fuiz::settings::Settings))]
pub struct GameRequest {
    #[garde(dive)]
    pub config: fuiz::fuiz::config::Fuiz,
    #[garde(dive)]
    pub options: fuiz::game::Options,
}

struct WebSocketTunnel(WebSocket, std::rc::Rc<RefCell<DeferredOutput>>);

impl WebSocketTunnel {
    /// Closes without consuming the tunnel, for callers holding it by
    /// reference. [`Tunnel::close`] takes ownership, which the admission path
    /// cannot give up while it still needs the socket to report the refusal.
    fn close_tunnel(&self) {
        let _ = self.0.close::<String>(None, None);
    }
}

impl WebSocketTunnel {
    fn send(&self, message: String) {
        let Some(a) = attachment(&self.0) else {
            return;
        };
        if a.closed {
            return;
        }
        if a.host.is_some_and(|h| !h.gate.permits(auth::now())) {
            if !self.1.borrow_mut().push(message) {
                deny(&self.0);
            }
        } else {
            let _ = self.0.send_with_str(message);
        }
    }
}
impl Tunnel for WebSocketTunnel {
    fn close(self) {
        self.close_tunnel();
    }
    fn send_message(&self, message: &fuiz::UpdateMessage) {
        self.send(serde_json::to_string(message).expect("message serializes"));
    }
    fn send_state(&self, state: &fuiz::SyncMessage) {
        self.send(serde_json::to_string(state).expect("state serializes"));
    }
}

#[durable_object]
pub struct Game {
    game: RefCell<Option<fuiz::game::Game>>,
    alarm_message: RefCell<Option<AlarmMessage>>,
    /// Where this game's history has got to in storage.
    journal: Journal,
    /// Whether storage has been read since this instance was constructed. A
    /// game that legitimately does not exist yet reads as `None`, so the
    /// absence of a game is not on its own a reason to read again.
    loaded: Cell<bool>,
    loading: futures_util::lock::Mutex<()>,
    deferred: RefCell<std::collections::HashMap<watcher::Id, std::rc::Rc<RefCell<DeferredOutput>>>>,
    state: State,
    env: Env,
    owner: RefCell<Option<Owner>>,
    creation_ready: Cell<bool>,
    game_due: Cell<Option<u64>>,
    completion_due: Cell<Option<u64>>,
    completion_attempts: Cell<u8>,
    host_check: futures_util::lock::Mutex<()>,
    creation: futures_util::lock::Mutex<()>,
    connections: RefCell<std::collections::HashMap<watcher::Id, std::rc::Rc<futures_util::lock::Mutex<()>>>>,
}

#[derive(Serialize, Deserialize)]
enum AlarmMessage {
    DeleteGame,
    Game(fuiz::AlarmMessage),
}

/// How long a game with nothing scheduled is kept before it is swept away.
const GAME_EXPIRY: Duration = Duration::from_hours(1);

impl Game {
    /// Loads the game the object is responsible for.
    async fn load_state(&self) {
        let _loading = self.loading.lock().await;
        if self.loaded.get() {
            return;
        }

        // Invalidate hibernated permissions before the first storage await.
        for socket in self.state.get_websockets() {
            if let Some(mut a) = attachment(&socket)
                && let Some(host) = &mut a.host
            {
                host.gate.pause();
                host.gate.until = 0;
                let _ = socket.serialize_attachment(a);
            }
        }
        let storage = self.state.storage();

        // Read before the game: an alarm can fire against storage that no
        // longer holds one, and the expiry sweep still has to run.
        self.alarm_message.replace(storage.get("alarm").await.ok().flatten());

        self.game.replace(self.journal.load(&storage).await);
        self.owner.replace(storage.get("host_owner").await.ok().flatten());
        self.creation_ready
            .set(storage.get("host_ready").await.ok().flatten().unwrap_or(false));
        self.game_due.set(
            storage
                .get("game_due")
                .await
                .ok()
                .flatten()
                .or(storage.get_alarm().await.ok().flatten().map(|v| v as u64)),
        );
        self.loaded.set(true);
        self.completion_due
            .set(storage.get("completion_due").await.ok().flatten());
        self.completion_attempts
            .set(storage.get("completion_attempts").await.ok().flatten().unwrap_or(0));
        // Recovery never revives a previously cached authorization decision.
        for socket in self.state.get_websockets() {
            if let Some(mut a) = attachment(&socket) {
                if let Some(host) = &mut a.host {
                    host.gate.pause();
                    host.gate.until = 0;
                    let _ = socket.serialize_attachment(a);
                } else if self.is_host(a.watcher) {
                    deny(&socket);
                }
            }
        }
    }

    /// Runs an event against the game and appends it to the log.
    ///
    /// This is the only path that mutates a live game, so every change the
    /// object makes is one a replay can make again. Returns `None` when there
    /// is no game to apply it to, otherwise whether the watcher was admitted.
    async fn record(&self, event: Event) -> Result<Option<std::result::Result<(), watcher::Error>>> {
        let tick = Tick::sample();
        let mut scheduled = None;

        let Some(admission) = self.with_mut_game(|game| {
            fuiz::wal::apply(
                game,
                &event,
                tick,
                |message: fuiz::AlarmMessage, duration: Duration| scheduled = Some((message, duration)),
                self.tunnel_finder(),
            )
        }) else {
            return Ok(None);
        };

        // The event is already in the live game and already on its way to
        // clients. If it could not be appended, fold it into a snapshot rather
        // than leave it in memory alone: the next scheduled snapshot could be
        // a hundred messages away, and an eviction before then would lose a
        // change players have already seen.
        if let Err(error) = self.journal.append(&self.state.storage(), tick, event).await {
            console_error!("Error appending log entry, snapshotting instead: {:?}", error);
            self.snapshot().await?;
        }

        self.update_alarm(scheduled).await?;
        self.notify_completion().await?;

        if self.journal.snapshot_due() {
            self.snapshot().await?;
        }

        Ok(Some(admission))
    }

    /// Rewrites the alarm bookkeeping the way the pre-log object did: a
    /// scheduled transition when the game asked for one, otherwise the expiry
    /// sweep, so an abandoned game still cleans itself up.
    async fn update_alarm(&self, scheduled: Option<(fuiz::AlarmMessage, Duration)>) -> Result<()> {
        if let Some((message, duration)) = scheduled {
            self.alarm_message.replace(Some(AlarmMessage::Game(message)));
            self.game_due.set(Some(auth::now() + duration.as_millis() as u64));
        } else if self.game_due.get().is_none() {
            self.alarm_message.replace(Some(AlarmMessage::DeleteGame));
            self.game_due.set(Some(auth::now() + GAME_EXPIRY.as_millis() as u64));
        }
        self.state.storage().put("alarm", &self.alarm_message).await?;
        self.state.storage().put("game_due", self.game_due.get()).await?;
        self.arm().await
    }
    // Durable Objects have one alarm slot. Keep independent deadlines and arm the earliest
    // so authorization polling cannot overwrite a slide transition or completion retry.
    async fn arm(&self) -> Result<()> {
        let host_due = self
            .state
            .get_websockets()
            .iter()
            .filter_map(|ws| attachment(ws)?.host.filter(|h| !h.gate.closed).map(|h| h.gate.until))
            .min();
        let inactivity_due = self
            .borrow_game()
            .and_then(|g| g.host_deadline(Tick::sample()))
            .map(|(_, delay)| auth::now() + delay.as_millis() as u64);
        if let Some(due) = self
            .game_due
            .get()
            .into_iter()
            .chain(host_due)
            .chain(inactivity_due)
            .chain(self.completion_due.get())
            .min()
        {
            self.state
                .storage()
                .set_alarm(Duration::from_millis(due.saturating_sub(auth::now()).max(1)))
                .await?;
        }
        Ok(())
    }

    async fn notify_completion(&self) -> Result<()> {
        if !self.borrow_game().is_some_and(|g| matches!(g.state, game::State::Done))
            || self.completion_attempts.get() >= 3
            || self.completion_due.get().is_some_and(|due| due > auth::now())
        {
            return Ok(());
        }
        // A paused Host still needs the current binding to authorize queued
        // Summary delivery. Authorization checks are bounded and fail closed.
        let pending = self.state.get_websockets().iter().any(|ws| {
            attachment(ws).is_some_and(|a| {
                !a.closed
                    && a.host.is_some()
                    && self
                        .deferred
                        .borrow()
                        .get(&a.connection)
                        .is_some_and(|queue| !queue.borrow().is_empty())
            })
        });
        if pending {
            self.completion_due.set(Some(auth::now() + 1000));
            self.state
                .storage()
                .put("completion_due", self.completion_due.get())
                .await?;
            return self.arm().await;
        }
        let Some(owner) = self.owner.borrow().clone() else {
            return Ok(());
        };
        let attempts = self.completion_attempts.get() + 1;
        self.completion_attempts.set(attempts);
        self.state.storage().put("completion_attempts", attempts).await?;
        let success = auth::complete(&self.env, &owner.grant, &owner.code, &owner.watcher.to_string()).await;
        if success {
            self.completion_attempts.set(3);
            self.state.storage().put("completion_attempts", 3u8).await?;
        } else if attempts == 3 {
            console_error!(
                "game completion notification failed: instance={}",
                owner.grant.instance_id
            );
        }
        self.completion_due
            .set((!success && attempts < 3).then(|| auth::now() + 1000));
        self.state
            .storage()
            .put("completion_due", self.completion_due.get())
            .await?;
        self.arm().await
    }
    fn is_host(&self, id: watcher::Id) -> bool {
        self.borrow_game().is_some_and(|game| {
            game.watchers
                .get_watcher_value_ref(id)
                .is_some_and(|v| matches!(v, watcher::Value::Host))
        })
    }
    async fn check_host(&self, ws: &WebSocket, replacement: Option<&str>) -> Result<bool> {
        let _guard = self.host_check.lock().await;
        let Some(mut a) = attachment(ws) else {
            deny(ws);
            return Ok(false);
        };
        if a.closed || (a.connected && a.host.is_none()) {
            deny(ws);
            return Ok(false);
        }
        if a.host.as_ref().is_some_and(|h| h.gate.closed) {
            deny(ws);
            return Ok(false);
        }
        let token = replacement
            .map(str::to_owned)
            .or_else(|| a.host.as_ref().map(|h| h.token.clone()));
        let Some(token) = token else {
            deny(ws);
            return Ok(false);
        };
        let previous = a.host.clone();
        if let Some(host) = &mut a.host {
            host.gate.pause();
            ws.serialize_attachment(&a)?;
        }
        let started = auth::now();
        let Some(grant) = auth::authorize(&self.env, &token, "host-game").await else {
            deny(ws);
            return Ok(false);
        };
        if !self
            .owner
            .borrow()
            .as_ref()
            .is_some_and(|owner| owner.matches(&grant) && owner.watcher == a.watcher)
            || previous.as_ref().is_some_and(|old| !old.grant.same_host(&grant))
            || attachment(ws).is_some_and(|latest| latest.closed || latest.host.is_some_and(|h| h.gate.closed))
        {
            deny(ws);
            return Ok(false);
        }
        // A concurrent signed revoke cannot be undone by an in-flight callback.
        if self
            .state
            .storage()
            .get::<u64>(&format!("revoked:{}", grant.user_id))
            .await?
            .is_some_and(|min| grant.session_version < min)
        {
            deny(ws);
            return Ok(false);
        }
        if attachment(ws).is_none_or(|latest| latest.closed) {
            deny(ws);
            return Ok(false);
        }
        let recovered = a.connected && previous.as_ref().is_some_and(|h| h.gate.until == 0);
        let watcher = a.watcher;
        let mut gate = TrafficGate::default();
        gate.authorize(started, grant.expires_at);
        a.host = Some(HostSession { token, grant, gate });
        ws.serialize_attachment(a)?;
        let tunnel = self.tunnel(ws.clone());
        let queued = tunnel.1.borrow_mut().take();
        for message in queued {
            tunnel.send(message);
        }
        if recovered {
            self.record(Event::Resynced(watcher)).await?;
        }
        self.arm().await?;
        Ok(true)
    }

    async fn create_owned_game(&self, body: &str) -> Result<Response> {
        let creation: Creation = serde_json::from_str(body)?;
        let Some(grant) = auth::authorize(&self.env, &creation.grant, "create-game").await else {
            return Response::error("Unauthorized", 401);
        };
        let _guard = self.creation.lock().await;
        if self
            .state
            .storage()
            .get::<u64>("cancelled_until")
            .await?
            .is_some_and(|until| until > auth::now())
        {
            return Response::error("Cancelled", 409);
        }
        if let Some(owner) = self.owner.borrow().as_ref() {
            if !self.creation_ready.get() || self.borrow_game().is_none() {
                return Response::error("Creation unavailable", 503);
            }
            return if owner.grant == grant && owner.code == creation.code {
                Response::from_json(
                    &serde_json::json!({"game_id":owner.code,"watcher_id":owner.watcher,"instance_id":owner.grant.instance_id}),
                )
            } else {
                Response::error("Conflict", 409)
            };
        }
        if self.borrow_game().is_some() {
            return Response::error("Conflict", 409);
        }
        let settings = fuiz::settings::Settings::default();
        if creation.game.validate_with(&settings).is_err() {
            return Response::error("Invalid game", 400);
        }
        let owner = Owner {
            grant,
            code: creation.code,
            watcher: watcher::Id::new(),
        };
        self.state.storage().put("host_owner", &owner).await?;
        self.game.replace(Some(fuiz::game::Game::new(
            creation.game.config,
            creation.game.options,
            owner.watcher,
            &settings,
        )));
        self.owner.replace(Some(owner.clone()));
        self.with_mut_game(|game| game.initialize_host_timeout(Tick::sample()));
        self.snapshot().await?;
        self.update_alarm(None).await?;
        // Replayed creation requests may be acknowledged only after owner, snapshot and alarm
        // persistence completed; host_owner alone can be a partially initialized allocation.
        self.state.storage().put("host_ready", true).await?;
        self.creation_ready.set(true);
        Response::from_json(
            &serde_json::json!({"game_id":owner.code,"watcher_id":owner.watcher,"instance_id":owner.grant.instance_id}),
        )
    }

    /// Hands the live game to the journal to be written out whole.
    ///
    /// Encoded first so the borrow is released before the write awaits.
    async fn snapshot(&self) -> Result<()> {
        let Some(snapshot) = self.borrow_game().map(|game| Journal::encode(&game)).transpose()? else {
            return Ok(());
        };

        self.journal
            .write_snapshot(&self.state.storage(), snapshot, &self.connected())
            .await
    }

    /// Records a join or rejoin, telling the client and dropping the socket if
    /// the game turned them away.
    async fn admit(&self, event: Event, session: &WebSocketTunnel) -> Result<()> {
        if let Some(Err(error)) = self.record(event).await? {
            session.send_message(&game::UpdateMessage::CannotJoin(error).into());
            session.close_tunnel();
        }

        Ok(())
    }

    /// The watchers currently holding a socket, which is what the game's
    /// tunnel finder answers from and therefore what a replay has to start
    /// from.
    fn connected(&self) -> FxHashSet<watcher::Id> {
        self.state
            .get_websockets()
            .into_iter()
            .filter_map(|socket| {
                attachment(&socket)
                    .filter(|a| a.connected && !a.closed)
                    .map(|a| a.watcher)
            })
            .collect()
    }
}

impl Game {
    fn borrow_game_mut(&self) -> Option<RefMut<'_, fuiz::game::Game>> {
        let game = RefMut::filter_map(self.game.borrow_mut(), std::option::Option::as_mut);

        game.ok()
    }

    fn borrow_game(&self) -> Option<std::cell::Ref<'_, fuiz::game::Game>> {
        let game = std::cell::Ref::filter_map(self.game.borrow(), std::option::Option::as_ref);

        game.ok()
    }

    fn with_mut_game<F, R>(&self, f: F) -> Option<R>
    where
        F: FnOnce(&mut fuiz::game::Game) -> R,
    {
        self.borrow_game_mut().map(|mut game| f(&mut game))
    }

    fn tunnel(&self, ws: WebSocket) -> WebSocketTunnel {
        let id = attachment(&ws).map_or_else(watcher::Id::new, |a| a.connection);
        let queue = self.deferred.borrow_mut().entry(id).or_default().clone();
        WebSocketTunnel(ws, queue)
    }
    fn tunnel_finder(&self) -> impl Fn(watcher::Id) -> Option<WebSocketTunnel> + '_ {
        |id| {
            self.state
                .get_websockets_with_tag(&id.to_string())
                .into_iter()
                .find(|ws| {
                    attachment(ws).is_some_and(|a| {
                        a.connected
                            && !a.closed
                            && (a.host.as_ref().map_or_else(
                                || self.owner.borrow().as_ref().is_none_or(|owner| owner.watcher != id),
                                |_| true,
                            ))
                    })
                })
                .map(|ws| self.tunnel(ws))
        }
    }

    async fn increment_player_count(&self) -> Result<()> {
        self.env
            .service("COUNTER")?
            .fetch("https://example.com/player_count", {
                Some(RequestInit {
                    method: Method::Post,
                    ..RequestInit::default()
                })
            })
            .await?;

        Ok(())
    }
}

impl DurableObject for Game {
    fn new(state: State, env: Env) -> Self {
        Self {
            game: None.into(),
            alarm_message: None.into(),
            journal: Journal::new(),
            loaded: Cell::new(false),
            loading: futures_util::lock::Mutex::new(()),
            deferred: RefCell::default(),
            state,
            env,
            owner: None.into(),
            creation_ready: Cell::new(false),
            game_due: Cell::new(None),
            completion_due: Cell::new(None),
            completion_attempts: Cell::new(0),
            host_check: futures_util::lock::Mutex::new(()),
            creation: futures_util::lock::Mutex::new(()),
            connections: RefCell::default(),
        }
    }

    async fn alarm(&self) -> Result<Response> {
        self.load_state().await;
        let deadline = self.borrow_game().and_then(|g| g.host_deadline(Tick::sample()));
        if let Some((generation, delay)) = deadline
            && delay.is_zero()
        {
            self.record(Event::HostTimeout(generation)).await?;
        }
        self.notify_completion().await?;

        // Keep the participant transition separate from idle authorization polling.
        if self.game_due.get().is_none_or(|due| due > auth::now()) {
            for ws in self.state.get_websockets() {
                if attachment(&ws)
                    .is_some_and(|a| a.host.is_some_and(|h| !h.gate.closed && h.gate.until <= auth::now()))
                {
                    self.check_host(&ws, None).await?;
                }
            }
            self.arm().await?;
            return Response::empty();
        }
        self.game_due.set(None);
        let alarm_message_to_be_announced = self.alarm_message.take();

        match alarm_message_to_be_announced {
            Some(AlarmMessage::DeleteGame) => {
                self.state.storage().delete_all().await?;

                // The snapshot and the log went with it, so a straggling
                // message must not append against the sequence they were under.
                self.game.replace(None);
                self.journal.reset();

                return Response::ok("");
            }
            Some(AlarmMessage::Game(message)) => {
                self.record(Event::Alarm(message)).await?;
            }
            _ => {}
        }

        for ws in self.state.get_websockets() {
            if attachment(&ws).is_some_and(|a| a.host.is_some_and(|h| !h.gate.closed && h.gate.until <= auth::now())) {
                self.check_host(&ws, None).await?;
            }
        }
        self.arm().await?;
        Response::ok("")
    }

    async fn fetch(&self, mut req: Request) -> Result<Response> {
        self.load_state().await;

        let path = req.url()?.path().to_owned();
        if path == "/add" || path.starts_with("/internal/") {
            let body = req.text().await?;
            if req.method() != Method::Post || !auth::service(&self.env, &req, body.as_bytes()) {
                return Response::error("Unauthorized", 401);
            }
            if path == "/internal/host/revoke" {
                let revocation: Revocation = serde_json::from_str(&body)?;
                for ws in self.state.get_websockets() {
                    if attachment(&ws).is_some_and(|a| {
                        a.host.is_some_and(|h| {
                            h.grant.user_id == revocation.user_id
                                && h.grant.session_version < revocation.min_session_version
                        })
                    }) {
                        deny(&ws);
                    }
                }
                let key = format!("revoked:{}", revocation.user_id);
                let min = self
                    .state
                    .storage()
                    .get::<u64>(&key)
                    .await?
                    .unwrap_or(0)
                    .max(revocation.min_session_version);
                self.state.storage().put(&key, min).await?;
                return Response::empty();
            }
            if path == "/internal/host/games/remove" {
                let removal: Removal = serde_json::from_str(&body)?;
                let _guard = self.creation.lock().await;
                self.state
                    .storage()
                    .put("cancelled_until", auth::now() + CANCELLATION_MS)
                    .await?;
                if self
                    .owner
                    .borrow()
                    .as_ref()
                    .is_some_and(|o| o.grant.instance_id == removal.instance_id)
                {
                    for ws in self.state.get_websockets() {
                        deny(&ws);
                    }
                    // Explicit failed-creation cleanup only; revocation never deletes game state.
                    self.game.replace(None);
                    self.owner.replace(None);
                    self.state.storage().delete("count").await?;
                    self.state.storage().delete("host_owner").await?;
                }
                return Response::empty();
            }
            return if path == "/add" {
                self.create_owned_game(&body).await
            } else {
                Response::error("Not Found", 404)
            };
        }

        if req.url()?.path().starts_with("/alive") {
            let Some(game) = self.borrow_game() else {
                return Response::ok("false");
            };

            return Response::ok(if matches!(game.state, game::State::Done) {
                "false"
            } else {
                "true"
            });
        }

        if self
            .borrow_game()
            .is_none_or(|game| matches!(game.state, game::State::Done))
        {
            return Response::error("Game ended", 404);
        }
        let WebSocketPair { client, server } = WebSocketPair::new()?;

        let claimed_id = req
            .url()?
            .path_segments()
            .and_then(|mut ps| ps.next_back())
            .and_then(|s| watcher::Id::from_str(s).clone().ok())
            .unwrap_or(watcher::Id::new());

        self.state
            .accept_websocket_with_tags(&server, &[&claimed_id.to_string()]);
        server.serialize_attachment(Attachment {
            connection: watcher::Id::new(),
            closed: false,
            watcher: claimed_id,
            connected: false,
            host: None,
        })?;

        Response::from_websocket(client)
    }

    async fn websocket_message(&self, ws: WebSocket, message: WebSocketIncomingMessage) -> Result<()> {
        self.load_state().await;
        let Some(initial) = attachment(&ws) else {
            deny(&ws);
            return Ok(());
        };
        let queue = self
            .connections
            .borrow_mut()
            .entry(initial.connection)
            .or_insert_with(|| std::rc::Rc::new(futures_util::lock::Mutex::new(())))
            .clone();
        let _ordered = queue.lock().await;
        if attachment(&ws).is_none_or(|a| a.closed) {
            return Ok(());
        }
        let WebSocketIncomingMessage::String(serialized) = message else {
            return Ok(());
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&serialized) else {
            return Ok(());
        };
        let Some(mut a) = attachment(&ws) else {
            deny(&ws);
            return Ok(());
        };
        if let Some(token) = value.get("Authorization").and_then(serde_json::Value::as_str) {
            if value.as_object().is_none_or(|v| v.len() != 1) {
                deny(&ws);
                return Ok(());
            }
            self.check_host(&ws, Some(token)).await?;
            return Ok(());
        }
        let Ok(message) = serde_json::from_value::<game::IncomingMessage>(value) else {
            return Ok(());
        };
        if a.host.is_some() {
            if !self.check_host(&ws, None).await? {
                return Ok(());
            }
            a = attachment(&ws).unwrap();
        } else if self.is_host(a.watcher) || matches!(message, game::IncomingMessage::Host(_)) {
            deny(&ws);
            return Ok(());
        }
        match message {
            game::IncomingMessage::Ghost(ghost) => {
                if a.connected {
                    return Ok(());
                }
                if let game::IncomingGhostMessage::ClaimId(id) = ghost
                    && (id != a.watcher || (self.is_host(id) && a.host.is_none()))
                {
                    deny(&ws);
                    return Ok(());
                }
                if matches!(ghost, game::IncomingGhostMessage::DemandId) && a.host.is_some() {
                    deny(&ws);
                    return Ok(());
                }
                close_connections_with_tag_except_one(&self.state, &a.watcher, &ws);
                a.connected = true;
                ws.serialize_attachment(&a)?;
                let session = self.tunnel(ws);
                session.send_message(&game::UpdateMessage::IdAssign(a.watcher).into());
                let event = if matches!(ghost, game::IncomingGhostMessage::DemandId) {
                    Event::Joined(a.watcher)
                } else {
                    Event::Rejoined(a.watcher)
                };
                self.admit(event, &session).await?;
                if matches!(ghost, game::IncomingGhostMessage::DemandId) {
                    let _ = self.increment_player_count().await;
                }
            }
            _ if !a.connected => {
                deny(&ws);
            }
            game::IncomingMessage::Host(game::IncomingHostMessage::RequestTeamRosters) => {
                if let Some(game) = self.borrow_game() {
                    game.send_team_rosters(a.watcher, self.tunnel_finder());
                }
            }
            message => {
                self.record(Event::Received(a.watcher, message)).await?;
            }
        }
        Ok(())
    }
    async fn websocket_close(&self, ws: WebSocket, _code: usize, _reason: String, _was_clean: bool) -> Result<()> {
        self.load_state().await;
        let Some(a) = attachment(&ws) else {
            return Ok(());
        };
        // A stale close must not disconnect the replacement authorized socket in the journal.
        let replaced = self
            .state
            .get_websockets_with_tag(&a.watcher.to_string())
            .iter()
            .any(|other| other != &ws && attachment(other).is_some_and(|b| b.connected && !b.closed));
        self.connections.borrow_mut().remove(&a.connection);
        self.deferred.borrow_mut().remove(&a.connection);
        if a.connected && !replaced {
            self.record(Event::Left(a.watcher)).await?;
        }
        Ok(())
    }
}

fn close_connections_with_tag_except_one(state: &State, tag: &watcher::Id, ws: &WebSocket) {
    state
        .get_websockets_with_tag(&tag.to_string())
        .into_iter()
        .filter(|web_socket| web_socket != ws)
        .for_each(close_web_socket);
}

#[allow(clippy::needless_pass_by_value)]
fn close_web_socket(web_socket: WebSocket) {
    deny(&web_socket);
}
