mod shared;

use dbpaw_lib::models::ConnectionForm;
use std::env;
use std::time::Duration;
use testcontainers::clients::Cli;
use testcontainers::core::WaitFor;
use testcontainers::{Container, GenericImage, RunnableImage};

pub use shared::{connect_with_retry, should_reuse_local_db};

pub fn clickhouse_form_from_test_context<'a>(
    docker: Option<&'a Cli>,
) -> (Option<Container<'a, GenericImage>>, ConnectionForm) {
    if should_reuse_local_db() {
        return (None, clickhouse_form_from_local_env());
    }
    shared::ensure_docker_available();

    let docker = docker.expect("docker client is required when IT_REUSE_LOCAL_DB is not enabled");
    let image = GenericImage::new("clickhouse/clickhouse-server", "24.3")
        .with_env_var("CLICKHOUSE_USER", "dbpaw")
        .with_env_var("CLICKHOUSE_PASSWORD", "123456")
        .with_env_var("CLICKHOUSE_DB", "test_db")
        .with_wait_for(WaitFor::seconds(8))
        .with_exposed_port(8123);
    let runnable =
        RunnableImage::from(image).with_container_name(shared::unique_container_name("clickhouse"));
    let container = docker.run(runnable);
    let port = container.get_host_port_ipv4(8123);

    shared::wait_for_port("127.0.0.1", port, Duration::from_secs(60));

    let mut form = ConnectionForm {
        driver: "clickhouse".to_string(),
        host: Some("127.0.0.1".to_string()),
        port: Some(i64::from(port)),
        username: Some("dbpaw".to_string()),
        password: Some("123456".to_string()),
        database: Some("test_db".to_string()),
        ..Default::default()
    };
    apply_clickhouse_env_overrides(&mut form);
    (Some(container), form)
}

fn clickhouse_form_from_local_env() -> ConnectionForm {
    let mut form = ConnectionForm {
        driver: "clickhouse".to_string(),
        host: Some(shared::env_or("CLICKHOUSE_HOST", "localhost")),
        port: Some(shared::env_i64("CLICKHOUSE_PORT", 8123)),
        username: Some(shared::env_or("CLICKHOUSE_USER", "default")),
        password: Some(shared::env_or("CLICKHOUSE_PASSWORD", "")),
        database: Some(shared::env_or("CLICKHOUSE_DB", "default")),
        ..Default::default()
    };
    apply_clickhouse_env_overrides(&mut form);
    form
}

fn apply_clickhouse_env_overrides(form: &mut ConnectionForm) {
    if let Ok(host) = env::var("CLICKHOUSE_HOST") {
        form.host = Some(host);
    }
    if let Ok(port) = env::var("CLICKHOUSE_PORT") {
        form.port = Some(
            port.parse::<i64>()
                .expect("CLICKHOUSE_PORT should be a valid number"),
        );
    }
    if let Ok(user) = env::var("CLICKHOUSE_USER") {
        form.username = Some(user);
    }
    if let Ok(password) = env::var("CLICKHOUSE_PASSWORD") {
        form.password = Some(password);
    }
    if let Ok(database) = env::var("CLICKHOUSE_DB") {
        form.database = Some(database);
    }
}
