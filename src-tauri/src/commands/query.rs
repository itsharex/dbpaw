use crate::models::{ConnectionForm, TableDataResponse, QueryResult};
use crate::state::AppState;
use tauri::{Emitter, State};

#[tauri::command]
pub async fn get_table_data_by_conn(
    form: ConnectionForm,
    schema: String,
    table: String,
    page: i64,
    limit: i64,
) -> Result<TableDataResponse, String> {
    let driver = crate::db::drivers::connect(&form).await?;
    driver.get_table_data(schema, table, page, limit, None, None, None, None).await
}

#[tauri::command]
pub async fn execute_query(app_handle: tauri::AppHandle, state: State<'_, AppState>, id: i64, query: String, database: Option<String>) -> Result<QueryResult, String> {
    let query_id = format!("q-{}", id);
    let _ = app_handle.emit("query.progress", serde_json::json!({"queryId": query_id, "phase": "prepare"}));
    
    let result = super::execute_with_retry(&state, id, database, |driver| {
        let query_clone = query.clone();
        async move { driver.execute_query(query_clone).await }
    }).await;
    
    if let Ok(res) = &result {
        // Stream first chunk for UX (simulated)
        if !res.data.is_empty() {
            let _ = app_handle.emit("query.chunk", serde_json::json!({
                "queryId": query_id, 
                "rows": res.data.iter().take(50).collect::<Vec<_>>()
            }));
        }
    }
    
    result
}

#[tauri::command]
pub async fn get_table_data(
    state: State<'_, AppState>,
    id: i64,
    schema: String,
    table: String,
    page: i64,
    limit: i64,
    filter: Option<String>,
    sort_column: Option<String>,
    sort_direction: Option<String>,
    order_by: Option<String>,
) -> Result<TableDataResponse, String> {
    super::execute_with_retry(&state, id, None, |driver| {
        let schema_clone = schema.clone();
        let table_clone = table.clone();
        let filter_clone = filter.clone();
        let sort_col_clone = sort_column.clone();
        let sort_dir_clone = sort_direction.clone();
        let order_by_clone = order_by.clone();
        async move {
            driver.get_table_data(
                schema_clone,
                table_clone,
                page,
                limit,
                sort_col_clone,
                sort_dir_clone,
                filter_clone,
                order_by_clone,
            ).await
        }
    }).await
}

#[tauri::command]
pub async fn cancel_query(_uuid: String, _query_id: String) -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
pub async fn execute_by_conn(app_handle: tauri::AppHandle, form: ConnectionForm, sql: String) -> Result<QueryResult, String> {
    let query_id = "q-conn-ephemeral";
    let _ = app_handle.emit("query.progress", serde_json::json!({"queryId": query_id, "phase": "prepare"}));
    
    let driver = crate::db::drivers::connect(&form).await?;
    let result = driver.execute_query(sql).await;
    
    if let Ok(res) = &result {
        if !res.data.is_empty() {
             let _ = app_handle.emit("query.chunk", serde_json::json!({
                "queryId": query_id, 
                "rows": res.data.iter().take(50).collect::<Vec<_>>()
            }));
        }
    }
    result
}
