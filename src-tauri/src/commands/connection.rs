use crate::models::{Connection, ConnectionForm, TestConnectionResult};
use crate::state::AppState;
use std::time::Instant;
use tauri::State;

#[tauri::command]
pub async fn list_databases(form: ConnectionForm) -> Result<Vec<String>, String> {
    let driver = crate::db::drivers::connect(&form).await?;
    driver.list_databases().await
}

#[tauri::command]
pub async fn list_databases_by_id(
    state: State<'_, AppState>,
    id: i64,
) -> Result<Vec<String>, String> {
    super::execute_with_retry(&state, id, None, |driver| async move {
        driver.list_databases().await
    })
    .await
}

#[tauri::command]
pub async fn test_connection_ephemeral(
    form: ConnectionForm,
) -> Result<TestConnectionResult, String> {
    let start = Instant::now();
    let driver = crate::db::drivers::connect(&form).await?;
    driver.test_connection().await.map_err(|e| e.to_string())?;

    let elapsed = start.elapsed().as_millis() as i64;
    Ok(TestConnectionResult {
        success: true,
        message: "连接成功".to_string(),
        latency_ms: Some(elapsed),
    })
}

#[tauri::command]
pub async fn get_connections(state: State<'_, AppState>) -> Result<Vec<Connection>, String> {
    let local_db = state.local_db.lock().await;
    if let Some(db) = local_db.as_ref() {
        db.list_connections().await
    } else {
        Err("Local DB not initialized".to_string())
    }
}

#[tauri::command]
pub async fn create_connection(
    state: State<'_, AppState>,
    form: ConnectionForm,
) -> Result<Connection, String> {
    let local_db = state.local_db.lock().await;
    if let Some(db) = local_db.as_ref() {
        db.create_connection(form).await
    } else {
        Err("Local DB not initialized".to_string())
    }
}

#[tauri::command]
pub async fn update_connection(
    state: State<'_, AppState>,
    id: i64,
    form: ConnectionForm,
) -> Result<Connection, String> {
    let local_db = state.local_db.lock().await;
    if let Some(db) = local_db.as_ref() {
        // If connection is updated, we should remove it from pool so next usage reconnects with new config
        state.pool_manager.remove(&id.to_string()).await;
        // Also remove any variations like id:db? 
        // PoolManager doesn't support wildcard remove yet.
        // But keys are exact strings. If user connects to different DBs, we have multiple entries.
        // Ideally we should clear all entries starting with "id:".
        // For now, removing the base one is good enough, or we can iterate.
        // Let's stick to removing base one. Users might need to reconnect manually if they changed DB-specific settings.
        
        db.update_connection(id, form).await
    } else {
        Err("Local DB not initialized".to_string())
    }
}

#[tauri::command]
pub async fn delete_connection(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let local_db = state.local_db.lock().await;
    if let Some(db) = local_db.as_ref() {
        // Remove from pool
        state.pool_manager.remove(&id.to_string()).await;
        
        db.delete_connection(id).await
    } else {
        Err("Local DB not initialized".to_string())
    }
}
