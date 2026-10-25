package llm

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func serverSources(t *testing.T, inspect func(string, *ast.File)) {
	t.Helper()
	root := filepath.Clean("../..")
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.SkipObjectResolution)
		if err != nil {
			return err
		}
		inspect(filepath.ToSlash(rel), file)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestOpenAISDKIsImportedOnlyByThisPackage(t *testing.T) {
	serverSources(t, func(path string, file *ast.File) {
		for _, spec := range file.Imports {
			importPath, err := strconv.Unquote(spec.Path.Value)
			if err != nil {
				t.Fatal(err)
			}
			if strings.HasPrefix(importPath, "github.com/openai/openai-go") && !strings.HasPrefix(path, "pkg/llm/") {
				t.Errorf("%s imports the model SDK outside pkg/llm", path)
			}
		}
	})
}

func TestDocumentedConsumersAreTheOnlyCallers(t *testing.T) {
	consumers := map[string]bool{
		"internal/handler/chat_title.go":                  false,
		"internal/service/chat_quick_actions_generate.go": false,
		"internal/deal/model.go":                          false,
		"internal/siege/recognition.go":                   false,
	}
	serverSources(t, func(path string, file *ast.File) {
		if strings.HasSuffix(path, "_test.go") || strings.HasPrefix(path, "pkg/llm/") {
			return
		}
		ast.Inspect(file, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			selector, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || (selector.Sel.Name != "Chat" && selector.Sel.Name != "ChatStream" && selector.Sel.Name != "GenerateText" && selector.Sel.Name != "GenerateJSON" && selector.Sel.Name != "GenerateVisionJSON") {
				return true
			}
			if _, known := consumers[path]; !known {
				t.Errorf("undocumented model call in %s", path)
			} else {
				consumers[path] = true
			}
			return true
		})
	})
	doc, err := os.ReadFile("client.go")
	if err != nil {
		t.Fatal(err)
	}
	for path, called := range consumers {
		if !called || !strings.Contains(string(doc), "server/"+path) {
			t.Errorf("consumer %s must have a call and a package-doc entry", path)
		}
	}
}
