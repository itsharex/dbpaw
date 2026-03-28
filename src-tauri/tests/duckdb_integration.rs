#[path = "common/duckdb_context.rs"]
mod duckdb_context;

use dbpaw_lib::db::drivers::duckdb::DuckdbDriver;
use dbpaw_lib::db::drivers::DatabaseDriver;

#[tokio::test]
#[ignore]
async fn test_duckdb_integration_flow() {
    let (db_path, form) = duckdb_context::duckdb_form_from_test_context();

    let driver = DuckdbDriver::connect(&form)
        .await
        .expect("Failed to connect to duckdb");

    let _ = driver
        .execute_query("DROP VIEW IF EXISTS dbpaw_duckdb_type_probe_v".to_string())
        .await;
    let _ = driver
        .execute_query("DROP TABLE IF EXISTS dbpaw_duckdb_type_probe".to_string())
        .await;

    driver
        .test_connection()
        .await
        .expect("test_connection failed");

    let dbs = driver
        .list_databases()
        .await
        .expect("list_databases failed");
    assert!(!dbs.is_empty(), "list_databases returned empty");

    driver
        .execute_query(
            "CREATE TABLE IF NOT EXISTS dbpaw_duckdb_type_probe (\
                id INTEGER PRIMARY KEY, \
                name VARCHAR, \
                amount DOUBLE, \
                created_at TIMESTAMP\
            )"
            .to_string(),
        )
        .await
        .expect("create table failed");

    driver
        .execute_query(
            "CREATE VIEW IF NOT EXISTS dbpaw_duckdb_type_probe_v AS \
             SELECT id, name FROM dbpaw_duckdb_type_probe"
                .to_string(),
        )
        .await
        .expect("create view failed");

    driver
        .execute_query(
            "INSERT INTO dbpaw_duckdb_type_probe (id, name, amount, created_at) \
             VALUES (1, 'hello', 12.34, '2026-01-02 03:04:05')"
                .to_string(),
        )
        .await
        .expect("insert failed");

    let tables = driver.list_tables(None).await.expect("list_tables failed");
    assert!(
        tables.iter().any(|t| t.name == "dbpaw_duckdb_type_probe"),
        "list_tables should include dbpaw_duckdb_type_probe"
    );
    assert!(
        tables.iter().any(|t| t.name == "dbpaw_duckdb_type_probe_v"),
        "list_tables should include dbpaw_duckdb_type_probe_v"
    );

    let metadata = driver
        .get_table_metadata("main".to_string(), "dbpaw_duckdb_type_probe".to_string())
        .await
        .expect("get_table_metadata failed");
    assert!(
        metadata.columns.iter().any(|c| c.name == "id"),
        "metadata should include id column"
    );

    let ddl = driver
        .get_table_ddl("main".to_string(), "dbpaw_duckdb_type_probe".to_string())
        .await
        .expect("get_table_ddl failed");
    assert!(
        ddl.to_uppercase().contains("CREATE TABLE"),
        "DDL should contain CREATE TABLE"
    );

    let result = driver
        .execute_query(
            "SELECT id, name, amount, created_at \
             FROM dbpaw_duckdb_type_probe WHERE id = 1"
                .to_string(),
        )
        .await
        .expect("select typed row failed");
    assert_eq!(result.row_count, 1);
    let row = result
        .data
        .first()
        .expect("typed result should include at least one row");
    let id_value = row.get("id").expect("id should exist");
    assert!(
        id_value == &serde_json::Value::String("1".to_string())
            || id_value == &serde_json::Value::Number(serde_json::Number::from(1)),
        "unexpected id value: {:?}",
        id_value
    );
    assert_eq!(row["name"], serde_json::Value::String("hello".to_string()));
    assert!(row.get("amount").is_some(), "amount should exist");
    assert!(row.get("created_at").is_some(), "created_at should exist");

    let _ = driver
        .execute_query("DROP VIEW IF EXISTS dbpaw_duckdb_type_probe_v".to_string())
        .await;
    let _ = driver
        .execute_query("DROP TABLE IF EXISTS dbpaw_duckdb_type_probe".to_string())
        .await;
    driver.close().await;

    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_duckdb_get_table_data_supports_pagination_sort_filter_and_order_by() {
    let (db_path, form) = duckdb_context::duckdb_form_from_test_context();
    let driver = DuckdbDriver::connect(&form)
        .await
        .expect("Failed to connect to duckdb");

    let _ = driver
        .execute_query("DROP TABLE IF EXISTS dbpaw_duckdb_grid_probe".to_string())
        .await;

    driver
        .execute_query(
            "CREATE TABLE dbpaw_duckdb_grid_probe (id INTEGER PRIMARY KEY, name VARCHAR, score INTEGER)"
                .to_string(),
        )
        .await
        .expect("create dbpaw_duckdb_grid_probe failed");
    driver
        .execute_query(
            "INSERT INTO dbpaw_duckdb_grid_probe (id, name, score) VALUES \
             (1, 'alpha', 10), (2, 'beta', 20), (3, 'gamma', 30), (4, 'delta', 40)"
                .to_string(),
        )
        .await
        .expect("insert dbpaw_duckdb_grid_probe failed");

    let page1 = driver
        .get_table_data(
            "main".to_string(),
            "dbpaw_duckdb_grid_probe".to_string(),
            1,
            2,
            Some("score".to_string()),
            Some("desc".to_string()),
            None,
            None,
        )
        .await
        .expect("get_table_data page1 failed");
    assert_eq!(page1.total, 4);
    assert_eq!(page1.data.len(), 2);
    assert_eq!(
        page1.data[0]["name"],
        serde_json::Value::String("delta".to_string())
    );

    let filtered = driver
        .get_table_data(
            "main".to_string(),
            "dbpaw_duckdb_grid_probe".to_string(),
            1,
            10,
            None,
            None,
            Some("score >= 20".to_string()),
            None,
        )
        .await
        .expect("get_table_data with filter failed");
    assert_eq!(filtered.total, 3);

    let ordered = driver
        .get_table_data(
            "main".to_string(),
            "dbpaw_duckdb_grid_probe".to_string(),
            1,
            1,
            Some("id".to_string()),
            Some("asc".to_string()),
            None,
            Some("name DESC".to_string()),
        )
        .await
        .expect("get_table_data with order_by failed");
    assert_eq!(ordered.total, 4);
    assert_eq!(ordered.data.len(), 1);
    assert_eq!(
        ordered.data[0]["name"],
        serde_json::Value::String("gamma".to_string())
    );

    let _ = driver
        .execute_query("DROP TABLE IF EXISTS dbpaw_duckdb_grid_probe".to_string())
        .await;
    driver.close().await;
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_duckdb_get_table_data_rejects_invalid_sort_column() {
    let (db_path, form) = duckdb_context::duckdb_form_from_test_context();
    let driver = DuckdbDriver::connect(&form)
        .await
        .expect("Failed to connect to duckdb");

    let _ = driver
        .execute_query("DROP TABLE IF EXISTS dbpaw_duckdb_invalid_sort_probe".to_string())
        .await;

    driver
        .execute_query(
            "CREATE TABLE dbpaw_duckdb_invalid_sort_probe (id INTEGER PRIMARY KEY)".to_string(),
        )
        .await
        .expect("create dbpaw_duckdb_invalid_sort_probe failed");

    let result = driver
        .get_table_data(
            "main".to_string(),
            "dbpaw_duckdb_invalid_sort_probe".to_string(),
            1,
            10,
            Some("id desc".to_string()),
            Some("desc".to_string()),
            None,
            None,
        )
        .await;
    let err = result.expect_err("invalid sort column should return error");
    assert!(
        err.contains("[VALIDATION_ERROR] Invalid sort column name"),
        "unexpected error: {}",
        err
    );

    let _ = driver
        .execute_query("DROP TABLE IF EXISTS dbpaw_duckdb_invalid_sort_probe".to_string())
        .await;
    driver.close().await;
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_duckdb_table_structure_and_schema_overview() {
    let (db_path, form) = duckdb_context::duckdb_form_from_test_context();
    let driver = DuckdbDriver::connect(&form)
        .await
        .expect("Failed to connect to duckdb");

    let _ = driver
        .execute_query("DROP TABLE IF EXISTS dbpaw_duckdb_overview_probe".to_string())
        .await;

    driver
        .execute_query(
            "CREATE TABLE dbpaw_duckdb_overview_probe (id INTEGER PRIMARY KEY, label VARCHAR NOT NULL)"
                .to_string(),
        )
        .await
        .expect("create dbpaw_duckdb_overview_probe failed");

    let structure = driver
        .get_table_structure(
            "main".to_string(),
            "dbpaw_duckdb_overview_probe".to_string(),
        )
        .await
        .expect("get_table_structure failed");
    assert!(
        structure
            .columns
            .iter()
            .any(|c| c.name == "id" && c.primary_key),
        "table structure should include primary key id"
    );
    assert!(
        structure.columns.iter().any(|c| c.name == "label"),
        "table structure should include label"
    );

    let overview = driver
        .get_schema_overview(Some("main".to_string()))
        .await
        .expect("get_schema_overview failed");
    assert!(
        overview
            .tables
            .iter()
            .any(|t| t.schema == "main" && t.name == "dbpaw_duckdb_overview_probe"),
        "schema overview should include main.dbpaw_duckdb_overview_probe"
    );

    let _ = driver
        .execute_query("DROP TABLE IF EXISTS dbpaw_duckdb_overview_probe".to_string())
        .await;
    driver.close().await;
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_duckdb_metadata_includes_empty_indexes_and_foreign_keys() {
    let (db_path, form) = duckdb_context::duckdb_form_from_test_context();
    let driver = DuckdbDriver::connect(&form)
        .await
        .expect("Failed to connect to duckdb");

    let _ = driver
        .execute_query("DROP TABLE IF EXISTS dbpaw_duckdb_meta_probe".to_string())
        .await;

    driver
        .execute_query(
            "CREATE TABLE dbpaw_duckdb_meta_probe (id INTEGER PRIMARY KEY, name VARCHAR)"
                .to_string(),
        )
        .await
        .expect("create dbpaw_duckdb_meta_probe failed");

    let metadata = driver
        .get_table_metadata("main".to_string(), "dbpaw_duckdb_meta_probe".to_string())
        .await
        .expect("get_table_metadata failed");
    assert!(
        metadata.columns.iter().any(|c| c.name == "id"),
        "metadata should include id column"
    );
    assert!(
        metadata.indexes.is_empty(),
        "duckdb metadata indexes should be empty for now"
    );
    assert!(
        metadata.foreign_keys.is_empty(),
        "duckdb metadata foreign_keys should be empty for now"
    );

    let _ = driver
        .execute_query("DROP TABLE IF EXISTS dbpaw_duckdb_meta_probe".to_string())
        .await;
    driver.close().await;
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_duckdb_boolean_and_json_type_mapping_regression() {
    let (db_path, form) = duckdb_context::duckdb_form_from_test_context();
    let driver = DuckdbDriver::connect(&form)
        .await
        .expect("Failed to connect to duckdb");

    let _ = driver
        .execute_query("DROP TABLE IF EXISTS dbpaw_duckdb_bool_json_probe".to_string())
        .await;

    driver
        .execute_query(
            "CREATE TABLE dbpaw_duckdb_bool_json_probe (id INTEGER PRIMARY KEY, flag BOOLEAN, meta VARCHAR)"
                .to_string(),
        )
        .await
        .expect("create dbpaw_duckdb_bool_json_probe failed");
    driver
        .execute_query(
            "INSERT INTO dbpaw_duckdb_bool_json_probe (id, flag, meta) VALUES \
             (1, true, '{\"tier\":\"gold\"}')"
                .to_string(),
        )
        .await
        .expect("insert dbpaw_duckdb_bool_json_probe failed");

    let query_result = driver
        .execute_query(
            "SELECT flag, meta FROM dbpaw_duckdb_bool_json_probe WHERE id = 1".to_string(),
        )
        .await
        .expect("select bool/json probe row failed");
    assert_eq!(query_result.row_count, 1);
    let query_row = query_result.data.first().expect("query row should exist");
    let query_flag = query_row
        .get("flag")
        .expect("flag should exist in query result");
    assert!(
        query_flag == &serde_json::Value::Bool(true)
            || query_flag == &serde_json::Value::Number(serde_json::Number::from(1))
            || query_flag == &serde_json::Value::String("true".to_string()),
        "unexpected query flag value: {:?}",
        query_flag
    );
    assert!(query_row.get("meta").is_some(), "meta should exist");

    let table_data = driver
        .get_table_data(
            "main".to_string(),
            "dbpaw_duckdb_bool_json_probe".to_string(),
            1,
            10,
            None,
            None,
            None,
            None,
        )
        .await
        .expect("get_table_data for dbpaw_duckdb_bool_json_probe failed");
    assert_eq!(table_data.total, 1);
    let grid_row = table_data.data.first().expect("table row should exist");
    let grid_flag = grid_row
        .get("flag")
        .expect("flag should exist in table_data result");
    assert!(
        grid_flag == &serde_json::Value::Bool(true)
            || grid_flag == &serde_json::Value::Number(serde_json::Number::from(1))
            || grid_flag == &serde_json::Value::String("true".to_string()),
        "unexpected grid flag value: {:?}",
        grid_flag
    );
    assert!(
        grid_row.get("meta").is_some(),
        "meta should exist in table_data"
    );

    let _ = driver
        .execute_query("DROP TABLE IF EXISTS dbpaw_duckdb_bool_json_probe".to_string())
        .await;
    driver.close().await;
    let _ = std::fs::remove_file(db_path);
}
