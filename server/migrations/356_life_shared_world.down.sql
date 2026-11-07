-- Do not invent a source workspace or restore the removed audience restrictions.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM life_world WHERE workspace_id IS NULL) THEN
    RAISE EXCEPTION 'Shared Life has no source workspace; retain the forward schema';
  END IF;
END $$;
ALTER TABLE life_world ALTER COLUMN workspace_id SET NOT NULL;
