package wealthdb

import (
	"tallyo/internal/database/dbgen"
	"tallyo/internal/graph/model"
)

func assetFromRow(r dbgen.Asset) (*model.Asset, error) {
	asset := assetFromModel(r)
	if err := applyAssetAdditional(r.Additional, &asset); err != nil {
		return nil, err
	}
	return &asset, nil
}

func assetFromModel(a dbgen.Asset) model.Asset {
	return model.Asset{
		ID:                     model.New(model.GlobalIDAsset, a.ID),
		AssetType:              model.AssetType(a.AssetType),
		Identifier:             a.Identifier,
		Name:                   a.Name,
		Classifier:             model.AssetClassifier(a.Classifier),
		CurrentPrice:           a.LastPrice,
		CurrentPriceAt:         a.LastPriceAt,
		ForcedUsdPrice:         a.ForcedUsdPrice,
		TrackingTicker:         a.TrackingTicker,
		TrackingMultiplier:     a.TrackingMultiplier,
		PriceConnectivity:      model.ConnectivityStatus(a.PriceConnectivity),
		InvestmentConnectivity: model.ConnectivityStatus(a.InvestmentConnectivity),
	}
}

func assetFromAllAssetsRow(r dbgen.AssetRecordsRow) (*model.Asset, error) {
	return assetFromRow(r.Asset)
}

func applyAssetAdditional(additional *string, asset *model.Asset) error {
	switch asset.AssetType {
	case model.AssetTypeSecurity:
		var details SecurityAdditional
		if err := unmarshalAdditional(additional, &details); err != nil {
			return err
		}
		asset.Cusip = details.CUSIP
		asset.Isin = details.ISIN
	case model.AssetTypeCrypto:
		var details CryptoAdditional
		if err := unmarshalAdditional(additional, &details); err != nil {
			return err
		}
		asset.ChainID = details.ChainID
		asset.TokenSymbol = details.TokenSymbol
		asset.TokenName = details.TokenName
		asset.ProjectName = details.ProjectName
	case model.AssetTypeRealEstate:
		var details RealEstateAdditional
		if err := unmarshalAdditional(additional, &details); err != nil {
			return err
		}
		if details.Street != nil || details.City != nil || details.State != nil || details.Zip != nil || details.HomeType != nil {
			asset.Address = &model.Address{
				Street:   details.Street,
				City:     details.City,
				State:    details.State,
				Zip:      details.Zip,
				HomeType: details.HomeType,
			}
		}
	}
	return nil
}
