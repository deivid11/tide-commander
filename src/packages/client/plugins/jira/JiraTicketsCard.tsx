import React, { memo, useCallback, useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { store } from '../../store';
import { apiUrl, authFetch } from '../../utils/storage';
import type { PluginOutputRendererProps } from '../types';

interface JiraTicketItem {
  id: string;
  key: string;
  summary: string;
  description?: string;
  status: string;
  priority?: string;
  assignee?: string;
  issueType?: string;
  project?: string;
  created?: string;
  updated?: string;
  labels: string[];
  reporter?: string;
  dueDate?: string;
  resolution?: string;
  components: string[];
  fixVersions: string[];
  url: string;
}

interface JiraTicketComment {
  id: string;
  author: string;
  body: string;
  created: string;
}

interface JiraTicketAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  author?: string;
  created?: string;
}

interface JiraTicketDetailsData {
  kind: 'jira-ticket-details';
  ticket: JiraTicketItem;
  comments: JiraTicketComment[];
  attachments: JiraTicketAttachment[];
}

interface JiraTicketListData {
  kind: 'jira-ticket-list';
  title: string;
  mode: 'pending' | 'search' | 'issue';
  query?: string;
  count: number;
  total: number;
  limit: number;
  items: JiraTicketItem[];
  actions: {
    refresh?: string;
    search?: string;
    details?: string;
    previewAttachment?: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isJiraTicketListData(value: unknown): value is JiraTicketListData {
  return isRecord(value)
    && value.kind === 'jira-ticket-list'
    && typeof value.title === 'string'
    && typeof value.mode === 'string'
    && typeof value.count === 'number'
    && typeof value.total === 'number'
    && typeof value.limit === 'number'
    && Array.isArray(value.items)
    && isRecord(value.actions);
}

function extractUpdatedData(body: unknown): JiraTicketListData | null {
  if (isJiraTicketListData(body)) return body;
  if (!isRecord(body)) return null;
  if (isJiraTicketListData(body.data)) return body.data;
  if (isRecord(body.output) && isJiraTicketListData(body.output.data)) return body.output.data;
  return null;
}

function extractDetailsData(body: unknown): JiraTicketDetailsData | null {
  if (!isRecord(body)) return null;
  const candidate = isRecord(body.output) && isRecord(body.output.data) ? body.output.data : body;
  if (candidate.kind !== 'jira-ticket-details' || !isRecord(candidate.ticket)
    || !Array.isArray(candidate.comments) || !Array.isArray(candidate.attachments)) return null;
  return candidate as unknown as JiraTicketDetailsData;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusClass(status: string): string {
  return status.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

export const JiraTicketsCard = memo(function JiraTicketsCard({
  output,
  agentId,
}: PluginOutputRendererProps) {
  const initial = isJiraTicketListData(output.data) ? output.data : null;
  const [data, setData] = useState<JiraTicketListData | null>(initial);
  const [query, setQuery] = useState(initial?.mode === 'pending' ? '' : initial?.query ?? '');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [detailsByKey, setDetailsByKey] = useState<Record<string, JiraTicketDetailsData>>({});
  const [detailsLoading, setDetailsLoading] = useState<Set<string>>(new Set());
  const [detailsErrors, setDetailsErrors] = useState<Record<string, string>>({});
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [previewingIds, setPreviewingIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isJiraTicketListData(output.data)) return;
    setData(output.data);
    if (output.data.mode !== 'pending') setQuery(output.data.query ?? '');
  }, [output.data]);

  const invoke = useCallback(async (action: string, searchQuery?: string) => {
    if (!data) return;
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch(apiUrl(
        `/api/plugins/${encodeURIComponent(output.pluginId)}/actions/${encodeURIComponent(action)}`,
      ), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          instanceId: output.instanceId,
          rendererId: output.rendererId,
          query: searchQuery,
          data,
        }),
      });
      const body = await response.json().catch(() => null) as unknown;
      if (!response.ok) {
        const message = isRecord(body) && typeof body.error === 'string'
          ? body.error
          : `Jira action failed (${response.status})`;
        throw new Error(message);
      }
      const updated = extractUpdatedData(body);
      if (!updated) throw new Error('Jira plugin returned an invalid response');
      setData(updated);
      if (updated.mode !== 'pending') setQuery(updated.query ?? searchQuery ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [agentId, data, output.instanceId, output.pluginId, output.rendererId]);

  if (!data) {
    return <section className="jira-tickets-card jira-tickets-card--invalid">Respuesta de Jira inválida</section>;
  }

  const loadDetails = async (ticket: JiraTicketItem) => {
    if (detailsByKey[ticket.key] || detailsLoading.has(ticket.key) || !data.actions.details) return;
    setDetailsLoading((current) => new Set(current).add(ticket.key));
    setDetailsErrors((current) => {
      const next = { ...current };
      delete next[ticket.key];
      return next;
    });
    try {
      const response = await authFetch(apiUrl(
        `/api/plugins/${encodeURIComponent(output.pluginId)}/actions/${encodeURIComponent(data.actions.details)}`,
      ), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: output.instanceId,
          rendererId: output.rendererId,
          itemId: ticket.key,
          item: ticket,
        }),
      });
      const body = await response.json().catch(() => null) as unknown;
      if (!response.ok) {
        const message = isRecord(body) && typeof body.error === 'string'
          ? body.error
          : `Jira details failed (${response.status})`;
        throw new Error(message);
      }
      const details = extractDetailsData(body);
      if (!details) throw new Error('Jira plugin returned invalid ticket details');
      setDetailsByKey((current) => ({ ...current, [ticket.key]: details }));
    } catch (cause) {
      setDetailsErrors((current) => ({
        ...current,
        [ticket.key]: cause instanceof Error ? cause.message : String(cause),
      }));
    } finally {
      setDetailsLoading((current) => {
        const next = new Set(current);
        next.delete(ticket.key);
        return next;
      });
    }
  };

  const toggleDetails = (ticket: JiraTicketItem) => {
    const opening = !expandedIds.has(ticket.id);
    setExpandedIds((current) => {
      const next = new Set(current);
      if (opening) next.add(ticket.id);
      else next.delete(ticket.id);
      return next;
    });
    if (opening) void loadDetails(ticket);
  };

  const previewAttachment = async (issueKey: string, attachment: JiraTicketAttachment) => {
    if (!data.actions.previewAttachment) return;
    setPreviewingIds((current) => new Set(current).add(attachment.id));
    setError(null);
    try {
      const response = await authFetch(apiUrl(
        `/api/plugins/${encodeURIComponent(output.pluginId)}/actions/${encodeURIComponent(data.actions.previewAttachment)}`,
      ), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: output.instanceId,
          rendererId: output.rendererId,
          issueKey,
          item: attachment,
        }),
      });
      const body = await response.json().catch(() => null) as unknown;
      const payload = isRecord(body) && isRecord(body.output) && isRecord(body.output.data)
        ? body.output.data
        : body;
      if (!response.ok || !isRecord(payload) || payload.kind !== 'jira-attachment-preview'
        || typeof payload.path !== 'string') {
        const message = isRecord(body) && typeof body.error === 'string'
          ? body.error
          : `Attachment preview failed (${response.status})`;
        throw new Error(message);
      }
      store.setFileViewerPath(payload.path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPreviewingIds((current) => {
        const next = new Set(current);
        next.delete(attachment.id);
        return next;
      });
    }
  };

  const downloadAttachment = async (attachment: JiraTicketAttachment) => {
    setDownloadingIds((current) => new Set(current).add(attachment.id));
    try {
      const response = await authFetch(apiUrl(
        `/api/jira/attachments/${encodeURIComponent(attachment.id)}/content`,
      ));
      if (!response.ok) throw new Error(`Attachment download failed (${response.status})`);
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = attachment.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDownloadingIds((current) => {
        const next = new Set(current);
        next.delete(attachment.id);
        return next;
      });
    }
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = query.trim();
    if (clean && data.actions.search) void invoke(data.actions.search, clean);
  };

  return (
    <section className="jira-tickets-card" data-plugin-id={output.pluginId}>
      <header className="jira-tickets-card__header">
        <span className="jira-tickets-card__brand"><Icon name="clipboard" size={13} /></span>
        <div className="jira-tickets-card__heading">
          <strong>{data.title}</strong>
          <span>{data.mode === 'pending' ? 'Todos los tickets · sin completar' : `${data.total} resultado${data.total === 1 ? '' : 's'}`}</span>
        </div>
        <span className="jira-tickets-card__count">{data.count}</span>
        {data.actions.refresh && (
          <button
            type="button"
            className="jira-tickets-card__refresh"
            disabled={loading}
            onClick={() => void invoke(data.actions.refresh!)}
            title="Actualizar tickets"
          >
            <Icon name="arrow-clockwise" size={12} className={loading ? 'is-spinning' : undefined} />
          </button>
        )}
      </header>

      {data.actions.search && (
        <form className="jira-tickets-card__search" onSubmit={submitSearch}>
          <Icon name="search" size={12} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por clave (PROJ-123) o texto…"
            aria-label="Buscar ticket de Jira"
          />
          <button type="submit" disabled={loading || !query.trim()}>
            {loading ? 'Buscando…' : 'Buscar'}
          </button>
        </form>
      )}

      {error && <div className="jira-tickets-card__error"><Icon name="warn" size={11} />{error}</div>}

      {data.items.length === 0 ? (
        <div className="jira-tickets-card__empty">
          <Icon name="check" size={17} />
          <strong>Sin tickets</strong>
          <span>{data.mode === 'pending' ? 'No hay tickets pendientes visibles para esta cuenta.' : 'No se encontraron coincidencias.'}</span>
        </div>
      ) : (
        <div className="jira-tickets-card__items">
          {data.items.map((ticket) => {
            const updated = formatDate(ticket.updated);
            const expanded = expandedIds.has(ticket.id);
            const details = detailsByKey[ticket.key];
            const fullTicket = details?.ticket ?? ticket;
            const detailError = detailsErrors[ticket.key];
            return (
              <article className={`jira-ticket${expanded ? ' is-expanded' : ''}`} key={ticket.id || ticket.key}>
                <div className="jira-ticket__compact-row">
                  <button
                    type="button"
                    className="jira-ticket__summary"
                    onClick={() => void toggleDetails(ticket)}
                    aria-expanded={expanded}
                  >
                    <span className="jira-ticket__key">{ticket.key}</span>
                    <span className={`jira-ticket__status is-${statusClass(ticket.status)}`}>{ticket.status}</span>
                    <span className="jira-ticket__priority">{ticket.priority || ''}</span>
                    <span className="jira-ticket__title">{ticket.summary}</span>
                    <span className="jira-ticket__owner">
                      {[ticket.project, ticket.assignee || 'Sin asignar'].filter(Boolean).join(' · ')}
                    </span>
                    {updated && <time dateTime={ticket.updated}>{updated}</time>}
                    <Icon name={expanded ? 'caret-down' : 'caret-right'} size={10} />
                  </button>
                  <a
                    className="jira-ticket__open"
                    href={ticket.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Abrir ${ticket.key} en Jira`}
                    aria-label={`Abrir ${ticket.key} en Jira`}
                  >
                    <Icon name="open-external" size={11} />
                  </a>
                </div>

                {expanded && (
                  <div className="jira-ticket__details">
                    {detailsLoading.has(ticket.key) && (
                      <div className="jira-ticket__details-loading">
                        <span className="jira-ticket__spinner" /> Cargando descripción, comentarios y archivos…
                      </div>
                    )}
                    {detailError && (
                      <div className="jira-ticket__details-error">
                        <Icon name="warn" size={11} />
                        <span>{detailError}</span>
                        <button type="button" onClick={() => {
                          setDetailsErrors((current) => {
                            const next = { ...current };
                            delete next[ticket.key];
                            return next;
                          });
                          void loadDetails(ticket);
                        }}>Reintentar</button>
                      </div>
                    )}
                    {details && (
                      <>
                        <div className="jira-ticket__facts">
                          {fullTicket.project && <span><strong>Proyecto</strong>{fullTicket.project}</span>}
                          {fullTicket.issueType && <span><strong>Tipo</strong>{fullTicket.issueType}</span>}
                          <span><strong>Asignado</strong>{fullTicket.assignee || 'Sin asignar'}</span>
                          {fullTicket.reporter && <span><strong>Reportó</strong>{fullTicket.reporter}</span>}
                          {fullTicket.dueDate && <span><strong>Vence</strong>{fullTicket.dueDate}</span>}
                          {fullTicket.resolution && <span><strong>Resolución</strong>{fullTicket.resolution}</span>}
                          {fullTicket.components.length > 0 && <span><strong>Componentes</strong>{fullTicket.components.join(', ')}</span>}
                          {fullTicket.fixVersions.length > 0 && <span><strong>Versiones</strong>{fullTicket.fixVersions.join(', ')}</span>}
                        </div>

                        <section className="jira-ticket__section">
                          <h4>Descripción</h4>
                          <p className="jira-ticket__description">
                            {fullTicket.description || '(sin descripción)'}
                          </p>
                        </section>

                        <section className="jira-ticket__section">
                          <h4>Comentarios <span>{details.comments.length}</span></h4>
                          {details.comments.length === 0 ? (
                            <p className="jira-ticket__section-empty">Sin comentarios.</p>
                          ) : (
                            <ol className="jira-ticket__comments">
                              {details.comments.map((comment) => (
                                <li key={comment.id}>
                                  <div><strong>{comment.author}</strong><time dateTime={comment.created}>{formatDate(comment.created)}</time></div>
                                  <p>{comment.body || '(comentario vacío)'}</p>
                                </li>
                              ))}
                            </ol>
                          )}
                        </section>

                        <section className="jira-ticket__section">
                          <h4>Archivos <span>{details.attachments.length}</span></h4>
                          {details.attachments.length === 0 ? (
                            <p className="jira-ticket__section-empty">Sin archivos adjuntos.</p>
                          ) : (
                            <div className="jira-ticket__attachments">
                              {details.attachments.map((attachment) => (
                                <div className="jira-ticket__attachment" key={attachment.id}>
                                  <button
                                    type="button"
                                    className="jira-ticket__attachment-preview"
                                    disabled={previewingIds.has(attachment.id)}
                                    onClick={() => void previewAttachment(fullTicket.key, attachment)}
                                    title={`Ver ${attachment.filename} en Tide Commander`}
                                  >
                                    {previewingIds.has(attachment.id)
                                      ? <span className="jira-ticket__spinner" />
                                      : <Icon name="paperclip" size={10} />}
                                    <span><strong>{attachment.filename}</strong><em>{attachment.mimeType} · {formatBytes(attachment.size)}</em></span>
                                  </button>
                                  <button
                                    type="button"
                                    className="jira-ticket__attachment-download"
                                    disabled={downloadingIds.has(attachment.id)}
                                    onClick={() => void downloadAttachment(attachment)}
                                    title={`Descargar ${attachment.filename}`}
                                    aria-label={`Descargar ${attachment.filename}`}
                                  >
                                    {downloadingIds.has(attachment.id)
                                      ? <span className="jira-ticket__spinner" />
                                      : <Icon name="download" size={11} />}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>

                        {fullTicket.labels.length > 0 && (
                          <div className="jira-ticket__labels">
                            {fullTicket.labels.slice(0, 10).map((label) => <span key={label}>{label}</span>)}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {data.total > data.items.length && (
        <footer className="jira-tickets-card__limit">
          Mostrando {data.items.length} de {data.total}. Usa <code>/jira pending {Math.min(50, data.limit + 10)}</code> para ver más.
        </footer>
      )}
    </section>
  );
});
