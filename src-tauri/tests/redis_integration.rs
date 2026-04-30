#[path = "common/redis_context.rs"]
mod redis_context;

use dbpaw_lib::datasources::redis;
use dbpaw_lib::datasources::redis::{
    RedisKeyPatchPayload, RedisSetKeyPayload, RedisSetOperation, RedisStreamEntry, RedisValue,
    RedisZRangeByScoreResult, RedisZSetMember,
};
use std::collections::BTreeMap;

// ── helpers ──────────────────────────────────────────────────────────────────

fn noauth() -> dbpaw_lib::models::ConnectionForm {
    redis_context::shared_redis_noauth_form()
}

fn auth() -> dbpaw_lib::models::ConnectionForm {
    redis_context::shared_redis_auth_form()
}

async fn cleanup(form: &dbpaw_lib::models::ConnectionForm, key: &str) {
    if let Ok(mut conn) = redis::connect(form, None).await {
        let _ = redis::delete_key(&mut conn, key.to_string()).await;
    }
}

// ── connection tests ──────────────────────────────────────────────────────────

#[tokio::test]
async fn noauth_ping() {
    let form = noauth();
    let mut conn = redis::connect(&form, None).await.expect("connect failed");
    let result = redis::ping(&mut conn).await;
    assert!(result.is_ok(), "no-auth ping failed: {:?}", result.err());
}

#[tokio::test]
async fn auth_ping() {
    let form = auth();
    let mut conn = redis::connect(&form, None).await.expect("connect failed");
    let result = redis::ping(&mut conn).await;
    assert!(result.is_ok(), "auth ping failed: {:?}", result.err());
}

#[tokio::test]
async fn list_databases_standalone() {
    let form = noauth();
    let dbs = redis::list_databases(&form, 16).unwrap();
    assert_eq!(dbs.len(), 16, "expected 16 databases for standalone");
    assert!(
        dbs.iter().any(|d| d.selected),
        "no database marked selected"
    );
}

// ── scan tests ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn scan_keys_cursor_works() {
    let form = noauth();
    let prefix = redis_context::unique_name("scan_test");

    let mut conn = redis::connect(&form, None).await.unwrap();
    for i in 0..150u32 {
        let payload = RedisSetKeyPayload {
            key: format!("{prefix}:{i}"),
            value: RedisValue::String(format!("v{i}")),
            ttl_seconds: Some(60),
            set_nx: None,
            set_xx: None,
            set_px: None,
            set_keepttl: None,
        };
        redis::set_key(&mut conn, payload).await.unwrap();
    }

    let mut all_keys = Vec::new();
    let mut cursor = "0".to_string();
    let mut rounds = 0;
    loop {
        let resp = redis::scan_keys(
            &mut conn,
            Some(cursor.clone()),
            Some(format!("{prefix}:*")),
            Some(50),
        )
        .await
        .unwrap();
        all_keys.extend(resp.keys.iter().map(|k| k.key.clone()));
        cursor = resp.cursor.clone();
        rounds += 1;
        if cursor == "0" {
            break;
        }
        assert!(rounds < 50, "cursor loop did not terminate");
    }
    assert_eq!(all_keys.len(), 150, "expected 150 keys after full scan");

    for i in 0..150u32 {
        cleanup(&form, &format!("{prefix}:{i}")).await;
    }
}

// ── CRUD: string ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn crud_string() {
    let form = noauth();
    let key = redis_context::unique_name("crud_string");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::String("hello".to_string()),
        ttl_seconds: None,
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload).await.unwrap();

    let got = redis::get_key(&mut conn, key.clone()).await.unwrap();
    assert_eq!(got.key_type, "string");
    assert!(matches!(&got.value, RedisValue::String(v) if v == "hello"));
    assert_eq!(got.value_total_len, None);

    let payload2 = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::String("world".to_string()),
        ttl_seconds: None,
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload2).await.unwrap();
    let got2 = redis::get_key(&mut conn, key.clone()).await.unwrap();
    assert!(matches!(&got2.value, RedisValue::String(v) if v == "world"));

    let del = redis::delete_key(&mut conn, key.clone()).await.unwrap();
    assert_eq!(del.affected, 1);
    let gone = redis::get_key(&mut conn, key).await.unwrap();
    assert_eq!(gone.key_type, "none");
}

