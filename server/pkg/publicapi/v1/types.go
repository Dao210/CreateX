package publicapiv1

// Context is Plugin-specific bootstrap data. It lives in the versioned
// contract package so service-layer fields cannot leak into the wire format.
type Context struct {
	Workspace         ContextWorkspace `json:"workspace"`
	User              *ContextUser     `json:"user,omitempty"`
	Config            map[string]any   `json:"config"`
	GrantedNetDomains []string         `json:"granted_net_domains"`
	Actor             string           `json:"actor"`
}

type ContextWorkspace struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
}

type ContextUser struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type StorageKey struct {
	Key       string `json:"key"`
	SizeBytes int64  `json:"size_bytes"`
	UpdatedAt string `json:"updated_at"`
}

type StorageKeyListResponse struct {
	Keys []StorageKey `json:"keys"`
}

type StorageValueResponse struct {
	Value string `json:"value"`
}

type PutStorageValueRequest struct {
	Value string `json:"value"`
}
