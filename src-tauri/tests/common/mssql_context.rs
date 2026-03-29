mod shared;

use dbpaw_lib::models::ConnectionForm;
use std::env;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::Duration;
use testcontainers::clients::Cli;
use testcontainers::core::WaitFor;
use testcontainers::{Container, GenericImage, RunnableImage};

pub use shared::{connect_with_retry, should_reuse_local_db};

struct SharedMssql {
    container: Mutex<Option<Container<'static, GenericImage>>>,
    form: ConnectionForm,
    ref_count: AtomicUsize,
}

pub struct MssqlContainerGuard {
    shared: &'static SharedMssql,
}

impl Drop for MssqlContainerGuard {
    fn drop(&mut self) {
        if self.shared.ref_count.fetch_sub(1, Ordering::AcqRel) == 1 {
            let mut container = self
                .shared
                .container
                .lock()
                .expect("mssql container mutex poisoned");
            let _ = container.take();
        }
    }
}

static MSSQL_SHARED: OnceLock<SharedMssql> = OnceLock::new();

pub fn mssql_form_from_test_context(
    docker: Option<&Cli>,
) -> (Option<MssqlContainerGuard>, ConnectionForm) {
    let _ = docker;
    if should_reuse_local_db() {
        return (None, mssql_form_from_local_env());
    }
    shared::ensure_docker_available();

    let shared = MSSQL_SHARED.get_or_init(|| {
        let docker = Box::leak(Box::new(Cli::default()));
        let image = GenericImage::new("mcr.microsoft.com/mssql/server", "2022-latest")
            .with_env_var("ACCEPT_EULA", "Y")
            .with_env_var("MSSQL_PID", "Developer")
            .with_env_var("MSSQL_SA_PASSWORD", "YourStrong!Passw0rd")
            .with_wait_for(WaitFor::seconds(20))
            .with_exposed_port(1433);
        let runnable =
            RunnableImage::from(image).with_container_name(shared::unique_container_name("mssql"));
        let container = docker.run(runnable);
        let port = container.get_host_port_ipv4(1433);

        shared::wait_for_port("127.0.0.1", port, Duration::from_secs(90));

        let mut form = ConnectionForm {
            driver: "mssql".to_string(),
            host: Some("127.0.0.1".to_string()),
            port: Some(i64::from(port)),
            username: Some("sa".to_string()),
            password: Some("YourStrong!Passw0rd".to_string()),
            database: Some("master".to_string()),
            ..Default::default()
        };
        apply_mssql_env_overrides(&mut form);
        SharedMssql {
            container: Mutex::new(Some(container)),
            form,
            ref_count: AtomicUsize::new(0),
        }
    });
    shared.ref_count.fetch_add(1, Ordering::AcqRel);

    (Some(MssqlContainerGuard { shared }), shared.form.clone())
}

fn mssql_form_from_local_env() -> ConnectionForm {
    let mut form = ConnectionForm {
        driver: "mssql".to_string(),
        host: Some(shared::env_or("MSSQL_HOST", "localhost")),
        port: Some(shared::env_i64("MSSQL_PORT", 1433)),
        username: Some(shared::env_or("MSSQL_USER", "sa")),
        password: Some(shared::env_or("MSSQL_PASSWORD", "")),
        database: Some(shared::env_or("MSSQL_DB", "master")),
        ..Default::default()
    };
    apply_mssql_env_overrides(&mut form);
    form
}

fn apply_mssql_env_overrides(form: &mut ConnectionForm) {
    if let Ok(host) = env::var("MSSQL_HOST") {
        form.host = Some(host);
    }
    if let Ok(port) = env::var("MSSQL_PORT") {
        form.port = Some(
            port.parse::<i64>()
                .expect("MSSQL_PORT should be a valid number"),
        );
    }
    if let Ok(user) = env::var("MSSQL_USER") {
        form.username = Some(user);
    }
    if let Ok(password) = env::var("MSSQL_PASSWORD") {
        form.password = Some(password);
    }
    if let Ok(database) = env::var("MSSQL_DB") {
        form.database = Some(database);
    }
}
