pub mod config;
pub mod connection;
pub mod metadata;
pub mod query;
pub mod storage;

use crate::db::drivers::DatabaseDriver;
use crate::state::AppState;
use std::sync::Arc;
use tauri::State;

pub async fn ensure_connection(
    state: &State<'_, AppState>,
    id: i64,
) -> Result<Arc<dyn DatabaseDriver>, String> {
    ensure_connection_with_db(state, id, None).await
}

pub async fn ensure_connection_with_db(
    state: &State<'_, AppState>,
    id: i64,
    database: Option<String>,
) -> Result<Arc<dyn DatabaseDriver>, String> {
    let key = if let Some(db) = &database {
        if !db.is_empty() {
            format!("{}:{}", id, db)
        } else {
            id.to_string()
        }
    } else {
        id.to_string()
    };

    if let Some(driver) = state.pool_manager.get_connection(&key).await {
        return Ok(driver);
    }

    let local_db = state.local_db.lock().await;
    let db = local_db.as_ref().ok_or("Local DB not initialized")?;
    let mut form = db.get_connection_form_by_id(id).await?;
    drop(local_db);

    if let Some(db_name) = database {
        if !db_name.is_empty() {
            form.database = Some(db_name);
        }
    }

    state.pool_manager.connect(&key, &form).await
}

pub async fn execute_with_retry<F, Fut, T>(
    state: &State<'_, AppState>,
    id: i64,
    database: Option<String>,
    task: F,
) -> Result<T, String>
where
    F: Fn(Arc<dyn DatabaseDriver>) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let driver = ensure_connection_with_db(state, id, database.clone()).await?;
    match task(driver.clone()).await {
        Ok(res) => Ok(res),
        Err(e) => {
            if is_connection_error(&e) {
                // Retry once
                println!("[Pool] Connection error detected: {}, retrying...", e);
                let key = if let Some(db) = &database {
                    if !db.is_empty() {
                        format!("{}:{}", id, db)
                    } else {
                        id.to_string()
                    }
                } else {
                    id.to_string()
                };

                state.pool_manager.remove(&key).await;
                let driver = ensure_connection_with_db(state, id, database).await?;
                task(driver).await
            } else {
                Err(e)
            }
        }
    }
}

fn is_connection_error(e: &str) -> bool {
    let lower = e.to_lowercase();
    lower.contains("pool closed")
        || lower.contains("connection reset")
        || lower.contains("broken pipe")
        || lower.contains("timeout")
        || lower.contains("network unreachable")
        || lower.contains("closed")
        || lower.contains("eof")
}
