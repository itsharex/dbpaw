mod shared;

use dbpaw_lib::commands::connection;
use dbpaw_lib::models::ConnectionForm;
use std::sync::OnceLock;
use std::time::Duration;
use testcontainers::clients::Cli;
use testcontainers::core::WaitFor;
use testcontainers::{Container, GenericImage, RunnableImage};
use tokio::time::sleep;

#[allow(unused_imports)]
pub use shared::{connect_with_retry, should_reuse_local_db, unique_name};

static SHARED_CONTAINER: OnceLock<(&'static Container<'static, GenericImage>, ConnectionForm)> =
    OnceLock::new();

fn mariadb_image() -> RunnableImage<GenericImage> {
    let image = GenericImage::new("mariadb", "11")
        .with_env_var("MARIADB_ROOT_PASSWORD", "123456")
        .with_env_var("MARIADB_DATABASE", "test_db")
        .with_wait_for(WaitFor::seconds(5))
        .with_exposed_port(3306);
    RunnableImage::from(image)
}

fn mariadb_form_from_env(host: &str, port: u16) -> ConnectionForm {
    ConnectionForm {
        driver: "mariadb".to_string(),
        host: Some(shared::env_or("MARIADB_HOST", host)),
        port: Some(shared::env_i64("MARIADB_PORT", i64::from(port))),
        username: Some(shared::env_or("MARIADB_USER", "root")),
        password: Some(shared::env_or("MARIADB_PASSWORD", "123456")),
        database: Some(shared::env_or("MARIADB_DB", "test_db")),
        ..Default::default()
    }
}

pub fn shared_mariadb_form() -> ConnectionForm {
    if should_reuse_local_db() {
        return mariadb_form_from_env("localhost", 3306);
    }
    shared::ensure_docker_available();

    let (_container, form) = SHARED_CONTAINER.get_or_init(|| {
        let cli: &'static Cli = Box::leak(Box::new(Cli::default()));
        let runnable =
            mariadb_image().with_container_name(shared::unique_container_name("mariadb-shared"));
        let container: &'static Container<'static, GenericImage> =
            Box::leak(Box::new(cli.run(runnable)));
        let port = container.get_host_port_ipv4(3306);
        shared::wait_for_port("127.0.0.1", port, Duration::from_secs(45));
        (container, mariadb_form_from_env("127.0.0.1", port))
    });
    form.clone()
}

#[allow(dead_code)]
pub fn mariadb_form_from_test_context<'a>(
    docker: Option<&'a Cli>,
) -> (Option<Container<'a, GenericImage>>, ConnectionForm) {
    if should_reuse_local_db() {
        return (None, mariadb_form_from_env("localhost", 3306));
    }
    shared::ensure_docker_available();

    let docker = docker.expect("docker client is required when IT_REUSE_LOCAL_DB is not set");
    let runnable = mariadb_image().with_container_name(shared::unique_container_name("mariadb"));
    let container = docker.run(runnable);
    let port = container.get_host_port_ipv4(3306);
    shared::wait_for_port("127.0.0.1", port, Duration::from_secs(45));
    (Some(container), mariadb_form_from_env("127.0.0.1", port))
}

#[allow(dead_code)]
pub async fn wait_until_ready(form: &ConnectionForm) {
    let mut last_error = String::new();
    for _ in 0..45 {
        match connection::test_connection_ephemeral(form.clone()).await {
            Ok(_) => return,
            Err(err) => {
                last_error = err;
                sleep(Duration::from_secs(1)).await;
            }
        }
    }
    panic!(
        "MariaDB at {}:{} did not become ready in time: {last_error}",
        form.host.as_deref().unwrap_or("?"),
        form.port.unwrap_or(3306)
    );
}
