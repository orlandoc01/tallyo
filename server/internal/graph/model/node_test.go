package model

import "testing"

func TestNodeImplementationsReturnID(t *testing.T) {
	assetID := New(GlobalIDAsset, 1)
	asset := Asset{ID: assetID}
	asset.IsNode()
	if asset.GetID() != assetID {
		t.Fatalf("Asset.GetID() = %q", asset.GetID())
	}

	connectionID := New(GlobalIDConnection, 1)
	connection := Connection{ID: connectionID}
	connection.IsNode()
	if connection.GetID() != connectionID {
		t.Fatalf("Connection.GetID() = %q", connection.GetID())
	}
}
