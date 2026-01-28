/**
 * Voice Assistant Route
 * Processes voice commands using Claude Code (haiku) with persistent session
 */

import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import { StringDecoder } from 'string_decoder';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { agentService } from '../services/index.js';
import { loadAreas } from '../data/index.js';
import { ClaudeBackend } from '../claude/index.js';
import { logger, sanitizeUnicode } from '../utils/index.js';

const router = Router();
const claudeBackend = new ClaudeBackend();

// Voice assistant state file
const VOICE_STATE_FILE = path.join(os.homedir(), '.local/share/tide-commander/voice-assistant.json');

// Persistent session ID for voice assistant
let voiceSessionId: string | null = null;

/**
 * Load voice assistant state from disk
 */
function loadVoiceState(): void {
  try {
    if (fs.existsSync(VOICE_STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(VOICE_STATE_FILE, 'utf-8'));
      voiceSessionId = data.sessionId || null;
      logger.server.log(`[VoiceAssistant] Loaded session: ${voiceSessionId}`);
    }
  } catch (err) {
    logger.server.error(`[VoiceAssistant] Failed to load state:`, err);
  }
}

/**
 * Save voice assistant state to disk
 */
function saveVoiceState(): void {
  try {
    const dir = path.dirname(VOICE_STATE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(VOICE_STATE_FILE, JSON.stringify({
      sessionId: voiceSessionId,
      updatedAt: Date.now(),
    }, null, 2));
  } catch (err) {
    logger.server.error(`[VoiceAssistant] Failed to save state:`, err);
  }
}

// Load state on module init
loadVoiceState();

/**
 * Build the system prompt with current agent list and their areas
 */
function buildSystemPrompt(): string {
  const agents = agentService.getAllAgents();
  const areas = loadAreas();

  // Build agent list with their assigned areas and boss status
  const agentList = agents.map(a => {
    const agentAreas = areas.filter(area => area.assignedAgentIds.includes(a.id));
    const areaNames = agentAreas.map(area => area.name).join(', ');
    const parts = [`${a.name} (id: ${a.id}, ${a.status})`];
    if (a.isBoss) parts.push('[BOSS]');
    if (areaNames) parts.push(`[areas: ${areaNames}]`);
    return `- ${parts.join(' ')}`;
  }).join('\n');

  return `YOU ARE A JSON API. YOU MUST ONLY OUTPUT VALID JSON. NEVER OUTPUT TEXT OR EXPLANATIONS.

You route voice commands to AI agents. You do NOT write code. You do NOT help directly. You ONLY parse and route.

Agents:
${agentList}

REQUIRED OUTPUT FORMAT (nothing else):
{"targetAgentId":"id|null","targetAgentName":"name|null","messageToAgent":"the user's request to forward","responseToUser":"brief confirmation under 15 words","action":"send_to_agent|list_agents|general_response"}

ACTIONS:
- send_to_agent: User wants an agent to do something. Put their request in messageToAgent.
- list_agents: User asks about agents
- general_response: Greetings only

IMPORTANT: responseToUser MUST be in the SAME LANGUAGE as the user's message. If user speaks Spanish, respond in Spanish. If English, respond in English.

CRITICAL: Your response must be ONLY the JSON object. No markdown. No explanations. No code.`;
}

/**
 * Call Claude Code with haiku model, maintaining session
 */
async function callClaudeHaiku(userMessage: string, isFirstMessage: boolean): Promise<{ text: string; sessionId: string | null }> {
  return new Promise((resolve, reject) => {
    const executable = claudeBackend.getExecutablePath();
    const args = [
      '--print',
      '--verbose',
      '--model', 'haiku',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
    ];

    // Always write system prompt to temp file - Claude Code needs it on every call
    const systemPromptFile = path.join(os.tmpdir(), `voice-assistant-prompt-${Date.now()}.txt`);
    fs.writeFileSync(systemPromptFile, buildSystemPrompt());
    args.push('--system-prompt-file', systemPromptFile);

    // Resume existing session if available
    if (voiceSessionId && !isFirstMessage) {
      args.push('--resume', voiceSessionId);
    }

    const childProcess = spawn(executable, args, {
      env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
      shell: false, // Don't use shell to avoid escaping issues
    });

    // Clean up temp file when done
    const cleanup = () => {
      if (fs.existsSync(systemPromptFile)) {
        try { fs.unlinkSync(systemPromptFile); } catch { /* ignore */ }
      }
    };

    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let textOutput = '';
    let newSessionId: string | null = null;

    childProcess.stdout?.on('data', (data: Buffer) => {
      buffer += decoder.write(data);
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          // Capture session ID from init event
          if (event.type === 'system' && event.session_id) {
            newSessionId = event.session_id;
          }

          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) textOutput += block.text;
            }
          }
          if (event.type === 'stream_event' && event.event?.type === 'content_block_delta') {
            if (event.event.delta?.type === 'text_delta' && event.event.delta.text) {
              textOutput += event.event.delta.text;
            }
          }
        } catch { /* ignore non-JSON */ }
      }
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      const msg = decoder.write(data);
      // Only log actual errors, not verbose output
      if (msg.includes('Error') || msg.includes('error')) {
        logger.server.error(`[VoiceAssistant] Claude stderr: ${msg}`);
      }
    });

    childProcess.on('close', (code) => {
      cleanup();
      const remaining = buffer + decoder.end();
      if (remaining.trim()) {
        try {
          const event = JSON.parse(remaining);
          if (event.type === 'system' && event.session_id) {
            newSessionId = event.session_id;
          }
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) textOutput += block.text;
            }
          }
        } catch { /* ignore */ }
      }

      if (code !== 0 && !textOutput) reject(new Error(`Claude exited with code ${code}`));
      else if (!textOutput) reject(new Error('No response from Claude'));
      else resolve({ text: textOutput, sessionId: newSessionId });
    });

    childProcess.on('error', (err) => {
      cleanup();
      reject(err);
    });

    childProcess.on('spawn', () => {
      // Include routing instruction with every message to ensure compliance
      const routingInstruction = isFirstMessage ? '' : '\n\n[REMINDER: Output ONLY JSON. No explanations.]';
      const stdinMessage = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: sanitizeUnicode(userMessage) + routingInstruction },
      });
      childProcess.stdin?.write(stdinMessage + '\n');
      childProcess.stdin?.end();
    });

    setTimeout(() => {
      if (!childProcess.killed) {
        childProcess.kill('SIGTERM');
        cleanup();
        reject(new Error('Claude timed out'));
      }
    }, 30000);
  });
}

