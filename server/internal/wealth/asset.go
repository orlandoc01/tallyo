package wealth

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	"tallyo/internal/apierror"
	"tallyo/internal/graph/model"

	"github.com/samber/lo"
)

func (s *Service) CreateAsset(ctx context.Context, input model.CreateAssetInput) (*model.Asset, error) {
	identifier := strings.TrimSpace(input.Identifier)
	if identifier == "" {
		return nil, apierror.Publicf("identifier is required")
	}
	if input.AssetType == model.AssetTypeRealEstate {
		return nil, apierror.Publicf("real estate assets are created through linked real estate accounts")
	}
	if err := validateCreateAssetClassifier(input.AssetType, input.Classifier); err != nil {
		return nil, err
	}
	if input.Security != nil && input.AssetType != model.AssetTypeSecurity {
		return nil, apierror.Publicf("security details are only supported for security assets")
	}

	trackingTicker := lo.EmptyableToPtr(strings.TrimSpace(lo.FromPtr(input.TrackingTicker)))
	trackingMultiplier := lo.FromPtrOr(input.TrackingMultiplier, 1)
	if err := validateCreateAssetTracking(input, identifier, trackingTicker, trackingMultiplier); err != nil {
		return nil, err
	}
	trackingTicker, trackingMultiplier = NormalizeTracking(identifier, trackingTicker, trackingMultiplier)
	if existing, err := s.Store.AssetByKey(ctx, input.AssetType, identifier); err != nil {
		return nil, fmt.Errorf("lookup asset: %w", err)
	} else if existing != nil {
		return nil, apierror.Publicf("an asset with identifier %q already exists for type %q", identifier, input.AssetType)
	}

	asset := createAssetUpsert(input, identifier, trackingTicker, trackingMultiplier)
	if input.AssetType == model.AssetTypeSecurity && input.ForcedUsdPrice == nil {
		asset.LastPrice, asset.LastPriceAt = s.createAssetMarketPrice(ctx, &model.Asset{
			AssetType:          input.AssetType,
			Identifier:         identifier,
			TrackingTicker:     trackingTicker,
			TrackingMultiplier: trackingMultiplier,
		})
	}

	created, err := s.Store.UpsertAsset(ctx, asset)
	if err != nil {
		return nil, fmt.Errorf("create asset: %w", err)
	}
	return created, nil
}

func createAssetUpsert(
	input model.CreateAssetInput,
	identifier string,
	trackingTicker *string,
	trackingMultiplier float64,
) AssetUpsert {
	return AssetUpsert{
		AssetType:          input.AssetType,
		Identifier:         identifier,
		Name:               lo.EmptyableToPtr(strings.TrimSpace(lo.FromPtr(input.Name))),
		Classifier:         input.Classifier,
		UserEdited:         true,
		UserCreated:        true,
		ForcedUSDPrice:     input.ForcedUsdPrice,
		TrackingTicker:     trackingTicker,
		TrackingMultiplier: trackingMultiplier,
		CUSIP:              securityCUSIP(input.Security),
		ISIN:               securityISIN(input.Security),
	}
}

func validateCreateAssetClassifier(assetType model.AssetType, classifier model.AssetClassifier) error {
	allowed := map[model.AssetType][]model.AssetClassifier{
		model.AssetTypeCurrency: {model.AssetClassifierCash},
		model.AssetTypeSecurity: {model.AssetClassifierPublic, model.AssetClassifierCompanyEquity},
		model.AssetTypeCrypto:   {model.AssetClassifierCryptocurrency, model.AssetClassifierStablecoin},
		model.AssetTypeOther: {
			model.AssetClassifierCash,
			model.AssetClassifierPublic,
			model.AssetClassifierCompanyEquity,
			model.AssetClassifierCryptocurrency,
			model.AssetClassifierStablecoin,
			model.AssetClassifierRealEstate,
		},
	}
	if slices.Contains(allowed[assetType], classifier) {
		return nil
	}
	return apierror.Publicf("classifier %q is not valid for asset type %q", classifier, assetType)
}

func validateCreateAssetTracking(input model.CreateAssetInput, identifier string, trackingTicker *string, trackingMultiplier float64) error {
	trackingSupplied := trackingTicker != nil || input.TrackingMultiplier != nil
	if !trackingSupplied {
		return nil
	}
	if input.AssetType != model.AssetTypeSecurity || !supportsTracking(input.Classifier) {
		return apierror.Publicf("tracking ticker is only supported for public or company-equity security assets")
	}
	if err := validateTrackingMultiplier(trackingMultiplier); err != nil {
		return err
	}
	resolvedTicker, _ := NormalizeTracking(identifier, trackingTicker, trackingMultiplier)
	if resolvedTicker == nil && input.TrackingMultiplier != nil && trackingMultiplier != 1 {
		return apierror.Publicf("tracking multiplier requires a tracking ticker different from the identifier")
	}
	return nil
}

