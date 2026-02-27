DROP TRIGGER IF EXISTS trg_ai_providers_provider_type_insert;
DROP TRIGGER IF EXISTS trg_ai_providers_provider_type_update;
DROP INDEX IF EXISTS idx_ai_providers_provider_type_unique;

UPDATE ai_providers
SET provider_type = CASE
    WHEN lower(trim(provider_type)) = 'openai_compat' THEN 'openai'
    ELSE lower(trim(provider_type))
END;

DELETE FROM ai_providers
WHERE id IN (
    SELECT id
    FROM (
        SELECT
            id,
            ROW_NUMBER() OVER (
                PARTITION BY provider_type
                ORDER BY is_default DESC, datetime(updated_at) DESC, id DESC
            ) AS rn
        FROM ai_providers
    ) ranked
    WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_providers_provider_type_unique
ON ai_providers(provider_type);

CREATE TRIGGER IF NOT EXISTS trg_ai_providers_provider_type_insert
BEFORE INSERT ON ai_providers
FOR EACH ROW
WHEN length(trim(NEW.provider_type)) = 0
    OR NEW.provider_type != lower(trim(NEW.provider_type))
    OR NEW.provider_type GLOB '*[^a-z0-9_.-]*'
BEGIN
    SELECT RAISE(ABORT, 'provider_type must be lowercase and match [a-z0-9_.-]+');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_providers_provider_type_update
BEFORE UPDATE OF provider_type ON ai_providers
FOR EACH ROW
WHEN length(trim(NEW.provider_type)) = 0
    OR NEW.provider_type != lower(trim(NEW.provider_type))
    OR NEW.provider_type GLOB '*[^a-z0-9_.-]*'
BEGIN
    SELECT RAISE(ABORT, 'provider_type must be lowercase and match [a-z0-9_.-]+');
END;
