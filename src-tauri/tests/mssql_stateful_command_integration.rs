#[path = "common/mssql_context.rs"]
mod mssql_context;

use dbpaw_lib::commands::connection::{self, CreateDatabasePayload};
use dbpaw_lib::commands::metadata;
use dbpaw_lib::commands::{query, storage, transfer};
use dbpaw_lib::db::drivers::mssql::MssqlDriver;
use dbpaw_lib::db::drivers::DatabaseDriver;
use dbpaw_lib::db::local::LocalDb;
use dbpaw_lib::models::ConnectionForm;
use dbpaw_lib::state::AppState;
use mssql_context::{
    default_mssql_object_name, default_mssql_schema, qualify_default_mssql_table,
    shared_mssql_form, unique_name, wait_until_ready,
};
use std::fs;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

struct StatefulMssqlContext {
    form: ConnectionForm,
    state: AppState,
    conn_id: i64,
}

async fn init_state_with_local_db() -> AppState {
    let state = AppState::new();
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_nanos();
    let local_db_dir = std::env::temp_dir().join(format!(
        "dbpaw_localdb_stateful_it_{}_{}_{}",
        std::process::id(),
        std::thread::current().name().unwrap_or("unnamed"),
        stamp
    ));
    let db = LocalDb::init_with_app_dir(&local_db_dir)
        .await
        .expect("failed to initialize local db");
    let mut lock = state.local_db.lock().await;
    *lock = Some(Arc::new(db));
    drop(lock);
    state
}

async fn create_mssql_connection_for_state(
    state: &AppState,
    base_form: &ConnectionForm,
    suffix: &str,
) -> i64 {
    let mut form = base_form.clone();
    form.name = Some(format!("mssql-stateful-{suffix}"));
    let created = connection::create_connection_direct(state, form)
        .await
        .expect("create_connection should succeed");
    created.id
}

fn default_database(form: &ConnectionForm) -> Option<String> {
    form.database.clone().or(Some("master".to_string()))
}

async fn init_stateful_mssql_context(suffix: &str) -> StatefulMssqlContext {
    let form = shared_mssql_form();
    wait_until_ready(&form).await;
    let state = init_state_with_local_db().await;
    let conn_id = create_mssql_connection_for_state(&state, &form, suffix).await;
    StatefulMssqlContext {
        form,
        state,
        conn_id,
    }
}

async fn delete_stateful_connection(state: &AppState, conn_id: i64) {
    let _ = connection::delete_connection_direct(state, conn_id).await;
}

async fn drop_database_if_exists(form: &ConnectionForm, db_name: &str) {
    let driver = MssqlDriver::connect(form)
        .await
        .expect("failed to connect mssql driver for cleanup");
    let escaped_db_name = db_name.replace('\'', "''");
    let quoted_db_name = format!("[{}]", db_name.replace(']', "]]"));
    let _ = driver
        .execute_query(format!(
            "IF DB_ID(N'{}') IS NOT NULL BEGIN ALTER DATABASE {} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE {}; END",
            escaped_db_name, quoted_db_name, quoted_db_name
        ))
        .await;
    driver.close().await;
}