func (s *Service) createAssetMarketPrice(ctx context.Context, asset *model.Asset) (*float64, *time.Time) {
	price, err := s.PriceProvider.PriceAt(ctx, asset, time.Now())
	if err != nil {
		s.Log.Warn("create asset: price fetch failed", "identifier", asset.Identifier, "error", err)
		return nil, nil
	}
	if price <= 0 {
		s.Log.Warn("create asset: skipping non-positive price", "identifier", asset.Identifier, "price", price)
		return nil, nil
	}
	now := time.Now().UTC()
	return &price, &now
}

func securityCUSIP(input *model.CreateSecurityAssetInput) *string {
	security := lo.FromPtr(input)
	return lo.EmptyableToPtr(strings.TrimSpace(lo.FromPtr(security.Cusip)))
}

func securityISIN(input *model.CreateSecurityAssetInput) *string {
	security := lo.FromPtr(input)
	return lo.EmptyableToPtr(strings.TrimSpace(lo.FromPtr(security.Isin)))
}

func (s *Service) UpdateAsset(ctx context.Context, input model.UpdateAssetInput) (*model.Asset, error) {
	assetID := input.ID.Int64()
	existing, err := s.Store.AssetByID(ctx, assetID)
	if err != nil {
		return nil, fmt.Errorf("read existing asset: %w", err)
	}
	if existing == nil {
		return nil, apierror.Publicf("asset %d not found", assetID)
	}

	identifierChanging := input.Identifier != nil && *input.Identifier != existing.Identifier
	trackingChanging, err := s.resolveTrackingInput(ctx, &input, existing)
	if err != nil {
		return nil, err
	}

	asset, err := s.Store.UpdateAsset(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("update asset: %w", err)
	}
	forcedPriceSet, forcedPriceCleared := forcedPriceChange(input)
	if price, ok := forcedPriceValue(input); ok {
		if err := s.Store.RevalueLatestAssetHoldings(ctx, asset.ID.Int64(), price); err != nil {
			s.Log.Warn("update asset: revalue forced price holdings failed", "asset_id", asset.ID.Int64(), "error", err)
		}
	}
	if forcedPriceCleared && !identifierChanging && !trackingChanging {
		if price, ok := s.marketPriceValue(ctx, asset); ok {
			if err := s.Store.RevalueLatestAssetHoldings(ctx, asset.ID.Int64(), price); err != nil {
				s.Log.Warn("update asset: revalue cleared forced price holdings failed", "asset_id", asset.ID.Int64(), "error", err)
			}
		}
	}

	if (identifierChanging || trackingChanging) && !forcedPriceSet && asset.ForcedUsdPrice == nil {
		asset, err = s.refreshChangedAssetMarketPrice(ctx, input, asset)
		if err != nil {
			return nil, err
		}
	}

	return asset, nil
}

// resolveTrackingInput recomputes the canonical tracking ticker/multiplier
// pair whenever identifier, classifier, ticker, or multiplier could change it
// (an identifier or classifier edit can turn an existing custom tracker into
// a self-reference or leave it on an unsupported classifier), and assigns
// both fields to input as a pair only when the resolved pair differs
// semantically from what's stored. Otherwise it leaves both fields nil so the
// store neither clears nor re-fetches the market price. Yahoo priceability is
// validated only for a genuinely changed, non-nil ticker, so resubmitting an
// already-valid tracker (e.g. a whitespace-padded no-op) doesn't re-probe the
// price provider. It reports whether the resolved pair changed.
func (s *Service) resolveTrackingInput(ctx context.Context, input *model.UpdateAssetInput, existing *model.Asset) (bool, error) {
	identifierChanging := input.Identifier != nil && *input.Identifier != existing.Identifier
	classifierChanging := input.Classifier != nil && *input.Classifier != existing.Classifier
	fieldsSupplied := input.TrackingTicker != nil || input.TrackingMultiplier != nil
	if !identifierChanging && !classifierChanging && !fieldsSupplied {
		return false, nil
	}

	fields, err := combineTrackingFields(*input, existing)
	if err != nil {
		return false, err
	}
	if trackingPairEqual(existing, fields.Ticker, fields.Multiplier) {
		input.TrackingTicker = nil
		input.TrackingMultiplier = nil
		return false, nil
	}

	if fields.Ticker != nil {
		tempAsset := &model.Asset{AssetType: existing.AssetType, Identifier: fields.Identifier, TrackingTicker: fields.Ticker, TrackingMultiplier: fields.Multiplier}
		if err := s.validateTickerPriceable(ctx, tempAsset); err != nil {
			return false, err
		}
	}
	input.TrackingTicker = new(lo.FromPtr(fields.Ticker))
	input.TrackingMultiplier = &fields.Multiplier
	return true, nil
}

