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

// Shared container for the current test binary.  Started once on first use and
// kept alive until the process exits, so all tests in the binary pay the
// container startup cost only once (~8 s per binary instead of per test).
//
// Tests that need their own isolated container lifetime (e.g. server-shutdown
// scenarios) should call `mysql_form_from_test_context` with a local `Cli`.
static SHARED_CONTAINER: OnceLock<(&'static Container<'static, GenericImage>, ConnectionForm)> =
    OnceLock::new();

/// Build the standard MySQL 8.0 test image.
fn mysql_image() -> RunnableImage<GenericImage> {
    let image = GenericImage::new("mysql", "8.0")
        .with_env_var("MYSQL_ROOT_PASSWORD", "123456")
        .with_env_var("MYSQL_ROOT_HOST", "%")
        .with_env_var("MYSQL_DATABASE", "test_db")
        .with_wait_for(WaitFor::seconds(5))
        .with_exposed_port(3306);
    RunnableImage::from(image)
}

/// Build a `ConnectionForm` from environment variables, falling back to
/// sensible defaults for local development.
fn mysql_form_from_env(host: &str, port: u16) -> ConnectionForm {
    ConnectionForm {
        driver: "mysql".to_string(),
        host: Some(shared::env_or("MYSQL_HOST", host)),
        port: Some(shared::env_i64("MYSQL_PORT", i64::from(port))),
        username: Some(shared::env_or("MYSQL_USER", "root")),
        password: Some(shared::env_or("MYSQL_PASSWORD", "123456")),
        database: Some(shared::env_or("MYSQL_DB", "test_db")),
        ..Default::default()
    }
}

/// Return a `ConnectionForm` backed by the shared MySQL container for this
/// binary.  The container is started on first call; subsequent calls reuse it.
/// Use this in the vast majority of tests.
pub fn shared_mysql_form() -> ConnectionForm {
    if should_reuse_local_db() {
        return mysql_form_from_env("localhost", 3306);
    }
    shared::ensure_docker_available();

    let (_container, form) = SHARED_CONTAINER.get_or_init(|| {
        let cli: &'static Cli = Box::leak(Box::new(Cli::default()));
        let runnable =
            mysql_image().with_container_name(shared::unique_container_name("mysql-shared"));
        let container: &'static Container<'static, GenericImage> =
            Box::leak(Box::new(cli.run(runnable)));
        let port = container.get_host_port_ipv4(3306);
        shared::wait_for_port("127.0.0.1", port, Duration::from_secs(45));
        (container, mysql_form_from_env("127.0.0.1", port))
    });
    form.clone()
}

/// Start an isolated MySQL container and return it together with a matching
/// `ConnectionForm`.  Use only when the test itself needs to control the
/// container lifetime (e.g. to test behaviour after server shutdown).
#[allow(dead_code)]
pub fn mysql_form_from_test_context<'a>(
    docker: Option<&'a Cli>,
) -> (Option<Container<'a, GenericImage>>, ConnectionForm) {
    if should_reuse_local_db() {
        return (None, mysql_form_from_env("localhost", 3306));
    }
    shared::ensure_docker_available();

    let docker = docker.expect("docker client is required when IT_REUSE_LOCAL_DB is not set");
    let runnable = mysql_image().with_container_name(shared::unique_container_name("mysql"));
    let container = docker.run(runnable);
    let port = container.get_host_port_ipv4(3306);
    shared::wait_for_port("127.0.0.1", port, Duration::from_secs(45));
    (Some(container), mysql_form_from_env("127.0.0.1", port))
}

/// Poll the MySQL server until it accepts connections or the timeout expires.
/// Uses the application-level `test_connection_ephemeral` command so it
/// validates the full stack, not just TCP reachability.
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
        "MySQL at {}:{} did not become ready in time: {last_error}",
        form.host.as_deref().unwrap_or("?"),
        form.port.unwrap_or(3306)
    );
}
