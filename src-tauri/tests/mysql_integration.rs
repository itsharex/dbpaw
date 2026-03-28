#[path = "common/mysql_context.rs"]
mod mysql_context;

use dbpaw_lib::db::drivers::mysql::MysqlDriver;
use dbpaw_lib::db::drivers::DatabaseDriver;
use testcontainers::clients::Cli;

#[tokio::test]
#[ignore]
async fn test_mysql_integration_flow() {
    let docker = (!mysql_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mysql_context::mysql_form_from_test_context(docker.as_ref());
    let database = form.database.clone();

    println!(
        "Testing MySQL connection to {}:{}",
        form.host.as_deref().unwrap_or("localhost"),
        form.port.unwrap_or(3306)
    );

    let driver: MysqlDriver =
        mysql_context::connect_with_retry(|| MysqlDriver::connect(&form)).await;

    // 1. Test Connection
    // This just runs "SELECT 1"
    let result = driver.test_connection().await;
    assert!(result.is_ok(), "Connection failed: {:?}", result.err());
    println!("Connection successful!");

    // 2. List Databases
    let dbs = driver.list_databases().await;
    assert!(dbs.is_ok(), "Failed to list databases: {:?}", dbs.err());
    let dbs = dbs.unwrap();
    println!("Databases found: {:?}", dbs);
    assert!(!dbs.is_empty());

    // 3. Operations requiring a specific database
    if let Some(db_name) = database {
        println!("Running operations on database: {}", db_name);

        // List Tables
        let tables = driver.list_tables(Some(db_name.clone())).await;
        assert!(tables.is_ok(), "Failed to list tables: {:?}", tables.err());
        let tables = tables.unwrap();
        println!("Tables: {:?}", tables);

        // Setup a test table
        let table_name = "test_driver_integration";
        let create_sql = format!(
            "CREATE TABLE IF NOT EXISTS {} (id INT PRIMARY KEY, name VARCHAR(50))",
            table_name
        );
        let _ = driver
            .execute_query(create_sql)
            .await
            .expect("Failed to create table");

        // Insert
        let insert_sql = format!(
            "INSERT INTO {} (id, name) VALUES (1, 'Test Item')",
            table_name
        );
        // Clean up first just in case
        let _ = driver
            .execute_query(format!("DELETE FROM {} WHERE id = 1", table_name))
            .await;

        let insert_res = driver.execute_query(insert_sql).await;
        assert!(insert_res.is_ok(), "Insert failed: {:?}", insert_res.err());

        // Query
        let select_sql = format!("SELECT * FROM {} WHERE id = 1", table_name);
        let query_res = driver.execute_query(select_sql).await;
        assert!(query_res.is_ok(), "Select failed: {:?}", query_res.err());
        let query_data = query_res.unwrap();
        assert_eq!(query_data.row_count, 1);

        // Verify data content
        // data is Vec<serde_json::Value>
        if let Some(row) = query_data.data.first() {
            let name_val = row.get("name").and_then(|v| v.as_str());
            assert_eq!(name_val, Some("Test Item"));
        } else {
            panic!("No data returned");
        }

        // Clean up
        let drop_sql = format!("DROP TABLE {}", table_name);
        let _ = driver.execute_query(drop_sql).await;
        println!("Integration test finished successfully");
    } else {
        println!("Skipping table operations because MYSQL_DB env var is not set");
    }
}

#[tokio::test]
#[ignore]
async fn test_mysql_metadata_and_type_mapping_flow() {
    let docker = (!mysql_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mysql_context::mysql_form_from_test_context(docker.as_ref());
    let database = form
        .database
        .clone()
        .expect("MYSQL_DB or container default database should be present");

    let driver: MysqlDriver =
        mysql_context::connect_with_retry(|| MysqlDriver::connect(&form)).await;

    let table_name = "dbpaw_type_probe";
    let qualified = format!("`{}`.`{}`", database, table_name);

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;

    driver
        .execute_query(format!(
            "CREATE TABLE {} (\
                id INT PRIMARY KEY, \
                flag BOOLEAN, \
                amount DECIMAL(10,2), \
                created_at DATETIME, \
                payload VARBINARY(16), \
                note VARCHAR(50)\
            )",
            qualified
        ))
        .await
        .expect("create table failed");

    driver
        .execute_query(format!(
            "INSERT INTO {} (id, flag, amount, created_at, payload, note) \
             VALUES (1, 1, 12.34, '2026-01-02 03:04:05', UNHEX('DEADBEEF'), 'hello')",
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

    let tables_with_default_db = driver
        .list_tables(None)
        .await
        .expect("list_tables(None) should fallback to current database");
    assert!(
        tables_with_default_db.iter().any(|t| t.name == table_name),
        "list_tables(None) should include {} when MYSQL_DB is selected",
        table_name
    );

    let metadata = driver
        .get_table_metadata(database.clone(), table_name.to_string())
        .await
        .expect("get_table_metadata failed");
    assert!(
        metadata.columns.iter().any(|c| c.name == "payload"),
        "metadata should include payload column"
    );
    assert!(
        metadata
            .columns
            .iter()
            .any(|c| c.name == "id" && c.primary_key),
        "metadata should mark id as primary key"
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
            "SELECT flag, amount, created_at, payload, note FROM {} WHERE id = 1",
            qualified
        ))
        .await
        .expect("select typed row failed");

    assert_eq!(result.row_count, 1);
    let row = result
        .data
        .first()
        .expect("typed result should include at least one row");
    assert!(row.get("flag").is_some(), "flag should exist");
    assert_eq!(
        row["amount"],
        serde_json::Value::String("12.34".to_string()),
        "amount should be rendered as string"
    );
    assert!(row.get("created_at").is_some(), "created_at should exist");
    assert!(
        row.get("payload").is_some(),
        "payload(VARBINARY) should be decodable without error"
    );

    let table_data = driver
        .get_table_data(
            database.clone(),
            table_name.to_string(),
            1,
            100,
            None,
            None,
            None,
            None,
        )
        .await
        .expect("get_table_data failed");
    assert_eq!(table_data.total, 1);
    assert_eq!(table_data.data.len(), 1);
    let grid_row = table_data
        .data
        .first()
        .expect("table_data should include at least one row");
    assert_eq!(
        grid_row["amount"],
        serde_json::Value::String("12.34".to_string()),
        "amount should be rendered as string in table data"
    );
    assert!(
        grid_row.get("created_at").is_some(),
        "created_at should exist"
    );

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
}

#[tokio::test]
#[ignore]
async fn test_mysql_list_databases_and_tables_with_binary_collation_database() {
    let docker = (!mysql_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mysql_context::mysql_form_from_test_context(docker.as_ref());

    let driver: MysqlDriver =
        mysql_context::connect_with_retry(|| MysqlDriver::connect(&form)).await;

    let probe_db = "dbpaw_bin_probe";
    let probe_table = "probe_tbl";

    driver
        .execute_query(format!(
            "CREATE DATABASE IF NOT EXISTS `{}` CHARACTER SET latin1 COLLATE latin1_bin",
            probe_db
        ))
        .await
        .expect("create binary-collation database failed");

    driver
        .execute_query(format!(
            "CREATE TABLE IF NOT EXISTS `{}`.`{}` (id INT PRIMARY KEY)",
            probe_db, probe_table
        ))
        .await
        .expect("create table in probe db failed");

    let dbs = driver
        .list_databases()
        .await
        .expect("list_databases failed on binary-collation db");
    assert!(
        dbs.iter().any(|db| db == probe_db),
        "list_databases should include {}",
        probe_db
    );

    let tables = driver
        .list_tables(Some(probe_db.to_string()))
        .await
        .expect("list_tables failed on binary-collation db");
    assert!(
        tables.iter().any(|t| t.name == probe_table),
        "list_tables should include {}.{}",
        probe_db,
        probe_table
    );

    let _ = driver
        .execute_query(format!("DROP DATABASE IF EXISTS `{}`", probe_db))
        .await;
}

#[tokio::test]
#[ignore]
async fn test_mysql_list_tables_with_unicode_table_name() {
    let docker = (!mysql_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mysql_context::mysql_form_from_test_context(docker.as_ref());
    let database = form
        .database
        .clone()
        .expect("MYSQL_DB or container default database should be present");

    let driver: MysqlDriver =
        mysql_context::connect_with_retry(|| MysqlDriver::connect(&form)).await;

    let table_name = "dbpaw_中文_probe";
    let qualified = format!("`{}`.`{}`", database, table_name);

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;

    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, name VARCHAR(20))",
            qualified
        ))
        .await
        .expect("create unicode table failed");

    let tables = driver
        .list_tables(Some(database.clone()))
        .await
        .expect("list_tables failed for unicode table name");
    assert!(
        tables.iter().any(|t| t.name == table_name),
        "list_tables should include {}",
        table_name
    );

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
}

#[tokio::test]
#[ignore]
async fn test_mysql_get_table_data_supports_pagination_sort_filter_and_order_by() {
    let docker = (!mysql_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mysql_context::mysql_form_from_test_context(docker.as_ref());
    let database = form
        .database
        .clone()
        .expect("MYSQL_DB or container default database should be present");
    let driver: MysqlDriver =
        mysql_context::connect_with_retry(|| MysqlDriver::connect(&form)).await;

    let table_name = "dbpaw_grid_probe";
    let qualified = format!("`{}`.`{}`", database, table_name);

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, name VARCHAR(20), score INT)",
            qualified
        ))
        .await
        .expect("create grid probe table failed");
    driver
        .execute_query(format!(
            "INSERT INTO {} (id, name, score) VALUES \
             (1, 'alpha', 10), (2, 'beta', 20), (3, 'gamma', 30), (4, 'delta', 40)",
            qualified
        ))
        .await
        .expect("insert grid probe rows failed");

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
        .expect("get_table_data for page1 failed");
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
        .expect("get_table_data with order_by priority failed");
    assert_eq!(ordered.total, 4);
    assert_eq!(ordered.data.len(), 1);
    assert_eq!(
        ordered.data[0]["name"],
        serde_json::Value::String("gamma".to_string())
    );

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
}

