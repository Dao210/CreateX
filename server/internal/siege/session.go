package siege

// Session is the whole persisted document for one member: blueprints plus the
// idempotency receipts that make create/recognize/save safe to retry.
//
// Both stores persist this as a single document (a JSON file, or one jsonb
// column) because every read and write touches the session as a unit.
type Session struct {
	ID                  string        `json:"id"`
	Version             int           `json:"version"`
	Blueprints          []Blueprint   `json:"blueprints"`
	OwnerHash           string        `json:"ownerHash"`
	CreateRequest       string        `json:"createRequest"`
	RecognitionReceipts []receipt     `json:"recognitionReceipts"`
	SaveReceipts        []saveReceipt `json:"saveReceipts"`
}

type Blueprint struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	Drawing      Drawing       `json:"drawing"`
	Spec         Spec          `json:"spec"`
	RulesVersion string        `json:"rulesVersion"`
	CreatedAt    string        `json:"createdAt"`
	CannonDesign *CannonDesign `json:"cannonDesign,omitempty"`
}

type Recognition struct {
	RequestID   string `json:"requestId"`
	DrawingHash string `json:"drawingHash"`
	State       string `json:"state"`
	Spec        *Spec  `json:"spec"`
	Code        string `json:"code"`
	Source      string `json:"source"`
	PayloadHash string `json:"-"`
}

type receipt struct {
	View         Recognition `json:"view"`
	Hash         string      `json:"hash"`
	CreatedAt    int64       `json:"createdAt"`
	InputTokens  int64       `json:"inputTokens"`
	OutputTokens int64       `json:"outputTokens"`
}

type saveReceipt struct {
	RequestID string `json:"requestId"`
	Hash      string `json:"hash"`
}

// public is the wire shape. OwnerHash, receipts and createRequest stay internal:
// they are retry bookkeeping, not client state.
func (s *Session) public() any {
	return struct {
		ID         string      `json:"id"`
		Version    int         `json:"version"`
		Blueprints []Blueprint `json:"blueprints"`
	}{s.ID, s.Version, s.Blueprints}
}
