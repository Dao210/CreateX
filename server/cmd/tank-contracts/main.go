// Command tank-contracts exports the same public schemas served by MCP tools/list.
package main

import (
	"encoding/json"
	"os"

	"github.com/auro-ai/auro/server/internal/tanks"
)

func main() {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(map[string]any{"tools": tanks.Tools()}); err != nil {
		panic(err)
	}
}
