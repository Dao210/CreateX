package main

import "github.com/spf13/cobra"

var fishCmd = &cobra.Command{Use: "fish", Short: "Create fish and release them into a world ocean"}
var fishMCPCmd = &cobra.Command{
	Use: "mcp", Short: "Serve fish creation and ocean tools over MCP stdio", Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := newAPIClient(cmd)
		if err != nil {
			return err
		}
		return client.ServeFishMCP(cmd.Context(), cmd.InOrStdin(), cmd.OutOrStdout())
	},
}

func init() { fishCmd.AddCommand(fishMCPCmd) }