// ── CRUD: hash ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn crud_hash() {
    let form = noauth();
    let key = redis_context::unique_name("crud_hash");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let mut fields = BTreeMap::new();
    fields.insert("f1".to_string(), "v1".to_string());
    fields.insert("f2".to_string(), "v2".to_string());
    fields.insert("f3".to_string(), "v3".to_string());

    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::Hash(fields),
        ttl_seconds: Some(60),
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload).await.unwrap();

    let got = redis::get_key(&mut conn, key.clone()).await.unwrap();
    assert_eq!(got.key_type, "hash");
    assert_eq!(got.value_total_len, Some(3));
    if let RedisValue::Hash(map) = &got.value {
        assert_eq!(map.get("f1").map(String::as_str), Some("v1"));
    } else {
        panic!("expected Hash");
    }

    cleanup(&form, &key).await;
}

#[tokio::test]
async fn crud_hash_pagination_uses_scan_cursor() {
    let form = noauth();
    let key = redis_context::unique_name("crud_hash_page");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let fields: BTreeMap<String, String> = (0..3000)
        .map(|i| (format!("f{i}"), format!("v{i}")))
        .collect();

    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::Hash(fields),
        ttl_seconds: Some(60),
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload).await.unwrap();

    let first = redis::get_key(&mut conn, key.clone()).await.unwrap();
    assert_eq!(first.value_total_len, Some(3000));
    assert!(first.value_offset != 0, "expected non-zero HSCAN cursor");

    let second = redis::get_key_page(&mut conn, key.clone(), first.value_offset, 200)
        .await
        .unwrap();
    assert_eq!(second.value_total_len, Some(3000));
    assert!(
        matches!(&second.value, RedisValue::Hash(v) if !v.is_empty()),
        "expected a non-empty second hash page"
    );

    cleanup(&form, &key).await;
}

// ── CRUD: list ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn crud_list_pagination() {
    let form = noauth();
    let key = redis_context::unique_name("crud_list");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let items: Vec<String> = (0..300).map(|i| format!("item{i}")).collect();
    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::List(items),
        ttl_seconds: Some(120),
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload).await.unwrap();

    let first = redis::get_key(&mut conn, key.clone()).await.unwrap();
    assert_eq!(first.value_total_len, Some(300));
    let first_count = if let RedisValue::List(v) = &first.value {
        v.len()
    } else {
        panic!("expected list");
    };
    assert_eq!(first_count, 200);

    let page2 = redis::get_key_page(&mut conn, key.clone(), 200, 200)
        .await
        .unwrap();
    assert_eq!(page2.value_total_len, Some(300));
    let page2_count = if let RedisValue::List(v) = &page2.value {
        v.len()
    } else {
        panic!("expected list");
    };
    assert_eq!(page2_count, 100);

    cleanup(&form, &key).await;
}

// ── CRUD: set ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn crud_set_pagination() {
    let form = noauth();
    let key = redis_context::unique_name("crud_set");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let members: Vec<String> = (0..250).map(|i| format!("m{i}")).collect();
    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::Set(members),
        ttl_seconds: Some(120),
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload).await.unwrap();

    let first = redis::get_key(&mut conn, key.clone()).await.unwrap();
    assert_eq!(first.value_total_len, Some(250));

    let page = redis::get_key_page(&mut conn, key.clone(), 0, 100)
        .await
        .unwrap();
    assert_eq!(page.value_total_len, Some(250));
    assert!(
        matches!(&page.value, RedisValue::Set(v) if !v.is_empty()),
        "expected non-empty set page"
    );

    cleanup(&form, &key).await;
}

#[tokio::test]
async fn crud_set_initial_page_exposes_scan_cursor() {
    let form = noauth();
    let key = redis_context::unique_name("crud_set_cursor");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let members: Vec<String> = (0..250).map(|i| format!("m{i}")).collect();
    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::Set(members),
        ttl_seconds: Some(120),
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload).await.unwrap();

    let first = redis::get_key(&mut conn, key.clone()).await.unwrap();
    assert_eq!(first.value_total_len, Some(250));
    assert!(first.value_offset != 0, "expected non-zero SSCAN cursor");

    let page = redis::get_key_page(&mut conn, key.clone(), first.value_offset, 100)
        .await
        .unwrap();
    assert!(
        matches!(&page.value, RedisValue::Set(v) if !v.is_empty()),
        "expected non-empty set page"
    );

    cleanup(&form, &key).await;
}

