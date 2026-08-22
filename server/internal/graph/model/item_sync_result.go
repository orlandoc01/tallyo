package model

type ItemSyncResult struct {
	Added    int32   `json:"added"`
	Modified int32   `json:"modified"`
	Removed  int32   `json:"removed"`
	Error    *string `json:"error,omitempty"`
}
