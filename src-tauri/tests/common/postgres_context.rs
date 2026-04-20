mod shared;

use dbpaw_lib::db::drivers::postgres::PostgresDriver;
use dbpaw_lib::db::drivers::DatabaseDriver;
use dbpaw_lib::models::ConnectionForm;
use std::sync::OnceLock;
use std::time::Duration;
use testcontainers::clients::Cli;
use testcontainers::core::WaitFor;
use testcontainers::{Container, GenericImage, RunnableImage};

#[allow(unused_imports)]
pub use shared::{connect_with_retry, should_reuse_local_db, unique_name};

// Shared container for the current test binary.  Started once on first use and
// kept alive until the process exits, so all tests in the binary pay the
// container startup cost only once.
//
// Tests that need their own isolated container lifetime (e.g. server-shutdown
// scenarios) should call `postgres_form_from_test_context` with a local `Cli`.
static SHARED_CONTAINER: OnceLock<(&'static Container<'static, GenericImage>, ConnectionForm)> =
    OnceLock::new();

/// Build the standard PostgreSQL 16 test image.
fn postgres_image() -> RunnableImage<GenericImage> {
    let image = GenericImage::new("postgres", "16-alpine")
        .with_env_var("POSTGRES_USER", "postgres")
        .with_env_var("POSTGRES_PASSWORD", "postgres")
        .with_env_var("POSTGRES_DB", "postgres")
        .with_wait_for(WaitFor::seconds(3))
        .with_exposed_port(5432);
    RunnableImage::from(image)
}

/// Build a `ConnectionForm` from environment variables, falling back to
/// sensible defaults for local development.  Supports both the canonical
/// `POSTGRES_*` names and the short `PG_*` / `PG*` aliases.
fn postgres_form_from_env(host: &str, port: u16) -> ConnectionForm {
    ConnectionForm {
        driver: "postgres".to_string(),
        host: Some(shared::env_or_any(&["POSTGRES_HOST", "PG_HOST"], host)),
        port: Some(shared::env_i64_any(
            &["POSTGRES_PORT", "PG_PORT"],
            i64::from(port),
        )),
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
    }
}

/// Return a `ConnectionForm` backed by the shared PostgreSQL container for
/// this binary.  The container is started on first call; subsequent calls
/// reuse it.  Use this in the vast majority of tests.
pub fn shared_postgres_form() -> ConnectionForm {
    if should_reuse_local_db() {
        return postgres_form_from_env("localhost", 5432);
    }
    shared::ensure_docker_available();

    let (_container, form) = SHARED_CONTAINER.get_or_init(|| {
        let cli: &'static Cli = Box::leak(Box::new(Cli::default()));
        let runnable =
            postgres_image().with_container_name(shared::unique_container_name("postgres-shared"));
        let container: &'static Container<'static, GenericImage> =
            Box::leak(Box::new(cli.run(runnable)));
        let port = container.get_host_port_ipv4(5432);
        shared::wait_for_port("127.0.0.1", port, Duration::from_secs(45));
        (container, postgres_form_from_env("127.0.0.1", port))
    });
    form.clone()
}

/// Start an isolated PostgreSQL container and return it together with a
/// matching `ConnectionForm`.  Use only when the test itself needs to control
/// the container lifetime (e.g. to test behaviour after server shutdown).
#[allow(dead_code)]
pub fn postgres_form_from_test_context<'a>(
    docker: Option<&'a Cli>,
) -> (Option<Container<'a, GenericImage>>, ConnectionForm) {
    if should_reuse_local_db() {
        return (None, postgres_form_from_env("localhost", 5432));
    }
    shared::ensure_docker_available();

    let docker = docker.expect("docker client is required when IT_REUSE_LOCAL_DB is not set");
    let runnable = postgres_image().with_container_name(shared::unique_container_name("postgres"));
    let container = docker.run(runnable);
    let port = container.get_host_port_ipv4(5432);
    shared::wait_for_port("127.0.0.1", port, Duration::from_secs(45));
    (Some(container), postgres_form_from_env("127.0.0.1", port))
}

/// Poll the PostgreSQL server until it accepts connections or the retry limit
/// is reached.  Uses the driver layer directly for a fast, stack-level check.
#[allow(dead_code)]
pub async fn wait_until_ready(form: &ConnectionForm) {
    let driver = connect_with_retry(|| PostgresDriver::connect(form)).await;
    driver
        .test_connection()
        .await
        .expect("postgres should accept connections");
    driver.close().await;
}
