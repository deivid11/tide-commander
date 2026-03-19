/**
 * Google Calendar Routes
 * Express Router with CRUD endpoints for calendar events and a working-days utility.
 * Mounted at /api/calendar/ by the integration registry.
 */

import { Router, Request, Response } from 'express';
import * as calendarClient from './calendar-client.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('CalendarRoutes');

const router = Router();

// POST /api/calendar/events — Create an event
router.post('/events', async (req: Request, res: Response) => {
  try {
    const { summary, description, startDateTime, endDateTime, attendees, location, reminders, calendarId, agentId, workflowInstanceId } = req.body;

    if (!summary || !startDateTime || !endDateTime) {
      res.status(400).json({ error: 'summary, startDateTime, and endDateTime are required' });
      return;
    }

    const event = await calendarClient.createEvent({
      summary,
      description,
      startDateTime,
      endDateTime,
      attendees: attendees || [],
      location,
      reminders,
      calendarId,
      agentId,
      workflowInstanceId,
    });

    res.json({ event });
  } catch (err) {
    log.error(`Calendar create event error: ${err}`);
    res.status(500).json({ error: `Failed to create event: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/calendar/events — List events
router.get('/events', async (req: Request, res: Response) => {
  try {
    const events = await calendarClient.listEvents({
      timeMin: req.query.timeMin as string | undefined,
      timeMax: req.query.timeMax as string | undefined,
      maxResults: req.query.maxResults ? parseInt(req.query.maxResults as string, 10) : undefined,
      calendarId: req.query.calendarId as string | undefined,
    });

    res.json({ events });
  } catch (err) {
    log.error(`Calendar list events error: ${err}`);
    res.status(500).json({ error: `Failed to list events: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /api/calendar/events/:eventId — Get a single event
router.get('/events/:eventId', async (req: Request<{ eventId: string }>, res: Response) => {
  try {
    const event = await calendarClient.getEvent(
      req.params.eventId,
      req.query.calendarId as string | undefined,
    );
    res.json({ event });
  } catch (err) {
    log.error(`Calendar get event error: ${err}`);
    res.status(500).json({ error: `Failed to get event: ${err instanceof Error ? err.message : err}` });
  }
});

// PATCH /api/calendar/events/:eventId — Update an event
router.patch('/events/:eventId', async (req: Request<{ eventId: string }>, res: Response) => {
  try {
    const event = await calendarClient.updateEvent(req.params.eventId, req.body);
    res.json({ event });
  } catch (err) {
    log.error(`Calendar update event error: ${err}`);
    res.status(500).json({ error: `Failed to update event: ${err instanceof Error ? err.message : err}` });
  }
});

// DELETE /api/calendar/events/:eventId — Delete an event
router.delete('/events/:eventId', async (req: Request<{ eventId: string }>, res: Response) => {
  try {
    await calendarClient.deleteEvent(req.params.eventId, {
      calendarId: req.query.calendarId as string | undefined,
      agentId: req.body?.agentId,
      workflowInstanceId: req.body?.workflowInstanceId,
    });
    res.json({ success: true });
  } catch (err) {
    log.error(`Calendar delete event error: ${err}`);
    res.status(500).json({ error: `Failed to delete event: ${err instanceof Error ? err.message : err}` });
  }
});

// POST /api/calendar/working-days — Calculate working days to a target date
router.post('/working-days', (req: Request, res: Response) => {
  try {
    const { targetDate, startDate, holidays } = req.body;

    if (!targetDate) {
      res.status(400).json({ error: 'targetDate is required (ISO date string, e.g. "2024-03-15")' });
      return;
    }

    const start = startDate || new Date().toISOString().split('T')[0];
    const result = calendarClient.calculateWorkingDays(start, targetDate, holidays);

    res.json(result);
  } catch (err) {
    log.error(`Calendar working-days error: ${err}`);
    res.status(500).json({ error: `Failed to calculate working days: ${err instanceof Error ? err.message : err}` });
  }
});

export default router;
