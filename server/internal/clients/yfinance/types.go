package yfinance

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
)

type FundReport struct {
	Category string
	Group    string

	CashPosition        float64
	StockPosition       float64
	BondPosition        float64
	PreferredPosition   float64
	ConvertiblePosition float64
	OtherPosition       float64

	SectorRealEstate            float64
	SectorConsumerCyclical      float64
	SectorBasicMaterials        float64
	SectorConsumerDefensive     float64
	SectorTechnology            float64
	SectorCommunicationServices float64
	SectorFinancialServices     float64
	SectorUtilities             float64
	SectorIndustrials           float64
	SectorEnergy                float64
	SectorHealthcare            float64
}

func (r FundReport) Valid() bool {
	return strings.TrimSpace(r.Category) != ""
}

type EquityReport struct {
	Sector string
}

func (r EquityReport) Valid() bool {
	return strings.TrimSpace(r.Sector) != ""
}

type Client interface {
	FetchFund(ctx context.Context, ticker string) (*FundReport, error)
	FetchEquity(ctx context.Context, ticker string) (*EquityReport, error)
}

func New(httpClient *http.Client, log *slog.Logger) Client {
	return newClient(httpClient, "https://fc.yahoo.com", "https://query1.finance.yahoo.com/v1/test/getcrumb", "https://query1.finance.yahoo.com/v10/finance/quoteSummary", log)
}
