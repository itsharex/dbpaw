mod shared;

use dbpaw_lib::models::ConnectionForm;
use std::env;
use std::time::Duration;
use testcontainers::clients::Cli;
use testcontainers::core::WaitFor;
use testcontainers::{Container, GenericImage, RunnableImage};

#[allow(unused_imports)]
pub use shared::{connect_with_retry, should_reuse_local_db};

pub fn doris_form_from_test_context<'a>(
    docker: Option<&'a Cli>,
) -> (Option<Container<'a, GenericImage>>, ConnectionForm) {
    if should_reuse_local_db() {
        return (None, doris_form_from_local_env());
    }
    shared::ensure_docker_available();

    let docker = docker.expect("docker client is required when IT_REUSE_LOCAL_DB is not enabled");
    let image = GenericImage::new("apache/doris", "doris-all-in-one-2.1.7")
        .with_wait_for(WaitFor::seconds(25))
        .with_exposed_port(9030);
    let runnable =
        RunnableImage::from(image).with_container_name(shared::unique_container_name("doris"));
    let container = docker.run(runnable);
    let port = container.get_host_port_ipv4(9030);

    shared::wait_for_port("127.0.0.1", port, Duration::from_secs(180));

    let mut form = ConnectionForm {
        driver: "doris".to_string(),
        host: Some("127.0.0.1".to_string()),
        port: Some(i64::from(port)),
        username: Some("root".to_string()),
        password: Some(String::new()),
        ..Default::default()
    };
    apply_doris_env_overrides(&mut form);
    (Some(container), form)
}

fn doris_form_from_local_env() -> ConnectionForm {
    let mut form = ConnectionForm {
        driver: "doris".to_string(),
        host: Some(shared::env_or("DORIS_HOST", "localhost")),
        port: Some(shared::env_i64("DORIS_PORT", 9030)),
        username: Some(shared::env_or("DORIS_USER", "root")),
        password: Some(shared::env_or("DORIS_PASSWORD", "")),
        database: env::var("DORIS_DB").ok(),
        ..Default::default()
    };
    apply_doris_env_overrides(&mut form);
    form
}

fn apply_doris_env_overrides(form: &mut ConnectionForm) {
    if let Ok(host) = env::var("DORIS_HOST") {
        form.host = Some(host);
    }
    if let Ok(port) = env::var("DORIS_PORT") {
        form.port = Some(
            port.parse::<i64>()
                .expect("DORIS_PORT should be a valid number"),
        );
    }
    if let Ok(user) = env::var("DORIS_USER") {
        form.username = Some(user);
    }
    if let Ok(password) = env::var("DORIS_PASSWORD") {
        form.password = Some(password);
    }
    if let Ok(database) = env::var("DORIS_DB") {
        form.database = Some(database);
    }
}
