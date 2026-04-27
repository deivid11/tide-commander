/**
 * WhatsApp Client
 * Typed wrapper around the local WhatsApp API server (Baileys-only).
 * The upstream server runs at e.g. http://localhost:3007 and uses an X-API-Key header.
 *
 * This is Phase 1: outbound calls only — no webhook/incoming message handling yet.
 */

// ─── Types ───

export interface WhatsAppSession {
  sessionId: string;
  status?: string;
  /** Pass-through for any extra fields the upstream returns. */
  [key: string]: unknown;
}

export interface WhatsAppSessionStatus {
  sessionId: string;
  status: string;
  [key: string]: unknown;
}

export interface WhatsAppQrResponse {
  sessionId?: string;
  qr?: string;
  [key: string]: unknown;
}

export interface WhatsAppSendResult {
  success?: boolean;
  messageId?: string;
  [key: string]: unknown;
}

export interface WhatsAppContact {
  /** JID, e.g. "5215512345678@s.whatsapp.net" or "120363@g.us" */
  id: string;
  /** Display name preferred for UI; null when the user hasn't set one. */
  name: string | null;
  /** Push name (the value the contact set on their own WhatsApp profile). */
  pushname: string | null;
  /** Bare phone number (no domain). */
  number: string;
  isMyContact?: boolean | null;
  isUser?: boolean;
  isGroup?: boolean;
  isWAContact?: boolean;
  [key: string]: unknown;
}

// ─── Client ───

export class WhatsAppClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    // Strip trailing slash so path joining is predictable.
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  // ─── Sessions ───

  async listSessions(): Promise<WhatsAppSession[]> {
    const data = await this.request<WhatsAppSession[]>('GET', '/api/sessions');
    return Array.isArray(data) ? data : [];
  }

  async createSession(sessionId: string): Promise<WhatsAppSession> {
    return this.request<WhatsAppSession>('POST', '/api/sessions', { sessionId });
  }

  async deleteSession(sessionId: string): Promise<unknown> {
    return this.request<unknown>('DELETE', `/api/sessions/${encodeURIComponent(sessionId)}`);
  }

  async getSessionStatus(sessionId: string): Promise<WhatsAppSessionStatus> {
    return this.request<WhatsAppSessionStatus>(
      'GET',
      `/api/sessions/${encodeURIComponent(sessionId)}/status`,
    );
  }

  async getSessionQr(sessionId: string): Promise<WhatsAppQrResponse> {
    return this.request<WhatsAppQrResponse>(
      'GET',
      `/api/sessions/${encodeURIComponent(sessionId)}/qr`,
    );
  }

  // ─── Messaging ───

  async sendMessage(sessionId: string, to: string, message: string): Promise<WhatsAppSendResult> {
    return this.request<WhatsAppSendResult>(
      'POST',
      `/api/sessions/${encodeURIComponent(sessionId)}/send-message`,
      { to, message },
    );
  }

  async getContacts(sessionId: string): Promise<WhatsAppContact[]> {
    const data = await this.request<WhatsAppContact[]>(
      'GET',
      `/api/sessions/${encodeURIComponent(sessionId)}/contacts`,
    );
    return Array.isArray(data) ? data : [];
  }

  async sendMediaUrl(
    sessionId: string,
    to: string,
    mediaUrl: string,
    caption?: string,
    options?: { type?: 'image' | 'video' | 'audio' | 'document'; filename?: string },
  ): Promise<WhatsAppSendResult> {
    // Upstream body shape: { to, url, caption?, filename? } (type is auto-detected
    // from the fetched URL's Content-Type header). `type` is forwarded for
    // forward-compatibility with future upstream versions that may honor it.
    return this.request<WhatsAppSendResult>(
      'POST',
      `/api/sessions/${encodeURIComponent(sessionId)}/send-media-url`,
      {
        to,
        url: mediaUrl,
        caption,
        filename: options?.filename,
        type: options?.type,
      },
    );
  }

  // ─── Internals ───

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'X-API-Key': this.apiKey,
      Accept: 'application/json',
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, { method, headers, body: payload });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`WhatsApp API request failed (${method} ${path}): ${detail}`);
    }

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Non-JSON body — fall through; we still report it on errors.
      }
    }

    if (!response.ok) {
      const errMsg =
        (parsed && typeof parsed === 'object' && (parsed as { error?: unknown }).error) ||
        (parsed && typeof parsed === 'object' && (parsed as { message?: unknown }).message) ||
        text ||
        response.statusText;
      throw new Error(
        `WhatsApp API ${method} ${path} returned ${response.status}: ${
          typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)
        }`,
      );
    }

    // Upstream wraps successful payloads as `{ success: boolean, data: <payload>, error?, message? }`.
    // Unwrap once here so callers see the inner data directly.
    if (parsed && typeof parsed === 'object' && 'success' in (parsed as object)) {
      const env = parsed as { success: unknown; data?: unknown; error?: unknown; message?: unknown };
      if (env.success === false) {
        const reason =
          (typeof env.error === 'string' && env.error) ||
          (typeof env.message === 'string' && env.message) ||
          `success:false (no error message)`;
        throw new Error(`WhatsApp API ${method} ${path}: ${reason}`);
      }
      return (env.data ?? ({} as unknown)) as T;
    }

    return (parsed ?? ({} as unknown)) as T;
  }
}