// ── CRUD: zset ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn crud_zset_pagination() {
    let form = noauth();
    let key = redis_context::unique_name("crud_zset");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let members: Vec<RedisZSetMember> = (0..300)
        .map(|i| RedisZSetMember {
            member: format!("z{i}"),
            score: i as f64,
        })
        .collect();
    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::ZSet(members),
        ttl_seconds: Some(120),
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload).await.unwrap();

    let first = redis::get_key(&mut conn, key.clone()).await.unwrap();
    assert_eq!(first.value_total_len, Some(300));
    let first_len = if let RedisValue::ZSet(v) = &first.value {
        v.len()
    } else {
        panic!("expected zset");
    };
    assert_eq!(first_len, 200);

    let page2 = redis::get_key_page(&mut conn, key.clone(), 200, 200)
        .await
        .unwrap();
    assert_eq!(page2.value_total_len, Some(300));
    let page2_len = if let RedisValue::ZSet(v) = &page2.value {
        v.len()
    } else {
        panic!("expected zset");
    };
    assert_eq!(page2_len, 100);

    cleanup(&form, &key).await;
}

// ── rename ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn rename_key() {
    let form = noauth();
    let old = redis_context::unique_name("rename_old");
    let new = redis_context::unique_name("rename_new");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let payload = RedisSetKeyPayload {
        key: old.clone(),
        value: RedisValue::String("data".to_string()),
        ttl_seconds: Some(60),
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload).await.unwrap();

    redis::rename_key(&mut conn, old.clone(), new.clone(), false)
        .await
        .unwrap();

    let gone = redis::get_key(&mut conn, old).await.unwrap();
    assert_eq!(gone.key_type, "none", "old key should be gone");

    let present = redis::get_key(&mut conn, new.clone()).await.unwrap();
    assert_eq!(present.key_type, "string", "new key should exist");

    cleanup(&form, &new).await;
}

// ── TTL ───────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn set_ttl_and_persist() {
    let form = noauth();
    let key = redis_context::unique_name("ttl_test");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::String("ephemeral".to_string()),
        ttl_seconds: None,
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload).await.unwrap();

    redis::set_ttl(&mut conn, key.clone(), Some(3600))
        .await
        .unwrap();
    let got = redis::get_key(&mut conn, key.clone()).await.unwrap();
    assert!(got.ttl > 0, "expected positive TTL after EXPIRE");

    redis::set_ttl(&mut conn, key.clone(), None).await.unwrap();
    let got2 = redis::get_key(&mut conn, key.clone()).await.unwrap();
    assert_eq!(got2.ttl, -1, "expected -1 (no expiry) after PERSIST");

    cleanup(&form, &key).await;
}

// ── cluster ───────────────────────────────────────────────────────────────────

/// Requires REDIS_CLUSTER_HOSTS=<host1>,<host2>,...
#[tokio::test]
async fn cluster_scan_is_partial() {
    let form = match redis_context::shared_redis_cluster_form() {
        Some(f) => f,
        None => {
            eprintln!("[skip] REDIS_CLUSTER_HOSTS not set; skipping cluster test");
            return;
        }
    };
    let prefix = redis_context::unique_name("cluster_scan");
    let mut conn = redis::connect(&form, None).await.unwrap();

    // Seed enough keys across the cluster so a single SCAN round cannot finish
    for i in 0..300u32 {
        let payload = RedisSetKeyPayload {
            key: format!("{prefix}:{i}"),
            value: RedisValue::String(format!("v{i}")),
            ttl_seconds: Some(60),
            set_nx: None,
            set_xx: None,
            set_px: None,
            set_keepttl: None,
        };
        redis::set_key(&mut conn, payload).await.unwrap();
    }

    let resp = redis::scan_keys(&mut conn, None, Some(format!("{prefix}:*")), Some(10))
        .await
        .unwrap();
    assert!(
        resp.is_partial,
        "cluster scan with many keys should set is_partial"
    );
    assert!(
        !resp.cursor.is_empty(),
        "cluster scan cursor should not be empty"
    );

    // Continue scanning until all nodes are exhausted
    let mut cursor = resp.cursor;
    let mut rounds = 0;
    loop {
        let r = redis::scan_keys(
            &mut conn,
            Some(cursor.clone()),
            Some(format!("{prefix}:*")),
            Some(10),
        )
        .await
        .unwrap();
        cursor = r.cursor;
        rounds += 1;
        if !r.is_partial {
            break;
        }
        assert!(rounds < 100, "cluster scan did not terminate");
    }

    // Cleanup
    for i in 0..300u32 {
        cleanup(&form, &format!("{prefix}:{i}")).await;
    }
}

