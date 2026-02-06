# Docker Deployment

Tide Commander includes a multi-stage Dockerfile for containerized deployment.

## Building the Image

```bash
docker build -t tide-commander .
```

## Running

```bash
docker run -p 5174:5174 \
  -v ~/.local/share/tide-commander:/root/.local/share/tide-commander \
  tide-commander
```

### With Authentication

```bash
docker run -p 5174:5174 \
  -e AUTH_TOKEN=your-secret-token \
  -v ~/.local/share/tide-commander:/root/.local/share/tide-commander \
  tide-commander
```

### Listen on All Interfaces

```bash
docker run -p 5174:5174 \
  -e LISTEN_ALL_INTERFACES=1 \
  -v ~/.local/share/tide-commander:/root/.local/share/tide-commander \
  tide-commander
```

## Important Notes

- The container needs `claude` CLI accessible inside for agent processes to work. You may need to mount the Claude binary and its dependencies, or install it in the image.
- Custom 3D models are stored in `~/.tide-commander/custom-models/` - mount this volume if you use custom models.
- The production build serves the frontend from the same port (5174) as the API.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 5174 | Server port |
| `NODE_ENV` | production | Set by the Dockerfile |
| `LISTEN_ALL_INTERFACES` | _(unset)_ | Set to `1` to listen on 0.0.0.0 |
| `AUTH_TOKEN` | _(unset)_ | Token for authentication |

## Volumes

| Path | Purpose |
|------|---------|
| `/root/.local/share/tide-commander` | Agent state, buildings, skills, snapshots, secrets |
| `/root/.tide-commander/custom-models` | Custom 3D model files (if used) |
