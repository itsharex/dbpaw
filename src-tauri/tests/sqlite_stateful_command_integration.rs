use dbpaw_lib::ai::types::AiChatRequest;
use dbpaw_lib::commands::connection::{self, CreateDatabasePayload};
use dbpaw_lib::commands::metadata;
use dbpaw_lib::commands::{ai, query, storage, transfer};
use dbpaw_lib::db::drivers::sqlite::SqliteDriver;
use dbpaw_lib::db::drivers::DatabaseDriver;
use dbpaw_lib::db::local::LocalDb;
use dbpaw_lib::models::{AiProviderForm, ConnectionForm};
use dbpaw_lib::state::AppState;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

fn unique_name(prefix: &str) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time should be after unix epoch")
        .as_millis();
    format!("{}_{}", prefix, millis)
}

fn sqlite_test_path() -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("dbpaw-sqlite-stateful-{}.db", Uuid::new_v4()));
    p
}

async fn init_state_with_local_db() -> AppState {
    let state = AppState::new();
    let local_db_dir = std::env::temp_dir().join(unique_name("dbpaw_sqlite_stateful_localdb"));
    let db = LocalDb::init_with_app_dir(&local_db_dir)
        .await
        .expect("failed to initialize local db");
    let mut lock = state.local_db.lock().await;
    *lock = Some(Arc::new(db));
    drop(lock);
    state
}

fn sqlite_form(db_path: &PathBuf) -> ConnectionForm {
    ConnectionForm {
        driver: "sqlite".to_string(),
        file_path: Some(db_path.to_string_lossy().to_string()),
        ..Default::default()
    }
}

async fn create_sqlite_connection_for_state(
    state: &AppState,
    base_form: &ConnectionForm,
    suffix: &str,
) -> i64 {
    let mut form = base_form.clone();
    form.name = Some(format!("sqlite-stateful-{suffix}"));
    let created = connection::create_connection_direct(state, form)
        .await
        .expect("create_connection should succeed");
    created.id
}

async fn prepare_metadata_fixture(form: &ConnectionForm, parent_table: &str, child_table: &str) {
    let driver = SqliteDriver::connect(form)
        .await
        .expect("failed to connect sqlite driver for metadata fixture");

    driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", child_table))
        .await
        .ok();
    driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", parent_table))
        .await
        .ok();
    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INTEGER PRIMARY KEY, code TEXT)",
            parent_table
        ))
        .await
        .expect("create metadata parent table should succeed");
    driver
        .execute_query(format!(
            "CREATE TABLE {} (\
                id INTEGER PRIMARY KEY, \
                parent_id INTEGER NOT NULL, \
                name TEXT, \
                CONSTRAINT fk_{child_table}_parent FOREIGN KEY(parent_id) REFERENCES {parent_table}(id)\
            )",
            child_table
        ))
        .await
        .expect("create metadata child table should succeed");
    driver
        .execute_query(format!(
            "CREATE INDEX idx_{child_table}_name ON {}(name)",
            child_table
        ))
        .await
        .expect("create index on child table should succeed");
    driver
        .execute_query(format!(
            "INSERT INTO {} (id, code) VALUES (1, 'p1')",
            parent_table
        ))
        .await
        .expect("insert parent row should succeed");
    driver
        .execute_query(format!(
            "INSERT INTO {} (id, parent_id, name) VALUES (10, 1, 'child-a')",
            child_table
        ))
        .await
        .expect("insert child row should succeed");
    driver.close().await;
}

async fn cleanup_metadata_fixture(form: &ConnectionForm, parent_table: &str, child_table: &str) {
    let driver = SqliteDriver::connect(form)
        .await
        .expect("failed to connect sqlite driver for metadata cleanup");
    driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", child_table))
        .await
        .ok();
    driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", parent_table))
        .await
        .ok();
    driver.close().await;
}

async fn get_local_db(state: &AppState) -> Arc<LocalDb> {
    let lock = state.local_db.lock().await;
    lock.as_ref()
        .cloned()
        .expect("local db should be initialized")
}