#[tokio::test]
async fn cluster_scan_requires_narrow_pattern() {
    let form = match redis_context::shared_redis_cluster_form() {
        Some(f) => f,
        None => {
            eprintln!("[skip] REDIS_CLUSTER_HOSTS not set; skipping cluster test");
            return;
        }
    };
    let mut conn = redis::connect(&form, None).await.unwrap();
    let err = redis::scan_keys(&mut conn, None, Some("*".to_string()), Some(10))
        .await
        .unwrap_err();
    assert!(
        err.contains("requires a non-wildcard pattern"),
        "unexpected error: {err}"
    );
}

// ── CRUD: stream ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn crud_stream() {
    let form = noauth();
    let key = redis_context::unique_name("crud_stream");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let mut fields = BTreeMap::new();
    fields.insert("f1".to_string(), "v1".to_string());
    fields.insert("f2".to_string(), "v2".to_string());

    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::Stream(vec![RedisStreamEntry {
            id: "*".to_string(),
            fields,
        }]),
        ttl_seconds: Some(60),
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload).await.unwrap();

    let got = redis::get_key(&mut conn, key.clone()).await.unwrap();
    assert_eq!(got.key_type, "stream");
    assert_eq!(got.value_total_len, Some(1));
    if let RedisValue::Stream(entries) = &got.value {
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].id.is_empty(), "expected generated stream id");
        assert_eq!(entries[0].fields.get("f1").map(String::as_str), Some("v1"));
    } else {
        panic!("expected Stream");
    }
    assert!(got.extra.is_some(), "expected extra for stream");
    assert!(
        got.extra.as_ref().unwrap().stream_info.is_some(),
        "expected stream_info"
    );

    cleanup(&form, &key).await;
}

#[tokio::test]
async fn crud_stream_patch_add_and_del() {
    let form = noauth();
    let key = redis_context::unique_name("crud_stream_patch");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let mut fields = BTreeMap::new();
    fields.insert("f1".to_string(), "v1".to_string());

    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::Stream(vec![RedisStreamEntry {
            id: "*".to_string(),
            fields,
        }]),
        ttl_seconds: None,
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload).await.unwrap();

    let got = redis::get_key(&mut conn, key.clone()).await.unwrap();
    let first_id = if let RedisValue::Stream(entries) = &got.value {
        entries[0].id.clone()
    } else {
        panic!("expected Stream");
    };

    let mut new_fields = BTreeMap::new();
    new_fields.insert("f2".to_string(), "v2".to_string());
    let patch = RedisKeyPatchPayload {
        key: key.clone(),
        ttl_seconds: None,
        stream_add: Some(vec![RedisStreamEntry {
            id: "*".to_string(),
            fields: new_fields,
        }]),
        stream_del: None,
        ..Default::default()
    };
    redis::patch_key(&mut conn, patch).await.unwrap();

    let after_add = redis::get_key(&mut conn, key.clone()).await.unwrap();
    if let RedisValue::Stream(entries) = &after_add.value {
        assert_eq!(entries.len(), 2);
    } else {
        panic!("expected Stream after add");
    }

    let patch_del = RedisKeyPatchPayload {
        key: key.clone(),
        ttl_seconds: None,
        stream_add: None,
        stream_del: Some(vec![first_id]),
        ..Default::default()
    };
    redis::patch_key(&mut conn, patch_del).await.unwrap();

    let after_del = redis::get_key(&mut conn, key.clone()).await.unwrap();
    if let RedisValue::Stream(entries) = &after_del.value {
        assert_eq!(entries.len(), 1);
    } else {
        panic!("expected Stream after del");
    }

    cleanup(&form, &key).await;
}

