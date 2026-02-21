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
    // 存储活跃连接，Key 为连接 UUID
    pools: RwLock<HashMap<String, PoolEntry>>,
    // 连接锁，防止对同一 UUID 并发发起连接
    connect_locks: RwLock<HashMap<String, Arc<AsyncMutex<()>>>>,
}

impl PoolManager {
    pub fn new() -> Self {
        Self {
            pools: RwLock::new(HashMap::new()),
            connect_locks: RwLock::new(HashMap::new()),
        }
    }

    /// 获取现有连接，如果存在则更新 last_used 时间
    pub async fn get_connection(&self, id: &str) -> Option<Arc<dyn DatabaseDriver>> {
        let pools = self.pools.read().await;
        if let Some(entry) = pools.get(id) {
            if let Ok(mut last) = entry.last_used.lock() {
                *last = std::time::Instant::now();
            }
            return Some(entry.driver.clone());
        }
        None
    }

    /// 建立新连接并缓存。如果已存在则直接返回。
    pub async fn connect(&self, id: &str, form: &ConnectionForm) -> Result<Arc<dyn DatabaseDriver>, String> {
        // 1. 快速检查 (Fast path)
        if let Some(driver) = self.get_connection(id).await {
            return Ok(driver);
        }

        // 2. 获取连接锁 (Get lock for this specific ID)
        let lock = {
            let mut locks = self.connect_locks.write().await;
            locks
                .entry(id.to_string())
                .or_insert_with(|| Arc::new(AsyncMutex::new(())))
                .clone()
        };
        // 锁定，确保同一时间只有一个线程在建立该 ID 的连接
        let _guard = lock.lock().await;

        // 3. 再次检查 (Double check)
        if let Some(driver) = self.get_connection(id).await {
            return Ok(driver);
        }

        // 4. 创建新连接
        // 注意：此处 connect 返回 Box<dyn DatabaseDriver>，我们需要转为 Arc
        let driver_box = drivers::connect(form).await.map_err(|e| format!("[POOL_CONNECT_ERROR] {}", e))?;
        let driver: Arc<dyn DatabaseDriver> = Arc::from(driver_box);

        // 5. 存入池中
        {
            let mut pools = self.pools.write().await;
            pools.insert(id.to_string(), PoolEntry {
                driver: driver.clone(),
                last_used: Mutex::new(std::time::Instant::now()),
            });
        }

        Ok(driver)
    }

    /// 移除并关闭连接
    pub async fn remove(&self, id: &str) {
        let mut pools = self.pools.write().await;
        if let Some(entry) = pools.remove(id) {
            // 显式关闭连接
            entry.driver.close().await;
        }
    }

    /// 关闭所有连接 (用于应用退出)
    pub async fn close_all(&self) {
        let mut pools = self.pools.write().await;
        for (_, entry) in pools.drain() {
            entry.driver.close().await;
        }
    }
}
