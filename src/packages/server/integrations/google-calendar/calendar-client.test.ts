import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { calendar_v3 } from 'googleapis';

// ─── Mocks ───

// Mocked Google Calendar v3 surface. Tests reach into these `vi.fn()`s to assert
// call counts/args and to set per-call return values.
const eventsListMock = vi.fn();
const calendarListListMock = vi.fn();

const mockCalendarApi = {
  events: { list: eventsListMock },
  calendarList: { list: calendarListListMock },
} as unknown as calendar_v3.Calendar;

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
        generateAuthUrl() { return 'https://example.test/auth'; }
        async getToken() { return { tokens: {} }; }
      },
    },
    calendar: () => mockCalendarApi,
  },
}));

// Keep config fully in-memory — never touch the real data dir.
vi.mock('./calendar-config.js', () => ({
  loadConfig: () => ({
    enabled: true,
    calendarId: 'primary',
    additionalCalendarIds: [],
    holidays: [],
    urgentThreshold: 2,
  }),
  updateConfig: () => {},
}));

// Import AFTER vi.mock so the mocks are picked up.
import * as calendarClient from './calendar-client.js';
import type { IntegrationContext } from '../../../shared/integration-types.js';

// ─── Test setup ───

function buildCtx(): IntegrationContext {
  const secrets = new Map<string, string>([
    ['GOOGLE_CLIENT_ID', 'cid'],
    ['GOOGLE_CLIENT_SECRET', 'csec'],
    ['GOOGLE_REFRESH_TOKEN', 'rtok'],
  ]);
  return {
    eventDb: {
      logTriggerFire: () => undefined,
      logSlackMessage: () => undefined,
      logWhatsAppMessage: () => undefined,
      logEmailMessage: () => undefined,
      logApprovalEvent: () => undefined,
      logDocumentGeneration: () => undefined,
      logCalendarAction: () => undefined,
      logDriveAction: () => undefined,
      logJiraTicketAction: () => undefined,
      logAudit: () => undefined,
    },
    sendAgentMessage: async () => {},
    broadcast: () => {},
    secrets: {
      get: (k) => secrets.get(k),
      set: (k, v) => { secrets.set(k, v); },
    },
    serverConfig: {
      port: 5174,
      host: 'localhost',
      baseUrl: 'http://localhost:5174',
    },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
}

beforeEach(async () => {
  eventsListMock.mockReset();
  calendarListListMock.mockReset();
  await calendarClient.init(buildCtx());
});

// ─── Tests ───

describe('listCalendars()', () => {
  it('maps calendarList.list output into CalendarListEntry[] and requests reader access', async () => {
    calendarListListMock.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'primary',
            summary: 'Work',
            primary: true,
            accessRole: 'owner',
            backgroundColor: '#9fe1e7',
          },
          {
            id: 'personal@gmail.com',
            summary: 'Personal',
            accessRole: 'reader',
            backgroundColor: '#fbe983',
          },
          // Item with no id should still map (id falls back to '').
          { summary: 'Stray', accessRole: 'reader' },
        ],
      },
    });

    const out = await calendarClient.listCalendars();

    expect(calendarListListMock).toHaveBeenCalledTimes(1);
    expect(calendarListListMock).toHaveBeenCalledWith({ minAccessRole: 'reader' });
    expect(out).toEqual([
      {
        id: 'primary',
        summary: 'Work',
        primary: true,
        accessRole: 'owner',
        backgroundColor: '#9fe1e7',
      },
      {
        id: 'personal@gmail.com',
        summary: 'Personal',
        primary: false,
        accessRole: 'reader',
        backgroundColor: '#fbe983',
      },
      {
        id: '',
        summary: 'Stray',
        primary: false,
        accessRole: 'reader',
        backgroundColor: undefined,
      },
    ]);
  });
});

