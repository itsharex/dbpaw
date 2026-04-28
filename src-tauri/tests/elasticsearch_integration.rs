#[path = "common/elasticsearch_context.rs"]
mod elasticsearch_context;

use dbpaw_lib::datasources::elasticsearch::{build_base_url, ElasticsearchClient};
use serde_json::json;
use std::fs;
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
    let created = client
        .create_index(
            index.to_string(),
            Some(json!({
                "mappings": {
                    "properties": {
                        "title": { "type": "text" },
                        "status": { "type": "keyword" },
                        "count": { "type": "integer" }
                    }
                }
            })),
        )
        .await
        .expect("create index");
    assert_eq!(created.index.as_deref(), Some(index));
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

    let aggregation_search = client
        .search_documents(
            index.to_string(),
            None,
            Some(
                json!({
                    "size": 0,
                    "aggs": {
                        "by_status": {
                            "terms": { "field": "status" }
                        }
                    }
                })
                .to_string(),
            ),
            0,
            50,
        )
        .await
        .expect("search aggregations");
    assert_eq!(
        aggregation_search.aggregations.unwrap()["by_status"]["buckets"][0]["key"],
        "ok"
    );

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

    let import_index = "dbpaw_es_probe_imported";
    let _ = http
        .delete(format!("{base_url}/{import_index}"))
        .send()
        .await
        .expect("delete old import index");
    client
        .create_index(
            import_index.to_string(),
            Some(json!({
                "mappings": {
                    "properties": {
                        "title": { "type": "text" },
                        "status": { "type": "keyword" },
                        "count": { "type": "integer" }
                    }
                }
            })),
        )
        .await
        .expect("create import index");
    let export_path = std::env::temp_dir().join(format!(
        "dbpaw-es-export-{}.ndjson",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time")
            .as_nanos()
    ));
    let exported = client
        .export_documents(
            index.to_string(),
            None,
            None,
            export_path.to_string_lossy().to_string(),
            Some(1),
        )
        .await
        .expect("export documents");
    assert_eq!(exported.documents, 2);
    assert!(exported.batches >= 1);

    let imported = client
        .import_documents(
            import_index.to_string(),
            export_path.to_string_lossy().to_string(),
            Some(1),
            true,
        )
        .await
        .expect("import documents");
    assert_eq!(imported.total_actions, 2);
    assert_eq!(imported.successful, 2);
    assert_eq!(imported.failed, 0);

    let imported_count = client
        .execute_raw("GET".to_string(), format!("/{import_index}/_count"), None)
        .await
        .expect("count imported documents");
    assert_eq!(imported_count.json.unwrap()["count"], 2);
    let imported_document = client
        .get_document(import_index.to_string(), "1".to_string())
        .await
        .expect("get imported document");
    assert_eq!(imported_document.source.unwrap()["status"], "ok");

    let malformed_path = std::env::temp_dir().join("dbpaw-es-malformed.ndjson");
    fs::write(&malformed_path, "{\"delete\":{\"_id\":\"1\"}}\n{}\n")
        .expect("write malformed bulk file");
    assert!(client
        .import_documents(
            import_index.to_string(),
            malformed_path.to_string_lossy().to_string(),
            Some(1000),
            true,
        )
        .await
        .is_err());
    let _ = fs::remove_file(export_path);
    let _ = fs::remove_file(malformed_path);

    let deleted = client
        .delete_document(index.to_string(), "2".to_string(), true)
        .await
        .expect("delete document");
    assert_eq!(deleted.result.as_deref(), Some("deleted"));

    client
        .refresh_index(index.to_string())
        .await
        .expect("refresh index");
    client
        .close_index(index.to_string())
        .await
        .expect("close index");
    client
        .open_index(index.to_string())
        .await
        .expect("open index");
    client
        .delete_index(index.to_string())
        .await
        .expect("delete index");
    client
        .delete_index(import_index.to_string())
        .await
        .expect("delete import index");
    let indices_after_delete = client.list_indices().await.expect("list after delete");
    assert!(!indices_after_delete.iter().any(|item| item.name == index));
}
