mod shared;

use dbpaw_lib::models::ConnectionForm;
use std::env;
use std::time::Duration;
use testcontainers::clients::Cli;
use testcontainers::core::WaitFor;
use testcontainers::{Container, GenericImage, RunnableImage};

pub use shared::{connect_with_retry, should_reuse_local_db};

pub fn mariadb_form_from_test_context<'a>(
    docker: Option<&'a Cli>,
) -> (Option<Container<'a, GenericImage>>, ConnectionForm) {
    if should_reuse_local_db() {
        return (None, mariadb_form_from_local_env());
    }
    shared::ensure_docker_available();

    let docker = docker.expect("docker client is required when IT_REUSE_LOCAL_DB is not enabled");
    let image = GenericImage::new("mariadb", "11")
        .with_env_var("MARIADB_ROOT_PASSWORD", "123456")
        .with_env_var("MARIADB_DATABASE", "test_db")
        .with_wait_for(WaitFor::seconds(5))
        .with_exposed_port(3306);
    let runnable =
        RunnableImage::from(image).with_container_name(shared::unique_container_name("mariadb"));
    let container = docker.run(runnable);
    let port = container.get_host_port_ipv4(3306);

    shared::wait_for_port("127.0.0.1", port, Duration::from_secs(45));

    let mut form = ConnectionForm {
        driver: "mariadb".to_string(),
        host: Some("127.0.0.1".to_string()),
        port: Some(i64::from(port)),
        username: Some("root".to_string()),
        password: Some("123456".to_string()),
        database: Some("test_db".to_string()),
        ..Default::default()
    };
    apply_mariadb_env_overrides(&mut form);
    (Some(container), form)
}

fn mariadb_form_from_local_env() -> ConnectionForm {
    let mut form = ConnectionForm {
        driver: "mariadb".to_string(),
        host: Some(shared::env_or("MARIADB_HOST", "localhost")),
        port: Some(shared::env_i64("MARIADB_PORT", 3306)),
        username: Some(shared::env_or("MARIADB_USER", "root")),
        password: Some(shared::env_or("MARIADB_PASSWORD", "123456")),
        database: Some(shared::env_or("MARIADB_DB", "test_db")),
        ..Default::default()
    };
    apply_mariadb_env_overrides(&mut form);
    form
}

fn apply_mariadb_env_overrides(form: &mut ConnectionForm) {
    if let Ok(host) = env::var("MARIADB_HOST") {
        form.host = Some(host);
    }
    if let Ok(port) = env::var("MARIADB_PORT") {
        form.port = Some(
            port.parse::<i64>()
                .expect("MARIADB_PORT should be a valid number"),
        );
    }
    if let Ok(user) = env::var("MARIADB_USER") {
        form.username = Some(user);
    }
    if let Ok(password) = env::var("MARIADB_PASSWORD") {
        form.password = Some(password);
    }
    if let Ok(database) = env::var("MARIADB_DB") {
        form.database = Some(database);
    }
}
