package tanks

import "testing"

func TestNormalizeCharacterKeepsMCPSource(t *testing.T) {
	manual := Character{}
	normalizeCharacter(&manual)
	if manual.Origin != OriginManual {
		t.Fatalf("empty origin=%q", manual.Origin)
	}
	mcp := Character{Origin: OriginMCP}
	normalizeCharacter(&mcp)
	if mcp.Origin != OriginMCP {
		t.Fatalf("mcp origin=%q", mcp.Origin)
	}
	unknown := Character{Origin: "imported"}
	normalizeCharacter(&unknown)
	if unknown.Origin != OriginManual {
		t.Fatalf("unknown origin=%q", unknown.Origin)
	}
}
