use crate::db::drivers::{self, DatabaseDriver};
use crate::models::ConnectionForm;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::{Mutex as AsyncMutex, RwLock};

pub struct PoolEntry {
    pub driver: Arc<dyn DatabaseDriver>,
    // Use std::sync::Mutex for interior mutability to update timestamp on read access
    pub last_used: Mutex<std::time::Instant>,
}

pub struct PoolManager {
    // Store active connections, Key is connection UUID
    pools: RwLock<HashMap<String, PoolEntry>>,
    // Connection lock to prevent concurrent connection attempts for the same UUID
    connect_locks: RwLock<HashMap<String, Arc<AsyncMutex<()>>>>,
}

impl PoolManager {
    pub fn new() -> Self {
        Self {
            pools: RwLock::new(HashMap::new()),
            connect_locks: RwLock::new(HashMap::new()),
        }
    }

    /// Get existing connection, update last_used time if it exists
    pub async fn get_connection(&self, id: &str) -> Option<Arc<dyn DatabaseDriver>> {
        let pools = self.pools.read().await;
        if let Some(entry) = pools.get(id) {
            match entry.last_used.lock() {
                Ok(mut last) => *last = std::time::Instant::now(),
                Err(e) => eprintln!("[POOL_ERROR] Failed to lock last_used timestamp: {}", e),
            }
            return Some(entry.driver.clone());
        }
        None
    }

    /// Establish new connection and cache it. Return existing one if already present.
    pub async fn connect(&self, id: &str, form: &ConnectionForm) -> Result<Arc<dyn DatabaseDriver>, String> {
        // 1. Fast path check
        if let Some(driver) = self.get_connection(id).await {
            return Ok(driver);
        }

        // 2. Get lock for this specific ID
        let lock = {
            let mut locks = self.connect_locks.write().await;
            locks
                .entry(id.to_string())
                .or_insert_with(|| Arc::new(AsyncMutex::new(())))
                .clone()
        };
        // Lock to ensure only one thread establishes connection for this ID at a time
        let _guard = lock.lock().await;

        // 3. Double check
        if let Some(driver) = self.get_connection(id).await {
            return Ok(driver);
        }

        // 4. Create new connection
        // Note: connect returns Box<dyn DatabaseDriver>, we need to convert to Arc
        let driver_box = drivers::connect(form).await.map_err(|e| format!("[POOL_CONNECT_ERROR] {}", e))?;
        let driver: Arc<dyn DatabaseDriver> = Arc::from(driver_box);

        // 5. Store in pool
        {
            let mut pools = self.pools.write().await;
            pools.insert(id.to_string(), PoolEntry {
                driver: driver.clone(),
                last_used: Mutex::new(std::time::Instant::now()),
            });
        }

        Ok(driver)
    }

    /// Remove and close connection
    pub async fn remove(&self, id: &str) {
        let entry = {
            let mut pools = self.pools.write().await;
            pools.remove(id)
        };
        
        if let Some(entry) = entry {
            // Explicitly close connection, write lock is released at this point
            entry.driver.close().await;
        }
    }

    /// Remove and close all connections for a given ID (including different databases)
    pub async fn remove_by_prefix(&self, id: &str) {
        let entries_to_remove = {
            let mut pools = self.pools.write().await;
            let keys_to_remove: Vec<String> = pools
                .keys()
                .filter(|k| k == &id || k.starts_with(&format!("{}:", id)))
                .cloned()
                .collect();
            
            let mut entries = Vec::new();
            for key in keys_to_remove {
                if let Some(entry) = pools.remove(&key) {
                    entries.push(entry);
                }
            }
            entries
        };

        for entry in entries_to_remove {
            entry.driver.close().await;
        }
    }

    /// Close all connections (used when application exits)
    pub async fn close_all(&self) {
        let entries = {
            let mut pools = self.pools.write().await;
            pools.drain().map(|(_, e)| e).collect::<Vec<_>>()
        };

        for entry in entries {
            entry.driver.close().await;
        }
    }

    #[cfg(test)]
    pub async fn insert_mock_connection(&self, id: &str, driver: Arc<dyn DatabaseDriver>) {
        let mut pools = self.pools.write().await;
        pools.insert(id.to_string(), PoolEntry {
            driver,
            last_used: Mutex::new(std::time::Instant::now()),
        });
    }

    #[cfg(test)]
    pub async fn count(&self) -> usize {
        self.pools.read().await.len()
    }

    #[cfg(test)]
    pub async fn contains_key(&self, key: &str) -> bool {
        self.pools.read().await.contains_key(key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::drivers::DatabaseDriver;
    use async_trait::async_trait;

    struct MockDriver;

    #[async_trait]
    impl DatabaseDriver for MockDriver {
        async fn close(&self) {}
        async fn test_connection(&self) -> Result<(), String> { Ok(()) }
        async fn list_databases(&self) -> Result<Vec<String>, String> { Ok(vec![]) }
        async fn list_tables(&self, _schema: Option<String>) -> Result<Vec<crate::models::TableInfo>, String> { Ok(vec![]) }
        async fn get_table_structure(&self, _schema: String, _table: String) -> Result<crate::models::TableStructure, String> { Err("Unimplemented".into()) }
        async fn get_table_metadata(&self, _schema: String, _table: String) -> Result<crate::models::TableMetadata, String> { Err("Unimplemented".into()) }
        async fn get_table_ddl(&self, _schema: String, _table: String) -> Result<String, String> { Err("Unimplemented".into()) }
        async fn get_table_data(&self, _schema: String, _table: String, _page: i64, _limit: i64, _sort_column: Option<String>, _sort_direction: Option<String>, _filter: Option<String>, _order_by: Option<String>) -> Result<crate::models::TableDataResponse, String> { Err("Unimplemented".into()) }
        async fn get_table_data_chunk(&self, _schema: String, _table: String, _page: i64, _limit: i64, _sort_column: Option<String>, _sort_direction: Option<String>, _filter: Option<String>, _order_by: Option<String>) -> Result<crate::models::TableDataResponse, String> { Err("Unimplemented".into()) }
        async fn execute_query(&self, _sql: String) -> Result<crate::models::QueryResult, String> { Err("Unimplemented".into()) }
        async fn get_schema_overview(&self, _schema: Option<String>) -> Result<crate::models::SchemaOverview, String> { Err("Unimplemented".into()) }
    }

    #[tokio::test]
    async fn test_remove_by_prefix() {
        let manager = PoolManager::new();
        let driver = Arc::new(MockDriver);

        manager.insert_mock_connection("1", driver.clone()).await;
        manager.insert_mock_connection("1:db1", driver.clone()).await;
        manager.insert_mock_connection("1:db2", driver.clone()).await;
        manager.insert_mock_connection("2", driver.clone()).await;
        manager.insert_mock_connection("21", driver.clone()).await; // Should NOT be removed

        assert_eq!(manager.count().await, 5);

        manager.remove_by_prefix("1").await;

        assert_eq!(manager.count().await, 2);
        assert!(!manager.contains_key("1").await);
        assert!(!manager.contains_key("1:db1").await);
        assert!(!manager.contains_key("1:db2").await);
        assert!(manager.contains_key("2").await);
        assert!(manager.contains_key("21").await);
    }
}
