-- Revisions and saved blueprints have business timestamps. Use their original
-- facts for historical analysis without copying private documents into analytics.
CREATE VIEW world_ops_creation AS
WITH candidates AS (
    SELECT workspace_id, user_id, 'fish' AS game, fish_id::text AS subject_id,
           revision, payload->>'origin' AS origin, payload->>'createdAt' AS stamp
    FROM fish_revision
    UNION ALL
    SELECT r.workspace_id, c.user_id, 'tanks', r.character_id::text, r.revision,
           r.payload->>'origin', r.payload->>'createdAt'
    FROM tank_character_revision r
    JOIN tank_character c ON c.id = r.character_id AND c.workspace_id = r.workspace_id
    UNION ALL
    (SELECT DISTINCT ON (s.workspace_id, b.payload->>'id')
           s.workspace_id, s.user_id, 'siege', b.payload->>'id', 1, 'manual', b.payload->>'createdAt'
    FROM siege_session s
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(s.payload->'blueprints') = 'array' THEN s.payload->'blueprints' ELSE '[]'::jsonb END
    ) b(payload)
    WHERE coalesce(b.payload->>'id', '') <> ''
    ORDER BY s.workspace_id, b.payload->>'id', b.payload->>'createdAt' NULLS LAST, s.id)
)
SELECT workspace_id, user_id, game, subject_id, revision,
       CASE WHEN origin IN ('manual', 'mcp') THEN origin ELSE 'unknown' END AS origin,
       CASE WHEN stamp ~ 'Z$' AND pg_input_is_valid(stamp, 'timestamp with time zone') THEN stamp::timestamptz END AS occurred_at
FROM candidates;

CREATE FUNCTION world_ops_capture_progress() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.payload = OLD.payload THEN
            RETURN NEW;
        END IF;
    END IF;
    IF (NEW.game = 'tanks' AND (NEW.payload->'best' > '0'::jsonb OR NEW.payload->'unlocked' > '1'::jsonb))
        OR (NEW.game = 'siege' AND jsonb_typeof(NEW.payload->'stars') = 'array'
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.payload->'stars') s(value) WHERE s.value > '0'::jsonb)) THEN
        INSERT INTO world_ops_action (workspace_id, user_id, game, kind, origin, occurred_at)
        VALUES (NEW.workspace_id, NEW.user_id, NEW.game, 'progress', 'manual', NEW.updated_at);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER world_ops_progress
AFTER INSERT OR UPDATE OF payload ON game_progress
FOR EACH ROW EXECUTE FUNCTION world_ops_capture_progress();

CREATE FUNCTION world_ops_capture_release() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.operation = 'release' THEN
        INSERT INTO world_ops_action (workspace_id, user_id, game, kind, origin, occurred_at)
        VALUES (NEW.workspace_id, NEW.user_id, 'fish', 'release', 'unknown', NEW.created_at);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER world_ops_release
AFTER INSERT ON fish_request
FOR EACH ROW EXECUTE FUNCTION world_ops_capture_release();

INSERT INTO world_ops_coverage (started_at) VALUES (clock_timestamp());
