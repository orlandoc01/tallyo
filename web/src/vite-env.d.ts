/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string
  readonly VITE_STUB_API?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
