# HTTP Request Samples

Sample `.http` / `.rest` files for the **HTTP Requests building** (IntelliJ HTTP Client style).
Point an `http` building's folder at `tests/http-samples` and click it to browse and fire these.

All requests use public endpoints ([httpbin.org](https://httpbin.org), [jsonplaceholder.typicode.com](https://jsonplaceholder.typicode.com))
or the local Tide Commander API, so everything is safe to run.

| File | Covers |
|------|--------|
| `01-basics.http` | GET, query params, `###` named requests, comments, HTTP version token, HEAD/OPTIONS |
| `02-methods-and-bodies.http` | POST/PUT/PATCH/DELETE, JSON bodies, form-urlencoded, `####` names |
| `03-variables.http` | `{{env}}` variables, in-file `@vars`, built-ins (`{{$uuid}}`, `{{$timestamp}}`…), multi-line URLs, unresolved-variable warning |
| `04-status-and-errors.http` | 404/418/500 responses, redirects, slow responses, connection refused, binary (PNG) response |
| `05-auth-and-headers.http` | Bearer/Basic auth, custom headers echo, user-agent |
| `06-file-body.rest` | `.rest` extension, body from file (`< payload.json`), response-handler block stripping |

Environments live in `http-client.env.json` (shared) and `http-client.private.env.json`
(private overlay — wins over the shared file). Pick the environment in the modal's **Env** selector:

- `httpbin` — public endpoints (needs internet)
- `local` — Tide Commander's own API (works offline)
