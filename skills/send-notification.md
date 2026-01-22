# Send Notification

Sends a notification to the user via Tide Commander's notification system.

## Skill Configuration

- **Name:** Send Notification
- **Slug:** send-notification
- **Description:** Use this skill when you need to notify the user of important events, task completions, errors that need attention, or when you're waiting for user input. The notification will appear in the Tide Commander UI.
- **Allowed Tools:** Bash

---

## Instructions

You can send notifications to the user through Tide Commander's notification API. Use this when:
- You've completed a significant task
- An error occurred that needs attention
- You're blocked and waiting for user input
- Something important happened that the user should know about

### Sending a Notification

Use curl to send a POST request to the Tide Commander API:

```bash
curl -s -X POST http://localhost:5174/api/notify \
  -H "Content-Type: application/json" \
  -d '{"agentId": "YOUR_AGENT_ID", "title": "Notification Title", "message": "Your message here"}'
```

**Important:** Replace `YOUR_AGENT_ID` with your actual agent ID. If you don't know your agent ID, you can find it by checking the agent context or ask the user.

### Parameters

- **agentId** (required): Your agent's unique identifier
- **title** (required): A short title for the notification (keep it brief, under 50 characters)
- **message** (required): The notification message (keep it concise, under 200 characters)

### Example Usage

Task completed:
```bash
curl -s -X POST http://localhost:5174/api/notify \
  -H "Content-Type: application/json" \
  -d '{"agentId": "abc123", "title": "Task Complete", "message": "Successfully refactored the authentication module"}'
```

Error notification:
```bash
curl -s -X POST http://localhost:5174/api/notify \
  -H "Content-Type: application/json" \
  -d '{"agentId": "abc123", "title": "Build Failed", "message": "TypeScript compilation errors in src/auth.ts - please check"}'
```

Waiting for input:
```bash
curl -s -X POST http://localhost:5174/api/notify \
  -H "Content-Type: application/json" \
  -d '{"agentId": "abc123", "title": "Awaiting Decision", "message": "Found 3 approaches to solve this - click to review options"}'
```

### Best Practices

1. **Keep titles short** - They should fit in a notification popup
2. **Be specific in messages** - Help the user understand what happened
3. **Don't spam** - Only send notifications for important events
4. **Use appropriate titles:**
   - "Task Complete" - When finishing work
   - "Error" or "Failed" - When something went wrong
   - "Awaiting Input" - When you need user decision
   - "Warning" - For potential issues
   - "Info" - For general updates
