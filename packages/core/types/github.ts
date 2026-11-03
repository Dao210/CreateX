

export interface GitHubInstallation {
  id: string;
  workspace_id: string;
  /** GitHub's numeric installation id — the management handle used by the
   * connect / disconnect flows. Omitted when the caller cannot manage
   * integrations (see `ListGitHubInstallationsResponse.can_manage`). */
  installation_id?: number;
  account_login: string;
  account_type: "User" | "Organization";
  account_avatar_url: string | null;
  created_at: string;
  /** Display name of the workspace member who connected this installation.
   * Optional because older backends and minimum-visibility deployments may
   * omit it; the UI renders the "connected by" line only when present. */
  connected_by?: string;
}

export interface ListGitHubInstallationsResponse {
  installations: GitHubInstallation[];
  /** Whether the deployment has GitHub App credentials configured. When false, the Connect button is hidden / disabled. */
  configured: boolean;
  /** Whether the server can mint installation tokens to browse repositories.
   * Older backends omit this field; callers must treat absence as false. */
  repository_browse_configured?: boolean;
  /** Whether the caller can connect / disconnect installations. Non-admin
   * members get `false` along with installations that omit `installation_id`.
   * Older backends predating MUL-2413 omit the field; treat absence as
   * `false` for read-only safety. */
  can_manage?: boolean;
}

export interface GitHubConnectResponse {
  /** The GitHub App install URL the browser should open. Empty when `configured` is false. */
  url?: string;
  configured: boolean;
}

export interface GitHubRepository {
  id: number;
  full_name: string;
  html_url: string;
  clone_url: string;
  description: string | null;
  private: boolean;
  archived: boolean;
  default_branch: string;
}

export interface ListGitHubRepositoriesResponse {
  repositories: GitHubRepository[];
  total_count: number;
  next_page: number | null;
}
