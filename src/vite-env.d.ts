/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __SERVER_PORT__: number;

// Prism.js language components are side-effect-only modules without type declarations
declare module 'prismjs/components/prism-*';
