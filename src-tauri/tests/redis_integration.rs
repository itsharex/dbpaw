#[path = "common/redis_context.rs"]
mod redis_context;

use dbpaw_lib::datasources::redis;
use dbpaw_lib::datasources::redis::{RedisSetKeyPayload, RedisValue, RedisZSetMember};
use std::collections::BTreeMap;

// ── helpers ──────────────────────────────────────────────────────────────────

fn noauth() -> dbpaw_lib::models::ConnectionForm {
    redis_context::shared_redis_noauth_form()
}

fn auth() -> dbpaw_lib::models::ConnectionForm {
    redis_context::shared_redis_auth_form()
}

async fn cleanup(form: &dbpaw_lib::models::ConnectionForm, key: &str) {
    let _ = redis::delete_key(form, None, key.to_string()).await;
}

// ── connection tests ──────────────────────────────────────────────────────────

#[tokio::test]
#[ignore]
async fn noauth_ping() {
    let form = noauth();
    let result = redis::test_connection(&form).await;
    assert!(result.is_ok(), "no-auth ping failed: {:?}", result.err());
}

#[tokio::test]
#[ignore]
async fn auth_ping() {
    let form = auth();
    let result = redis::test_connection(&form).await;
    assert!(result.is_ok(), "auth ping failed: {:?}", result.err());
}

#[tokio::test]
#[ignore]
async fn list_databases_standalone() {
    let form = noauth();
    let dbs = redis::list_databases(&form).unwrap();
    assert_eq!(dbs.len(), 16, "expected 16 databases for standalone");
    assert!(dbs.iter().any(|d| d.selected), "no database marked selected");
}

// ── scan tests ────────────────────────────────────────────────────────────────

#[tokio::test]
#[ignore]
async fn scan_keys_cursor_works() {
    let form = noauth();
    // Insert 150 keys with a unique prefix so they are isolated from other tests
    let prefix = redis_context::unique_name("scan_test");
    for i in 0..150u32 {
        let payload = RedisSetKeyPayload {
            key: format!("{prefix}:{i}"),
            value: RedisValue::String(format!("v{i}")),
            ttl_seconds: Some(60),
        };
        redis::set_key(&form, None, payload).await.unwrap();
    }

    // Scan with small limit — should eventually return all 150 keys
    let mut all_keys = Vec::new();
    let mut cursor = 0u64;
    let mut rounds = 0;
    loop {
        let resp = redis::scan_keys(
            &form,
            None,
            Some(cursor),
            Some(format!("{prefix}:*")),
            Some(50),
        )
        .await
        .unwrap();
        all_keys.extend(resp.keys.iter().map(|k| k.key.clone()));
        cursor = resp.cursor;
        rounds += 1;
        if cursor == 0 {
            break;
        }
        assert!(rounds < 50, "cursor loop did not terminate");
    }
    assert_eq!(all_keys.len(), 150, "expected 150 keys after full scan");

    // Cleanup
    for i in 0..150u32 {
        cleanup(&form, &format!("{prefix}:{i}")).await;
    }
}

// ── CRUD: string ──────────────────────────────────────────────────────────────

#[tokio::test]
#[ignore]
async fn crud_string() {
    let form = noauth();
    let key = redis_context::unique_name("crud_string");

    // set
    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::String("hello".to_string()),
        ttl_seconds: None,
    };
    redis::set_key(&form, None, payload).await.unwrap();

    // get
    let got = redis::get_key(&form, None, key.clone()).await.unwrap();
    assert_eq!(got.key_type, "string");
    assert!(matches!(&got.value, RedisValue::String(v) if v == "hello"));
    assert_eq!(got.value_total_len, None);

    // update
    let payload2 = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::String("world".to_string()),
        ttl_seconds: None,
    };
    redis::set_key(&form, None, payload2).await.unwrap();
    let got2 = redis::get_key(&form, None, key.clone()).await.unwrap();
    assert!(matches!(&got2.value, RedisValue::String(v) if v == "world"));

    // delete
    let del = redis::delete_key(&form, None, key.clone()).await.unwrap();
    assert_eq!(del.affected, 1);
    let gone = redis::get_key(&form, None, key).await.unwrap();
    assert_eq!(gone.key_type, "none");
}

// ── CRUD: hash ────────────────────────────────────────────────────────────────

#[tokio::test]
#[ignore]
async fn crud_hash() {
    let form = noauth();
    let key = redis_context::unique_name("crud_hash");

    let mut fields = BTreeMap::new();
    fields.insert("f1".to_string(), "v1".to_string());
    fields.insert("f2".to_string(), "v2".to_string());
    fields.insert("f3".to_string(), "v3".to_string());

    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::Hash(fields),
        ttl_seconds: Some(60),
    };
    redis::set_key(&form, None, payload).await.unwrap();

    let got = redis::get_key(&form, None, key.clone()).await.unwrap();
    assert_eq!(got.key_type, "hash");
    assert_eq!(got.value_total_len, Some(3));
    if let RedisValue::Hash(map) = &got.value {
        assert_eq!(map.get("f1").map(String::as_str), Some("v1"));
    } else {
        panic!("expected Hash");
    }

    cleanup(&form, &key).await;
}

// ── CRUD: list ────────────────────────────────────────────────────────────────

