use crate::host_authorization::{self as shared, Grant};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub(crate) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone)]
pub(crate) struct Authorizer {
    key: String,
    url: String,
    client: reqwest::Client,
}
impl Default for Authorizer {
    fn default() -> Self {
        Self::new(
            std::env::var("ADMIN_SESSION_SECRET").unwrap_or_default(),
            std::env::var("HOST_AUTHORIZATION_URL").unwrap_or_default(),
        )
    }
}
impl Authorizer {
    pub async fn complete(&self, binding: &crate::game_manager::Binding) {
        let Ok(mut url) = reqwest::Url::parse(&self.url) else {
            return;
        };
        if url.query().is_some() || url.fragment().is_some() {
            return;
        }
        let Some(path) = shared::callback_completion_path(url.path()) else {
            return;
        };
        url.set_path(&path);
        let body = shared::completion_body(&binding.grant, &binding.code.to_string(), &binding.watcher.to_string());
        for attempt in 0..3 {
            let Some(proof) = shared::service_proof(&self.key, "POST", shared::COMPLETION_PATH, &body, now()) else {
                return;
            };
            if self
                .client
                .post(url.clone())
                .header(shared::PROOF_HEADER, proof)
                .header("Content-Type", "application/json")
                .body(body.clone())
                .send()
                .await
                .is_ok_and(|r| r.status().is_success())
            {
                return;
            }
            if attempt < 2 {
                actix_web::rt::time::sleep(Duration::from_secs(1)).await;
            }
        }
        log::warn!(
            "game completion notification failed: instance={}",
            binding.grant.instance_id
        );
    }
    pub fn new(key: String, url: String) -> Self {
        Self {
            key,
            url,
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_millis(shared::TIMEOUT_MS))
                .build()
                .expect("HTTP client"),
        }
    }
    pub async fn authorize(&self, token: &str, purpose: &str) -> Option<Grant> {
        let started = now();
        let grant = shared::verify_grant(&self.key, token, purpose, started)?;
        let url = reqwest::Url::parse(&self.url).ok()?;
        if shared::callback_completion_path(url.path()).is_none() || url.query().is_some() || url.fragment().is_some() {
            return None;
        }
        let body = shared::callback_body(&grant, token);
        let proof = shared::service_proof(&self.key, "POST", shared::CALLBACK_PATH, &body, started)?;
        actix_web::rt::time::timeout(Duration::from_millis(shared::TIMEOUT_MS), async {
            let mut response = self
                .client
                .post(url)
                .header(shared::PROOF_HEADER, proof)
                .header("Content-Type", "application/json")
                .body(body)
                .send()
                .await
                .ok()?;
            if response.status() != reqwest::StatusCode::OK {
                return None;
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.ok()? {
                if bytes.len() + chunk.len() > 4096 {
                    return None;
                }
                bytes.extend_from_slice(&chunk);
            }
            let decision = serde_json::from_slice(&bytes).ok()?;
            shared::decision_matches(&decision, &grant, now()).then_some(grant)
        })
        .await
        .ok()
        .flatten()
    }
    pub fn service(&self, request: &actix_web::HttpRequest, body: &[u8]) -> bool {
        request
            .headers()
            .get(shared::PROOF_HEADER)
            .and_then(|h| h.to_str().ok())
            .is_some_and(|proof| {
                shared::verify_service(
                    &self.key,
                    proof,
                    request.method().as_str(),
                    request.uri().path(),
                    body,
                    now(),
                )
            })
    }
}
