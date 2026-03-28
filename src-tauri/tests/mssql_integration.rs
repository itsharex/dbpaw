#[path = "common/mssql_context.rs"]
mod mssql_context;

use dbpaw_lib::db::drivers::mssql::MssqlDriver;
use dbpaw_lib::db::drivers::DatabaseDriver;
use testcontainers::clients::Cli;

#[tokio::test]
#[ignore]
async fn test_mssql_integration_flow() {
    let docker = (!mssql_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mssql_context::mssql_form_from_test_context(docker.as_ref());
    let database = form
        .database
        .clone()
        .expect("MSSQL_DB or container default database should be present");
    let driver: MssqlDriver =
        mssql_context::connect_with_retry(|| MssqlDriver::connect(&form)).await;

    driver
        .test_connection()
        .await
        .expect("test_connection failed");

    let databases = driver
        .list_databases()
        .await
        .expect("list_databases failed");
    assert!(!databases.is_empty(), "list_databases returned empty");
    assert!(
        databases.iter().any(|db| db == &database),
        "list_databases should include {}",
        database
    );

    let table_name = "dbpaw_mssql_type_probe";
    let qualified = format!("[dbo].[{}]", table_name);
    let _ = driver
        .execute_query(format!(
            "IF OBJECT_ID(N'dbo.{}', N'U') IS NOT NULL DROP TABLE {};",
            table_name, qualified
        ))
        .await;

    driver
        .execute_query(format!(
            "CREATE TABLE {} (\
                id INT PRIMARY KEY, \
                name NVARCHAR(50), \
                amount DECIMAL(10,2), \
                payload VARBINARY(16), \
                created_at DATETIME2\
            )",
            qualified
        ))
        .await
        .expect("create table failed");

    driver
        .execute_query(format!(
            "INSERT INTO {} (id, name, amount, payload, created_at) \
             VALUES (1, N'hello', 12.34, 0xDEADBEEF, '2026-01-02T03:04:05')",
            qualified
        ))
        .await
        .expect("insert failed");

    let tables = driver.list_tables(None).await.expect("list_tables failed");
    assert!(
        tables
            .iter()
            .any(|t| t.schema == "dbo" && t.name == table_name),
        "list_tables should include dbo.{}",
        table_name
    );

    let metadata = driver
        .get_table_metadata("dbo".to_string(), table_name.to_string())
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
        .get_table_ddl("dbo".to_string(), table_name.to_string())
        .await
        .expect("get_table_ddl failed");
    assert!(
        ddl.to_uppercase().contains("CREATE TABLE"),
        "DDL should contain CREATE TABLE"
    );

    let result = driver
        .execute_query(format!(
            "SELECT id, name, amount, created_at FROM {} WHERE id = 1",
            qualified
        ))
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
        .execute_query(format!(
            "IF OBJECT_ID(N'dbo.{}', N'U') IS NOT NULL DROP TABLE {};",
            table_name, qualified
        ))
        .await;
    driver.close().await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_get_table_data_supports_pagination_sort_filter_and_order_by() {
    let docker = (!mssql_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mssql_context::mssql_form_from_test_context(docker.as_ref());
    let driver: MssqlDriver =
        mssql_context::connect_with_retry(|| MssqlDriver::connect(&form)).await;

    let table_name = "dbpaw_mssql_grid_probe";
    let qualified = format!("[dbo].[{}]", table_name);
    let _ = driver
        .execute_query(format!(
            "IF OBJECT_ID(N'dbo.{}', N'U') IS NOT NULL DROP TABLE {};",
            table_name, qualified
        ))
        .await;
    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, name NVARCHAR(30), score INT)",
            qualified
        ))
        .await
        .expect("create dbpaw_mssql_grid_probe failed");
    driver
        .execute_query(format!(
            "INSERT INTO {} (id, name, score) VALUES \
             (1, N'alpha', 10), (2, N'beta', 20), (3, N'gamma', 30), (4, N'delta', 40)",
            qualified
        ))
        .await
        .expect("insert dbpaw_mssql_grid_probe failed");

    let page1 = driver
        .get_table_data(
            "dbo".to_string(),
            table_name.to_string(),
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
            "dbo".to_string(),
            table_name.to_string(),
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
            "dbo".to_string(),
            table_name.to_string(),
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
        .execute_query(format!(
            "IF OBJECT_ID(N'dbo.{}', N'U') IS NOT NULL DROP TABLE {};",
            table_name, qualified
        ))
        .await;
    driver.close().await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_get_table_data_rejects_invalid_sort_column() {
    let docker = (!mssql_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mssql_context::mssql_form_from_test_context(docker.as_ref());
    let driver: MssqlDriver =
        mssql_context::connect_with_retry(|| MssqlDriver::connect(&form)).await;

    let table_name = "dbpaw_mssql_invalid_sort_probe";
    let qualified = format!("[dbo].[{}]", table_name);
    let _ = driver
        .execute_query(format!(
            "IF OBJECT_ID(N'dbo.{}', N'U') IS NOT NULL DROP TABLE {};",
            table_name, qualified
        ))
        .await;
    driver
        .execute_query(format!("CREATE TABLE {} (id INT PRIMARY KEY)", qualified))
        .await
        .expect("create dbpaw_mssql_invalid_sort_probe failed");

    let result = driver
        .get_table_data(
            "dbo".to_string(),
            table_name.to_string(),
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
        err.contains("[VALIDATION_ERROR] Invalid sort column name")
            || err.contains("Invalid column name"),
        "unexpected error: {}",
        err
    );

    let _ = driver
        .execute_query(format!(
            "IF OBJECT_ID(N'dbo.{}', N'U') IS NOT NULL DROP TABLE {};",
            table_name, qualified
        ))
        .await;
    driver.close().await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_table_structure_and_schema_overview() {
    let docker = (!mssql_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mssql_context::mssql_form_from_test_context(docker.as_ref());
    let driver: MssqlDriver =
        mssql_context::connect_with_retry(|| MssqlDriver::connect(&form)).await;

    let table_name = "dbpaw_mssql_overview_probe";
    let qualified = format!("[dbo].[{}]", table_name);
    let _ = driver
        .execute_query(format!(
            "IF OBJECT_ID(N'dbo.{}', N'U') IS NOT NULL DROP TABLE {};",
            table_name, qualified
        ))
        .await;
    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, label NVARCHAR(50) NOT NULL)",
            qualified
        ))
        .await
        .expect("create dbpaw_mssql_overview_probe failed");

    let structure = driver
        .get_table_structure("dbo".to_string(), table_name.to_string())
        .await
        .expect("get_table_structure failed");
    assert!(
        structure.columns.iter().any(|c| c.name == "id"),
        "table structure should include id"
    );
    assert!(
        structure.columns.iter().any(|c| c.name == "label"),
        "table structure should include label"
    );

    let overview = driver
        .get_schema_overview(Some("dbo".to_string()))
        .await
        .expect("get_schema_overview failed");
    assert!(
        overview
            .tables
            .iter()
            .any(|t| t.schema == "dbo" && t.name == table_name),
        "schema overview should include dbo.{}",
        table_name
    );

    let _ = driver
        .execute_query(format!(
            "IF OBJECT_ID(N'dbo.{}', N'U') IS NOT NULL DROP TABLE {};",
            table_name, qualified
        ))
        .await;
    driver.close().await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_metadata_includes_indexes_and_foreign_keys() {
    let docker = (!mssql_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mssql_context::mssql_form_from_test_context(docker.as_ref());
    let driver: MssqlDriver =
        mssql_context::connect_with_retry(|| MssqlDriver::connect(&form)).await;

    let parent = "dbpaw_mssql_parent_meta_probe";
    let child = "dbpaw_mssql_child_meta_probe";
    let parent_qualified = format!("[dbo].[{}]", parent);
    let child_qualified = format!("[dbo].[{}]", child);

    let _ = driver
        .execute_query(format!(
            "IF OBJECT_ID(N'dbo.{}', N'U') IS NOT NULL DROP TABLE {};",
            child, child_qualified
        ))
        .await;
    let _ = driver
        .execute_query(format!(
            "IF OBJECT_ID(N'dbo.{}', N'U') IS NOT NULL DROP TABLE {};",
            parent, parent_qualified
        ))
        .await;

    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INT PRIMARY KEY)",
            parent_qualified
        ))
        .await
        .expect("create parent table failed");
    driver
        .execute_query(format!(
            "CREATE TABLE {} (\
                id INT PRIMARY KEY, \
                parent_id INT NOT NULL, \
                name NVARCHAR(30), \
                CONSTRAINT fk_mssql_child_parent FOREIGN KEY (parent_id) REFERENCES {}(id)\
            )",
            child_qualified, parent_qualified
        ))
        .await
        .expect("create child table with fk failed");
    driver
        .execute_query(format!(
            "CREATE INDEX idx_mssql_child_name ON {} (name)",
            child_qualified
        ))
        .await
        .expect("create index failed");

    let metadata = driver
        .get_table_metadata("dbo".to_string(), child.to_string())
        .await
        .expect("get_table_metadata failed");
    assert!(
        metadata
            .indexes
            .iter()
            .any(|i| i.name == "idx_mssql_child_name" && i.columns.contains(&"name".to_string())),
        "metadata should include idx_mssql_child_name"
    );
    assert!(
        metadata
            .foreign_keys
            .iter()
            .any(|fk| fk.column == "parent_id" && fk.referenced_table == parent),
        "metadata should include FK parent_id -> {}(id)",
        parent
    );

    let _ = driver
        .execute_query(format!(
            "IF OBJECT_ID(N'dbo.{}', N'U') IS NOT NULL DROP TABLE {};",
            child, child_qualified
        ))
        .await;
    let _ = driver
        .execute_query(format!(
            "IF OBJECT_ID(N'dbo.{}', N'U') IS NOT NULL DROP TABLE {};",
            parent, parent_qualified
        ))
        .await;
    driver.close().await;
}

#[tokio::test]
#[ignore]
async fn test_mssql_boolean_and_json_type_mapping_regression() {
    let docker = (!mssql_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mssql_context::mssql_form_from_test_context(docker.as_ref());
    let driver: MssqlDriver =
        mssql_context::connect_with_retry(|| MssqlDriver::connect(&form)).await;

    let table_name = "dbpaw_mssql_bool_json_probe";
    let qualified = format!("[dbo].[{}]", table_name);
    let _ = driver
        .execute_query(format!(
            "IF OBJECT_ID(N'dbo.{}', N'U') IS NOT NULL DROP TABLE {};",
            table_name, qualified
        ))
        .await;
    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, flag BIT, meta NVARCHAR(MAX))",
            qualified
        ))
        .await
        .expect("create bool/json probe table failed");
    driver
        .execute_query(format!(
            "INSERT INTO {} (id, flag, meta) VALUES (1, 1, N'{{\"tier\":\"gold\"}}')",
            qualified
        ))
        .await
        .expect("insert bool/json probe row failed");

    let query_result = driver
        .execute_query(format!(
            "SELECT flag, JSON_VALUE(meta, '$.tier') AS tier FROM {} WHERE id = 1",
            qualified
        ))
        .await
        .expect("select bool/json row failed");
    assert_eq!(query_result.row_count, 1);
    let query_row = query_result.data.first().expect("query row should exist");
    let query_flag = query_row
        .get("flag")
        .expect("flag should exist in query result");
    assert!(
        query_flag == &serde_json::Value::Bool(true)
            || query_flag == &serde_json::Value::Number(serde_json::Number::from(1)),
        "unexpected query flag value: {:?}",
        query_flag
    );
    assert_eq!(
        query_row["tier"],
        serde_json::Value::String("gold".to_string())
    );

    let table_data = driver
        .get_table_data(
            "dbo".to_string(),
            table_name.to_string(),
            1,
            10,
            None,
            None,
            None,
            None,
        )
        .await
        .expect("get_table_data for bool/json probe failed");
    assert_eq!(table_data.total, 1);
    let grid_row = table_data.data.first().expect("table row should exist");
    let grid_flag = grid_row
        .get("flag")
        .expect("flag should exist in table_data result");
    assert!(
        grid_flag == &serde_json::Value::Bool(true)
            || grid_flag == &serde_json::Value::Number(serde_json::Number::from(1)),
        "unexpected grid flag value: {:?}",
        grid_flag
    );
    assert!(
        grid_row.get("meta").is_some(),
        "meta should exist in table_data"
    );

    let _ = driver
        .execute_query(format!(
            "IF OBJECT_ID(N'dbo.{}', N'U') IS NOT NULL DROP TABLE {};",
            table_name, qualified
        ))
        .await;
    driver.close().await;
}
