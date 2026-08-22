package wealthdb

import (
	"context"
	"fmt"
	"strings"

	"github.com/samber/lo"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"
)

// AllAssets lists assets with three search modes: no search (name order), a
// short search term (literal substring match on name/identifier, name order), or
// a search long enough for FTS (relevance-ranked).
func (s *Store) AllAssets(ctx context.Context, input model.AssetsInput) ([]*model.Asset, error) {
	search := strings.TrimSpace(lo.FromPtr(input.Search))
	params := dbgen.AssetRecordsParams{ExcludeHistorical: !lo.FromPtr(input.IncludeHistorical)}
	if input.AssetType != nil {
		params.AssetType = new(string(*input.AssetType))
	}
	if input.PriceConnectivity != nil {
		params.PriceConnectivity = new(string(*input.PriceConnectivity))
	}
	if input.InvestmentConnectivity != nil {
		params.InvestmentConnectivity = new(string(*input.InvestmentConnectivity))
	}
	switch {
	case search == "":
		params.OrderName = true
	case dbutil.UsesFTS(search):
		ftsMatch := dbutil.FTSQuery(search)
		params.FtsMatch = &ftsMatch
		params.OrderFtsRank = true
	default:
		lowered := strings.ToLower(search)
		params.LikeSearch = true
		params.LikeName = lowered
		params.LikeIdentifier = lowered
		params.OrderName = true
	}
	rows, err := s.q.AssetRecords(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("query assets: %w", err)
	}
	assets, err := u.MapErr(rows, assetFromAllAssetsRow)
	if err != nil {
		return nil, err
	}
	return assets, nil
}
