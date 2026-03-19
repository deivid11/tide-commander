/**
 * Google Calendar Client
 * Wraps the Google Calendar API via googleapis.
 * Shares OAuth2 credentials with the Gmail plugin through the secrets system.
 * All actions are logged to SQLite via ctx.eventDb.logCalendarAction().
 */

import { google, calendar_v3 } from 'googleapis';
import type { IntegrationContext, IntegrationStatus } from '../../../shared/integration-types.js';
import type { CalendarActionEvent } from '../../../shared/event-types.js';
import { loadConfig } from './calendar-config.js';

// ─── Types ───

export interface CalendarEvent {
  eventId: string;
  summary: string;
  description?: string;
  startDateTime: string;
  endDateTime: string;
  attendees: EventAttendee[];
  location?: string;
  htmlLink: string;
  status: string;
  created: string;
  updated: string;
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

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  calendarApi = google.calendar({ version: 'v3', auth: oauth2Client });
  ctx.log.info('Google Calendar initialized');
}

export async function shutdown(): Promise<void> {
  calendarApi = null;
}

// ─── Status ───

export function getStatus(): IntegrationStatus {
  const config = loadConfig();
  const hasCredentials = !!(
    ctx?.secrets.get('GOOGLE_CLIENT_ID') &&
    ctx?.secrets.get('GOOGLE_CLIENT_SECRET') &&
    ctx?.secrets.get('GOOGLE_REFRESH_TOKEN')
  );

  return {
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

  const event = mapGoogleEvent(result.data);

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

  const event = mapGoogleEvent(result.data);

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
  const result = await calendarApi.events.get({
    calendarId: calendarId || config.calendarId || 'primary',
    eventId,
  });

  return mapGoogleEvent(result.data);
}

export async function listEvents(params: {
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  calendarId?: string;
}): Promise<CalendarEvent[]> {
  if (!calendarApi) throw new Error('Google Calendar not configured');

  const config = loadConfig();
  const result = await calendarApi.events.list({
    calendarId: params.calendarId || config.calendarId || 'primary',
    timeMin: params.timeMin,
    timeMax: params.timeMax,
    maxResults: params.maxResults || 50,
    singleEvents: true,
    orderBy: 'startTime',
  });

  return (result.data.items || []).map(mapGoogleEvent);
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

function mapGoogleEvent(data: calendar_v3.Schema$Event): CalendarEvent {
  return {
    eventId: data.id || '',
    summary: data.summary || '',
    description: data.description || undefined,
    startDateTime: data.start?.dateTime || data.start?.date || '',
    endDateTime: data.end?.dateTime || data.end?.date || '',
    attendees: (data.attendees || []).map((a) => ({
      email: a.email || '',
      displayName: a.displayName || undefined,
      responseStatus: (a.responseStatus as EventAttendee['responseStatus']) || 'needsAction',
    })),
    location: data.location || undefined,
    htmlLink: data.htmlLink || '',
    status: data.status || '',
    created: data.created || '',
    updated: data.updated || '',
  };
}
