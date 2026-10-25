package metrics

import "testing"

func TestRegistryExcludesDatabaseSampledMetrics(t *testing.T) {
	registry := NewRegistry(RegistryOptions{})
	families, err := registry.Gatherer.Gather()
	if err != nil {
		t.Fatalf("gather metrics: %v", err)
	}

	retired := map[string]struct{}{
		"auro_agent_task_queued":                               {},
		"auro_agent_task_running":                              {},
		"auro_agent_task_stuck_total":                          {},
		"auro_business_sampler_query_errors_total":             {},
		"auro_business_sampler_query_seconds":                  {},
		"auro_workspace_total":                                 {},
		"auro_seat_capacity_outbox_pending":                    {},
		"auro_seat_capacity_outbox_dead_lettered":              {},
		"auro_seat_capacity_outbox_oldest_pending_age_seconds": {},
		"auro_channel_media_pending_objects":                   {},
		"auro_channel_media_tombstoned_objects":                {},
		"auro_runtime_gc_blocked_observation_failed_total":     {},
		"auro_runtime_gc_blocked_runtimes":                     {},
		"auro_runtime_gc_backlog_runtimes":                     {},
	}
	for _, family := range families {
		if _, found := retired[family.GetName()]; found {
			t.Errorf("retired database-sampled metric %q is still registered", family.GetName())
		}
	}
}
