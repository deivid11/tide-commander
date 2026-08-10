/// <reference types="vite/client" />

declare module 'occt-import-js' {
  interface OcctImportOptions {
    locateFile?: (path: string, prefix: string) => string;
  }

  export default function occtImport(options?: OcctImportOptions): Promise<unknown>;
}

declare const __APP_VERSION__: string;
declare const __SERVER_PORT__: number;

// Prism.js language components are side-effect-only modules without type declarations
declare module 'prismjs/components/prism-*';
