# Send Message to Agent

Send messages to other agents in Tide Commander.

## Skill Configuration

- **Name:** Send Message to Agent
- **Slug:** send-message-to-agent
- **Description:** Use this skill to communicate with other agents, delegate tasks, or coordinate work.
- **Allowed Tools:** Bash(curl:*)

---

## Instructions

### Step 1: Get Agents List

```bash
curl -s http://localhost:5174/api/agents/simple
```

Returns agents with `id` and `name` only.

### Step 2: Send Message

```bash
curl -s -X POST http://localhost:5174/api/agents/{AGENT_ID}/message \
  -H "Content-Type: application/json" \
  -d '{"message": "Message from agent {YOUR_NAME} ({YOUR_ID}): Your message here"}'
```

### Message Format

Always prefix with your identity:
```
Message from agent {Your Name} ({Your ID}): {Your message}
```

### Example

```bash
curl -s -X POST http://localhost:5174/api/agents/def456/message \
  -H "Content-Type: application/json" \
  -d '{"message": "Message from agent Scout Alpha (abc123): Please build the auth module."}'
```

### Notes

- Include your identity so the receiver knows who sent it
- Works with all agent types including boss agents
