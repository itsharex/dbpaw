mod shared;

use dbpaw_lib::db::drivers::{oracle::OracleDriver, DatabaseDriver};
use dbpaw_lib::models::ConnectionForm;
use std::env;

#[allow(unused_imports)]
pub use shared::{connect_with_retry, should_reuse_local_db};

/// Oracle has no freely-distributable Docker image (the Oracle Database Free image
/// at container-registry.oracle.com requires an Oracle account and terms acceptance).
/// Integration tests therefore only support IT_REUSE_LOCAL_DB=1 mode.
///
/// Required environment variables (all have defaults):
///   ORACLE_HOST       – defaults to "localhost"
///   ORACLE_PORT       – defaults to 1521
///   ORACLE_USER       – defaults to "system"
///   ORACLE_PASSWORD   – no default (required)
///   ORACLE_SERVICE    – defaults to "FREE"   (service name / SID)
///   ORACLE_SCHEMA     – defaults to "SYSTEM" (schema to use for test tables)
#[allow(dead_code)]
pub fn oracle_form_from_test_context() -> ConnectionForm {
    if !should_reuse_local_db() {
        panic!(
            "Oracle integration tests require a local Oracle instance. \
             Set IT_REUSE_LOCAL_DB=1 and provide ORACLE_HOST/PORT/USER/PASSWORD/SERVICE env vars."
        );
    }
    oracle_form_from_local_env()
}

fn is_missing_oracle_client_error(err: &str) -> bool {
    let lower = err.to_ascii_lowercase();
    lower.contains("dpi-1047") || lower.contains("cannot locate a 64-bit oracle client")
}

pub async fn oracle_test_context_or_skip(test_name: &str) -> Option<ConnectionForm> {
    if !should_reuse_local_db() {
        eprintln!("[skip] {test_name}: Oracle integration tests require IT_REUSE_LOCAL_DB=1.");
        return None;
    }

    if env::var("ORACLE_PASSWORD")
        .ok()
        .is_none_or(|value| value.trim().is_empty())
    {
        eprintln!(
            "[skip] {test_name}: ORACLE_PASSWORD is not set; local Oracle test env is incomplete."
        );
        return None;
    }

    let form = oracle_form_from_local_env();
    match OracleDriver::connect(&form).await {
        Ok(driver) => {
            driver.close().await;
            Some(form)
        }
        Err(err) if is_missing_oracle_client_error(&err) => {
            eprintln!("[skip] {test_name}: Oracle Instant Client is not available ({err}).");
            None
        }
        Err(err) => {
            panic!("Oracle test preflight failed for {test_name}: {err}");
        }
    }
}

fn oracle_form_from_local_env() -> ConnectionForm {
    ConnectionForm {
        driver: "oracle".to_string(),
        host: Some(shared::env_or("ORACLE_HOST", "localhost")),
        port: Some(shared::env_i64("ORACLE_PORT", 1521)),
        username: Some(shared::env_or("ORACLE_USER", "system")),
        password: Some(shared::env_or("ORACLE_PASSWORD", "")),
        database: Some(shared::env_or("ORACLE_SERVICE", "FREE")),
        schema: Some(shared::env_or("ORACLE_SCHEMA", "SYSTEM")),
        ..Default::default()
    }
}
