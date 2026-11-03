use crate::{
    authorization::now,
    host_authorization::{CANCELLATION_MS, Grant, Revocation},
};
use std::{collections::HashMap, time::Duration};

use enum_map::EnumMap;
use thiserror::Error;

use crate::{Session, clashmap::ClashMap};

use fuiz::tick::Tick;
use fuiz::{
    AlarmMessage,
    fuiz::config::Fuiz,
    game::{self, Game, IncomingMessage, Options},
    game_id::GameId,
    watcher::{self, Id},
};

#[derive(Debug, Default)]
struct SharedGame(parking_lot::RwLock<Option<Box<Game>>>);

impl SharedGame {
    pub fn with_game<R>(&self, f: impl FnOnce(&Game) -> R) -> Option<R> {
        let guard = self.0.read();
        let game = guard.as_deref()?;
        if matches!(game.state, game::State::Done) {
            None
        } else {
            Some(f(game))
        }
    }

    pub fn with_game_mut<R>(&self, f: impl FnOnce(&mut Game) -> R) -> Option<R> {
        let mut guard = self.0.write();
        let game = guard.as_deref_mut()?;
        if matches!(game.state, game::State::Done) {
            None
        } else {
            Some(f(game))
        }
    }
}

#[derive(Default)]
pub struct GameManager {
    games: EnumMap<GameId, SharedGame>,
    watcher_mapping: ClashMap<Id, Session>,
    ownership: parking_lot::Mutex<Ownership>,
    hosts: parking_lot::RwLock<HashMap<Id, GameId>>,
    #[cfg(test)]
    after_detach_removal: parking_lot::Mutex<Option<Box<dyn FnOnce() + Send>>>,
}

#[derive(Default)]
struct Ownership {
    instances: HashMap<String, Binding>,
    cancelled: HashMap<String, u64>,
}
#[derive(Clone)]
pub(crate) struct Binding {
    pub grant: Grant,
    pub code: GameId,
    pub watcher: Id,
}
impl Binding {
    pub fn matches(&self, grant: &Grant) -> bool {
        self.grant.instance_id == grant.instance_id
            && self.grant.user_id == grant.user_id
            && grant.game_code.as_deref() == Some(&self.code.to_string())
            && grant.watcher_id.as_deref() == Some(&self.watcher.to_string())
    }
}

#[derive(Debug, Error)]
#[error("game does not exist")]
pub struct GameVanish {}

impl actix_web::error::ResponseError for GameVanish {
    fn status_code(&self) -> actix_web::http::StatusCode {
        actix_web::http::StatusCode::NOT_FOUND
    }
}