describe('listEvents() with multi-calendarId', () => {
  it('makes one events.list call per calendarId and merges results sorted by start time', async () => {
    // calendarList lookup for summary + color tagging — return both calendars.
    calendarListListMock.mockResolvedValueOnce({
      data: {
        items: [
          { id: 'a', summary: 'Cal A', backgroundColor: '#aabbcc' },
          { id: 'b', summary: 'Cal B', backgroundColor: '#ddeeff' },
        ],
      },
    });

    // Per-calendar events.list returns. Note: out-of-order on purpose
    // so the merge-sort behaviour is observable.
    eventsListMock.mockImplementation(async ({ calendarId }: { calendarId: string }) => {
      if (calendarId === 'a') {
        return {
          data: {
            items: [
              {
                id: 'a-2',
                summary: 'A late',
                start: { dateTime: '2026-05-29T15:00:00-06:00', timeZone: 'America/Mexico_City' },
                end: { dateTime: '2026-05-29T16:00:00-06:00', timeZone: 'America/Mexico_City' },
                location: 'Office',
                htmlLink: 'https://calendar.google.com/event?eid=a-2',
              },
              {
                id: 'a-1',
                summary: 'A early',
                start: { dateTime: '2026-05-28T09:00:00-06:00' },
                end: { dateTime: '2026-05-28T10:00:00-06:00' },
              },
            ],
          },
        };
      }
      if (calendarId === 'b') {
        return {
          data: {
            items: [
              {
                id: 'b-1',
                summary: 'B mid',
                start: { dateTime: '2026-05-28T19:00:00-06:00' },
                end: { dateTime: '2026-05-28T21:00:00-06:00' },
              },
            ],
          },
        };
      }
      return { data: { items: [] } };
    });

    const events = await calendarClient.listEvents({ calendarIds: ['a', 'b'] });

    // Two calendarIds → two events.list calls.
    expect(eventsListMock).toHaveBeenCalledTimes(2);
    const calledCalendarIds = eventsListMock.mock.calls
      .map((c) => (c[0] as { calendarId: string }).calendarId)
      .sort();
    expect(calledCalendarIds).toEqual(['a', 'b']);

    // Merged + sorted by start time, with calendarId/calendarSummary stamped on each.
    expect(events.map((e) => ({
      id: e.eventId,
      calendarId: e.calendarId,
      calendarSummary: e.calendarSummary,
      calendarBackgroundColor: e.calendarBackgroundColor,
      start: e.startDateTime,
    }))).toEqual([
      { id: 'a-1', calendarId: 'a', calendarSummary: 'Cal A', calendarBackgroundColor: '#aabbcc', start: '2026-05-28T09:00:00-06:00' },
      { id: 'b-1', calendarId: 'b', calendarSummary: 'Cal B', calendarBackgroundColor: '#ddeeff', start: '2026-05-28T19:00:00-06:00' },
      { id: 'a-2', calendarId: 'a', calendarSummary: 'Cal A', calendarBackgroundColor: '#aabbcc', start: '2026-05-29T15:00:00-06:00' },
    ]);

    // Structured start/end (with timeZone) + location + htmlLink are passed through.
    const aLate = events.find((e) => e.eventId === 'a-2');
    expect(aLate).toBeDefined();
    expect(aLate?.start).toEqual({
      dateTime: '2026-05-29T15:00:00-06:00',
      date: undefined,
      timeZone: 'America/Mexico_City',
    });
    expect(aLate?.end).toEqual({
      dateTime: '2026-05-29T16:00:00-06:00',
      date: undefined,
      timeZone: 'America/Mexico_City',
    });
    expect(aLate?.location).toBe('Office');
    expect(aLate?.htmlLink).toBe('https://calendar.google.com/event?eid=a-2');
  });

  it('still works with a single calendarId (backwards compat)', async () => {
    calendarListListMock.mockResolvedValueOnce({
      data: { items: [{ id: 'primary', summary: 'Work' }] },
    });
    eventsListMock.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'p-1',
            summary: 'Solo',
            start: { dateTime: '2026-06-01T10:00:00-06:00' },
            end: { dateTime: '2026-06-01T11:00:00-06:00' },
          },
        ],
      },
    });

    const events = await calendarClient.listEvents({ calendarId: 'primary' });

    expect(eventsListMock).toHaveBeenCalledTimes(1);
    expect((eventsListMock.mock.calls[0][0] as { calendarId: string }).calendarId).toBe('primary');
    expect(events).toHaveLength(1);
    expect(events[0].calendarId).toBe('primary');
    expect(events[0].calendarSummary).toBe('Work');
  });
});
