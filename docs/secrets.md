# Secrets Management

Secrets let you securely store API keys, tokens, passwords, and other credentials. Use placeholders in your prompts and the server replaces them with real values before sending to Claude.

## How It Works

1. Create a secret with a key (e.g., `GITHUB_TOKEN`) and value
2. Use `{{GITHUB_TOKEN}}` anywhere in agent commands, skill content, or exec commands
3. The server replaces the placeholder with the actual value before sending to Claude
4. The real value never appears in conversation history, session files, or logs

## Creating Secrets

Open the Secrets panel in Settings. Each secret has:

- **Name** - Human-readable label (e.g., "GitHub API Token")
- **Key** - Placeholder key, auto-normalized to uppercase with underscores (e.g., `GITHUB_TOKEN`)
- **Value** - The actual secret
- **Description** (optional) - Notes about the secret

Keys must be unique.

## Placeholder Syntax

```
{{SECRET_KEY}}
```

Examples:
```bash
curl -H "Authorization: Bearer {{GITHUB_TOKEN}}" https://api.github.com/user
```

```bash
deploy.sh --token {{DEPLOY_TOKEN}} --env {{ENV_NAME}}
```

## Where Placeholders Are Replaced

- Agent commands (when you send a message to an agent)
- Skill instructions (before injection into system prompt)
- Streaming exec commands (`/api/exec` endpoint)

## Encryption

Secrets are encrypted at rest using AES-256-GCM with a machine-specific key derived from hardware identifiers. Secrets encrypted on one machine cannot be decrypted on another.

## Storage

`~/.local/share/tide-commander/secrets.json`
