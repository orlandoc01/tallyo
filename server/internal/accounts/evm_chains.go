package accounts

import (
	"slices"

	"tallyo/internal/apierror"
	"tallyo/internal/clients"

	"github.com/samber/lo"
)

var debankChainIDs = lo.SliceToMap(clients.DebankChains, func(chain clients.DebankChain) (string, struct{}) {
	return chain.ID, struct{}{}
})

func NormalizeEVMChainIDs(chainIDs []string) []string {
	normalized := lo.Uniq(chainIDs)
	slices.Sort(normalized)
	return normalized
}

func ValidateEVMChainIDs(chainIDs []string) error {
	if len(chainIDs) == 0 {
		return apierror.Publicf("at least one EVM chain is required")
	}
	isInvalid := func(chainID string) bool {
		_, valid := debankChainIDs[chainID]
		return !valid
	}
	if invalidID, invalid := lo.Find(chainIDs, isInvalid); invalid {
		return apierror.Publicf("unknown EVM chain ID %q", invalidID)
	}
	return nil
}
