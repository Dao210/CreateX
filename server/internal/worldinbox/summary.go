package worldinbox

import (
	"sort"
	"time"
)

func summarize(entries []Entry, start, end time.Time) Content {
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].OccurredAt.Equal(entries[j].OccurredAt) {
			return entries[i].ID < entries[j].ID
		}
		return entries[i].OccurredAt.After(entries[j].OccurredAt)
	})
	c := Content{Entries: entries, TotalEntries: len(entries), WindowStart: &start, WindowEnd: &end}
	for _, e := range entries {
		switch e.Kind {
		case "tank_created":
			c.Totals.Created++
		case "tank_updated":
			c.Totals.Updated++
		case "tank_level_up":
			c.Totals.Milestones++
		case "resident_goal_reached":
			c.Totals.Residents++
		}
	}
	if len(c.Entries) > 12 {
		c.Entries = c.Entries[:12]
	}
	return c
}
