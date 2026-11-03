use super::*;
use crate::{
    host_timeout::{DEFAULT_GAME_TIMEOUT, DEFAULT_GAME_TIMEOUT_WARNING},
    session::Tunnel,
    wal,
};
use std::{cell::RefCell, rc::Rc, time::Duration};

#[derive(Clone, Default)]
struct Wire(Rc<RefCell<Vec<serde_json::Value>>>);
impl Tunnel for Wire {
    fn send_message(&self, value: &crate::UpdateMessage) {
        self.0.borrow_mut().push(serde_json::to_value(value).unwrap());
    }
    fn send_state(&self, value: &crate::SyncMessage) {
        self.0.borrow_mut().push(serde_json::to_value(value).unwrap());
    }
    fn close(self) {
        panic!("Summary must not close sockets");
    }
}
fn tick(time: Duration) -> Tick {
    serde_json::from_value(serde_json::json!({"now":{"nanos_since_epoch":time.as_nanos() as u64},"seed":1})).unwrap()
}
fn setup() -> (Game, Id, Id, Wire, Wire) {
    let host = Id::new();
    let player = Id::new();
    let mut game = Game::new(
        super::tests::create_test_fuiz(),
        Options::default(),
        host,
        &crate::settings::Settings::default(),
    );
    let host_wire = Wire::default();
    let player_wire = Wire::default();
    game.watchers
        .add_watcher(player, Value::Player(PlayerValue::Individual))
        .unwrap();
    game.names.set_name(player, "Player", Profanity::Allow).unwrap();
    game.host_connected(host, tick(Duration::ZERO), |_| Some(host_wire.clone()));
    host_wire.0.borrow_mut().clear();
    (game, host, player, host_wire, player_wire)
}
fn command(game: &mut Game, host: Id, message: IncomingHostMessage, time: Duration, wire: &Wire) {
    game.receive_message(
        host,
        IncomingMessage::Host(message),
        |_, _| {},
        tick(time),
        |_| Some(wire.clone()),
    );
}

#[test]
fn production_timeout_policy_is_fixed() {
    assert_eq!(DEFAULT_GAME_TIMEOUT, Duration::from_mins(10));
    assert_eq!(DEFAULT_GAME_TIMEOUT_WARNING, Duration::from_mins(1));
}

#[test]
fn end_from_every_live_state_is_idempotent_and_preserves_completed_results() {
    for stage in 0..4 {
        let (mut game, host, player, h, p) = setup();
        game.leaderboard.add_scores(&[(player, 123)]);
        game.state = match stage {
            0 => State::WaitingScreen,
            1 => State::TeamDisplay,
            2 => State::Slide(Box::new(CurrentSlide {
                index: 0,
                state: game.fuiz_config.slides[0].to_state(),
            })),
            _ => State::Leaderboard(0),
        };
        let finder = |id| Some(if id == host { h.clone() } else { p.clone() });
        for _ in 0..2 {
            game.receive_message(
                host,
                IncomingMessage::Host(IncomingHostMessage::End),
                |_, _| {},
                tick(Duration::ZERO),
                finder,
            );
        }
        assert!(matches!(game.state, State::Done));
        assert_eq!(h.0.borrow().len(), 1);
        assert_eq!(p.0.borrow().len(), 1);
        assert_eq!(
            h.0.borrow()[0]["Game"]["Summary"]["Host"]["results"][0][1],
            serde_json::json!([123])
        );
        assert_eq!(
            p.0.borrow()[0]["Game"]["Summary"]["Player"]["points"],
            serde_json::json!([123])
        );
        assert!(game.host_deadline(tick(DEFAULT_GAME_TIMEOUT)).is_none());
    }
}

#[test]
fn player_and_unassigned_cannot_end_or_continue() {
    let (mut game, _, player, wire, _) = setup();
    let unassigned = Id::new();
    game.watchers.add_watcher(unassigned, Value::Unassigned).unwrap();
    let before = game.host_deadline(tick(Duration::ZERO));
    for id in [player, unassigned] {
        for message in [IncomingHostMessage::End, IncomingHostMessage::Continue] {
            command(&mut game, id, message, Duration::from_secs(1), &wire);
        }
    }
    assert!(matches!(game.state, State::WaitingScreen));
    assert_eq!(before, game.host_deadline(tick(Duration::ZERO)));
}

