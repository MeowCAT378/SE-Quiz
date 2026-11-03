//! Shared, domain-separated host transport authentication. No account decisions are cached here.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub(crate) const PROOF_HEADER: &str = "X-SEOpen-Service-Proof";
pub(crate) const CALLBACK_PATH: &str = "/api/host/authorize";
pub(crate) const COMPLETION_PATH: &str = "/api/host/completed";

pub(crate) fn callback_completion_path(path: &str) -> Option<String> {
    let base = path.strip_suffix(CALLBACK_PATH)?;
    if !base.is_empty()
        && !base.strip_prefix('/').is_some_and(|prefix| {
            prefix.split('/').all(|segment| {
                !segment.is_empty()
                    && segment
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
            })
        })
    {
        return None;
    }
    Some(format!("{base}{COMPLETION_PATH}"))
}

pub(crate) fn completion_body(grant: &Grant, code: &str, watcher: &str) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "instanceId": grant.instance_id, "ownerId": grant.user_id,
        "gameCode": code, "watcherId": watcher
    }))
    .expect("completion serializes")
}
pub(crate) const POLL_MS: u64 = 5_000;
pub(crate) const TIMEOUT_MS: u64 = 1_000;
/// Includes the entire maximum creation lifetime and accepted forward clock skew.
pub(crate) const CANCELLATION_MS: u64 = 90_000;

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Grant {
    pub purpose: String,
    pub user_id: String,
    pub session_version: u64,
    pub issued_at: u64,
    pub expires_at: u64,
    pub instance_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub watcher_id: Option<String>,
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(output, "{byte:02x}");
    }
    output
}
fn mac(key: &str, bytes: &[u8]) -> Option<Hmac<Sha256>> {
    if key.is_empty() {
        return None;
    }
    let mut value = Hmac::<Sha256>::new_from_slice(key.as_bytes()).ok()?;
    value.update(bytes);
    Some(value)
}
fn verify_mac(key: &str, bytes: &[u8], signature: &str) -> bool {
    if signature.len() != 64
        || !signature
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return false;
    }
    let decoded: Option<Vec<u8>> = (0..64)
        .step_by(2)
        .map(|i| u8::from_str_radix(&signature[i..i + 2], 16).ok())
        .collect();
    mac(key, bytes)
        .zip(decoded)
        .is_some_and(|(mac, decoded)| mac.verify_slice(&decoded).is_ok())
}
pub(crate) fn verify_grant(key: &str, token: &str, purpose: &str, now: u64) -> Option<Grant> {
    if token.len() > 4096 {
        return None;
    }
    let (payload, signature) = token.split_once('.')?;
    if !verify_mac(key, format!("seopen:grant:v1\n{payload}").as_bytes(), signature) {
        return None;
    }
    let grant: Grant = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).ok()?).ok()?;
    let max_lifetime = match purpose {
        "create-game" => 60_000,
        "host-game" => 300_000,
        _ => return None,
    };
    let valid_id = |id: &str| !id.is_empty() && id.len() <= 128;
    if grant.purpose != purpose
        || !valid_id(&grant.user_id)
        || !valid_id(&grant.instance_id)
        || grant.session_version > 9_007_199_254_740_991
        || grant.issued_at > now.saturating_add(30_000)
        || grant.expires_at <= now
        || grant.expires_at <= grant.issued_at
        || grant.expires_at - grant.issued_at > max_lifetime
        || (purpose == "host-game"
            && (!grant.game_code.as_deref().is_some_and(valid_id)
                || !grant.watcher_id.as_deref().is_some_and(valid_id)))
    {
        return None;
    }
    Some(grant)
}
pub(crate) fn service_proof(key: &str, method: &str, path: &str, body: &[u8], now: u64) -> Option<String> {
    let message = format!(
        "seopen:service:v1\n{}\n{path}\n{}\n{now}",
        method.to_uppercase(),
        hex(&Sha256::digest(body))
    );
    Some(format!(
        "{now}.{}",
        hex(&mac(key, message.as_bytes())?.finalize().into_bytes())
    ))
}
pub(crate) fn verify_service(key: &str, proof: &str, method: &str, path: &str, body: &[u8], now: u64) -> bool {
    if proof.len() > 128 {
        return false;
    }
    let Some((stamp, signature)) = proof.split_once('.') else {
        return false;
    };
    if !stamp.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    let Ok(timestamp) = stamp.parse::<u64>() else {
        return false;
    };
    if now.abs_diff(timestamp) > 30_000 {
        return false;
    }
    let message = format!(
        "seopen:service:v1\n{}\n{path}\n{}\n{timestamp}",
        method.to_uppercase(),
        hex(&Sha256::digest(body))
    );
    verify_mac(key, message.as_bytes(), signature)
}
pub(crate) fn callback_body(grant: &Grant, token: &str) -> Vec<u8> {
    let mut body = serde_json::json!({"purpose":grant.purpose,"grant":token,"instanceId":grant.instance_id});
    if grant.purpose == "host-game" {
        body["gameCode"] = serde_json::json!(grant.game_code);
        body["watcherId"] = serde_json::json!(grant.watcher_id);
    }
    serde_json::to_vec(&body).expect("callback serializes")
}
pub(crate) fn decision_matches(value: &serde_json::Value, grant: &Grant, now: u64) -> bool {
    value["authorized"] == true
        && value["purpose"] == grant.purpose
        && value["userId"] == grant.user_id
        && value["sessionVersion"] == grant.session_version
        && value["instanceId"] == grant.instance_id
        && value["expiresAt"] == grant.expires_at
        && grant.expires_at > now
        && (grant.purpose != "host-game"
            || (value["gameCode"].as_str() == grant.game_code.as_deref()
                && value["watcherId"].as_str() == grant.watcher_id.as_deref()))
}
impl Grant {
    pub fn same_host(&self, other: &Self) -> bool {
        self.user_id == other.user_id
            && self.session_version == other.session_version
            && self.instance_id == other.instance_id
            && self.game_code == other.game_code
            && self.watcher_id == other.watcher_id
    }
}
/// A deadline is a traffic permission, never a reusable command authorization.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrafficGate {
    pub until: u64,
    pub pending: bool,
    pub closed: bool,
}
impl TrafficGate {
    pub fn permits(&self, now: u64) -> bool {
        !self.closed && !self.pending && now < self.until
    }
    pub fn pause(&mut self) {
        self.pending = true;
    }
    // Anchor to request start: callback latency must consume, not extend, the permission window.
    pub fn authorize(&mut self, started_at: u64, expires_at: u64) {
        self.until = started_at.saturating_add(POLL_MS).min(expires_at);
        self.pending = false;
    }
    pub fn close(&mut self) {
        self.closed = true;
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Revocation {
    pub user_id: String,
    pub min_session_version: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Removal {
    pub instance_id: String,
}

/// Bounded transient output, released only after a fresh decision for this connection.
#[derive(Default)]
pub(crate) struct DeferredOutput {
    messages: Vec<String>,
    bytes: usize,
}
impl DeferredOutput {
    pub fn is_empty(&self) -> bool {
        self.messages.is_empty()
    }
    pub fn push(&mut self, message: String) -> bool {
        if self.messages.len() >= 256 || self.bytes.saturating_add(message.len()) > 1_048_576 {
            return false;
        }
        self.bytes += message.len();
        self.messages.push(message);
        true
    }
    pub fn take(&mut self) -> Vec<String> {
        self.bytes = 0;
        std::mem::take(&mut self.messages)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn callback_completion_preserves_the_deployment_base() {
        for (callback, completion) in [
            ("/api/host/authorize", "/api/host/completed"),
            ("/SEQuiz/api/host/authorize", "/SEQuiz/api/host/completed"),
            (
                "/school/quiz-v2/api/host/authorize",
                "/school/quiz-v2/api/host/completed",
            ),
        ] {
            assert_eq!(callback_completion_path(callback).as_deref(), Some(completion));
        }
        for path in [
            "/api/host/authorize/",
            "/api/host/completed",
            "/SEQuiz/api/host/authorize-extra",
            "SEQuiz/api/host/authorize",
            "//api/host/authorize",
            "/SEQuiz//api/host/authorize",
            "/../api/host/authorize",
            "/%2f/api/host/authorize",
            "/SEQuiz?x/api/host/authorize",
        ] {
            assert!(callback_completion_path(path).is_none(), "accepted {path}");
        }
    }
    #[test]
    fn service_proofs_bind_method_path_body_time_and_domain() {
        let proof = service_proof("test-key", "POST", "/internal/host/revoke", b"{}", 100_000).unwrap();
        assert!(verify_service(
            "test-key",
            &proof,
            "POST",
            "/internal/host/revoke",
            b"{}",
            130_000
        ));
        for (method, path, body, now) in [
            ("GET", "/internal/host/revoke", b"{}".as_slice(), 100_000),
            ("POST", "/other", b"{}", 100_000),
            ("POST", "/internal/host/revoke", b"[]", 100_000),
            ("POST", "/internal/host/revoke", b"{}", 130_001),
        ] {
            assert!(!verify_service("test-key", &proof, method, path, body, now));
        }
        assert!(verify_grant("test-key", &proof, "host-game", 100_000).is_none());
    }
    #[test]
    fn deadline_pending_and_closed_gates_cannot_release_stale_traffic() {
        let mut gate = TrafficGate::default();
        assert!(!gate.permits(1));
        gate.authorize(100, 20_000);
        assert!(gate.permits(5_099));
        assert!(!gate.permits(5_100));
        gate.pause();
        assert!(!gate.permits(101));
        gate.authorize(200, 1_000);
        assert!(gate.permits(999));
        assert!(!gate.permits(1_000));
        gate.close();
        gate.authorize(500, 20_000);
        assert!(!gate.permits(501));
    }
    #[test]
    fn deferred_output_is_bounded_and_drains_in_order() {
        let mut output = DeferredOutput::default();
        for i in 0..256 {
            assert!(output.push(i.to_string()));
        }
        assert!(!output.push("overflow".into()));
        assert_eq!(output.take(), (0..256).map(|i| i.to_string()).collect::<Vec<_>>());
        assert!(output.push("new".into()));
        output.take();
        assert!(!output.push("x".repeat(1_048_577)));
        assert!(output.take().is_empty());
    }
}
