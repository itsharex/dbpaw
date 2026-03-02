use dbpaw_lib::db::drivers::mssql::MssqlDriver;
use dbpaw_lib::db::drivers::DatabaseDriver;
use dbpaw_lib::models::ConnectionForm;
use std::env;

#[tokio::test]
#[ignore]
async fn test_mssql_integration_flow() {
    let host = env::var("MSSQL_HOST").unwrap_or_else(|_| "localhost".to_string());
    let port = env::var("MSSQL_PORT")
        .unwrap_or_else(|_| "1433".to_string())
        .parse()
        .expect("MSSQL_PORT should be a number");
    let username = env::var("MSSQL_USER").unwrap_or_else(|_| "sa".to_string());
    let password = env::var("MSSQL_PASSWORD").unwrap_or_default();
    let database = env::var("MSSQL_DB").unwrap_or_else(|_| "master".to_string());

    let form = ConnectionForm {
        driver: "mssql".to_string(),
        host: Some(host),
        port: Some(port),
        username: Some(username),
        password: Some(password),
        database: Some(database.clone()),
        ..Default::default()
    };

    let driver = MssqlDriver::connect(&form)
        .await
        .expect("Failed to connect to MSSQL");

    driver
        .test_connection()
        .await
        .expect("test_connection failed");

    let databases = driver
        .list_databases()
        .await
        .expect("list_databases failed");
    assert!(!databases.is_empty(), "list_databases returned empty");

    let _tables = driver
        .list_tables(None)
        .await
        .expect("list_tables failed");

    let result = driver
        .execute_query("SELECT TOP 1 name FROM sys.databases".to_string())
        .await
        .expect("execute_query failed");
    assert!(result.row_count >= 1);
}