#[test]
fn zero_player_end_does_not_create_results() {
    let host = Id::new();
    let wire = Wire::default();
    let mut game = Game::new(
        Fuiz::default(),
        Options::default(),
        host,
        &crate::settings::Settings::default(),
    );
    command(&mut game, host, IncomingHostMessage::End, Duration::ZERO, &wire);
    assert_eq!(
        wire.0.borrow()[0]["Game"]["Summary"]["Host"]["stats"],
        serde_json::json!([])
    );
    assert_eq!(
        wire.0.borrow()[0]["Game"]["Summary"]["Host"]["results"],
        serde_json::json!([])
    );
}

#[test]
fn warning_only_reaches_host_once_and_expiration_is_exact() {
    let (mut game, host, _, h, p) = setup();
    let finder = |id| Some(if id == host { h.clone() } else { p.clone() });
    let generation = game.host_deadline(tick(Duration::ZERO)).unwrap().0;
    let warning = DEFAULT_GAME_TIMEOUT.saturating_sub(DEFAULT_GAME_TIMEOUT_WARNING);
    game.check_host_timeout(
        generation,
        tick(warning.saturating_sub(Duration::from_millis(1))),
        finder,
    );
    assert!(h.0.borrow().is_empty());
    for _ in 0..2 {
        game.check_host_timeout(generation, tick(warning), finder);
    }
    assert_eq!(h.0.borrow().len(), 1);
    assert!(p.0.borrow().is_empty());
    assert_eq!(
        h.0.borrow()[0]["Game"]["HostTimeout"]["remaining_ms"],
        DEFAULT_GAME_TIMEOUT_WARNING.as_millis() as u64
    );
    game.check_host_timeout(
        generation,
        tick(DEFAULT_GAME_TIMEOUT.saturating_sub(Duration::from_millis(1))),
        finder,
    );
    assert!(!matches!(game.state, State::Done));
    game.check_host_timeout(generation, tick(DEFAULT_GAME_TIMEOUT), finder);
    assert!(matches!(game.state, State::Done));
    assert_eq!(p.0.borrow().len(), 1);
    game.check_host_timeout(generation, tick(DEFAULT_GAME_TIMEOUT), finder);
    assert_eq!(p.0.borrow().len(), 1);
}

#[test]
fn continue_and_controls_reset_but_queries_and_players_do_not() {
    for message in [
        IncomingHostMessage::Continue,
        IncomingHostMessage::Lock(true),
        IncomingHostMessage::Kick("missing".into()),
        IncomingHostMessage::Index(0),
        IncomingHostMessage::Next(HostScreen::Lobby),
    ] {
        let (mut game, host, player, wire, _) = setup();
        let old = game.host_deadline(tick(Duration::ZERO)).unwrap().0;
        let at = DEFAULT_GAME_TIMEOUT.saturating_sub(DEFAULT_GAME_TIMEOUT_WARNING);
        command(&mut game, host, message, at, &wire);
        assert!(game.host_deadline(tick(at)).unwrap().0 > old);
        let current = game.host_deadline(tick(at));
        for query in [
            IncomingHostMessage::RequestResponses,
            IncomingHostMessage::RequestTeamRosters,
        ] {
            command(&mut game, host, query, at, &wire);
        }
        game.receive_message(
            player,
            IncomingMessage::Player(IncomingPlayerMessage::IndexAnswer(0)),
            |_, _| {},
            tick(at),
            |_| Some(wire.clone()),
        );
        assert_eq!(current, game.host_deadline(tick(at)));
        game.check_host_timeout(old, tick(DEFAULT_GAME_TIMEOUT), |_| Some(wire.clone()));
        assert!(!matches!(game.state, State::Done));
    }
}

#[test]
fn disconnected_deadline_reconnect_and_stale_generations() {
    let (mut game, host, _, wire, _) = setup();
    let at = DEFAULT_GAME_TIMEOUT.saturating_sub(Duration::from_secs(1));
    game.host_disconnected(host, tick(at));
    let (old, delay) = game.host_deadline(tick(at)).unwrap();
    assert_eq!(delay, DEFAULT_GAME_TIMEOUT);
    game.check_host_timeout(old, tick(DEFAULT_GAME_TIMEOUT), |_| Some(wire.clone()));
    assert!(!matches!(game.state, State::Done));
    game.host_connected(host, tick(DEFAULT_GAME_TIMEOUT), |_| Some(wire.clone()));
    game.check_host_timeout(old, tick(at + DEFAULT_GAME_TIMEOUT), |_| Some(wire.clone()));
    assert!(!matches!(game.state, State::Done));
    game.host_disconnected(host, tick(DEFAULT_GAME_TIMEOUT));
    let generation = game.host_deadline(tick(DEFAULT_GAME_TIMEOUT)).unwrap().0;
    game.check_host_timeout(generation, tick(DEFAULT_GAME_TIMEOUT * 2), |_| Some(wire.clone()));
    assert!(matches!(game.state, State::Done));
}

