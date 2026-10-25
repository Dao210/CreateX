package main

import "github.com/spf13/cobra"

var tanksCmd = &cobra.Command{Use: "tanks", Short: "Create characters and launch Auro tank defense"}
var tanksMCPCmd = &cobra.Command{
	Use: "mcp", Short: "Serve tank character tools over MCP stdio", Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := newAPIClient(cmd)
		if err != nil {
			return err
		}
		return client.ServeTankMCP(cmd.Context(), cmd.InOrStdin(), cmd.OutOrStdout())
	},
}

func init() { tanksCmd.AddCommand(tanksMCPCmd) }
