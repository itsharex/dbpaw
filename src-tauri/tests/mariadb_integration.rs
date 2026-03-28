#[path = "common/mariadb_context.rs"]
mod mariadb_context;

use dbpaw_lib::db::drivers::mysql::MysqlDriver;
use dbpaw_lib::db::drivers::DatabaseDriver;
use testcontainers::clients::Cli;

#[tokio::test]
#[ignore]
async fn test_mariadb_integration_flow() {
    let docker = (!mariadb_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mariadb_context::mariadb_form_from_test_context(docker.as_ref());
    let database = form
        .database
        .clone()
        .expect("MARIADB_DB or container default database should be present");
    let driver: MysqlDriver =
        mariadb_context::connect_with_retry(|| MysqlDriver::connect(&form)).await;

    driver
        .test_connection()
        .await
        .expect("test_connection failed");

    let dbs = driver
        .list_databases()
        .await
        .expect("list_databases failed");
    assert!(!dbs.is_empty(), "list_databases returned empty");
    assert!(
        dbs.iter().any(|db| db == &database),
        "list_databases should include {}",
        database
    );

    let table_name = "dbpaw_mariadb_type_probe";
    let view_name = "dbpaw_mariadb_type_probe_v";
    let qualified = format!("`{}`.`{}`", database, table_name);
    let qualified_view = format!("`{}`.`{}`", database, view_name);

    let _ = driver
        .execute_query(format!("DROP VIEW IF EXISTS {}", qualified_view))
        .await;
    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;

    driver
        .execute_query(format!(
            "CREATE TABLE {} (\
                id INT PRIMARY KEY, \
                name VARCHAR(50), \
                amount DECIMAL(10,2), \
                payload VARBINARY(16), \
                created_at DATETIME\
            )",
            qualified
        ))
        .await
        .expect("create table failed");

    driver
        .execute_query(format!(
            "CREATE VIEW {} AS SELECT id, name FROM {}",
            qualified_view, qualified
        ))
        .await
        .expect("create view failed");

    driver
        .execute_query(format!(
            "INSERT INTO {} (id, name, amount, payload, created_at) \
             VALUES (1, 'hello', 12.34, UNHEX('DEADBEEF'), '2026-01-02 03:04:05')",
            qualified
        ))
        .await
        .expect("insert failed");

    let tables = driver
        .list_tables(Some(database.clone()))
        .await
        .expect("list_tables failed");
    assert!(
        tables.iter().any(|t| t.name == table_name),
        "list_tables should include {}",
        table_name
    );
    assert!(
        tables.iter().any(|t| t.name == view_name),
        "list_tables should include {}",
        view_name
    );

    let metadata = driver
        .get_table_metadata(database.clone(), table_name.to_string())
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
        .get_table_ddl(database.clone(), table_name.to_string())
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
        .execute_query(format!("DROP VIEW IF EXISTS {}", qualified_view))
        .await;
    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
    driver.close().await;
}

#[tokio::test]
#[ignore]
async fn test_mariadb_get_table_data_supports_pagination_sort_filter_and_order_by() {
    let docker = (!mariadb_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mariadb_context::mariadb_form_from_test_context(docker.as_ref());
    let database = form
        .database
        .clone()
        .expect("MARIADB_DB or container default database should be present");
    let driver: MysqlDriver =
        mariadb_context::connect_with_retry(|| MysqlDriver::connect(&form)).await;

    let table_name = "dbpaw_mariadb_grid_probe";
    let qualified = format!("`{}`.`{}`", database, table_name);
    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;

    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, name VARCHAR(30), score INT)",
            qualified
        ))
        .await
        .expect("create dbpaw_mariadb_grid_probe failed");
    driver
        .execute_query(format!(
            "INSERT INTO {} (id, name, score) VALUES \
             (1, 'alpha', 10), (2, 'beta', 20), (3, 'gamma', 30), (4, 'delta', 40)",
            qualified
        ))
        .await
        .expect("insert dbpaw_mariadb_grid_probe failed");

    let page1 = driver
        .get_table_data(
            database.clone(),
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
            database.clone(),
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
            database.clone(),
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
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
    driver.close().await;
}

