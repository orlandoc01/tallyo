package clients

import (
	"context"
	"net/http"
	"strings"
	"time"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
)

type PlaidCredential struct {
	ClientID    string
	Secret      string
	Environment string
}

type PlaidClient interface {
	Accounts(ctx context.Context, accessToken string) ([]plaidapi.AccountBase, error)
	AccountsBalanceGet(ctx context.Context, accessToken string) ([]plaidapi.AccountBase, error)
	InvestmentsHoldingsGet(ctx context.Context, accessToken string) (plaidapi.InvestmentsHoldingsGetResponse, error)
	InvestmentsTransactionsGet(
		ctx context.Context,
		accessToken string,
		startDate string,
		endDate string,
		accountIDs []string,
		count int32,
		offset int32,
	) (plaidapi.InvestmentsTransactionsGetResponse, error)
	Sync(ctx context.Context, accessToken, cursor string) (plaidapi.TransactionsSyncResponse, error)
	CreateLinkToken(ctx context.Context, owner string) (string, time.Time, error)
	CreateUpdateLinkToken(ctx context.Context, accessToken, owner string, investmentsEnabled, liabilitiesEnabled bool) (string, time.Time, error)
	ExchangePublicToken(ctx context.Context, publicToken string) (string, string, error)
	ItemGet(ctx context.Context, accessToken string) (plaidapi.Item, error)
	Institution(ctx context.Context, institutionID string) (plaidapi.Institution, error)
	TransactionsRecurringGet(ctx context.Context, accessToken string, accountIDs []string) (plaidapi.TransactionsRecurringGetResponse, error)
}

type PlaidClientFactory interface {
	ClientForCredential(ctx context.Context, credentialID int32) (PlaidClient, error)
}

type PlaidSDKClient struct {
	clientID string
	secret   string
	api      *plaidapi.APIClient
}

type plaidCredentialsRequest interface {
	SetClientId(string)
	SetSecret(string)
}

func NewPlaidSDKClient(credential PlaidCredential) *PlaidSDKClient {
	pcfg := plaidapi.NewConfiguration()
	pcfg.HTTPClient = &http.Client{Timeout: 30 * time.Second}
	switch strings.ToLower(credential.Environment) {
	case "production":
		pcfg.UseEnvironment(plaidapi.Production)
	case "sandbox":
		pcfg.UseEnvironment(plaidapi.Sandbox)
	default:
		pcfg.UseEnvironment(plaidapi.Development)
	}
	return &PlaidSDKClient{clientID: credential.ClientID, secret: credential.Secret, api: plaidapi.NewAPIClient(pcfg)}
}

func (c *PlaidSDKClient) setCredentials(req plaidCredentialsRequest) {
	req.SetClientId(c.clientID)
	req.SetSecret(c.secret)
}

func (c *PlaidSDKClient) Accounts(ctx context.Context, accessToken string) ([]plaidapi.AccountBase, error) {
	req := plaidapi.NewAccountsGetRequest(accessToken)
	c.setCredentials(req)
	resp, httpResp, err := c.api.PlaidApi.AccountsGet(ctx).AccountsGetRequest(*req).Execute()
	defer closePlaidResponse(httpResp)
	if err != nil {
		return nil, err
	}
	return resp.GetAccounts(), nil
}

func (c *PlaidSDKClient) AccountsBalanceGet(ctx context.Context, accessToken string) ([]plaidapi.AccountBase, error) {
	req := plaidapi.NewAccountsBalanceGetRequest(accessToken)
	c.setCredentials(req)
	resp, httpResp, err := c.api.PlaidApi.AccountsBalanceGet(ctx).AccountsBalanceGetRequest(*req).Execute()
	defer closePlaidResponse(httpResp)
	if err != nil {
		return nil, err
	}
	return resp.GetAccounts(), nil
}

func (c *PlaidSDKClient) InvestmentsHoldingsGet(ctx context.Context, accessToken string) (plaidapi.InvestmentsHoldingsGetResponse, error) {
	req := plaidapi.NewInvestmentsHoldingsGetRequest(accessToken)
	c.setCredentials(req)
	resp, httpResp, err := c.api.PlaidApi.InvestmentsHoldingsGet(ctx).InvestmentsHoldingsGetRequest(*req).Execute()
	defer closePlaidResponse(httpResp)
	return resp, err
}

func (c *PlaidSDKClient) InvestmentsTransactionsGet(
	ctx context.Context,
	accessToken string,
	startDate string,
	endDate string,
	accountIDs []string,
	count int32,
	offset int32,
) (plaidapi.InvestmentsTransactionsGetResponse, error) {
	req := plaidapi.NewInvestmentsTransactionsGetRequest(accessToken, startDate, endDate)
	c.setCredentials(req)
	opts := plaidapi.NewInvestmentsTransactionsGetRequestOptions()
	if len(accountIDs) > 0 {
		opts.SetAccountIds(accountIDs)
	}
	opts.SetCount(count)
	opts.SetOffset(offset)
	req.SetOptions(*opts)
	resp, httpResp, err := c.api.PlaidApi.InvestmentsTransactionsGet(ctx).
		InvestmentsTransactionsGetRequest(*req).
		Execute()
	defer closePlaidResponse(httpResp)
	return resp, err
}

