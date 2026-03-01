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
        message: "Connection successful".to_string(),
        latency_ms: Some(elapsed),
    })
}

#[tauri::command]
pub async fn get_connections(state: State<'_, AppState>) -> Result<Vec<Connection>, String> {
    let local_db = {
        let lock = state.local_db.lock().await;
        lock.clone()
    };
    if let Some(db) = local_db {
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
    let local_db = {
        let lock = state.local_db.lock().await;
        lock.clone()
    };
    if let Some(db) = local_db {
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
    let local_db = {
        let lock = state.local_db.lock().await;
        lock.clone()
    };
    if let Some(db) = local_db {
        // If connection is updated, we should remove it from pool so next usage reconnects with new config
        state.pool_manager.remove_by_prefix(&id.to_string()).await;

        db.update_connection(id, form).await
    } else {
        Err("Local DB not initialized".to_string())
    }
}

#[tauri::command]
pub async fn delete_connection(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let local_db = {
        let lock = state.local_db.lock().await;
        lock.clone()
    };
    if let Some(db) = local_db {
        // Remove from pool
        state.pool_manager.remove_by_prefix(&id.to_string()).await;

        db.delete_connection(id).await
    } else {
        Err("Local DB not initialized".to_string())
    }
}
