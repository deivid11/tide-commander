# Tide Commander Dockerfile
# Runs via bunx tide-commander@latest — no local build needed

FROM node:20-alpine

# System tools: native addon compilation, agent workflows, and installer scripts
# su-exec: lightweight tool to drop privileges in entrypoint
RUN apk add --no-cache python3 make g++ git bash curl unzip su-exec

# Install codex globally via npm (accessible to all users)
RUN npm install -g @openai/codex

# Create non-root user (Claude refuses --dangerously-skip-permissions as root)
RUN addgroup -S commander && \
    adduser -S -G commander -h /home/commander -s /bin/bash commander && \
    mkdir -p /home/projects && \
    chown commander:commander /home/projects

# Switch to commander for all user-space CLI installs
USER commander
WORKDIR /home/commander

# Install bun into /home/commander/.bun
RUN curl -fsSL https://bun.sh/install | bash

# Install claude into /home/commander/.local/bin
RUN curl -fsSL https://claude.ai/install.sh | bash

# Install opencode into /home/commander/.opencode
RUN curl -fsSL https://opencode.ai/install | bash

ENV PATH="/home/commander/.bun/bin:/home/commander/.local/bin:/home/commander/.opencode/bin:${PATH}"

VOLUME ["/home/commander/.local/share/tide-commander"]
VOLUME ["/home/commander/.claude"]
VOLUME ["/home/projects"]

EXPOSE 9059

ENV PORT=9059
ENV HOST=0.0.0.0

# Switch back to root for entrypoint (needs chown), then drops to commander
USER root
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
