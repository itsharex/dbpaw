mod shared;

use dbpaw_lib::models::ConnectionForm;
use std::time::Duration;
use testcontainers::clients::Cli;
use testcontainers::core::WaitFor;
use testcontainers::{Container, GenericImage, RunnableImage};

pub use shared::should_reuse_local_db;

pub fn elasticsearch_form_from_test_context<'a>(
    docker: Option<&'a Cli>,
) -> (Option<Container<'a, GenericImage>>, ConnectionForm) {
    if should_reuse_local_db() {
        return (None, elasticsearch_form_from_local_env());
    }
    shared::ensure_docker_available();

    let docker = docker.expect("docker client is required when IT_REUSE_LOCAL_DB is not enabled");
    let image = GenericImage::new("docker.elastic.co/elasticsearch/elasticsearch", "8.13.4")
        .with_env_var("discovery.type", "single-node")
        .with_env_var("xpack.security.enabled", "false")
        .with_env_var("ES_JAVA_OPTS", "-Xms512m -Xmx512m")
        .with_wait_for(WaitFor::seconds(20))
        .with_exposed_port(9200);
    let runnable = RunnableImage::from(image)
        .with_container_name(shared::unique_container_name("elasticsearch"));
    let container = docker.run(runnable);
    let port = container.get_host_port_ipv4(9200);
    shared::wait_for_port("127.0.0.1", port, Duration::from_secs(90));

    (
        Some(container),
        ConnectionForm {
            driver: "elasticsearch".to_string(),
            host: Some("127.0.0.1".to_string()),
            port: Some(i64::from(port)),
            ..Default::default()
        },
    )
}

fn elasticsearch_form_from_local_env() -> ConnectionForm {
    ConnectionForm {
        driver: "elasticsearch".to_string(),
        host: Some(shared::env_or("ELASTICSEARCH_HOST", "127.0.0.1")),
        port: Some(shared::env_i64("ELASTICSEARCH_PORT", 9200)),
        username: std::env::var("ELASTICSEARCH_USER").ok(),
        password: std::env::var("ELASTICSEARCH_PASSWORD").ok(),
        auth_mode: std::env::var("ELASTICSEARCH_AUTH_MODE").ok(),
        api_key_id: std::env::var("ELASTICSEARCH_API_KEY_ID").ok(),
        api_key_secret: std::env::var("ELASTICSEARCH_API_KEY_SECRET").ok(),
        api_key_encoded: std::env::var("ELASTICSEARCH_API_KEY_ENCODED").ok(),
        cloud_id: std::env::var("ELASTICSEARCH_CLOUD_ID").ok(),
        ssl: Some(
            std::env::var("ELASTICSEARCH_SSL")
                .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
                .unwrap_or(false),
        ),
        ssl_mode: std::env::var("ELASTICSEARCH_SSL_MODE").ok(),
        ssl_ca_cert: std::env::var("ELASTICSEARCH_CA_CERT").ok(),
        ..Default::default()
    }
}
