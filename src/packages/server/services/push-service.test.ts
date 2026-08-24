/**
 * Tests for the FCM push service: message shape, JWT assertion, credential
 * validation and the device registry (token rotation / dedupe).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import type { AgentNotification } from '../../shared/types.js';

// Point the service's DATA_DIR at a throwaway directory before importing it —
// the paths are resolved at module load.
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-push-test-'));
process.env.XDG_DATA_HOME = TEST_HOME;

const {
  registerDevice,
  unregisterDevice,
  loadDevices,
  buildFcmMessage,
  buildAssertion,
  validateServiceAccount,
  getPushStatus,
  sendAgentPush,
} = await import('./push-service.js');

const DEVICES_FILE = path.join(TEST_HOME, 'tide-commander', 'push-devices.json');

const NOTIFICATION: AgentNotification = {
  id: 'notif-1',
  agentId: 'agent-42',
  agentName: 'Metapod',
  agentClass: 'support',
  title: 'Task Complete',
  message: 'Build finished',
  timestamp: 1_700_000_000_000,
};

beforeEach(() => {
  if (fs.existsSync(DEVICES_FILE)) fs.unlinkSync(DEVICES_FILE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('device registry', () => {
  it('stores a device and reads it back', () => {
    registerDevice({ token: 'tok-a', deviceId: 'phone-1', deviceName: 'Pixel' });
    const devices = loadDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ token: 'tok-a', deviceId: 'phone-1', platform: 'android' });
  });

  it('replaces the row when FCM rotates the token of a known device', () => {
    registerDevice({ token: 'tok-old', deviceId: 'phone-1' });
    registerDevice({ token: 'tok-new', deviceId: 'phone-1' });

    const devices = loadDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0].token).toBe('tok-new');
  });

  it('keeps distinct devices apart', () => {
    registerDevice({ token: 'tok-a', deviceId: 'phone-1' });
    registerDevice({ token: 'tok-b', deviceId: 'tablet-1' });
    expect(loadDevices()).toHaveLength(2);
  });

  it('preserves the original registration date across a refresh', () => {
    const first = registerDevice({ token: 'tok-a', deviceId: 'phone-1' });
    const second = registerDevice({ token: 'tok-b', deviceId: 'phone-1' });
    expect(second.registeredAt).toBe(first.registeredAt);
  });

  it('unregisters by token', () => {
    registerDevice({ token: 'tok-a', deviceId: 'phone-1' });
    expect(unregisterDevice('tok-a')).toBe(true);
    expect(unregisterDevice('tok-a')).toBe(false);
    expect(loadDevices()).toHaveLength(0);
  });

  it('rejects an empty token', () => {
    expect(() => registerDevice({ token: '  ' })).toThrow(/token is required/);
  });

  it('never exposes raw tokens in the status payload', () => {
    registerDevice({ token: 'super-secret-token-value', deviceId: 'phone-1' });
    const status = getPushStatus();
    expect(JSON.stringify(status)).not.toContain('super-secret-token-value');
    expect(status.devices[0].tokenPreview).toMatch(/…/);
  });
});

describe('buildFcmMessage', () => {
  it('targets the high-priority agent channel', () => {
    const message = buildFcmMessage(NOTIFICATION, 'tok-a') as any;
    expect(message.message.token).toBe('tok-a');
    expect(message.message.android.priority).toBe('HIGH');
    expect(message.message.android.notification.channel_id).toBe('agent_alerts');
  });

  it('prefixes the title with the agent name', () => {
    const message = buildFcmMessage(NOTIFICATION, 'tok-a') as any;
    expect(message.message.notification.title).toBe('Metapod: Task Complete');
    expect(message.message.notification.body).toBe('Build finished');
  });

  it('carries agentId in data so a tap can open the chat', () => {
    const message = buildFcmMessage(NOTIFICATION, 'tok-a') as any;
    expect(message.message.data.agentId).toBe('agent-42');
    expect(message.message.data.type).toBe('agent_notification');
  });

  it('stringifies every data value — FCM rejects non-string data', () => {
    const message = buildFcmMessage(NOTIFICATION, 'tok-a') as any;
    for (const value of Object.values(message.message.data)) {
      expect(typeof value).toBe('string');
    }
  });

  it('tags each alert with its own id so alerts stack instead of collapsing', () => {
    const message = buildFcmMessage(NOTIFICATION, 'tok-a') as any;
    expect(message.message.android.notification.tag).toBe('notif-1');
  });

  it('omits the image key when no imageUrl is set', () => {
    const message = buildFcmMessage(NOTIFICATION, 'tok-a') as any;
    expect(message.message.android.notification.image).toBeUndefined();
  });

  it('passes imageUrl through as the big-picture image', () => {
    const message = buildFcmMessage(
      { ...NOTIFICATION, imageUrl: 'https://example.test/x.png' },
      'tok-a'
    ) as any;
    expect(message.message.android.notification.image).toBe('https://example.test/x.png');
  });
});

describe('validateServiceAccount', () => {
  it('rejects JSON missing the required fields', () => {
    expect(() => validateServiceAccount({ project_id: 'p' })).toThrow(/project_id, client_email/);
  });

  it('rejects a private_key that is not a PEM block', () => {
    expect(() =>
      validateServiceAccount({ project_id: 'p', client_email: 'a@b.c', private_key: 'nope' })
    ).toThrow(/PEM key/);
  });
});

describe('buildAssertion', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = {
    project_id: 'tide-test',
    client_email: 'push@tide-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };

  it('produces a verifiable RS256 JWT scoped to FCM', () => {
    const jwt = buildAssertion(account, 1_700_000_000);
    const [header, claims, signature] = jwt.split('.');

    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });

    const payload = JSON.parse(Buffer.from(claims, 'base64url').toString());
    expect(payload.iss).toBe(account.client_email);
    expect(payload.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
    expect(payload.exp - payload.iat).toBe(3600);

    const verified = crypto
      .createVerify('RSA-SHA256')
      .update(`${header}.${claims}`)
      .verify(account.private_key, Buffer.from(signature, 'base64url'));
    expect(verified).toBe(true);
  });

  it('emits base64url with no padding', () => {
    const jwt = buildAssertion(account, 1_700_000_000);
    expect(jwt).not.toContain('=');
    expect(jwt).not.toContain('+');
    expect(jwt).not.toContain('/');
  });
});

describe('sendAgentPush', () => {
  it('skips silently when no service account is installed', async () => {
    registerDevice({ token: 'tok-a', deviceId: 'phone-1' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await sendAgentPush(NOTIFICATION);

    expect(result.skipped).toBe('not-configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