async fn prepare_metadata_fixture(form: &ConnectionForm, parent_table: &str, child_table: &str) {
    let driver = MssqlDriver::connect(form)
        .await
        .expect("failed to connect mssql driver for metadata fixture");
    let parent_qualified = qualify_default_mssql_table(parent_table);
    let child_qualified = qualify_default_mssql_table(child_table);
    let parent_object_name = default_mssql_object_name(parent_table);
    let child_object_name = default_mssql_object_name(child_table);
    let fk_name = format!("fk_{}_parent", child_table);

    let _ = driver
        .execute_query(format!(
            "IF OBJECT_ID(N'{}', N'U') IS NOT NULL DROP TABLE {}",
            child_object_name, child_qualified
        ))
        .await;
    let _ = driver
        .execute_query(format!(
            "IF OBJECT_ID(N'{}', N'U') IS NOT NULL DROP TABLE {}",
            parent_object_name, parent_qualified
        ))
        .await;

    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, code NVARCHAR(30))",
            parent_qualified
        ))
        .await
        .expect("create metadata parent table should succeed");
    driver
        .execute_query(format!(
            "CREATE TABLE {} (\
                id INT PRIMARY KEY, \
                parent_id INT NOT NULL, \
                name NVARCHAR(64), \
                CONSTRAINT [{}] FOREIGN KEY (parent_id) REFERENCES {}(id)\
            )",
            child_qualified,
            fk_name.replace(']', "]]"),
            parent_qualified
        ))
        .await
        .expect("create metadata child table should succeed");
    driver
        .execute_query(format!(
            "CREATE INDEX idx_child_name ON {} (name)",
            child_qualified
        ))
        .await
        .expect("create metadata child index should succeed");
    driver
        .execute_query(format!(
            "INSERT INTO {} (id, code) VALUES (1, N'p1')",
            parent_qualified
        ))
        .await
        .expect("insert parent row should succeed");
    driver
        .execute_query(format!(
            "INSERT INTO {} (id, parent_id, name) VALUES (10, 1, N'child-a')",
            child_qualified
        ))
        .await
        .expect("insert child row should succeed");
    driver.close().await;
}

async fn cleanup_metadata_fixture(form: &ConnectionForm, parent_table: &str, child_table: &str) {
    let driver = MssqlDriver::connect(form)
        .await
        .expect("failed to connect mssql driver for metadata cleanup");
    let parent_qualified = qualify_default_mssql_table(parent_table);
    let child_qualified = qualify_default_mssql_table(child_table);
    let parent_object_name = default_mssql_object_name(parent_table);
    let child_object_name = default_mssql_object_name(child_table);
    let _ = driver
        .execute_query(format!(
            "IF OBJECT_ID(N'{}', N'U') IS NOT NULL DROP TABLE {}",
            child_object_name, child_qualified
        ))
        .await;
    let _ = driver
        .execute_query(format!(
            "IF OBJECT_ID(N'{}', N'U') IS NOT NULL DROP TABLE {}",
            parent_object_name, parent_qualified
        ))
        .await;
    driver.close().await;
}