// SQLite does not support creating databases via the create_database command.
// It returns [UNSUPPORTED] because databases are files, not server-managed schemas.
#[tokio::test]
#[ignore]
async fn test_sqlite_command_create_database_by_id_returns_unsupported() {
    let db_path = sqlite_test_path();
    let form = sqlite_form(&db_path);
    let state = init_state_with_local_db().await;
    let conn_id = create_sqlite_connection_for_state(&state, &form, "create-db-unsupported").await;

    let payload = CreateDatabasePayload {
        name: unique_name("dbpaw_sqlite_newdb"),
        if_not_exists: Some(true),
        charset: None,
        collation: None,
        encoding: None,
        lc_collate: None,
        lc_ctype: None,
    };
    let result = connection::create_database_by_id_direct(&state, conn_id, payload).await;
    assert!(result.is_err());
    let err = result.err().unwrap_or_default();
    assert!(
        err.contains("[UNSUPPORTED]"),
        "expected [UNSUPPORTED] error, got: {}",
        err
    );

    let _ = connection::delete_connection_direct(&state, conn_id).await;
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_sqlite_command_list_databases_by_id_returns_main() {
    let db_path = sqlite_test_path();
    let form = sqlite_form(&db_path);
    let state = init_state_with_local_db().await;
    let conn_id = create_sqlite_connection_for_state(&state, &form, "list-db-success").await;

    let dbs = connection::list_databases_by_id_direct(&state, conn_id)
        .await
        .expect("list_databases_by_id should succeed");
    assert!(!dbs.is_empty());
    assert!(
        dbs.contains(&"main".to_string()),
        "SQLite should always report 'main' database"
    );

    let _ = connection::delete_connection_direct(&state, conn_id).await;
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_sqlite_command_list_databases_by_id_invalid_id_returns_error() {
    let state = init_state_with_local_db().await;
    let result = connection::list_databases_by_id_direct(&state, -999_999).await;
    assert!(result.is_err());
    let err = result.err().unwrap_or_default();
    assert!(!err.trim().is_empty());
}

#[tokio::test]
#[ignore]
async fn test_sqlite_command_connection_crud_flow_create_get_update_delete() {
    let db_path = sqlite_test_path();
    let form = sqlite_form(&db_path);
    let state = init_state_with_local_db().await;

    let unique = unique_name("dbpaw_cmd_conn");
    let mut create_form = form.clone();
    create_form.name = Some(format!("sqlite-{unique}-created"));
    let created = connection::create_connection_direct(&state, create_form)
        .await
        .expect("create_connection should succeed");
    let conn_id = created.id;

    let listed = connection::get_connections_direct(&state)
        .await
        .expect("get_connections after create should succeed");
    assert!(listed.iter().any(|c| c.id == conn_id));

    let mut update_form = form.clone();
    update_form.name = Some(format!("sqlite-{unique}-updated"));
    let updated = connection::update_connection_direct(&state, conn_id, update_form)
        .await
        .expect("update_connection should succeed");
    assert_eq!(updated.id, conn_id);
    assert_eq!(updated.name, format!("sqlite-{unique}-updated"));

    connection::delete_connection_direct(&state, conn_id)
        .await
        .expect("delete_connection should succeed");
    let listed_after_delete = connection::get_connections_direct(&state)
        .await
        .expect("get_connections after delete should succeed");
    assert!(!listed_after_delete.iter().any(|c| c.id == conn_id));

    let _ = fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_sqlite_command_get_table_structure_success() {
    let db_path = sqlite_test_path();
    let form = sqlite_form(&db_path);
    let state = init_state_with_local_db().await;
    let conn_id = create_sqlite_connection_for_state(&state, &form, "meta-structure-success").await;
    let parent = unique_name("dbpaw_meta_parent");
    let child = unique_name("dbpaw_meta_child");
    prepare_metadata_fixture(&form, &parent, &child).await;

    let structure =
        metadata::get_table_structure_direct(&state, conn_id, "main".to_string(), child.clone())
            .await
            .expect("get_table_structure should succeed");
    assert!(structure.columns.iter().any(|c| c.name == "id"));
    assert!(structure.columns.iter().any(|c| c.name == "parent_id"));

    cleanup_metadata_fixture(&form, &parent, &child).await;
    let _ = connection::delete_connection_direct(&state, conn_id).await;
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_sqlite_command_get_table_structure_missing_table_returns_error() {
    let db_path = sqlite_test_path();
    let form = sqlite_form(&db_path);
    let state = init_state_with_local_db().await;
    let conn_id = create_sqlite_connection_for_state(&state, &form, "meta-structure-missing").await;
    let missing_table = unique_name("dbpaw_meta_missing");

    let result =
        metadata::get_table_structure_direct(&state, conn_id, "main".to_string(), missing_table)
            .await;
    assert!(result.is_err());
    let err = result.err().unwrap_or_default();
    assert!(!err.trim().is_empty());

    let _ = connection::delete_connection_direct(&state, conn_id).await;
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_sqlite_command_get_table_ddl_success() {
    let db_path = sqlite_test_path();
    let form = sqlite_form(&db_path);
    let state = init_state_with_local_db().await;
    let conn_id = create_sqlite_connection_for_state(&state, &form, "meta-ddl-success").await;
    let parent = unique_name("dbpaw_meta_parent");
    let child = unique_name("dbpaw_meta_child");
    prepare_metadata_fixture(&form, &parent, &child).await;

    let ddl = metadata::get_table_ddl_direct(
        &state,
        conn_id,
        Some("main".to_string()),
        "main".to_string(),
        child.clone(),
    )
    .await
    .expect("get_table_ddl should succeed");
    assert!(ddl.to_uppercase().contains("CREATE TABLE"));
    assert!(ddl.contains(&child));

    cleanup_metadata_fixture(&form, &parent, &child).await;
    let _ = connection::delete_connection_direct(&state, conn_id).await;
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_sqlite_command_get_table_metadata_contains_indexes_and_foreign_keys() {
    let db_path = sqlite_test_path();
    let form = sqlite_form(&db_path);
    let state = init_state_with_local_db().await;
    let conn_id = create_sqlite_connection_for_state(&state, &form, "meta-metadata-success").await;
    let parent = unique_name("dbpaw_meta_parent");
    let child = unique_name("dbpaw_meta_child");
    prepare_metadata_fixture(&form, &parent, &child).await;

    let meta = metadata::get_table_metadata_direct(
        &state,
        conn_id,
        Some("main".to_string()),
        "main".to_string(),
        child.clone(),
    )
    .await
    .expect("get_table_metadata should succeed");
    assert!(
        meta.indexes
            .iter()
            .any(|idx| idx.name == format!("idx_{child}_name")),
        "metadata should include the name index"
    );
    assert!(
        meta.foreign_keys.iter().any(|fk| fk.column == "parent_id"),
        "metadata should include FK on parent_id"
    );

    cleanup_metadata_fixture(&form, &parent, &child).await;
    let _ = connection::delete_connection_direct(&state, conn_id).await;
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_sqlite_command_get_schema_overview_contains_target_schema() {
    let db_path = sqlite_test_path();
    let form = sqlite_form(&db_path);
    let state = init_state_with_local_db().await;
    let conn_id = create_sqlite_connection_for_state(&state, &form, "meta-schema-overview").await;
    let parent = unique_name("dbpaw_meta_parent");
    let child = unique_name("dbpaw_meta_child");
    prepare_metadata_fixture(&form, &parent, &child).await;

    let overview = metadata::get_schema_overview_direct(
        &state,
        conn_id,
        Some("main".to_string()),
        Some("main".to_string()),
    )
    .await
    .expect("get_schema_overview should succeed");
    assert!(
        overview
            .tables
            .iter()
            .any(|t| t.schema == "main" && t.name == child),
        "schema overview should include the child table in main"
    );

    cleanup_metadata_fixture(&form, &parent, &child).await;
    let _ = connection::delete_connection_direct(&state, conn_id).await;
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_sqlite_command_execute_query_by_id_success() {
    let db_path = sqlite_test_path();
    let form = sqlite_form(&db_path);
    let state = init_state_with_local_db().await;
    let conn_id = create_sqlite_connection_for_state(&state, &form, "query-by-id-success").await;

    let result = query::execute_query_by_id_direct(
        &state,
        conn_id,
        "SELECT 1 AS v".to_string(),
        Some("main".to_string()),
        Some("phase4_success".to_string()),
        Some("phase4-qid-success".to_string()),
    )
    .await
    .expect("execute_query_by_id should succeed");
    assert!(result.success);
    assert!(result.row_count >= 1);
    assert!(!result.data.is_empty());

    let _ = connection::delete_connection_direct(&state, conn_id).await;
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_sqlite_command_execute_query_by_id_invalid_sql_returns_error() {
    let db_path = sqlite_test_path();
    let form = sqlite_form(&db_path);
    let state = init_state_with_local_db().await;
    let conn_id = create_sqlite_connection_for_state(&state, &form, "query-by-id-invalid").await;

    let result = query::execute_query_by_id_direct(
        &state,
        conn_id,
        "SELECT * FROM __dbpaw_missing_phase4_table".to_string(),
        Some("main".to_string()),
        Some("phase4_invalid".to_string()),
        Some("phase4-qid-invalid".to_string()),
    )
    .await;
    assert!(result.is_err());
    let err = result.err().unwrap_or_default();
    assert!(!err.trim().is_empty());

    let _ = connection::delete_connection_direct(&state, conn_id).await;
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_sqlite_command_list_sql_execution_logs_contains_recent_entries() {
    let db_path = sqlite_test_path();
    let form = sqlite_form(&db_path);
    let state = init_state_with_local_db().await;
    let conn_id = create_sqlite_connection_for_state(&state, &form, "query-log-list").await;

    query::execute_query_by_id_direct(
        &state,
        conn_id,
        "SELECT 1 AS phase4_log_probe".to_string(),
        Some("main".to_string()),
        Some("phase4_log_probe".to_string()),
        Some("phase4-qid-log".to_string()),
    )
    .await
    .expect("execute_query_by_id for log probe should succeed");

    let logs = query::list_sql_execution_logs_direct(&state, Some(20))
        .await
        .expect("list_sql_execution_logs should succeed");
    assert!(!logs.is_empty());
    assert!(logs.iter().any(|l| {
        l.source.as_deref() == Some("phase4_log_probe")
            && l.sql.contains("phase4_log_probe")
            && l.success
    }));

    let _ = connection::delete_connection_direct(&state, conn_id).await;
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_sqlite_command_cancel_query_non_clickhouse_returns_false() {
    let db_path = sqlite_test_path();
    let form = sqlite_form(&db_path);
    let state = init_state_with_local_db().await;
    let conn_id = create_sqlite_connection_for_state(&state, &form, "query-cancel-non-ch").await;

    let canceled =
        query::cancel_query_direct(&state, conn_id.to_string(), "phase4-qid-cancel".to_string())
            .await
            .expect("cancel_query should return bool");
    assert!(!canceled);

    let _ = connection::delete_connection_direct(&state, conn_id).await;
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_sqlite_command_storage_saved_query_crud_flow() {
    let state = init_state_with_local_db().await;
    let name = unique_name("saved_query");
    let created = storage::save_query_direct(
        &state,
        name.clone(),
        "SELECT 1".to_string(),
        Some("desc".to_string()),
        None,
        Some("main".to_string()),
    )
    .await
    .expect("save_query should succeed");
    assert_eq!(created.name, name);

    let all = storage::get_saved_queries_direct(&state)
        .await
        .expect("get_saved_queries should succeed");
    assert!(all.iter().any(|q| q.id == created.id));

    let updated = storage::update_saved_query_direct(
        &state,
        created.id,
        format!("{}_updated", created.name),
        "SELECT 2".to_string(),
        Some("desc2".to_string()),
        None,
        Some("main".to_string()),
    )
    .await
    .expect("update_saved_query should succeed");
    assert_eq!(updated.query, "SELECT 2");

    storage::delete_saved_query_direct(&state, created.id)
        .await
        .expect("delete_saved_query should succeed");
    let all_after = storage::get_saved_queries_direct(&state)
        .await
        .expect("get_saved_queries after delete should succeed");
    assert!(!all_after.iter().any(|q| q.id == created.id));
}

#[tokio::test]
#[ignore]
async fn test_sqlite_command_transfer_export_and_import_minimal_flow() {
    let db_path = sqlite_test_path();
    let form = sqlite_form(&db_path);
    let state = init_state_with_local_db().await;
    let conn_id = create_sqlite_connection_for_state(&state, &form, "transfer-minimal").await;

    let table = unique_name("dbpaw_transfer_src");
    let driver = SqliteDriver::connect(&form)
        .await
        .expect("failed to connect sqlite driver");
    driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", table))
        .await
        .ok();
    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INTEGER PRIMARY KEY, name TEXT)",
            table
        ))
        .await
        .expect("create transfer src table should succeed");
    driver
        .execute_query(format!(
            "INSERT INTO {} (id, name) VALUES (1, 'a'), (2, 'b')",
            table
        ))
        .await
        .expect("insert transfer src rows should succeed");
    driver.close().await;

    let base = std::env::temp_dir().join(unique_name("dbpaw_sqlite_transfer_it"));
    fs::create_dir_all(&base).expect("create temp transfer dir should succeed");
    let table_export_path = base.join("table_export.csv");
    let query_export_path = base.join("query_export.json");
    let import_sql_path = base.join("import.sql");

    let table_export = transfer::export_table_data_direct(
        &state,
        conn_id,
        Some("main".to_string()),
        "main".to_string(),
        table.clone(),
        "sqlite".to_string(),
        transfer::ExportFormat::Csv,
        transfer::ExportScope::FullTable,
        None,
        None,
        None,
        None,
        None,
        None,
        Some(table_export_path.to_string_lossy().to_string()),
        Some(100),
    )
    .await
    .expect("export_table_data should succeed");
    assert!(table_export.row_count >= 2);
    assert!(std::path::Path::new(&table_export.file_path).exists());

    let query_export = transfer::export_query_result_direct(
        &state,
        conn_id,
        Some("main".to_string()),
        format!("SELECT * FROM {} ORDER BY id", table),
        "sqlite".to_string(),
        transfer::ExportFormat::Json,
        Some(query_export_path.to_string_lossy().to_string()),
    )
    .await
    .expect("export_query_result should succeed");
    assert!(query_export.row_count >= 2);
    assert!(std::path::Path::new(&query_export.file_path).exists());

    let import_table = unique_name("dbpaw_import_dst");
    let import_sql = format!(
        "CREATE TABLE {} (id INTEGER PRIMARY KEY, name TEXT);\nINSERT INTO {} (id, name) VALUES (1, 'x');",
        import_table, import_table
    );
    fs::write(&import_sql_path, import_sql).expect("write import sql file should succeed");
    let import_result = transfer::import_sql_file_direct(
        &state,
        conn_id,
        Some("main".to_string()),
        import_sql_path.to_string_lossy().to_string(),
        "sqlite".to_string(),
    )
    .await
    .expect("import_sql_file should succeed");
    assert_eq!(
        import_result.success_statements,
        import_result.total_statements
    );
    assert!(import_result.error.is_none());

    let cleanup_driver = SqliteDriver::connect(&form)
        .await
        .expect("failed to connect sqlite driver for transfer cleanup");
    let _ = cleanup_driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", table))
        .await;
    let _ = cleanup_driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", import_table))
        .await;
    cleanup_driver.close().await;

    let _ = fs::remove_file(table_export_path);
    let _ = fs::remove_file(query_export_path);
    let _ = fs::remove_file(import_sql_path);
    let _ = fs::remove_dir_all(base);
    let _ = connection::delete_connection_direct(&state, conn_id).await;
    let _ = fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_sqlite_command_ai_minimal_provider_conversation_and_chat_flow() {
    let state = init_state_with_local_db().await;

    let start_without_provider = ai::ai_chat_start_direct(
        &state,
        AiChatRequest {
            request_id: unique_name("ai_start_no_provider"),
            provider_id: None,
            conversation_id: None,
            scenario: "sql_generate".to_string(),
            input: "select 1".to_string(),
            title: Some("phase5 start".to_string()),
            connection_id: None,
            database: None,
            schema_overview: None,
            selected_tables: None,
        },
    )
    .await;
    assert!(start_without_provider.is_err());

    let created_provider = ai::ai_create_provider_direct(
        &state,
        AiProviderForm {
            name: unique_name("ai_provider"),
            provider_type: Some("openai".to_string()),
            base_url: "https://example.invalid/v1".to_string(),
            model: "gpt-4o-mini".to_string(),
            api_key: Some("sk-test".to_string()),
            is_default: Some(true),
            enabled: Some(true),
            extra_json: None,
        },
    )
    .await
    .expect("ai_create_provider should succeed");
    let providers = ai::ai_list_providers_direct(&state)
        .await
        .expect("ai_list_providers should succeed");
    assert!(providers.iter().any(|p| p.id == created_provider.id));

    let updated_provider = ai::ai_update_provider_direct(
        &state,
        created_provider.id,
        AiProviderForm {
            name: format!("{}_updated", created_provider.name),
            provider_type: Some("openai".to_string()),
            base_url: "https://example.invalid/v1".to_string(),
            model: "gpt-4o-mini".to_string(),
            api_key: Some("sk-test-2".to_string()),
            is_default: Some(true),
            enabled: Some(true),
            extra_json: None,
        },
    )
    .await
    .expect("ai_update_provider should succeed");
    assert_eq!(updated_provider.id, created_provider.id);

    ai::ai_set_default_provider_direct(&state, created_provider.id)
        .await
        .expect("ai_set_default_provider should succeed");
    ai::ai_clear_provider_api_key_direct(&state, "openai".to_string())
        .await
        .expect("ai_clear_provider_api_key should succeed");

    let continue_without_conversation = ai::ai_chat_continue_direct(
        &state,
        AiChatRequest {
            request_id: unique_name("ai_continue_no_conv"),
            provider_id: Some(created_provider.id),
            conversation_id: None,
            scenario: "sql_generate".to_string(),
            input: "continue".to_string(),
            title: None,
            connection_id: None,
            database: None,
            schema_overview: None,
            selected_tables: None,
        },
    )
    .await;
    assert!(continue_without_conversation.is_err());

    let db = get_local_db(&state).await;
    let conv = db
        .create_ai_conversation(
            unique_name("ai_conv"),
            "sql_generate".to_string(),
            None,
            None,
        )
        .await
        .expect("create ai conversation in local db should succeed");
    let conversations = ai::ai_list_conversations_direct(&state, None, None)
        .await
        .expect("ai_list_conversations should succeed");
    assert!(conversations.iter().any(|c| c.id == conv.id));
    let detail = ai::ai_get_conversation_direct(&state, conv.id)
        .await
        .expect("ai_get_conversation should succeed");
    assert_eq!(detail.conversation.id, conv.id);
    ai::ai_delete_conversation_direct(&state, conv.id)
        .await
        .expect("ai_delete_conversation should succeed");
    let conversations_after = ai::ai_list_conversations_direct(&state, None, None)
        .await
        .expect("ai_list_conversations after delete should succeed");
    assert!(!conversations_after.iter().any(|c| c.id == conv.id));

    ai::ai_delete_provider_direct(&state, created_provider.id)
        .await
        .expect("ai_delete_provider should succeed");
}
