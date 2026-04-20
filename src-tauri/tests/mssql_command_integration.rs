#[path = "common/mssql_context.rs"]
mod mssql_context;

use dbpaw_lib::commands::{connection, metadata, query};
use dbpaw_lib::db::drivers::mssql::MssqlDriver;
use dbpaw_lib::db::drivers::DatabaseDriver;
use dbpaw_lib::models::ConnectionForm;

use mssql_context::{
    default_mssql_object_name, default_mssql_schema, qualify_default_mssql_table,
    shared_mssql_form, unique_name, wait_until_ready,
};

async fn prepare_query_test_table(form: &ConnectionForm, table: &str) {
    let driver = MssqlDriver::connect(form)
        .await
        .expect("failed to connect mssql driver");
    let qualified = qualify_default_mssql_table(table);
    let object_name = default_mssql_object_name(table);

    driver
        .execute_query(format!(
            "IF OBJECT_ID(N'{}', N'U') IS NOT NULL DROP TABLE {}",
            object_name, qualified
        ))
        .await
        .ok();
    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, name NVARCHAR(64))",
            qualified
        ))
        .await
        .expect("create table should succeed");
    driver
        .execute_query(format!(
            "INSERT INTO {} (id, name) VALUES (1, N'DbPaw')",
            qualified
        ))
        .await
        .expect("insert row should succeed");
    driver.close().await;
}

async fn cleanup_table(form: &ConnectionForm, table: &str) {
    let driver = MssqlDriver::connect(form)
        .await
        .expect("failed to connect mssql driver for cleanup");
    let qualified = qualify_default_mssql_table(table);
    let object_name = default_mssql_object_name(table);
    driver
        .execute_query(format!(
            "IF OBJECT_ID(N'{}', N'U') IS NOT NULL DROP TABLE {}",
            object_name, qualified
        ))
        .await
        .ok();
    driver.close().await;
}

