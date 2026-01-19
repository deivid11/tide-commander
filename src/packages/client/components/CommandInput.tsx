import React, { useState } from 'react';
import { store, useSelectedAgentIds, useSelectedAgents } from '../store';

export function CommandInput() {
  const [command, setCommand] = useState('');
  const selectedAgentIds = useSelectedAgentIds();
  const selectedAgents = useSelectedAgents();

  const hasSelection = selectedAgentIds.size > 0;

  const getPlaceholder = () => {
    if (selectedAgentIds.size === 0) {
      return 'Select an agent to send commands...';
    } else if (selectedAgentIds.size === 1) {
      const agent = selectedAgents[0];
      return `Enter command for ${agent?.name || 'agent'}...`;
    } else {
      return `Enter command for ${selectedAgentIds.size} agents...`;
    }
  };

  const handleSend = () => {
    if (!command.trim() || !hasSelection) return;

    for (const agentId of selectedAgentIds) {
      store.sendCommand(agentId, command.trim());
    }

    setCommand('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  return (
    <div className="command-section">
      <div className="command-bar">
        <input
          type="text"
          className="command-input"
          placeholder={getPlaceholder()}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!hasSelection}
        />
        <button className="command-send" onClick={handleSend} disabled={!hasSelection}>
          Send
        </button>
      </div>
    </div>
  );
}
