package graph

import (
	"context"

	"tallyo/internal/clients"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"
)

func (r *Resolver) EVMChains(_ context.Context) (*model.EVMChainList, error) {
	fromClient := func(chain clients.DebankChain) *model.EVMChain {
		return &model.EVMChain{ID: chain.ID, Name: chain.Name}
	}
	return &model.EVMChainList{Items: u.Map(clients.DebankChains, fromClient)}, nil
}
