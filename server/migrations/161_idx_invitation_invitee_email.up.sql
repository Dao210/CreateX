CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invitation_invitee_email ON workspace_invitation USING btree (invitee_email) WHERE (status = 'pending'::text);
