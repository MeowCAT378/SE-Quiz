use crate::host_authorization::{self as shared, Grant};
use futures_util::{
    StreamExt,
    future::{Either, select},
};
use std::time::Duration;
use worker::*;

pub(crate) fn now() -> u64 {
    Date::now().as_millis()
}

pub(crate) async fn complete(env: &Env, grant: &Grant, code: &str, watcher: &str) -> bool {
    let Some(key) = key(env) else {
        return false;
    };
    let Some(mut url) = env
        .var("HOST_AUTHORIZATION_URL")
        .ok()
        .and_then(|v| Url::parse(&v.to_string()).ok())
    else {
        return false;
    };
    if url.query().is_some() || url.fragment().is_some() {
        return false;
    }
    let Some(path) = shared::callback_completion_path(url.path()) else {
        return false;
    };
    url.set_path(&path);
    let body = shared::completion_body(grant, code, watcher);
    let Some(proof) = shared::service_proof(&key, "POST", shared::COMPLETION_PATH, &body, now()) else {
        return false;
    };
    let headers = Headers::new();
    if headers.set(shared::PROOF_HEADER, &proof).is_err() || headers.set("Content-Type", "application/json").is_err() {
        return false;
    }
    let Ok(request) = Request::new_with_init(
        url.as_str(),
        &RequestInit {
            method: Method::Post,
            headers,
            body: Some(String::from_utf8(body).expect("JSON UTF-8").into()),
            redirect: RequestRedirect::Manual,
            ..Default::default()
        },
    ) else {
        return false;
    };
    let controller = AbortController::default();
    let signal = controller.signal();
    match select(
        Box::pin(Fetch::Request(request).send_with_signal(&signal)),
        Box::pin(Delay::from(Duration::from_millis(shared::TIMEOUT_MS))),
    )
    .await
    {
        Either::Left((response, _)) => response.is_ok_and(|r| r.status_code() == 200),
        Either::Right(_) => {
            controller.abort();
            false
        }
    }
}
pub(crate) fn key(env: &Env) -> Option<String> {
    env.secret("ADMIN_SESSION_SECRET").ok().map(|s| s.to_string())
}
pub(crate) fn token(request: &Request) -> Option<String> {
    request
        .headers()
        .get("Authorization")
        .ok()
        .flatten()?
        .strip_prefix("Bearer ")
        .map(str::to_owned)
}
pub(crate) fn signed(env: &Env, path: &str, body: &str) -> Result<Request> {
    let proof = shared::service_proof(&key(env).unwrap_or_default(), "POST", path, body.as_bytes(), now())
        .ok_or_else(|| Error::RustError("Authorization unavailable".into()))?;
    let headers = Headers::new();
    headers.set("Content-Type", "application/json")?;
    headers.set(shared::PROOF_HEADER, &proof)?;
    Request::new_with_init(
        &format!("https://internal{path}"),
        &RequestInit {
            method: Method::Post,
            headers,
            body: Some(body.into()),
            redirect: RequestRedirect::Manual,
            ..Default::default()
        },
    )
}
pub(crate) fn service(env: &Env, req: &Request, body: &[u8]) -> bool {
    key(env)
        .zip(req.headers().get(shared::PROOF_HEADER).ok().flatten())
        .is_some_and(|(key, proof)| {
            req.url().is_ok_and(|url| {
                url.query().is_none()
                    && shared::verify_service(&key, &proof, req.method().as_ref(), url.path(), body, now())
            })
        })
}
pub(crate) async fn authorize(env: &Env, token: &str, purpose: &str) -> Option<Grant> {
    let key = key(env)?;
    let grant = shared::verify_grant(&key, token, purpose, now())?;
    let url = Url::parse(&env.var("HOST_AUTHORIZATION_URL").ok()?.to_string()).ok()?;
    if shared::callback_completion_path(url.path()).is_none() || url.query().is_some() || url.fragment().is_some() {
        return None;
    }
    let body = shared::callback_body(&grant, token);
    let proof = shared::service_proof(&key, "POST", shared::CALLBACK_PATH, &body, now())?;
    let headers = Headers::new();
    headers.set("Content-Type", "application/json").ok()?;
    headers.set(shared::PROOF_HEADER, &proof).ok()?;
    let request = Request::new_with_init(
        url.as_str(),
        &RequestInit {
            method: Method::Post,
            headers,
            body: Some(String::from_utf8(body).ok()?.into()),
            redirect: RequestRedirect::Manual,
            ..Default::default()
        },
    )
    .ok()?;
    let controller = AbortController::default();
    let signal = controller.signal();
    let operation = async {
        let mut response = Fetch::Request(request).send_with_signal(&signal).await.ok()?;
        if response.status_code() != 200 {
            return None;
        }
        let mut stream = response.stream().ok()?;
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.ok()?;
            if bytes.len() + chunk.len() > 4096 {
                return None;
            }
            bytes.extend_from_slice(&chunk);
        }
        let decision = serde_json::from_slice(&bytes).ok()?;
        shared::decision_matches(&decision, &grant, now()).then_some(grant)
    };
    match select(
        Box::pin(operation),
        Box::pin(Delay::from(Duration::from_millis(shared::TIMEOUT_MS))),
    )
    .await
    {
        Either::Left((result, _)) => result,
        Either::Right(_) => {
            controller.abort();
            None
        }
    }
}
