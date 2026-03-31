use crate::models::{ConnectionForm, SchemaOverview, TableInfo, TableMetadata, TableStructure};
use crate::state::AppState;
use tauri::State;

fn ensure_table_structure_found(
    structure: TableStructure,
    table: &str,
) -> Result<TableStructure, String> {
    if structure.columns.is_empty() {
        return Err(format!(
            "[NOT_FOUND] Table '{}' does not exist or has no visible columns",
            table
        ));
    }
    Ok(structure)
}

#[tauri::command]
pub async fn get_schema_overview(
    state: State<'_, AppState>,
    id: i64,
    database: Option<String>,
    schema: Option<String>,
) -> Result<SchemaOverview, String> {
    super::execute_with_retry(&state, id, database, |driver| {
        let schema_clone = schema.clone();
        async move { driver.get_schema_overview(schema_clone).await }
    })
    .await
}

pub async fn get_schema_overview_direct(
    state: &AppState,
    id: i64,
    database: Option<String>,
    schema: Option<String>,
) -> Result<SchemaOverview, String> {
    super::execute_with_retry_from_app_state(state, id, database, |driver| {
        let schema_clone = schema.clone();
        async move { driver.get_schema_overview(schema_clone).await }
    })
    .await
}

#[tauri::command]
pub async fn list_tables_by_conn(form: ConnectionForm) -> Result<Vec<TableInfo>, String> {
    let driver = crate::db::drivers::connect(&form).await?;
    driver.list_tables(form.schema).await
}

#[tauri::command]
pub async fn list_tables(
    state: State<'_, AppState>,
    id: i64,
    database: Option<String>,
    schema: Option<String>,
) -> Result<Vec<TableInfo>, String> {
    // Note: For MySQL, schema param in list_tables usually maps to database if not null.
    // For Postgres, it maps to schema.
    // Our execute_with_retry uses database param for connection key.
    super::execute_with_retry(&state, id, database, |driver| {
        let schema_clone = schema.clone();
        async move { driver.list_tables(schema_clone).await }
    })
    .await
}

#[tauri::command]
pub async fn get_table_structure(
    state: State<'_, AppState>,
    id: i64,
    schema: String,
    table: String,
) -> Result<TableStructure, String> {
    let table_name = table.clone();
    super::execute_with_retry(&state, id, None, |driver| {
        let schema_clone = schema.clone();
        let table_clone = table.clone();
        async move { driver.get_table_structure(schema_clone, table_clone).await }
    })
    .await
    .and_then(|structure| ensure_table_structure_found(structure, &table_name))
}

pub async fn get_table_structure_direct(
    state: &AppState,
    id: i64,
    schema: String,
    table: String,
) -> Result<TableStructure, String> {
    let table_name = table.clone();
    super::execute_with_retry_from_app_state(state, id, None, |driver| {
        let schema_clone = schema.clone();
        let table_clone = table.clone();
        async move { driver.get_table_structure(schema_clone, table_clone).await }
    })
    .await
    .and_then(|structure| ensure_table_structure_found(structure, &table_name))
}

#[tauri::command]
pub async fn get_table_ddl(
    state: State<'_, AppState>,
    id: i64,
    database: Option<String>,
    schema: String,
    table: String,
) -> Result<String, String> {
    super::execute_with_retry(&state, id, database, |driver| {
        let schema_clone = schema.clone();
        let table_clone = table.clone();
        async move { driver.get_table_ddl(schema_clone, table_clone).await }
    })
    .await
}

pub async fn get_table_ddl_direct(
    state: &AppState,
    id: i64,
    database: Option<String>,
    schema: String,
    table: String,
) -> Result<String, String> {
    super::execute_with_retry_from_app_state(state, id, database, |driver| {
        let schema_clone = schema.clone();
        let table_clone = table.clone();
        async move { driver.get_table_ddl(schema_clone, table_clone).await }
    })
    .await
}

#[tauri::command]
pub async fn get_table_metadata(
    state: State<'_, AppState>,
    id: i64,
    database: Option<String>,
    schema: String,
    table: String,
) -> Result<TableMetadata, String> {
    super::execute_with_retry(&state, id, database, |driver| {
        let schema_clone = schema.clone();
        let table_clone = table.clone();
        async move { driver.get_table_metadata(schema_clone, table_clone).await }
    })
    .await
}

pub async fn get_table_metadata_direct(
    state: &AppState,
    id: i64,
    database: Option<String>,
    schema: String,
    table: String,
) -> Result<TableMetadata, String> {
    super::execute_with_retry_from_app_state(state, id, database, |driver| {
        let schema_clone = schema.clone();
        let table_clone = table.clone();
        async move { driver.get_table_metadata(schema_clone, table_clone).await }
    })
    .await
}
