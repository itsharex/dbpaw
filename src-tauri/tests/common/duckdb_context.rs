use dbpaw_lib::models::ConnectionForm;
use std::env;
use std::path::PathBuf;
use uuid::Uuid;

pub fn should_reuse_local_db() -> bool {
    env::var("IT_REUSE_LOCAL_DB")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub fn duckdb_form_from_test_context() -> (PathBuf, ConnectionForm) {
    let path = duckdb_test_path_from_context();
    let form = ConnectionForm {
        driver: "duckdb".to_string(),
        file_path: Some(path.to_string_lossy().to_string()),
        ..Default::default()
    };
    (path, form)
}

fn duckdb_test_path_from_context() -> PathBuf {
    if let Ok(v) = env::var("DUCKDB_IT_DB_PATH") {
        return PathBuf::from(v);
    }
    if let Ok(v) = env::var("DUCKDB_DB_PATH") {
        return PathBuf::from(v);
    }
    if should_reuse_local_db() {
        let mut p = env::temp_dir();
        p.push("dbpaw-duckdb-local-it.duckdb");
        return p;
    }
    let mut p = env::temp_dir();
    p.push(format!(
        "dbpaw-duckdb-integration-{}.duckdb",
        Uuid::new_v4()
    ));
    p
}
