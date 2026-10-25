package deal

import "time"

const ScenarioVersion = "the-debt@1"
const RulesVersion = "marco@1"

type Input struct {
	RequestID       string `json:"request_id"`
	ExpectedVersion int    `json:"expected_version"`
	Kind            string `json:"kind"`
	Text            string `json:"text,omitempty"`
	ItemID          string `json:"item_id,omitempty"`
	Action          string `json:"action,omitempty"`
}

type Assertion struct {
	Key   string `json:"key"`
	Value string `json:"value"`
	Scope string `json:"scope"`
	Quote string `json:"quote"`
}

type Interpretation struct {
	Act      string      `json:"act"`
	Topic    string      `json:"topic"`
	Proposal string      `json:"proposal"`
	Days     int         `json:"days"`
	Claims   []Assertion `json:"claims"`
}

type Claim struct {
	Assertion
	Turn         int   `json:"turn"`
	Resolved     bool  `json:"resolved"`
	ResolvedBy   int   `json:"resolved_by,omitempty"`
	ConflictWith []int `json:"conflict_with,omitempty"`
}

type Belief struct {
	Confidence int      `json:"confidence"`
	Sources    []string `json:"sources"`
}

type Psychology struct {
	Trust        int `json:"trust"`
	FearPlayer   int `json:"fear_player"`
	FearVictor   int `json:"fear_victor"`
	Anger        int `json:"anger"`
	Greed        int `json:"greed"`
	Suspicion    int `json:"suspicion"`
	Respect      int `json:"respect"`
	Loyalty      int `json:"loyalty"`
	EscapeDesire int `json:"escape_desire"`
}

type ObjectState struct {
	Seen  bool `json:"seen"`
	Shown bool `json:"shown"`
	Given bool `json:"given"`
}

type Entry struct {
	TimeCost    int      `json:"time_cost"`
	Turn        int      `json:"turn"`
	Player      string   `json:"player"`
	Dialogue    string   `json:"dialogue"`
	Reaction    string   `json:"reaction"`
	Pose        string   `json:"pose"`
	Discoveries []string `json:"discoveries"`
	Action      string   `json:"action"`
}

type Receipt struct {
	Input          Input          `json:"input"`
	Interpretation Interpretation `json:"interpretation"`
	Entry          Entry          `json:"entry"`
}

type Session struct {
	ID               string                 `json:"id"`
	OwnerHash        string                 `json:"owner_hash"`
	Version          int                    `json:"version"`
	ScenarioVersion  string                 `json:"scenario_version"`
	RulesVersion     string                 `json:"rules_version"`
	CreatedAt        time.Time              `json:"created_at"`
	Remaining        int                    `json:"remaining"`
	Paid             int                    `json:"paid"`
	Psych            Psychology             `json:"psychology"`
	Items            map[string]ObjectState `json:"items"`
	Beliefs          map[string]Belief      `json:"beliefs"`
	Claims           []Claim                `json:"claims"`
	Processed        map[string]bool        `json:"processed"`
	Discoveries      []string               `json:"discoveries"`
	ContractVerified bool                   `json:"contract_verified"`
	MarcoAway        bool                   `json:"marco_away"`
	LedgerBackup     bool                   `json:"ledger_backup"`
	Leverage         bool                   `json:"leverage"`
	DaughterWarnings int                    `json:"daughter_warnings"`
	Ending           string                 `json:"ending"`
	PendingOffer     string                 `json:"pending_offer"`
	Receipts         []Receipt              `json:"receipts"`
}

type ItemView struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Owner       string   `json:"owner"`
	Description string   `json:"description"`
	Content     string   `json:"content,omitempty"`
	Seen        bool     `json:"seen"`
	Shown       bool     `json:"shown"`
	Given       bool     `json:"given"`
	Actions     []string `json:"actions"`
}

type EndingView struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	Summary  string   `json:"summary"`
	Reasons  []string `json:"reasons"`
	Profile  string   `json:"profile"`
	Promises []string `json:"promises"`
}

type PublicSession struct {
	ID              string      `json:"id"`
	Version         int         `json:"version"`
	ScenarioVersion string      `json:"scenario_version"`
	Remaining       int         `json:"remaining_seconds"`
	Debt            int         `json:"debt_remaining"`
	Cash            int         `json:"cash"`
	Pose            string      `json:"pose"`
	Dialogue        string      `json:"dialogue"`
	Reaction        string      `json:"reaction"`
	MarcoAway       bool        `json:"marco_away"`
	Items           []ItemView  `json:"items"`
	Discoveries     []string    `json:"discoveries"`
	History         []Entry     `json:"history"`
	Ending          *EndingView `json:"ending"`
}

type Line struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

type Performance struct {
	Action   string
	Pose     string
	Reaction string
	Lines    []Line
}

type Problem struct {
	Code   string
	Status int
}

func (p *Problem) Error() string            { return p.Code }
func problem(code string, status int) error { return &Problem{Code: code, Status: status} }
