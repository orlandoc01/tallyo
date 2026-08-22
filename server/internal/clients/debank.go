package clients

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/samber/lo"
)

const debankAPIBase = "https://api.debank.com"

type Debank struct {
	HTTP    *http.Client
	BaseURL string
}

func NewDebank(httpClient *http.Client) *Debank {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 15 * time.Second}
	}
	return &Debank{HTTP: httpClient, BaseURL: debankAPIBase}
}

func (c *Debank) BalanceList(ctx context.Context, addr, chainID string) ([]TokenBalance, error) {
	addr = strings.ToLower(addr)
	data, err := c.signedGet(ctx, "/token/balance_list", "chain="+chainID+"&user_addr="+addr)
	if err != nil {
		return nil, err
	}

	tokens, err := decodeDebank[[]TokenBalance](data, "debank response")
	if err != nil {
		return nil, err
	}
	for i := range tokens {
		tokens[i].Chain = chainID
	}
	return tokens, nil
}

func (c *Debank) ProjectList(ctx context.Context, addr string) ([]Project, string, error) {
	addr = strings.ToLower(addr)
	data, err := c.signedGet(ctx, "/portfolio/project_list", "user_addr="+addr)
	if err != nil {
		return nil, "", err
	}
	projects, err := decodeDebank[[]Project](data, "project list")
	if err != nil {
		return nil, "", err
	}
	return projects, string(data), nil
}

func (c *Debank) Token(ctx context.Context, chainID, tokenID string) (*TokenMetadata, error) {
	data, err := c.signedGet(ctx, "/token", "chain_id="+chainID+"&id="+tokenID)
	if err != nil {
		return nil, err
	}
	token, err := decodeDebank[TokenBalance](data, "token metadata")
	if err != nil {
		return nil, err
	}
	return &TokenMetadata{Chain: lo.CoalesceOrEmpty(token.Chain, chainID), ID: lo.CoalesceOrEmpty(token.ID, tokenID), Symbol: token.Symbol, OptimizedSymbol: token.OptimizedSymbol, Name: token.Name, Price: token.Price}, nil
}

func (c *Debank) signedGet(ctx context.Context, pathname, query string) ([]byte, error) {
	method := http.MethodGet
	nonce, ts, sig := debankSign(method, pathname, query)
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+pathname+"?"+query, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("x-api-nonce", "n_"+nonce)
	req.Header.Set("x-api-sign", sig)
	req.Header.Set("x-api-ts", strconv.FormatInt(ts, 10))
	req.Header.Set("x-api-ver", "v2")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("debank request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("debank returned status %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

type debankResponse[T any] struct {
	Data      T      `json:"data"`
	ErrorCode int    `json:"error_code"`
	ErrorMsg  string `json:"error_msg"`
}

func decodeDebank[T any](data []byte, what string) (T, error) {
	var body debankResponse[T]
	if err := json.Unmarshal(data, &body); err != nil {
		var zero T
		return zero, fmt.Errorf("decode %s: %w", what, err)
	}
	if body.ErrorCode != 0 {
		var zero T
		return zero, fmt.Errorf("debank error %d: %s", body.ErrorCode, body.ErrorMsg)
	}
	return body.Data, nil
}

// TokenBalance stays untagged because its marshaled field names feed the
// persisted snapshot raw payload, so decoding goes through a tagged inner
// struct instead of the usual alias trick.
func (t *TokenBalance) UnmarshalJSON(data []byte) error {
	var raw struct {
		Chain           string   `json:"chain"`
		ID              string   `json:"id"`
		Symbol          string   `json:"symbol"`
		OptimizedSymbol string   `json:"optimized_symbol"`
		DisplaySymbol   string   `json:"display_symbol"`
		Name            string   `json:"name"`
		Price           float64  `json:"price"`
		Amount          float64  `json:"amount"`
		USDValue        *float64 `json:"usd_value"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*t = TokenBalance{
		Chain:           raw.Chain,
		ID:              raw.ID,
		Symbol:          raw.Symbol,
		OptimizedSymbol: raw.OptimizedSymbol,
		DisplaySymbol:   raw.DisplaySymbol,
		Name:            raw.Name,
		Price:           raw.Price,
		Amount:          raw.Amount,
		Raw:             string(data),
	}
	if raw.USDValue != nil {
		t.USDValue = *raw.USDValue
		t.USDValuePresent = true
	}
	return nil
}

func (i *ProjectItem) UnmarshalJSON(data []byte) error {
	type projectItem ProjectItem
	if err := json.Unmarshal(data, (*projectItem)(i)); err != nil {
		return err
	}
	i.Raw = string(data)
	return nil
}

func (s *ProjectStats) UnmarshalJSON(data []byte) error {
	var raw struct {
		NetUSDValue *float64 `json:"net_usd_value"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if raw.NetUSDValue != nil {
		s.NetUSDValue = *raw.NetUSDValue
		s.NetUSDValuePresent = true
	}
	return nil
}

func debankSign(method, pathname, query string) (nonce string, ts int64, signature string) {
	nonce = debankNonce()
	ts = time.Now().Unix()
	signature = computeSign(method, pathname, query, nonce, ts)
	return nonce, ts, signature
}

func computeSign(method, pathname, query, nonce string, ts int64) string {
	data1 := method + "\n" + pathname + "\n" + query
	data2 := "debank-api\nn_" + nonce + "\n" + strconv.FormatInt(ts, 10)
	hash1 := debankHex(sha256.Sum256([]byte(data1)))
	hash2 := debankHex(sha256.Sum256([]byte(data2)))
	xor1 := xorHexBytes(hash2, 54)
	xor2 := xorHexBytes(hash2, 92)
	h1 := sha256.Sum256([]byte(xor1 + hash1))
	h2Input := append([]byte(xor2), h1[:]...)
	return debankHex(sha256.Sum256(h2Input))
}

const nonceChars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz"

func debankNonce() string {
	b := make([]byte, 40)
	for i := range b {
		b[i] = nonceChars[rand.IntN(len(nonceChars))]
	}
	return string(b)
}

func debankHex(b [32]byte) string {
	return hex.EncodeToString(b[:])
}

func xorHexBytes(hexStr string, key byte) string {
	b := []byte(hexStr)
	for i := range b {
		b[i] ^= key
	}
	return string(b)
}
