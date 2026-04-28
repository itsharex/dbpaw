use crate::datasources::elasticsearch::{
    ElasticsearchClient, ElasticsearchConnectionInfo, ElasticsearchDocument,
    ElasticsearchIndexInfo, ElasticsearchIndexOperationResult, ElasticsearchMutationResult,
    ElasticsearchRawResponse, ElasticsearchSearchResponse,
};
use crate::models::TestConnectionResult;
use crate::state::AppState;
use serde_json::Value;
use std::time::Instant;
use tauri::State;

async fn connection_form(
    state: &State<'_, AppState>,
    id: i64,
) -> Result<crate::models::ConnectionForm, String> {
    let local_db = {
        let lock = state.local_db.lock().await;
        lock.clone()
    };
    let db = local_db.ok_or("Local DB not initialized")?;
    let form = db.get_connection_form_by_id(id).await?;
    if form.driver != "elasticsearch" {
        return Err(format!(
            "[UNSUPPORTED] Connection {} is not an Elasticsearch connection",
            id
        ));
    }
    Ok(form)
}

async fn client_from_id(
    state: &State<'_, AppState>,
    id: i64,
) -> Result<ElasticsearchClient, String> {
    ElasticsearchClient::connect(&connection_form(state, id).await?)
}

#[tauri::command]
pub async fn elasticsearch_test_connection(
    state: State<'_, AppState>,
    id: i64,
) -> Result<ElasticsearchConnectionInfo, String> {
    client_from_id(&state, id).await?.test_connection().await
}

#[tauri::command]
pub async fn elasticsearch_test_connection_ephemeral(
    form: crate::models::ConnectionForm,
) -> Result<TestConnectionResult, String> {
    let started = Instant::now();
    let client = ElasticsearchClient::connect(&form)?;
    match client.test_connection().await {
        Ok(info) => Ok(TestConnectionResult {
            success: true,
            message: format!(
                "Connected to Elasticsearch {}",
                info.version.unwrap_or_else(|| "cluster".to_string())
            ),
            latency_ms: Some(started.elapsed().as_millis() as i64),
        }),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn elasticsearch_list_indices(
    state: State<'_, AppState>,
    id: i64,
) -> Result<Vec<ElasticsearchIndexInfo>, String> {
    client_from_id(&state, id).await?.list_indices().await
}

#[tauri::command]
pub async fn elasticsearch_get_index_mapping(
    state: State<'_, AppState>,
    id: i64,
    index: String,
) -> Result<Value, String> {
    client_from_id(&state, id)
        .await?
        .get_index_mapping(index)
        .await
}

#[tauri::command]
pub async fn elasticsearch_create_index(
    state: State<'_, AppState>,
    id: i64,
    index: String,
    body: Option<Value>,
) -> Result<ElasticsearchIndexOperationResult, String> {
    client_from_id(&state, id)
        .await?
        .create_index(index, body)
        .await
}

#[tauri::command]
pub async fn elasticsearch_delete_index(
    state: State<'_, AppState>,
    id: i64,
    index: String,
) -> Result<ElasticsearchIndexOperationResult, String> {
    client_from_id(&state, id).await?.delete_index(index).await
}

#[tauri::command]
pub async fn elasticsearch_refresh_index(
    state: State<'_, AppState>,
    id: i64,
    index: String,
) -> Result<ElasticsearchIndexOperationResult, String> {
    client_from_id(&state, id).await?.refresh_index(index).await
}

#[tauri::command]
pub async fn elasticsearch_open_index(
    state: State<'_, AppState>,
    id: i64,
    index: String,
) -> Result<ElasticsearchIndexOperationResult, String> {
    client_from_id(&state, id).await?.open_index(index).await
}

#[tauri::command]
pub async fn elasticsearch_close_index(
    state: State<'_, AppState>,
    id: i64,
    index: String,
) -> Result<ElasticsearchIndexOperationResult, String> {
    client_from_id(&state, id).await?.close_index(index).await
}

#[tauri::command]
pub async fn elasticsearch_search_documents(
    state: State<'_, AppState>,
    id: i64,
    index: String,
    query: Option<String>,
    dsl: Option<String>,
    from: i64,
    size: i64,
) -> Result<ElasticsearchSearchResponse, String> {
    client_from_id(&state, id)
        .await?
        .search_documents(index, query, dsl, from, size)
        .await
}

#[tauri::command]
pub async fn elasticsearch_get_document(
    state: State<'_, AppState>,
    id: i64,
    index: String,
    document_id: String,
) -> Result<ElasticsearchDocument, String> {
    client_from_id(&state, id)
        .await?
        .get_document(index, document_id)
        .await
}

#[tauri::command]
pub async fn elasticsearch_upsert_document(
    state: State<'_, AppState>,
    id: i64,
    index: String,
    document_id: Option<String>,
    source: Value,
    refresh: Option<bool>,
) -> Result<ElasticsearchMutationResult, String> {
    client_from_id(&state, id)
        .await?
        .upsert_document(index, document_id, source, refresh.unwrap_or(true))
        .await
}

#[tauri::command]
pub async fn elasticsearch_delete_document(
    state: State<'_, AppState>,
    id: i64,
    index: String,
    document_id: String,
    refresh: Option<bool>,
) -> Result<ElasticsearchMutationResult, String> {
    client_from_id(&state, id)
        .await?
        .delete_document(index, document_id, refresh.unwrap_or(true))
        .await
}

#[tauri::command]
pub async fn elasticsearch_execute_raw(
    state: State<'_, AppState>,
    id: i64,
    method: String,
    path: String,
    body: Option<String>,
) -> Result<ElasticsearchRawResponse, String> {
    client_from_id(&state, id)
        .await?
        .execute_raw(method, path, body)
        .await
}