#[tokio::test]
async fn crud_stream_range_pagination() {
    let form = noauth();
    let key = redis_context::unique_name("crud_stream_range");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let entries: Vec<RedisStreamEntry> = (0..250)
        .map(|i| {
            let mut f = BTreeMap::new();
            f.insert("idx".to_string(), i.to_string());
            RedisStreamEntry {
                id: "*".to_string(),
                fields: f,
            }
        })
        .collect();

    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::Stream(entries),
        ttl_seconds: Some(120),
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload).await.unwrap();

    let first = redis::get_key(&mut conn, key.clone()).await.unwrap();
    assert_eq!(first.value_total_len, Some(250));
    let first_len = if let RedisValue::Stream(v) = &first.value {
        v.len()
    } else {
        panic!("expected stream");
    };
    assert_eq!(first_len, 200);

    let last_id = if let RedisValue::Stream(v) = &first.value {
        v.last().unwrap().id.clone()
    } else {
        panic!("expected stream");
    };

    let range = redis::get_stream_range(&mut conn, key.clone(), last_id, 200)
        .await
        .unwrap();
    assert!(!range.is_empty(), "expected non-empty stream range page");

    cleanup(&form, &key).await;
}

#[tokio::test]
async fn stream_view_supports_range_and_groups() {
    let form = noauth();
    let key = redis_context::unique_name("stream_view_groups");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let entries: Vec<RedisStreamEntry> = (0..6)
        .map(|i| {
            let mut fields = BTreeMap::new();
            fields.insert("idx".to_string(), i.to_string());
            RedisStreamEntry {
                id: "*".to_string(),
                fields,
            }
        })
        .collect();

    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::Stream(entries),
        ttl_seconds: None,
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload).await.unwrap();

    let initial = redis::get_key(&mut conn, key.clone()).await.unwrap();
    let initial_entries = match &initial.value {
        RedisValue::Stream(entries) => entries.clone(),
        _ => panic!("expected stream"),
    };
    assert_eq!(initial_entries.len(), 6);

    let create_group = {
        let mut cmd = ::redis::cmd("XGROUP");
        cmd.arg("CREATE")
            .arg(&key)
            .arg("workers")
            .arg("0")
            .arg("MKSTREAM");
        conn.query::<String>(cmd).await.unwrap()
    };
    assert_eq!(create_group, "OK");

    let start_id = format!("({}", initial_entries[1].id);
    let end_id = initial_entries[4].id.clone();
    let view = redis::get_stream_view(&mut conn, key.clone(), start_id, end_id, 2)
        .await
        .unwrap();

    assert_eq!(view.entries.len(), 2);
    assert_eq!(
        view.entries[0].fields.get("idx").map(String::as_str),
        Some("2")
    );
    assert_eq!(
        view.entries[1].fields.get("idx").map(String::as_str),
        Some("3")
    );
    assert!(
        view.next_start_id.is_some(),
        "expected another page within range"
    );
    assert_eq!(view.groups.len(), 1);
    assert_eq!(view.groups[0].name, "workers");
    assert_eq!(view.groups[0].consumers, 0);
    assert_eq!(view.groups[0].pending, 0);
    assert_eq!(view.total_len, 6);

    cleanup(&form, &key).await;
}

// ── CRUD: json ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn crud_json() {
    let form = noauth();
    let key = redis_context::unique_name("crud_json");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::Json(r#"{"name":"alice","age":30}"#.to_string()),
        ttl_seconds: Some(60),
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };

    match redis::set_key(&mut conn, payload).await {
        Ok(_) => {
            let got = redis::get_key(&mut conn, key.clone()).await.unwrap();
            assert_eq!(got.key_type, "ReJSON-RL");
            assert!(
                matches!(&got.value, RedisValue::Json(v) if v.contains("alice")),
                "expected JSON value"
            );
            cleanup(&form, &key).await;
        }
        Err(e) if e.to_lowercase().contains("unknown command") => {
            eprintln!("[skip] RedisJSON module not loaded; skipping json test");
        }
        Err(e) => panic!("unexpected error: {e}"),
    }
}

