package service

import (
	"github.com/auro-ai/auro/server/internal/events"
	"github.com/auro-ai/auro/server/pkg/plugincontract"
	"github.com/auro-ai/auro/server/pkg/protocol"
)

// Translating the internal event bus into the execution events a plugin may
// subscribe to.
//
// Two vocabularies on purpose. The internal names are realtime transport
// concerns and change when the frontend needs them to; the plugin names are a
// published contract. Mapping in one place means a rename on our side is a
// change to this file rather than a break in every installed plugin.

// EventSink is the half of the dispatcher the bridge needs.
//
// An interface so the vocabulary mapping can be tested without a network: what
// this file decides is WHICH plugin event an internal one becomes, and that is
// worth asserting on its own rather than through a live endpoint.
type EventSink interface {
	Dispatch(eventType, workspaceID string, payload any)
}

// SubscribePluginEvents wires the dispatcher onto the bus.
//
// Bus.Publish calls its listeners INLINE, on the goroutine of the request that
// published — so everything these closures do must be cheap and non-blocking.
// They extract an id and hand off; the network call happens on a worker.
func SubscribePluginEvents(bus *events.Bus, dispatcher EventSink) {
	if bus == nil || dispatcher == nil {
		return
	}

	// Forward the payload without inspecting it on the publishing goroutine.
	forward := func(pluginEvent string) events.Handler {
		return func(e events.Event) {
			dispatcher.Dispatch(pluginEvent, e.WorkspaceID, e.Payload)
		}
	}

	bus.Subscribe(protocol.EventTaskRunning, forward(plugincontract.EventTaskStarted))
	bus.Subscribe(protocol.EventTaskCompleted, forward(plugincontract.EventTaskCompleted))
	bus.Subscribe(protocol.EventTaskFailed, forward(plugincontract.EventTaskFailed))
}
