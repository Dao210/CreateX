package daemon

func testTaskStartClaim(task Task) Task {
	if task.RuntimeID == "" {
		task.RuntimeID = "test-runtime"
	}
	if task.DispatchedAt == "" {
		task.DispatchedAt = "2026-11-02T00:00:00Z"
	}
	task.StartClaimSupported = true
	return task
}
