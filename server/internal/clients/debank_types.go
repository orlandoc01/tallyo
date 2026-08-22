package clients

// TokenBalance is a single token position returned by the Debank token list endpoint.
type TokenBalance struct {
	Chain           string
	ID              string
	Symbol          string
	OptimizedSymbol string
	DisplaySymbol   string
	Name            string
	Price           float64
	Amount          float64
	USDValue        float64
	USDValuePresent bool
	Raw             string
}

type Project struct {
	Chain          string        `json:"chain"`
	ID             string        `json:"id"`
	Name           string        `json:"name"`
	PortfolioItems []ProjectItem `json:"portfolio_item_list"`
}

type ProjectItem struct {
	Pool   ProjectPool   `json:"pool"`
	Detail ProjectDetail `json:"detail"`
	Stats  ProjectStats  `json:"stats"`
	Raw    string
}

type ProjectPool struct {
	ID         string `json:"id"`
	Controller string `json:"controller"`
	Chain      string `json:"chain"`
}

type ProjectDetail struct {
	Description string `json:"description"`
}

type ProjectStats struct {
	NetUSDValue        float64 `json:"net_usd_value"`
	NetUSDValuePresent bool    `json:"-"`
}

type TokenMetadata struct {
	Chain           string
	ID              string
	Symbol          string
	OptimizedSymbol string
	Name            string
	Price           float64
}
