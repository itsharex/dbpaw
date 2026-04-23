use crate::datasources::redis::{
    self, RedisDatabaseInfo, RedisKeyValue, RedisMutationResult, RedisRawResult, RedisScanResponse,
    RedisSetKeyPayload,
};
use crate::models::ConnectionForm;
use crate::state::AppState;
use tauri::State;

async fn connection_form(state: &State<'_, AppState>, id: i64) -> Result<ConnectionForm, String> {
    let local_db = {
        let lock = state.local_db.lock().await;
        lock.clone()
    };
    let db = local_db.ok_or("Local DB not initialized")?;
    let form = db.get_connection_form_by_id(id).await?;
    if form.driver != "redis" {
        return Err(format!(
            "[UNSUPPORTED] Connection {} is not a Redis connection",
            id
        ));
    }
    Ok(form)
}

#[tauri::command]
pub async fn redis_list_databases(
    state: State<'_, AppState>,
    id: i64,
) -> Result<Vec<RedisDatabaseInfo>, String> {
    let form = connection_form(&state, id).await?;
    redis::test_connection(&form).await?;
    redis::list_databases(&form)
}

#[tauri::command]
pub async fn redis_scan_keys(
    state: State<'_, AppState>,
    id: i64,
    database: Option<String>,
    cursor: Option<u64>,
    pattern: Option<String>,
    limit: Option<u32>,
) -> Result<RedisScanResponse, String> {
    let form = connection_form(&state, id).await?;
    redis::scan_keys(&form, database.as_deref(), cursor, pattern, limit).await
}

#[tauri::command]
pub async fn redis_get_key(
    state: State<'_, AppState>,
    id: i64,
    database: Option<String>,
    key: String,
) -> Result<RedisKeyValue, String> {
    let form = connection_form(&state, id).await?;
    redis::get_key(&form, database.as_deref(), key).await
}

#[tauri::command]
pub async fn redis_set_key(
    state: State<'_, AppState>,
    id: i64,
    database: Option<String>,
    payload: RedisSetKeyPayload,
) -> Result<RedisMutationResult, String> {
    let form = connection_form(&state, id).await?;
    redis::set_key(&form, database.as_deref(), payload).await
}

#[tauri::command]
pub async fn redis_update_key(
    state: State<'_, AppState>,
    id: i64,
    database: Option<String>,
    payload: RedisSetKeyPayload,
) -> Result<RedisMutationResult, String> {
    let form = connection_form(&state, id).await?;
    redis::set_key(&form, database.as_deref(), payload).await
}

#[tauri::command]
pub async fn redis_delete_key(
    state: State<'_, AppState>,
    id: i64,
    database: Option<String>,
    key: String,
) -> Result<RedisMutationResult, String> {
    let form = connection_form(&state, id).await?;
    redis::delete_key(&form, database.as_deref(), key).await
}

#[tauri::command]
pub async fn redis_rename_key(
    state: State<'_, AppState>,
    id: i64,
    database: Option<String>,
    old_key: String,
    new_key: String,
) -> Result<RedisMutationResult, String> {
    let form = connection_form(&state, id).await?;
    redis::rename_key(&form, database.as_deref(), old_key, new_key).await
}

#[tauri::command]
pub async fn redis_get_key_page(
    state: State<'_, AppState>,
    id: i64,
    database: Option<String>,
    key: String,
    offset: u64,
    limit: u32,
) -> Result<RedisKeyValue, String> {
    let form = connection_form(&state, id).await?;
    redis::get_key_page(&form, database.as_deref(), key, offset, limit).await
}

#[tauri::command]
pub async fn redis_set_ttl(
    state: State<'_, AppState>,
    id: i64,
    database: Option<String>,
    key: String,
    ttl_seconds: Option<i64>,
) -> Result<RedisMutationResult, String> {
    let form = connection_form(&state, id).await?;
    redis::set_ttl(&form, database.as_deref(), key, ttl_seconds).await
}

#[tauri::command]
pub async fn redis_execute_raw(
    state: State<'_, AppState>,
    id: i64,
    database: Option<String>,
    command: String,
) -> Result<RedisRawResult, String> {
    let form = connection_form(&state, id).await?;
    redis::execute_raw(&form, database.as_deref(), command).await
}
