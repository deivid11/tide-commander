import { afterEach, describe, expect, it } from 'vitest';
import { getAgentServerUrl, getCommanderBaseUrl } from './commander-url.js';

const originalPort = process.env.PORT;

afterEach(() => {
  if (originalPort === undefined) delete process.env.PORT;
  else process.env.PORT = originalPort;
});

describe('getAgentServerUrl', () => {
  it('falls back to the server default port 6200 when no port env is set', () => {
    expect(getAgentServerUrl({})).toBe('http://localhost:6200');
  });

  it('follows PORT, the port the server listens on', () => {
    expect(getAgentServerUrl({ PORT: '7001' })).toBe('http://localhost:7001');
  });

  it('lets TIDE_PORT override PORT', () => {
    expect(getAgentServerUrl({ TIDE_PORT: '7002', PORT: '7001' })).toBe('http://localhost:7002');
  });

  it('uses the same default as the server URL helper', () => {
    delete process.env.PORT;
    expect(getAgentServerUrl({})).toBe(getCommanderBaseUrl());
  });
});

describe('getCommanderBaseUrl', () => {
  it('defaults to port 6200 and reads PORT at call time', () => {
    delete process.env.PORT;
    expect(getCommanderBaseUrl()).toBe('http://localhost:6200');
    process.env.PORT = '7003';
    expect(getCommanderBaseUrl()).toBe('http://localhost:7003');
  });
});
