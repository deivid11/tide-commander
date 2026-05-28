/**
 * Google Calendar Client
 * Wraps the Google Calendar API via googleapis.
 * Shares OAuth2 credentials with the Gmail plugin through the secrets system.
 * All actions are logged to SQLite via ctx.eventDb.logCalendarAction().
 */

import { google, calendar_v3 } from 'googleapis';
import type { IntegrationContext } from '../../../shared/integration-types.js';
import type { CalendarActionEvent } from '../../../shared/event-types.js';
import { loadConfig, updateConfig } from './calendar-config.js';

// ─── Types ───

export interface CalendarStatus {
  authenticated: boolean;
  connected: boolean;
  lastChecked: number;
  error?: string;
}

export interface CalendarEventTime {
  /** ISO 8601 datetime — present for timed events. */
  dateTime?: string;
  /** YYYY-MM-DD — present for all-day events. */
  date?: string;
  /** IANA timezone, when Google provides one (e.g. "America/Mexico_City"). */
  timeZone?: string;
}

export interface CalendarEvent {
  eventId: string;
  summary: string;
  description?: string;
  /** Flattened convenience: `start.dateTime || start.date || ''`. */
  startDateTime: string;
  /** Flattened convenience: `end.dateTime || end.date || ''`. */
  endDateTime: string;
  /** Raw structured start (with optional timeZone). */
  start: CalendarEventTime;
  /** Raw structured end (with optional timeZone). */
  end: CalendarEventTime;
  attendees: EventAttendee[];
  location?: string;
  htmlLink: string;
  /** Google Meet link (Google's legacy `hangoutLink` field), when the event has Meet. */
  hangoutLink?: string;
  /** Best video-conference join URL: `hangoutLink`, else a conferenceData video entry point. */
  meetingUrl?: string;
  status: string;
  created: string;
  updated: string;
  /** Calendar this event came from. Useful when listing across multiple calendars. */
  calendarId: string;
  /** Human-readable name of the source calendar (e.g. "Personal", "Work"). */
  calendarSummary?: string;
  /** Background color of the source calendar (from calendarList), for UI coloring. */
  calendarBackgroundColor?: string;
}

export interface CalendarListEntry {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  backgroundColor?: string;
}

export interface EventAttendee {
  email: string;
  displayName?: string;
  responseStatus: 'needsAction' | 'declined' | 'tentative' | 'accepted';
}

export interface CreateEventParams {
  summary: string;
  description?: string;
  startDateTime: string;
  endDateTime: string;
  attendees: string[];
  location?: string;
  reminders?: {
    useDefault: boolean;
    overrides?: { method: 'email' | 'popup'; minutes: number }[];
  };
  calendarId?: string;
  agentId?: string;
  workflowInstanceId?: string;
}

// ─── State ───

let ctx: IntegrationContext | null = null;
let calendarApi: calendar_v3.Calendar | null = null;

// ─── Init / Shutdown ───

export async function init(integrationCtx: IntegrationContext): Promise<void> {
  ctx = integrationCtx;

  const config = loadConfig();
  if (!config.enabled) {
    ctx.log.info('Google Calendar integration disabled, skipping init');
    return;
  }

  const clientId = ctx.secrets.get('GOOGLE_CLIENT_ID');
  const clientSecret = ctx.secrets.get('GOOGLE_CLIENT_SECRET');
  const refreshToken = ctx.secrets.get('GOOGLE_REFRESH_TOKEN');

  if (!clientId || !clientSecret || !refreshToken) {
    ctx.log.info('Google Calendar missing OAuth credentials, skipping init');
    return;
  }

  oauth2Client = new google.auth.OAuth2(clientId, clientSecret, getRedirectUri());
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  calendarApi = google.calendar({ version: 'v3', auth: oauth2Client });
  ctx.log.info('Google Calendar initialized');
}

export async function shutdown(): Promise<void> {
  calendarApi = null;
  oauth2Client = null;
}

// ─── Status ───

