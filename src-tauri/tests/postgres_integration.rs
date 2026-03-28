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
