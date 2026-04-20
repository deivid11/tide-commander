#!/bin/sh
# Fix ownership of mounted volumes (Docker creates them as root)
chown -R commander:commander \
  /home/commander/.local/share/tide-commander \
  /home/commander/.claude \
  /home/projects 2>/dev/null || true

exec su-exec commander /home/commander/.bun/bin/bun x tide-commander@latest --foreground