export function getStatus(): CalendarStatus {
  const config = loadConfig();
  const hasCredentials = !!(
    ctx?.secrets.get('GOOGLE_CLIENT_ID') &&
    ctx?.secrets.get('GOOGLE_CLIENT_SECRET') &&
    ctx?.secrets.get('GOOGLE_REFRESH_TOKEN')
  );

  return {
    authenticated: Boolean(calendarApi && hasCredentials),
    connected: config.enabled && hasCredentials && calendarApi !== null,
    lastChecked: Date.now(),
    error: !hasCredentials && config.enabled ? 'Missing OAuth credentials' : undefined,
  };
}

export function isConfigured(): boolean {
  return calendarApi !== null;
}

// ─── Events CRUD ───

export async function createEvent(params: CreateEventParams): Promise<CalendarEvent> {
  if (!calendarApi) throw new Error('Google Calendar not configured');

  const config = loadConfig();
  const calendarId = params.calendarId || config.calendarId || 'primary';

  const result = await calendarApi.events.insert({
    calendarId,
    requestBody: {
      summary: params.summary,
      description: params.description,
      start: { dateTime: params.startDateTime },
      end: { dateTime: params.endDateTime },
      attendees: params.attendees.map((email) => ({ email })),
      location: params.location,
      reminders: params.reminders,
    },
  });

  const event = mapGoogleEvent(result.data, { calendarId });

  // Log to SQLite
  ctx?.eventDb.logCalendarAction({
    eventId: event.eventId,
    action: 'created',
    summary: params.summary,
    startDatetime: params.startDateTime,
    endDatetime: params.endDateTime,
    attendees: params.attendees,
    htmlLink: event.htmlLink,
    agentId: params.agentId,
    workflowInstanceId: params.workflowInstanceId,
    recordedAt: Date.now(),
  } satisfies CalendarActionEvent);

  return event;
}

export async function updateEvent(
  eventId: string,
  updates: Partial<CreateEventParams>,
): Promise<CalendarEvent> {
  if (!calendarApi) throw new Error('Google Calendar not configured');

  const config = loadConfig();
  const calendarId = updates.calendarId || config.calendarId || 'primary';

  const requestBody: calendar_v3.Schema$Event = {};
  if (updates.summary !== undefined) requestBody.summary = updates.summary;
  if (updates.description !== undefined) requestBody.description = updates.description;
  if (updates.startDateTime) requestBody.start = { dateTime: updates.startDateTime };
  if (updates.endDateTime) requestBody.end = { dateTime: updates.endDateTime };
  if (updates.attendees) requestBody.attendees = updates.attendees.map((email) => ({ email }));
  if (updates.location !== undefined) requestBody.location = updates.location;
  if (updates.reminders) requestBody.reminders = updates.reminders;

  const result = await calendarApi.events.patch({
    calendarId,
    eventId,
    requestBody,
  });

  const event = mapGoogleEvent(result.data, { calendarId });

  ctx?.eventDb.logCalendarAction({
    eventId: event.eventId,
    action: 'updated',
    summary: event.summary,
    startDatetime: event.startDateTime,
    endDatetime: event.endDateTime,
    attendees: event.attendees.map((a) => a.email),
    htmlLink: event.htmlLink,
    agentId: updates.agentId,
    workflowInstanceId: updates.workflowInstanceId,
    recordedAt: Date.now(),
  } satisfies CalendarActionEvent);

  return event;
}

export async function deleteEvent(
  eventId: string,
  opts?: { calendarId?: string; agentId?: string; workflowInstanceId?: string },
): Promise<void> {
  if (!calendarApi) throw new Error('Google Calendar not configured');

  const config = loadConfig();
  const calendarId = opts?.calendarId || config.calendarId || 'primary';

  // Get event details before deletion for logging
  let summary = eventId;
  try {
    const existing = await calendarApi.events.get({ calendarId, eventId });
    summary = existing.data.summary || eventId;
  } catch {
    // Event may already be deleted, proceed
  }

  await calendarApi.events.delete({ calendarId, eventId });

  ctx?.eventDb.logCalendarAction({
    eventId,
    action: 'deleted',
    summary,
    startDatetime: '',
    endDatetime: '',
    agentId: opts?.agentId,
    workflowInstanceId: opts?.workflowInstanceId,
    recordedAt: Date.now(),
  } satisfies CalendarActionEvent);
}

