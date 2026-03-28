use dbpaw_lib::db::drivers::sqlite::SqliteDriver;
use dbpaw_lib::db::drivers::DatabaseDriver;
use dbpaw_lib::models::ConnectionForm;
use std::env;
use std::path::PathBuf;
use uuid::Uuid;

fn sqlite_test_path() -> PathBuf {
    if let Ok(v) = env::var("SQLITE_IT_DB_PATH") {
        return PathBuf::from(v);
    }
    let mut p = env::temp_dir();
    p.push(format!("dbpaw-sqlite-integration-{}.db", Uuid::new_v4()));
    p
}

#[tokio::test]
#[ignore]
async fn test_sqlite_integration_flow() {
    let db_path = sqlite_test_path();
    let db_path_str = db_path.to_string_lossy().to_string();

    let form = ConnectionForm {
        driver: "sqlite".to_string(),
        file_path: Some(db_path_str.clone()),
        ..Default::default()
    };

    let driver = SqliteDriver::connect(&form)
        .await
        .expect("Failed to connect to sqlite db");

    driver
        .test_connection()
        .await
        .expect("test_connection failed");

    let dbs = driver
        .list_databases()
        .await
        .expect("list_databases failed");
    assert_eq!(dbs, vec!["main".to_string()]);

    driver
        .execute_query(
            "CREATE TABLE IF NOT EXISTS dbpaw_sqlite_type_probe (\
                id INTEGER PRIMARY KEY, \
                name TEXT, \
                amount NUMERIC, \
                payload BLOB, \
                created_at TEXT\
            )"
            .to_string(),
        )
        .await
        .expect("create table failed");

    driver
        .execute_query(
            "CREATE VIEW IF NOT EXISTS dbpaw_sqlite_type_probe_v AS \
             SELECT id, name FROM dbpaw_sqlite_type_probe"
                .to_string(),
        )
        .await
        .expect("create view failed");

    driver
        .execute_query(
            "INSERT INTO dbpaw_sqlite_type_probe (id, name, amount, payload, created_at) \
             VALUES (1, 'hello', 12.34, x'DEADBEEF', '2026-01-02 03:04:05')"
                .to_string(),
        )
        .await
        .expect("insert failed");

    let tables = driver.list_tables(None).await.expect("list_tables failed");
    assert!(
        tables.iter().any(|t| t.name == "dbpaw_sqlite_type_probe"),
        "list_tables should include dbpaw_sqlite_type_probe"
    );
    assert!(
        tables.iter().any(|t| t.name == "dbpaw_sqlite_type_probe_v"),
        "list_tables should include dbpaw_sqlite_type_probe_v"
    );

    let metadata = driver
        .get_table_metadata("main".to_string(), "dbpaw_sqlite_type_probe".to_string())
        .await
        .expect("get_table_metadata failed");
    assert!(
        metadata
            .columns
            .iter()
            .any(|c| c.name == "id" && c.primary_key),
        "metadata should include primary key id"
    );
    assert!(
        metadata.columns.iter().any(|c| c.name == "payload"),
        "metadata should include payload column"
    );

    let ddl = driver
        .get_table_ddl("main".to_string(), "dbpaw_sqlite_type_probe".to_string())
        .await
        .expect("get_table_ddl failed");
    assert!(
        ddl.to_uppercase().contains("CREATE TABLE"),
        "DDL should contain CREATE TABLE"
    );

    let result = driver
        .execute_query(
            "SELECT id, name, amount, payload, created_at FROM dbpaw_sqlite_type_probe WHERE id = 1"
                .to_string(),
        )
        .await
        .expect("select typed row failed");
    assert_eq!(result.row_count, 1);
    let row = result
        .data
        .first()
        .expect("typed result should include at least one row");
    assert_eq!(row["id"], serde_json::Value::String("1".to_string()));
    assert_eq!(row["name"], serde_json::Value::String("hello".to_string()));
    assert!(row.get("amount").is_some(), "amount should exist");
    assert!(row.get("payload").is_some(), "payload should exist");

    let _ = driver
        .execute_query("DROP VIEW IF EXISTS dbpaw_sqlite_type_probe_v".to_string())
        .await;
    let _ = driver
        .execute_query("DROP TABLE IF EXISTS dbpaw_sqlite_type_probe".to_string())
        .await;
    driver.close().await;

    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_sqlite_get_table_data_supports_pagination_sort_filter_and_order_by() {
    let db_path = sqlite_test_path();
    let db_path_str = db_path.to_string_lossy().to_string();
    let form = ConnectionForm {
        driver: "sqlite".to_string(),
        file_path: Some(db_path_str),
        ..Default::default()
    };
    let driver = SqliteDriver::connect(&form)
        .await
        .expect("Failed to connect to sqlite db");

    driver
        .execute_query(
            "CREATE TABLE dbpaw_sqlite_grid_probe (id INTEGER PRIMARY KEY, name TEXT, score INTEGER)"
                .to_string(),
        )
        .await
        .expect("create dbpaw_sqlite_grid_probe failed");
    driver
        .execute_query(
            "INSERT INTO dbpaw_sqlite_grid_probe (id, name, score) VALUES \
             (1, 'alpha', 10), (2, 'beta', 20), (3, 'gamma', 30), (4, 'delta', 40)"
                .to_string(),
        )
        .await
        .expect("insert dbpaw_sqlite_grid_probe failed");

    let page1 = driver
        .get_table_data(
            "main".to_string(),
            "dbpaw_sqlite_grid_probe".to_string(),
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
            "dbpaw_sqlite_grid_probe".to_string(),
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
            "dbpaw_sqlite_grid_probe".to_string(),
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

    driver.close().await;
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_sqlite_get_table_data_rejects_invalid_sort_column() {
    let db_path = sqlite_test_path();
    let db_path_str = db_path.to_string_lossy().to_string();
    let form = ConnectionForm {
        driver: "sqlite".to_string(),
        file_path: Some(db_path_str),
        ..Default::default()
    };
    let driver = SqliteDriver::connect(&form)
        .await
        .expect("Failed to connect to sqlite db");

    driver
        .execute_query("CREATE TABLE dbpaw_sqlite_invalid_sort_probe (id INTEGER PRIMARY KEY)".to_string())
        .await
        .expect("create dbpaw_sqlite_invalid_sort_probe failed");

    let result = driver
        .get_table_data(
            "main".to_string(),
            "dbpaw_sqlite_invalid_sort_probe".to_string(),
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

    driver.close().await;
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_sqlite_table_structure_and_schema_overview() {
    let db_path = sqlite_test_path();
    let db_path_str = db_path.to_string_lossy().to_string();
    let form = ConnectionForm {
        driver: "sqlite".to_string(),
        file_path: Some(db_path_str),
        ..Default::default()
    };
    let driver = SqliteDriver::connect(&form)
        .await
        .expect("Failed to connect to sqlite db");

    driver
        .execute_query(
            "CREATE TABLE dbpaw_sqlite_overview_probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL)"
                .to_string(),
        )
        .await
        .expect("create dbpaw_sqlite_overview_probe failed");

    let structure = driver
        .get_table_structure("main".to_string(), "dbpaw_sqlite_overview_probe".to_string())
        .await
        .expect("get_table_structure failed");
    assert!(
        structure.columns.iter().any(|c| c.name == "id" && c.primary_key),
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
            .any(|t| t.schema == "main" && t.name == "dbpaw_sqlite_overview_probe"),
        "schema overview should include main.dbpaw_sqlite_overview_probe"
    );

    driver.close().await;
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_sqlite_metadata_includes_indexes_and_foreign_keys() {
    let db_path = sqlite_test_path();
    let db_path_str = db_path.to_string_lossy().to_string();
    let form = ConnectionForm {
        driver: "sqlite".to_string(),
        file_path: Some(db_path_str),
        ..Default::default()
    };
    let driver = SqliteDriver::connect(&form)
        .await
        .expect("Failed to connect to sqlite db");

    driver
        .execute_query(
            "CREATE TABLE dbpaw_sqlite_parent_meta_probe (id INTEGER PRIMARY KEY); \
             CREATE TABLE dbpaw_sqlite_child_meta_probe (\
               id INTEGER PRIMARY KEY, \
               parent_id INTEGER NOT NULL, \
               name TEXT, \
               CONSTRAINT fk_dbpaw_sqlite_child_parent FOREIGN KEY(parent_id) REFERENCES dbpaw_sqlite_parent_meta_probe(id)\
             ); \
             CREATE INDEX idx_dbpaw_sqlite_child_name ON dbpaw_sqlite_child_meta_probe(name);"
                .to_string(),
        )
        .await
        .expect("create sqlite metadata probe tables failed");

    let metadata = driver
        .get_table_metadata("main".to_string(), "dbpaw_sqlite_child_meta_probe".to_string())
        .await
        .expect("get_table_metadata failed");
    assert!(
        metadata
            .indexes
            .iter()
            .any(|i| i.name == "idx_dbpaw_sqlite_child_name" && i.columns.contains(&"name".to_string())),
        "metadata should include idx_dbpaw_sqlite_child_name"
    );
    assert!(
        metadata
            .foreign_keys
            .iter()
            .any(|fk| fk.column == "parent_id" && fk.referenced_table == "dbpaw_sqlite_parent_meta_probe"),
        "metadata should include FK parent_id -> dbpaw_sqlite_parent_meta_probe(id)"
    );

    driver.close().await;
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
#[ignore]
async fn test_sqlite_boolean_and_json_type_mapping_regression() {
    let db_path = sqlite_test_path();
    let db_path_str = db_path.to_string_lossy().to_string();
    let form = ConnectionForm {
        driver: "sqlite".to_string(),
        file_path: Some(db_path_str),
        ..Default::default()
    };
    let driver = SqliteDriver::connect(&form)
        .await
        .expect("Failed to connect to sqlite db");

    driver
        .execute_query(
            "CREATE TABLE dbpaw_sqlite_bool_json_probe (id INTEGER PRIMARY KEY, flag BOOLEAN, meta TEXT)"
                .to_string(),
        )
        .await
        .expect("create dbpaw_sqlite_bool_json_probe failed");
    driver
        .execute_query(
            "INSERT INTO dbpaw_sqlite_bool_json_probe (id, flag, meta) VALUES \
             (1, 1, '{\"tier\":\"gold\"}')"
                .to_string(),
        )
        .await
        .expect("insert dbpaw_sqlite_bool_json_probe failed");

    let query_result = driver
        .execute_query(
            "SELECT flag, json_extract(meta, '$.tier') AS tier \
             FROM dbpaw_sqlite_bool_json_probe WHERE id = 1"
                .to_string(),
        )
        .await
        .expect("select bool/json probe row failed");
    assert_eq!(query_result.row_count, 1);
    let query_row = query_result.data.first().expect("query row should exist");
    assert_eq!(query_row["flag"], serde_json::Value::Bool(true));
    assert_eq!(query_row["tier"], serde_json::Value::String("gold".to_string()));

    let table_data = driver
        .get_table_data(
            "main".to_string(),
            "dbpaw_sqlite_bool_json_probe".to_string(),
            1,
            10,
            None,
            None,
            None,
            None,
        )
        .await
        .expect("get_table_data for dbpaw_sqlite_bool_json_probe failed");
    assert_eq!(table_data.total, 1);
    let grid_row = table_data.data.first().expect("table row should exist");
    assert_eq!(grid_row["flag"], serde_json::Value::Bool(true));
    assert!(
        grid_row.get("meta").is_some(),
        "meta should exist in table_data"
    );

    driver.close().await;
    let _ = std::fs::remove_file(db_path);
}