func (c *PlaidSDKClient) Sync(ctx context.Context, accessToken, cursor string) (plaidapi.TransactionsSyncResponse, error) {
	req := plaidapi.NewTransactionsSyncRequest(accessToken)
	c.setCredentials(req)
	if cursor != "" {
		req.SetCursor(cursor)
	}
	count := int32(500)
	req.SetCount(count)
	opts := plaidapi.NewTransactionsSyncRequestOptions()
	opts.SetIncludeOriginalDescription(true)
	req.SetOptions(*opts)
	resp, httpResp, err := c.api.PlaidApi.TransactionsSync(ctx).TransactionsSyncRequest(*req).Execute()
	defer closePlaidResponse(httpResp)
	return resp, err
}

func (c *PlaidSDKClient) CreateLinkToken(ctx context.Context, owner string) (string, time.Time, error) {
	req := plaidapi.NewLinkTokenCreateRequest("Tallyo", "en", []plaidapi.CountryCode{plaidapi.COUNTRYCODE_US}, *plaidapi.NewLinkTokenCreateRequestUser(owner))
	c.setCredentials(req)
	req.SetProducts([]plaidapi.Products{plaidapi.PRODUCTS_TRANSACTIONS})
	req.SetAdditionalConsentedProducts([]plaidapi.Products{plaidapi.PRODUCTS_INVESTMENTS, plaidapi.PRODUCTS_LIABILITIES})
	return c.createLinkToken(ctx, req)
}

func (c *PlaidSDKClient) CreateUpdateLinkToken(ctx context.Context, accessToken, owner string, investmentsEnabled, liabilitiesEnabled bool) (string, time.Time, error) {
	req := plaidapi.NewLinkTokenCreateRequest("Tallyo", "en", []plaidapi.CountryCode{plaidapi.COUNTRYCODE_US}, *plaidapi.NewLinkTokenCreateRequestUser(owner))
	c.setCredentials(req)
	req.SetAccessToken(accessToken)
	var additionalProducts []plaidapi.Products
	if !investmentsEnabled {
		additionalProducts = append(additionalProducts, plaidapi.PRODUCTS_INVESTMENTS)
	}
	if !liabilitiesEnabled {
		additionalProducts = append(additionalProducts, plaidapi.PRODUCTS_LIABILITIES)
	}
	if len(additionalProducts) > 0 {
		req.SetAdditionalConsentedProducts(additionalProducts)
	}
	return c.createLinkToken(ctx, req)
}

func (c *PlaidSDKClient) createLinkToken(ctx context.Context, req *plaidapi.LinkTokenCreateRequest) (string, time.Time, error) {
	resp, httpResp, err := c.api.PlaidApi.LinkTokenCreate(ctx).LinkTokenCreateRequest(*req).Execute()
	defer closePlaidResponse(httpResp)
	if err != nil {
		return "", time.Time{}, err
	}
	return resp.GetLinkToken(), resp.GetExpiration(), nil
}

func (c *PlaidSDKClient) ExchangePublicToken(ctx context.Context, publicToken string) (string, string, error) {
	req := plaidapi.NewItemPublicTokenExchangeRequest(publicToken)
	c.setCredentials(req)
	resp, httpResp, err := c.api.PlaidApi.ItemPublicTokenExchange(ctx).ItemPublicTokenExchangeRequest(*req).Execute()
	defer closePlaidResponse(httpResp)
	if err != nil {
		return "", "", err
	}
	return resp.GetAccessToken(), resp.GetItemId(), nil
}

func (c *PlaidSDKClient) ItemGet(ctx context.Context, accessToken string) (plaidapi.Item, error) {
	req := plaidapi.NewItemGetRequest(accessToken)
	c.setCredentials(req)
	resp, httpResp, err := c.api.PlaidApi.ItemGet(ctx).ItemGetRequest(*req).Execute()
	defer closePlaidResponse(httpResp)
	if err != nil {
		return plaidapi.Item{}, err
	}
	return resp.GetItem(), nil
}

func (c *PlaidSDKClient) Institution(ctx context.Context, institutionID string) (plaidapi.Institution, error) {
	req := plaidapi.NewInstitutionsGetByIdRequest(institutionID, []plaidapi.CountryCode{plaidapi.COUNTRYCODE_US})
	c.setCredentials(req)
	opts := plaidapi.NewInstitutionsGetByIdRequestOptions()
	opts.SetIncludeOptionalMetadata(true)
	req.SetOptions(*opts)
	resp, httpResp, err := c.api.PlaidApi.InstitutionsGetById(ctx).InstitutionsGetByIdRequest(*req).Execute()
	defer closePlaidResponse(httpResp)
	if err != nil {
		return plaidapi.Institution{}, err
	}
	return resp.GetInstitution(), nil
}

func (c *PlaidSDKClient) TransactionsRecurringGet(ctx context.Context, accessToken string, accountIDs []string) (plaidapi.TransactionsRecurringGetResponse, error) {
	req := plaidapi.NewTransactionsRecurringGetRequest(accessToken, accountIDs)
	c.setCredentials(req)
	resp, httpResp, err := c.api.PlaidApi.TransactionsRecurringGet(ctx).TransactionsRecurringGetRequest(*req).Execute()
	defer closePlaidResponse(httpResp)
	return resp, err
}

func closePlaidResponse(resp *http.Response) {
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
}
