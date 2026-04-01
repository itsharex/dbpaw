mod shared;

use dbpaw_lib::models::ConnectionForm;
use std::time::Duration;
use testcontainers::clients::Cli;
use testcontainers::core::WaitFor;
use testcontainers::{Container, GenericImage, RunnableImage};

pub use shared::{connect_with_retry, should_reuse_local_db};

pub fn postgres_form_from_test_context<'a>(
    docker: Option<&'a Cli>,
) -> (Option<Container<'a, GenericImage>>, ConnectionForm) {
    if should_reuse_local_db() {
        return (None, postgres_form_from_local_env());
    }
    shared::ensure_docker_available();

    let docker = docker.expect("docker client is required when IT_REUSE_LOCAL_DB is not enabled");
    let image = GenericImage::new("postgres", "16-alpine")
        .with_env_var("POSTGRES_USER", "postgres")
        .with_env_var("POSTGRES_PASSWORD", "postgres")
        .with_env_var("POSTGRES_DB", "postgres")
        .with_wait_for(WaitFor::seconds(3))
        .with_exposed_port(5432);
    let runnable =
        RunnableImage::from(image).with_container_name(shared::unique_container_name("postgres"));
    let container = docker.run(runnable);
    let port = container.get_host_port_ipv4(5432);

    shared::wait_for_port("127.0.0.1", port, Duration::from_secs(45));

    let mut form = ConnectionForm {
        driver: "postgres".to_string(),
        host: Some("127.0.0.1".to_string()),
        port: Some(i64::from(port)),
        username: Some("postgres".to_string()),
        password: Some("postgres".to_string()),
        database: Some("postgres".to_string()),
        ..Default::default()
    };
    apply_postgres_env_overrides(&mut form);
    (Some(container), form)
}

fn postgres_form_from_local_env() -> ConnectionForm {
    let mut form = ConnectionForm {
        driver: "postgres".to_string(),
        host: Some(shared::env_or_any(
            &["POSTGRES_HOST", "PG_HOST"],
            "localhost",
        )),
        port: Some(shared::env_i64_any(&["POSTGRES_PORT", "PG_PORT"], 5432)),
        username: Some(shared::env_or_any(&["POSTGRES_USER", "PGUSER"], "postgres")),
        password: Some(shared::env_or_any(
            &["POSTGRES_PASSWORD", "PGPASSWORD"],
            "postgres",
        )),
        database: Some(shared::env_or_any(
            &["POSTGRES_DB", "PGDATABASE"],
            "postgres",
        )),
        ..Default::default()
    };
    apply_postgres_env_overrides(&mut form);
    form
}

fn apply_postgres_env_overrides(form: &mut ConnectionForm) {
    if let Some(host) = shared::env_any(&["POSTGRES_HOST", "PG_HOST"]) {
        form.host = Some(host);
    }
    if let Some(port) = shared::env_any(&["POSTGRES_PORT", "PG_PORT"]) {
        form.port = Some(
            port.parse::<i64>()
                .expect("POSTGRES_PORT/PG_PORT should be a valid number"),
        );
    }
    if let Some(user) = shared::env_any(&["POSTGRES_USER", "PGUSER"]) {
        form.username = Some(user);
    }
    if let Some(password) = shared::env_any(&["POSTGRES_PASSWORD", "PGPASSWORD"]) {
        form.password = Some(password);
    }
    if let Some(database) = shared::env_any(&["POSTGRES_DB", "PGDATABASE"]) {
        form.database = Some(database);
    }
}
