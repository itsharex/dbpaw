#[path = "common/elasticsearch_context.rs"]
mod elasticsearch_context;

use dbpaw_lib::datasources::elasticsearch::{build_base_url, ElasticsearchClient};
use serde_json::json;
use testcontainers::clients::Cli;

#[tokio::test]
#[ignore]
async fn test_elasticsearch_read_only_flow() {
    let docker = (!elasticsearch_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) =
        elasticsearch_context::elasticsearch_form_from_test_context(docker.as_ref());
    let client = ElasticsearchClient::connect(&form).expect("connect client");
    let base_url = build_base_url(&form).expect("base url");
    let http = reqwest::Client::new();
    let index = "dbpaw_es_probe";

    let _ = http
        .delete(format!("{base_url}/{index}"))
        .send()
        .await
        .expect("delete old index");
    http.put(format!("{base_url}/{index}"))
        .json(&json!({
            "mappings": {
                "properties": {
                    "title": { "type": "text" },
                    "status": { "type": "keyword" },
                    "count": { "type": "integer" }
                }
            }
        }))
        .send()
        .await
        .expect("create index")
        .error_for_status()
        .expect("create index status");
    http.post(format!("{base_url}/{index}/_doc/1?refresh=true"))
        .json(&json!({
            "title": "DbPaw Elasticsearch probe",
            "status": "ok",
            "count": 42
        }))
        .send()
        .await
        .expect("index document")
        .error_for_status()
        .expect("index document status");

    let info = client.test_connection().await.expect("test connection");
    assert!(info.version.is_some(), "version should be present");

    let indices = client.list_indices().await.expect("list indices");
    assert!(indices.iter().any(|item| item.name == index));

    let mapping = client
        .get_index_mapping(index.to_string())
        .await
        .expect("get mapping");
    assert!(
        mapping.get(index).is_some(),
        "mapping should include test index"
    );

    let upsert = client
        .upsert_document(
            index.to_string(),
            Some("2".to_string()),
            json!({
                "title": "DbPaw edited probe",
                "status": "ok",
                "count": 7
            }),
            true,
        )
        .await
        .expect("upsert document");
    assert_eq!(upsert.id.as_deref(), Some("2"));

    let search = client
        .search_documents(
            index.to_string(),
            Some("status:ok".to_string()),
            None,
            0,
            50,
        )
        .await
        .expect("search documents");
    assert_eq!(search.total, 2);
    assert!(search.hits.iter().any(|hit| hit.id == "1"));
    assert!(search.hits.iter().any(|hit| hit.id == "2"));

    let document = client
        .get_document(index.to_string(), "1".to_string())
        .await
        .expect("get document");
    assert!(document.found);
    assert_eq!(document.source.unwrap()["status"], "ok");

    let raw = client
        .execute_raw("GET".to_string(), format!("/{index}/_count"), None)
        .await
        .expect("execute raw");
    assert_eq!(raw.status, 200);
    assert_eq!(raw.json.unwrap()["count"], 2);

    let deleted = client
        .delete_document(index.to_string(), "2".to_string(), true)
        .await
        .expect("delete document");
    assert_eq!(deleted.result.as_deref(), Some("deleted"));

    let _ = http.delete(format!("{base_url}/{index}")).send().await;
}
