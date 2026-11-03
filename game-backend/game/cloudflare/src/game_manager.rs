use crate::{
    authorization as auth,
    host_authorization::{CANCELLATION_MS, Grant, Removal, Revocation},
};
use fuiz::game_id::GameId;
use serde::{Deserialize, Serialize};
use worker::*;

const GAME_EXPIRY: chrono::Duration = chrono::Duration::hours(24);

#[derive(Clone, Serialize, Deserialize)]
struct Allocation {
    code: String,
    instance: GameManagerInstance,
    owner: String,
}
#[derive(Deserialize)]
pub(crate) struct Creation {
    pub grant: String,
    pub game: crate::game::GameRequest,
}

#[durable_object]
struct GameManager {
    state: State,
    env: Env,
    allocation: futures_util::lock::Mutex<()>,
}
impl GameManager {
    async fn get_game(&self, code: &str) -> Result<GameManagerInstance> {
        let game = self
            .state
            .storage()
            .get::<GameManagerInstance>(code)
            .await?
            .ok_or_else(|| Error::RustError("Game not found".into()))?;
        if game.created_at + GAME_EXPIRY < chrono::Utc::now() {
            return Err(Error::RustError("Game not found".into()));
        }
        Ok(game)
    }
    async fn forward(&self, id: &str, path: &str, body: &str) -> Result<Response> {
        self.env
            .durable_object("GAME")?
            .id_from_string(id)?
            .get_stub()?
            .fetch_with_request(auth::signed(&self.env, path, body)?)
            .await
    }
    async fn allocate(&self, grant: &Grant) -> Result<Option<Allocation>> {
        // Serialize code allocation; shard the allocator if creation volume requires it.
        let _guard = self.allocation.lock().await;
        let storage = self.state.storage();
        if storage
            .get::<u64>(&format!("cancel:{}", grant.instance_id))
            .await?
            .is_some_and(|until| until > auth::now())
        {
            return Ok(None);
        }
        let instance_key = format!("instance:{}", grant.instance_id);
        if let Some(existing) = storage.get::<Allocation>(&instance_key).await? {
            return Ok((existing.owner == grant.user_id).then_some(existing));
        }
        let code = loop {
            let candidate = GameId::new().to_string();
            let existing = storage.get::<GameManagerInstance>(&candidate).await?;
            if existing.is_none_or(|game| game.created_at + GAME_EXPIRY < chrono::Utc::now()) {
                break candidate;
            }
        };
        let instance = GameManagerInstance {
            id: self
                .env
                .durable_object("GAME")?
                .id_from_name(&grant.instance_id)?
                .to_string(),
            created_at: chrono::Utc::now(),
        };
        let result = Allocation {
            code,
            instance,
            owner: grant.user_id.clone(),
        };
        // Commit routing and the replay key together; a partial write must not
        // acknowledge an allocated instance whose public code is unreachable.
        let records = js_sys::Object::new();
        js_sys::Reflect::set(&records, &instance_key.into(), &serde_wasm_bindgen::to_value(&result)?)?;
        js_sys::Reflect::set(
            &records,
            &result.code.clone().into(),
            &serde_wasm_bindgen::to_value(&result.instance)?,
        )?;
        storage.put_multiple_raw(records).await?;
        if let Ok(counter) = self.env.service("COUNTER") {
            let _ = counter
                .fetch(
                    "https://example.com/game_count",
                    Some(RequestInit {
                        method: Method::Post,
                        ..Default::default()
                    }),
                )
                .await;
        }
        Ok(Some(result))
    }
}
impl DurableObject for GameManager {
    fn new(state: State, env: Env) -> Self {
        Self {
            state,
            env,
            allocation: futures_util::lock::Mutex::new(()),
        }
    }
    async fn fetch(&self, mut req: Request) -> Result<Response> {
        let path = req.url()?.path().to_owned();
        if req.method() == Method::Get {
            return match self.get_game(path.trim_start_matches('/')).await {
                Ok(game) => Response::from_json(&game),
                Err(_) => Response::error("Not Found", 404),
            };
        }
        let body = req.text().await?;
        if req.method() != Method::Post
            || body.len() > 4 * 1024 * 1024 + 8192
            || !auth::service(&self.env, &req, body.as_bytes())
        {
            return Response::error("Unauthorized", 401);
        }
        match path.as_str() {
            "/add" => {
                let creation: Creation = serde_json::from_str(&body)?;
                let Some(grant) = auth::authorize(&self.env, &creation.grant, "create-game").await else {
                    return Response::error("Unauthorized", 401);
                };
                let Some(allocation) = self.allocate(&grant).await? else {
                    return Response::error("Cancelled", 409);
                };
                let payload = serde_json::to_string(
                    &serde_json::json!({"grant":creation.grant,"game":creation.game,"code":allocation.code}),
                )?;
                self.forward(&allocation.instance.id, "/add", &payload).await
            }
            "/internal/host/games/remove" => {
                let removal: Removal = serde_json::from_str(&body)?;
                {
                    let _guard = self.allocation.lock().await;
                    self.state
                        .storage()
                        .put(
                            &format!("cancel:{}", removal.instance_id),
                            auth::now() + CANCELLATION_MS,
                        )
                        .await?;
                }
                // Deterministic instance routing reaches an allocation even before its registry write.
                let id = self
                    .env
                    .durable_object("GAME")?
                    .id_from_name(&removal.instance_id)?
                    .to_string();
                self.forward(&id, &path, &body).await
            }
            "/internal/host/revoke" => {
                let revocation: Revocation = serde_json::from_str(&body)?;
                let entries = self
                    .state
                    .storage()
                    .list_with_options(ListOptions::new().prefix("instance:"))
                    .await?;
                let mut allocations = Vec::new();
                entries.for_each(&mut |value, _| {
                    if let Ok(allocation) = serde_wasm_bindgen::from_value::<Allocation>(value)
                        && allocation.owner == revocation.user_id
                    {
                        allocations.push(allocation);
                    }
                });
                // Notifications are best effort; each game retains its independent idle deadline.
                for allocation in allocations {
                    let _ = self.forward(&allocation.instance.id, &path, &body).await;
                }
                Response::empty()
            }
            _ => Response::error("Not Found", 404),
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub struct GameManagerInstance {
    pub id: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}