#[tokio::test]
#[ignore]
async fn test_mysql_get_table_data_rejects_invalid_sort_column() {
    let docker = (!mysql_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mysql_context::mysql_form_from_test_context(docker.as_ref());
    let database = form
        .database
        .clone()
        .expect("MYSQL_DB or container default database should be present");
    let driver: MysqlDriver =
        mysql_context::connect_with_retry(|| MysqlDriver::connect(&form)).await;

    let table_name = "dbpaw_invalid_sort_probe";
    let qualified = format!("`{}`.`{}`", database, table_name);
    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, name VARCHAR(20))",
            qualified
        ))
        .await
        .expect("create invalid sort probe table failed");

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
    let err = result.expect_err("invalid sort column should return an error");
    assert!(
        err.contains("[VALIDATION_ERROR] Invalid sort column name"),
        "unexpected error: {}",
        err
    );

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
}

#[tokio::test]
#[ignore]
async fn test_mysql_table_structure_and_schema_overview() {
    let docker = (!mysql_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mysql_context::mysql_form_from_test_context(docker.as_ref());
    let database = form
        .database
        .clone()
        .expect("MYSQL_DB or container default database should be present");
    let driver: MysqlDriver =
        mysql_context::connect_with_retry(|| MysqlDriver::connect(&form)).await;

    let table_name = "dbpaw_overview_probe";
    let qualified = format!("`{}`.`{}`", database, table_name);

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, label VARCHAR(30) NOT NULL)",
            qualified
        ))
        .await
        .expect("create overview probe table failed");

    let structure = driver
        .get_table_structure(database.clone(), table_name.to_string())
        .await
        .expect("get_table_structure failed");
    assert!(
        structure.columns.iter().any(|c| c.name == "id" && c.primary_key),
        "table structure should include primary key id"
    );
    assert!(
        structure.columns.iter().any(|c| c.name == "label"),
        "table structure should include label column"
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
}