impl GameManager {
    pub fn add_owned_game(
        &self,
        fuiz: Fuiz,
        options: Options,
        grant: Grant,
        settings: &fuiz::settings::Settings,
    ) -> Option<Binding> {
        // Serialize allocation/cancellation, shard by instance if creation throughput needs it.
        let mut ownership = self.ownership.lock();
        if grant.expires_at <= now() {
            return None;
        }
        ownership.cancelled.retain(|_, until| *until > now());
        if ownership.cancelled.contains_key(&grant.instance_id) {
            return None;
        }
        if let Some(binding) = ownership.instances.get(&grant.instance_id) {
            return (binding.grant == grant && self.exists(binding.code).is_ok()).then(|| binding.clone());
        }
        let watcher = Id::new();
        let code = self.add_game(fuiz, options, watcher, settings);
        let binding = Binding { grant, code, watcher };
        ownership
            .instances
            .insert(binding.grant.instance_id.clone(), binding.clone());
        Some(binding)
    }
    pub fn binding(&self, code: GameId) -> Option<Binding> {
        self.ownership
            .lock()
            .instances
            .values()
            .find(|binding| binding.code == code && self.exists(code).is_ok())
            .cloned()
    }
    pub fn is_host(&self, id: Id) -> bool {
        self.hosts.read().contains_key(&id)
    }
    pub fn remove_instance(&self, instance: &str) {
        let mut ownership = self.ownership.lock();
        // Cleanup may arrive before allocation finishes. Keep a tombstone through the grant's
        // maximum lifetime so a delayed create cannot resurrect the cancelled instance.
        ownership.cancelled.insert(instance.to_owned(), now() + CANCELLATION_MS);
        if let Some(binding) = ownership.instances.remove(instance) {
            self.remove_game(binding.code);
        }
    }
    pub fn revoke(&self, revocation: &Revocation) {
        for (_, session) in self.watcher_mapping.entries() {
            if session.identity.lock().as_ref().is_some_and(|grant| {
                grant.user_id == revocation.user_id && grant.session_version < revocation.min_session_version
            }) {
                session.deny();
            }
        }
    }
    pub fn current_tunnel(&self, watcher: Id, connection: Id) -> bool {
        self.watcher_mapping
            .get(&watcher)
            .is_some_and(|s| s.connection == connection && !s.gate.lock().closed)
    }
    pub fn detach(&self, game: GameId, watcher: Id, connection: Id) {
        if self
            .watcher_mapping
            .remove_if(&watcher, |s| s.connection == connection)
            .is_some()
        {
            #[cfg(test)]
            if let Some(after_removal) = self.after_detach_removal.lock().take() {
                after_removal();
            }
            let _ = self.watcher_left_if_disconnected(game, watcher);
        }
    }
    fn with_game<R>(&self, game_id: GameId, f: impl FnOnce(&Game) -> R) -> Result<R, GameVanish> {
        self.games[game_id].with_game(f).ok_or(GameVanish {})
    }

    fn with_game_mut<R>(&self, game_id: GameId, f: impl FnOnce(&mut Game) -> R) -> Result<R, GameVanish> {
        self.games[game_id].with_game_mut(f).ok_or(GameVanish {})
    }

    pub fn add_game(&self, fuiz: Fuiz, options: Options, host_id: Id, settings: &fuiz::settings::Settings) -> GameId {
        let mut shared_game = Box::new(Game::new(fuiz, options, host_id, settings));
        shared_game.initialize_host_timeout(Tick::sample());

        loop {
            let game_id = GameId::new();

            let Some(mut game) = self.games[game_id].0.try_write() else {
                continue;
            };

            if game.is_none() {
                *game = Some(shared_game);
                self.hosts.write().insert(host_id, game_id);
                return game_id;
            }
        }
    }

    fn tunnel_finder(&self, watcher_id: Id) -> Option<Session> {
        self.watcher_mapping.get(&watcher_id)
    }

    pub fn set_tunnel(&self, watcher_id: Id, tunnel: Session) -> Option<Session> {
        let previous = self.watcher_mapping.insert(watcher_id, tunnel);
        if let Some(old) = &previous {
            old.deny();
        }
        previous
    }

    pub fn add_unassigned(&self, game_id: GameId, watcher_id: Id) -> Result<Result<(), watcher::Error>, GameVanish> {
        self.with_game_mut(game_id, |game| {
            game.add_unassigned(watcher_id, Tick::default(), |id| self.tunnel_finder(id))
        })
    }

    pub fn receive_message<F: Fn(AlarmMessage, Duration)>(
        &self,
        game_id: GameId,
        watcher_id: Id,
        message: IncomingMessage,
        schedule_message: F,
    ) -> Result<(), GameVanish> {
        self.with_game_mut(game_id, |game| {
            game.receive_message(watcher_id, message, schedule_message, Tick::default(), |id| {
                self.tunnel_finder(id)
            });
        })
    }

    pub fn receive_alarm<F: Fn(AlarmMessage, Duration)>(
        &self,
        game_id: GameId,
        host: Option<Id>,
        alarm_message: &AlarmMessage,
        schedule_message: F,
    ) -> Result<(), GameVanish> {
        self.with_game_mut(game_id, |game| {
            // Sleeping tasks outlive sockets and codes can be reused; only the captured host
            // identity ties this alarm to the allocation that originally scheduled it.
            if host.is_none_or(|id| !matches!(game.watchers.get_watcher_value_ref(id), Some(watcher::Value::Host))) {
                return;
            }
            game.receive_alarm(alarm_message, schedule_message, Tick::default(), |id| {
                self.tunnel_finder(id)
            });
        })
    }

