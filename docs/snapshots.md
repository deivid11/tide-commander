# Snapshots

Snapshots capture the full state of an agent's conversation, including all messages and any files that were created or modified during the session.

## What Gets Captured

- **Conversation outputs** - All messages from the Claude session (user messages, assistant responses, tool uses)
- **File artifacts** - Files created with the Write tool or modified with the Edit tool, with their content at snapshot time
- **Metadata** - Agent name, class, session ID, working directory, token usage, and context percentage

Files larger than 1 MB or binary files (images, PDFs, executables) are skipped.

## Creating a Snapshot

Click the snapshot button in the Guake terminal when viewing an agent's conversation. Provide a title and optional description.

## Viewing Snapshots

Snapshots are rendered in the Guake terminal using the same output formatting as live conversations, including proper tool output styling, icons, and interactive elements.

## Restoring Files

Files captured in a snapshot can be restored to their original locations. You can choose to restore all files or select specific ones. Existing files can be skipped or overwritten.

## Storage

Snapshots are saved to `~/.local/share/tide-commander/snapshots/{snapshot-id}/`:
- `snapshot.json` - Metadata and conversation outputs
- `files/` - File artifacts (gzip-compressed if over 10 KB)

Maximum snapshot size: 50 MB.