#[tokio::test]
#[ignore]
async fn test_mysql_metadata_includes_indexes_and_foreign_keys() {
    let docker = (!mysql_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mysql_context::mysql_form_from_test_context(docker.as_ref());
    let database = form
        .database
        .clone()
        .expect("MYSQL_DB or container default database should be present");
    let driver: MysqlDriver =
        mysql_context::connect_with_retry(|| MysqlDriver::connect(&form)).await;

    let parent = "dbpaw_parent_meta_probe";
    let child = "dbpaw_child_meta_probe";
    let parent_qualified = format!("`{}`.`{}`", database, parent);
    let child_qualified = format!("`{}`.`{}`", database, child);

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", child_qualified))
        .await;
    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", parent_qualified))
        .await;

    driver
        .execute_query(format!("CREATE TABLE {} (id INT PRIMARY KEY)", parent_qualified))
        .await
        .expect("create parent table failed");
    driver
        .execute_query(format!(
            "CREATE TABLE {} (\
                id INT PRIMARY KEY, \
                parent_id INT NOT NULL, \
                name VARCHAR(30), \
                INDEX idx_child_name (name), \
                CONSTRAINT fk_child_parent FOREIGN KEY (parent_id) REFERENCES {}(id)\
            )",
            child_qualified, parent_qualified
        ))
        .await
        .expect("create child table with fk/index failed");

    let metadata = driver
        .get_table_metadata(database.clone(), child.to_string())
        .await
        .expect("get_table_metadata for child failed");
    assert!(
        metadata
            .indexes
            .iter()
            .any(|i| i.name == "idx_child_name" && i.columns.contains(&"name".to_string())),
        "metadata should include idx_child_name index"
    );
    assert!(
        metadata.foreign_keys.iter().any(|fk| {
            fk.name == "fk_child_parent"
                && fk.column == "parent_id"
                && fk.referenced_table == parent
                && fk.referenced_column == "id"
        }),
        "metadata should include fk_child_parent"
    );

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", child_qualified))
        .await;
    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", parent_qualified))
        .await;
}

#[tokio::test]
#[ignore]
async fn test_mysql_boolean_and_json_type_mapping_regression() {
    let docker = (!mysql_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = mysql_context::mysql_form_from_test_context(docker.as_ref());
    let database = form
        .database
        .clone()
        .expect("MYSQL_DB or container default database should be present");
    let driver: MysqlDriver =
        mysql_context::connect_with_retry(|| MysqlDriver::connect(&form)).await;

    let table_name = "dbpaw_bool_json_probe";
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
        .execute_query(format!("SELECT flag, meta FROM {} WHERE id = 1", qualified))
        .await
        .expect("select bool/json row failed");
    assert_eq!(query_result.row_count, 1);
    let query_row = query_result.data.first().expect("query row should exist");
    assert!(query_row.get("flag").is_some(), "flag should exist");
    assert!(query_row.get("meta").is_some(), "meta should exist");

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
        .expect("get_table_data for bool/json table failed");
    assert_eq!(table_data.total, 1);
    let grid_row = table_data.data.first().expect("table data row should exist");
    assert!(grid_row.get("flag").is_some(), "flag should exist in table_data");
    assert!(grid_row.get("meta").is_some(), "meta should exist in table_data");

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
}
