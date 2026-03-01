use dbpaw_lib::db::drivers::clickhouse::ClickHouseDriver;
use dbpaw_lib::db::drivers::DatabaseDriver;
use dbpaw_lib::models::ConnectionForm;
use std::env;

#[tokio::test]
#[ignore]
async fn test_clickhouse_integration_flow() {
    let host = env::var("CLICKHOUSE_HOST").unwrap_or_else(|_| "localhost".to_string());
    let port = env::var("CLICKHOUSE_PORT")
        .unwrap_or_else(|_| "8123".to_string())
        .parse()
        .unwrap();
    let username = env::var("CLICKHOUSE_USER").unwrap_or_else(|_| "default".to_string());
    let password = env::var("CLICKHOUSE_PASSWORD").unwrap_or_default();
    let database = env::var("CLICKHOUSE_DB").unwrap_or_else(|_| "default".to_string());

    let form = ConnectionForm {
        driver: "clickhouse".to_string(),
        host: Some(host),
        port: Some(port),
        username: Some(username),
        password: Some(password),
        database: Some(database.clone()),
        ..Default::default()
    };

    let driver = ClickHouseDriver::connect(&form)
        .await
        .expect("Failed to connect to ClickHouse");

    driver
        .test_connection()
        .await
        .expect("test_connection failed");

    let databases = driver
        .list_databases()
        .await
        .expect("list_databases failed");
    assert!(!databases.is_empty(), "list_databases returned empty");

    let tables = driver
        .list_tables(Some(database.clone()))
        .await
        .expect("list_tables failed");

    if let Some(first_table) = tables.first() {
        let _metadata = driver
            .get_table_metadata(first_table.schema.clone(), first_table.name.clone())
            .await
            .expect("get_table_metadata failed");

        let _ddl = driver
            .get_table_ddl(first_table.schema.clone(), first_table.name.clone())
            .await
            .expect("get_table_ddl failed");
    }

    let query_result = driver
        .execute_query("SELECT 1 AS ok".to_string())
        .await
        .expect("execute_query failed");
    assert_eq!(query_result.row_count, 1);

    let overview = driver
        .get_schema_overview(Some(database))
        .await
        .expect("get_schema_overview failed");
    assert!(
        !overview.tables.is_empty() || tables.is_empty(),
        "schema overview expected to have tables when list_tables has entries"
    );

    driver.close().await;
}
