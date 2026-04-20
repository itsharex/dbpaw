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

#[allow(dead_code)]
pub const DEFAULT_MSSQL_SCHEMA: &str = "dbo";

static SHARED_CONTAINER: OnceLock<(&'static Container<'static, GenericImage>, ConnectionForm)> =
    OnceLock::new();

#[allow(dead_code)]
pub fn default_mssql_schema() -> String {
    DEFAULT_MSSQL_SCHEMA.to_string()
}

#[allow(dead_code)]
pub fn qualify_default_mssql_table(table: &str) -> String {
    format!(
        "[{}].[{}]",
        DEFAULT_MSSQL_SCHEMA,
        table.trim().replace(']', "]]")
    )
}

#[allow(dead_code)]
pub fn default_mssql_object_name(table: &str) -> String {
    format!("{}.{}", DEFAULT_MSSQL_SCHEMA, table.trim())
}

fn mssql_image() -> RunnableImage<GenericImage> {
    let image = GenericImage::new("mcr.microsoft.com/mssql/server", "2022-latest")
        .with_env_var("ACCEPT_EULA", "Y")
        .with_env_var("MSSQL_PID", "Developer")
        .with_env_var("MSSQL_SA_PASSWORD", "YourStrong!Passw0rd")
        .with_wait_for(WaitFor::seconds(20))
        .with_exposed_port(1433);
    RunnableImage::from(image)
}

fn mssql_form_from_env(host: &str, port: u16) -> ConnectionForm {
    ConnectionForm {
        driver: "mssql".to_string(),
        host: Some(shared::env_or("MSSQL_HOST", host)),
        port: Some(shared::env_i64("MSSQL_PORT", i64::from(port))),
        username: Some(shared::env_or("MSSQL_USER", "sa")),
        password: Some(shared::env_or("MSSQL_PASSWORD", "YourStrong!Passw0rd")),
        database: Some(shared::env_or("MSSQL_DB", "master")),
        ..Default::default()
    }
}

pub fn shared_mssql_form() -> ConnectionForm {
    if should_reuse_local_db() {
        return mssql_form_from_env("localhost", 1433);
    }
    shared::ensure_docker_available();

    let (_container, form) = SHARED_CONTAINER.get_or_init(|| {
        let cli: &'static Cli = Box::leak(Box::new(Cli::default()));
        let runnable =
            mssql_image().with_container_name(shared::unique_container_name("mssql-shared"));
        let container: &'static Container<'static, GenericImage> =
            Box::leak(Box::new(cli.run(runnable)));
        let port = container.get_host_port_ipv4(1433);
        shared::wait_for_port("127.0.0.1", port, Duration::from_secs(90));
        (container, mssql_form_from_env("127.0.0.1", port))
    });
    form.clone()
}

#[allow(dead_code)]
pub fn mssql_form_from_test_context<'a>(
    _docker: Option<&'a Cli>,
) -> (Option<Container<'a, GenericImage>>, ConnectionForm) {
    if should_reuse_local_db() {
        return (None, mssql_form_from_env("localhost", 1433));
    }
    shared::ensure_docker_available();

    let docker = Box::leak(Box::new(Cli::default()));
    let runnable = mssql_image().with_container_name(shared::unique_container_name("mssql"));
    let container = docker.run(runnable);
    let port = container.get_host_port_ipv4(1433);
    shared::wait_for_port("127.0.0.1", port, Duration::from_secs(90));
    (Some(container), mssql_form_from_env("127.0.0.1", port))
}

/// Poll the SQL Server until it accepts connections or the timeout expires.
/// MSSQL takes longer to start than other databases, so uses 60 retries.
#[allow(dead_code)]
pub async fn wait_until_ready(form: &ConnectionForm) {
    let mut last_error = String::new();
    for _ in 0..60 {
        match connection::test_connection_ephemeral(form.clone()).await {
            Ok(_) => return,
            Err(err) => {
                last_error = err;
                sleep(Duration::from_secs(1)).await;
            }
        }
    }
    panic!(
        "MSSQL at {}:{} did not become ready in time: {last_error}",
        form.host.as_deref().unwrap_or("?"),
        form.port.unwrap_or(1433)
    );
}