function stripCodeFences(s: string): string {
  s = s.trim();
  if (s.startsWith('```json')) s = s.slice(7);
  else if (s.startsWith('```')) s = s.slice(3);
  if (s.endsWith('```')) s = s.slice(0, -3);
  return s.trim();
}

interface ProcessedCommand {
  targetAgentId: string | null;
  targetAgentName: string | null;
  messageToAgent: string;
  responseToUser: string;
  action: 'send_to_agent' | 'list_agents' | 'general_response';
}

/**
 * POST /api/voice-assistant/process
 */
router.post('/process', async (req: Request, res: Response) => {
  const { text } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Text is required' });
  }

  logger.server.log(`[VoiceAssistant] Processing: "${text}" (session: ${voiceSessionId || 'new'})`);

  try {
    const isFirstMessage = !voiceSessionId;
    const { text: response, sessionId } = await callClaudeHaiku(text, isFirstMessage);

    // Save session ID for future messages
    if (sessionId && sessionId !== voiceSessionId) {
      voiceSessionId = sessionId;
      saveVoiceState();
      logger.server.log(`[VoiceAssistant] Session saved: ${voiceSessionId}`);
    }

    const jsonStr = stripCodeFences(response);

    let parsed: ProcessedCommand;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      logger.server.error(`[VoiceAssistant] Failed to parse: ${jsonStr}`);
      throw new Error('Failed to parse response');
    }

    logger.server.log(`[VoiceAssistant] Parsed:`, parsed);

    if (parsed.action === 'send_to_agent' && parsed.targetAgentId) {
      const targetAgent = agentService.getAgent(parsed.targetAgentId);
      if (!targetAgent) {
        return res.json({
          success: true,
          response: `No encuentro al agente ${parsed.targetAgentName}`,
        });
      }

      const { claudeService, bossMessageService } = await import('../services/index.js');
      const { buildCustomAgentConfig } = await import('../websocket/handlers/command-handler.js');

      if (targetAgent.isBoss || targetAgent.class === 'boss') {
        const { message: bossMessage, systemPrompt } = await bossMessageService.buildBossMessage(
          parsed.targetAgentId,
          parsed.messageToAgent
        );
        await claudeService.sendCommand(parsed.targetAgentId, bossMessage, systemPrompt);
      } else {
        const customAgentConfig = buildCustomAgentConfig(parsed.targetAgentId, targetAgent.class);
        await claudeService.sendCommand(parsed.targetAgentId, parsed.messageToAgent, undefined, undefined, customAgentConfig);
      }

      logger.server.log(`[VoiceAssistant] Sent to ${targetAgent.name}: "${parsed.messageToAgent}"`);

      return res.json({
        success: true,
        response: parsed.responseToUser,
        targetAgent: { id: targetAgent.id, name: targetAgent.name },
        messageSent: parsed.messageToAgent,
      });
    }

    return res.json({
      success: true,
      response: parsed.responseToUser,
    });
  } catch (err: any) {
    const msg = err?.message || 'Unknown error';
    logger.server.error(`[VoiceAssistant] Error: ${msg}`);

    // Reset session on error so next message starts fresh
    if (msg.includes('exited with code') || msg.includes('timed out')) {
      voiceSessionId = null;
    }

    return res.status(500).json({ error: 'Failed to process', details: msg });
  }
});

/**
 * POST /api/voice-assistant/reset
 * Reset the voice assistant session
 */
router.post('/reset', (_req: Request, res: Response) => {
  voiceSessionId = null;
  saveVoiceState();
  logger.server.log('[VoiceAssistant] Session reset');
  res.json({ success: true, message: 'Session reset' });
});

router.get('/status', (_req: Request, res: Response) => {
  res.json({
    available: true,
    hasSession: !!voiceSessionId,
    sessionId: voiceSessionId,
    agentCount: agentService.getAllAgents().length,
  });
});

export default router;
