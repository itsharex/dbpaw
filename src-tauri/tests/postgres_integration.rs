#[path = "common/postgres_context.rs"]
mod postgres_context;

use dbpaw_lib::db::drivers::postgres::PostgresDriver;
use dbpaw_lib::db::drivers::DatabaseDriver;
use testcontainers::clients::Cli;

#[tokio::test]
#[ignore]
async fn test_postgres_integration_flow() {
    let docker = (!postgres_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = postgres_context::postgres_form_from_test_context(docker.as_ref());

    let driver = postgres_context::connect_with_retry(|| PostgresDriver::connect(&form)).await;

    driver
        .test_connection()
        .await
        .expect("test_connection failed");

    let databases = driver
        .list_databases()
        .await
        .expect("list_databases failed");
    assert!(!databases.is_empty(), "list_databases returned empty");

    let table_name = "dbpaw_pg_type_probe";
    let qualified = format!("public.{}", table_name);

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;

    driver
        .execute_query(format!(
            "CREATE TABLE {} (\
                id INT PRIMARY KEY, \
                amount NUMERIC(10,2), \
                created_at TIMESTAMPTZ, \
                payload BYTEA, \
                meta JSONB\
            )",
            qualified
        ))
        .await
        .expect("create table failed");

    driver
        .execute_query(format!(
            "INSERT INTO {} (id, amount, created_at, payload, meta) VALUES \
             (1, 12.34, '2026-01-02T03:04:05Z', E'\\\\xDEADBEEF', '{{\"k\":\"v\"}}'::jsonb)",
            qualified
        ))
        .await
        .expect("insert failed");

    let tables = driver
        .list_tables(Some("public".to_string()))
        .await
        .expect("list_tables failed");
    assert!(
        tables
            .iter()
            .any(|t| t.schema == "public" && t.name == table_name),
        "list_tables should include public.{}",
        table_name
    );

    let metadata = driver
        .get_table_metadata("public".to_string(), table_name.to_string())
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
        .get_table_ddl("public".to_string(), table_name.to_string())
        .await
        .expect("get_table_ddl failed");
    assert!(
        ddl.to_uppercase().contains("CREATE TABLE"),
        "DDL should contain CREATE TABLE"
    );

    let result = driver
        .execute_query(format!(
            "SELECT amount, created_at, payload, meta FROM {} WHERE id = 1",
            qualified
        ))
        .await
        .expect("select typed row failed");
    assert_eq!(result.row_count, 1);

    let row = result
        .data
        .first()
        .expect("typed result should include at least one row");
    assert_eq!(
        row["amount"],
        serde_json::Value::String("12.34".to_string()),
        "amount should be rendered as string"
    );
    assert!(row.get("created_at").is_some(), "created_at should exist");
    assert!(row.get("payload").is_some(), "payload should exist");
    assert!(row.get("meta").is_some(), "meta should exist");

    let table_data = driver
        .get_table_data(
            "public".to_string(),
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
async fn test_postgres_get_table_data_supports_pagination_sort_filter_and_order_by() {
    let docker = (!postgres_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = postgres_context::postgres_form_from_test_context(docker.as_ref());
    let driver = postgres_context::connect_with_retry(|| PostgresDriver::connect(&form)).await;

    let table_name = "dbpaw_pg_grid_probe";
    let qualified = format!("public.{}", table_name);

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, name TEXT, score INT)",
            qualified
        ))
        .await
        .expect("create pg grid probe table failed");
    driver
        .execute_query(format!(
            "INSERT INTO {} (id, name, score) VALUES \
             (1, 'alpha', 10), (2, 'beta', 20), (3, 'gamma', 30), (4, 'delta', 40)",
            qualified
        ))
        .await
        .expect("insert pg grid rows failed");

    let page1 = driver
        .get_table_data(
            "public".to_string(),
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
            "public".to_string(),
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
            "public".to_string(),
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
async fn test_postgres_get_table_data_rejects_invalid_sort_column() {
    let docker = (!postgres_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = postgres_context::postgres_form_from_test_context(docker.as_ref());
    let driver = postgres_context::connect_with_retry(|| PostgresDriver::connect(&form)).await;

    let table_name = "dbpaw_pg_invalid_sort_probe";
    let qualified = format!("public.{}", table_name);

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
    driver
        .execute_query(format!("CREATE TABLE {} (id INT PRIMARY KEY)", qualified))
        .await
        .expect("create invalid sort probe table failed");

    let result = driver
        .get_table_data(
            "public".to_string(),
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
async fn test_postgres_table_structure_and_schema_overview() {
    let docker = (!postgres_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = postgres_context::postgres_form_from_test_context(docker.as_ref());
    let driver = postgres_context::connect_with_retry(|| PostgresDriver::connect(&form)).await;

    let table_name = "dbpaw_pg_overview_probe";
    let qualified = format!("public.{}", table_name);

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, label TEXT NOT NULL)",
            qualified
        ))
        .await
        .expect("create overview probe table failed");

    let structure = driver
        .get_table_structure("public".to_string(), table_name.to_string())
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
        .get_schema_overview(Some("public".to_string()))
        .await
        .expect("get_schema_overview failed");
    assert!(
        overview
            .tables
            .iter()
            .any(|t| t.schema == "public" && t.name == table_name),
        "schema overview should include public.{}",
        table_name
    );

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
}

#[tokio::test]
#[ignore]
async fn test_postgres_metadata_includes_indexes_and_foreign_keys() {
    let docker = (!postgres_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = postgres_context::postgres_form_from_test_context(docker.as_ref());
    let driver = postgres_context::connect_with_retry(|| PostgresDriver::connect(&form)).await;

    let parent = "dbpaw_pg_parent_meta_probe";
    let child = "dbpaw_pg_child_meta_probe";
    let parent_qualified = format!("public.{}", parent);
    let child_qualified = format!("public.{}", child);

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
                name TEXT, \
                CONSTRAINT fk_pg_child_parent FOREIGN KEY (parent_id) REFERENCES {}(id)\
            )",
            child_qualified, parent_qualified
        ))
        .await
        .expect("create child table with fk failed");
    driver
        .execute_query(format!(
            "CREATE INDEX idx_pg_child_name ON {} (name)",
            child_qualified
        ))
        .await
        .expect("create child index failed");

    let metadata = driver
        .get_table_metadata("public".to_string(), child.to_string())
        .await
        .expect("get_table_metadata for child failed");
    assert!(
        metadata
            .indexes
            .iter()
            .any(|i| i.name == "idx_pg_child_name" && i.columns.contains(&"name".to_string())),
        "metadata should include idx_pg_child_name"
    );
    assert!(
        metadata.foreign_keys.iter().any(|fk| {
            fk.name == "fk_pg_child_parent"
                && fk.column == "parent_id"
                && fk.referenced_table == parent
                && fk.referenced_column == "id"
        }),
        "metadata should include fk_pg_child_parent"
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
async fn test_postgres_boolean_and_json_type_mapping_regression() {
    let docker = (!postgres_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = postgres_context::postgres_form_from_test_context(docker.as_ref());
    let driver = postgres_context::connect_with_retry(|| PostgresDriver::connect(&form)).await;

    let table_name = "dbpaw_pg_bool_json_probe";
    let qualified = format!("public.{}", table_name);

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
    driver
        .execute_query(format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, flag BOOLEAN, meta JSONB)",
            qualified
        ))
        .await
        .expect("create bool/json probe table failed");
    driver
        .execute_query(format!(
            "INSERT INTO {} (id, flag, meta) VALUES (1, true, '{{\"tier\":\"gold\"}}'::jsonb)",
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
    assert_eq!(query_row["flag"], serde_json::Value::Bool(true));
    assert!(
        query_row.get("meta").is_some(),
        "meta should exist in query result"
    );

    let table_data = driver
        .get_table_data(
            "public".to_string(),
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
    assert_eq!(grid_row["flag"], serde_json::Value::Bool(true));
    assert!(
        grid_row.get("meta").is_some(),
        "meta should exist in table_data"
    );

    let _ = driver
        .execute_query(format!("DROP TABLE IF EXISTS {}", qualified))
        .await;
}