#[tokio::test]
async fn json_write_rejects_invalid_payload() {
    let form = noauth();
    let key = redis_context::unique_name("crud_json_invalid");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::Json("{bad json}".to_string()),
        ttl_seconds: None,
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };

    let err = redis::set_key(&mut conn, payload).await.unwrap_err();
    assert!(
        err.contains("[VALIDATION_ERROR] Invalid JSON"),
        "unexpected error: {err}"
    );

    cleanup(&form, &key).await;
}

// ── subtype detection ─────────────────────────────────────────────────────────

#[tokio::test]
async fn hyperloglog_detection() {
    let form = noauth();
    let key = redis_context::unique_name("hll_detect");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let mut cmd = ::redis::cmd("PFADD");
    cmd.arg(&key).arg("a").arg("b").arg("c");
    conn.query::<i64>(cmd).await.unwrap();

    let got = redis::get_key(&mut conn, key.clone()).await.unwrap();
    assert_eq!(got.key_type, "string");
    assert_eq!(
        got.extra.as_ref().and_then(|e| e.subtype.as_deref()),
        Some("hyperloglog")
    );
    assert!(
        got.extra.as_ref().and_then(|e| e.hll_count).unwrap_or(0) > 0,
        "expected positive hll count"
    );

    cleanup(&form, &key).await;
}

#[tokio::test]
async fn geo_detection() {
    let form = noauth();
    let key = redis_context::unique_name("geo_detect");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let mut cmd = ::redis::cmd("GEOADD");
    cmd.arg(&key).arg("116.40").arg("39.90").arg("beijing");
    conn.query::<i64>(cmd).await.unwrap();

    let got = redis::get_key(&mut conn, key.clone()).await.unwrap();
    assert_eq!(got.key_type, "zset");
    assert_eq!(
        got.extra.as_ref().and_then(|e| e.subtype.as_deref()),
        Some("geo")
    );

    cleanup(&form, &key).await;
}

// ── Round 2: string INCRBY ───────────────────────────────────────────────────

#[tokio::test]
async fn string_incr_by_int() {
    let form = noauth();
    let key = redis_context::unique_name("incr_int");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::String("100".to_string()),
        ttl_seconds: None,
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload).await.unwrap();

    let patch = RedisKeyPatchPayload {
        key: key.clone(),
        string_incr_by_int: Some(25),
        ..Default::default()
    };
    redis::patch_key(&mut conn, patch).await.unwrap();

    let got = redis::get_key(&mut conn, key.clone()).await.unwrap();
    assert!(
        matches!(&got.value, RedisValue::String(v) if v == "125"),
        "expected '125' after INCRBY 25, got {:?}",
        got.value
    );

    // Negative decrement
    let patch2 = RedisKeyPatchPayload {
        key: key.clone(),
        string_incr_by_int: Some(-50),
        ..Default::default()
    };
    redis::patch_key(&mut conn, patch2).await.unwrap();

    let got2 = redis::get_key(&mut conn, key.clone()).await.unwrap();
    assert!(
        matches!(&got2.value, RedisValue::String(v) if v == "75"),
        "expected '75' after DECRBY 50, got {:?}",
        got2.value
    );

    cleanup(&form, &key).await;
}

#[tokio::test]
async fn string_incr_by_int_rejects_non_integer() {
    let form = noauth();
    let key = redis_context::unique_name("incr_bad");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::String("not-a-number".to_string()),
        ttl_seconds: None,
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload).await.unwrap();

    let patch = RedisKeyPatchPayload {
        key: key.clone(),
        string_incr_by_int: Some(1),
        ..Default::default()
    };
    let err = redis::patch_key(&mut conn, patch).await.unwrap_err();
    assert!(
        err.contains("not an integer"),
        "unexpected error: {err}"
    );

    cleanup(&form, &key).await;
}

// ── Round 2: ZRANGEBYSCORE / ZCOUNT ──────────────────────────────────────────