#[test]
fn expiry_wins_continue_race_and_instances_are_isolated() {
    let (mut game, host, _, wire, _) = setup();
    let (other, _, _, _, _) = setup();
    command(
        &mut game,
        host,
        IncomingHostMessage::Continue,
        DEFAULT_GAME_TIMEOUT,
        &wire,
    );
    assert!(matches!(game.state, State::Done));
    assert!(!matches!(other.state, State::Done));
}

#[test]
fn recovery_and_resync_preserve_original_deadline_and_warning() {
    let (mut game, host, _, wire, _) = setup();
    let at = DEFAULT_GAME_TIMEOUT.saturating_sub(DEFAULT_GAME_TIMEOUT_WARNING);
    let generation = game.host_deadline(tick(at)).unwrap().0;
    wal::apply(
        &mut game,
        &wal::Event::HostTimeout(generation),
        tick(at),
        |_, _| {},
        |_| Some(wire.clone()),
    )
    .unwrap();
    let bytes = serde_json::to_vec(&game).unwrap();
    let mut recovered: Game = serde_json::from_slice(&bytes).unwrap();
    wal::apply(
        &mut recovered,
        &wal::Event::Resynced(host),
        tick(at),
        |_, _| {},
        |_| Some(wire.clone()),
    )
    .unwrap();
    assert_eq!(game.host_deadline(tick(at)), recovered.host_deadline(tick(at)));
    assert!(recovered.host_timeout.as_ref().unwrap().warned);
    wal::apply(
        &mut recovered,
        &wal::Event::HostTimeout(generation),
        tick(DEFAULT_GAME_TIMEOUT),
        |_, _| {},
        |_| Some(wire.clone()),
    )
    .unwrap();
    assert!(matches!(recovered.state, State::Done));
}

#[test]
fn manual_and_timeout_end_preserve_results_before_host_advances() {
    for automatic in [false, true] {
        let (mut game, host, player, wire, _) = setup();
        game.fuiz_config.slides.push(game.fuiz_config.slides[0].clone());
        for _ in 0..3 {
            let screen = game.current_host_screen();
            command(
                &mut game,
                host,
                IncomingHostMessage::Next(screen),
                Duration::ZERO,
                &wire,
            );
        }
        game.receive_message(
            player,
            IncomingMessage::Player(IncomingPlayerMessage::IndexAnswer(0)),
            |_, _| {},
            tick(Duration::from_secs(1)),
            |_| Some(wire.clone()),
        );
        let mut naturally_advanced: Game = serde_json::from_value(serde_json::to_value(&game).unwrap()).unwrap();
        let screen = naturally_advanced.current_host_screen();
        command(
            &mut naturally_advanced,
            host,
            IncomingHostMessage::Next(screen),
            Duration::from_secs(2),
            &wire,
        );
        let expected = naturally_advanced.leaderboard.player_summary(player, true);
        assert_eq!(expected.len(), 1);
        assert!(expected[0] > 0);
        wire.0.borrow_mut().clear();
        if automatic {
            let generation = game.host_deadline(tick(Duration::ZERO)).unwrap().0;
            game.check_host_timeout(generation, tick(DEFAULT_GAME_TIMEOUT), |_| Some(wire.clone()));
        } else {
            command(&mut game, host, IncomingHostMessage::End, Duration::from_secs(2), &wire);
        }
        assert_eq!(game.leaderboard.player_summary(player, true), expected);
        command(&mut game, host, IncomingHostMessage::End, DEFAULT_GAME_TIMEOUT, &wire);
        let messages = wire.0.borrow();
        let summary = messages
            .iter()
            .find_map(|message| message.get("Game")?.get("Summary")?.get("Host"))
            .unwrap();
        assert_eq!(summary["stats"].as_array().unwrap().len(), 1);
        assert_eq!(summary["results"][0][1], serde_json::json!(expected));
    }
}
