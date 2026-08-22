package wealth_test

import (
	"context"
	"strings"
	"testing"

	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	testutil "tallyo/internal/utils/test"
	. "tallyo/internal/wealth"
)

func TestCreateAssetValidatesInputs(t *testing.T) {
	tests := []struct {
		name    string
		input   model.CreateAssetInput
		wantErr string
	}{
		{
			name: "currency rejects public classifier",
			input: model.CreateAssetInput{
				AssetType:  model.AssetTypeCurrency,
				Identifier: "BAD-CASH",
				Classifier: model.AssetClassifierPublic,
			},
			wantErr: "classifier",
		},
		{
			name: "security rejects crypto classifier",
			input: model.CreateAssetInput{
				AssetType:  model.AssetTypeSecurity,
				Identifier: "BAD-SEC",
				Classifier: model.AssetClassifierCryptocurrency,
			},
			wantErr: "classifier",
		},
		{
			name: "crypto rejects public classifier",
			input: model.CreateAssetInput{
				AssetType:  model.AssetTypeCrypto,
				Identifier: "BAD-CRYPTO",
				Classifier: model.AssetClassifierPublic,
			},
			wantErr: "classifier",
		},
		{
			name: "real estate rejected",
			input: model.CreateAssetInput{
				AssetType:  model.AssetTypeRealEstate,
				Identifier: "HOME",
				Classifier: model.AssetClassifierRealEstate,
			},
			wantErr: "real estate assets are created through linked real estate accounts",
		},
		{
			name: "security details rejected for crypto",
			input: model.CreateAssetInput{
				AssetType:  model.AssetTypeCrypto,
				Identifier: "BTC",
				Classifier: model.AssetClassifierCryptocurrency,
				Security:   &model.CreateSecurityAssetInput{},
			},
			wantErr: "security details are only supported for security assets",
		},
		{
			name: "tracking rejected for crypto",
			input: model.CreateAssetInput{
				AssetType:      model.AssetTypeCrypto,
				Identifier:     "ETH",
				Classifier:     model.AssetClassifierCryptocurrency,
				TrackingTicker: new(string),
			},
			wantErr: "tracking ticker is only supported",
		},
		{
			name: "tracking multiplier must be positive",
			input: model.CreateAssetInput{
				AssetType:          model.AssetTypeSecurity,
				Identifier:         "NEG",
				Classifier:         model.AssetClassifierPublic,
				TrackingMultiplier: new(float64),
			},
			wantErr: "tracking multiplier must be a finite number greater than zero",
		},
		{
			name: "other accepts real estate classifier",
			input: model.CreateAssetInput{
				AssetType:  model.AssetTypeOther,
				Identifier: "OTHER-HOME",
				Classifier: model.AssetClassifierRealEstate,
			},
		},
		{
			name: "company equity accepts tracking",
			input: model.CreateAssetInput{
				AssetType:          model.AssetTypeSecurity,
				Identifier:         "PRIVATE",
				Classifier:         model.AssetClassifierCompanyEquity,
				TrackingTicker:     new(string),
				TrackingMultiplier: new(float64),
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := context.Background()
			store := openWealthTestStore(t)
			if tt.input.TrackingTicker != nil && *tt.input.TrackingTicker == "" {
				*tt.input.TrackingTicker = "SPY"
			}
			if tt.input.TrackingMultiplier != nil && *tt.input.TrackingMultiplier == 0 && tt.wantErr == "" {
				*tt.input.TrackingMultiplier = 1
			}

			_, err := (&Service{Store: store, Log: testutil.Logger, PriceProvider: testutil.LastKnownPriceProvider{}}).CreateAsset(ctx, tt.input)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("CreateAsset() error = %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("CreateAsset() error = %v, want containing %q", err, tt.wantErr)
			}
		})
	}
}

func TestCreateAssetRejectsDuplicateIdentifier(t *testing.T) {
	ctx := context.Background()
	store := openWealthTestStore(t)
	created := mustUpsertAsset(t, store, AssetUpsert{
		AssetType:  model.AssetTypeSecurity,
		Identifier: "AAPL",
		Classifier: model.AssetClassifierPublic,
	})

	_, err := (&Service{Store: store, Log: testutil.Logger, PriceProvider: testutil.LastKnownPriceProvider{}}).CreateAsset(ctx, model.CreateAssetInput{
		AssetType:  model.AssetTypeSecurity,
		Identifier: "AAPL",
		Classifier: model.AssetClassifierCompanyEquity,
	})
	if err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("CreateAsset() error = %v, want duplicate error", err)
	}
	unchanged, err := store.AssetByID(ctx, created.ID.Int64())
	must.NoErr(t, err)
	if unchanged.Classifier != model.AssetClassifierPublic {
		t.Fatalf("classifier = %q, want PUBLIC", unchanged.Classifier)
	}
}