export async function getEvent(
  eventId: string,
  calendarId?: string,
): Promise<CalendarEvent> {
  if (!calendarApi) throw new Error('Google Calendar not configured');

  const config = loadConfig();
  const targetCalendarId = calendarId || config.calendarId || 'primary';
  const result = await calendarApi.events.get({
    calendarId: targetCalendarId,
    eventId,
  });

  return mapGoogleEvent(result.data, { calendarId: targetCalendarId });
}

export async function listEvents(params: {
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  /** Single calendar (retained for backwards compatibility). Ignored when `calendarIds` is set. */
  calendarId?: string;
  /** Multiple calendars — results are merged and re-sorted by start time. */
  calendarIds?: string[];
}): Promise<CalendarEvent[]> {
  if (!calendarApi) throw new Error('Google Calendar not configured');
  const api = calendarApi;

  const config = loadConfig();

  // Resolve target calendar list. Multi-calendar takes precedence over single.
  const targets: string[] = params.calendarIds && params.calendarIds.length > 0
    ? params.calendarIds
    : [params.calendarId || config.calendarId || 'primary'];

  // Look up calendar metadata (summary + color) once so each event can report its source.
  const metadata = await getCalendarMetadata(targets);

  const perCalendarResults = await Promise.all(
    targets.map(async (calendarId) => {
      const result = await api.events.list({
        calendarId,
        timeMin: params.timeMin,
        timeMax: params.timeMax,
        maxResults: params.maxResults || 50,
        singleEvents: true,
        orderBy: 'startTime',
      });
      const meta = metadata.get(calendarId);
      return (result.data.items || []).map((item) =>
        mapGoogleEvent(item, {
          calendarId,
          calendarSummary: meta?.summary,
          calendarBackgroundColor: meta?.backgroundColor,
        }),
      );
    }),
  );

  const merged = perCalendarResults.flat();
  merged.sort((a, b) => a.startDateTime.localeCompare(b.startDateTime));
  return merged;
}

/**
 * List calendars visible to the authenticated user, including ones shared from
 * other Google accounts. Mirrors `calendarList.list` with `minAccessRole: reader`
 * so we only surface calendars whose events can actually be read.
 */
export async function listCalendars(): Promise<CalendarListEntry[]> {
  if (!calendarApi) throw new Error('Google Calendar not configured');

  const result = await calendarApi.calendarList.list({ minAccessRole: 'reader' });
  return (result.data.items || []).map((item) => ({
    id: item.id || '',
    summary: item.summary || '',
    primary: Boolean(item.primary),
    accessRole: item.accessRole || '',
    backgroundColor: item.backgroundColor || undefined,
  }));
}

interface CalendarMeta {
  summary: string;
  backgroundColor?: string;
}

/** Best-effort lookup of summary + color for a set of calendar IDs. Failures fall back to empty. */
async function getCalendarMetadata(calendarIds: string[]): Promise<Map<string, CalendarMeta>> {
  const map = new Map<string, CalendarMeta>();
  if (!calendarApi || calendarIds.length === 0) return map;
  try {
    const list = await calendarApi.calendarList.list({ minAccessRole: 'reader' });
    for (const item of list.data.items || []) {
      if (item.id) {
        map.set(item.id, {
          summary: item.summary || '',
          backgroundColor: item.backgroundColor || undefined,
        });
      }
    }
  } catch {
    // Permission/network failure — leave metadata blank rather than failing the whole listEvents call.
  }
  return map;
}

// ─── Working Days Calculation ───

export interface WorkingDaysResult {
  workingDays: number;
  isUrgent: boolean;
  holidays: string[];
}

