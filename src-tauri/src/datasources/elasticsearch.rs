use crate::models::ConnectionForm;
use base64::{engine::general_purpose, Engine as _};
use reqwest::header::AUTHORIZATION;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{Duration, Instant};

const DEFAULT_ELASTICSEARCH_PORT: i64 = 9200;
const DEFAULT_CONNECT_TIMEOUT_MS: i64 = 5000;
const MAX_SEARCH_SIZE: i64 = 500;

#[derive(Clone)]
pub struct ElasticsearchClient {
    client: reqwest::Client,
    base_url: String,
    auth: ElasticsearchAuth,
}

#[derive(Clone)]
enum ElasticsearchAuth {
    None,
    Basic {
        username: String,
        password: Option<String>,
    },
    ApiKey(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElasticsearchConnectionInfo {
    pub cluster_name: Option<String>,
    pub cluster_uuid: Option<String>,
    pub version: Option<String>,
    pub tagline: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElasticsearchIndexInfo {
    pub name: String,
    pub health: Option<String>,
    pub status: Option<String>,
    pub uuid: Option<String>,
    pub primary_shards: Option<String>,
    pub replica_shards: Option<String>,
    pub docs_count: Option<i64>,
    pub store_size: Option<String>,
    pub is_system: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElasticsearchSearchHit {
    pub index: String,
    pub id: String,
    pub score: Option<f64>,
    pub source: Value,
    pub fields: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElasticsearchSearchResponse {
    pub hits: Vec<ElasticsearchSearchHit>,
    pub total: i64,
    pub took_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElasticsearchDocument {
    pub index: String,
    pub id: String,
    pub found: bool,
    pub source: Option<Value>,
    pub fields: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElasticsearchMutationResult {
    pub index: Option<String>,
    pub id: Option<String>,
    pub result: Option<String>,
    pub status: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElasticsearchRawResponse {
    pub status: u16,
    pub body: String,
    pub json: Option<Value>,
    pub took_ms: i64,
}

fn trim_to_option(value: Option<&String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .and_then(|v| if v.is_empty() { None } else { Some(v) })
}

fn parse_cloud_id(cloud_id: &str) -> Result<String, String> {
    let trimmed = cloud_id.trim();
    let encoded = trimmed
        .rsplit_once(':')
        .map(|(_, value)| value)
        .unwrap_or(trimmed);
    let decoded = general_purpose::STANDARD
        .decode(encoded)
        .or_else(|_| general_purpose::URL_SAFE_NO_PAD.decode(encoded))
        .map_err(|e| format!("[VALIDATION_ERROR] invalid Elasticsearch Cloud ID: {e}"))?;
    let decoded = String::from_utf8(decoded)
        .map_err(|e| format!("[VALIDATION_ERROR] invalid Elasticsearch Cloud ID UTF-8: {e}"))?;
    let mut parts = decoded.split('$');
    let base_domain = parts
        .next()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "[VALIDATION_ERROR] invalid Elasticsearch Cloud ID".to_string())?;
    let es_id = parts
        .next()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "[VALIDATION_ERROR] invalid Elasticsearch Cloud ID".to_string())?;
    Ok(format!(
        "https://{}.{}",
        es_id.trim().trim_end_matches('/'),
        base_domain.trim().trim_end_matches('/')
    ))
}

pub fn build_base_url(form: &ConnectionForm) -> Result<String, String> {
    if let Some(cloud_id) = trim_to_option(form.cloud_id.as_ref()) {
        return parse_cloud_id(&cloud_id);
    }
    let host = trim_to_option(form.host.as_ref())
        .ok_or_else(|| "[VALIDATION_ERROR] host cannot be empty".to_string())?;
    let port = form.port.unwrap_or(DEFAULT_ELASTICSEARCH_PORT);
    if !(1..=65535).contains(&port) {
        return Err("[VALIDATION_ERROR] port must be between 1 and 65535".to_string());
    }
    let scheme = if form.ssl.unwrap_or(false) {
        "https"
    } else {
        "http"
    };
    let trimmed = host
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .trim_end_matches('/');
    Ok(format!("{scheme}://{trimmed}:{port}"))
}

fn build_api_key(form: &ConnectionForm) -> Result<Option<String>, String> {
    if let Some(encoded) = trim_to_option(form.api_key_encoded.as_ref()) {
        return Ok(Some(encoded));
    }
    let id = trim_to_option(form.api_key_id.as_ref());
    let secret = trim_to_option(form.api_key_secret.as_ref());
    match (id, secret) {
        (Some(id), Some(secret)) => Ok(Some(general_purpose::STANDARD.encode(format!("{id}:{secret}")))),
        (Some(_), None) | (None, Some(_)) => Err(
            "[VALIDATION_ERROR] both apiKeyId and apiKeySecret are required for API key authentication"
                .to_string(),
        ),
        (None, None) => Ok(None),
    }
}

fn build_auth(form: &ConnectionForm) -> Result<ElasticsearchAuth, String> {
    let auth_mode = trim_to_option(form.auth_mode.as_ref()).unwrap_or_else(|| {
        if form
            .api_key_encoded
            .as_ref()
            .and_then(|v| trim_to_option(Some(v)))
            .is_some()
            || form
                .api_key_id
                .as_ref()
                .and_then(|v| trim_to_option(Some(v)))
                .is_some()
            || form
                .api_key_secret
                .as_ref()
                .and_then(|v| trim_to_option(Some(v)))
                .is_some()
        {
            "api_key".to_string()
        } else if form
            .username
            .as_ref()
            .and_then(|v| trim_to_option(Some(v)))
            .is_some()
        {
            "basic".to_string()
        } else {
            "none".to_string()
        }
    });

    match auth_mode.as_str() {
        "none" => Ok(ElasticsearchAuth::None),
        "basic" => {
            let username = trim_to_option(form.username.as_ref()).ok_or_else(|| {
                "[VALIDATION_ERROR] username is required for basic authentication".to_string()
            })?;
            Ok(ElasticsearchAuth::Basic {
                username,
                password: form.password.clone(),
            })
        }
        "api_key" => {
            let api_key = build_api_key(form)?.ok_or_else(|| {
                "[VALIDATION_ERROR] API key is required for API key authentication".to_string()
            })?;
            Ok(ElasticsearchAuth::ApiKey(api_key))
        }
        _ => Err("[VALIDATION_ERROR] unsupported Elasticsearch auth mode".to_string()),
    }
}

fn build_reqwest_client(form: &ConnectionForm, timeout_ms: i64) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(Duration::from_millis(timeout_ms as u64));
    if form.ssl.unwrap_or(false) {
        let ssl_mode =
            trim_to_option(form.ssl_mode.as_ref()).unwrap_or_else(|| "require".to_string());
        if ssl_mode == "verify_ca" {
            let ca_cert = trim_to_option(form.ssl_ca_cert.as_ref()).ok_or_else(|| {
                "[VALIDATION_ERROR] sslCaCert cannot be empty in verify_ca mode".to_string()
            })?;
            let cert = reqwest::Certificate::from_pem(ca_cert.as_bytes())
                .map_err(|e| format!("[VALIDATION_ERROR] invalid CA certificate: {e}"))?;
            builder = builder.add_root_certificate(cert);
        } else {
            builder = builder.danger_accept_invalid_certs(true);
        }
    }
    builder
        .build()
        .map_err(|e| format!("[ELASTICSEARCH_ERROR] failed to build client: {e}"))
}

fn normalize_error(status: StatusCode, body: &str) -> String {
    if let Ok(value) = serde_json::from_str::<Value>(body) {
        if let Some(reason) = value
            .pointer("/error/reason")
            .and_then(Value::as_str)
            .or_else(|| {
                value
                    .pointer("/error/root_cause/0/reason")
                    .and_then(Value::as_str)
            })
        {
            return format!("[ELASTICSEARCH_ERROR] HTTP {}: {}", status.as_u16(), reason);
        }
        if let Some(error_type) = value.pointer("/error/type").and_then(Value::as_str) {
            return format!(
                "[ELASTICSEARCH_ERROR] HTTP {}: {}",
                status.as_u16(),
                error_type
            );
        }
    }
    let compact = body.trim();
    if compact.is_empty() {
        format!("[ELASTICSEARCH_ERROR] HTTP {}", status.as_u16())
    } else {
        format!(
            "[ELASTICSEARCH_ERROR] HTTP {}: {}",
            status.as_u16(),
            compact
        )
    }
}

fn parse_docs_count(raw: Option<&str>) -> Option<i64> {
    raw.and_then(|v| v.parse::<i64>().ok())
}

fn clamp_search_size(size: i64) -> i64 {
    size.clamp(1, MAX_SEARCH_SIZE)
}

fn encode_path_segment(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn validate_raw_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("[VALIDATION_ERROR] request path cannot be empty".to_string());
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Err("[VALIDATION_ERROR] raw requests must use a path, not a full URL".to_string());
    }
    let path = if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    };
    if path.contains("..") {
        return Err("[VALIDATION_ERROR] request path cannot contain '..'".to_string());
    }
    Ok(path)
}

impl ElasticsearchClient {
    pub fn connect(form: &ConnectionForm) -> Result<Self, String> {
        let timeout_ms = form
            .connect_timeout_ms
            .unwrap_or(DEFAULT_CONNECT_TIMEOUT_MS);
        if timeout_ms <= 0 {
            return Err("[VALIDATION_ERROR] connect timeout must be greater than 0".to_string());
        }
        let client = build_reqwest_client(form, timeout_ms)?;
        Ok(Self {
            client,
            base_url: build_base_url(form)?,
            auth: build_auth(form)?,
        })
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let url = format!(
            "{}/{}",
            self.base_url.trim_end_matches('/'),
            path.trim_start_matches('/')
        );
        let req = self.client.request(method, url);
        match &self.auth {
            ElasticsearchAuth::None => req,
            ElasticsearchAuth::Basic { username, password } => {
                req.basic_auth(username, password.clone())
            }
            ElasticsearchAuth::ApiKey(api_key) => {
                req.header(AUTHORIZATION, format!("ApiKey {api_key}"))
            }
        }
    }

    async fn read_json(&self, req: reqwest::RequestBuilder) -> Result<Value, String> {
        let response = req
            .send()
            .await
            .map_err(|e| format!("[ELASTICSEARCH_ERROR] {e}"))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| format!("[ELASTICSEARCH_ERROR] {e}"))?;
        if !status.is_success() {
            return Err(normalize_error(status, &body));
        }
        serde_json::from_str::<Value>(&body)
            .map_err(|e| format!("[ELASTICSEARCH_ERROR] invalid JSON response: {e}"))
    }

    async fn read_mutation(
        &self,
        req: reqwest::RequestBuilder,
    ) -> Result<ElasticsearchMutationResult, String> {
        let response = req
            .send()
            .await
            .map_err(|e| format!("[ELASTICSEARCH_ERROR] {e}"))?;
        let status = response.status();
        let status_code = status.as_u16();
        let body = response
            .text()
            .await
            .map_err(|e| format!("[ELASTICSEARCH_ERROR] {e}"))?;
        if !status.is_success() {
            return Err(normalize_error(status, &body));
        }
        let value = serde_json::from_str::<Value>(&body).unwrap_or(Value::Null);
        Ok(ElasticsearchMutationResult {
            index: value
                .get("_index")
                .and_then(Value::as_str)
                .map(str::to_string),
            id: value.get("_id").and_then(Value::as_str).map(str::to_string),
            result: value
                .get("result")
                .and_then(Value::as_str)
                .map(str::to_string),
            status: status_code,
        })
    }

    pub async fn test_connection(&self) -> Result<ElasticsearchConnectionInfo, String> {
        let value = self
            .read_json(self.request(reqwest::Method::GET, "/"))
            .await?;
        Ok(ElasticsearchConnectionInfo {
            cluster_name: value
                .get("cluster_name")
                .and_then(Value::as_str)
                .map(str::to_string),
            cluster_uuid: value
                .get("cluster_uuid")
                .and_then(Value::as_str)
                .map(str::to_string),
            version: value
                .pointer("/version/number")
                .and_then(Value::as_str)
                .map(str::to_string),
            tagline: value
                .get("tagline")
                .and_then(Value::as_str)
                .map(str::to_string),
        })
    }

    pub async fn list_indices(&self) -> Result<Vec<ElasticsearchIndexInfo>, String> {
        let value = self
            .read_json(self.request(
                reqwest::Method::GET,
                "/_cat/indices?format=json&h=health,status,index,uuid,pri,rep,docs.count,store.size&s=index",
            ))
            .await?;
        let rows = value.as_array().cloned().unwrap_or_default();
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let name = row.get("index").and_then(Value::as_str)?.to_string();
                Some(ElasticsearchIndexInfo {
                    is_system: name.starts_with('.'),
                    name,
                    health: row
                        .get("health")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    status: row
                        .get("status")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    uuid: row.get("uuid").and_then(Value::as_str).map(str::to_string),
                    primary_shards: row.get("pri").and_then(Value::as_str).map(str::to_string),
                    replica_shards: row.get("rep").and_then(Value::as_str).map(str::to_string),
                    docs_count: parse_docs_count(row.get("docs.count").and_then(Value::as_str)),
                    store_size: row
                        .get("store.size")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                })
            })
            .collect())
    }

    pub async fn get_index_mapping(&self, index: String) -> Result<Value, String> {
        self.read_json(self.request(
            reqwest::Method::GET,
            &format!("/{}/_mapping", encode_path_segment(&index)),
        ))
        .await
    }

    pub async fn search_documents(
        &self,
        index: String,
        query: Option<String>,
        dsl: Option<String>,
        from: i64,
        size: i64,
    ) -> Result<ElasticsearchSearchResponse, String> {
        let mut body = if let Some(raw) = dsl.and_then(|v| {
            let trimmed = v.trim().to_string();
            (!trimmed.is_empty()).then_some(trimmed)
        }) {
            serde_json::from_str::<Value>(&raw)
                .map_err(|e| format!("[VALIDATION_ERROR] invalid Elasticsearch DSL JSON: {e}"))?
        } else if let Some(q) = query.and_then(|v| {
            let trimmed = v.trim().to_string();
            (!trimmed.is_empty()).then_some(trimmed)
        }) {
            serde_json::json!({ "query": { "query_string": { "query": q } } })
        } else {
            serde_json::json!({ "query": { "match_all": {} } })
        };

        if let Some(obj) = body.as_object_mut() {
            obj.insert("from".to_string(), Value::from(from.max(0)));
            obj.insert("size".to_string(), Value::from(clamp_search_size(size)));
        } else {
            return Err("[VALIDATION_ERROR] Elasticsearch DSL must be a JSON object".to_string());
        }

        let started = Instant::now();
        let value = self
            .read_json(
                self.request(
                    reqwest::Method::POST,
                    &format!("/{}/_search", encode_path_segment(&index)),
                )
                .json(&body),
            )
            .await?;
        let took_ms = value
            .get("took")
            .and_then(Value::as_i64)
            .unwrap_or_else(|| started.elapsed().as_millis() as i64);
        let total = match value.pointer("/hits/total") {
            Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
            Some(Value::Object(obj)) => obj.get("value").and_then(Value::as_i64).unwrap_or(0),
            _ => 0,
        };
        let hits = value
            .pointer("/hits/hits")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|hit| {
                Some(ElasticsearchSearchHit {
                    index: hit.get("_index")?.as_str()?.to_string(),
                    id: hit.get("_id")?.as_str()?.to_string(),
                    score: hit.get("_score").and_then(Value::as_f64),
                    source: hit.get("_source").cloned().unwrap_or(Value::Null),
                    fields: hit.get("fields").cloned(),
                })
            })
            .collect();
        Ok(ElasticsearchSearchResponse {
            hits,
            total,
            took_ms,
        })
    }

    pub async fn get_document(
        &self,
        index: String,
        document_id: String,
    ) -> Result<ElasticsearchDocument, String> {
        let value = self
            .read_json(self.request(
                reqwest::Method::GET,
                &format!(
                    "/{}/_doc/{}",
                    encode_path_segment(&index),
                    encode_path_segment(&document_id)
                ),
            ))
            .await?;
        Ok(ElasticsearchDocument {
            index: value
                .get("_index")
                .and_then(Value::as_str)
                .unwrap_or(&index)
                .to_string(),
            id: value
                .get("_id")
                .and_then(Value::as_str)
                .unwrap_or(&document_id)
                .to_string(),
            found: value.get("found").and_then(Value::as_bool).unwrap_or(true),
            source: value.get("_source").cloned(),
            fields: value.get("fields").cloned(),
        })
    }

    pub async fn upsert_document(
        &self,
        index: String,
        document_id: Option<String>,
        source: Value,
        refresh: bool,
    ) -> Result<ElasticsearchMutationResult, String> {
        if !source.is_object() {
            return Err("[VALIDATION_ERROR] document source must be a JSON object".to_string());
        }
        let refresh_query = if refresh { "?refresh=true" } else { "" };
        let (method, path) = match document_id.and_then(|v| {
            let trimmed = v.trim().to_string();
            (!trimmed.is_empty()).then_some(trimmed)
        }) {
            Some(id) => (
                reqwest::Method::PUT,
                format!(
                    "/{}/_doc/{}{}",
                    encode_path_segment(&index),
                    encode_path_segment(&id),
                    refresh_query
                ),
            ),
            None => (
                reqwest::Method::POST,
                format!("/{}/_doc{}", encode_path_segment(&index), refresh_query),
            ),
        };
        self.read_mutation(self.request(method, &path).json(&source))
            .await
    }

    pub async fn delete_document(
        &self,
        index: String,
        document_id: String,
        refresh: bool,
    ) -> Result<ElasticsearchMutationResult, String> {
        let id = document_id.trim();
        if id.is_empty() {
            return Err("[VALIDATION_ERROR] document id cannot be empty".to_string());
        }
        let refresh_query = if refresh { "?refresh=true" } else { "" };
        self.read_mutation(self.request(
            reqwest::Method::DELETE,
            &format!(
                "/{}/_doc/{}{}",
                encode_path_segment(&index),
                encode_path_segment(id),
                refresh_query
            ),
        ))
        .await
    }

    pub async fn execute_raw(
        &self,
        method: String,
        path: String,
        body: Option<String>,
    ) -> Result<ElasticsearchRawResponse, String> {
        let method = match method.trim().to_ascii_uppercase().as_str() {
            "GET" => reqwest::Method::GET,
            "POST" => reqwest::Method::POST,
            "PUT" => reqwest::Method::PUT,
            "DELETE" => reqwest::Method::DELETE,
            "PATCH" => reqwest::Method::PATCH,
            _ => {
                return Err(
                    "[VALIDATION_ERROR] method must be one of GET, POST, PUT, DELETE, PATCH"
                        .to_string(),
                )
            }
        };
        let path = validate_raw_path(&path)?;
        let mut req = self.request(method, &path);
        if let Some(raw) = body.and_then(|v| {
            let trimmed = v.trim().to_string();
            (!trimmed.is_empty()).then_some(trimmed)
        }) {
            let json = serde_json::from_str::<Value>(&raw)
                .map_err(|e| format!("[VALIDATION_ERROR] invalid JSON body: {e}"))?;
            req = req.json(&json);
        }

        let started = Instant::now();
        let response = req
            .send()
            .await
            .map_err(|e| format!("[ELASTICSEARCH_ERROR] {e}"))?;
        let status = response.status();
        let status_code = status.as_u16();
        let text = response
            .text()
            .await
            .map_err(|e| format!("[ELASTICSEARCH_ERROR] {e}"))?;
        if !status.is_success() {
            return Err(normalize_error(status, &text));
        }
        Ok(ElasticsearchRawResponse {
            status: status_code,
            json: serde_json::from_str::<Value>(&text).ok(),
            body: text,
            took_ms: started.elapsed().as_millis() as i64,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_api_key, build_base_url, build_reqwest_client, clamp_search_size, normalize_error,
        validate_raw_path,
    };
    use crate::models::ConnectionForm;
    use base64::{engine::general_purpose, Engine as _};
    use reqwest::StatusCode;

    #[test]
    fn build_base_url_uses_http_by_default() {
        let form = ConnectionForm {
            driver: "elasticsearch".to_string(),
            host: Some(" localhost ".to_string()),
            port: Some(9201),
            ..Default::default()
        };
        assert_eq!(build_base_url(&form).unwrap(), "http://localhost:9201");
    }

    #[test]
    fn build_base_url_strips_scheme_and_uses_https_when_ssl_enabled() {
        let form = ConnectionForm {
            driver: "elasticsearch".to_string(),
            host: Some("http://es.local/".to_string()),
            port: None,
            ssl: Some(true),
            ..Default::default()
        };
        assert_eq!(build_base_url(&form).unwrap(), "https://es.local:9200");
    }

    #[test]
    fn build_base_url_uses_cloud_id_when_present() {
        let encoded = general_purpose::STANDARD.encode("example.es.io$abc123$kibana123");
        let form = ConnectionForm {
            driver: "elasticsearch".to_string(),
            host: Some("ignored.local".to_string()),
            port: Some(9200),
            cloud_id: Some(format!("deployment:{encoded}")),
            ..Default::default()
        };
        assert_eq!(
            build_base_url(&form).unwrap(),
            "https://abc123.example.es.io"
        );
    }

    #[test]
    fn build_base_url_rejects_invalid_cloud_id() {
        let form = ConnectionForm {
            driver: "elasticsearch".to_string(),
            cloud_id: Some("not-base64".to_string()),
            ..Default::default()
        };
        assert!(build_base_url(&form).is_err());
    }

    #[test]
    fn build_api_key_supports_encoded_and_id_secret() {
        let encoded_form = ConnectionForm {
            driver: "elasticsearch".to_string(),
            api_key_encoded: Some("already-encoded".to_string()),
            ..Default::default()
        };
        assert_eq!(
            build_api_key(&encoded_form).unwrap().as_deref(),
            Some("already-encoded")
        );

        let split_form = ConnectionForm {
            driver: "elasticsearch".to_string(),
            api_key_id: Some("id".to_string()),
            api_key_secret: Some("secret".to_string()),
            ..Default::default()
        };
        assert_eq!(
            build_api_key(&split_form).unwrap().as_deref(),
            Some(general_purpose::STANDARD.encode("id:secret").as_str())
        );
    }

    #[test]
    fn verify_ca_requires_certificate() {
        let form = ConnectionForm {
            driver: "elasticsearch".to_string(),
            host: Some("localhost".to_string()),
            ssl: Some(true),
            ssl_mode: Some("verify_ca".to_string()),
            ..Default::default()
        };
        assert!(build_reqwest_client(&form, 5000).is_err());
    }

    #[test]
    fn normalize_error_prefers_elasticsearch_reason() {
        let body = r#"{"error":{"reason":"bad query","type":"search_phase_execution_exception"}}"#;
        let err = normalize_error(StatusCode::BAD_REQUEST, body);
        assert!(err.contains("HTTP 400"));
        assert!(err.contains("bad query"));
    }

    #[test]
    fn clamp_search_size_bounds_values() {
        assert_eq!(clamp_search_size(0), 1);
        assert_eq!(clamp_search_size(50), 50);
        assert_eq!(clamp_search_size(1000), 500);
    }

    #[test]
    fn encode_path_segment_escapes_reserved_characters() {
        assert_eq!(super::encode_path_segment("a/b c"), "a%2Fb%20c");
    }

    #[test]
    fn validate_raw_path_rejects_full_urls() {
        assert!(validate_raw_path("https://example.com/_search").is_err());
        assert_eq!(
            validate_raw_path("_cluster/health").unwrap(),
            "/_cluster/health"
        );
    }
}
