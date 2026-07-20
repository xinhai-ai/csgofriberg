/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RESOURCE_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