#[tokio::test]
#[ignore]
async fn test_mariadb_get_table_data_rejects_invalid_sort_column() {
    let docker = (!mariadb_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mariadb_context::mariadb_form_from_test_context(docker.as_ref());
    let database = form
        .database
        .clone()
        .expect("MARIADB_DB or container default database should be present");
    let driver: MysqlDriver =
        mariadb_context::connect_with_retry(|| MysqlDriver::connect(&form)).await;

    let table_name = "dbpaw_mariadb_invalid_sort_probe";
    let qualified = format!("`{}`.`{}`", database, table_name);
    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
    driver
        .execute_query(format!("CREATE TABLE {} (id INT PRIMARY KEY)", qualified))
        .await
        .expect("create dbpaw_mariadb_invalid_sort_probe failed");

    let result = driver
        .get_table_data(
            database.clone(),
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
        err.contains("[VALIDATION_ERROR] Invalid sort column name"),
        "unexpected error: {}",
        err
    );

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
    driver.close().await;
}

#[tokio::test]
#[ignore]
async fn test_mariadb_table_structure_and_schema_overview() {
    let docker = (!mariadb_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mariadb_context::mariadb_form_from_test_context(docker.as_ref());
    let database = form
        .database
        .clone()
        .expect("MARIADB_DB or container default database should be present");
    let driver: MysqlDriver =
        mariadb_context::connect_with_retry(|| MysqlDriver::connect(&form)).await;

    let table_name = "dbpaw_mariadb_overview_probe";
    let qualified = format!("`{}`.`{}`", database, table_name);
    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;

    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, label VARCHAR(50) NOT NULL)",
            qualified
        ))
        .await
        .expect("create dbpaw_mariadb_overview_probe failed");

    let structure = driver
        .get_table_structure(database.clone(), table_name.to_string())
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
        .get_schema_overview(Some(database.clone()))
        .await
        .expect("get_schema_overview failed");
    assert!(
        overview
            .tables
            .iter()
            .any(|t| t.schema == database && t.name == table_name),
        "schema overview should include {}.{}",
        database,
        table_name
    );

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
    driver.close().await;
}

#[tokio::test]
#[ignore]
async fn test_mariadb_metadata_includes_indexes_and_foreign_keys() {
    let docker = (!mariadb_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mariadb_context::mariadb_form_from_test_context(docker.as_ref());
    let database = form
        .database
        .clone()
        .expect("MARIADB_DB or container default database should be present");
    let driver: MysqlDriver =
        mariadb_context::connect_with_retry(|| MysqlDriver::connect(&form)).await;

    let parent = "dbpaw_mariadb_parent_meta_probe";
    let child = "dbpaw_mariadb_child_meta_probe";
    let parent_qualified = format!("`{}`.`{}`", database, parent);
    let child_qualified = format!("`{}`.`{}`", database, child);

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", child_qualified))
        .await;
    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", parent_qualified))
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
                name VARCHAR(30), \
                INDEX idx_mariadb_child_name (name), \
                CONSTRAINT fk_mariadb_child_parent FOREIGN KEY (parent_id) REFERENCES {}(id)\
            )",
            child_qualified, parent_qualified
        ))
        .await
        .expect("create child table with fk failed");

    let metadata = driver
        .get_table_metadata(database.clone(), child.to_string())
        .await
        .expect("get_table_metadata failed");
    assert!(
        metadata
            .indexes
            .iter()
            .any(|i| i.name == "idx_mariadb_child_name" && i.columns.contains(&"name".to_string())),
        "metadata should include idx_mariadb_child_name"
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
        .execute_query(format!("DROP TABLE IF EXISTS {}", child_qualified))
        .await;
    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", parent_qualified))
        .await;
    driver.close().await;
}

#[tokio::test]
#[ignore]
async fn test_mariadb_boolean_and_json_type_mapping_regression() {
    let docker = (!mariadb_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mariadb_context::mariadb_form_from_test_context(docker.as_ref());
    let database = form
        .database
        .clone()
        .expect("MARIADB_DB or container default database should be present");
    let driver: MysqlDriver =
        mariadb_context::connect_with_retry(|| MysqlDriver::connect(&form)).await;

    let table_name = "dbpaw_mariadb_bool_json_probe";
    let qualified = format!("`{}`.`{}`", database, table_name);
    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, flag BOOLEAN, meta JSON)",
            qualified
        ))
        .await
        .expect("create bool/json probe table failed");
    driver
        .execute_query(format!(
            "INSERT INTO {} (id, flag, meta) VALUES (1, 1, '{{\"tier\": \"gold\"}}')",
            qualified
        ))
        .await
        .expect("insert bool/json probe row failed");

    let query_result = driver
        .execute_query(format!(
            "SELECT flag, JSON_UNQUOTE(JSON_EXTRACT(meta, '$.tier')) AS tier FROM {} WHERE id = 1",
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
            database.clone(),
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
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
    driver.close().await;
}
