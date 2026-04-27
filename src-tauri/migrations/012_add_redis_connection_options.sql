ALTER TABLE connections ADD COLUMN mode TEXT;
ALTER TABLE connections ADD COLUMN seed_nodes TEXT;
ALTER TABLE connections ADD COLUMN sentinels TEXT;
ALTER TABLE connections ADD COLUMN connect_timeout_ms INTEGER;