async fn execute_by_conn_sql(
    form: ConnectionForm,
    sql: String,
) -> Result<dbpaw_lib::models::QueryResult, String> {
    query::execute_by_conn_direct(form, sql).await
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_test_connection_success() {
    let form = shared_mssql_form();
    wait_until_ready(&form).await;

    let result = connection::test_connection_ephemeral(form)
        .await
        .expect("test_connection_ephemeral should succeed");

    assert!(result.success);
    assert!(result.latency_ms.is_some());
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_test_connection_invalid_password_returns_error() {
    let form = shared_mssql_form();
    wait_until_ready(&form).await;
    let mut form = form;
    form.password = Some("dbpaw_wrong_password".to_string());

    let result = connection::test_connection_ephemeral(form).await;

    assert!(result.is_err());
    let error = result.err().unwrap_or_default();
    assert!(!error.trim().is_empty());
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_list_tables_by_conn_contains_created_table() {
    let form = shared_mssql_form();
    wait_until_ready(&form).await;
    let table = unique_name("dbpaw_cmd_tables");
    prepare_query_test_table(&form, &table).await;

    let tables = metadata::list_tables_by_conn(form.clone())
        .await
        .expect("list_tables_by_conn should succeed");

    assert!(tables.iter().any(|t| t.name == table));
    cleanup_table(&form, &table).await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_list_tables_by_conn_invalid_credentials_returns_error() {
    let form = shared_mssql_form();
    wait_until_ready(&form).await;
    let mut form = form;
    form.password = Some("dbpaw_wrong_password".to_string());

    let result = metadata::list_tables_by_conn(form).await;

    assert!(result.is_err());
    let error = result.err().unwrap_or_default();
    assert!(!error.trim().is_empty());
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_list_databases_contains_target_db() {
    let form = shared_mssql_form();
    wait_until_ready(&form).await;
    let target_db = form
        .database
        .clone()
        .unwrap_or_else(|| "master".to_string());

    let databases = connection::list_databases(form)
        .await
        .expect("list_databases should succeed");

    assert!(!databases.is_empty());
    assert!(databases.iter().any(|db| db == &target_db));
    assert!(databases.iter().all(|db| !db.trim().is_empty()));
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_list_databases_invalid_credentials_returns_error() {
    let form = shared_mssql_form();
    wait_until_ready(&form).await;
    let mut form = form;
    form.password = Some("dbpaw_wrong_password".to_string());

    let result = connection::list_databases(form).await;

    assert!(result.is_err());
    let error = result.err().unwrap_or_default();
    assert!(!error.trim().is_empty());
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_execute_by_conn_select_returns_rows() {
    let form = shared_mssql_form();
    wait_until_ready(&form).await;
    let table = unique_name("dbpaw_cmd_exec_select");
    prepare_query_test_table(&form, &table).await;

    let sql = format!("SELECT id, name FROM {} ORDER BY id", table);
    let result = execute_by_conn_sql(form.clone(), sql)
        .await
        .expect("execute_by_conn should succeed");

    assert!(result.success);
    assert!(result.row_count >= 1);
    assert!(!result.data.is_empty());
    let row = result.data.first().expect("result row should exist");
    let name = row.get("name").and_then(|v| v.as_str());
    assert_eq!(name, Some("DbPaw"));
    cleanup_table(&form, &table).await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_execute_by_conn_invalid_sql_returns_error() {
    let form = shared_mssql_form();
    wait_until_ready(&form).await;

    let result = execute_by_conn_sql(
        form,
        "SELECT * FROM __dbpaw_missing_command_table".to_string(),
    )
    .await;

    assert!(result.is_err());
    let error = result.err().unwrap_or_default();
    assert!(!error.trim().is_empty());
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_execute_by_conn_insert_affects_rows() {
    let form = shared_mssql_form();
    wait_until_ready(&form).await;
    let table = unique_name("dbpaw_cmd_exec_insert");
    let qualified = qualify_default_mssql_table(&table);
    let object_name = default_mssql_object_name(&table);

    let driver = MssqlDriver::connect(&form)
        .await
        .expect("failed to connect mssql driver");
    driver
        .execute_query(format!(
            "IF OBJECT_ID(N'{}', N'U') IS NOT NULL DROP TABLE {}",
            object_name, qualified
        ))
        .await
        .ok();
    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, name NVARCHAR(64))",
            qualified
        ))
        .await
        .expect("create table should succeed");
    driver.close().await;

    let sql = format!("INSERT INTO {} (id, name) VALUES (1, N'alpha')", qualified);
    let result = execute_by_conn_sql(form.clone(), sql)
        .await
        .expect("execute_by_conn insert should succeed");
    assert!(result.success);
    assert_eq!(result.row_count, 1);

    cleanup_table(&form, &table).await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_get_table_data_by_conn_pagination_works() {
    let form = shared_mssql_form();
    wait_until_ready(&form).await;

    let schema = default_mssql_schema();
    let table = unique_name("dbpaw_cmd_page");
    let qualified = qualify_default_mssql_table(&table);
    let object_name = default_mssql_object_name(&table);

    let driver = MssqlDriver::connect(&form)
        .await
        .expect("failed to connect mssql driver");
    driver
        .execute_query(format!(
            "IF OBJECT_ID(N'{}', N'U') IS NOT NULL DROP TABLE {}",
            object_name, qualified
        ))
        .await
        .ok();
    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, name NVARCHAR(64))",
            qualified
        ))
        .await
        .expect("create table should succeed");
    driver
        .execute_query(format!(
            "INSERT INTO {} (id, name) VALUES (1, N'a'), (2, N'b'), (3, N'c')",
            qualified
        ))
        .await
        .expect("insert rows should succeed");
    driver.close().await;

    let page1 = query::get_table_data_by_conn(form.clone(), schema.clone(), table.clone(), 1, 2)
        .await
        .expect("page 1 should succeed");
    let page2 = query::get_table_data_by_conn(form.clone(), schema, table.clone(), 2, 2)
        .await
        .expect("page 2 should succeed");

    assert_eq!(page1.total, 3);
    assert_eq!(page1.limit, 2);
    assert_eq!(page1.page, 1);
    assert_eq!(page1.data.len(), 2);
    assert_eq!(page2.data.len(), 1);

    cleanup_table(&form, &table).await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_command_get_table_data_by_conn_invalid_pagination_returns_error() {
    let form = shared_mssql_form();
    wait_until_ready(&form).await;

    let schema = default_mssql_schema();
    let table = unique_name("dbpaw_cmd_invalid_page");
    prepare_query_test_table(&form, &table).await;

    let result = query::get_table_data_by_conn(form.clone(), schema, table.clone(), 0, 10).await;
    assert!(result.is_err());
    let error = result.err().unwrap_or_default();
    assert!(error.contains("[VALIDATION_ERROR]"));

    cleanup_table(&form, &table).await;
}