#[tokio::test]
#[ignore]
async fn crud_list_pagination() {
    let form = noauth();
    let key = redis_context::unique_name("crud_list");

    let items: Vec<String> = (0..300).map(|i| format!("item{i}")).collect();
    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::List(items),
        ttl_seconds: Some(120),
    };
    redis::set_key(&form, None, payload).await.unwrap();

    // get_key returns first page (200 items)
    let first = redis::get_key(&form, None, key.clone()).await.unwrap();
    assert_eq!(first.value_total_len, Some(300));
    let first_count = if let RedisValue::List(v) = &first.value {
        v.len()
    } else {
        panic!("expected list");
    };
    assert_eq!(first_count, 200);

    // get_key_page returns next 100
    let page2 = redis::get_key_page(&form, None, key.clone(), 200, 200)
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
#[ignore]
async fn crud_set_pagination() {
    let form = noauth();
    let key = redis_context::unique_name("crud_set");

    let members: Vec<String> = (0..250).map(|i| format!("m{i}")).collect();
    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::Set(members),
        ttl_seconds: Some(120),
    };
    redis::set_key(&form, None, payload).await.unwrap();

    let first = redis::get_key(&form, None, key.clone()).await.unwrap();
    assert_eq!(first.value_total_len, Some(250));

    // SSCAN cursor-based: get_key_page with cursor=0 returns a batch
    let page = redis::get_key_page(&form, None, key.clone(), 0, 100)
        .await
        .unwrap();
    assert_eq!(page.value_total_len, Some(250));
    assert!(
        matches!(&page.value, RedisValue::Set(v) if !v.is_empty()),
        "expected non-empty set page"
    );

    cleanup(&form, &key).await;
}

// ── CRUD: zset ────────────────────────────────────────────────────────────────

#[tokio::test]
#[ignore]
async fn crud_zset_pagination() {
    let form = noauth();
    let key = redis_context::unique_name("crud_zset");

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
    };
    redis::set_key(&form, None, payload).await.unwrap();

    let first = redis::get_key(&form, None, key.clone()).await.unwrap();
    assert_eq!(first.value_total_len, Some(300));
    let first_len = if let RedisValue::ZSet(v) = &first.value {
        v.len()
    } else {
        panic!("expected zset");
    };
    assert_eq!(first_len, 200);

    let page2 = redis::get_key_page(&form, None, key.clone(), 200, 200)
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
#[ignore]
async fn rename_key() {
    let form = noauth();
    let old = redis_context::unique_name("rename_old");
    let new = redis_context::unique_name("rename_new");

    let payload = RedisSetKeyPayload {
        key: old.clone(),
        value: RedisValue::String("data".to_string()),
        ttl_seconds: Some(60),
    };
    redis::set_key(&form, None, payload).await.unwrap();

    redis::rename_key(&form, None, old.clone(), new.clone())
        .await
        .unwrap();

    let gone = redis::get_key(&form, None, old).await.unwrap();
    assert_eq!(gone.key_type, "none", "old key should be gone");

    let present = redis::get_key(&form, None, new.clone()).await.unwrap();
    assert_eq!(present.key_type, "string", "new key should exist");

    cleanup(&form, &new).await;
}

// ── TTL ───────────────────────────────────────────────────────────────────────

#[tokio::test]
#[ignore]
async fn set_ttl_and_persist() {
    let form = noauth();
    let key = redis_context::unique_name("ttl_test");

    let payload = RedisSetKeyPayload {
        key: key.clone(),
        value: RedisValue::String("ephemeral".to_string()),
        ttl_seconds: None,
    };
    redis::set_key(&form, None, payload).await.unwrap();

    // Set TTL
    redis::set_ttl(&form, None, key.clone(), Some(3600))
        .await
        .unwrap();
    let got = redis::get_key(&form, None, key.clone()).await.unwrap();
    assert!(got.ttl > 0, "expected positive TTL after EXPIRE");

    // Persist
    redis::set_ttl(&form, None, key.clone(), None).await.unwrap();
    let got2 = redis::get_key(&form, None, key.clone()).await.unwrap();
    assert_eq!(got2.ttl, -1, "expected -1 (no expiry) after PERSIST");

    cleanup(&form, &key).await;
}

// ── cluster ───────────────────────────────────────────────────────────────────

/// Requires IT_REUSE_LOCAL_DB=1 and REDIS_CLUSTER_HOSTS=<host1>,<host2>,...
#[tokio::test]
#[ignore]
async fn cluster_scan_is_partial() {
    let hosts = match std::env::var("REDIS_CLUSTER_HOSTS") {
        Ok(h) if !h.is_empty() => h,
        _ => {
            eprintln!("[skip] REDIS_CLUSTER_HOSTS not set; skipping cluster test");
            return;
        }
    };
    if !redis_context::should_reuse_local_db() {
        eprintln!("[skip] IT_REUSE_LOCAL_DB=1 required for cluster test");
        return;
    }

    let form = dbpaw_lib::models::ConnectionForm {
        driver: "redis".to_string(),
        host: Some(hosts),
        ..Default::default()
    };
    let resp = redis::scan_keys(&form, None, None, None, Some(10))
        .await
        .unwrap();
    assert!(resp.is_partial, "cluster scan should always set is_partial");
    assert_eq!(resp.cursor, 0, "cluster scan cursor should always be 0");
}