export function calculateWorkingDays(
  startDate: string,
  targetDate: string,
  holidayOverrides?: string[],
): WorkingDaysResult {
  const config = loadConfig();
  const holidays = new Set(holidayOverrides || config.holidays);

  const start = new Date(startDate);
  const target = new Date(targetDate);

  // Normalize to start of day
  start.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  let workingDays = 0;
  const current = new Date(start);

  while (current < target) {
    current.setDate(current.getDate() + 1);
    const dayOfWeek = current.getDay();
    const dateStr = current.toISOString().split('T')[0];

    // Skip weekends (0 = Sunday, 6 = Saturday) and holidays
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidays.has(dateStr)) {
      workingDays++;
    }
  }

  return {
    workingDays,
    isUrgent: workingDays < config.urgentThreshold,
    holidays: Array.from(holidays),
  };
}

// ─── Helpers ───

// ─── OAuth ───

// Combined scopes for both Gmail and Calendar (shared OAuth client)
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
];
const REDIRECT_PATH = '/api/calendar/auth/callback'; // Calendar's own callback

let oauth2Client: InstanceType<typeof google.auth.OAuth2> | null = null;

function getRedirectUri(): string {
  if (!ctx) throw new Error('Google Calendar not initialized');
  const override = ctx.secrets.get('GOOGLE_REDIRECT_BASE_URL')?.trim();
  const base = (override || ctx.serverConfig.baseUrl).replace(/\/$/, '');
  return `${base}${REDIRECT_PATH}`;
}

export function getAuthUrl(): string {
  if (!oauth2Client) {
    const clientId = ctx?.secrets.get('GOOGLE_CLIENT_ID');
    const clientSecret = ctx?.secrets.get('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret || !ctx) {
      throw new Error('Google Calendar OAuth not configured');
    }
    oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      getRedirectUri()
    );
  }
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

export async function handleAuthCallback(code: string): Promise<void> {
  if (!oauth2Client || !ctx) throw new Error('Google Calendar OAuth not initialized');

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  if (tokens.refresh_token) {
    ctx.secrets.set('GOOGLE_REFRESH_TOKEN', tokens.refresh_token);
  }

  calendarApi = google.calendar({ version: 'v3', auth: oauth2Client });

  // Auto-enable the integration after successful OAuth
  updateConfig({ enabled: true });

  ctx.log.info(`Google Calendar OAuth complete. Calendar initialized.`);
}

function mapGoogleEvent(
  data: calendar_v3.Schema$Event,
  source?: { calendarId: string; calendarSummary?: string; calendarBackgroundColor?: string },
): CalendarEvent {
  const start: CalendarEventTime = {
    dateTime: data.start?.dateTime || undefined,
    date: data.start?.date || undefined,
    timeZone: data.start?.timeZone || undefined,
  };
  const end: CalendarEventTime = {
    dateTime: data.end?.dateTime || undefined,
    date: data.end?.date || undefined,
    timeZone: data.end?.timeZone || undefined,
  };
  // Surface the meeting join link. Google Meet populates `hangoutLink`; other
  // providers (Zoom, Teams, Webex) show up as a "video" entry point in conferenceData.
  const hangoutLink = data.hangoutLink || undefined;
  const videoEntry = data.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === 'video' && e.uri,
  );
  const meetingUrl = hangoutLink || videoEntry?.uri || undefined;
  return {
    eventId: data.id || '',
    summary: data.summary || '',
    description: data.description || undefined,
    startDateTime: start.dateTime || start.date || '',
    endDateTime: end.dateTime || end.date || '',
    start,
    end,
    attendees: (data.attendees || []).map((a) => ({
      email: a.email || '',
      displayName: a.displayName || undefined,
      responseStatus: (a.responseStatus as EventAttendee['responseStatus']) || 'needsAction',
    })),
    location: data.location || undefined,
    htmlLink: data.htmlLink || '',
    hangoutLink,
    meetingUrl,
    status: data.status || '',
    created: data.created || '',
    updated: data.updated || '',
    calendarId: source?.calendarId || '',
    calendarSummary: source?.calendarSummary,
    calendarBackgroundColor: source?.calendarBackgroundColor,
  };
}
