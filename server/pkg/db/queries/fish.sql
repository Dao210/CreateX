-- name: ListFish :many
SELECT payload, archived FROM fish_character WHERE workspace_id=$1 AND user_id=$2 ORDER BY updated_at DESC,id;

-- name: GetFish :one
SELECT payload, archived FROM fish_character WHERE workspace_id=$1 AND user_id=$2 AND id=$3;

-- name: GetFishRevision :one
SELECT payload FROM fish_revision WHERE workspace_id=$1 AND user_id=$2 AND fish_id=$3 AND revision=$4;

-- name: PutFish :exec
INSERT INTO fish_character (id,workspace_id,user_id,revision,payload) VALUES ($1,$2,$3,$4,$5)
ON CONFLICT (id) DO UPDATE SET revision=EXCLUDED.revision,payload=EXCLUDED.payload,updated_at=now();

-- name: InsertFishRevision :exec
INSERT INTO fish_revision (fish_id,workspace_id,user_id,revision,payload) VALUES ($1,$2,$3,$4,$5);

-- name: CountFish :one
SELECT count(*) FROM fish_character WHERE workspace_id=$1 AND user_id=$2;

-- name: SetFishArchived :exec
UPDATE fish_character SET archived=$4 WHERE workspace_id=$1 AND user_id=$2 AND id=$3;

-- name: EnsureFishOcean :exec
INSERT INTO fish_ocean (id,workspace_id,user_id) VALUES ($1,$2,$3) ON CONFLICT (workspace_id,user_id) DO NOTHING;

-- name: GetFishOcean :one
SELECT * FROM fish_ocean WHERE workspace_id=$1 AND id=$2;

-- name: GetMyFishOcean :one
SELECT * FROM fish_ocean WHERE workspace_id=$1 AND user_id=$2;

-- name: ListFishResidents :many
SELECT payload FROM fish_resident WHERE workspace_id=$1 AND ocean_id=$2 AND active=true ORDER BY id;

-- name: GetFishResident :one
SELECT * FROM fish_resident WHERE workspace_id=$1 AND user_id=$2 AND id=$3;

-- name: FindFishResident :one
SELECT * FROM fish_resident WHERE workspace_id=$1 AND ocean_id=$2 AND fish_id=$3;

-- name: PutFishResident :exec
INSERT INTO fish_resident (id,workspace_id,user_id,ocean_id,fish_id,revision,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)
ON CONFLICT (id) DO UPDATE SET revision=EXCLUDED.revision,payload=EXCLUDED.payload,active=true;

-- name: RecallFishResident :exec
UPDATE fish_resident SET active=false, revision=revision+1 WHERE workspace_id=$1 AND user_id=$2 AND id=$3;

-- name: UpdateFishOcean :exec
UPDATE fish_ocean SET revision=revision+1,visibility=$3 WHERE workspace_id=$1 AND id=$2;

-- name: GetFishRequest :one
SELECT body_hash,response FROM fish_request WHERE workspace_id=$1 AND user_id=$2 AND operation=$3 AND request_id=$4;

-- name: InsertFishRequest :exec
INSERT INTO fish_request (workspace_id,user_id,operation,request_id,body_hash,response) VALUES ($1,$2,$3,$4,$5,$6);

-- name: PruneFishRequests :exec
DELETE FROM fish_request WHERE workspace_id=$1 AND user_id=$2 AND created_at < now()-interval '7 days';
