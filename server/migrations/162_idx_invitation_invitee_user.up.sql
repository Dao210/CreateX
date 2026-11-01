CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invitation_invitee_user ON workspace_invitation USING btree (invitee_user_id) WHERE (status = 'pending'::text);
