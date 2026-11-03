// Package eventcontract names business facts independently of plugins or transport.
package eventcontract

const (
	EventTaskQueued                = "task.queued"
	EventTaskDispatched            = "task.dispatched"
	EventTaskDeferred              = "task.deferred"
	EventTaskWaitingLocalDirectory = "task.waiting_local_directory"
	EventTaskStarted               = "task.started"
	EventTaskCompleted             = "task.completed"
	EventTaskFailed                = "task.failed"
	EventTaskCancelled             = "task.cancelled"
)

// TaskEvent translates persisted states to the public vocabulary.
func TaskEvent(status string) string {
	switch status {
	case "running":
		return EventTaskStarted
	case "queued", "dispatched", "deferred", "waiting_local_directory", "completed", "failed", "cancelled":
		return "task." + status
	default:
		return ""
	}
}
