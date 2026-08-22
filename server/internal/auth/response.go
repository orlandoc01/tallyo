package auth

import (
	"encoding/json"
	"net/http"

	u "tallyo/internal/utils"
)

// decodeAndValidate decodes the JSON body into dst then validates required fields.
// Writes an HTTP error and returns false on failure.
func decodeAndValidate(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return false
	}
	if err := u.Validator.Struct(dst); err != nil {
		http.Error(w, "missing required fields", http.StatusBadRequest)
		return false
	}
	return true
}

func writePublicJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	writeJSON(w, value)
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}

func writeJSONStatus(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

// HTTPFail writes msg with status when err is non-nil and reports whether it did.
func HTTPFail(w http.ResponseWriter, err error, status int, msg string) bool {
	if err == nil {
		return false
	}
	http.Error(w, msg, status)
	return true
}