#[tokio::test]
async fn zrangebyscore_and_zcount() {
    let form = noauth();
    let key = redis_context::unique_name("zrange_score");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let members: Vec<RedisZSetMember> = (1..=10)
        .map(|i| RedisZSetMember {
            member: format!("m{i}"),
            score: i as f64 * 10.0, // 10, 20, ..., 100
        })
        .collect();
    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::ZSet(members),
        ttl_seconds: Some(60),
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload).await.unwrap();

    // Score range [20, 50] → m2, m3, m4, m5
    let result: RedisZRangeByScoreResult = redis::zrangebyscore(
        &mut conn,
        key.clone(),
        "20".to_string(),
        "50".to_string(),
        None,
        None,
    )
    .await
    .unwrap();
    assert_eq!(result.total, 4, "expected 4 members in [20,50]");
    assert_eq!(result.members.len(), 4);
    assert_eq!(result.members[0].member, "m2");
    assert_eq!(result.members[3].member, "m5");

    // Exclusive boundaries (20, 50) → m3, m4
    let result2: RedisZRangeByScoreResult = redis::zrangebyscore(
        &mut conn,
        key.clone(),
        "(20".to_string(),
        "(50".to_string(),
        None,
        None,
    )
    .await
    .unwrap();
    assert_eq!(result2.total, 2, "expected 2 members in (20,50)");
    assert_eq!(result2.members[0].member, "m3");
    assert_eq!(result2.members[1].member, "m4");

    // With offset/limit
    let result3: RedisZRangeByScoreResult = redis::zrangebyscore(
        &mut conn,
        key.clone(),
        "10".to_string(),
        "100".to_string(),
        Some(2),
        Some(3),
    )
    .await
    .unwrap();
    assert_eq!(result3.members.len(), 3, "expected 3 members with LIMIT 2 3");

    cleanup(&form, &key).await;
}

// ── Round 2: ZRANK / ZREVRANK ────────────────────────────────────────────────

#[tokio::test]
async fn zrank_and_zrevrank() {
    let form = noauth();
    let key = redis_context::unique_name("zrank_test");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let members: Vec<RedisZSetMember> = vec![
        RedisZSetMember { member: "a".to_string(), score: 1.0 },
        RedisZSetMember { member: "b".to_string(), score: 2.0 },
        RedisZSetMember { member: "c".to_string(), score: 3.0 },
    ];
    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::ZSet(members),
        ttl_seconds: Some(60),
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload).await.unwrap();

    // ZRANK
    let rank_a = redis::zrank(&mut conn, key.clone(), "a".to_string(), false)
        .await
        .unwrap();
    assert_eq!(rank_a, Some(0), "a should be rank 0");

    let rank_c = redis::zrank(&mut conn, key.clone(), "c".to_string(), false)
        .await
        .unwrap();
    assert_eq!(rank_c, Some(2), "c should be rank 2");

    // ZREVRANK
    let revrank_a = redis::zrank(&mut conn, key.clone(), "a".to_string(), true)
        .await
        .unwrap();
    assert_eq!(revrank_a, Some(2), "a should be rev-rank 2");

    let revrank_c = redis::zrank(&mut conn, key.clone(), "c".to_string(), true)
        .await
        .unwrap();
    assert_eq!(revrank_c, Some(0), "c should be rev-rank 0");

    // Non-existent member
    let rank_none = redis::zrank(&mut conn, key.clone(), "z".to_string(), false)
        .await
        .unwrap();
    assert_eq!(rank_none, None, "non-existent member should return None");

    cleanup(&form, &key).await;
}

// ── Round 2: SINTER / SUNION / SDIFF ─────────────────────────────────────────

