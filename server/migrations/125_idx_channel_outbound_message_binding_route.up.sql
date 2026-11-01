CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_outbound_message_binding_route ON channel_outbound_message USING btree (binding_id, route_revision);
