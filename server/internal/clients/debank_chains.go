package clients

import "context"

type DebankChain struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

var DebankChains = []DebankChain{
	{ID: "eth", Name: "Ethereum"},
	{ID: "bsc", Name: "BNB Chain"},
	{ID: "xdai", Name: "Gnosis Chain"},
	{ID: "matic", Name: "Polygon"},
	{ID: "avax", Name: "Avalanche"},
	{ID: "op", Name: "OP"},
	{ID: "arb", Name: "Arbitrum"},
	{ID: "celo", Name: "Celo"},
	{ID: "cro", Name: "Cronos"},
	{ID: "metis", Name: "Metis"},
	{ID: "fuse", Name: "Fuse"},
	{ID: "klay", Name: "Kaia"},
	{ID: "rsk", Name: "Rootstock"},
	{ID: "kava", Name: "Kava"},
	{ID: "cfx", Name: "Conflux"},
	{ID: "era", Name: "zkSync Era"},
	{ID: "ron", Name: "Ronin"},
	{ID: "core", Name: "CORE"},
	{ID: "wemix", Name: "WEMIX"},
	{ID: "flr", Name: "Flare"},
	{ID: "zora", Name: "Zora"},
	{ID: "base", Name: "Base"},
	{ID: "linea", Name: "Linea"},
	{ID: "mnt", Name: "Mantle"},
	{ID: "manta", Name: "Manta Pacific"},
	{ID: "scrl", Name: "Scroll"},
	{ID: "opbnb", Name: "opBNB"},
	{ID: "mode", Name: "Mode"},
	{ID: "zeta", Name: "ZetaChain"},
	{ID: "merlin", Name: "Merlin"},
	{ID: "blast", Name: "Blast"},
	{ID: "frax", Name: "Fraxtal"},
	{ID: "xlayer", Name: "X Layer"},
	{ID: "itze", Name: "Immutable zkEVM"},
	{ID: "btr", Name: "Bitlayer"},
	{ID: "b2", Name: "B²"},
	{ID: "bob", Name: "BOB"},
	{ID: "bb", Name: "BounceBit"},
	{ID: "taiko", Name: "Taiko"},
	{ID: "cyber", Name: "Cyber"},
	{ID: "sei", Name: "Sei"},
	{ID: "chiliz", Name: "Chiliz"},
	{ID: "dbk", Name: "DBK Chain"},
	{ID: "gravity", Name: "Gravity"},
	{ID: "lisk", Name: "Lisk"},
	{ID: "ape", Name: "ApeChain"},
	{ID: "ethlink", Name: "Etherlink"},
	{ID: "zircuit", Name: "Zircuit"},
	{ID: "world", Name: "World Chain"},
	{ID: "morph", Name: "Morph"},
	{ID: "sonic", Name: "Sonic"},
	{ID: "ink", Name: "Ink"},
	{ID: "sophon", Name: "Sophon"},
	{ID: "abs", Name: "Abstract"},
	{ID: "soneium", Name: "Soneium"},
	{ID: "bera", Name: "Berachain"},
	{ID: "uni", Name: "Unichain"},
	{ID: "story", Name: "DATA Network"},
	{ID: "lens", Name: "Lens"},
	{ID: "hyper", Name: "HyperEVM"},
	{ID: "hemi", Name: "Hemi"},
	{ID: "plume", Name: "Plume"},
	{ID: "katana", Name: "Katana"},
	{ID: "plasma", Name: "Plasma"},
	{ID: "monad", Name: "Monad"},
	{ID: "stable", Name: "Stable"},
	{ID: "g0", Name: "0G"},
	{ID: "megaeth", Name: "MegaETH"},
	{ID: "xdc", Name: "XDC"},
	{ID: "citrea", Name: "Citrea"},
	{ID: "tempo", Name: "Tempo"},
	{ID: "kite", Name: "KiteAI"},
	{ID: "hood", Name: "Robinhood"},
}

func (c *Debank) ChainList(ctx context.Context) ([]DebankChain, error) {
	data, err := c.signedGet(ctx, "/chain/list", "")
	if err != nil {
		return nil, err
	}

	chainData, err := decodeDebank[debankChainList](data, "chain list")
	if err != nil {
		return nil, err
	}
	return chainData.Chains, nil
}

type debankChainList struct {
	Chains []DebankChain `json:"chains"`
}