    fn watcher_left_if_disconnected(&self, game_id: GameId, watcher_id: Id) -> Result<(), GameVanish> {
        self.with_game_mut(game_id, |game| {
            // Rejoin uses this same game lock. If replacement registration races
            // this check, its rejoin either already completed (so skip leaving)
            // or runs after this leave and restores the live watcher set.
            // Lock order is game -> tunnel map, never a retained map guard -> game.
            if self.watcher_mapping.get(&watcher_id).is_none() {
                game.host_disconnected(watcher_id, Tick::default());
                game.watcher_left(watcher_id, |id| self.tunnel_finder(id));
            }
        })
    }

    pub fn exists(&self, game_id: GameId) -> Result<(), GameVanish> {
        self.with_game(game_id, |_| ())
    }

    pub fn rejoin(&self, game_id: GameId, watcher_id: Id) -> Result<Result<(), watcher::Error>, GameVanish> {
        self.with_game_mut(game_id, |game| {
            let tick = Tick::default();
            let result = game.rejoin(watcher_id, tick, |id| self.tunnel_finder(id));
            if result.is_ok() {
                game.host_connected(watcher_id, tick, |id| self.tunnel_finder(id));
            }
            result
        })
    }

    /// The captured host UUID binds polling to this exact allocation, even after code reuse.
    pub fn poll_host_timeout(&self, binding: &Binding) -> Option<bool> {
        let mut guard = self.games[binding.code].0.write();
        let game = guard.as_deref_mut()?;
        if !matches!(
            game.watchers.get_watcher_value_ref(binding.watcher),
            Some(watcher::Value::Host)
        ) {
            return None;
        }
        let tick = Tick::default();
        if let Some((generation, delay)) = game.host_deadline(tick)
            && delay.is_zero()
        {
            game.check_host_timeout(generation, tick, |id| self.tunnel_finder(id));
        }
        Some(matches!(game.state, game::State::Done))
    }

    pub fn completion_ready(&self, binding: &Binding) -> bool {
        self.watcher_mapping.get(&binding.watcher).is_none_or(|session| {
            let gate = session.gate.lock();
            gate.closed || (gate.permits(now()) && session.deferred.lock().is_empty())
        })
    }

    pub fn remove_game(&self, game_id: GameId) {
        let mut game = self.games[game_id].0.write();
        if let Some(mut ongoing_game) = game.take() {
            ongoing_game.mark_as_done(|id| self.tunnel_finder(id));
        }
    }
}

#[cfg(test)]
mod host_binding_tests {
    use super::*;
    fn config() -> Fuiz {
        Fuiz {
            title: "test".into(),
            slides: vec![],
        }
    }
    fn grant(instance: &str) -> Grant {
        Grant {
            purpose: "create-game".into(),
            user_id: "owner".into(),
            session_version: 0,
            issued_at: now(),
            expires_at: now() + 60_000,
            instance_id: instance.into(),
            game_code: None,
            watcher_id: None,
        }
    }
    async fn socket() -> (Session, actix_web::body::BoxBody) {
        use actix_web::FromRequest;
        let (request, mut payload) = actix_web::test::TestRequest::get()
            .insert_header(("Upgrade", "websocket"))
            .insert_header(("Connection", "Upgrade"))
            .insert_header(("Sec-WebSocket-Version", "13"))
            .insert_header(("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ=="))
            .to_http_parts();
        let payload = actix_web::web::Payload::from_request(&request, &mut payload)
            .await
            .unwrap();
        let (response, session, _) = actix_ws::handle(&request, payload).unwrap();
        let session = Session::new(session);
        session.authorize(now(), u64::MAX);
        (session, response.into_body())
    }

    async fn receives(body: &mut actix_web::body::BoxBody, text: &str) -> bool {
        use actix_web::body::MessageBody;
        actix_web::rt::time::timeout(Duration::from_millis(500), async {
            loop {
                let chunk = futures_util::future::poll_fn(|cx| std::pin::Pin::new(&mut *body).poll_next(cx))
                    .await
                    .expect("socket stays open")
                    .unwrap();
                if chunk.windows(text.len()).any(|window| window == text.as_bytes()) {
                    return;
                }
            }
        })
        .await
        .is_ok()
    }

