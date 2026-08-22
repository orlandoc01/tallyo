package wealthdb

import (
	"encoding/json"
	"fmt"

	"tallyo/internal/graph/model"
	"tallyo/internal/wealth"

	"github.com/samber/lo"
)

// SecurityAdditional is serialized into assets.additional for SECURITY rows.
type SecurityAdditional struct {
	PlaidSecurityType      *string `json:"plaid_security_type,omitempty"`
	CUSIP                  *string `json:"cusip,omitempty"`
	ISIN                   *string `json:"isin,omitempty"`
	SimpleFinCostBasis     *string `json:"simplefin_cost_basis,omitempty"`
	SimpleFinPurchasePrice *string `json:"simplefin_purchase_price,omitempty"`
}

// CryptoAdditional is serialized into assets.additional for CRYPTO rows.
type CryptoAdditional struct {
	LineType    *string `json:"line_type,omitempty"`
	ChainID     *string `json:"chain_id,omitempty"`
	TokenID     *string `json:"token_id,omitempty"`
	TokenSymbol *string `json:"token_symbol,omitempty"`
	TokenName   *string `json:"token_name,omitempty"`
	ProjectName *string `json:"project_name,omitempty"`
}

// RealEstateAdditional is serialized into assets.additional for REAL_ESTATE rows.
type RealEstateAdditional struct {
	Street   *string `json:"street,omitempty"`
	City     *string `json:"city,omitempty"`
	State    *string `json:"state,omitempty"`
	Zip      *string `json:"zip,omitempty"`
	HomeType *string `json:"home_type,omitempty"`
}

func additionalFromUpsert(asset wealth.AssetUpsert) (*string, error) {
	switch asset.AssetType {
	case model.AssetTypeSecurity:
		return marshalAdditional(SecurityAdditional{
			PlaidSecurityType:      asset.PlaidSecurityType,
			CUSIP:                  asset.CUSIP,
			ISIN:                   asset.ISIN,
			SimpleFinCostBasis:     asset.SimpleFinCostBasis,
			SimpleFinPurchasePrice: asset.SimpleFinPurchasePrice,
		})
	case model.AssetTypeCrypto:
		return marshalAdditional(CryptoAdditional{
			LineType:    asset.LineType,
			ChainID:     asset.ChainID,
			TokenID:     asset.TokenID,
			TokenSymbol: asset.TokenSymbol,
			TokenName:   asset.TokenName,
			ProjectName: asset.ProjectName,
		})
	case model.AssetTypeRealEstate:
		if asset.RealEstate == nil {
			return nil, fmt.Errorf("real estate asset %q missing address details", asset.Identifier)
		}
		return marshalAdditional(realEstateAdditional(*asset.RealEstate))
	default:
		return nil, nil
	}
}

func realEstateAdditional(details wealth.RealEstateDetails) RealEstateAdditional {
	return RealEstateAdditional{
		Street:   details.Street,
		City:     details.City,
		State:    details.State,
		Zip:      details.Zip,
		HomeType: details.HomeType,
	}
}

func mergeAdditional(assetType model.AssetType, existing *string, incoming *string) (*string, error) {
	if incoming == nil {
		if existing != nil && *existing != "" {
			return existing, nil
		}
		return nil, nil
	}
	switch assetType {
	case model.AssetTypeSecurity:
		return mergeAdditionalJSON(existing, incoming, func(current, next SecurityAdditional) SecurityAdditional {
			current.PlaidSecurityType = lo.CoalesceOrEmpty(next.PlaidSecurityType, current.PlaidSecurityType)
			current.CUSIP = lo.CoalesceOrEmpty(next.CUSIP, current.CUSIP)
			current.ISIN = lo.CoalesceOrEmpty(next.ISIN, current.ISIN)
			current.SimpleFinCostBasis = lo.CoalesceOrEmpty(next.SimpleFinCostBasis, current.SimpleFinCostBasis)
			current.SimpleFinPurchasePrice = lo.CoalesceOrEmpty(next.SimpleFinPurchasePrice, current.SimpleFinPurchasePrice)
			return current
		})
	case model.AssetTypeCrypto:
		return mergeAdditionalJSON(existing, incoming, func(current, next CryptoAdditional) CryptoAdditional {
			current.LineType = lo.CoalesceOrEmpty(next.LineType, current.LineType)
			current.ChainID = lo.CoalesceOrEmpty(next.ChainID, current.ChainID)
			current.TokenID = lo.CoalesceOrEmpty(next.TokenID, current.TokenID)
			current.TokenSymbol = lo.CoalesceOrEmpty(next.TokenSymbol, current.TokenSymbol)
			current.TokenName = lo.CoalesceOrEmpty(next.TokenName, current.TokenName)
			current.ProjectName = lo.CoalesceOrEmpty(next.ProjectName, current.ProjectName)
			return current
		})
	case model.AssetTypeRealEstate:
		return mergeAdditionalJSON(existing, incoming, func(current, next RealEstateAdditional) RealEstateAdditional {
			current.Street = lo.CoalesceOrEmpty(next.Street, current.Street)
			current.City = lo.CoalesceOrEmpty(next.City, current.City)
			current.State = lo.CoalesceOrEmpty(next.State, current.State)
			current.Zip = lo.CoalesceOrEmpty(next.Zip, current.Zip)
			current.HomeType = lo.CoalesceOrEmpty(next.HomeType, current.HomeType)
			return current
		})
	default:
		return nil, nil
	}
}

func mergeAdditionalJSON[T any](existing, incoming *string, merge func(current, next T) T) (*string, error) {
	var current, next T
	if err := unmarshalAdditional(existing, &current); err != nil {
		return nil, err
	}
	if err := unmarshalAdditional(incoming, &next); err != nil {
		return nil, err
	}
	return marshalAdditional(merge(current, next))
}

func unmarshalAdditional(value *string, dst any) error {
	if value == nil || *value == "" {
		return nil
	}
	if err := json.Unmarshal([]byte(*value), dst); err != nil {
		return fmt.Errorf("decode asset additional: %w", err)
	}
	return nil
}

func marshalAdditional(value any) (*string, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("encode asset additional: %w", err)
	}
	encoded := string(data)
	if encoded == "{}" {
		return nil, nil
	}
	return &encoded, nil
}
