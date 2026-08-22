package handler

import (
	"errors"
	"io/fs"
	"net/http"
	"strings"

	web "tallyo/web"
)

var webDist, _ = fs.Sub(web.FS, "dist")

func spaFileServer() http.Handler {
	return newSPAFileServer(webDist)
}

func newSPAFileServer(fsys fs.FS) http.Handler {
	fserver := http.FileServer(http.FS(fsys))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}

		upath := strings.TrimPrefix(r.URL.Path, "/")
		if upath != "" {
			if _, err := fs.Stat(fsys, upath); errors.Is(err, fs.ErrNotExist) {
				r = r.Clone(r.Context())
				r.URL.Path = "/"
				w.Header().Set("Cache-Control", "no-cache")
			}
		}

		fserver.ServeHTTP(w, r)
	})
}
