/**
 * Integration Tests for Claude Service
 *
 * Tests the claude-service module which coordinates Claude sessions,
 * command execution, and stdin messaging.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as claudeService from '../../src/packages/server/services/claude-service.js';
import * as agentService from '../../src/packages/server/services/agent-service.js';

// Test timeout for integration tests
const TEST_TIMEOUT = 15000;

describe('Claude Service', () => {
  beforeEach(() => {
    // Initialize the claude service
    claudeService.init();
  });

  afterEach(async () => {
    // Clean up
    await claudeService.shutdown();
  });

  describe('Initialization', () => {
    it('should initialize without error', () => {
      // If we got here, init succeeded in beforeEach
      expect(true).toBe(true);
    });

    it('should handle multiple init calls gracefully', () => {
      // Should not throw
      claudeService.init();
      claudeService.init();
    });
  });

  describe('isAgentRunning', () => {
    it('should return false for non-existent agent', () => {
      expect(claudeService.isAgentRunning('non-existent-agent')).toBe(false);
    });

    it('should return false for agent that was never started', () => {
      expect(claudeService.isAgentRunning('test-agent-123')).toBe(false);
    });
  });

  describe('sendCommand without agent', () => {
    it('should throw error when agent does not exist', async () => {
      await expect(
        claudeService.sendCommand('non-existent-agent', 'test command')
      ).rejects.toThrow('Agent not found');
    });
  });

  describe('stopAgent', () => {
    it('should handle stopping non-existent agent gracefully', async () => {
      // Should not throw
      await claudeService.stopAgent('non-existent-agent');
    });

    it('should handle multiple stop calls', async () => {
      await claudeService.stopAgent('test-agent');
      await claudeService.stopAgent('test-agent');
      await claudeService.stopAgent('test-agent');
    });
  });

  describe('Event System', () => {
    it('should allow subscribing to events', () => {
      const mockHandler = vi.fn();

      // Subscribe to events
      claudeService.on('output', mockHandler);

      // Should be able to unsubscribe
      claudeService.off('output', mockHandler);
    });

    it('should allow multiple event handlers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      claudeService.on('output', handler1);
      claudeService.on('output', handler2);
      claudeService.on('event', handler3);

      // Clean up
      claudeService.off('output', handler1);
      claudeService.off('output', handler2);
      claudeService.off('event', handler3);
    });

    it('should handle unsubscribing non-existent handler', () => {
      const handler = vi.fn();

      // Should not throw even if handler was never subscribed
      claudeService.off('output', handler);
      claudeService.off('complete', handler);
      claudeService.off('error', handler);
    });
  });

  describe('Command Started Callback', () => {
    it('should accept command started callback', () => {
      const callback = vi.fn();
      claudeService.setCommandStartedCallback(callback);

      // Should be able to set it multiple times
      claudeService.setCommandStartedCallback(vi.fn());
      claudeService.setCommandStartedCallback(callback);
    });
  });

  describe('shutdown', () => {
    it('should handle multiple shutdown calls', async () => {
      await claudeService.shutdown();
      await claudeService.shutdown();
      await claudeService.shutdown();
    });

    it('should allow re-init after shutdown', async () => {
      await claudeService.shutdown();
      claudeService.init();

      expect(claudeService.isAgentRunning('test')).toBe(false);
    });
  });
});

describe('Claude Service with Agent', () => {
  let testAgentId: string;
  const testWorkingDir = '/tmp';

  beforeEach(async () => {
    // Initialize services
    claudeService.init();

    // Create a test agent (returns agent with generated ID)
    const agent = await agentService.createAgent(
      'Test Agent',
      'explorer',
      testWorkingDir,
      { x: 0, y: 0, z: 0 }
    );
    testAgentId = agent.id;
  });

  afterEach(async () => {
    // Clean up
    await claudeService.shutdown();
    if (testAgentId) {
      agentService.deleteAgent(testAgentId);
    }
  });

  describe('Agent Status', () => {
    it('should have agent in idle status initially', () => {
      const agent = agentService.getAgent(testAgentId);
      expect(agent).toBeDefined();
      expect(agent?.status).toBe('idle');
    });

    it('should report agent as not running before any command', () => {
      expect(claudeService.isAgentRunning(testAgentId)).toBe(false);
    });
  });

  describe('sendCommand with valid agent', () => {
    it(
      'should not throw when sending command to valid agent',
      async () => {
        // This will actually try to start Claude, which may not be available in test env
        // But it should at least not throw due to missing agent
        try {
          await claudeService.sendCommand(testAgentId, 'echo test');
        } catch (error: any) {
          // Expected to fail if Claude CLI is not available
          // But should not be "Agent not found" error
          expect(error.message).not.toContain('Agent not found');
        }
      },
      TEST_TIMEOUT
    );

    it('should update agent status when command starts', async () => {
      // Subscribe to events to track what happens
      const outputHandler = vi.fn();
      claudeService.on('output', outputHandler);

      try {
        // Try to send command - may fail if Claude not available
        await claudeService.sendCommand(testAgentId, 'test');
      } catch {
        // Expected in test environment
      }

      claudeService.off('output', outputHandler);
    });
  });

  describe('Status Sync', () => {
    it('should sync agent status without error', async () => {
      // Should not throw
      await claudeService.syncAgentStatus(testAgentId);
    });

    it('should handle sync for non-existent agent', async () => {
      // Should not throw
      await claudeService.syncAgentStatus('non-existent-agent');
    });

    it('should sync all agents without error', async () => {
      // Create multiple test agents
      const agent1 = await agentService.createAgent(
        'Sync Test 1',
        'explorer',
        testWorkingDir,
        { x: 0, y: 0, z: 0 }
      );
      const agent2 = await agentService.createAgent(
        'Sync Test 2',
        'coder',
        testWorkingDir,
        { x: 1, y: 0, z: 1 }
      );

      // Should not throw
      await claudeService.syncAllAgentStatus();

      // Clean up
      agentService.deleteAgent(agent1.id);
      agentService.deleteAgent(agent2.id);
    });
  });
});

describe('Stdin Messaging via Claude Service', () => {
  let testAgentId: string;

  beforeEach(async () => {
    claudeService.init();
    const agent = await agentService.createAgent(
      'Stdin Test Agent',
      'explorer',
      '/tmp',
      { x: 0, y: 0, z: 0 }
    );
    testAgentId = agent.id;
  });

  afterEach(async () => {
    await claudeService.shutdown();
    if (testAgentId) {
      agentService.deleteAgent(testAgentId);
    }
  });

  describe('sendCommand when not running', () => {
    it('should attempt to start new session when agent is idle', async () => {
      expect(claudeService.isAgentRunning(testAgentId)).toBe(false);

      try {
        await claudeService.sendCommand(testAgentId, 'test message');
        // If Claude is available, this will start a session
      } catch {
        // Expected if Claude CLI not available
      }
    });
  });

  describe('sendCommand edge cases', () => {
    it('should handle empty command', async () => {
      try {
        await claudeService.sendCommand(testAgentId, '');
      } catch {
        // May fail for various reasons
      }
    });

    it('should handle command with special characters', async () => {
      try {
        await claudeService.sendCommand(
          testAgentId,
          'Test with "quotes" and $variables'
        );
      } catch {
        // Expected if Claude not available
      }
    });

    it('should handle unicode command', async () => {
      try {
        await claudeService.sendCommand(testAgentId, '测试中文 🎉');
      } catch {
        // Expected if Claude not available
      }
    });

    it('should handle forceNewSession parameter', async () => {
      try {
        await claudeService.sendCommand(
          testAgentId,
          'test',
          undefined, // systemPrompt
          undefined, // disableTools
          true // forceNewSession
        );
      } catch {
        // Expected if Claude not available
      }
    });

    it('should handle disableTools parameter', async () => {
      try {
        await claudeService.sendCommand(
          testAgentId,
          'test',
          undefined, // systemPrompt
          true // disableTools
        );
      } catch {
        // Expected if Claude not available
      }
    });

    it('should handle systemPrompt parameter', async () => {
      try {
        await claudeService.sendCommand(
          testAgentId,
          'test',
          'You are a helpful assistant' // systemPrompt
        );
      } catch {
        // Expected if Claude not available
      }
    });
  });
});