type trackingFields struct {
	Identifier string
	Ticker     *string
	Multiplier float64
}

func combineTrackingFields(input model.UpdateAssetInput, existing *model.Asset) (trackingFields, error) {
	identifier := lo.FromPtrOr(input.Identifier, existing.Identifier)
	classifier := lo.FromPtrOr(input.Classifier, existing.Classifier)

	multiplier := existing.TrackingMultiplier
	if input.TrackingMultiplier != nil {
		multiplier = *input.TrackingMultiplier
	}
	if err := validateTrackingMultiplier(multiplier); err != nil {
		return trackingFields{}, err
	}

	ticker := existing.TrackingTicker
	if input.TrackingTicker != nil {
		ticker = lo.EmptyableToPtr(strings.TrimSpace(*input.TrackingTicker))
	}

	if existing.AssetType != model.AssetTypeSecurity || !supportsTracking(classifier) {
		if ticker != nil {
			return trackingFields{}, apierror.Publicf("tracking ticker is only supported for public or company-equity security assets; clear the tracking ticker in the same request")
		}
		return trackingFields{Identifier: identifier, Multiplier: 1}, nil
	}

	resolvedTicker, resolvedMultiplier := NormalizeTracking(identifier, ticker, multiplier)
	if resolvedTicker == nil && input.TrackingMultiplier != nil && multiplier != 1 {
		return trackingFields{}, apierror.Publicf("tracking multiplier requires a tracking ticker different from the identifier")
	}
	return trackingFields{Identifier: identifier, Ticker: resolvedTicker, Multiplier: resolvedMultiplier}, nil
}

func trackingPairEqual(existing *model.Asset, ticker *string, multiplier float64) bool {
	existingTicker := strings.TrimSpace(lo.FromPtr(existing.TrackingTicker))
	return strings.TrimSpace(lo.FromPtr(ticker)) == existingTicker && multiplier == existing.TrackingMultiplier
}

// validateTickerPriceable confirms the asset's effective ticker resolves to a
// usable price. Providers that can definitively report an unknown symbol (e.g.
// Yahoo) are asked directly, so a transient upstream outage doesn't block edits
// with a misleading "could not be priced" error. Other providers fall back to a
// price probe.
func (s *Service) validateTickerPriceable(ctx context.Context, asset *model.Asset) error {
	ticker := effectiveTicker(asset)
	if v, ok := s.PriceProvider.(tickerValidator); ok {
		if err := v.ValidateTicker(ctx, ticker); err != nil {
			return apierror.Public(fmt.Errorf("tracking ticker %q could not be priced: %w", ticker, err))
		}
		return nil
	}
	price, err := s.PriceProvider.PriceAt(ctx, asset, time.Now())
	if err != nil {
		return fmt.Errorf("validate tracking ticker: %w", err)
	}
	if price <= 0 {
		return apierror.Publicf("tracking ticker %q could not be priced", ticker)
	}
	return nil
}

func supportsTracking(classifier model.AssetClassifier) bool {
	return classifier == model.AssetClassifierPublic || classifier == model.AssetClassifierCompanyEquity
}

func forcedPriceValue(input model.UpdateAssetInput) (float64, bool) {
	if input.ForcePrice != nil && !*input.ForcePrice {
		return 0, false
	}
	if input.ForcedUsdPrice == nil {
		return 0, false
	}
	return *input.ForcedUsdPrice, true
}

func forcedPriceChange(input model.UpdateAssetInput) (bool, bool) {
	if input.ForcePrice != nil {
		return *input.ForcePrice, !*input.ForcePrice
	}
	return input.ForcedUsdPrice != nil, false
}

func (s *Service) marketPriceValue(ctx context.Context, asset *model.Asset) (float64, bool) {
	if asset.AssetType == model.AssetTypeSecurity {
		price, err := s.PriceProvider.PriceAt(ctx, asset, time.Now())
		if err != nil {
			s.Log.Warn("update asset: price fetch after clearing forced price failed", "asset_id", asset.ID, "identifier", asset.Identifier, "error", err)
		} else if price > 0 {
			return price, true
		}
	}
	if asset.CurrentPrice != nil {
		return *asset.CurrentPrice, true
	}
	return 0, false
}
