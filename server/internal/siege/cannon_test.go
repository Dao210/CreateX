package siege

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

func TestCannonKitStorageAndSharedGeometry(t *testing.T) {
	data, err := os.ReadFile("../../../packages/core/siege/fixtures/cannon-design-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		CannonDesign CannonDesign `json:"cannonDesign"`
		Drawing      Drawing      `json:"drawing"`
		Spec         Spec         `json:"spec"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	service, id, owner := setup(t, &countedModel{})
	in := SaveInput{RequestID: uuid.NewString(), ExpectedVersion: 1, Name: "林地守卫炮", Drawing: fixture.Drawing, Spec: fixture.Spec, CannonDesign: &fixture.CannonDesign}
	session, err := service.Save(id, owner, in)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(session.Blueprints[0].CannonDesign, in.CannonDesign) {
		t.Fatal("lost kit parameters")
	}
	saved, err := service.Read(id, owner)
	if err != nil || !reflect.DeepEqual(saved.Blueprints[0].CannonDesign, in.CannonDesign) {
		t.Fatalf("restore: %v", err)
	}
	if session, err = service.Save(id, owner, in); err != nil || len(session.Blueprints) != 1 {
		t.Fatalf("replay: %v", err)
	}
	in.RequestID, in.ExpectedVersion = uuid.NewString(), 2
	in.CannonDesign.BarrelLengthMm = 3200
	if _, err = service.Save(id, owner, in); err == nil || err.Error() != "cannon_design_mismatch" {
		t.Fatalf("mismatch: %v", err)
	}
	in.CannonDesign.Version = 99
	if _, err = service.Save(id, owner, in); err == nil || err.Error() != "invalid_cannon_design" {
		t.Fatalf("unsupported kit: %v", err)
	}
	if session, err = service.Read(id, owner); err != nil || session.Version != 2 || len(session.Blueprints) != 1 {
		t.Fatalf("failed writes changed storage: %v", err)
	}
}
