# Tide Commander Notification

Send notifications to the user via Tide Commander's in-app notification system.

## When to Use
- Task completed
- Error that needs attention
- Waiting for user input/decision
- Important status updates

## How to Send

Use double quotes with escaped inner quotes for reliable JSON:

```bash
curl -s -X POST http://127.0.0.1:10004/api/notify -H "Content-Type: application/json" -d '{"agentId":"h3xoev2b","title":"Test","message":"Test from Claudia"}'
```

Finding Your Agent ID
Your agent ID is in your session context. If unsure, ask the user or check:

Parameters
Field	Required	Max Length	Description
agentId	Yes	-	Your unique agent ID
title	Yes	50 chars	Short notification title
message	Yes	200 chars	Notification details


Tips
Keep titles under 50 chars
Be specific in messages
