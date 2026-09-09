// ============================================================================
// Image Generation (OpenAI Images API)
// ============================================================================
// Shared types for `/api/images/*`: agents describe an image in a prompt and
// Tide Commander writes the rendered PNG/JPEG/WebP files into a directory on
// disk. The API key never travels over this API — it is resolved server-side
// from the secrets store, the environment, or a key file.

/** Secret key (Settings → Secrets) the server reads the OpenAI key from. */
export const OPENAI_API_KEY_SECRET = 'OPENAI_API_KEY';

/** Image model used when the caller does not pick one. */
export const DEFAULT_IMAGE_MODEL = 'gpt-image-1';

/** File formats the OpenAI image models can return. */
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';

/** Where the server found the OpenAI API key. */
export type ImageApiKeySource = 'secret' | 'env' | 'file';

/** POST /api/images/generate body. */
export interface ImageGenerationRequestBody {
  /** Agent that asked for the image — logged, and echoed back in the result. */
  agentId?: string;
  /** What to draw. Required. */
  prompt: string;
  /** Absolute directory to write the files into. Created if missing. */
  outputDir?: string;
  /** Base filename (extension optional); defaults to a slug of the prompt. */
  filename?: string;
  /** Image model id. Defaults to `gpt-image-1`. */
  model?: string;
  /** `1024x1024` | `1536x1024` | `1024x1536` | `auto` (model dependent). */
  size?: string;
  /** `low` | `medium` | `high` | `auto` (mapped to `standard`/`hd` for DALL·E). */
  quality?: string;
  /** `transparent` | `opaque` | `auto` — gpt-image models only. */
  background?: 'transparent' | 'opaque' | 'auto';
  /** Output file format. Defaults to `png`. */
  format?: ImageOutputFormat;
  /** Compression 0-100 for `jpeg`/`webp` — gpt-image models only. */
  compression?: number;
  /** How many images to generate (1-10). Defaults to 1. */
  n?: number;
  /** Request timeout in ms (default 180000, max 600000). */
  timeoutMs?: number;
}

/** One file written to disk by a generation run. */
export interface GeneratedImageFile {
  /** Absolute path of the written file. */
  path: string;
  /** Basename of the written file. */
  filename: string;
  /** Size on disk in bytes. */
  bytes: number;
  /** File format actually written. */
  format: ImageOutputFormat;
}

/** Token usage reported by the image model, when it reports any. */
export interface ImageGenerationUsage {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}

/** Result of POST /api/images/generate. */
export interface ImageGenerationResult {
  /** False when the model refused, errored or nothing could be written. */
  ok: boolean;
  /** Model actually used. */
  model: string;
  /** Prompt as sent. */
  prompt: string;
  /** Prompt the model rewrote internally, when it reports one (DALL·E 3). */
  revisedPrompt?: string;
  /** Directory the files were written to. */
  outputDir: string;
  /** Files written, in generation order. Empty when `ok` is false. */
  images: GeneratedImageFile[];
  /** Wall-clock time of the whole run in ms. */
  timeMs: number;
  size?: string;
  quality?: string;
  usage?: ImageGenerationUsage;
  /** Human-readable failure reason when `ok` is false. */
  error?: string;
  /** Agent that requested the run, echoed back. */
  agentId?: string;
}

/** GET /api/images/status response. */
export interface ImageGenerationStatus {
  /** True when an OpenAI API key was found. */
  configured: boolean;
  /** Where the key came from (absent when not configured). */
  source?: ImageApiKeySource;
  /** Masked key (`sk-…abcd`) so the UI can confirm *which* key is in use. */
  maskedKey?: string;
  /** Default model when the caller does not pick one. */
  defaultModel: string;
  /** Directory used when the caller does not pass `outputDir`. */
  defaultOutputDir: string;
  /** Key file path consulted as the last fallback. */
  keyFilePath: string;
  /** Secret key name read from Settings → Secrets. */
  secretKey: string;
}