#[tokio::test]
async fn set_operations_sinter_sunion_sdiff() {
    let form = noauth();
    let key_a = redis_context::unique_name("setop_a");
    let key_b = redis_context::unique_name("setop_b");
    let mut conn = redis::connect(&form, None).await.unwrap();

    // Create set A = {1, 2, 3}
    let payload_a = RedisSetKeyPayload {
        key: key_a.clone(),
        value: RedisValue::Set(vec!["1".into(), "2".into(), "3".into()]),
        ttl_seconds: Some(60),
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload_a).await.unwrap();

    // Create set B = {2, 3, 4}
    let payload_b = RedisSetKeyPayload {
        key: key_b.clone(),
        value: RedisValue::Set(vec!["2".into(), "3".into(), "4".into()]),
        ttl_seconds: Some(60),
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload_b).await.unwrap();

    // SINTER → {2, 3}
    let inter = redis::set_operation(
        &mut conn,
        vec![key_a.clone(), key_b.clone()],
        RedisSetOperation::Inter,
    )
    .await
    .unwrap();
    assert_eq!(inter.len(), 2, "SINTER should have 2 members");
    assert!(inter.contains(&"2".to_string()));
    assert!(inter.contains(&"3".to_string()));

    // SUNION → {1, 2, 3, 4}
    let union = redis::set_operation(
        &mut conn,
        vec![key_a.clone(), key_b.clone()],
        RedisSetOperation::Union,
    )
    .await
    .unwrap();
    assert_eq!(union.len(), 4, "SUNION should have 4 members");

    // SDIFF A B → {1}
    let diff = redis::set_operation(
        &mut conn,
        vec![key_a.clone(), key_b.clone()],
        RedisSetOperation::Diff,
    )
    .await
    .unwrap();
    assert_eq!(diff.len(), 1, "SDIFF should have 1 member");
    assert_eq!(diff[0], "1");

    cleanup(&form, &key_a).await;
    cleanup(&form, &key_b).await;
}

// ── Round 2: SISMEMBER ───────────────────────────────────────────────────────

#[tokio::test]
async fn sismember_check() {
    let form = noauth();
    let key = redis_context::unique_name("sismember");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::Set(vec!["alpha".into(), "beta".into(), "gamma".into()]),
        ttl_seconds: Some(60),
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload).await.unwrap();

    let is_member = redis::sismember(&mut conn, key.clone(), "beta".to_string())
        .await
        .unwrap();
    assert!(is_member, "beta should be a member");

    let not_member = redis::sismember(&mut conn, key.clone(), "delta".to_string())
        .await
        .unwrap();
    assert!(!not_member, "delta should not be a member");

    cleanup(&form, &key).await;
}

// ── Round 2: SMOVE ───────────────────────────────────────────────────────────

#[tokio::test]
async fn smove_between_sets() {
    let form = noauth();
    let src = redis_context::unique_name("smove_src");
    let dst = redis_context::unique_name("smove_dst");
    let mut conn = redis::connect(&form, None).await.unwrap();

    let payload_src = RedisSetKeyPayload {
        key: src.clone(),
        value: RedisValue::Set(vec!["a".into(), "b".into(), "c".into()]),
        ttl_seconds: Some(60),
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload_src).await.unwrap();

    let payload_dst = RedisSetKeyPayload {
        key: dst.clone(),
        value: RedisValue::Set(vec!["x".into(), "y".into()]),
        ttl_seconds: Some(60),
        set_nx: None,
        set_xx: None,
        set_px: None,
        set_keepttl: None,
    };
    redis::set_key(&mut conn, payload_dst).await.unwrap();

    // SMOVE src dst "b" → true, src loses "b", dst gains "b"
    let moved = redis::smove(&mut conn, src.clone(), dst.clone(), "b".to_string())
        .await
        .unwrap();
    assert!(moved, "SMOVE should return true for existing member");

    let src_after = redis::get_key(&mut conn, src.clone()).await.unwrap();
    if let RedisValue::Set(members) = &src_after.value {
        assert_eq!(members.len(), 2, "source should have 2 members after SMOVE");
        assert!(!members.contains(&"b".to_string()));
    } else {
        panic!("expected Set");
    }

    let dst_after = redis::get_key(&mut conn, dst.clone()).await.unwrap();
    if let RedisValue::Set(members) = &dst_after.value {
        assert_eq!(members.len(), 3, "dest should have 3 members after SMOVE");
        assert!(members.contains(&"b".to_string()));
    } else {
        panic!("expected Set");
    }

    // SMOVE with non-existent member → false
    let not_moved = redis::smove(&mut conn, src.clone(), dst.clone(), "z".to_string())
        .await
        .unwrap();
    assert!(!not_moved, "SMOVE should return false for non-existent member");

    cleanup(&form, &src).await;
    cleanup(&form, &dst).await;
}
