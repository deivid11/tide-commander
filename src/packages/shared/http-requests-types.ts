// ============================================================================
// HTTP Request Tests (IntelliJ-style .http files)
// ============================================================================
// Shared types for the "http" building: browse a folder of .http request
// files, pick an environment (http-client.env.json / *.private.env.json) and
// fire individual requests, IntelliJ HTTP Client style.

/** One request parsed out of a .http file. */
export interface HttpRequestItem {
  /** Stable id within the file: `${relFile}#${index}`. */
  id: string;
  /** Index of the request within its file (0-based, parse order). */
  index: number;
  /** Display name — text after the `###` separator, or `METHOD /path` fallback. */
  name: string;
  /** HTTP method (GET, POST, ...). */
  method: string;
  /** Raw URL as written in the file — may contain {{variables}}. */
  url: string;
  /** Raw header lines (name/value), values may contain {{variables}}. */
  headers: { name: string; value: string }[];
  /** Raw body text (without response-handler blocks), if any. */
  body?: string;
  /** 1-based line number of the request line (METHOD URL) in the file. */
  line: number;
  /** Distinct {{variable}} names referenced by url/headers/body. */
  variables: string[];
}

/** A scanned .http file and its requests. */
export interface HttpRequestFile {
  /** Path relative to the scanned folder. */
  relFile: string;
  /** Requests in file order. */
  requests: HttpRequestItem[];
  /** In-file `@name = value` variable definitions. */
  fileVariables: Record<string, string>;
}

/** Result of scanning a folder for .http files. */
export interface HttpRequestsScanResult {
  ok: boolean;
  folder: string;
  files: HttpRequestFile[];
  /** Environment names found across http-client*.env.json files. */
  environments: string[];
  /** Env file paths (relative to folder) that were found. */
  envFiles: string[];
  error?: string;
}

/** Body of POST /api/http-requests/run. */
export interface HttpRunRequestBody {
  /** The building's scanned folder (absolute). */
  path: string;
  /** File relative to the folder. */
  relFile: string;
  /** Which request in the file to fire (0-based parse index). */
  requestIndex: number;
  /** Environment name to resolve {{variables}} with (optional). */
  env?: string;
}

/** The fully-resolved request that was (or would be) sent. */
export interface HttpResolvedRequest {
  method: string;
  url: string;
  headers: { name: string; value: string }[];
  body?: string;
}

/** Result of executing one request. */
export interface HttpRunResult {
  /** False only when the request could not be sent / transport failed. */
  ok: boolean;
  /** Display name of the request that ran (### label or METHOD /path). */
  requestName?: string;
  /** Resolved request actually sent (variables substituted). */
  request: HttpResolvedRequest;
  /** Variables that had no value in the selected environment. */
  unresolvedVariables?: string[];
  status?: number;
  statusText?: string;
  headers?: { name: string; value: string }[];
  contentType?: string;
  /** Response body as text (possibly truncated; empty for binary payloads). */
  body?: string;
  bodyTruncated?: boolean;
  /** True when the payload did not decode as text (image, pdf, ...). */
  bodyBinary?: boolean;
  /** Total time in milliseconds (send → body fully read). */
  timeMs: number;
  /** Response body size in bytes (before truncation). */
  sizeBytes?: number;
  /** Final URL after redirects, when it differs from the requested one. */
  finalUrl?: string;
  /** Transport-level error message (connection refused, timeout, ...). */
  error?: string;
}

/** A persisted run: full detail, written to data/http-runs/<runId>.json. */
export interface StoredHttpRun {
  runId: string;
  /** The building folder the run was fired from (absolute). */
  folder: string;
  relFile: string;
  requestIndex: number;
  requestName: string;
  method: string;
  /** Resolved URL that was hit. */
  url: string;
  env?: string;
  ok: boolean;
  status?: number;
  timeMs: number;
  sizeBytes?: number;
  error?: string;
  finishedAt: number;
  /** Full request/response detail. */
  result: HttpRunResult;
}

/** Lightweight history row (index.json) — StoredHttpRun without the detail. */
export type HttpRunSummary = Omit<StoredHttpRun, 'result'>;