fn scalar_to_i64(value: &serde_json::Value) -> i64 {
    if let Some(v) = value.as_i64() {
        return v;
    }
    value
        .as_str()
        .and_then(|v| v.parse::<i64>().ok())
        .expect("scalar should be i64 or parseable string")
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_create_database_by_id_success() {
    let ctx = init_stateful_mssql_context("create-db-success").await;

    let db_name = unique_name("dbpaw_cmd_created_db");
    let payload = CreateDatabasePayload {
        name: db_name.clone(),
        if_not_exists: Some(true),
        charset: None,
        collation: None,
        encoding: None,
        lc_collate: None,
        lc_ctype: None,
    };

    connection::create_database_by_id_direct(&ctx.state, ctx.conn_id, payload)
        .await
        .expect("create_database_by_id should succeed");
    let dbs = connection::list_databases_by_id_direct(&ctx.state, ctx.conn_id)
        .await
        .expect("list_databases_by_id should succeed");
    assert!(dbs.iter().any(|d| d == &db_name));

    drop_database_if_exists(&ctx.form, &db_name).await;
    delete_stateful_connection(&ctx.state, ctx.conn_id).await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_create_database_by_id_if_not_exists_idempotent() {
    let ctx = init_stateful_mssql_context("create-db-idempotent").await;

    let db_name = unique_name("dbpaw_cmd_idempotent_db");
    let payload = CreateDatabasePayload {
        name: db_name.clone(),
        if_not_exists: Some(true),
        charset: None,
        collation: None,
        encoding: None,
        lc_collate: None,
        lc_ctype: None,
    };

    connection::create_database_by_id_direct(&ctx.state, ctx.conn_id, payload.clone())
        .await
        .expect("first create_database_by_id should succeed");
    connection::create_database_by_id_direct(&ctx.state, ctx.conn_id, payload)
        .await
        .expect("second create_database_by_id should succeed");

    drop_database_if_exists(&ctx.form, &db_name).await;
    delete_stateful_connection(&ctx.state, ctx.conn_id).await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_create_database_by_id_invalid_name_returns_validation_error() {
    let ctx = init_stateful_mssql_context("invalid-db-name").await;

    let payload = CreateDatabasePayload {
        name: "   ".to_string(),
        if_not_exists: Some(true),
        charset: None,
        collation: None,
        encoding: None,
        lc_collate: None,
        lc_ctype: None,
    };
    let result = connection::create_database_by_id_direct(&ctx.state, ctx.conn_id, payload).await;
    assert!(result.is_err());
    let err = result.err().unwrap_or_default();
    assert!(err.contains("[VALIDATION_ERROR]"));

    delete_stateful_connection(&ctx.state, ctx.conn_id).await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_list_databases_by_id_success() {
    let ctx = init_stateful_mssql_context("list-db-success").await;

    let target_db = default_database(&ctx.form).unwrap_or_else(|| "master".to_string());
    let dbs = connection::list_databases_by_id_direct(&ctx.state, ctx.conn_id)
        .await
        .expect("list_databases_by_id should succeed");
    assert!(!dbs.is_empty());
    assert!(dbs.iter().any(|d| d == &target_db));

    delete_stateful_connection(&ctx.state, ctx.conn_id).await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_list_databases_by_id_invalid_id_returns_error() {
    let state = init_state_with_local_db().await;
    let result = connection::list_databases_by_id_direct(&state, -999_999).await;
    assert!(result.is_err());
    let err = result.err().unwrap_or_default();
    assert!(!err.trim().is_empty());
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_connection_crud_flow_create_get_update_delete() {
    let form = shared_mssql_form();
    wait_until_ready(&form).await;
    let state = init_state_with_local_db().await;

    let unique = unique_name("dbpaw_cmd_conn");
    let mut create_form = form.clone();
    create_form.name = Some(format!("mssql-{unique}-created"));
    let created = connection::create_connection_direct(&state, create_form)
        .await
        .expect("create_connection should succeed");
    let conn_id = created.id;

    let listed = connection::get_connections_direct(&state)
        .await
        .expect("get_connections after create should succeed");
    assert!(listed.iter().any(|c| c.id == conn_id));

    let mut update_form = form.clone();
    update_form.name = Some(format!("mssql-{unique}-updated"));
    update_form.database = form.database.clone().or(Some("master".to_string()));
    let updated = connection::update_connection_direct(&state, conn_id, update_form)
        .await
        .expect("update_connection should succeed");
    assert_eq!(updated.id, conn_id);
    assert_eq!(updated.name, format!("mssql-{unique}-updated"));

    connection::delete_connection_direct(&state, conn_id)
        .await
        .expect("delete_connection should succeed");
    let listed_after_delete = connection::get_connections_direct(&state)
        .await
        .expect("get_connections after delete should succeed");
    assert!(!listed_after_delete.iter().any(|c| c.id == conn_id));
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_get_table_structure_success() {
    let ctx = init_stateful_mssql_context("meta-structure-success").await;
    let schema = default_mssql_schema();
    let parent = unique_name("dbpaw_meta_parent");
    let child = unique_name("dbpaw_meta_child");
    prepare_metadata_fixture(&ctx.form, &parent, &child).await;

    let structure =
        metadata::get_table_structure_direct(&ctx.state, ctx.conn_id, schema, child.clone())
            .await
            .expect("get_table_structure should succeed");
    assert!(structure.columns.iter().any(|c| c.name == "id"));
    assert!(structure.columns.iter().any(|c| c.name == "parent_id"));

    cleanup_metadata_fixture(&ctx.form, &parent, &child).await;
    delete_stateful_connection(&ctx.state, ctx.conn_id).await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_get_table_structure_missing_table_returns_error() {
    let ctx = init_stateful_mssql_context("meta-structure-missing").await;
    let missing_table = unique_name("dbpaw_meta_missing");

    let result = metadata::get_table_structure_direct(
        &ctx.state,
        ctx.conn_id,
        default_mssql_schema(),
        missing_table,
    )
    .await;
    assert!(result.is_err());
    let err = result.err().unwrap_or_default();
    assert!(!err.trim().is_empty());

    delete_stateful_connection(&ctx.state, ctx.conn_id).await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_get_table_ddl_success() {
    let ctx = init_stateful_mssql_context("meta-ddl-success").await;
    let schema = default_mssql_schema();
    let database = default_database(&ctx.form);
    let parent = unique_name("dbpaw_meta_parent");
    let child = unique_name("dbpaw_meta_child");
    prepare_metadata_fixture(&ctx.form, &parent, &child).await;

    let ddl =
        metadata::get_table_ddl_direct(&ctx.state, ctx.conn_id, database, schema, child.clone())
            .await
            .expect("get_table_ddl should succeed");
    assert!(ddl.to_uppercase().contains("CREATE TABLE"));
    assert!(ddl.contains(&child));

    cleanup_metadata_fixture(&ctx.form, &parent, &child).await;
    delete_stateful_connection(&ctx.state, ctx.conn_id).await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_get_table_metadata_contains_indexes_and_foreign_keys() {
    let ctx = init_stateful_mssql_context("meta-metadata-success").await;
    let schema = default_mssql_schema();
    let database = default_database(&ctx.form);
    let parent = unique_name("dbpaw_meta_parent");
    let child = unique_name("dbpaw_meta_child");
    prepare_metadata_fixture(&ctx.form, &parent, &child).await;

    let meta = metadata::get_table_metadata_direct(
        &ctx.state,
        ctx.conn_id,
        database,
        schema,
        child.clone(),
    )
    .await
    .expect("get_table_metadata should succeed");
    assert!(meta.indexes.iter().any(|idx| idx.name == "idx_child_name"));
    assert!(meta.foreign_keys.iter().any(|fk| fk.column == "parent_id"));

    cleanup_metadata_fixture(&ctx.form, &parent, &child).await;
    delete_stateful_connection(&ctx.state, ctx.conn_id).await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_get_schema_overview_contains_target_schema() {
    let ctx = init_stateful_mssql_context("meta-schema-overview").await;
    let schema = default_mssql_schema();
    let database = default_database(&ctx.form);
    let parent = unique_name("dbpaw_meta_parent");
    let child = unique_name("dbpaw_meta_child");
    prepare_metadata_fixture(&ctx.form, &parent, &child).await;

    let overview = metadata::get_schema_overview_direct(
        &ctx.state,
        ctx.conn_id,
        database,
        Some(schema.clone()),
    )
    .await
    .expect("get_schema_overview should succeed");
    assert!(overview
        .tables
        .iter()
        .any(|t| t.schema == schema && t.name == child));

    cleanup_metadata_fixture(&ctx.form, &parent, &child).await;
    delete_stateful_connection(&ctx.state, ctx.conn_id).await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_execute_query_by_id_success() {
    let ctx = init_stateful_mssql_context("query-by-id-success").await;
    let database = default_database(&ctx.form);

    let result = query::execute_query_by_id_direct(
        &ctx.state,
        ctx.conn_id,
        "SELECT 1 AS v".to_string(),
        database,
        Some("phase4_success".to_string()),
        Some("phase4-qid-success".to_string()),
    )
    .await
    .expect("execute_query_by_id should succeed");
    assert!(result.success);
    assert!(result.row_count >= 1);
    assert!(!result.data.is_empty());

    delete_stateful_connection(&ctx.state, ctx.conn_id).await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_execute_query_by_id_invalid_sql_returns_error() {
    let ctx = init_stateful_mssql_context("query-by-id-invalid").await;
    let database = default_database(&ctx.form);

    let result = query::execute_query_by_id_direct(
        &ctx.state,
        ctx.conn_id,
        "SELECT * FROM __dbpaw_missing_phase4_table".to_string(),
        database,
        Some("phase4_invalid".to_string()),
        Some("phase4-qid-invalid".to_string()),
    )
    .await;
    assert!(result.is_err());
    let err = result.err().unwrap_or_default();
    assert!(!err.trim().is_empty());

    delete_stateful_connection(&ctx.state, ctx.conn_id).await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_list_sql_execution_logs_contains_recent_entries() {
    let ctx = init_stateful_mssql_context("query-log-list").await;
    let database = default_database(&ctx.form);

    query::execute_query_by_id_direct(
        &ctx.state,
        ctx.conn_id,
        "SELECT 1 AS phase4_log_probe".to_string(),
        database,
        Some("phase4_log_probe".to_string()),
        Some("phase4-qid-log".to_string()),
    )
    .await
    .expect("execute_query_by_id for log probe should succeed");

    let logs = query::list_sql_execution_logs_direct(&ctx.state, Some(20))
        .await
        .expect("list_sql_execution_logs should succeed");
    assert!(!logs.is_empty());
    assert!(logs.iter().any(|l| {
        l.source.as_deref() == Some("phase4_log_probe")
            && l.sql.contains("phase4_log_probe")
            && l.success
    }));

    delete_stateful_connection(&ctx.state, ctx.conn_id).await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_cancel_query_non_clickhouse_returns_false() {
    let ctx = init_stateful_mssql_context("query-cancel-non-ch").await;

    let canceled = query::cancel_query_direct(
        &ctx.state,
        ctx.conn_id.to_string(),
        "phase4-qid-cancel".to_string(),
    )
    .await
    .expect("cancel_query should return bool");
    assert!(!canceled);

    delete_stateful_connection(&ctx.state, ctx.conn_id).await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_storage_saved_query_crud_flow() {
    let state = init_state_with_local_db().await;
    let name = unique_name("saved_query");
    let created = storage::save_query_direct(
        &state,
        name.clone(),
        "SELECT 1".to_string(),
        Some("desc".to_string()),
        None,
        Some("master".to_string()),
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
        Some("master".to_string()),
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
async fn test_mssql_command_transfer_export_minimal_flow() {
    let ctx = init_stateful_mssql_context("transfer-export").await;
    let schema = default_mssql_schema();
    let database = default_database(&ctx.form);
    let table = unique_name("dbpaw_transfer_src");
    let qualified = qualify_default_mssql_table(&table);
    let object_name = default_mssql_object_name(&table);

    let driver = MssqlDriver::connect(&ctx.form)
        .await
        .expect("failed to connect mssql driver");
    let _ = driver
        .execute_query(format!(
            "IF OBJECT_ID(N'{}', N'U') IS NOT NULL DROP TABLE {}",
            object_name, qualified
        ))
        .await;
    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, name NVARCHAR(64))",
            qualified
        ))
        .await
        .expect("create transfer src table should succeed");
    driver
        .execute_query(format!(
            "INSERT INTO {} (id, name) VALUES (1, N'a'), (2, N'b')",
            qualified
        ))
        .await
        .expect("insert transfer src rows should succeed");
    driver.close().await;

    let base = std::env::temp_dir().join(unique_name("dbpaw_mssql_transfer_it"));
    fs::create_dir_all(&base).expect("create temp transfer dir should succeed");
    let table_export_path = base.join("table_export.csv");
    let query_export_path = base.join("query_export.json");

    let table_export = transfer::export_table_data_direct(
        &ctx.state,
        ctx.conn_id,
        database.clone(),
        schema.clone(),
        table.clone(),
        "mssql".to_string(),
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
        &ctx.state,
        ctx.conn_id,
        database.clone(),
        format!("SELECT * FROM {} ORDER BY id", qualified),
        "mssql".to_string(),
        transfer::ExportFormat::Json,
        Some(query_export_path.to_string_lossy().to_string()),
    )
    .await
    .expect("export_query_result should succeed");
    assert!(query_export.row_count >= 2);
    assert!(std::path::Path::new(&query_export.file_path).exists());

    let verify_driver = MssqlDriver::connect(&ctx.form)
        .await
        .expect("failed to connect mssql driver for verification");
    let verify = verify_driver
        .execute_query(format!("SELECT COUNT(*) AS c FROM {}", qualified))
        .await
        .expect("verify exported mssql table should still be queryable");
    let count = scalar_to_i64(&verify.data[0]["c"]);
    assert_eq!(count, 2);

    let listed_tables = metadata::get_schema_overview_direct(
        &ctx.state,
        ctx.conn_id,
        database.clone(),
        Some(schema.clone()),
    )
    .await
    .expect("get_schema_overview after export should succeed");
    assert!(listed_tables
        .tables
        .iter()
        .any(|t| t.schema == schema && t.name == table));
    let _ = verify_driver
        .execute_query(format!(
            "IF OBJECT_ID(N'{}', N'U') IS NOT NULL DROP TABLE {}",
            object_name, qualified
        ))
        .await;
    verify_driver.close().await;

    let _ = fs::remove_file(table_export_path);
    let _ = fs::remove_file(query_export_path);
    let _ = fs::remove_dir_all(base);
    delete_stateful_connection(&ctx.state, ctx.conn_id).await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_import_sql_file_supports_explicit_transaction_script() {
    let ctx = init_stateful_mssql_context("import-explicit-tx").await;
    let database = default_database(&ctx.form);
    let table = unique_name("dbpaw_import_tx_tbl");
    let object_name = default_mssql_object_name(&table);
    let qualified = qualify_default_mssql_table(&table);

    let cleanup_driver = MssqlDriver::connect(&ctx.form)
        .await
        .expect("failed to connect mssql driver for import cleanup");
    let _ = cleanup_driver
        .execute_query(format!(
            "IF OBJECT_ID(N'{}', N'U') IS NOT NULL DROP TABLE {}",
            object_name, qualified
        ))
        .await;
    cleanup_driver.close().await;

    let base = std::env::temp_dir().join(unique_name("dbpaw_mssql_import_it"));
    fs::create_dir_all(&base).expect("create temp import dir should succeed");
    let import_sql_path = base.join("import.sql");
    let import_sql = format!(
        "BEGIN TRANSACTION;\n\
         CREATE TABLE {} (id INT PRIMARY KEY, name NVARCHAR(64));\n\
         INSERT INTO {} (id, name) VALUES (1, N'alpha'), (2, N'beta');\n\
         COMMIT TRANSACTION;\n",
        qualified, qualified
    );
    fs::write(&import_sql_path, import_sql).expect("write import sql file should succeed");

    let import_result = transfer::import_sql_file_direct(
        &ctx.state,
        ctx.conn_id,
        database.clone(),
        import_sql_path.to_string_lossy().to_string(),
        "mssql".to_string(),
    )
    .await
    .expect("import_sql_file should succeed");
    assert_eq!(
        import_result.success_statements,
        import_result.total_statements
    );
    assert!(import_result.error.is_none());
    assert!(!import_result.rolled_back);

    let verify_driver = MssqlDriver::connect(&ctx.form)
        .await
        .expect("failed to connect mssql driver for import verification");
    let verify = verify_driver
        .execute_query(format!("SELECT COUNT(*) AS c FROM {}", qualified))
        .await
        .expect("verify imported mssql table should succeed");
    let count = scalar_to_i64(&verify.data[0]["c"]);
    assert_eq!(count, 2);

    let _ = verify_driver
        .execute_query(format!(
            "IF OBJECT_ID(N'{}', N'U') IS NOT NULL DROP TABLE {}",
            object_name, qualified
        ))
        .await;
    verify_driver.close().await;

    let _ = fs::remove_file(import_sql_path);
    let _ = fs::remove_dir_all(base);
    delete_stateful_connection(&ctx.state, ctx.conn_id).await;
}