    #[actix_web::test]
    async fn replacement_receives_broadcast_after_old_detach_resumes() {
        let manager = std::sync::Arc::new(GameManager::default());
        let host = Id::new();
        let code = manager.add_game(config(), Options::default(), host, &fuiz::settings::Settings::default());
        let (old, _old_body) = socket().await;
        let old_connection = old.connection;
        manager.set_tunnel(host, old);
        manager.rejoin(code, host).unwrap().unwrap();

        let (removed_tx, removed_rx) = std::sync::mpsc::channel();
        let (resume_tx, resume_rx) = std::sync::mpsc::channel();
        *manager.after_detach_removal.lock() = Some(Box::new(move || {
            removed_tx.send(()).unwrap();
            resume_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        }));
        let cleanup_manager = manager.clone();
        let cleanup = std::thread::spawn(move || cleanup_manager.detach(code, host, old_connection));
        removed_rx.recv_timeout(Duration::from_secs(5)).unwrap();

        // Complete reconnect while old cleanup is stopped *after* removing its tunnel.
        let (replacement, mut body) = socket().await;
        let replacement_connection = replacement.connection;
        manager.set_tunnel(host, replacement);
        manager.rejoin(code, host).unwrap().unwrap();
        assert!(receives(&mut body, "WaitingScreen").await);
        resume_tx.send(()).unwrap();
        cleanup.join().unwrap();
        assert!(manager.current_tunnel(host, replacement_connection));

        let player = Id::new();
        manager.add_unassigned(code, player).unwrap().unwrap();
        manager
            .receive_message(
                code,
                player,
                IncomingMessage::Unassigned(game::IncomingUnassignedMessage::NameRequest("later-player".into())),
                |_, _| {},
            )
            .unwrap();
        assert!(
            receives(
                &mut body,
                r#""PlayerJoined":{"name":"later-player","avatar":"avatar-01"}"#
            )
            .await,
            "old cleanup must not mark the connected replacement offline"
        );
    }

    #[test]
    fn legacy_hosts_cannot_be_reclaimed_as_participants() {
        let manager = GameManager::default();
        let host = Id::new();
        manager.add_game(config(), Options::default(), host, &fuiz::settings::Settings::default());
        assert!(manager.is_host(host));
    }
    #[test]
    fn expired_creation_cannot_allocate_after_callback() {
        let manager = GameManager::default();
        let mut grant = grant("expired");
        grant.expires_at = now() - 1;
        assert!(
            manager
                .add_owned_game(
                    config(),
                    Options::default(),
                    grant,
                    &fuiz::settings::Settings::default()
                )
                .is_none()
        );
    }
    #[test]
    fn cancellation_before_allocation_blocks_replay() {
        let manager = GameManager::default();
        manager.remove_instance("cancelled");
        assert!(
            manager
                .add_owned_game(
                    config(),
                    Options::default(),
                    grant("cancelled"),
                    &fuiz::settings::Settings::default()
                )
                .is_none()
        );
    }
    #[test]
    fn concurrent_creation_replay_allocates_one_instance() {
        let manager = std::sync::Arc::new(GameManager::default());
        let grant = grant("same-instance");
        let jobs: Vec<_> = (0..16)
            .map(|_| {
                let manager = manager.clone();
                let grant = grant.clone();
                std::thread::spawn(move || {
                    manager
                        .add_owned_game(
                            config(),
                            Options::default(),
                            grant,
                            &fuiz::settings::Settings::default(),
                        )
                        .unwrap()
                        .code
                })
            })
            .collect();
        let codes: Vec<_> = jobs.into_iter().map(|job| job.join().unwrap()).collect();
        assert!(codes.iter().all(|code| *code == codes[0]));
        manager.remove_instance("same-instance");
        assert!(manager.exists(codes[0]).is_err());
    }
}
