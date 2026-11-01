-- name: UpsertAgentBuilderDraft :one
INSERT INTO agent_builder_draft (chat_session_id, workspace_id, draft)
VALUES (@chat_session_id, @workspace_id, @draft)
ON CONFLICT (chat_session_id) DO UPDATE
SET draft = EXCLUDED.draft,
    updated_at = now()
RETURNING *;





-- name: DeleteAgentBuilderDraft :exec
DELETE FROM agent_builder_draft WHERE chat_session_id = $1;





-- name: DeleteAgentBuilderDraftsBySystemRuntimeAgents :exec
DELETE FROM agent_builder_draft
WHERE chat_session_id IN (
    SELECT cs.id FROM chat_session cs
    JOIN agent a ON a.id = cs.agent_id
    WHERE a.runtime_id = $1 AND a.kind = 'system'
);
