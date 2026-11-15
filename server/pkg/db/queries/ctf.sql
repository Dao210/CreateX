-- name: CTFMember :one
SELECT m.role,u.name FROM member m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 FOR SHARE OF m;
-- name: LockCTFWorld :exec
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(workspace_id)::text, 72831));
-- name: ListCTFStrategies :many
SELECT (s.payload-'strategy'::text)::jsonb AS payload,s.archived,r.published FROM ctf_strategy s JOIN ctf_revision r ON r.workspace_id=s.workspace_id AND r.strategy_id=s.id AND r.revision=s.revision WHERE s.workspace_id=$1 AND s.user_id=$2 ORDER BY s.updated_at DESC,s.id LIMIT 128;
-- name: GetCTFStrategy :one
SELECT payload,archived FROM ctf_strategy WHERE workspace_id=$1 AND user_id=$2 AND id=$3;
-- name: PutCTFStrategy :exec
INSERT INTO ctf_strategy(id,workspace_id,user_id,revision,payload) VALUES($1,$2,$3,$4,$5)
ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision,payload=EXCLUDED.payload,updated_at=now();
-- name: InsertCTFRevision :exec
INSERT INTO ctf_revision(strategy_id,workspace_id,user_id,revision,payload) VALUES($1,$2,$3,$4,$5);
-- name: GetCTFRevision :one
SELECT payload,published FROM ctf_revision WHERE workspace_id=$1 AND user_id=$2 AND strategy_id=$3 AND revision=$4;
-- name: PublishCTFRevision :exec
UPDATE ctf_revision SET published=true WHERE workspace_id=$1 AND user_id=$2 AND strategy_id=$3 AND revision=$4;
-- name: ListCTFLibrary :many
SELECT DISTINCT ON (r.strategy_id) (r.payload-'strategy'::text)::jsonb AS payload FROM ctf_revision r
JOIN member m ON m.workspace_id=r.workspace_id AND m.user_id=r.user_id
WHERE r.workspace_id=$1 AND r.published ORDER BY r.strategy_id,r.revision DESC LIMIT 512;
-- name: ArchiveCTFStrategy :exec
UPDATE ctf_strategy SET archived=$4 WHERE workspace_id=$1 AND user_id=$2 AND id=$3;
-- name: ListCTFEntries :many
SELECT e.payload FROM ctf_entry e JOIN member m ON m.workspace_id=e.workspace_id AND m.user_id=e.user_id
WHERE e.workspace_id=$1 ORDER BY e.user_id LIMIT 49;
-- name: PutCTFEntry :exec
INSERT INTO ctf_entry(workspace_id,user_id,payload) VALUES($1,$2,$3)
ON CONFLICT(workspace_id,user_id) DO UPDATE SET payload=EXCLUDED.payload;
-- name: WithdrawCTFEntry :exec
DELETE FROM ctf_entry WHERE workspace_id=$1 AND user_id=$2;
-- name: GetCTFRequest :one
SELECT body_hash,response FROM ctf_request WHERE workspace_id=$1 AND user_id=$2 AND request_id=$3;
-- name: InsertCTFRequest :exec
INSERT INTO ctf_request(workspace_id,user_id,request_id,body_hash,response) VALUES($1,$2,$3,$4,$5);
-- name: InsertCTFBatch :exec
INSERT INTO ctf_batch(id,workspace_id,user_id,total) VALUES($1,$2,$3,$4);
-- name: ListCTFBatches :many
SELECT b.*, (SELECT count(*) FROM ctf_match m WHERE m.batch_id=b.id AND m.status='completed')::integer AS completed
FROM ctf_batch b WHERE b.workspace_id=$1 ORDER BY b.created_at DESC,b.id LIMIT 20;
-- name: GetCTFBatch :one
SELECT b.*, (SELECT count(*) FROM ctf_match m WHERE m.batch_id=b.id AND m.status='completed')::integer AS completed
FROM ctf_batch b WHERE b.workspace_id=$1 AND b.id=$2;
-- name: SetCTFBatchStatus :exec
UPDATE ctf_batch SET status=$3,error=$4 WHERE workspace_id=$1 AND id=$2;
-- name: InsertCTFMatch :exec
INSERT INTO ctf_match(id,workspace_id,batch_id,payload) VALUES($1,$2,$3,$4);
-- name: GetCTFMatch :one
SELECT * FROM ctf_match WHERE workspace_id=$1 AND id=$2;
-- name: ListCTFMatches :many
SELECT id,workspace_id,batch_id,status,(payload #- '{red,strategy}'::text[] #- '{blue,strategy}'::text[])::jsonb AS payload,(result - 'frames'::text)::jsonb AS result,error,created_at FROM ctf_match
WHERE workspace_id=$1 ORDER BY created_at DESC,id LIMIT 100;
-- name: ClaimCTFMatch :one
UPDATE ctf_match SET status='running',lease_id=sqlc.arg(lease_id),lease_until=now()+interval '30 seconds',attempts=attempts+1
WHERE id=(SELECT m.id FROM ctf_match m JOIN ctf_batch b ON b.id=m.batch_id
 WHERE b.status='running' AND (m.status='queued' OR (m.status='running' AND m.lease_until<now()))
 AND m.attempts<3
 AND COALESCE((SELECT scope FROM game_policy WHERE game_id='ctf'),'all')<>'disabled'
 AND NOT EXISTS(SELECT 1 FROM game_world_override o WHERE o.game_id='ctf' AND o.workspace_id=m.workspace_id AND o.access='deny')
 AND (COALESCE((SELECT scope FROM game_policy WHERE game_id='ctf'),'all')='all'
 OR EXISTS(SELECT 1 FROM game_world_override o WHERE o.game_id='ctf' AND o.workspace_id=m.workspace_id AND o.access='allow'))
 ORDER BY m.created_at,m.id FOR UPDATE OF m SKIP LOCKED LIMIT 1)
RETURNING *;
-- name: FinishCTFMatch :execrows
UPDATE ctf_match SET status='completed',result=$4,lease_until=NULL WHERE workspace_id=$1 AND id=$2 AND lease_id=$3 AND status='running';
-- name: ReleaseCTFMatch :exec
UPDATE ctf_match SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,error=$4,lease_until=NULL
WHERE workspace_id=$1 AND id=$2 AND lease_id=$3 AND status='running';
-- name: ListCTFUnpublishedBatches :many
SELECT b.* FROM ctf_batch b WHERE b.status IN ('running','completed') AND NOT b.published
AND NOT EXISTS(SELECT 1 FROM ctf_match m WHERE m.batch_id=b.id AND m.status IN ('queued','running')) ORDER BY b.created_at LIMIT 20;
-- name: CTFBatchHasFailures :one
SELECT EXISTS(SELECT 1 FROM ctf_match WHERE batch_id=$1 AND status='failed');
-- name: MarkCTFBatchPublished :exec
UPDATE ctf_batch SET published=true WHERE workspace_id=$1 AND id=$2;
-- name: CTFRatedMatches :many
SELECT DISTINCT ON (m.payload->>'fingerprint') (m.payload #- '{red,strategy}'::text[] #- '{blue,strategy}'::text[])::jsonb AS payload,(m.result - 'frames'::text)::jsonb AS result,b.created_at AS period_at,b.id AS period_id FROM ctf_match m
JOIN ctf_batch b ON b.id=m.batch_id WHERE m.workspace_id=$1 AND m.status='completed' AND b.published ORDER BY m.payload->>'fingerprint',b.created_at,b.id,m.id;
-- name: PutCTFLeaderboard :exec
INSERT INTO ctf_leaderboard(workspace_id,payload) VALUES($1,$2)
ON CONFLICT(workspace_id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now();
-- name: GetCTFLeaderboard :one
SELECT payload FROM ctf_leaderboard WHERE workspace_id=$1;

-- name: ExpireCTFMatches :exec
UPDATE ctf_match SET status='failed',error='compute_timeout' WHERE status='running' AND attempts>=3 AND lease_until<now();

-- name: LockCTFWorkspace :one
SELECT id FROM workspace WHERE id=$1 FOR SHARE;

-- name: ReadCTFRevision :one
SELECT payload,published FROM ctf_revision WHERE workspace_id=$1 AND strategy_id=$2 AND revision=$3 AND (user_id=$4 OR published);

-- name: PreviewCTFMatch :exec
UPDATE ctf_match SET result=$4 WHERE ctf_match.workspace_id=$1 AND ctf_match.id=$2 AND ctf_match.lease_id=$3 AND ctf_match.status='running'
AND EXISTS(SELECT 1 FROM ctf_batch b WHERE b.id=ctf_match.batch_id AND b.status IN ('running','paused'));

-- name: CTFPlayedPairs :many
SELECT DISTINCT COALESCE(m.payload->>'fingerprint','')::text AS fingerprint FROM ctf_match m JOIN ctf_batch b ON b.id=m.batch_id
WHERE m.workspace_id=$1 AND m.status='completed' AND b.published;

-- name: PersistCTFBatchBoard :exec
UPDATE ctf_batch SET leaderboard=COALESCE(leaderboard,sqlc.arg(payload)::jsonb) WHERE workspace_id=$1 AND id=$2;

-- name: GetCTFBatchBoard :one
SELECT leaderboard FROM ctf_batch WHERE workspace_id=$1 AND id=$2 AND published;
