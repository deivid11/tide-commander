# Changelog

All notable changes to this project will be documented in this file.

## [1.206.0] - 2026-08-21

### Added
- **Shell Commands plugin** — builtin `shell-commands` plugin for executing shell commands from the palette (`ShellCommandExecCard`, `ShellCommandExecutionHost`, `ShellCommandsSettings`, `execution.ts`). Includes client `plugins/shell-commands`, store `execTasks` (+tests) and server `plugin-shell-command-service` (+tests) with `shell-commands` builtin.
- **Shell execution API** — extended `routes/exec` and `routes/plugins` with authenticated plugin shell execution; session search improved via `session-loader` + `session-loader-search.test` and `api/sessions`.

### Changed
- **Spotlight and terminal polish** — `Spotlight` (`pluginCommands`, `types`, `useSpotlightSearch`), `TerminalInputArea`, `PluginsPanel`, `PluginCommandShortcutHost` and plugin types/harness updated for shell command execution.
- **Plugins manager and Gmail** — `plugins/manager` (+tests), `plugins/index`, `gmail-pending` and `_plugins.scss` refined.
- **Docs** — `docs/plugins.md` updated with shell command examples.

## [1.205.0] - 2026-08-21

### Added
- **Background-notification opt-out (Android)** — Settings → About now has a "Background notifications" toggle. Turning it off stops the persistent foreground service and removes the permanent "Connected to server" system notification; the trade-off is that agent alerts only surface while the app is open. Default on so existing installs behave exactly as before.

### Fixed
- **Global content search works without ripgrep** — `searchFileContentsGlobal` now falls back to an async filesystem walk (with the same excludes + size caps) when `rg` is missing on the host, matching the fallback the filename search has always had. Previously Spotlight content queries silently returned no results on machines without ripgrep.

## [1.204.1] - 2026-08-21

### Fixed
- **Phantom area assignment** — an archived zone no longer "captures" agents that sit over its old coordinates. `getAreaForAgent` now skips archived areas and resolves overlaps by topmost zIndex, matching the drag-to-assign containment checks. Fixes agents showing a hidden, archived area in their details.

## [1.204.0] - 2026-08-21

### Added
- **Gmail, Jira and Tide Usages plugins** — builtin plugins for pending Gmail messages (`GmailPendingCard`), Jira tickets (`JiraTicketsCard`) and Tide subscription usages (`TideUsagesCard` with tests), each with server builtin handlers and client cards/styles (`_gmail.scss`, `_jira.scss`).
- **Integration-backed plugin settings** — plugins can declare `contributes.settings` of type `integration` (`docs/plugins.md` extended). The Plugins panel shows instructions and secret names and **Configure** opens the native integration flow (OAuth, secrets, connection status) above the panel.
- **Toolbox settings search** — `settingsSearch.ts` with tests for filtering toolbox configuration; `ConfigSection`/`Toolbox` updated.

### Changed
- **Spotlight and output polish** — `Spotlight` (`types`, `useSpotlightSearch`, `utils`, `SpotlightResults`, `SpotlightCommandResultModal`), `OutputLine` and `PluginsPanel` refined for new plugin cards.
- **Styles and locales** — `_plugins.scss`, `_spotlight.scss`, `main.scss` expanded; terminal locales `en`/`es` updated.
- **Server integrations** — `gmail-client`, `jira` (`index`, `jira-client`), `codex-usage-service` (+tests) and `pi-subscription-usage-service` extended to support plugins.
- **Plugin manager and types** — `plugins/manager`, `plugins/index`/`types` and `shared/plugin-types` updated for new builtin plugins.

## [1.203.0] - 2026-08-20

### Added
- **Trusted local plugins** — extensible plugin system for slash commands, Guake output cards, sidebar views and modals. Plugins declare `manifest.json` (`slashCommands`, `views`, `modals`, `outputRenderers`) and ship `server.js`/`client.js` + `styles.css` bundles; see `docs/plugins.md`. Includes plugin registry, mount surfaces (`PluginOutputHost`, `PluginModalHost`, `PluginMountSurface`), and server `plugins/manager` with builtin example (`bolba-tasks`).
- **Plugin spotlight integration** — `Spotlight` now resolves plugin slash commands with dedicated result modal and cards (`SpotlightPluginCommandResults`, `SpotlightCommandResultModal`, `SpotlightCommandResultCard`), plus client plugin hosts and hooks.
- **Markdown PDF export** — `utils/markdown-pdf.ts` for exporting markdown documents.
- **Plugins API** — server routes `src/packages/server/routes/plugins.ts` with tests and shared `plugin-types`.

### Changed
- **Bolba Tasks refactored into plugin** — moved `bolbaTasksOutput.ts` → `plugins/bolba-tasks/` (`BolbaCurlCard`, `BolbaTasksView`, `bolbaCurl`, `bolbaTasksOutput`), slimmed `CurlCard`, updated `HistoryLine`/`OutputLine` filtering and `useFilteredOutputs`.
- **Spotlight and toolbox polish** — `Spotlight`, `SpotlightInput`/`Footer`, `SlashCommandDropdown`, `slashCommands`, toolbox `ConfigSection`/`types` updated for plugin commands; `App.tsx`/`AppModals.tsx` wired to plugins.
- **Curl parser simplified** — `curlParser.ts` reduced, removed terminal curl-card styles.
- **Stores and messaging** — `store/outputs`, `store/types`, `websocket/handlers`, `shared/types` and `websocket-messages` extended for plugin payloads; `plugins` manager and command/agent handlers updated.

## [1.202.1] - 2026-08-20

### Fixed
- Maintenance release — no user-facing code changes since v1.202.0; pipeline verification and housekeeping.

## [1.202.0] - 2026-08-20

### Added
- **Copy agent identity** - every agent header now has a one-click copy of its display name plus id.
- **Session-aware spawn** - restoring a past session (from history or search) pre-fills the new-agent modal with the original provider, model and reasoning level.
- **OpenCode Go usage gauges** - OpenCode agents on the Go plan show the same weekly/monthly quota windows as Pi, with the free pool correctly reported as dynamic.
- **Model preview in the spawn/edit dialogs** - the model picker shows live context-window and weekly-quota hints for the selected provider.

### Changed
- **Flat view plan tooltip unified across providers** - the context-chip tooltip now uses a shared cache for Claude, Codex, Grok, Pi and OpenCode and no longer hammers the rate-limit endpoint.
- **Pi model selection and session search polished** - better grouping and keyboard handling in the spawn flow.

### Fixed
- **Grok usage and session watching reliability** - tighter session detection and usage error handling when no active credential exists.
- **History loader no longer loses prompts when restoring sessions** - session metadata is read from the tail only, keeping restores fast even on large transcripts.

## [1.201.0] - 2026-08-20

### Added
- **Current-prompt bubble above the composer** - a floating, truncated preview of the prompt the agent is working on sits at the bottom of the input area; clicking it jumps the conversation to that prompt.

### Fixed
- **A prompt sent behind a busy turn no longer vanishes** - when a provider waits for the previous turn to finish, it can persist a prompt many seconds after the live row was already acknowledged. The reconciliation window was short enough to miss that, so the prompt could be dropped from history; an exact prompt already confirmed by the runtime is now matched directionally and one-to-one with no timeout, while unconfirmed and wrapped prompts keep the tight window. One persisted row can no longer erase two identical live sends.

## [1.200.0] - 2026-08-20

### Added
- **Document viewer** - `.docx`, `.docm`, `.odt`, `.fodt`, `.doc` and `.rtf` files open as formatted documents instead of binary junk: headings, styled runs, bullet and numbered lists, tables, hyperlinks, footnote references and embedded images, with an outline for navigation. Parsing is dependency-free — OOXML and ODF read from the zip with a tolerant tag scanner, legacy `.doc` through an OLE2 container and its piece table, `.rtf` through a control-word scanner — and the format is sniffed from content, so a `.doc` that is really an RTF still opens.
- **Ctrl+C stops the current run** - with a terminal view open, Ctrl+C interrupts that agent's run the way a real terminal would. It stays out of the way when text is selected anywhere on the page, so copying still works.

### Changed
- **Exec cards attach after a reload even for short commands** - the connection snapshot now includes recently-completed tasks, not just running ones, so a 10-second command that finished while you were reloading or switching agents still finds its card. The list is bounded by count, age and a small output tail so reconnecting phones don't pay for it.

### Fixed
- **WhatsApp prompts no longer disappear from history** - a bridge prompt carries its own event timestamp and can be persisted a few milliseconds before its live row is broadcast, which the strictly directional dedup treated as an older duplicate. That exact-payload envelope is now the one tolerated exception; ordinary composer prompts stay directional, so a repeated identical send still can't be erased by an older turn.

## [1.199.6] - 2026-08-19

### Fixed
- **Opening an agent with cached history no longer jumps upward** - the virtualizer writes its estimated starting offset on the later render where it first sees the scroll container, which for a warm conversation happens after the short switch pin has already released, leaving the view a few hundred pixels above the bottom with no visible cause. That one-time attachment write is now repaired from the real DOM bottom before paint, and only then — prompt and search navigation still move away from the bottom on purpose.

## [1.199.5] - 2026-08-19

### Fixed
- **Sending the same prompt twice no longer loses one copy** - live prompts and persisted history are now reconciled one-to-one, with each history row consumed at most once and only inside a tight server-clock window, so a second identical send survives until its own persisted row arrives instead of being folded into the first. The duplicate check also runs only during that reconciliation, not again downstream where two valid identical prompts look the same.
- **Revisiting a conversation stays at the bottom** - bottom-follow is re-armed when a history refresh completes rather than when it starts, in a layout effect, so rows arriving seconds later can't paint at the old offset and leave you above the bottom. Deliberate upward scrolling is still respected.
- **Layout movement is no longer mistaken for scrolling** - only real wheel, touch or scrollbar input can release bottom-follow during an agent switch; virtualizer corrections, browser clamps and late row measurements no longer count, and the bottom latch is set synchronously so a resize in the same frame can't observe a stale scrolled-up state.

### Changed
- **Background session updates don't rerender the open pane** - the history revision counter is now per agent, so activity in other agents no longer forces the conversation you are reading to re-render.

## [1.199.4] - 2026-08-19

### Fixed
- **A new agent no longer steals the conversation you are typing in** - only the tab that actually requested a spawn, clone, fork or session restore switches to the new agent, and it stays put if you are mid-draft in the composer. Creations broadcast from another tab or device, and `focus_agent` from desktop integrations, no longer pull you away from the agent you are writing to.
- **The working timer no longer sits frozen at 0:00** - when the authoritative turn timestamp is missing (after a reload or reconnect, or when another device started the turn) the timer falls back to the server-persisted task time, then to a local clock, and swaps in the real timestamp when it arrives. Timestamps materially in the future are ignored, so clock skew on phones can't stall it.
- **Opening an agent on mobile really lands at the bottom** - explicit open/send requests now bump a generation counter instead of a boolean, so a second request while pinning is still settling (re-clicking the same agent, reopening the panel, sending during layout) still scrolls, and the view re-anchors after the keyboard, browser chrome and pinned-agent strip finish changing the output padding. Readers who scrolled up deliberately are left alone.

## [1.199.3] - 2026-08-19

### Fixed
- **Clicking a dock chip always opens the agent you aimed at** - the miniature agent roster froze its rendered order for the duration of a press, so a live status or recency update can no longer slide a different agent under your pointer between press and click. The chip under the finger at press time also wins for the delayed synthetic clicks phones dispatch after the roster DOM has already changed.
- **No more flicker when the terminal snaps to the bottom** - the scroll target is the DOM's actual bottom offset instead of the last virtual row, whose index the virtualizer could revise seconds later when the row remeasured, briefly pulling the viewport up before the bottom writer snapped it back.
- **Opening a cold conversation no longer flashes blank** - the page is revealed in the same commit that removes its loading overlay, instead of fading in over 90 ms and exposing one empty frame after the overlay disappeared.

## [1.199.2] - 2026-08-19

### Changed
- **Responses are gzip/brotli compressed** - API JSON and the static bundle are now negotiated-compression encoded, which matters most on phones that refetch 130–200 KB history pages and a ~400 KB agent list on every reconnect. The terminal proxy is mounted first so ttyd streams pass through untouched, and responses marked `no-transform` or already-compressed content types are skipped.
- **Process lookups reuse a one-second snapshot** - orphan polling, perf metrics and PID resolution share a cached `ps` snapshot instead of each spawning their own `ps aux | grep` plus `readlink`, which with hundreds of agents meant hundreds of blocking spawns back to back. Kill paths still force a fresh read.

### Fixed
- **Rapid agent switching no longer freezes the UI** - a keyed pane aborts its history request as soon as it unmounts, and speculative warm-up from hovering the dock is capped below the browser's per-origin connection limit, so quick switches can't pile up 2–3 second requests until no socket is left for the agent you actually selected (the "fixed by reloading" freeze). A failed background refresh also no longer wipes the conversation already on screen, and cancellations are no longer logged as failures.

## [1.199.1] - 2026-08-19

### Fixed
- **Switching agents no longer flashes or shakes the terminal** - a keyed pane now mounts already scrolled to its estimated bottom, and the scroll element is placed at the real bottom in the commit phase before paint, so the old sequence of rendering the oldest rows and jumping to the newest one or two frames later is gone. While pinned to the bottom, auto-follow is the only thing that writes scroll position, ending the anchor-correction versus bottom-snap race that made the view tremble, and offscreen row warm-up after a cold switch was dropped for the same reason. The separate agent-switch fade is no longer needed and was removed.

## [1.199.0] - 2026-08-19

### Added
- **OpenCode Go limits in Pi usage** - Pi agents using an OpenCode Go subscription now show the live 5-hour, weekly and monthly usage gauges and reset times for the active API key and every saved Pi profile. OpenCode Go also appears in the loaded-subscriptions list, and duplicate profiles sharing one key reuse a short-lived cached quota request.
- **Working glyph is a pre-rendered animation** - the activity spinner shown while an agent works is now one shared animated WebP instead of a CSS transform loop, so it no longer keeps a compositor layer repainting at the monitor's refresh rate. Low Power Mode swaps it for a static SVG.

### Changed
- **Huge spreadsheets open without being fully expanded** - worksheets are inflated only as far as the requested rows need, pulling compressed bytes from disk in slices and stopping early, so a 200k-row sheet no longer expands to hundreds of megabytes just to show its first screen.
- **OpenCode daemon survives restarts and model refreshes** - live sessions are snapshotted before the maps are cleared on shutdown (a graceful restart used to save an empty list and orphan the detached daemon), recovery starts before the runtime service finishes initializing so commands can't overwrite the recovery file during the startup gap, session state is persisted before the turn-length request rather than after, and `opencode models --refresh` invalidates the daemon after the current turn and any queued follow-up instead of interrupting it.

### Fixed
- **Pi Codex usage works for its current login** - live limits are now read directly from Pi's own OpenAI Codex OAuth session through an isolated Codex home, so the current account shows its weekly/daily gauges even when its token is not duplicated as a saved `~/.codex` profile. The operator's active Codex CLI account remains untouched, and any rotated Pi grant is written back safely without replacing other Pi provider logins.

## [1.198.1] - 2026-08-19

### Fixed
- **Code identifiers no longer render as `tide-file://` links** - the file-path autolinker only tested whether a token contained a dot, so ordinary prose about code was turned into broken file links: `nature: [alert.kind](tide-file://alert.kind) === 'deposit'`, `[res.data](tide-file://res.data)`, `[Transaction.transferPeerId](tide-file://Transaction.transferPeerId)`. A token without a path separator now has to end in a known file extension to become a link, while anything containing a `/` is still treated as a path whatever its extension (`config/app.local`). Shell scripts keep linking when named bare (`deploy.sh`), since they come up far more often than `.sh` domains; `.so` shared objects stay excluded unless they carry a real path. The same rule feeds Spotlight's search indexing, which no longer indexes property names as file paths.

## [1.198.0] - 2026-08-18

### Added
- **Spreadsheet viewer** - `.xlsx`, `.xlsm`, `.xls`, `.ods`, `.csv` and `.tsv` files now open as a VisiData-style grid instead of binary junk: sheet tabs, sticky column letters and row numbers, virtualized rows so a 10k-row sheet scrolls smoothly, a filter box and per-column sort. Cells, ranges, whole columns and rows can be selected (drag, Shift to extend, Ctrl/Cmd+click for non-contiguous ranges) with a live status bar showing count, numeric count, sum, average, min and max, and Ctrl/Cmd+C copies the selection as TSV. Parsing is dependency-free — OOXML through zlib and a tolerant tag scanner, `.xls` through a CFB + BIFF reader, `.ods` through content.xml — with dates, percentages and number formats rendered the way the spreadsheet app would show them.
- **Content sniffing for mislabelled spreadsheets** - the file type is detected from the bytes, not the extension, so a `.xls` that is really CSV or an HTML table (as bank portals routinely export) still opens correctly.
- **Message capture toggle in the agent debug panel** - WebSocket frame capture is now off by default and remembered per browser, since it re-parses and buffers every frame; turn it on only while debugging.

## [1.197.1] - 2026-08-18

### Changed
- **Much less CPU while an agent is streaming** - the terminal now memoizes the expensive parts of rendering instead of redoing them on every chunk: highlighted output HTML, per-line analysis and cost-stripped text are cached by content in bounded LRUs, prompt-marker extraction reuses its previous array when nothing changed, and the agent overview panel keeps its area sections and cards memo-stable so one agent's tool start no longer re-renders the whole panel.
- **Idle 3D loop no longer ticks at 60 Hz** - in flat, 2D and dashboard views the render loop polls for the detached canvas every 250 ms instead of requesting an animation frame with nothing to draw, and the scene sync skips work while the canvas is away.
- **Glow and pulse animations are compositor-only** - the overview panel and tracking board animate opacity and transform on dedicated overlays instead of animating `box-shadow`, which repainted the whole panel layer on every frame of an infinite loop.

## [1.197.0] - 2026-08-18

### Added
- **Command output keeps its colors, and gets them when it never had any** - Bash results, exec streams and log tails are now replayed through the shared terminal renderer before rendering, so the original ANSI colors survive while cursor/erase sequences and `\r` progress redraws no longer leak as `[?25l` garbage or stacked duplicate lines. Lines that arrive with no color of their own get semantic highlighting instead: unified diffs, `git status`, log levels, section markers, clickable file paths, URLs, hashes, durations, timestamps, quoted strings and JSON keys. Output that a tool already colored is never repainted.
- **Source code in output is syntax-highlighted** - when a `cat`, `sed -n` or `rg -n` dump is recognisably code, it goes through Prism with the same token palette as the file viewer, including the code half of `path:line:` result rows. Detection is conservative: prose, markdown, logs and mixed output stay on the semantic highlighter, and only eagerly-bundled grammars are used so nothing loads mid-render.

## [1.196.0] - 2026-08-18

### Added
- **Bolba tasks board card** - curls against a local `bolba-tasks` board (`127.0.0.1:7492`) now render as a dedicated card instead of raw JSON: the board and search listings become a table, a single task becomes a detail view, and create / update / timeline / close / reopen / delete, health, stats and duplicate-conflict responses each get their own compact summary. Output piped through `python3 -c` one-liners or anything unparseable falls back to plain text.

### Changed
- **Streaming Execution skill rewritten** - the built-in skill now explains why the exec API matters (the user is watching a live terminal) instead of only stating the rule, and gives a shorter, clearer boundary between what belongs in `POST /api/exec` and what can stay in direct Bash.

### Removed
- **Streaming-exec guard** - the Claude `PreToolUse` hook that denied direct long-running Bash calls has been removed, along with its Settings toggle and the `/api/exec/guard` endpoint. Routing long commands through the exec API is guidance in the skill again, not a mechanical block.

## [1.195.0] - 2026-08-17

### Added
- **Live exec cards survive a reload or reconnect** - the server now sends a snapshot of every running exec task when a client connects, including a buffered tail of the output so far. Opening the app (or coming back from a dropped connection) in the middle of a build or test run rebuilds the live card and keeps streaming into it, instead of showing nothing until the command ends. Cards left "running" in a client whose task finished while it was disconnected are resolved from the same snapshot.

### Fixed
- **The streaming-exec guard no longer trips on quoted text** - the classifier masks the contents of quoted spans and heredoc bodies before looking for long-running commands, so a `sed` replacement, a `grep -E` pattern or a heredoc that merely mentions `npm run build` or `sleep` is treated as data instead of being blocked. Commands hidden behind a newline in a multi-line script are now classified too, and `$(…)` / backticks still count as real execution.
- **A re-run of the same command no longer shares one card** - each curl row pairs with the exec task closest to its own timestamp rather than the newest one, and tasks already claimed by another tool call are excluded from the fallback heuristics. Running the same command twice used to attach both rows to the second task, showing duplicated output.

## [1.194.1] - 2026-08-17

### Fixed
- **Domain names no longer render as broken `tide-file://` links** - the file-path autolinker could stop a match on an interior dot, so a domain followed by `/`, `?`, `#`, `:`, a quote or `**` was truncated mid-name. The fragment no longer ended in a TLD, slipped past the URL guard, and rendered as `[inbound-smtp.us-west-2.amazonaws](tide-file://...).com/path` in agent messages. A dot now only ends a path token when the dot itself is followed by end-of-line or real punctuation. Paths followed by sentence punctuation (`src/foo.ts?`, `src/foo.ts:12`) also linkify correctly now, which they previously did not.

## [1.194.0] - 2026-08-17

### Added
- **Streaming-exec guard** - a new Settings → General toggle installs a Claude `PreToolUse` hook that denies direct Bash calls which look long-running (builds, tests, installs, polling loops, downloads) and hands the agent the exact `POST /api/exec` curl for the same command, so the output lands in a live exec card instead of a silent spinner. It fails open: quick inspection commands (`ls`, `cat`, `rg`, `git status`, Commander API curls) always pass, detached/background runs are never blocked, and the setting applies immediately to running agents. Claude only — other harnesses still rely on the skill text.
- **Archive browsing in the file viewers** - zip, jar, war, apk, tar.\*, 7z, rar, cab, iso, deb, rpm and single-file compressed blobs now open as a browsable tree with per-folder sizes, a filter box and a summary bar (format, entry counts, uncompressed vs stored size, ratio). Entries are enumerated without extracting: zip archives are read from the central directory and tar streams from their headers, so a multi-GB file lists in milliseconds, with `7z` / `unrar` / `bsdtar` as fallbacks.

### Fixed
- **Stopping a streamed exec task now really kills it** - the Stop button walks `/proc` to collect every descendant of the task and signals each process group and pid, instead of only the `script` wrapper's group. PTY tasks run in a different session than their wrapper, so builds, servers and test workers used to survive the stop and leave the card stuck on "running".
- **Exec cards pair with their curl row again** - the row matcher resolves the shell `'\''` idiom and the attached `-d` / `--data=` / `--json` body forms, so commands whose JSON payload contains literal single quotes (ssh with a `docker --format` template, for example) match their task instead of rendering as a raw curl line.

## [1.193.0] - 2026-08-17

### Added
- **Move a conversation between runtimes** - the agent editor can now switch an agent from any provider to Claude, Codex, Grok or Pi and carry the conversation with it. Three modes: Smart Context (a condensed hand-off), Visible Transcript (the full readable conversation) and Fresh Start (runtime change only). Commander writes a real native session for the target CLI so the agent resumes normally, reports what was imported or dropped (turns, tool-result bodies, estimated tokens against the target's context limit) and rolls the new session back if the switch fails. Switching into Pi also suggests the closest equivalent model.
- **Conversation extracts in Spotlight** - agent rows in Spotlight now show up to four ranked, role-tagged snippets of the matching conversation (user prompts containing the query first, then agent text and reasoning, then tool output), so a search hit is identifiable without opening the agent. Extracts coming from the session files and from the in-memory store are deduplicated.

### Changed
- **Session history remembers its runtime** - archived sessions now store the provider and working directory they belong to, so existence checks and re-use work for non-Claude runtimes instead of assuming a Claude `.jsonl` path.

## [1.192.0] - 2026-08-17

### Added
- **Switch a Pi agent's model provider without ending the conversation** - the agent editor and Bulk Manage can now change a live Pi RPC agent from Anthropic to OpenAI Codex (or any other Pi-loaded provider) in the same session. The runner issues a native `set_model` on the persistent process, so the conversation and context stay intact instead of being cleared like a Claude or Codex model change.
- **Pi subscription accounts and usage** - Pi logins stored as `auth.json` plus named `auth.<name>.json` profiles can be listed, saved, renamed, switched and deleted from the UI. Switching replaces only the selected model provider's credential and leaves every other loaded login in place. Context view and the usage panel show the loaded subscriptions plus session / daily / weekly / monthly / on-demand quota windows for the active provider.
- **Provider-aware Pi badges** - agent lists, Spotlight, the activity dock, the dashboard and the unit panel show the actual loaded provider (Anthropic, OpenAI, xAI, Gemini, Copilot, …) instead of a generic Pi mark, using the reported `piModelProvider` when the stored model is just Pi's configured default.
- **Accurate Pi context windows** - Tide now reads `pi --list-models` and uses that catalog for context limits (for example Claude Opus 5 is 1M in Pi even when the direct Claude metadata still says 200K). Existing Pi agents are repaired on startup so the usage bar immediately uses the new denominator.

### Changed
- **Thinking-level updates on a live Pi RPC turn** - changing effort on a Pi agent now talks to the running process instead of waiting for the next spawn, and a failed thinking-level update no longer rolls back a successful model switch.

## [1.191.0] - 2026-08-16

### Added
- **Pi RPC turns survive a Commander restart** - each Pi RPC process now runs inside its own isolated tmux session and is reconnected on startup, so a restart no longer kills a live turn. The runner persists the session, working directory, model and turn state, replays the log tail it missed, and infers whether the agent was still processing or waiting for input — agents that were working resume streaming into the same conversation instead of silently stalling.
- **/compact works natively on Pi** - a bare `/compact` sent to a Pi RPC agent is routed through the harness's own compaction operation instead of being typed at the model as text, and the resulting compaction is rendered as a marker in the restored conversation history. Context is no longer re-queried afterwards on Pi, where doing so woke the model and polluted the freshly compacted context.
- **Thinking blocks report reasoning usage** - a thinking block can now show how many reasoning tokens the model spent and how many plaintext summaries the provider exposed, plus an explicit note when the visible text is only a provider summary and the detailed chain of thought is an encrypted payload Tide cannot decrypt. Pi runs load an extension that asks providers for detailed safe summaries so there is more to show.
- **Pi edit calls render as diff cards** - Pi's `{ path, edits: [...] }` tool payload is translated into the shape the diff cards consume, so Pi file edits appear as proper diffs, and the file viewer treats a multi-edit Pi call as edit intent and falls back to the Git diff and original content.

### Changed
- **Message bursts become one follow-up** - prompts sent to the same agent while it is busy or temporarily disconnected now append to one queued message, separated by blank lines, instead of building an unbounded backlog of turns. The combined follow-up drains once when the agent is available, across classic, Codex app-server, and OpenCode serve runners, and the same merging now applies to prompts queued in the browser while the connection is down.
- **Mermaid Diagrams is opt-in** - the built-in skill is no longer forced onto every agent. It can be enabled manually for an agent or class from the Skills UI, and existing persisted wildcard assignments are removed automatically while intentional direct assignments remain intact.
- **Leaner built-in skills** - every built-in skill was rewritten to say the same thing in far fewer tokens, and the API calling convention is now included only when at least one of the agent's skills actually calls the Tide Commander API. A regression test keeps the default skill set inside its size budget, so the prompt overhead an agent carries before it reads a single file stays small.
- **Exec cards attach to heredoc commands** - an exec call whose JSON body is passed with `-d @- <<'EOF'` is now recognised, so its terminal row matches the running task by its exact command and shows the live output instead of guessing from timing.

### Fixed
- **Test runs no longer write into the server log** - Vitest workers share the repository directory with the live dev server and were interleaving fake server starts and watchdog errors into `logs/server.log`; logging is now disabled under test.

## [1.190.0] - 2026-08-16

### Added
- **A terminal for every area with no setup** - each area now exposes an on-demand tmux terminal rooted in its first project directory, directly from the Commander and flat-view status bars. The shell survives viewer and server restarts, uses its own isolated port range, and no longer requires creating a terminal building first.
- **Search inside project files from Spotlight** - the new Contents tab searches text across every configured area project, streams its own loading state, and opens a matching file directly at the relevant line. The inline detail view shows either the working-tree diff or read-only file content with highlighted matches and next/previous navigation, with a shortcut into the full File Explorer.
- **Find an agent by what it discussed** - conversation results now resolve ownership through both current and archived session history, so a topic search can surface the agent that handled it and jump straight to the matching exchange. Accent-insensitive matching and relevance-plus-recency ranking keep topical Spanish-language conversations findable even when the query omits accents.

### Changed
- **Cleaner Spotlight result groups** - agents and conversations collapse behind “Show all” rows, categories stay in a predictable order, provider badges identify each conversation's harness, and weak fuzzy matches no longer crowd out stronger topical results.
- **A larger recent-agent dock** - the dock now retains twelve recently active agents instead of four.
- **Tool hover previews are opt-in** - file, diff, and command hover previews now default off while remaining available in Settings.

## [1.189.0] - 2026-08-16

### Added
- **Alfred workflow for macOS** - a workflow that searches your agents, buildings and areas from Alfred and jumps straight to one, plus a second command that searches past conversations. The server does both the searching and the formatting, returning ready-to-render Alfred JSON, so the workflow itself is a thin curl. Results mirror the in-app Spotlight: agents first, ranked by match quality then recency, followed by buildings and areas. Selecting a result focuses the agent in an already-open window, opens a deep link, or copies the text.
- **Multi-word search in Spotlight** - a query whose words match different fields of the same item now finds it. Searching "daisy designer" previously found nothing, because the matcher treated the whole phrase as one pattern and no single region of an agent named "Designer 3D print" in the "DaisySeed" area was close enough to it. Every word must still match, but each may match on its own, in any field and any order.
- **Cards for Tide Commander's own API calls** - a curl against the local API renders as a labelled card with the response laid out as a table (agents, buildings, areas, skills and so on) instead of a wall of JSON. Works on `jq` projections too, and falls back to pretty JSON or plain text when a payload isn't recognised, so nothing is ever hidden.

### Changed
- **Session restore checks the provider** - the loader now reports which provider owns a session, so a Grok or Codex conversation can no longer be restored onto a Claude agent.
- **Release pipeline scans for leaks** - the built-in release skill gained a mandatory secret and artifact scan that runs before any other work and again immediately before the release commit is staged. It checks the files a release will actually commit for credential-shaped strings, sensitive file types, stray build artifacts, and internal network addresses — and stops the release for the user to decide rather than fixing anything itself.

## [1.188.0] - 2026-08-16

### Added
- **Live view of an agent's background work** - a small stack of pulsing dots sits in the corner of the chat, one per background task the CLI currently has running: a Bash command launched in the background, a slow command promoted to the background when it hit its timeout, or an async Task launch. Hovering or tapping expands a panel with each task's description, a ticking elapsed time and its live output — streamed directly for commander exec calls, tailed from the task's own output file for plain Bash. Tasks appear from the moment they launch and only disappear when they genuinely finish.
- **Exec commands run under a pseudo-terminal** - CLIs like vitest, npm and pip detect a pipe and switch to CI-style block-buffered output, so an exec card could sit empty for minutes while the command was clearly working. They now run under a PTY and report live progress. Their output carries in-place redraws (progress bars, spinners, cursor moves), so a small terminal renderer replays that stream into what the screen would actually show: the card updates in place with its colours intact instead of appending every redraw, and agents receive clean final text.

### Changed
- **`| tail -25` no longer blanks the live view** - agents routinely append a tail filter to keep a command's output small in their own context, but a pipe buffers everything, so the user watched an empty card until the command ended. A trailing tail filter is now detected, stripped before execution so the live stream carries real progress, and applied to the agent's response instead — it still receives exactly the truncated output it asked for, now with the untruncated size alongside it. The streaming-exec skill documents a `tail` parameter as the direct way to do this; the stripping is a safety net for commands that ask the old way. Filters whose meaning differs (`tail -f`, `tail -n +25`, anything followed by more of the command) run untouched.

## [1.187.0] - 2026-08-16

### Added
- **Find agents by their area in Spotlight** - typing an area's name now surfaces every agent parked in it, even when neither the agent's name nor its working directory mentions that area. Each agent row also carries a badge in the area's own colour, so you can tell at a glance which part of the battlefield a result lives in. Membership is by position, the same rule the Agent Overview panel uses, and it is resolved in one pass over the areas rather than per agent, so a large roster doesn't pay for the lookup on every keystroke.

## [1.186.0] - 2026-08-16

### Changed
- **Search opens what it finds** - landing on a match buried inside a collapsed thinking block used to show a note quoting the hidden text, because the highlighter cannot paint what is collapsed away. The finder now asks that block to open instead, so you see the hit in place. The note remains only for the genuinely unreachable case, where nothing in the row can expand — bash output the renderer never mounted, for instance.
- **Spotlight puts agents first and files last** - agents are pinned to the top of the results and filename hits to the bottom, regardless of how strongly they score. Spotlight is first and foremost the way to reach an agent, and a filename that merely contains the query is the weakest reason to push that list down. Everything in between still orders by its strongest match, so the most relevant of those categories still leads the middle.

## [1.185.0] - 2026-08-15

### Changed
- **Searching no longer destroys message formatting** - the terminal's find used to swap the Markdown renderer for a raw-text version with highlight tags whenever a search was active, so every message lost its formatting the moment you started typing. Matches are now painted on top of the normally-rendered output using the same browser mechanism Ctrl+F uses, so messages keep their tables, code blocks and emphasis while you search. A hit can also span inline formatting now — searching "hello world" matches `hello **world**` — the row you navigated to is highlighted more strongly than the rest, and the results panel and match navigation keep working on browsers that lack the API.
- **Smaller, tidier terminal status bar** - the status bar's chips now sit two points below the header's type rather than three, and the context chip's readouts step down one further. The redundant "Ctx:" label and its icon are gone — the bar and the `12k/200k` readout already say what the chip is — and the readouts no longer break across two lines when space is tight.

### Added
- **Back / Forward in the diff modal** - the git panel's diff modal records every file that lands in it, however it got there — previous/next, a click in the tree, or a typed path — so Back and Forward work across all of them instead of only stepping through the changed-files list. It has an editable path box too, and Alt+arrows mirror a browser (Alt-modified so plain arrows stay free for scrolling).

### Removed
- **Stale repository files** - a checked-in `browser-extension.zip`, a screenshot, two superseded planning documents and a local-model research note were removed, along with the headless-CAD example (the request body in `docs/headless-cad.md` is self-contained).

## [1.184.0] - 2026-08-15

### Added
- **Browse from inside the file viewer** - the viewer is no longer a dead end on whatever opened it. It has an editable path box, Back / Forward / Up buttons (Alt+arrows, mirroring a file manager) and clickable directory listings, all sharing one navigation trail so the toolbar, the path box and what's on screen stay in step. The trail is seeded with the file you opened, so the first Back returns there rather than to an empty state, and reopening the viewer on a different file starts a fresh trail.
- **Export Markdown as PDF** - a rendered Markdown file can be exported to PDF. The client hands the server the HTML it is already displaying, so the PDF matches what you are looking at instead of being re-parsed by a second, subtly different renderer, and images are rewritten to absolute self-authenticating URLs so they actually appear rather than rendering as broken boxes. The print stylesheet is deliberately its own, light and paper-first — the app's dark screen theme would print as a wall of ink.
- **Attach files to a Jira issue** - local files can be uploaded as attachments on an issue through the Jira integration and its skill.
- **View-mode menu in flat view** - the message-view segmented control became a dropdown listing every view plus Classic TUI, with the active one ticked, freeing header space and keeping the status bar quiet.

### Fixed
- **Parts of the UI silently freezing after an update** - a build replaces the hashed bundle and deletes the previous chunks, so a page that was already open requests chunk files that no longer exist. Those requests fell through to `index.html`, which returned HTML with a 200 that the browser then tried to execute as JavaScript: the dynamic import failed with a syntax error and that slice of the interface simply stopped updating, with nothing in the network tab looking wrong. Missing chunks now return a real 404, so the client sees a genuine chunk-load error and can prompt for a reload.

### Changed
- **Download helpers consolidated** - the drag-out and download helpers added last release lived in a second module alongside an existing one; they are now a single file.

## [1.183.0] - 2026-08-14

### Added
- **Drag files out of the browser** - a file in the explorer or the git panel can be dragged straight into Finder, Explorer, an editor or a mail composer. Folders travel as a `.zip`, since the OS has no way to accept a stream of loose files from a web page, and the archive is streamed rather than assembled in memory, so a multi-gigabyte source tree costs a constant amount of RAM. A file that vanishes mid-walk (build output, a temp file) is skipped rather than failing the whole archive, and cancelling the drag abandons the walk instead of churning the disk with nowhere to write. This is Chromium-only; elsewhere the drop lands as a URL.
- **Download a folder as a zip** - the same archive is available as an ordinary download from the file trees.
- **Recent project folders in the Files tab** - the explorer lists the ten working directories you have most recently been in, newest first and deduplicated (many agents share one repo). Recency uses the same signal as the agent dock, so it reflects where you have actually been working rather than merely which agents exist. Picking one takes over the explorer until you switch agent, so the tab keeps following the selected agent by default instead of silently pinning another project's folder.
- **Browse to any path from the file viewer** - the viewer's header accepts a typed path, so you can navigate anywhere without reopening it from a tool card. Reopening on a different file discards the override, so you always land on the file you asked for rather than wherever the last session was browsing.

### Fixed
- **FreeCAD viewer used one colour for every part of a headless assembly** - `.FCStd` files saved by `FreeCADCmd` have no `GuiDocument.xml`, and the viewer only read `ShapeColor` / `ShapeAppearance` from that GUI file. It now also reads App-side `ShapeColor`, `DiffuseColor` and `Transparency` from `Document.xml`, and treats FreeCAD display colours as sRGB, so a PCB, a battery and a case keep their own colours.
- **Uploads failing with a network error while everything else worked** - Node closes an idle keep-alive socket after five seconds, but browsers hold sockets in their pool far longer. When the two raced, the browser wrote a request onto a socket the server was closing and it died mid-flight. Browsers silently retry an idempotent GET, but never a POST, so the only visible symptom was an upload failing outright. The server's idle window now sits well past any browser's.
- **Tooltips stranded on top of every other application** - Chromium renders a native tooltip as its own floating window, and an installed web app can fail to tear it down when the window is deactivated mid-hover (Alt+Tab, or any other app taking focus). The tooltip then floats above everything and survives moving the cursor away, hiding the app, even minimizing it. Tide Commander now strips the `title` from whatever the cursor is over when the window loses focus, which destroys the tooltip window immediately, and restores it on focus.

## [1.182.1] - 2026-08-12

### Fixed
- **Editing an area's prompt appeared to do nothing** - an area prompt is baked into the instruction block when a session starts, so a running agent on a stdin-driven backend (Codex, OpenCode, Grok, Pi) kept the old text until it was restarted. Agents whose effective area prompt actually changed are now flagged to re-inject it on their next turn. This covers every way that text can change — the prompt was edited, the area was renamed or deleted, or the agent was dragged into or out of an area — and deliberately does nothing when the resolved text is identical, so moving an agent between two prompt-less areas doesn't re-inject the block for nothing.
- **Uploading a `.json` file hung until the browser gave up** - the file upload route streams the raw request body itself, but the global JSON body parser consumed the stream first whenever an upload happened to be JSON. The route's listeners then never fired, no response was ever sent, and the upload failed with "Failed to fetch". The upload route is now exempt from that parser.

## [1.182.0] - 2026-08-12

### Added
- **Spotlight finds files across every project** - Spotlight gained a Files section that searches filenames across all directories configured on your areas, not just the project currently open. It uses ripgrep when available and falls back to an async directory walk that never blocks the event loop, and the folders it skips (`node_modules`, `.git`, `dist`, `.venv` and friends) are now an editable list in Settings, so a project that keeps source somewhere unusual can be searched without patching anything.
- **Grok 4.6** - selectable as a Grok model and now the default, replacing 4.5 (which stays available). It adds the `xhigh` reasoning tier, and the effort picker is driven per model, so 4.5 correctly offers only low/medium/high while 4.6 offers the full set — no more sending a tier the model doesn't accept.
- **Serve HTTP and HTTPS at the same time** - setting a dedicated TLS port serves HTTPS alongside plain HTTP on the main port, so browsers, the phone and anything else can connect over whichever scheme suits them without running two instances. Both listeners share a single WebSocket server, so every client lands in the same broadcast group regardless of how it connected — standing up a second server per listener would have silently split clients in two and delivered broadcasts to only one half.
- **Architecture documentation** - `docs/architecture.md` and a companion Mermaid diagram now describe the system end to end, from entry points through the runtime, providers and websocket layers.

### Fixed
- **Model chips guessing a Grok agent's model** - when no model was explicitly configured, the header and info chips fell back to a hardcoded guess. The CLI reports which model is actually serving the session, and that is now stored on the agent and displayed instead, so what's on screen is what's running.

## [1.181.0] - 2026-08-12

### Added
- **Pi is a fifth agent provider** - agents can now run on the [pi coding agent](https://github.com/earendil-works/pi-mono) alongside Claude, Codex, OpenCode and Grok. Pi appears in the spawn dialog, agent editor, boss spawn schema, bulk manage, commander and dashboard views, with its own model picker (`provider/model` patterns such as `anthropic/claude-sonnet-4-5`; leaving it empty defers to pi's own configured default) and its own icon on the battlefield. Sessions resume across turns, and slash commands are gated for it like every other provider. Installation detection validates that the resolved `pi` really is the coding agent — Anaconda ships an unrelated Python tool with the same name, which would otherwise look like a working install.
- **Mid-turn steering for Pi** - an optional RPC mode (Config → Experimental) keeps one persistent `pi` process per agent with an open command channel, so a message sent while the agent is working is delivered *inside* the current run — after the tool round in flight, before the next model call — instead of queueing until the turn ends. The mode is chosen per launch from the live setting, so switching it needs no restart, and turns can be interrupted outright. The default single-shot runner is unchanged.

## [1.180.0] - 2026-08-11

### Added
- **Audio files play in the viewer** - `.wav`, `.mp3`, `.ogg`, `.opus`, `.flac`, `.m4a`, `.aac` and friends now open in a real player instead of a "binary file" placeholder, with a drawn waveform you can click to seek, plus volume, playback speed and loop controls and the clip's duration, channel count and sample rate. The waveform is reduced to peak pairs once and the canvas scales that summary, so a long recording draws instantly; peaks are min/max per bucket rather than averages, because averaging flattens exactly the transients that make a recording recognizable. A format the browser can't decode falls back to a clear message and a download button rather than a broken player.
- **Video files play in the viewer** - `.mp4`, `.webm`, `.mov`, `.mkv` and similar play inline with the browser's own controls, in both the file modal and the File Explorer's tabs. Both viewers share one list of playable formats, so nothing can be playable in one place and a binary blob in the other.

### Changed
- **Media streams instead of downloading whole** - the file routes now honour `Range` requests, so a player scrubs by fetching the byte window it needs rather than re-downloading the file. The 50 MB response cap still protects the viewers that read a whole response into memory (images, PDFs, 3D models) but no longer applies to audio and video, where a 300 MB screen capture is an ordinary file to play. Binary responses also declare a proper content type per format — a media element rejects an `application/octet-stream` blob outright, which showed up as "this audio won't play".

## [1.179.0] - 2026-08-10

### Added
- **Headless FreeCAD jobs** - agents can now build CAD models without a GUI ever opening. `POST /api/cad` runs an isolated `FreeCADCmd` job that exports FCStd, STL and STEP atomically, validates that the result is a real solid, checks clearances and intersections between part pairs, and renders deterministic orthographic PNG previews so the outcome can be seen rather than assumed. It finds FreeCAD whether installed natively or as the Fedora Flatpak, keeps every artifact inside the job's workspace, and supports cancellation and timeouts. A worked example and a headless-first agent workflow ship with it.
- **GLB model previews** - self-contained binary glTF models open with their original hierarchy, PBR materials and embedded textures, plus the standard axis views, lighting/opacity/edge settings, recent-files list and the same draggable sphere/box area annotations the STL and FreeCAD viewers have. GLB references also render inline in terminal Markdown and in binary Git changes.

### Changed
- **File previews never use stale model bytes** - file-viewer metadata and binary responses now explicitly disable browser and proxy caching, and `/api/files/*` is excluded from the service worker's offline fallback. Reopening an STL, FCStd, GLB or G-code file therefore always reads its current contents from disk — which matters when an agent has just rebuilt the model you are looking at. The recent-files list stores paths only, never bytes.

## [1.178.0] - 2026-08-10

### Added
- **Interactive STL previews in the file viewer** - `.stl` files now open as authenticated, zoomable 3D previews with orbit/pan controls, automatic camera framing, model dimensions and triangle counts, for both binary and ASCII STL data. A dual-handle vertical control clips layers upward from the build plate and downward from the top, so the whole print progression or any intermediate band can be inspected. Model and background colours, opacity, light intensity and edge outlines are adjustable and persist between sessions.
- **FreeCAD document previews** - `.FCStd` archives render their visible BREP objects as interactive 3D models in the browser. The OpenCascade triangulation runs in a Web Worker, so opening a CAD file never freezes the interface; object colours (from both `ShapeColor` and binary `ShapeAppearance` material lists), transparency, Z-up orientation, dimensions and model statistics are preserved where the document provides them, and the viewer can switch between the document's saved colours and its own.
- **G-code toolpath previews** - `.gcode` and `.gco` files render as colour-coded 3D toolpaths with a dual-handle layer range, a travel-move toggle, the standard axis views, and the print time, filament usage, material, printer and geometry statistics the slicer recorded. Parsing runs off the UI thread, so a large file doesn't lock the interface.
- **Mark regions for an agent** - translucent sphere or box volumes can be placed on an STL or FreeCAD preview to mark an exact region, resized with shape-appropriate sliders, dragged across the model surface, and fine-tuned by editing their coordinates in the model's own space. The selection copies to the clipboard as an agent-ready Markdown/JSON description, so "this boss here" becomes something an agent can act on.
- **Inline 3D previews in chat** - a standalone STL or FCStd file reference in an agent's message renders as an interactive preview in the terminal rather than a plain link.
- **Axis views and recent models** - the STL and FreeCAD viewers gained visible XYZ axes plus X / Y / Z / isometric buttons and keyboard shortcuts, and each keeps a local list of the eight most recently viewed models so you can switch straight to another one from the viewer's settings.

### Changed
- **Binary files in the Git changes viewer show a preview** - a changed image, PDF, STL, FCStd or other binary used to render as a byte-like text diff. Each now opens in its own preview instead, and a deleted file is previewed from `HEAD`, so it stays inspectable after removal.

### Fixed
- **Codex agents kept running on the old account after a switch** - the `codex app-server` daemon reads `~/.codex/auth.json` once at startup and never re-reads it, so a daemon that outlived an account switch silently kept every Codex agent on the previous — usually rate-limited — account. Switching accounts now kills that daemon (signalling the whole process group, since the recorded process is a wrapper whose real binary would otherwise outlive it), and a daemon whose account no longer matches the auth file is never rejoined on boot, including after a plain `codex login` outside Tide Commander. Any Codex agent that was mid-turn is cut off by the switch and has to be re-sent — the switch dialog now says so, and those agents are finalized rather than left stuck "working".
- **File links in agent messages losing their label** - the Markdown renderer strips unknown URL schemes, which blanked the label of bare file paths. The path is now recovered from the link text when that happens.

## [1.177.2] - 2026-08-08

### Fixed
- **Black screen on resume, surface-level cause** - Android can bring the app back with a stale (black) WebView surface even though the renderer and JavaScript are perfectly alive, which is a layer no JavaScript-side repaint can reach. On resume the native side now bounces the WebView's visibility across two frames, forcing the system to drop and re-attach the surface, then repaints. In the healthy case this happens inside the app-switch transition and is invisible. **This part ships only in the APK** — an over-the-air UI update cannot carry a native change.
- **Recovery nudges landing too early** - some devices restore the compositor or GL context late, so a single repaint fired in the first moments of a resume could run before there was anything to fix. Resume and boot now each get a second, later pass, and the repaint itself no longer depends solely on an animation frame — right after a resume the WebView's frame callbacks can stall, and a nudge that never reverts is a nudge that never re-composites, so a short timer now backs it up.

### Added
- **Client lifecycle beacons** - the phone posts a small beacon to the commander on native boot, resume and visibility events, and the server keeps the last 300 in memory (`GET /api/system/client-beacons`). This answers the question that was previously unanswerable from a phone across the room: if beacons arrive around a black screen the JavaScript context is alive and it's a compositor/paint problem, and if they stop the renderer itself died. Fire-and-forget — a failed beacon can never affect the app.

## [1.177.1] - 2026-08-08

### Fixed
- **Black screen when returning to the Android app** - a new cause of the resume black screen. Applying an over-the-air UI bundle reloads the WebView, and the auto-sync check fired the instant the app came to the foreground, so that reload landed inside Android's own GPU/compositor restore and the two raced — leaving the app black on return. Against a dev server, which pushes same-version rebuilds, the swap was firing on nearly every app switch, making it frequent. The foreground check now waits five seconds for the resume to settle (and is cancelled if the app is backgrounded again in the meantime).
- **Black screen after an over-the-air bundle swap** - the freshly reloaded WebView starts a brand-new page context, which never receives the resume or visibility events the existing recovery hooks listen for, so a compositor that came back black after the swap had nothing to kick it. A single idempotent recovery nudge now runs shortly after first paint on native builds; it does nothing when the view painted normally.

## [1.177.0] - 2026-08-08

### Added
- **"Restore to new agent" in the Session Finder** - a found conversation can now be restored onto a brand-new agent instead of having to overwrite an existing one. The new agent copies the configuration and skills of the closest match in that project — the most recently worked agent whose directory is the session's project, preferring a Claude agent since the finder only surfaces Claude conversations — and falls back to a default builder in that directory when the project has no agents left. This is the way back into an orphaned session whose original agent is gone. The finder jumps to the new agent and opens its terminal as soon as the server reports it, so the restored conversation is on screen without hunting for it.

## [1.176.0] - 2026-08-07

### Added
- **Prompt overview rail** - a slim rail down the side of the conversation puts one dot per user prompt (the 15 most recent), with the prompt text on hover and a click to jump straight to it. The dot for the prompt you're currently reading stays lit as you scroll: selection follows a reading line that sweeps the viewport with scroll progress rather than a fixed midline, so prompts packed into the first or last half-screen still get their turn instead of never lighting up.
- **Past conversations in Spotlight** - Spotlight now searches the full text of past sessions alongside the live agents, split into "Recent Activity" and "Past Conversations". Opening a session hit hands the query over to the terminal search so the match is highlighted where you land, and the preview window is anchored on the hit instead of the tail — previously the preview could miss the match entirely while the counter still claimed to have found it.

### Changed
- **Session Finder search is dramatically faster** - searching used to re-open every session file on every keystroke. Now a header cache reuses the parts of a session file that can never change, a per-file result cache (3 entries deep) answers refinements without touching disk — if "scro" appears nowhere in a file, "scroll" can't either, and typing forwards then backspacing hits the still-valid entry — sessions being written to are resumed from where the last scan stopped rather than re-read whole, superseded scans are cancelled mid-flight, and when ripgrep is on PATH it does the cold scanning in two passes (counts for every candidate, then sample lines for just the files actually shown). The previous JS scanner remains as the fallback when ripgrep is unavailable or misbehaves. Queries shorter than 2 characters now narrow the recency list locally instead of triggering a full-corpus scan for no signal.
- **Recent-agents dock ordering is consistent across devices** - the dock's recency now comes from a server-side stamp that moves only when an agent actually transitions into or out of work, never on clicks or metric ticks. Every browser and the phone therefore agree on the order, including work that a given client never saw live because it was closed or backgrounded, and clock skew between client and server can no longer mint future recency that outranks genuinely working agents.

### Fixed
- **Search preview showing a match count with no visible highlight** - the counter tallied hits over the full message while the preview rendered a clipped version, so "3 of 7" could sit above text containing none of them. Counting now runs over exactly the text that gets rendered, and a long message's clip window shifts to cover the first hit rather than always cutting from the start.

## [1.175.0] - 2026-08-04

### Added
- **Silent model-fallback detection** - the API can serve a turn with a different model than the one a session was started with: a refusal fallback, a capacity/quota fallback, or a server-side mid-stream swap. Only the first shows a dialog in the CLI; the other two are completely silent and ignore the local opt-outs. Tide Commander now compares the model the session reported at startup against the model that actually answered each main-loop message, and surfaces the mismatch as a row in the terminal and as a warning chip in the header reading `Opus 5 → Sonnet 5`. The flag clears as soon as a turn comes back on the configured model, survives a commander restart mid-fallback, and works in interactive TUI mode too (where the transcript has no startup record to compare against, so the agent's configured model is used as the baseline). Task subagents, which legitimately run their own model, are excluded.
- **Codex per-account usage gauges and account switcher** - Codex agents now get the same daily + weekly rate-limit gauges per stored credential profile that Claude accounts have, plus an inline account switcher in the context view for switching when one account is rate-limited. Dormant profiles are read through a throwaway `CODEX_HOME` so the live `~/.codex/auth.json` is never touched, and if the read rotates a profile's tokens the new credentials are written back to every copy of that profile (skipping any copy that changed while the read was in flight, so a newer grant is never clobbered).
- **Web-search details for Codex** - Codex's app-server announces a web search before the query is known, so the row rendered bare. Searches now show the query (or the opened URL) by reading the result payload when the input is still empty.

### Fixed
- **Endless restart loop on a wedged CLI** - the restart cap reset itself on elapsed time alone, and the idle watchdog only kills a hung CLI after 180 s, which always exceeds the 60 s cooldown — so every hang → kill → restart cycle went back to "attempt 1 of 3" and the supposedly capped loop ran forever. A restart now only counts as healthy if the CLI actually wrote to stdout; side-channel activity (a session watcher replaying the previous turn's usage file ~300 ms after spawn) no longer passes for a live process.
- **Agents stuck "working" with the answer already on screen** - a one-prompt-per-process CLI (grok in particular) sometimes finishes its turn and then never exits, usually because the turn spawned a background process that outlives it. The stdout terminator never arrives, the turn stays open forever, and because messages always queue for these backends, everything sent afterwards waited behind a turn that would never end — until the watchdog killed it as if it had wedged mid-turn, whose resume then deadlocked permanently. Two guards close this: a synthetic turn-completion after a short grace period when the session's own event log reports the turn ended, and a watchdog reap of a process still alive 30 s after its turn finished.

## [1.174.0] - 2026-07-30

### Added
- **Upload your own notification sounds** - each of the three events (agent asks you something / agent sends a notification / agent finishes working) can be overridden with your own audio file from Settings → General → Sounds per event. Uploads are stored server-side (mp3, wav, ogg, m4a, aac or webm, 5 MB cap), so the same sounds apply on every device connected to that commander rather than only the browser that uploaded them. It's per event, not all-or-nothing: anything you don't override keeps its built-in cue, and a file that fails to play (bad codec, missing file, autoplay blocked) falls back to the synthesized cue instead of going silent.
- **Slash-command autocomplete in chat** - typing `/` now suggests the commands the commander can actually deliver (`/compact`, `/clear`, `/context`, `/cost`), gated per provider. Interactive-only commands like `/model` and `/login` are deliberately absent: agents run headless, where those silently do nothing.

### Changed
- **Warmer built-in cues** - the synthesized sounds were pure oscillators with exact-octave overtones, which is precisely what reads as "electronic beep". They're now synthesized as struck bars: inharmonic partials (2.005×, 3.01×, 5.43×) like a real marimba, a short filtered-noise mallet transient, per-partial decay so upper partials die away first, a gentle lowpass, and a ~10 ms attack instead of a clicky instantaneous onset. Same melodies and the same questioning pitch-bend, so every cue stays recognizable — only the timbre changed.

### Fixed
- **Context counter drifting out of sync** - three separate causes. A turn can bill several models (the conversation model plus short auxiliary Haiku calls for web search or titles) and `modelUsage` key order follows first use, so the first key was frequently Haiku and its 200k window got reported as the agent's — replaying 1578 real result events, 290 of 402 multi-model turns were mis-attributed; the meter now picks the model the main loop actually streamed. A prompt size larger than the tracked window used to be discarded, collapsing the meter to `0.0k` mid-conversation, when it actually means the *window* is stale and should be widened. And the terminal footer, mobile bar and flat view each rolled their own precedence between reported and tracked stats, so they could disagree — all three now route through one helper.
- **`/compact` leaving a stale context number** on screen until the next message; it now refreshes on completion.
- **Slash commands looking like a no-op** - they were hidden in four places, so running one produced no visible trace. They now render as a chip in both the live and reloaded-history paths, and server-intercepted commands (`/context`, `/cost`, `/clear`) are echoed so they reach the chat at all. Echo Prompt no longer breaks them either: duplicating `/compact` into `/compact\n\n---\n\n/compact` stopped the CLI treating it as a command, so Claude now skips the echo for bare slash commands the way Codex and OpenCode already did.
- **CSS leaking into highlighted code** - a global `.class-name` rule (dead code from an old class picker) collided with Prism's `builtin class-name` token and capitalized `cd` / `echo` in every command shown in chat, and a global `.tag` rule hit Prism's markup token, giving HTML/JSX blocks `display: inline-flex` and a red hover. Both are now scoped to their owners.
- **Commands mislabelled as GREP** - the terminal command classifier matched `grep` anywhere in the string, so a multi-step build gate got labelled by one late pipe stage. It now only classifies when a single substantive step remains after stripping `cd` / `echo` scaffolding.

## [1.173.0] - 2026-07-30

### Added
- **"None (silent)" tone per cue** - any one of the three cues can now be switched off on its own while the others keep playing, so you can (for example) keep the question alert and silence the agent-finished sound. Selecting None also disarms the repeating question alert rather than starting a cue that plays nothing, and its preview button greys out.

### Changed
- **Notification volume range extended to 0–10** - the slider previously topped out at 5, which was too quiet on some laptop speakers. Levels 1–5 keep exactly the loudness they always had, so an existing setting sounds unchanged; 6–10 are new headroom above the old ceiling. Synthesized cues and sampled tones use separate gain curves — a couple of sine oscillators need a much lower peak than a loudness-normalised file — tuned so switching tones doesn't change how loud a notification feels. The value readout now shows the level as `n/10`.

## [1.172.1] - 2026-07-30

### Fixed
- **Settings search couldn't find the sound options** - the search box filters sections against a hand-written keyword list, and the notification-sound rows (enable, volume, the three tone pickers) were never added to it, so searching "sound", "volume" or "tone" returned nothing. The General section now carries those keywords in English and Spanish, along with the dock/activity rows that had the same gap. A new test reads the rendered labels straight out of the source and fails when a row has no keyword to match on, so the next setting added can't silently become unreachable by search.

## [1.172.0] - 2026-07-29

### Added
- **Selectable notification tones** - each of the three cues (notification, question, agent finished) can now be set independently in Settings → Sound Effects, choosing from the three built-in synthesized cues plus 20 sampled tones (chime, bell, glass, pluck, drop, blip, switch, alert, pop, tick and soft/bright variants). Picking a tone plays it immediately as its own preview, the configured tones are decoded up front so the first cue of a session isn't the fallback, and an unknown id or a failed download degrades silently to the built-in cue. The samples are a curated subset of Kenney's "Interface Sounds" pack (CC0), converted to mono MP3 and loudness-normalised so switching tones doesn't change the perceived volume.
- **Per-agent sound mute** - "Mute sounds from this agent" in the agent edit dialog silences one agent's audio only: no notification chime, no completion cue, and its questions never start (or sustain) the repeating alert. Everything visual is untouched — toasts, phone notifications and the board behave exactly as before — so a chatty agent can be silenced without being hidden. The agent info panel shows the current state as Sounds: Muted / On.

## [1.171.0] - 2026-07-29

### Added
- **"Last agent" button in the mobile bottom nav** - in flat view with no chat open, the bottom bar now shows a one-tap button back into the agent you were last in, labelled with that agent's name (the mobile equivalent of the Space/Backspace shortcut on desktop). The last-opened agent is persisted, so it survives an app reload, and the button disappears on its own if that agent is deleted.

### Changed
- **Notification sounds are now opt-in** - they shipped enabled by default in 1.169.0; they now default to off and only play once you turn them on in Settings. A one-shot per-device migration clears the inherited "on" value, so existing installs go quiet without having to find the toggle.
- **Flat view drops the Spawn button from the mobile bottom nav** - its own middle column already carries the + Agent / + Boss actions, so the nav no longer duplicates them.

## [1.170.0] - 2026-07-29

### Added
- **Ctrl+hover tool preview** - hold Ctrl (or Cmd) while hovering a Read/Write/Edit/Bash row, or any clickable file path in the terminal, and a small panel shows what it points at without opening the full modal: the file's first lines with syntax highlighting, the edit's diff, the command's captured output, or the image itself. The panel is interactive — the pointer can move onto it and scroll it — and it's gated by a new "Ctrl+hover preview" setting (Config → General, on by default). File reads for the popup now request only the line window they display instead of pulling a whole 1 MB file over the wire on every hover.
- **Smart filename filter in the git panel** - the Changes and Files tabs gained a filter field with a small query language: fuzzy filename matching, `server/claude` for path matching, `.tsx` / `*.tsx` for extensions, `"use client"` for a literal contiguous substring, `!test` to exclude, and `status:mod` / `!status:u` to keep or drop a git status. Terms combine with AND and match smart-case (lowercase is case-insensitive, any uppercase makes it exact); matched characters are highlighted in the results, which are ranked best-first. Escape clears the field without also closing the terminal.
- **Image, SVG and PDF previews in the changes viewer** - opening a changed binary image now renders the working-tree image instead of raw bytes as unreadable text, PDFs get an inline pdf.js preview (the same viewer the file modal uses, which works in the Android WebView where an iframe renders nothing), SVGs default to the rendered view with a "Show rendered" toggle back to the meaningful text diff, and other binaries (zip, media, executables) show a placeholder with a download action instead of two empty panes.
- **`view_image` tool card** - Codex `view_image` calls now render as a proper image row (icon, translated name, the file path as the label) with the image itself available in the hover preview, instead of an unlabelled generic tool row.
- **Persistent git panel tree expansion** - which folders you had expanded in the Changes tree is remembered per agent across reloads, and repos are no longer auto-expanded when they carry a very large number of changes.

### Changed
- **One syntax palette everywhere** - the file-explorer editor used CodeMirror's bundled One Dark palette (hardcoded hexes) while markdown source, merge conflicts and commit diffs used two different Prism palettes — the same file could look three ways, and the editor ignored the theme picker entirely. CodeMirror's Lezer tags now map onto the same theme variables the Prism theme uses, so every code surface follows the selected theme.
- **Mermaid diagrams render compactly inline** - a wide diagram no longer spans the whole conversation; the inline preview scales down to a fixed maximum width (small diagrams stay at their natural size) and is no longer height-cropped, with the full-size zoom/pan modal one click away.
- **Steadier conversation reveal on a cold agent switch** - switching to an agent whose history wasn't cached waits for more consecutive stable frames before revealing the conversation, so the remaining row measurements no longer visibly push the text around. Warm switches keep the short window and stay snappy.

### Fixed
- **Opening a large file locking up the tab** - the file viewer and both diff panes emitted one DOM row per line with no windowing, and the diff's naive LCS allocated the full `(m+1) × (n+1)` table. On a real 31,841-line, 1 MB JSON that meant ~183,000 DOM nodes and a 1.01-billion-cell table (~7.6 GB of numbers, 7.7 s just to allocate) — the tab hung. Lines now render through a windowed list, the diff peels the identical prefix/suffix before diffing and refuses to build a table past a bounded size, and syntax highlighting is memoized per visible line so only the rows on screen ever reach Prism.
- **OpenCode agents wedged in "working" outside the daemon's directory** - the server-mode event stream subscribed to OpenCode's project-scoped `/event` endpoint, which silently drops every event from sessions in any other working directory: those agents received no streamed text and no `session.idle`, so they never finished a turn. It now subscribes to the all-projects `/global/event` stream (unwrapping its envelope, with an automatic fallback to the legacy endpoint on older OpenCode builds), force-finalizes a turn shortly after the prompt request resolves if the idle event never arrives, and reads the session map format that OpenCode 1.18.x returns.
- **Escape closing the terminal from inside a field that handles it** - inputs that consume Escape themselves (such as the new filter field, which clears on Escape) no longer also close the terminal underneath them.

## [1.169.0] - 2026-07-27

### Added
- **Notification sounds** - the client now plays gentle synthesized cues (Web Audio, no sound files): a soft two-note chime for agent notifications, a distinctive rising "question" cue when an agent asks you something or requests permission, and a mellow resolving cue when an agent finishes its work. Enabled by default, with a toggle, a 0–5 volume slider, and Question / Notification / Done preview buttons in Settings; turning the toggle off silences everything.
- **Repeating alert for unanswered agent questions** - when an agent question or permission request arrives, the question cue fires twice up front and then repeats every 10 seconds so you don't miss it after stepping away. It stops the moment the prompt is answered and gives up on its own after 2 minutes, so it can never nag indefinitely.

### Fixed
- **Huge image tool results flooding the terminal and history** - reading an image file returns an inline base64 block that was being serialized verbatim into the terminal text (one real session carried a 439 KB single message, and its 880-message history weighed 4.5 MB, ~2 MB of it base64) — pushed through the history endpoint, the live WebSocket stream, and finally into a DOM text node nobody can read. Image blocks now collapse to a compact `[Image: image/png, 312 KB]` placeholder in the live stream, in loaded session history, and in interactive TUI mode; all other tool results keep their exact previous output.
- **Git panel freezing on repos with large untracked trees** - a working directory full of generated/untracked files (one real repo: ~65,000 entries, an 8.1 MB status push) stalled the server event loop while serializing the update and locked up every client that parsed and rendered it. The watcher now sends at most 2,000 file entries per repo while still reporting the true change count, so the per-repo counter and the building/area badges keep showing the real number; the panel adds a "Showing X of Y changes" notice on capped repos, no longer auto-expands a repo with more than 500 changes, and builds its tree view without the quadratic lookup that could block the browser for minutes.
- **"Discard all" understating what it deletes** - on a repo whose file list was capped, the confirmation dialog counted untracked files only within the visible slice. It now states that it deletes every untracked file rather than quoting a number lower than what will actually be removed.

## [1.168.0] - 2026-07-22

### Added
- **Claude Opus 5** - Opus 5 is now a selectable Claude model (Opus 5 \[1M\] and 200K), available in the Spawn dialog, the Bulk Manage model filter, and the boss spawn schema. The `opus` shorthand now resolves to Opus 5; Opus 4.8 remains available as the previous generation.
- **SVG previews in the file viewer** - `.svg` files now open as zoomable image previews (rendered in the browser's image-document context, not as inline scriptable markup) instead of raw XML.

### Fixed
- **Image/PDF detection in the file viewer** - images and PDFs are now recognized by the file path suffix as well as the reported extension, so a file whose extension metadata is missing still previews correctly instead of falling back to a text view.

## [1.167.2] - 2026-07-18

### Fixed
- **Black screen after returning from the background (Android)** - resuming the app from the background no longer leaves a black screen. Three recovery paths were added: the native side recreates the activity when Android reclaims the WebView's renderer process while backgrounded (previously a dead black shell); the 3D view force-restores its WebGL context and restarts the render loop when Android drops the context without firing the restore event; and the flat/DOM view nudges the WebView compositor to re-composite a layer that came back black. No wake lock or extra sockets — background battery behavior is unchanged.

## [1.167.1] - 2026-07-18

### Changed
- **App no longer wakes the lock screen** - the Android app no longer forces the screen on or shows over the lock screen, and drops the `USE_FULL_SCREEN_INTENT` permission it needed for that. Notifications still arrive normally.

### Fixed
- **Download files too large to preview** - a file that exceeds the 1 MB text-preview limit now shows a Download button in the file viewer, so you can still save it through the streaming binary endpoint instead of hitting a dead-end "File too large" message.

## [1.167.0] - 2026-07-17

### Added
- **Mermaid diagrams in chat** - agent responses containing a ` ```mermaid ` fenced block now render as a diagram inline. The chat shows a clean static preview; clicking it opens a modal with an interactive viewport — zoom (buttons or ctrl/⌘-scroll toward the cursor) and drag-to-pan — so large diagrams stay explorable without cluttering the thread. Streaming-safe: shows a stable "Rendering diagram…" placeholder (with collapsible source) until the syntax settles, and falls back to raw source if invalid.
- **Mermaid skill (default)** - a new built-in "Mermaid Diagrams" skill, enabled for every agent, that teaches agents when and how to emit Mermaid (flowcharts, sequence, ER, state, gantt, class) so they reach for a diagram instead of prose when a visual lands faster.
- **Error detail on the status badge** - hovering an agent whose status is "error" now shows the underlying runtime error message as a tooltip; it clears automatically once the agent recovers.

### Fixed
- **Duplicate first message (OpenCode/Codex)** - the opening prompt of a new OpenCode or Codex session is persisted wrapped in the instruction block; the UI unwraps it for display, so it appeared twice (a live row next to its history twin). The live row is now deduplicated against the wrapping twin, while two legitimately-identical sends are preserved.
- **"Send now" on Codex app-server** - interrupting a Codex app-server turn silently failed (the request was missing the required turn id). The runner now tracks the active turn id, so "Send now"/stop actually interrupts the running turn.
- **Duplicated prompt on OpenCode** - a transient network hiccup could resend an OpenCode prompt that had already landed, so agents saw the same message twice. POSTs are no longer auto-retried on transport errors (only idempotent GETs retry once).
- **Long OpenCode turns falsely erroring** - turns running longer than ~5 minutes could trip a request timeout and wrongly flag the agent as errored. The message send now uses a dedicated no-timeout connection that waits harmlessly for turn end.
- **OpenCode agent going silent after a failed send** - a failed send left the runner stuck "processing" so every later message queued forever and never arrived; the turn state now resets and the queue drains on recovery.
- **Stuck mid-turn CLI recovery** - a tmux-mode CLI that hangs mid-turn (e.g. Grok deadlocking on resume of a killed session) — alive but emitting nothing and stuck "working" forever — is now detected by the watchdog, killed, and respawned through the capped restart policy so it ends in a clear error instead of hanging indefinitely.

## [1.166.0] - 2026-07-17

### Added
- **Google OAuth token-health monitoring** - Gmail, Calendar, and Drive share a single `GOOGLE_REFRESH_TOKEN`, and their status now reflects a real `refresh_token` → `access_token` exchange against Google instead of merely "three secret strings are present." A revoked or expired refresh token that previously still rendered as "Connected" (even across server restarts) now surfaces as expired. A shared background monitor probes the one token once and reports a single verdict to all three clients, and re-consenting through any one service rotates the token for the others without a restart.

### Fixed
- **"Google Authorization Expired" re-connect flow** - the integrations panel now distinguishes "credentials were rejected, re-authorize" (`needsReauth`) from "never configured," and shows a dedicated expired banner with a reconnect action instead of a misleading connected state.
- **Edit Agent → Advanced options collapsed to an unclickable line** - the "Advanced options" drawer (which holds the agent's Custom Instructions / prompt, terminal shortcut, and auto-collapse settings) was being compressed to a ~1px, unclickable sliver whenever the modal overflowed. Its `overflow: hidden` reset the flex item's auto min-height to 0, so the column-flex modal body shrank it instead of scrolling. Pinned `flex-shrink: 0` so it keeps its height and the body scrolls to it.

## [1.165.1] - 2026-07-16

### Fixed
- **Streaming flicker on mid-turn refresh** - the live output tail no longer remounts (markdown re-parse + fade restart, plus a height reflow) every time a session-history refresh arrives while an agent is streaming. Row keys now use a stable per-(uuid, timestamp) ordinal instead of an index that shifted with history length, and measured row heights bridge the live→history identity swap so the visible tail stays put instead of collapsing to size estimates.
- **Grok agents in the same folder could cross conversations** - two Grok agents running in the same working directory no longer risk one attaching to the other's session. Session discovery now claims each session per agent and matches on creation time (not modification time, which a concurrent agent's writes kept "hot"), and the watcher re-pins to the session id the CLI itself reports on stdout. This prevents one agent mirroring another's tool output into its terminal and the two sessions merging on the next resume; forked sessions never hand the fork-source id to the watcher.

## [1.165.0] - 2026-07-14

### Added
- **Five new themes** - Abyss Ember (warm coals over the void), Abyss Frost (glacial cyan), Abyss Moss (soft forest charcoal), Abyss Dusk (warm, low-blue-light night reading), and One Dark (IntelliJ-accurate dark chrome, distinct from the editor-only Atom gray).
- **Eye-comfort theme tokens** - themes can now define their own text-selection, hover, thinking, and working-status colors; older themes get derived fallbacks automatically, so every theme stays coherent.

### Fixed
- **Themes now apply to the whole app** - selecting a theme previously only repainted the chat/message stream; the rest of the UI was compiled against a fixed palette and silently ignored your choice. Database panels (sidebar, tabs, query editor, results grid, history), the file explorer (tree, tabs, viewer, git/diff/conflict/search/history), all modals (settings, shortcuts, statistics, system prompt, test runner, building config, WhatsApp, session search), the dashboard and flat views, commander grid and header, toolbox, spotlight, agent bar, unit panel, toasts, forms, and mobile layouts now all follow the active theme.
- **Embedded terminal ignored the theme** - the terminal was hardcoded to Dracula regardless of your selection; it now matches the active theme (background, text, and ANSI colors) and repaints instantly when you switch themes, with no reload.
- **Text selection was theme-blind** - highlighting text now uses a soft per-theme tint instead of a single fixed color that clashed on warm and light-accent themes.

## [1.164.1] - 2026-07-14

### Changed
- **Working agents lead the dock** - the agent activity dock and the pinned agents row now list the agents working right now first, followed by the recently-active ones (previously recent led). The lane divider moves accordingly in both places, so it still marks the boundary between the two groups.

## [1.164.0] - 2026-07-14

### Added
- **Update via git pull** - dev checkouts (repo installs) now get an "Update (git pull)" button directly in the update banner, with running/success/failure states; conflicts and diverged branches are reported inline instead of silently failing, and the checkout is never left with conflict markers.
- **Recent agents in dock** - a new Settings control (General, shown when the dock is visible) sets how many recently-active agents the dock and pinned bar show alongside the ones working right now; defaults to 4, and 0 shows only working agents.

### Changed
- **Zoomable chat images** - inline chat image previews now open in the shared zoom/pan viewer (wheel, pinch and drag) instead of a static, fixed-size image.
- **WhatsApp image attachments** - images now open in that same zoomable viewer, with a `type · size` subtitle and a download button in the header; other media keep their existing preview.
- **Pinned bar chips** - unpinned agents render at full strength instead of dimmed, working ones show a slow green comet sweep around their dashed border in place of the avatar opacity pulse, and green lane dividers (matching the overview dock) now separate pinned, recent and working chips instead of a bare gap.

### Fixed
- **Scroll to bottom on agent click** - selecting an agent always lands the terminal at the newest output, including re-clicking the agent already on screen after scrolling up.
- **Dock recency order** - an agent that just stopped working now enters the recent lane at the front, where the most recent belongs, rather than queuing behind the agents already docked.

## [1.163.0] - 2026-07-14

### Added
- **Agent activity dock placement** - Settings → General → "Agent activity dock" now picks where the recent/working agent thumbnails live: the overview panel, the pinned agents row above the composer, or hidden entirely.
- **Active view for the agents row** - the pinned bar's mode button cycles All → Status → Area → Active, where Active narrows the row to pins that are working or were active in the last 10 minutes.
- **Runtime filter in the agent overview** - filter the agent list by runtime (Claude / Codex / OpenCode / Grok); shown only when more than one runtime is in use, and the selection persists.
- **Pin straight from the agents row** - right-click an unpinned working/recently-active chip to pin it; right-click still unpins a pin.

### Changed
- **Mid-run message queue moved to the server** - messages sent while an agent is busy are now queued by the server and delivered the moment the turn ends, whether or not a browser is open. The queue bar shows the same queue on every device and survives reloads; queues left in older builds migrate automatically on first open.
- **"Send now" keeps the session alive** - on Codex app-server and OpenCode serve, forcing a queued message interrupts the running turn in place instead of killing and respawning the agent, so the thread/session and the other queued messages survive.
- **Queued-message feedback for streaming backends** - mid-run messages to Codex app-server / OpenCode serve now show the queued chip and system line like the other backends, instead of queueing invisibly.
- **Pinned agents row** - chips are icon-only by default, hold your manual pin order instead of reshuffling by recency, glide to their new slot rather than teleporting, and the row itself is more compact.
- **Overview areas start collapsed** - every page load opens with all areas collapsed instead of all expanded.
- **Dock ordering ignores clicks** - merely opening an agent no longer counts as activity, so the dock and pinned row stop reshuffling under the cursor; working thumbnails also hold their slot across the brief gaps between tool calls instead of flickering out and back.

### Fixed
- **Interrupt noise** - "Send now" no longer leaves a bogus "Aborted" error or an "(Empty response: …)" dump in the chat.
- **Codex command output on tool cards** - Bash/Read/Grep results attach to their card live instead of reading "No output captured" until a history reload.
- **Files-only searches** - `rg -l` / `grep -l` / files_with_matches results now list the matching files instead of showing "No captured matches", and the header counts files rather than matches.
- **Single-file grep attribution** - matches from a search scoped to one file now resolve to that file and open it at the right line.
- **Claude weekly usage gauges** - per-model weekly allowances (Opus / Fable) are read from the endpoint's `limits` array, restoring gauges that had gone blank.

## [1.162.0] - 2026-07-14

### Added
- **Codex usage gauges** - the Context/Usage modal now works for Codex agents, showing the account's native daily and weekly usage limits (utilization percentage and reset time) read from the Codex app-server, with a "Codex Usage" title and a graceful error state when the limits can't be fetched.
- **Inline Codex generated images** - images produced by Codex's image-generation tool now render as a clickable inline preview (opening in the full image viewer) in both the live activity view and reloaded history, instead of a wall of base64 JSON; the PNG is validated and saved to the server's uploads directory.
- **Agent activity dock** - the agent overview panel gains a bottom dock that surfaces currently-working and recently-active agents as clickable thumbnails (provider badge, unread-output dot, hover tooltips) so you can jump straight to a busy agent; it animates entries in/out, reorders smoothly, and can be collapsed (the choice is remembered).
- **Live working indicators** - area groups now show an animated "working" badge with a count whenever any agent inside them is running — in both the agent-overview headers and the flat-view map cards (which gain a subtle pulse) — and individual working/compacting agent cards get a refreshed animated-bars indicator and aurora glow.

### Changed
- **Flat-map area order** - area groups on the flat-view map now appear in a stable alphabetical order (Unassigned included) instead of mirroring their scene positions, giving a predictable reading order.

### Fixed
- **Grep results appear live** - Grep activity cards become clickable and open their match list (each match a clickable file:line link) as soon as the search finishes, instead of only after history reload. Result parsing is also more robust: native Claude Grep output, single-file-scoped results, context-flag separators, ANSI color codes, and rg/grep commands with valued options (`-C`, `--glob`, `-e`, etc.) are now handled correctly.

## [1.161.0] - 2026-07-14

### Added
- **Zoom & pan image previews** - image previews in the file viewer (both the modal and the file-explorer panel) now support wheel/trackpad zoom, touch pinch-zoom, drag-to-pan, on-screen zoom in/out controls, a live zoom-percentage readout, and double-click to reset.
- **File downloads in the mobile app** - downloading a file (text, image, PDF, or binary) from the file viewer now works in the Android app: files are fetched from the authenticated server route and saved to Downloads/Tide Commander via a native plugin (the WebView previously ignored blob-URL anchor downloads, so nothing was saved). Desktop/web downloads are unchanged.
- **Claude account session keepalive** - while Tide Commander is running, every saved Claude OAuth account is refreshed shortly before its access token expires. Rotated access/refresh tokens and renewed refresh-token expiries are written atomically to every profile copy that shares the grant, keeping dormant accounts signed in without generating model traffic. Set `CLAUDE_CREDENTIAL_KEEPALIVE=0` to disable if another process owns token rotation.
- **Fable usage gauges** - Claude account cards, the Context/Usage modal, and plan-limit tooltips now show the CLI's weekly Fable allowance, including the empty 0% state when Anthropic returns no active window. Tide accepts both the current legacy `seven_day_sonnet` API field and a future `seven_day_fable` field.

### Changed
- **Readable MCP tool cards** - MCP tool activity now renders with a friendly "MCP · server · tool" label and a key argument (query/url/path/file/document/script) instead of a raw `mcp__…` id, across both the live activity view and reloaded history.
- **Compact Codex MCP & web-search cards** - Codex agents' MCP tool calls and web searches now appear as compact activity cards with server/tool labels and readable (truncated) output in both the live view and reloaded history, instead of dumping multi-kilobyte raw JSON for every completed call.

## [1.160.0] - 2026-07-13

### Added
- **Fork Codex agents** - forking a Codex agent now continues its conversation history in the new agent, matching Claude/OpenCode/Grok, instead of degrading to a plain fresh-session clone. The fork's first turn runs through the Codex app-server's `thread/fork` (even when normal turns use `codex exec`), then later turns resume the new thread normally. If the fork can't be performed (e.g. an older Codex without `thread/fork`), the agent surfaces an error and stays retryable instead of silently starting an empty conversation.

## [1.159.3] - 2026-07-13

### Fixed
- **Agents silently failing to start after a reboot (tmux mode)** - when the commander was launched from inside a tmux pane (e.g. pm2 started from an agent's own session, with `pm2 save` baking that environment into the process definition), it inherited a stale `TMUX=<socket>` variable. tmux takes its socket path from `$TMUX` when set and, unlike its default path, will not create the parent directory for it — so once a reboot wiped `/tmp`, every `tmux new-session` failed with `error creating /tmp/tmux-<uid>/default` while still exiting 0. The session never started, the agent's output log stayed empty, and the watchdog later misreported it as a crashed process. `TMUX`/`TMUX_PANE` are now stripped from every tmux invocation, so tmux computes its own socket path and creates the directory as needed. tmux's stderr is also captured instead of discarded: a failed `new-session` now logs the real error and reports a spawn failure, rather than going silent and surfacing minutes later as a bogus agent death.

## [1.159.2] - 2026-07-13

### Fixed
- **Self-update restart race under PM2/systemd/docker** - when the server runs under a process supervisor, a successful self-update now simply exits and lets the supervisor restart into the freshly-installed build, instead of spawning its own detached relauncher that raced the supervisor for the port. Previously the loser of that race died with `EADDRINUSE` and — in containers whose PID 1 doesn't reap children — could linger as a zombie that tripped the next boot's port guard, causing a multi-day crash loop. Standalone installs keep the detached relauncher; set `TIDE_COMMANDER_SUPERVISED=1` to opt other auto-restarting supervisors into the exit-and-be-restarted behavior. (Foreground runs are not treated as supervised.)

## [1.159.1] - 2026-07-13

### Fixed
- **Startup crash-loop on zombie launcher (containers)** - the server's is-it-already-running check now treats a zombie process (exited but not yet reaped) as dead by inspecting `/proc/<pid>/stat`, instead of trusting a bare signal probe that a zombie still passes. In containers whose PID 1 doesn't reap children, an unreaped launcher was mistaken for a live server, so the startup guard waited on it forever and the launch crash-looped; it now starts cleanly. Non-Linux hosts fall back to the signal probe.

## [1.159.0] - 2026-07-13

### Added
- **Computer Use skill** - a new opt-in built-in skill that lets an agent inspect and control the local Linux desktop (list windows/apps, read accessibility trees, capture screenshots, focus/move/resize windows, click, drag, type, press keys, and run semantic accessibility actions) via the `tide-computer-use-linux` CLI. Disabled by default; enable it per agent or class.
- **Collapse all areas** - a new button in the agent overview collapses every area group at once.

### Changed
- **Semantic command cards** - native Bash read/search commands (`sed`, `cat`, `head`, `tail`, `rg`, `grep`) now render as Read or Grep cards with clickable file chips and line-range detail (e.g. "lines 1–55"), matching the Codex exec cards, instead of showing the raw command line.
- **Compact tool rows in history** - Read, Edit, and Bash entries in scrollback collapse to a single line with a clickable filename chip that opens the file or diff modal, replacing the older two-line input blocks.
- **Agent identity in history** - past messages show the agent's own avatar and name rather than a generic provider logo and label.
- **All touched files shown** - command cards list every affected file as a chip instead of capping at two with a "+N" badge.
- **Recent-first pinned agents** - in the status-grouped pinned agents bar, the most recently active agents sort first within each group.
- **Alphabetical area groups** - agent-overview area groups order A–Z with the Unassigned group trailing.

### Fixed
- **Duplicate command cards** - Codex sessions that persist both an exec wrapper and its native command/edit twin now render a single semantic card instead of two overlapping ones, and the legacy duplicate Edit/Read input card no longer appears alongside the primary tool row.

## [1.158.1] - 2026-07-12

### Fixed
- **Codex edit diffs now render** - clicking a Codex Edit activity card (or its file chip) now shows the real before/after diff: the file viewer understands Codex's `*** Begin Patch` / `*** Update/Add/Delete File:` apply_patch format and reconstructs the original content, and a multi-file patch opens just the clicked file's section instead of failing to resolve the diff.

## [1.158.0] - 2026-07-12

### Added
- **Codex Grep results modal** - clicking a Codex Grep/search activity card now opens a modal that lists the matches grouped by file, with the search query highlighted in each line and match/file counts up top; click any match (or a file name) to jump straight to that line in the file viewer.

### Fixed
- **Codex read/grep card misclassification** - a file read whose path contains "grep" (e.g. `sed -n … GrepPanel.tsx`) is no longer shown as a Grep card — reads are now classified before grep. Shell wrappers (`zsh`/`bash`/`sh -lc` and surrounding quotes) are unwrapped more reliably, and a single command reading multiple line ranges now renders as one "N ranges" Read card.

## [1.157.1] - 2026-07-12

### Changed
- **Richer Codex activity cards** - Codex Bash/command cards now open the full command and its output in a modal when clicked, Edit cards' file chips are individually clickable to open that file's diff, and multi-step shell commands get a readable summary (e.g. "3 steps · build → tests → lint") with tool-aware labels for type-check/build/lint/test steps. Codex `wait` orchestration steps render as a compact card.

### Fixed
- **Edit cards misclassified as command runs** - a Codex `apply_patch` whose patch body contains tool-call text (e.g. `tools.exec_command(`) is now detected as the outer Edit operation instead of being turned into a misleading mixed command card.

## [1.157.0] - 2026-07-12

### Added
- **Codex activity cards** - Codex `exec` orchestration steps now render as familiar Read/Edit/Grep/Glob/Bash/WebSearch-style activity cards (matching icon + one-line summary) in both the live terminal and history, instead of opaque `exec` blobs. Each card expands to reveal the full command and its result, and clicking an edit or read card opens the file's diff or jumps straight to the referenced lines in the file viewer.
- **Auto-rebuilt UI bundle (dev checkouts)** - a self-hosted/git-checkout server now rebuilds its served web bundle in the background whenever the UI source is newer than the last build, so phones pull the fresh interface over OTA without a manual release build. A new `dev` flag lets those same-version bundle updates reach phones still running APK-bundled assets.

### Changed
- **Compact Flat mode mobile header** - reduced the Flat chat header's mobile-only padding and avatar footprint while preserving the Android safe-area inset, leaving more vertical room for conversation content on phones.
- **Useful Flat map on mobile** - replaced the squeezed desktop-spatial grid with a readable two-column area browser: cards retain their broad map order without empty cells, area names/logos/counts stay visible, the sticky header keeps the safe-area-aware view switcher and live summary in reach, and an expanded area spans the full width with touch-sized agent, folder, and building controls.
- **Streaming agent modes back to opt-in** - the Codex app-server and OpenCode `serve` word-by-word streaming modes are experimental again and default OFF until further hardened (reversing the 1.155.0 default-on rollout); enable either per preference in Settings.

### Fixed
- **OpenCode streaming glitches** - in OpenCode streaming (`serve`) mode, the agent no longer echoes your own prompt back as an assistant message, and reasoning-model thinking no longer renders twice (once as a streamed text row and once as a thinking row).

## [1.156.0] - 2026-07-12

### Added
- **Mobile chat actions sheet** - on phones, the chat header's action cluster (search, git changes, buildings, debug, clear/collapse context, clear subordinates, remove agent) now lives in a thumb-reachable bottom sheet opened by a new "Actions" button in the bottom nav, instead of being crammed into the top-right corner. The sheet slides up above the bottom nav, closes on Escape / Android-back / backdrop tap, and desktop keeps its inline header cluster unchanged.

## [1.155.0] - 2026-07-12

### Added
- **OpenCode streaming (serve) mode** - OpenCode agents can run through a persistent `opencode serve` (SSE) process so replies type out word-by-word instead of landing as one block. The server runs detached and survives commander restarts (in-flight turns keep running and auto-reconnect), reuses the existing OpenCode event parser, and a per-launch router picks run-vs-serve; changing the Settings toggle applies to new turns with no server restart needed. Mirrors the Codex app-server streaming mode.

### Changed
- **Streaming is on by default for Codex and OpenCode** - the Codex app-server and OpenCode serve streaming modes are now enabled by default (both toggles default on) instead of being opt-in experimental toggles, so Codex and OpenCode replies stream word-by-word out of the box with restart survival. Turn either off in Settings if you prefer whole-message delivery.

## [1.154.0] - 2026-07-12

### Added
- **Grok & Codex account switching** - new "Grok Accounts" and "Codex Accounts" settings sections with the same switcher UX as Claude: list saved account profiles, switch the active account when rate-limited, and save/rename/delete named profiles (optionally stashing the current login first). Each row shows email, plan label, and token expiry; tokens never leave the server.
- **Per-account Claude usage gauges** - the Claude Accounts switcher now shows session (5h), weekly, and Opus-weekly rate-limit gauges for each stored account, transparently refreshing dormant tokens so limits stay visible even for accounts that haven't run in days.
- **Codex streaming (app-server) mode** - a new experimental Settings toggle runs Codex agents through a persistent `codex app-server` process so replies type out word-by-word instead of landing as one block. The daemon runs detached and survives commander restarts (in-flight turns keep running and auto-reconnect); the toggle applies to new turns with no server restart needed.
- **Low Power mode** - a new Settings toggle (mobile battery saver) hard-caps the 3D scene to 20 FPS active / 5 idle, freezes decorative CSS animations (status pulses, shimmers, spinners, avatar sway), and disables word-by-word text streaming.

### Changed
- **Mobile UI pass** - touch targets across the app lifted to comfortable tap sizes, text inputs bumped to 16px so iOS Safari stops auto-zooming on focus, agent header action icons wrap to their own full-width row, the chat header shows a two-line model/harness subtitle, and Spotlight adapts to touch (hides keyboard-shortcut hints, swipeable category tabs).
- **Localization** - added translations for the new Grok/Codex account sections and usage-gauge labels across the supported languages.

### Fixed
- **Android UI update delivery** - the APK now retries its first web-bundle check with backoff and re-checks each time the app returns to the foreground (throttled), so phones pick up new UI releases within minutes instead of potentially waiting up to an hour on the old interface.

## [1.153.0] - 2026-07-11

### Added
- **Claude account switcher** - manage multiple Claude Code OAuth profiles (`~/.claude/.credentials.json` plus named copies like `.credentials.david.json`) from Settings → Claude Accounts and from the Context / Usage modal. Switch the active account when rate-limited, save the current account under a name, rename, or delete named profiles — without manually renaming files. Tokens never leave the server.

## [1.152.0] - 2026-07-11

### Added
- **UI over-the-air sync (Android)** - the app can pull the web UI bundle from the connected server and run it directly, so UI-only updates arrive without reinstalling the APK. Runs an hourly auto-sync with a transient "Updating UI from server…" progress banner, and safely rolls back to the APK's bundled UI if a synced bundle fails to boot.
- **UI over-the-air controls in About (Android)** - a new "UI over-the-air" panel shows the current UI source (bundled vs. synced) and the APK/server bundle versions, with an auto-sync toggle, a "Sync UI now" button, and "Reset to bundled UI".
- **Swipe-to-dismiss toasts** - generic toasts and WhatsApp message toasts can now be swiped away on mobile, matching agent-notification toasts (shared `useSwipeToDismiss` hook).

### Fixed
- **Reliable swipe-to-dismiss on mobile** - notification and toast entrance animations no longer fight the swipe gesture (they now fade in via opacity only), so a swipe-to-dismiss tracks your finger and commits reliably instead of intermittently snapping back.

## [1.151.2] - 2026-07-11

### Changed
- **Working agent avatar animation** - the busy agent avatar (terminal header and flat-view header) now does a soft bounce instead of the previous glow-and-pulse-ring, and always animates while the agent is working so the live-activity cue reads clearly. The header gained a little top room so the bounce isn't clipped.

### Fixed
- **Reduced-motion made the working cue look broken** - the avatar working indicator no longer disables itself under `prefers-reduced-motion`, which previously left only a static cyan border that read as a glitch; the bounce is a deliberate live-status signal.

## [1.151.1] - 2026-07-11

### Added
- **Agent avatar working indicator** - the agent avatar in the terminal header and flat-view header now gently breathes and glows while the agent is working, giving an at-a-glance busy cue (respects `prefers-reduced-motion`).

### Changed
- **Clearer update controls in the app** - on the native (APK) app, the About screen's npm-based "Auto-update" and "Automatic updates" controls are retitled "Server auto-update" so they aren't confused with the in-app APK updater, and their non-actionable variants (dev mode, non-npm global, unsupported install) are hidden on the phone where they were pure noise.

## [1.151.0] - 2026-07-11

### Added
- **In-app APK updates (Android)** - store-less Android builds now update in-app: a new dismissible banner (and the Settings → About screen) downloads the APK natively with a live progress bar and hands it to the system installer in one confirmation tap, instead of bouncing out to the browser. Release info is checked through the server so it works behind carrier NAT, with an automatic browser-download fallback for older builds that lack the native plugin.
- **Send now (interrupt current work)** - queued messages for Grok, Codex, and OpenCode agents get a "Send now (interrupt current work)" action that stops the running turn and delivers the prompt immediately.

### Changed
- **Mid-run messages queue instead of interrupting** - sending a prompt to a busy Grok, Codex, or OpenCode agent now queues it and auto-delivers when the agent becomes free, rather than cutting off the current turn; the queue bar explains this and Grok now follows the same flow as the other backends.
- **Working-input border** - the busy terminal input shows an animated full-perimeter gradient glow instead of the single bottom shimmer bar, making the working state easier to spot at a glance.
- **Mobile toasts** - notifications now span full width edge-to-edge and respect the device safe-area inset on phones.

### Fixed
- **Thinking blocks stay open while reading** - a live reasoning block no longer snaps shut when the stream settles into a tool call or the next message, and its expanded/collapsed state now survives scrolling through long transcripts.
- **In-app updater no longer loops** - release APKs now embed the correct version (the Android versionName/versionCode derive from package.json and the APK is built after the version bump), so freshly-updated phones stop immediately reporting themselves as outdated.

## [1.150.6] - 2026-07-11

### Changed
- **Swipe-to-switch-agent feel** - mobile agent swipe now commits on a fast flick even below the distance threshold, plays an entrance slide as the incoming agent settles in from the side it arrives from, and gives a light haptic tick the moment the arm indicator appears (a visible indicator now always means "release will switch").

### Fixed
- **Swipe vs horizontal scroll** - a swipe that starts on a wide code block already at its scroll edge is no longer eaten by the scroll container; the gesture only yields to ancestors that can actually scroll further in that direction, decided on the first directional move.
- **Multi-touch and rotation robustness** - the gesture tracks a single touch by id, yields cleanly when a second finger lands, and re-checks the mobile layout per gesture so rotating or resizing while mounted never leaves stale bindings; committed horizontal drags no longer cancel on natural vertical thumb-arc.

## [1.150.5] - 2026-07-11

### Fixed
- **View jumping while you read scrolled-up** - the output list now follows the stream only when the viewport sits at the very bottom, enforced by a write-time position gate that is immune to state-machine races: the moment you scroll up even a few pixels, the next auto-scroll write is refused. Re-arming happens only at the very bottom (was a 150px zone that re-armed while you were still reading just above the stream).
- **History refresh yanking the viewport** - a mid-turn session refresh no longer swaps live rows for their persisted twins under your reading point; the applied history is held frozen while you read scrolled-up and lands when you return to the bottom, send a message, or switch agents (a prepended older page still applies immediately).
- **Streaming growth dragging the view down** - anchor corrections are skipped for the last row while you read scrolled-up, so a large streaming response growing at its bottom no longer pulls the viewport with it.
- **Sending your own message** - sending now explicitly pins the view to the bottom, since the sticky-bottom write gate would otherwise refuse the jump while the viewport is up.

## [1.150.4] - 2026-07-11

### Fixed
- **Duplicate thinking/reasoning blocks** - a reasoning block no longer renders twice (once as the live streamed row, once as the reloaded `[thinking]` history entry). Live thinking rows and persisted reasoning entries never share a uuid, so they now dedupe by normalized content within a wide window, tolerating whitespace differences between the streamed chunks and the joined history summary.

## [1.150.3] - 2026-07-11

### Fixed
- **Can't scroll up during word streaming** - a genuine upward scroll now disarms auto-follow as soon as you move more than a few pixels off the bottom, instead of requiring 150px. The old dead zone re-classified each wheel tick as "at bottom" and the next streamed chunk yanked the view back down before a second tick could land, making it impossible to scroll up while an agent was typing.
- **View jumping to bottom mid-stream** - removed a second per-chunk scroll writer in the terminal pane that raced the virtualized list's auto-scroll; the view no longer gets pulled back down after you scroll up. Auto-scroll now has a single owner (VirtualizedOutputList).

## [1.150.2] - 2026-07-10

### Fixed
- **Concurrent-agent stream corruption** - Claude, Codex, Grok, and OpenCode backends now key their per-turn parser state (stream uuids, accumulated text, working dir) by `agentId`. A single backend instance serves every agent of a provider, so two agents streaming at once no longer reset each other's stream state — no more dropped deltas, stuck streaming rows, or duplicate final bubbles.
- **Re-fading rows on scroll** - the complete-block fade is gated to once per row per page session, so scrolling a virtualized output list (or an agent switch remount) keeps settled rows static instead of replaying the fade.

### Changed
- **Live markdown streaming performance** - streamed markdown is split into a stable head (completed paragraphs, parsed once and memoized) and a live tail (only the current paragraph re-parses per chunk), replacing the O(n²) full-buffer re-parse that was the top CPU sink while agents type.
- **Stream settle animation** - the complete-block fade uses a pure CSS animation with no forced reflow, so a wave of rows mounting on agent switch or scroll no longer layout-thrashes.

## [1.150.1] - 2026-07-10

### Changed
- **Live stream markdown** - streaming assistant/thinking text re-renders through the markdown pipeline as chunks arrive, instead of showing raw markup mid-stream.
- **Stream settle polish** - soft block fade for finalized content that never word-streamed; thinking cards stop the caret when the agent goes idle.

### Fixed
- **Stuck streaming rows** - open thinking/text streams settle when a tool card arrives, a new stream uuid starts, or the agent returns to idle (missed Grok finalize races no longer leave a permanent caret and raw markdown).
- **History thinking cards** - history rows with a `[thinking]` prefix render the shared ThinkingBlock instead of plain assistant markdown.

## [1.150.0] - 2026-07-11

### Added
- **Word-by-word streaming** - optional live text/thinking fade-in for Claude and Grok replies (`StreamFadeText`), with a Settings toggle to disable and only show complete messages.
- **Tool chip enter motion** - tool invocation chips animate in as they appear in the Guake terminal.
- **Grok plan usage gauges** - weekly/monthly (and pay-as-you-go) limits from the Grok billing API, shown in the usage panel alongside token context usage.
- **Cross-provider stream fidelity** - richer JSON event parsing for Codex, OpenCode, and Grok (tool results, bash stdout upgrades, TodoWrite races, thinking/content deltas).

### Changed
- **Guake output virtualization** - smoother streaming updates while lists stay virtualized.
- **Claude backend prompt/event path** - more complete streaming and usage plumbing for live terminal rendering.

### Fixed
- **Grok tool timing races** - session watcher upgrades early tool chips when `tool_completed` arrives before full chat_history content.
- **Provider usage titles** - Grok usage panel uses Grok-specific labels and credit limit copy.

## [1.149.0] - 2026-07-10

### Added
- **Grok provider** - full fourth CLI runtime alongside Claude, Codex, and OpenCode: `GrokBackend`, streaming-json event parser, session watcher (tools, usage, thinking), and runtime provider registration.
- **Grok agent model/effort options** - spawn, edit, and bulk-manage flows support Grok models and reasoning effort; provider icons/labels across agent bars, unit panel, dashboard, and terminal.
- **Thinking blocks in Guake** - expandable thinking cards instead of flat `Grok [thinking]…` text lines.
- **Richer tool cards** - improved ListFiles, task-output wait, and related tool renderers with clearer parameter and result display.
- **Todo list merge** - TodoWrite history merges by task `id` so updates keep prior content instead of rendering empty lists.

### Changed
- **Spawn / edit agent modals** - wider layout, clearer section hierarchy, and improved class/skills spacing (including mobile).
- **Guake tool output** - provider-aware history loading, better empty-state handling for Bash/`{}` early events, and READ tools that surface `target_file` when path params were missing.
- **Grok token usage** - context/token counts from the Grok session watcher now flow into the terminal header usage UI.

### Fixed
- **Runtime service tests** - mock includes `createGrokRuntimeProvider` so detached/codex runtime tests stay green with the new provider.

## [1.148.0] - 2026-07-10

### Added
- **Inline Bash outputs** - terminal Bash rows now include a toggle to show captured command output inline below the command, with localized labels and persisted settings.

### Changed
- **Terminal and panel performance** - reduced broad store subscriptions and unstable render props across the terminal, dashboard, flat view, unit panel, toolbox, file explorer, modal, and log surfaces.
- **Output rendering performance** - memoized markdown rendering, coalesced output notifications, and added narrower selectors for streaming logs, session history, file explorer state, and related UI state.

## [1.147.1] - 2026-07-09

### Changed
- **Keyboard shortcut defaults** - Ctrl+K now opens Spotlight, Commander View stays on Tab by default, and the Commander shortcut remains rebindable in Settings.

## [1.147.0] - 2026-07-09

### Added
- **Slack socket reconciler** - Socket Mode can now run a background polling reconciler to recover messages missed during disconnects, ping-timeout flaps, or process restarts while deduplicating by `(channel, ts)`.
- **Slack thread sweep registry** - polling now tracks active Slack threads with per-thread watermarks, seeds recent activity from SQLite on startup, and keeps replies on older thread parents visible.
- **Slack message lookup migration** - added an index-backed `(channel_id, ts)` lookup path for fast reconciler dedup checks.

### Changed
- **Slack integration state** - integration context now exposes Slack message existence and recent thread activity queries for the reconciler and startup seeding flow.
- **Slack configuration** - added the `socketReconcileEnabled` setting and localized configuration copy for the hybrid Socket Mode + polling behavior.

## [1.146.0] - 2026-07-09

### Added
- **Transfer Connect remote log skill** - added a reusable skill guide for inspecting Transfer Connect core and FEC proxy logs through the Tide SSH bastion.

### Changed
- **Codex model defaults** - updated Codex agent creation, editing, bulk management, terminal labels, docs, and tests to use the GPT-5.6 Luna/Terra/Sol model set, with Luna as the default fallback.

## [1.145.1] - 2026-07-09

### Fixed
- **WebSocket liveness with older servers** - the client now detects when a backend does not support ping/pong and avoids repeatedly killing an otherwise healthy connection during version skew.

## [1.145.0] - 2026-07-09

### Added
- **Automatic update scheduler** - Settings now includes an opt-in unattended update toggle that checks npm periodically, installs updates only when agents are idle, and defers restarts while work is active.

### Changed
- Self-update locking is now shared between manual updates and the unattended scheduler so only one update can run at a time.

## [1.144.1] - 2026-07-09

### Fixed
- **Self-update completion recovery** - the update UI now detects stalled install streams and verifies the real server state instead of staying stuck on "Installing update...".
- **WebSocket heartbeat under hot reload** - liveness tracking now survives Vite HMR without killing a healthy socket in a repeated "Connection Stale" loop.

## [1.144.0] - 2026-07-09

### Added
- **Resume into last active agent** - on a fresh app or web load, Tide Commander now opens the most recently active agent so the terminal is immediately visible without manually reselecting it.

## [1.143.2] - 2026-07-09

### Fixed
- **App resume reconnect grace** - reopening Tide Commander while disconnected now restarts the reconnect grace window, keeping the small reconnecting toast visible before showing the full disconnected overlay.

## [1.143.1] - 2026-07-09

### Changed
- **Connection recovery grace** - the disconnected overlay now waits 15 seconds before replacing the reconnecting toast, giving short mobile network handoffs more room to recover.

### Fixed
- **Welcome modal persistence** - dismissing onboarding now persists across browser sessions, and creating an agent permanently suppresses the empty-state onboarding modal even if all agents are later removed.

## [1.143.0] - 2026-07-09

### Added
- **Optimistic prompt echo** — your message now paints in the terminal the instant you send it, instead of waiting for the server's confirmation broadcast. On a flaky or zombie mobile socket that round-trip could take minutes and made the send look lost; the echo is reconciled (and adopts the server's canonical text) once the real `command_started` arrives, resolving multiple in-flight prompts in order.
- **Zombie-socket heartbeat detection** — the client now proves its WebSocket is actually alive with an application-level ping/liveness probe (heartbeat every 25s while visible, plus on tab-focus / network-back / app-resume). Mobile doze, WiFi↔cellular switches, and NAT timeouts can silently kill the TCP while the socket still reports OPEN; such dead sockets are now discarded immediately and the reconnect path (resync + history refetch) takes over, instead of the terminal freezing until the next agent switch.

### Fixed
- **Stale socket after short background** — resuming from a brief background no longer trusts `readyState === OPEN` (which is exactly what a zombie socket reports); the connection is verified and caught up over HTTP on resume.

## [1.142.1] - 2026-07-08

### Fixed
- **Reliable server start & auto-restart** — the CLI now waits for the server to actually accept connections on its port before reporting success, instead of a fixed 700ms grace. This catches background starts that silently died on `EADDRINUSE` seconds into boot (which used to print "Started in background" then leave a stale PID file).
- **Post-update restart no longer races itself** — the relauncher is pinned to the exact process it must replace via a new internal `--replace-pid` flag, rather than trusting a PID file that can be clobbered by a failed duplicate start. Restart also escalates to SIGKILL if the old server won't stop, and waits for the port to be free before spawning.
- **Self-healing stale PID file** — `stop`/`status` now detect when the tracked PID is gone but a server is still listening on the last known port, recover the real PID (Linux, via `/proc`), and rewrite the PID/meta files instead of falsely reporting "stopped".

## [1.142.0] - 2026-07-08

### Added
- **Dockable building surfaces** — dockable buildings (terminal, PM2 logs, database, tests, HTTP requests) can now open either as a compact bottom dock panel or as their full modal. Each building remembers how it was last opened (per-building view-mode preference) and reopens that way; minimize/maximize buttons switch between the two.
- **Draggable split pane** — the tests and HTTP request browsers get a draggable divider between the request/list pane and the detail pane, with the split position persisted (one percentage works for both the wide modal and the compact docked panel).

### Changed
- Reworked the tests and HTTP request building modals and the bottom output panel to share the new split-pane and dock/modal view infrastructure; added a docked PM2 log view.

## [1.141.0] - 2026-07-08

### Added
- **HTTP Requests building type** — a new `http` building that runs IntelliJ-style `.http`/`.rest` files. Point it at a folder, then browse every request, pick an environment from `http-client.env.json` / `http-client.private.env.json`, and fire requests individually or a whole file — status, time, size, headers and a pretty-printed body are shown per request. `{{variables}}` resolve server-side; no JDK or external CLI required. Includes a native `.http` parser, a dedicated skill, result cards, a copy-as-curl action, and inline run output in the terminal.
- **Guake current-task banner** — the terminal now shows a live banner with the agent's in-progress task while it works, bridged from the harness Task tool and TodoWrite updates.

## [1.140.0] - 2026-07-08

### Added
- **Post-update changelog notice** — after a self-update, a "Updated to vX" notice appears with a "View changelog" action that opens a changelog modal showing the release notes for the new version (with a link to view the full changelog on GitHub).

### Changed
- **Browser bridge no longer steals focus** — `POST /api/browser/tab/activate` now makes a tab the active tab of its window (enough for full-viewport screenshots) without pulling the user's OS focus away; pass `focusWindow: true` to also raise the window. `tab/open` now opens in the background by default (`active: true` to switch). Browser-control skill docs updated to match.

### Fixed
- **Image reference rendering** — agent output like `[Image: <caption/instruction>]` where the text is a caption rather than a real path is now rendered as text instead of a broken thumbnail. Added a helper to stream arbitrary on-disk image paths for inline preview.

## [1.139.2] - 2026-07-08

### Changed
- **Faster stuck-update escape hatch** — the update banner now surfaces the manual Reload / Recheck actions after 1 minute (down from 4) if an update stays in installing/reconnecting. The actions are non-destructive — the install continues server-side — so they can appear mid-install as a safety net without interrupting anything.

## [1.139.1] - 2026-07-08

### Fixed
- **Self-update permissions detection** — the server now checks whether the global install directory is writable and, when it is not, returns a clear "needs elevated permissions" error with a `sudo`-prefixed manual command instead of a generic failure. Auto-update is only offered when it can actually succeed without sudo.
- **Stuck-update escape hatch** — if a self-update sits in "installing/reconnecting" longer than expected (restart never took over), the update banner now surfaces manual Reload / Recheck actions so the UI can recover instead of spinning forever.

## [1.139.0] - 2026-07-08

### Added
- **Per-project file explorer scoping** — the file explorer now keeps its open tabs and expanded folders scoped to each project, so switching projects no longer mixes or corrupts state across them. Introduces a dedicated `useFileTree` hook and reworks the panel's persisted storage.

### Changed
- Update banner styling and behavior refinements.

## [1.138.0] - 2026-07-07

### Added
- **Global update banner with conscious restart** — a dismissible "New version available" banner now appears app-wide when an auto-updatable npm global install has an update. It offers an explicit "Update & restart" action that warns restarting will interrupt working agents, then shows install progress and reconnects automatically. Dismissal is per-version, so the banner reappears when a newer version ships. The server never restarts on its own — restart only happens from a conscious click.

### Changed
- Self-update logic extracted into a shared `useSelfUpdate` hook consumed by both the new update banner and the Settings → About panel, so the two stay in sync.

## [1.137.0] - 2026-07-07

### Added
- **Auto-restart after self-update** — after a successful `Update now`, the server now relaunches itself automatically (`tide-commander start --restart`) and the UI polls `/api/health` and reconnects on its own once the new server is up, instead of asking you to relaunch from the terminal. A new `--restart` CLI flag forces a clean restart of a running server reusing its current config.

### Changed
- Update confirmation and success messaging now reflect the automatic restart/reconnect flow.

## [1.136.2] - 2026-07-07

### Fixed
- **File viewer resolution** — improved how the file viewer resolves and displays file paths.

## [1.136.1] - 2026-07-07

### Fixed
- **Background Task/Agent runs no longer make parent agents look idle too early** — async launch stubs are now tracked until task notifications arrive, slow background work keeps the activity clock fresh, and stale `working` status is reconciled if a completed turn goes silent.

## [1.136.0] - 2026-07-06

### Added
- **Agent context menu on the terminal header** — right-clicking the agent title in the guake terminal header now opens the full agent menu (Edit / Clear context / Clone / Fork / Delete), same as the overview panel's cards.

### Changed
- Agent right-click menu extracted into a shared `agentContextMenuActions.tsx` builder consumed by both the overview panel and the terminal header, so the two menus can never drift apart.

## [1.135.0] - 2026-07-06

### Added
- **In-terminal conversation search** — the Guake terminal search now has a dedicated results panel (`SearchResultsPanel`) backed by pure, unit-tested indexing helpers (`searchIndexing.ts`): ranked content results (multi-word AND matching, exact-phrase boosted, windowed snippets with match counts) and fuzzy-matched file results aggregating every file referenced in the conversation with per-file read/edit/write counts; results scroll-to-navigate the output list.
- **Post-collapse prompt for auto-collapse** — agents can define an `autoCollapsePrompt` that is sent after each scheduled auto-collapse fires; the prompt is read at fire time, so edits apply to the next collapse without re-arming the cron job.

### Changed
- **Subagent transcript watcher hardening** (`subagent-jsonl-watcher.ts`) — exact transcript binding via each subagent's `agent-<id>.meta.json` (with a newest-file fallback after a grace period), retries binding every second for up to 2 minutes, idle timeout raised 3→10 minutes and max watch duration 15→60 minutes (background agents routinely run 20–30 min), and re-armed watchers start at end-of-file so a subagent's history is never re-broadcast as duplicates.
- Agent edit modal and terminal theme/rendering refinements.

## [1.134.2] - 2026-07-05

### Fixed
- **Background history refreshes re-pinned the view mid-scroll** — `fetchingHistory` goes true on every background history refresh while the viewed agent streams, and each refresh unconditionally re-armed pin-to-bottom: the user's next scroll cancelled it, the next refresh re-pinned, producing a stutter loop for as long as the agent kept streaming. The pin is now only re-armed while the user is following the bottom; sending a command still pins as before.

## [1.134.1] - 2026-07-05

### Fixed
- **Scroll fights after switching agents** — scrolling up right after an agent switch (or while the pin-to-bottom loop was still settling) kept yanking the view back to the bottom, worst on mobile where slow row measurement keeps the pin alive longest. User scrolls are now detected by position instead of flags/timers: programmatic pin/settle writes always land AT the bottom and content growth never decreases `scrollTop`, so "moved up AND meaningfully above the bottom" can only be the user — such scrolls now cancel pin mode and disable auto-scroll immediately, ungated by the post-switch grace window (which still gates only the re-enable side at the bottom).

## [1.134.0] - 2026-07-04

### Added
- **Multi-backend failover hardening for the WebSocket connection** (`connection.ts`):
  - *Failback watch* — the URL prober is sticky, so a client that failed over to a secondary backend stayed there forever; while connected to anything but the top-priority URL, higher-priority candidates are now re-probed every 60s and the client switches back when one recovers.
  - *WS-handshake demotion* — a URL whose `/api/health` answers but whose `/ws` upgrade keeps failing (e.g. a proxy without WebSocket support) is demoted after 2 consecutive handshake failures (5-minute TTL) instead of being re-picked forever.
  - *Handshake timeout* — a socket stuck in CONNECTING is aborted after 10s (browsers can hang there long after a mobile network switch, blocking `connect()`).
  - *Connection generations* — a reconnect/park/unload now supersedes an in-flight connect run that is still probing, so an abandoned socket can never feed the store alongside its replacement.
- **Native Android socket failover** — the foreground service now keeps the full candidate URL list (JS-chosen active URL first, synced via `ServerConfigPlugin`) and rotates to the next candidate on connection failure, since the parked JS socket can't re-probe while the app is backgrounded (e.g. after leaving home Wi-Fi).

### Changed
- One "Disconnected" toast per offline episode instead of repeated toasts on every retry.

## [1.133.2] - 2026-07-04

### Fixed
- **Subagent Bash cards stuck on "running" forever** — the parent CLI stream never echoes subagent `tool_result` events (only `tool_use`), so subagent Bash cards in the terminal kept their spinner indefinitely. The subagent JSONL watcher (`subagent-jsonl-watcher.ts`) now parses full tool results (id → name attribution, output capped at 100k chars) and forwards Bash results immediately over WebSocket; the client pairs them to their card by exact uuid, with the positional look-ahead kept only as fallback for top-level Bash (whose result rows carry no uuid) — so parallel subagents' interleaved results never attach to the wrong card.
- **Scroll flicker/jump when loading older history** — after prepending older messages, the virtualizer's scroll offset is now synced in the same frame via a synchronous `scroll` event dispatch; previously the programmatic `scrollTop` change was observed 1–2 frames later (especially on mobile), rendering the wrong row window and skipping the built-in scroll correction, which pulled the view back as real row heights landed.

## [1.133.1] - 2026-07-04

### Fixed
- **Pinned-agents pill still overlapped the newest message in Flat mode** — the mobile pinned-agents bar pulls itself up 30px over the chat; the bottom-clearance rule for that pull now also applies in Flat view (the mobile terminal view already had its own higher-specificity rule), so the newest message no longer sits under the pill.

## [1.133.0] - 2026-07-04

### Added
- **Server-side git status watcher over WebSocket** — replaces per-client HTTP polling of `/api/files/git-status` and `/api/files/git-branch` with a server-side watcher (`git-watch-service.ts`) that polls the union of every connected client's watched directories once per cycle and pushes `git_status_update` only when a directory's status actually changed; clients declare interest via `git_watch`/`git_refresh` messages. New `GuakeGitPanel`/`useGitBranch`/`useBuildingGitStatus` consume it instead of polling directly.
- **Server-time handshake** — a `server_time` message is now sent once on connection so clients (notably mobile, prone to clock skew) can align client-stamped optimistic items against server-stamped outputs for correct ordering.

### Changed
- **Mobile background heat fix** — removed the permanent `PARTIAL_WAKE_LOCK` in `WebSocketForegroundService`, which kept the SoC from ever sleeping; the notification-repost checker interval was widened from 2s to 60s; the native background socket now connects with `?mode=notify` so the server skips the full broadcast firehose for it, and a cheap string pre-filter avoids JSON-parsing non-notification messages against older servers.
- Pinned-agents bar now publishes its live rendered height as a `--pinned-agents-bar-height` CSS var (via `ResizeObserver`) so the mobile chat reserves exactly enough scroll clearance regardless of miniature mode, grouping, or row count, replacing the fixed-height reservation from v1.132.0.

## [1.132.0] - 2026-07-04

### Added
- **Icon-only miniature mode for the pinned-agents bar** — past a configurable threshold (`localStorage`, default 6), pinned-agent chips collapse to icon-only miniatures to save horizontal space, with an accessible `aria-label` preserving the agent name. Threshold changes made elsewhere (devtools / a future Settings control) apply live via the cross-tab `storage` event.

### Changed
- **Mobile guake terminal input & scroll clearance** — the floating pinned-agents bar on mobile no longer overlaps chat content: the output area gets a `has-pinned-agents` class reserving extra bottom scroll clearance when agents are pinned, plus terminal input/mobile responsive SCSS tweaks.

## [1.131.0] - 2026-07-03

### Added
- **Selectable/copyable text in the PDF viewer** — `FileViewerModal`'s `pdf.js` viewer now renders a transparent `TextLayer` over each page's rasterized canvas, so PDF text can be selected and copied instead of only viewed.

### Changed
- **Sharper, responsive PDF rendering** — pages are rasterized at `devicePixelRatio` (capped at 3x) and fit to the container width (capped at 2.5x scale), fixing blurry/CSS-rescaled bitmaps; a debounced `ResizeObserver` + window-resize listener re-renders pages when the container width or DPR changes (container resize, browser zoom), instead of only rendering once on load.

## [1.130.0] - 2026-07-03

### Added
- **Global system prompt restored alongside per-agent** — the System Prompt modal's scope picker now includes an "All Agents (Global)" entry that edits a commander-wide prompt (stored server-side, injected into every agent's instructions before that agent's own per-agent prompt), coexisting with the existing per-agent `customPrompt` scope.

### Changed
- **Agent-switch crossfade replaces the deferred-value approach** — a new `useAgentSwitchFade` hook drives a bounded, `setTimeout`-based crossfade (30ms) for the terminal pane on both the 3D guake terminal and Flat view chat, instead of `useDeferredValue`: a deferred render can be starved by streaming store updates and freeze the outgoing conversation on screen with no feedback, whereas the timeout-bounded fade always completes.
- **Hover-prefetch for agent history** — hovering an agent in the pinned bar or overview panel now warms the history cache (`prefetchAgentHistory`) so clicking to switch renders the conversation on the first frame.
- **Server-side parsed-session cache** — `session-loader.ts` caches parsed session JSONL keyed by file path and invalidated on `(mtimeMs, size)` change (LRU, max 8 entries), so repeated `/history` requests and the internal double-parse for subagent references no longer re-parse multi-MB session files on every call. Also narrowed the file-stability wait to files modified within the last 300ms instead of unconditionally sleeping on every request.

## [1.129.2] - 2026-07-03

### Changed
- **Terminal pane remount is now interruptible** — the agent the terminal pane binds to is deferred via `useDeferredValue`, so opening the drawer or switching agents paints the drawer chrome first and remounts the heavy agent-keyed pane in a follow-up interruptible render instead of blocking the same frame. Reduced `VirtualizedOutputList` overscan from 25 to 10 rows to shrink the number of markdown-parsed rows mounted synchronously on open/switch.

## [1.129.1] - 2026-07-03

### Fixed
- **3D agent click picking** — small agents standing behind a large agent's oversized click hitbox were unclickable; `SceneRaycaster` now raycasts the precise model geometry first and only falls back to the forgiving hitbox cylinder, so the visible model under the cursor always wins.
- **Terminal panel remount freeze** — while the terminal drawer was collapsed, clicking agents on the 3D board re-bound the output panel to the live selection, remounting the whole agent-keyed pane (history load + enrichment memos) and causing a visible freeze per click; the panel now holds the last-shown agent while collapsed and only re-syncs when the drawer reopens.
- Click hitboxes are now rescaled to fit each agent's actual scaled model bounds (`AgentManager.refreshAgentBodyLayout`), instead of only repositioning the status bar.

## [1.129.0] - 2026-07-03

### Added
- **Clickable agent name in curl "send message" cards** — clicking the target agent's name in an `AgentMessageCard` (`CurlCard.tsx`) focuses and opens that agent, reusing the same selection path as clicking a pinned chip.

### Changed
- **3D scene performance** — agent meshes are now built in time-budgeted chunks across frames (`AgentManager.addAgentsStaggered`) instead of one blocking loop, so large fleets no longer freeze the main thread on load/sync; stale in-flight builds are invalidated by a newer sync or dispose. Name/status label sprite canvases shrunk from 4096×2560 to 1024×640 (~16x less GPU/CPU memory per agent) with resolution-aware font scaling, and removed the fixed `anisotropy` override. Dropped noisy per-agent `console.log` calls in `AgentManager`.

## [1.128.1] - 2026-07-02

### Fixed
- **Windows path mapping in File Explorer** — robust Windows-native + POSIX path handling in the File Explorer folder tree (`FileExplorerPanel/fileUtils.ts`, `useFileTree.ts`, `index.tsx`) and the server's file/folder routes (`routes/files.ts`, `routes/folders.ts`); no-op on Linux. Note: if the server itself runs under WSL/Linux with literal `C:\` paths configured, those paths still won't resolve on that filesystem — translating them to `/mnt/c/...` is out of scope for this fix.

## [1.128.0] - 2026-07-02

### Added
- **"Tests" building type** — new building kind that scans a configured folder for test classes/methods (`POST /api/tests/scan`) and browses them in `TestsBuildingModal`: search, run the whole suite/a single class/a single method, with live-streamed results (Gherkin step highlighting for BDD-style tests) and a jump to the full `TestRunnerModal` for deep dives.
- **Browser extension: React component picker** — picking an element on a React page now resolves the owning component from its Fiber and sends the component name, ancestor chain, and dev-build source `file:line` to the agent instead of raw DOM `outerHTML`; the CSS selector is still included so the agent can act on the element. Includes a more robust component-detection path.

### Changed
- Attachment chip rendering updated to show the resolved React component name/selector when available.

## [1.127.0] - 2026-07-02

### Added
- **Run Tests feature** — right-click a folder in the File Explorer to run `mvn test` (runner-agnostic detector) and view results in a parsed JUnit/Surefire tree modal. Backed by `GET/POST /api/tests/*` (async `runId`-based), a `run-tests` built-in skill, and inline test-result cards (`TestResultsCard`, `TestRunInline`) in the agent output stream alongside the full `TestRunnerModal`/`GlobalTestRunnerModal`.
- **Claude Sonnet 5 support** — new `claude-sonnet-5` model (released 2026-06-30) added to the model picker, CLI arg translation for headless and interactive Claude backends, and the LLM matcher's model map, with the `[1m]` 1M-context-window label.

## [1.126.0] - 2026-06-30

### Added
- **Full trigger-config editing for Slack, Email, Jira, and WhatsApp triggers** — the Edit Trigger modal previously only rendered type-specific config for Webhook, Bitbucket, and Cron triggers, so the structural match conditions for the other four types were invisible and uneditable. The modal now renders every type's matching fields: Slack (instance, channel, channel allowlist/exclude, user filter/exclude, message pattern, thread, DM/own-message toggles), Email (from filter, subject pattern, thread, required-approvals), Jira (project key, issue type, events, JQL, secret), and WhatsApp (from filter, direction, body pattern, session, group/DM/status toggles).
- **Slack trigger instance selector** — Slack triggers can now be scoped to a specific Slack instance (or "Any instance") via a dropdown populated from `GET /api/slack/instances`. The `instanceId`, `channelIdAllowlist`, and `excludeChannelIds` fields — already honored by the runtime handler — are now part of the shared `SlackTrigger` type and the edit UI.
- **@ file/folder mention in agent prompt input** — type `@` in the composer (web and browser extension) to mention files and folders with ranked search; folder mentions expand to directory structure and render as collapsible blocks in the chat UI.
- **@ agent mention** — tag other agents with `@` in the web composer and browser extension; `[@agent:id]` mentions expand into the referenced agent's context.

### Fixed
- `<file>`/`<folder>` mention blocks are now collapsed in the chat history view.
- Agent chip names now decode XML entities correctly.

## [1.125.1] - 2026-06-25

### Fixed
- **Body-parser errors now surface a useful response** — when `express.json()` rejects a malformed body, the global error handler in `app.ts` now returns `400 {"error":"Invalid JSON body: <parser message>"}` instead of an opaque `500 {"error":"Internal server error"}`; oversized bodies return `413` with the size limit message. Lets agents debug "my curl payload is wrong" from the response alone, without tailing server logs.

## [1.125.0] - 2026-06-25

### Added
- **Auto-collapse** — agents can now collapse (compact) their conversation context on a recurring cron schedule. Enable it per-agent in the Agent Edit modal with a 5-field cron expression and IANA timezone (presets: nightly 3am, every 6h, weekdays 2am). A new `auto-collapse-service.ts` arms one cron job per agent that runs the collapse (waiting for the agent to be idle if it's mid-task) — intended for unattended agents (Slack channels, log-supervising cronjobs) whose context grows indefinitely, so each day starts fresh. New `autoCollapse` / `autoCollapseCron` / `autoCollapseTz` fields on the agent model, persisted and plumbed through the `PATCH /api/agents/:id` route and the `update_agent_properties` WebSocket handler.

## [1.124.0] - 2026-06-24

### Added
- **Folder/git-repo search in Spotlight** — new "Folders" tab in Spotlight searches discoverable directories and git repos by name; results show the active branch for git repos and open the File Explorer rooted at that path. Backed by `GET /api/folders/search` (depth/result-capped, ignores `node_modules`/`dist`/etc.).
- **Agent fork** — "Fork Agent (with history)" context-menu action duplicates an agent's configuration and continues its conversation history (Claude/OpenCode providers); falls back to a plain clone for unsupported providers. `ForkAgentMessage` added to the WebSocket protocol.

### Changed
- Spotlight type weights rebalanced: agent → 6, building → 5, folder → 4, command → 3.
- `agent-handler.ts` refactored: shared `duplicateAgentConfig` helper extracts clone/fork common logic.

## [1.123.0] - 2026-06-23

### Added
- **Curl card rendering** — `CurlCard.tsx` and `curlParser.ts` parse and render curl commands from agent output as interactive cards; styled via `_curl-card.scss`.
- **New keyboard shortcuts** — `useKeyboardShortcuts.ts` extended with additional bindings.
- Browser extension `renderers.js` updated with new rendering support; `sidepanel.css` and `sidepanel.js` expanded.

### Changed
- `browser-control` skill updated with refined instructions.
- `docs/browser-bridge.md` expanded with additional documentation.

## [1.122.0] - 2026-06-23

### Added
- **`browser-control` built-in skill** — new skill gives agents a full API for reading and driving the live browser page (DOM, console, network, errors, screenshot, click, type, navigate, scroll) via the extension bridge.
- **`instruction-refresh` service** — new server service for refreshing agent instructions at runtime.
- **Browser bridge documentation** — `docs/browser-bridge.md` documents the full agent↔browser architecture.
- Browser extension content script massively expanded (+827 lines) with full DOM interaction, network interception, and error capture support.

### Changed
- Codex and OpenCode backends updated with additional handling.
- `browser.ts` routes extended with more endpoints.
- `skill-service.ts` wired to serve the new browser-control skill.

## [1.121.0] - 2026-06-22

### Added
- **Browser bridge: real-session control via `chrome.debugger`** — extension now uses the `debugger` permission to drive the user's actual Chrome session (click, type, navigate, scroll) without needing `--remote-debugging-port`. Chrome 136+ blocks the port approach on the default profile; this resolves that. CDP/puppeteer path kept as `/cdp/*` fallback for throwaway browser instances.
- **New browser bridge API routes** — `browser.ts` expanded with additional `/api/browser/*` endpoints for DOM read, console, network, errors, page info, and screenshot capture.
- **Extended WebSocket handler** — `handler.ts` updated to route browser events from the extension relay to agents.

### Changed
- Browser extension (`background.js`, `content.js`, `sidepanel.js`, `sidepanel.css`, `options.js`, `options.html`) significantly updated to support the debugger-based control flow and improved sidepanel UI.

## [1.120.3] - 2026-06-21

### Changed
- FlatView and guake terminal input style refinements (`FlatView.scss`, `_input.scss`).

## [1.120.2] - 2026-06-20

### Changed
- Guake terminal input style refinements (`_input.scss`).

## [1.120.1] - 2026-06-20

### Fixed
- **Mobile context bar** — `justify-content` changed to `center` so content is centered in the strip.
- **Pinned agents bar** — added `flex: none` to prevent height compression in the constrained terminal column; tightened chip padding on mobile now that the × badge is hidden.

## [1.120.0] - 2026-06-20

### Added
- **Agent↔browser bridge** — new `/api/browser/*` routes and `browser-bridge-service.ts` let agents read and drive the live browser page via the extension WebSocket relay (DOM, console, network, errors, screenshot) and CDP/puppeteer-core (click, type, navigate, scroll). Requires Chrome `--remote-debugging-port=9222`.
- **CDP service** — `cdp-service.ts` wraps puppeteer-core for programmatic browser control.
- **Browser WebSocket handler** — `browser-handler.ts` processes browser events forwarded by the extension over WebSocket.
- New WebSocket message types in `websocket-messages.ts` for browser bridge events.
- Browser extension (`background.js`, `content.js`, `sidepanel.js`) updated to support the bridge protocol.

## [1.119.1] - 2026-06-20

### Changed
- `PinnedAgentsBar.tsx` layout refinements.
- `_input.scss` guake terminal input style tweaks.

## [1.119.0] - 2026-06-20

### Added
- **Per-agent system prompt** — `SystemPromptModal` migrated from global to per-agent (`agent.customPrompt`); includes an agent picker and updated styles in `system-prompt-modal.scss`.
- **Plan limits tooltip** — new `PlanLimitsTooltip.tsx` component and `claude-usage-format.ts` utility surface Anthropic plan usage limits inline in FlatView.
- **Tooltip SCSS** — new `_tooltip.scss` with shared tooltip styling.
- **Browser extension major update** — sidepanel, background, renderers, options, and content scripts significantly expanded; new `package.sh` build script and `.gitignore`.
- **Extension context cards** — new `ExtensionContextCard.tsx` component and `_extension-context-cards.scss` render browser extension context inline in `HistoryLine` and `OutputLine`.

### Changed
- `claude-usage-service.ts` expanded with additional usage data aggregation.
- `browser-error-service.ts` updated with refined error handling.
- `agent-types.ts` and `agent-handler.ts` extended for per-agent custom prompt support.
- `PinnedAgentsBar.tsx` updated with layout improvements.
- `ContextViewModal.tsx` and `FlatView/index.tsx` updated to integrate plan limits display.

### Fixed
- Removed invalid `// eslint-disable-next-line react-hooks/exhaustive-deps` comments in `SystemPromptModal.tsx` (plugin not in ESLint config).

## [1.118.1] - 2026-06-19

### Changed
- **Browser extension sidepanel** — layout and style refinements to `sidepanel.html` and `sidepanel.css`.

## [1.118.0] - 2026-06-19

### Added
- **Pinned agents bar** — agents can now be pinned to a persistent quick-select bar (`PinnedAgentsBar.tsx`); pin/unpin button added to each `AgentBarItem` with a `usePinnedAgentIds` selector.
- **Browser extension** — initial `browser-extension/` module for capturing browser-side errors and events.
- **Browser error service** — `browser-error-service.ts` receives and stores browser errors forwarded from the extension.
- **New trigger routes** — `trigger-routes.ts` extended with 69 lines of new trigger endpoint logic.
- **Mobile-friendly guake input** — `_input.scss` overhauled (+171 lines) for responsive terminal input on small screens.

### Changed
- `agentChatMessageParser.ts` updated with additional parsing logic; new tests added in `AgentChatMessageCard.test.ts`.
- `App.tsx` wired to pinned agents state and updated agent-click handler.

## [1.117.0] - 2026-06-18

### Added
- **Recents overlay** — new `RecentsOverlay` modal tracks and surfaces recently accessed agents and buildings, wired into App.tsx with its own modal stack entry and keyboard shortcut.
- **Mobile-friendly guake terminal panels** — SCSS overhaul for the git, buildings, debug, tracking-board, and tools panels (`_git-panel.scss`, `_buildings-panel.scss`, `_debug-panel.scss`, `_tracking-board.scss`, `_tools.scss`) with responsive layouts for small screens.
- **BossContext panel** — new `BossContext.tsx` component renders boss agent context and delegation state in the output panel.
- **Claude runner router** — `claude-runner-router.ts` abstracts routing between runner backends in the server runtime.

### Changed
- `HistoryLine` and `OutputLine` updated with additional display metadata and layout tweaks.
- Keyboard shortcuts extended with Recents overlay binding.
- `runtime-service.ts` simplified by delegating to the new runner router.

## [1.116.0] - 2026-06-15

### Added
- **Classic TUI view in FlatView** — when Interactive Mode is enabled, a "Classic TUI" button appears in the FlatView toolbar for Claude agents with an active session, letting you attach directly to the live `tc-int-<agentId>` tmux session in an embedded terminal panel.
- **Interactive session backend** — new `agent-terminal-service.ts` and `src/packages/server/claude/interactive/` module manage the lifecycle of interactive Claude TUI sessions; `tmux-helper.ts` extended with interactive attach/detach support.
- **Agent terminal API** — `GET /api/agents/:id/terminal` endpoint streams the interactive terminal session to the client via `agent-terminal.ts`.

### Fixed
- Unused `node` parameter in `FileViewerModal.tsx` PlantUML renderer renamed to `_node` to satisfy ESLint.

## [1.115.1] - 2026-06-11

### Fixed
- **Gmail HTML body fallback preserves URLs** — when an email has no `text/plain` part, the gmail integration used to strip every tag from the HTML, discarding `href` attributes along the way. Magic-link / login emails (Anthropic, Slack, Notion, etc.) reached email-triggered agents with the anchor text but no URL. The fallback now drops `<style>`/`<script>` blocks, rewrites `<a href="URL">text</a>` to `text (URL)`, preserves block-element line breaks, and decodes common HTML entities.

### Added
- **`toFilter` for email triggers** — email trigger definitions can now match the recipient address (mirrors the existing `fromFilter`), making it easy to route only mail addressed to a specific alias.

## [1.115.0] - 2026-06-11

### Added
- **Live rate-limit gauges in usage modal** — the Context/Usage modal now fetches real-time plan limits (current session, current week all/Opus/Sonnet) directly from Anthropic using the CLI's own OAuth credentials, rendering the same gauges shown in the CLI's `/usage` panel. Falls back to the CLI hint when the fetch fails.
- **Task label chip in Spotlight** — agent results in Spotlight now display the agent's current task label as a small chip, making it easy to see what each agent is doing at a glance; task labels are also searchable.
- **Improved Spotlight agent recency sort** — agents now sort by the later of their server-side `lastActivity` and their last explicit Spotlight pick, so actively-working agents and recently-opened agents always float to the top.

## [1.114.1] - 2026-06-10

### Fixed
- **Mobile message ordering** — user prompts are now stamped in the server's time domain (`serverNow()` + `noteServerTimestamp()`), preventing clock-skew on mobile devices from sorting the user's own prompt below agent responses.

### Changed
- **Builtin skills trimmed** — all 22 built-in skill definitions reduced to remove redundant content, lowering token overhead per agent turn.

## [1.114.0] - 2026-06-10

### Added
- **Spotlight tabs** — All / Agents / Buildings / Areas / Commands tabs with Tab-key cycling and persistence (last active tab and last query are restored on reopen). The query is pre-selected on open so typing immediately replaces it.
- **Spotlight "Areas" tab** — groups agents by their drawing area with section headers (color dot + name + count), ordered identically to the Agent Overview panel via a new shared `makeAgentOverviewComparator`.
- **Spotlight enhancements** — colored status chip (with pulsing animation for working agents) on agent results; clickable port links on building results; ports and status are also searchable.
- **File drag-and-drop on the input container** — dragging files onto the Guake input area attaches them with a cyan highlight ring; dragging files onto the embedded shell terminal inserts the shell-quoted path(s) instead of uploading.
- **PM2 log modal: process controls** — Restart and Stop buttons wired to `POST /api/buildings/:id/command` with success/error feedback; live process status badge and exposed port links in the header; spinner loading state while first logs arrive.
- **ContextViewModal scrollable layout** — `max-height: 90dvh` with flex column so header/footer stay reachable on small screens when the context breakdown is tall.

## [1.113.0] - 2026-06-09

### Added
- **Fable 5 model support** — new `claude-fable-5` and `claude-fable-5[1m]` entries in the `ClaudeModel` registry (`agent-types.ts`), surfaced in the new-agent picker (1M variant) with the 200K variant kept as a deprecated/valid value. `llm-matcher-service.ts` maps `fable`, `fable-5`, `fable5`, and the full IDs to `claude-fable-5`. Wired through `AgentEditModal`, `BossSpawnModal`, `BulkManageModal`, boss instructions, the Claude backend, and the landing-page providers doc.
- **Inline streaming-exec output in history** — `HistoryLine.tsx` now links a `curl /api/exec` command to its matching `ExecTask`(s) (new `execTasks` prop + `extractExecPayloadCommand` helper), so streamed command output is shown inline with the originating call.
- **"Search area" quick filter in the agent overview** — `AgentOverviewPanel.tsx` adds an area-name filter focused with Ctrl/Cmd+L and auto-cleared once an agent is selected.
- Localized string added for the new UI across all 10 supported languages.

### Changed
- **Statistics modal enhancements** — additional breakdown/UI in `StatisticsModal.tsx` with matching styles (`statistics-modal.scss`).
- Overview-panel and modal styling refinements (`_overview-panel.scss`, `_modal.scss`); minor `AgentTerminalPane.tsx` / `VirtualizedOutputList.tsx` updates to support the inline exec output.

## [1.112.0] - 2026-06-05

### Added
- **Daily Claude usage breakdown** — new `GET /api/agents/usage-by-day` endpoint (`claude-usage-service.ts` `buildClaudeUsageByDaySummary`) groups Claude JSONL token usage by local day, with per-agent totals (`tokens`, `requestCount`) inside each day. Accepts `since` / `until` / `days` query params. Client helper `fetchClaudeUsageByDay()` and matching types added in `client/api/claude-usage.ts`.
- **Per-day usage view in the Statistics modal** — `StatisticsModal.tsx` gains a daily breakdown (with styling in `statistics-modal.scss`) showing token usage per day and the contributing agents.

### Changed
- **`parseBoundary` now accepts numeric timestamps** as well as strings, so the usage endpoints handle epoch-millis query params directly.

## [1.111.2] - 2026-06-04

### Fixed
- **Output panel no longer jumps up when new content arrives** — `AgentTerminalPane.tsx` and `VirtualizedOutputList.tsx` now disable auto-scroll only on a genuine upward user scroll (`scrollTop` actually decreased). Previously, content growing under the viewport (a new agent message or reasoning completion) made the at-bottom check momentarily false without the user scrolling, which incorrectly disabled auto-scroll and jumped the view off the latest message. Tracks the last observed `scrollTop` to distinguish a real upward scroll from the bottom drifting away.

## [1.111.1] - 2026-06-04

### Added
- **`VITE_HIDE_ORGANIZE_BUTTON` env flag** — set to `1` to hide the "Auto-organize all agents" sparkle button from both the desktop FAB and the mobile FAB menu. Opt-in; default behavior unchanged. Useful for users who accidentally trigger the organize-all action.

## [1.111.0] - 2026-06-03

### Added
- **Resizable Claude output side panel** — new `useSidePanelResize.ts` hook lets the side panel in `ClaudeOutputPanel` be dragged to a custom width, with the chosen size persisted.
- **File viewer "Copy all" and "Download" actions** — the file viewer (`FileViewer.tsx`, `FileViewerModal.tsx`, `FileTabs.tsx`) gains a button to copy the entire file contents to the clipboard and a button to download the file. New `closeAllTabs` action to close every open file tab at once.
- **Spotlight recent-agents (MRU) ranking** — agents selected from Spotlight are tracked in a localStorage-backed most-recently-used list and floated to the top of results across reloads (`Spotlight/utils.tsx`, `useSpotlightSearch.tsx`).
- **History dedup module** — extracted `historyDedup.ts` with dedicated coverage (`useHistoryLoaderDedup.test.ts`) to remove duplicate entries when loading conversation history.
- Localized strings for the new viewer/tab actions across all 10 supported languages.

### Changed
- **`useHistoryLoader.ts` / `ClaudeOutputPanel/index.tsx`** refactored to use the new history-dedup helper, slimming the panel component.
- Output rendering (`outputRendering.ts`) and Markdown components updated, with added test coverage.
- Guake terminal and git-panel styling refinements (`_base.scss`, `_git-panel.scss`, `GuakeGitPanel.tsx`).
- Keyboard shortcuts (`useKeyboardShortcuts.ts`) and FlatView updates to support the new panel/tab interactions.
- `vite.config.ts` build configuration tweaks.

## [1.110.5] - 2026-06-02

### Changed
- **`GET /api/agents/usage-by-agent` now rolls up subagent token usage** — `claude-usage-service.ts` walks `<projectDir>/<sessionId>/subagents/**/agent-*.jsonl` in addition to the parent session JSONL, summing both Task/Agent tool spawns and Workflow-tool fan-out runs into each agent's totals. Previously the endpoint reported only the parent-session tokens, which understated cost for boss agents and any agent running multi-agent workflows. Each `ClaudeUsageByAgentEntry` now exposes `subagentTokens: ClaudeTokenTotals` and `subagentRequestCount: number` alongside the existing `tokens` field (which is the rolled-up total). Performance: an mtime fast-path in `scanFileIntoAccumulator` skips files whose `mtime < since` so windowed queries don't pay for cold history. Client type in `client/api/claude-usage.ts` mirrored. Existing `StatisticsModal` chart automatically reflects the new totals via the unchanged `entry.tokens.total` field.

## [1.110.4] - 2026-05-29

### Added
- **`waitForIdle` option on `POST /api/agents/:id/collapse-context`** — accepts `{"waitForIdle": true}` in the body. When the target agent is busy, the `/compact` is held in an in-process queue and dispatched the first time the agent transitions to `idle`. Solves the auto-collapse case: an agent invoking the endpoint against ITSELF from inside its own turn is by definition `working`, so the default behavior returned `409 busy`; with `waitForIdle: true` the response is `200 + {status: "queued"}` and the collapse fires automatically once the current turn finishes. Coalesced — N `waitForIdle` calls for the same agent drain into a single `/compact`. Per-agent isolation: each pending entry drains only when its own agent goes idle. Drain errors are logged and the entry is cleared (no infinite retry loop).
- **`runtimeService.collapseAgentContext(agentId, opts)` accepts `{waitForIdle?: boolean}`** — REST route, WS handler, and the new factory share the same path. New `CollapseContextResult` variant: `{status: "queued"}`.

### Changed
- **Collapse-context logic factored into a testable module** (`services/collapse-context.ts`) — a factory `createCollapseContextService(deps)` owns the pending-collapse Set and the lazy `agentService.subscribe` listener. Runtime-service wires the real deps; tests use a fake event bus to exercise queue/drain/coalesce in isolation. New `collapse-context.test.ts` covers 13 specs across sync paths, the queue lifecycle, multi-agent independence, and drain-error tolerance.
- **`Send Message to Agent` skill** — new "Auto-collapse from inside your OWN turn (`waitForIdle`)" section with the exact curl example; status-code list now documents `200 + status:"queued"`.

## [1.110.3] - 2026-05-29

### Added
- **`POST /api/agents/:id/collapse-context` REST endpoint** — sends Claude Code's `/compact` slash command to any agent (including the same agent invoking it via a cron / end-of-flow step). `POST /api/agents/:id/message` cannot deliver slash commands (the leading `/` is passed through as message body instead of being intercepted by the CLI), so this dedicated endpoint is the only correct path. Logic was factored into a new `runtimeService.collapseAgentContext(agentId)` helper returning a discriminated `CollapseContextResult` (`collapse-initiated | not-found | busy + currentStatus | error + error`); the existing WS `collapse_context` handler was refactored to share the same helper so REST and WS now have identical semantics. Status codes: `200` (initiated), `404` (agent not found), `409` (agent busy — Claude rejects slash commands mid-turn), `500` (runtime error). Documented in the `send-message-to-agent` built-in skill alongside the existing `/message` endpoint.

### Changed
- **`Send Message to Agent` skill gains a "Collapsing an Agent's Context" section** — documents the new `/collapse-context` endpoint, response shape, status codes, and the explicit `/message` vs `/collapse-context` decision rule for inter-agent automation.

## [1.110.2] - 2026-05-28

### Fixed
- **Cron triggers double-firing on every slot** — `cron-service.schedule` now accepts an optional `ScheduleOptions.initialLastFired` and seeds `job.lastFired` from it (defaults to `null`, preserving back-compat). `trigger-service.startCronJob` passes `{ initialLastFired: trigger.lastFiredAt ?? null }` so the same-minute guard trips on the re-arm path: a fire → `fireTrigger` → `updateTrigger({lastFiredAt})` → `stopCronJob` + `startCronJob` cycle previously produced a fresh job with `lastFired: null` that the next interval poll re-fired in the same minute. Reading from the persisted record means a pm2/server restart inside the same minute as the last fire is also blocked from re-firing. New `cron-service.test.ts` (5 specs) and `trigger-service.test.ts` (2 specs) cover the wiring + same-minute guard behavior with fake timers.

## [1.110.1] - 2026-05-28

### Fixed
- **Per-agent config now persists across restarts** — `StoredAgent` and `toStoredAgents` in `data/index.ts` now serialize the `shortcut` (global keyboard shortcut), `customInstructions` (extra system-prompt instructions), and `memory` (agent's persistent notes) fields. Previously these were held in memory only and lost on server restart.

## [1.110.0] - 2026-05-28

### Added
- **Conversation History built-in skill** — new `conversation-history` builtin skill that retrieves recent Slack and WhatsApp conversation history from the local SQLite event store (read-only SELECTs). Agents can list channels/chats and pull a clean chronological transcript filtered by source, contact/channel/chat, limit, and time range.
- **Conversation history API endpoints** — new routes under `/api/events`: `GET /whatsapp` (raw WhatsApp messages), `GET /conversations` (unified chronological Slack + WhatsApp transcript), and `GET /conversations/contacts` (list Slack channels + WhatsApp chats for id/name discovery). Backed by new `queryWhatsAppMessages`, `queryConversationHistory`, and `listConversations` query functions in `event-queries.ts`.

### Changed
- **Google Drive integration** — refinements to `drive-client.ts` and `drive-routes.ts`.
- **Guake terminal theming** — updated output styles and a new theme variable for the terminal output panel.

## [1.109.1] - 2026-05-28

### Removed
- **Trigger multi-agent fan-out (reverted from v1.108.0)** — `BaseTrigger.agentIds?: string[]`, `TriggerFireOptions.dedupeSourceType` / `dedupeSourceId`, the per-agent `deliveryDedupMap` in `trigger-service`, and `trigger-service.test.ts` are removed. The fan-out approach was abandoned in favor of two per-instance Slack triggers with per-agent filters (e.g. Soporte excludes david, Bolba includes own DMs), which already deliver the same physical message to each subscribed agent without a fan-out primitive. v1.109.0's new `excludeChannelIds` / `channelIdAllowlist` (Slack) and `excludeChatIds` / `chatIdAllowlist` (WhatsApp) are what make this pattern ergonomic. No back-compat shim — `agentIds` was only a few hours old and not used in any persisted config.

### Changed
- **Slack polling-interval lower bound lowered to 5s** (was 10s) — `slack-config.ts` and `slack-polling-client.ts` clamp `pollingIntervalSec` to `[5, 600]`. The schema description now notes that in search mode (`pollingUseSearch`), Slack's ~10–30s search-index lag is the real latency floor, so sub-10s values mostly add API calls without delivering faster — useful only for the per-channel polling path.

## [1.109.0] - 2026-05-28

### Added
- **Dynamic Slack instance wiring for triggers** — `slack-instance-manifest` now exposes an `onInstanceChange` listener API and emits `{ type: 'added' | 'removed', id, meta? }` from `addInstance` / `removeInstance`. `slack-trigger-handler.startListening` seeds subscriptions from `listInstanceMetas()` AND subscribes to the manifest so instances created at runtime via `POST /api/slack/instances` are wired automatically (and `DELETE` ones get their `onMessage` listener torn down). Per-instance unsubscribers are tracked in a `Map<instanceId, off>` for individual detach; `stopListening` removes the manifest hook plus every per-instance listener so post-stop manifest changes don't resurrect subscriptions. Subscribe is idempotent — a redundant `added` for an already-wired id keeps a single listener. Fixes the case where triggers configured for a Slack instance added AFTER server start silently never fired.
- **`excludeChatIds` + `chatIdAllowlist` on WhatsApp triggers** — `WhatsAppTriggerConfig` accepts two new literal-JID arrays. Both are evaluated EARLY in `structuralMatch` (after the status/broadcast check, before `isEmptyContent` / `fromFilter` / `bodyPattern`) so muted/archived chats short-circuit before the expensive checks. Match is exact via `Array.includes` — no normalization, no prefix matching. Lets a trigger drop a hand-curated list of noisy / archived chats (e.g. 56 JIDs from a personal archived-chats file) without rewriting the body-pattern regex.
- **`excludeChannelIds` + `channelIdAllowlist` on Slack triggers** — symmetric to the WhatsApp filters. `SlackTriggerConfig` accepts two new literal-channel-id arrays evaluated EARLY in `structuralMatch` (after `instanceId` / `channelId`, before `userFilter` / `messagePattern`). Exact match via `Array.includes`. Lets a trigger drop bot-noisy channels (jirabot, soporte_commander, `*-errors` streams) or allow-list a curated set without touching the message regex.



### Added
- **Trigger multi-agent fan-out with per-agent delivery dedup** — `BaseTrigger` gains optional `agentIds?: string[]` alongside the legacy `agentId`; a trigger now delivers the same interpolated message to the de-duplicated union of `agentId` + `agentIds`. `fireTrigger` walks every target agent, reserves a per-agent dedup slot synchronously (before any `await`) keyed by `${agentId}\0${sourceType}\0${sourceId}`, and writes one `trigger_events` row per delivery. The dedup map (`DELIVERY_DEDUP_TTL_MS = 10 min`) absorbs polling lag between integration instances so the same physical Slack/email message hits each subscribed agent exactly once — even when two Slack instances (personal + bot) both see a shared-channel message, or overlapping triggers target the same agent. Sources without a stable id (cron, manual fires) skip dedup. New `TriggerFireOptions.dedupeSourceType` / `dedupeSourceId` plumbed through `evaluateEvent`.
- **Google Calendar `meetingUrl` on events** — `CalendarEvent` gains `hangoutLink` (Google's legacy field) and `meetingUrl` (best join URL: `hangoutLink`, else a `conferenceData.entryPoints` `video` URI). Surfaces the join link for Google Meet AND Zoom/Teams/Webex events that publish a video entry point.
- **`trigger-service` unit tests** — new `trigger-service.test.ts` covers fan-out resolution, per-agent dedup behavior, and TTL expiry.

### Changed
- **Slack search-mode polling now newest-first with early-stop** — `pollViaSearch` switches `sort_dir` from `asc` to `desc` and collects matches into a pending list dispatched chronologically at the end of the cycle. Each cycle remembers `lastSearchMaxTs`; subsequent cycles stop paging the moment a page's oldest match falls under `lastSearchMaxTs − 5 min` overlap. Result: steady-state cost drops to ~1 page per cycle instead of paging the full day window every tick, and busy accounts (where the newest messages used to sit on the LAST page and could be silently dropped past `MAX_PAGES`) no longer lose recent messages. The 5-minute overlap is well above Slack's ~10–30s search-index lag, and the per-channel watermark dedupes the overlap so nothing dispatches twice. New `seenKeys` set per cycle defends against the same `${channel}:${ts}` appearing on overlapping pages — replaces the previous max-based gate that was incorrect under desc paging (the running max IS the first match).

## [1.107.1] - 2026-05-28

### Added
- **Claude Opus 4.8 support** — new selectable model `claude-opus-4-8` plus the Tide Commander 1M-context variant `claude-opus-4-8[1m]`. The spawn/bulk/boss modals expose "Opus 4.8 [1M]" as the headline Opus choice (1M token context window), and the boss-instructions `spawn` schema lists the new IDs as valid `model` values. `ClaudeBackend` translates `[1m]`-suffixed labels to the bare CLI model ID (`claude-opus-4-8[1m]` → `claude-opus-4-8`), and `llm-matcher-service` resolves both the bare and `[1m]` aliases.

### Changed
- **`opus` short-alias now maps to 4.8** — the legacy `opus` model name (used by older agents and CLI passthrough) now resolves to `claude-opus-4-8` in `llm-matcher-service`. The 200K-only IDs (`claude-opus-4-8`, `claude-opus-4-7`) are marked `deprecated` in the picker so the 1M variants surface as the default Opus choice; the IDs themselves remain valid for existing agents and explicit selection.
- **Provider docs reference Opus 4.8** — `getting-started/providers.mdx` updated to reflect the new default Opus version.

## [1.106.3] - 2026-05-28

### Added
- **Claude Code usage panel** — new `claude-usage-service` reads `~/.claude/stats-cache.json` (the same daily activity file the CLI's interactive `/usage` panel reads) and combines it with Tide's own per-agent session/context tallies, exposed via a new server route and `claude-usage` client API. `TerminalModals` renders an `AgentUsageChartSection` with a pie of token usage by agent over the current local day, plus a `cliHint` pointing at `/usage` in the CLI for live weekly/session rate-limit gauges (those can't be read non-interactively).
- **Agent info modal styling** — full new SCSS partial `_agent-info-modal.scss` (~200 lines) backing the agent info / usage modal layout.
- **Google Calendar integration improvements** — additional config + skill + route + client surface area, with a new `calendar-client.test.ts` covering the client behavior.

### Fixed
- **Built-in skills `agent-memory` / `agent-tracking` / `task-label` are toggleable again** — those three skills previously declared `assignedAgentClasses: ['*']`, which force-applied them to every agent and made them read-only in the agent edit modal (chip badged `all`, no click handler). The wildcard is removed from the three source definitions, and `agent-memory` / `agent-tracking` are added to `SpawnModal` and `BossSpawnModal` `DEFAULT_SKILL_SLUGS` so newly-spawned agents still get them ticked by default — but the user can untick them at spawn time and toggle them off later from the edit modal. `task-label` was already in the spawn defaults; nothing changes for it functionally on new spawns.
- **Migration strips stale `'*'` from previously-persisted built-in skill assignments** — the `initSkills` merge in `skill-service` was unioning the source `assignedAgentClasses` with the stored set, which meant once `'*'` had been persisted by an earlier build it kept resurfacing on restart even after the source definition no longer included it. The merge now drops `'*'` from the stored set when the current source definition doesn't include it, so existing installations clean themselves up on the next server start.

## [1.106.2] - 2026-05-28

### Fixed
- **Live "Running..." bash modal stuck after a session refresh** — when a bash tool_use's `tool_result` arrived via JSONL session refresh *after* the live look-ahead window had already closed, the open bash modal stayed in `isLive: true` with no resolved output. `AgentTerminalPane` now emits `onLiveBashResultLinked(command, output)` the first time a `Bash` tool_use in `dedupedHistory` gains its `_bashOutput` link, threaded through `SplitTerminalLayout` to `GuakeOutputPanel`, which swaps the matching live modal to the resolved output and clears `isLive`. The reported-id set is keyed by tool_use id and reset on `agentId` change so it never fires twice per result.

## [1.106.1] - 2026-05-28

### Added
- **Building right-click menu on FlatView terminal-bar shortcuts** — the terminal, server-logs, and database shortcut buttons that sit above the chat terminal now respond to right-click by opening the existing building context menu (same one the empty-state map chips use), so a quick right-click on a shortcut gives the full building action menu instead of forcing a navigate-and-right-click.

### Fixed
- **WhatsApp LID JIDs no longer rendered as phone numbers** — `@lid` JIDs are opaque internal identifiers, not dialable numbers. `humanizeWhatsAppJid` (server) and `formatJid` (in `WhatsAppMessageToast`) now emit `WhatsApp user <last4>` for `@lid` inputs instead of `+<digits>` (which made a contact like 'Memo' show up as `+153996203434060`).
- **Address-book name lookup misses for LID-addressed contacts** — `ContactNameCache` now indexes resolved contact names under both the phone JID and the LID JID (new `ContactLite.lid` / `WhatsAppContact.lid` field), so inbound messages addressed by LID still resolve to the saved address-book name.
- **Phantom 'working'/'thinking' status when an agent goes idle** — `updateAgent` now clears transient tracking statuses (`working`, `thinking`) when an agent enters the idle state, so the tracking board no longer shows a stuck typing/working indicator for a process that has actually finished. Meaningful end-of-turn statuses (`need-review`, `blocked`, `can-clear-context`, `waiting-subordinates`) are preserved, and an explicit `trackingStatus` in the same update is never clobbered.

## [1.106.0] - 2026-05-26

### Added
- **Codex pure-read rows on session reload** — when reloading history, a Codex `exec_command` that is a single side-effect-free file read (`sed -n 'A,Bp' file`, `cat file`, `head -n N file`, including `/bin/zsh -lc "…"` wrappers) now renders as one `Read` row with a highlighted line range instead of a redundant `Bash` row, matching the live parser. Anything that writes, edits, pipes, or chains commands stays a `Bash` row.
- **Spotlight match-quality ranking** — Spotlight results are now ranked by a tiered match quality (exact title → prefix → whole-word → title substring → other-field substring → fuzzy) as the dominant sort key, with a small per-entity-type weight as a tiebreaker. A strong match on a building or db-server can now outrank a weak fuzzy match on an agent, while agents still win when the query genuinely matches an agent name best.
- **Sequential "Run all" in the database panel** — running multiple SQL statements now awaits each statement's result before sending the next via a new `executeQueryAndWait` store action (resolves on success OR error). Replaces the previous `setTimeout`-staggered fire-and-forget approach, so statements execute in strict order and a failing statement surfaces its error without derailing the rest.

### Changed
- **Boss strict-JSON block rules** — `boss-instructions` now spells out hard requirements for `delegation` / `work-plan` / `spawn` / `analysis-request` blocks (valid JSON only, no trailing commas/comments/single quotes, no literal U+FFFD, well-formed `\uXXXX` escapes, prefer plain ASCII). `boss-response-handler` surfaces a visible parse-error message naming the problem so the boss can correct and re-send.

### Fixed
- **Empty Codex message payloads no longer render as raw JSON** — content-block arrays whose text fields are all empty (e.g. `[{"type":"output_text","text":""}]`) now resolve to nothing instead of dumping raw JSON. `session-loader` only falls back to a stringified dump when it sees a genuinely unrecognized block shape, and a defensive client-side `isEmptyCodexPayloadText` net in `formatting.ts` (used by `HistoryLine` / `OutputLine`) catches any that slip through.

## [1.105.0] - 2026-05-25

### Added
- **Expanded area color palette** — `AREA_COLORS` gains ~52 new options (mid-tone reds, oranges, yellows, greens, teals, blues, purples, pinks, plus muted neutrals like slate, steel, ochre, and stone), giving areas far more distinct color choices in the editor.
- **Random boss class** — `BossSpawnModal` now honors the global `DEFAULT_AGENT_CLASS = 'random'` preference: when set, a freshly opened boss-spawn modal picks a random visual class (excluding `boss` so it actually varies). The boss role itself stays guaranteed server-side via the `isBoss` flag + boss-instructions skill, so only the visual/behavioral class is randomized.

### Changed
- **Accessible area color swatches** — `AreaEditor` color swatches are now real `<button>` elements with `aria-label`, `aria-pressed`, and a `title` tooltip instead of plain `<div>`s, so the color picker is keyboard- and screen-reader-navigable. Supporting `_areas.scss` tweaks included.

## [1.104.0] - 2026-05-25

### Added
- **"Open in file explorer" (reveal in OS file manager)** — file and diff viewers can now reveal a file in the host OS file manager. New client API `client/api/files.ts` (`revealInFileExplorer(path)`) calls a new `POST /api/files/reveal` endpoint in `routes/files.ts` (+111 lines) that opens the platform file manager at the target path. Wired into `FileViewer`, `FileViewerModal`, `DiffViewer`, `GitFileHistoryModal`, and `GuakeGitPanel`, with supporting store + `_file-viewer.scss` / `_diff-viewer.scss` / `_viewer.scss` changes. Adds an `openInFileExplorer` string across all 10 locale `terminal.json` files.
- **Codex `thread.started` → `init` event** — the Codex JSON event parser now emits an `init` event (carrying `sessionId` from `thread_id` and `model`) when a Codex thread starts, instead of swallowing the envelope. The parser also now reads `thread_id` and `model` off the event envelope. Improves Codex session/model tracking parity with the Claude backend.

### Fixed
- **Codex live output hidden after a notification curl** — the notification-curl suppression gate in `RunnerStdoutPipeline` is now scoped to the `opencode` backend only. Codex shares the same runner but starts a fresh process per turn, so applying the gate there could hide subsequent live output until a history refresh.

## [1.103.1] - 2026-05-22

### Fixed
- **Inline `<code>` borders/shadows in markdown blocks** — added `border: none` and `box-shadow: none` to inline-styled `<code>` elements in `MarkdownComponents.tsx` and to the matching rule in `_output.scss`. Some themes were applying a residual border and box-shadow to inline code that the new `CodeBlock` component picked up; they now render flat against the surrounding markdown surface.

## [1.103.0] - 2026-05-22

### Added
- **Advanced-mode renderers for `AskUserQuestion` / `AskFollowupQuestion` and `Bash` tool calls** — these tool inputs used to fall through to raw `<pre>` JSON in advanced output mode, which was unreadable for long question payloads and noisy Bash invocations. `HistoryLine` now renders the same `AskQuestionInput` card used in simple mode (with pending-prompt + answer wiring) and the same Bash chip surface (tracking / notify / task-label / report-task / memory / search / curl parsing, plus a syntax-highlighted command line). Falls back to raw JSON only when the input has no parseable command/questions.
- **Markdown code-block on-demand language loading** — `MarkdownComponents` now wraps fenced code blocks in a new `CodeBlock` component that calls `ensureLanguageLoaded(language)` for languages not yet bundled, then re-renders highlighted output once the language pack resolves. Unsupported / failed-to-load languages fall back to a plain-styled `<code>`.
- **`AgentResponseModal` copy button feedback** — the copy button now reports its outcome inline for 1.5s ("Copied" with a check icon on success, "Copy failed" with a cross on clipboard error) and is disabled when there is no content to copy. The status resets when the modal closes.

### Changed
- ~26 lines of new SCSS in `_modal.scss` style the copy-button success/error states.

## [1.102.0] - 2026-05-22

### Added
- **AskUserQuestion answer recap in history** — when an `AskUserQuestion` chip is rendered in history (non-interactive) mode, it now surfaces the picked answer(s) under a "Your answer" / "Your answers" label. Free-text "Other" answers that didn't match any listed option are tagged as `custom`, so they're visible at a glance instead of being hidden by the option-highlight-only rendering.
- **FlatView area folder chips** — each area card now lists its `area.directories` as clickable folder chips; clicking opens the file explorer scoped to that folder via `store.openFileExplorerForAreaFolder(areaKey, dir)`. Lets users jump into an area's folders without first selecting a building.
- **FlatView building chips adopt building-type colors** — building chips now read `BUILDING_TYPES[building.type].color` and apply it to both the icon and a CSS custom property (`--building-type-color`) so each type is visually distinct in the area card.
- **FlatView markdown response modal** — `handleViewMarkdown` (previously a no-op) now opens `AgentResponseModalWrapper` with the markdown content, parity with the dashboard view.

### Changed
- ~110 lines of supporting SCSS in `FlatView.scss` and `_tools.scss` style the new folder chips, building-type-colored chips, and AskQuestion answer recap surface.

## [1.101.0] - 2026-05-21

### Added
- **Group-chat awareness in WhatsApp history** — `WhatsAppChatSummary` gains `isGroup`, `groupName`, and `fromName`. `ChatList` now renders group chats with their group name and `ChatMessages` surfaces the originating sender for each message in a group thread. ~13 lines of new SCSS in `whatsapp-history.scss` style the group-chat affordances.

## [1.100.0] - 2026-05-21

### Added
- **`--no-daemon` CLI flag** — alias for `--foreground` so `tide-commander --no-daemon` runs the server attached to the current terminal, prints logs in place, and stops on Ctrl+C. Matches the convention used by other daemons (postgres, redis, k3s, etc.).
- **Foreground startup banner** — when running with `--foreground` / `--no-daemon`, the CLI now prints a one-line cyan banner with the resolved protocol/host/port and the "press Ctrl+C to stop" hint, so it's obvious the server is attached and where it's serving.

### Fixed
- **Foreground PID-file leak on Ctrl+C** — the foreground parent now forwards `SIGINT` / `SIGTERM` / `SIGHUP` to the child server process, so the child's exit handler runs and removes the PID file. Previously, Ctrl+C in a raw terminal could race the parent's default SIGINT handler and leak the PID, leaving the next start convinced an instance was already running.

## [1.99.0] - 2026-05-21

### Added
- **In-UI self-update** — Tide Commander can now update itself from the About section in Settings. New `services/self-update-service.ts` detects the install location (npm / pnpm / yarn / bun global vs dev-mode) and shells out to the right `<pm> install -g tide-commander@latest`. Exposed via REST in the new `routes/system.ts` (`GET /api/system/install-info` and `POST /api/system/self-update`), mounted under `/api/system/` in `routes/index.ts`. Client API in `api/system-update.ts` streams `start` / `stdout` / `stderr` / `error` / `done` events for a live install log. New `AutoUpdatePanel` in `AboutSection.tsx` adds a confirm dialog, an auto-scrolling install log, success / failure / dev-mode states, package-manager-mismatch fallback ("Auto-update only supports npm-installed globals. Detected: <pm>"), and a manual-command fallback for unsupported PMs. ~140 lines of new SCSS in `_about.scss` style the panel; ~17 new translation strings in `public/locales/en/config.json`.
- **Interactive agent-prompt chips on tool_use messages** — pending `AskUserQuestion` / `AskFollowupQuestion` / `ExitPlanMode` agent-prompts are now indexed at the pane level by their `toolUseId` and attached to the matching `tool_use` history message as `_pendingPromptId`. `AgentTerminalPane.tsx` does the indexing and threading through `enrichHistory`; `HistoryLine.tsx`, `ToolRenderers.tsx`, and `types.ts` consume the new field so each chip can flip into interactive mode and let the user respond inline. Adds ~15 lines of supporting SCSS in `_tools.scss`.

## [1.98.0] - 2026-05-21

### Added
- **WhatsApp history + hub** — full WhatsApp browsing surface inside the UI: `WhatsAppHub/` modal lists conversations, `WhatsAppHistory/` renders message threads, backed by a new `/api/whatsapp/history` endpoint set in `whatsapp-routes.ts` and a new `007_whatsapp_messages.sql` migration that persists incoming messages. Client API in `api/whatsapp-history.ts`, types in `shared/whatsapp-types.ts`, styles in `whatsapp-history.scss` and `whatsapp-hub-modal.scss`. `whatsapp-trigger-handler.ts` now writes inbound messages to the new table so the hub has data to display.
- **Agent prompt subsystem** — agents can now raise interactive prompts to the user from server-side via `services/agent-prompt-service.ts`, surfaced over WebSocket by `agent-prompt-listeners.ts`, exposed at `routes/agent-prompt.ts` (`/api/agent-prompt` and `/api/agent-prompt/:id/respond`), stored client-side in `store/agentPrompts.ts`, and rendered inside the terminal by the new `AgentPromptCard.tsx` (with `_agent-prompt.scss` styling). The server build now also copies `permission-prompt-server.mjs` into the dist folder so the agent-prompt server is shipped with the package.
- **Queued messages bar** — `ClaudeOutputPanel/QueuedMessagesBar.tsx` shows messages typed while an agent is working, with delete/force-send affordances. New `hooks/useMessageQueue.ts` powers the queue, `TerminalInputArea` enqueues into it, and an idle-mount effect drains one queued message when the agent becomes idle. Styled via `_queued-messages.scss`.
- **Database query editor autocomplete** — new `database/QueryEditorAutocomplete.tsx` surfaces table/column suggestions inside the SQL editor; `QueryEditor.tsx` integrates the popover and ~95 lines of supporting SCSS land in `QueryEditor.scss`.
- **Expanded tool renderers (~380 lines)** — `ToolRenderers.tsx` gains substantial new rendering paths used by the new agent-prompt and queue features, with terminal-input chrome (~69 lines in `TerminalInputArea.tsx`) and new icon mappings in `outputRendering.ts` (+129).
- **Gmail integration enhancements** — `gmail-client.ts` (+158) and `gmail-routes.ts` (+185 new) expand the Gmail surface (additional endpoints + client capabilities used by triggers/history).
- **Trigger + webhook hardening** — `trigger-routes.ts` (+93) and `webhook-signatures.ts` (+28) extend the trigger pipeline with new behavior, covered by added test cases in `webhook-signatures.test.ts` (+23).
- **Server data event queries (+248)** — `data/event-queries.ts` adds new query helpers consumed by the agent-prompt and WhatsApp paths.
- **Tmux helper utilities** — `claude/runner/tmux-helper.ts` (+15), `process-lifecycle.ts` (+3), `stdout-pipeline.ts` (+8), and `backend.ts` (+47) refine the Claude runner's tmux integration.
- **Agent status transition hook** — `hooks/useAgentStatusTransition.ts` centralizes UI transitions when an agent flips between idle/working/blocked states.
- **Translations** — `public/locales/en/config.json` (+44) and `public/locales/en/terminal.json` (+10) add strings for all the new UI surfaces (WhatsApp hub, agent prompts, queued messages, autocomplete).

### Changed
- **`ToolRenderers.tsx` reorg** — beyond the additions above, the renderer registry was reorganized so the new agent-prompt/queue paths plug in cleanly alongside the existing TaskCreate/TaskUpdate/AskUserQuestion handlers.
- **Config + integration status panels** — `ConfigSection.tsx` (+65/-) and `IntegrationStatusPanel.tsx` (+41) gain controls for the new WhatsApp/Agent-Prompt surfaces; `TriggerManagerPanel.tsx` (+107) exposes the new template variables and webhook options.
- **Client store** — `store/index.ts`, `store/selectors.ts`, `store/types.ts` extended for agent prompts + queued messages bookkeeping; `useFilteredOutputs.ts` updated accordingly.

### Fixed
- **TerminalInputArea react-hooks/exhaustive-deps directive** — removed an `eslint-disable-next-line react-hooks/exhaustive-deps` whose rule isn't loaded in the project's ESLint config (the explanatory comment above the deps array still documents intent).
- **Unused `AgentPromptResponse` import** — removed an unused `AgentPromptResponse` type import in `shared/websocket-messages.ts`.

## [1.97.0] - 2026-05-18

### Added
- **Inline `TaskCreate` / `TaskUpdate` tool renderers** — `ToolRenderers.tsx` exports new `TaskCreateInput` and `TaskUpdateInput` components that turn raw MCP task-tool payloads into a checkbox-style list (☐ pending, ► in_progress, ✓ completed, ⊘ cancelled, plus a red `failed` variant detected from the description). Both `HistoryLine` and `OutputLine` wire these in so the agent's task-tracking activity reads as a live checklist inside the terminal output. ~95 lines of new SCSS in `_tools.scss` cover color-coded rows, the pulsing in-progress icon, and the strike-through for completed/cancelled. New icon mappings for `TaskCreate` / `TaskUpdate` added in `outputRendering.ts`
- **Slack per-instance `reactOnTrigger` toggle** — each Slack instance now has its own "Auto-react with 👀 on trigger" checkbox in `SlackMultiInstanceSetup`. The handler re-reads the per-instance value on every message (no restart required when flipping the toggle) and the global `SLACK_REACT_ON_TRIGGER` env still acts as a kill-switch across all instances. `slack-config.ts` exposes the field via the schema with a default of `true`

### Changed
- **`FileExplorerPanel` / `FileViewer` rework** — ~390 lines of restructuring in `FileViewer.tsx` plus accompanying tweaks in `FileExplorerPanel/index.tsx` and `types.ts`; preparatory cleanup that drops two unused locals and leaves the panel ready for upcoming editor work

### Fixed
- **Empty-chat fade-in reveal** — `AgentTerminalPane` now flips `historyFadeIn` to `true` as soon as the pane has any rendered items, so an optimistic prompt sent into an empty chat appears immediately instead of waiting for the history-loader/scroll-stabilization pass that never fires on a fresh pane
- **Tooltip dismissal on click** — `shared/Tooltip` listens for `pointerdown` and hides on press, so clicks that open a modal or popup no longer leave the tooltip stranded on screen (mouseleave doesn't fire when the cursor stays put and a modal pops up over it)

## [1.96.0] - 2026-05-15

### Added
- **Buildings REST API** — full lifecycle and control surface at `/api/buildings`:
  - `GET /` and `GET /:id` list and fetch buildings with database/SSH credentials redacted
  - `POST /`, `PATCH /:id`, `DELETE /:id` (with `?cleanup=false` opt-out) create, partially update, and remove buildings. The server assigns `id`, `createdAt`, `lastActivity`, and initial `status`; client-supplied values for those fields are stripped
  - `POST /:id/command` runs `start`/`stop`/`restart`/`healthCheck`/`logs`/`delete` against PM2, Docker, terminal, or custom-command buildings
  - `GET /:id/logs?lines=&service=` returns a one-shot logs snapshot (capped at 5000 lines) for PM2, Docker (with optional compose service tag), or custom-command buildings
  - `POST /:id/sync-status` forces a PM2/Docker/Terminal status refresh and broadcasts the result
  - `POST /:id/subordinates` and `POST /boss/:id/command` (`start_all`/`stop_all`/`restart_all`) drive boss buildings
  - `GET /docker/containers` lists adoptable containers and compose projects for `mode: 'existing'` Docker buildings
- **Service-layer building CRUD** — `building-service` gains `createBuilding`, `updateBuilding`, `deleteBuilding`, `assignSubordinates`, `getBuildingLogs`, and a pure `validateBuilding` schema validator. Per-building reconciliation extracted into a shared `reconcileBuilding` helper used by both REST PATCH and the existing `sync_buildings` WebSocket flow
- **`create-building` skill rewrite** — replaced direct `jq` edits of `buildings.json` with curl examples against the new REST API. Adds previously-undocumented examples for `link`, `monitor`, `folder`, custom-command servers, Docker `container`/`compose` modes, PostgreSQL/SQLite/SQL Server, SSH-tunneled databases, and PM2 cluster/restart options
- 26 new tests in `routes/buildings.test.ts` covering validation, CRUD, command routing, secret redaction, boss controls, and subordinate cleanup on delete

### Changed
- **Buildings WebSocket protocol** — removed the never-implemented `create_building`, `update_building`, and `delete_building` client→server messages (handlers were no-ops). The REST API replaces them; the existing `sync_buildings` flow used by the UI is unchanged and now shares reconciliation code with the REST PATCH path

## [1.95.0] - 2026-05-14

### Added
- Automated Bitbucket PR review integration:
  - Webhook receiver supports Bitbucket signature (`X-Hub-Signature`) alongside GitHub (`X-Hub-Signature-256`) with raw-body HMAC verification
  - LRU dedupe cache (1024 entries / 10min TTL) keyed by `triggerId:requestUuid` to prevent duplicate webhook delivery from firing twice
  - Author-loop guard skips events authored by `BITBUCKET_BOT_USERNAME` on comment/approve/changes-request events
  - `bitbucket-pr-review` skill with 9 native Bitbucket Cloud REST API actions (diff, diffstat, inline comments, summary comment, approve/unapprove, native request-changes/unrequest-changes, list comments)
  - `bitbucket-reviewer` agent class with a 9-step reviewer system prompt covering idempotency, diff truncation, prioritized analysis, and exactly-one verdict (approve XOR request-changes)
  - Per-repo trigger configuration in TriggerManagerPanel with workspace/repo-slug/events/HMAC-secret fields
  - Setup documentation at `docs/bitbucket-pr-review.md` including nginx reverse-proxy example for VPN-to-internal forwarding

## [1.94.0] - 2026-05-14

### Added
- **FlatView header right-click context menu** — `FlatView` agent terminal header now supports `onContextMenu` (right-click), surfacing the empty-agent context menu at the cursor for the currently selected agent. Lets users perform agent actions without clearing the chat selection first

## [1.93.0] - 2026-05-13

### Added
- **Audio transcription service** — new `audio-transcription.ts` service transcribes audio attachments arriving from triggers (Slack voice notes, WhatsApp PTT, Gmail audio attachments) so agents receive readable text instead of raw audio paths. Wired into the trigger pipeline via `trigger-service.ts` and exposed through `trigger-types.ts`
- **Gmail attachment + audio support** — `gmail-client.ts` and `gmail-trigger-handler.ts` now download Gmail attachments through the existing attachment pipeline and run audio attachments through the transcription service. `gmail-config.ts` exposes the new toggles
- **Slack polling-client message enrichment** — the polling client gained ~200 lines of message-enrichment logic for thread/reply normalization, user resolution, and channel-name caching parity with Socket Mode. `slack-config.ts` exposes the new tunables
- **WhatsApp media transcription + config knobs** — `whatsapp-trigger-handler.ts` runs PTT/voice attachments through the transcription service; `whatsapp-config.ts` exposes new options for enabling/disabling per-instance
- **FileExplorerPanel quality-of-life upgrades** — ~270 lines of panel improvements (scoped here so users don't need to dig the diff): better browsing, area-aware navigation
- **Output store keying upgrades** — `virtualizedOutputKey.ts` + `store/outputs.ts` gained more deterministic key derivation with new test coverage in `VirtualizedOutputListKey.test.ts` and `outputs.test.ts` (+5 new tests; total 535)

### Changed
- **Trigger files route** — `routes/files.ts` reworked file resolution to better surface attachment paths and area metadata for downstream consumers
- **Gmail message bubble + AttachmentChip** — minor rendering tweaks for Gmail-specific attachment metadata
- **Terminal output styling** — `_output.scss` adds styling hooks for the enriched output entries

## [1.92.0] - 2026-05-12

### Added
- **Attachment pipeline for Slack & WhatsApp triggers** — inbound messages with files (images, video, audio, documents) are now downloaded to `/tmp/tide-commander-uploads/triggers/{slack,whatsapp}/<msgId>/<file>` by a new `attachment-downloader` service and served back to the UI via the Express static mount at `/uploads/...`. A new `attachment-janitor` periodically prunes old uploads so the temp directory doesn't grow unbounded. The Slack and WhatsApp trigger handlers feed the downloader, and the trigger template now surfaces attachment paths/MIME types so agents can reference them in their workflow
- **Clickable attachment chips in chat bubbles** — `SlackMessageBubble` and `WhatsAppMessageBubble` now render `[attachment: …]` markers as interactive `AttachmentChip` components. WhatsApp attachments additionally open a full preview modal (`WhatsAppAttachmentPreview`) that previews images, audio, and video inline and offers a "Open in new tab" affordance for other types
- **Slack polling attachment support** — the polling client (xoxp- user-token mode) now resolves file references from Slack message payloads and hands them off to the attachment pipeline, matching what Socket Mode already provided
- **Trigger manager panel surfaces attachment template variables** — `TriggerManagerPanel` lists the new `slack.attachmentsList` / `whatsapp.media` template tokens so users can build trigger prompts that reference downloaded files

### Fixed
- **WhatsAppAttachmentPreview no longer pulls the websocket layer into UI tests** — the component now imports `useModalClose` directly from `../../hooks/useModalClose` instead of the hooks barrel. Importing the barrel transitively loaded `websocket/state.ts`, whose top-level `window.__tideWsState` access broke the `SlackMessageBubble`/`WhatsAppMessageBubble` parser tests under Vitest's Node environment

## [1.91.0] - 2026-05-11

### Added
- **Per-agent persistent memory (`agent-memory` skill)** — each agent now carries its own free-form memory string that is automatically injected into the system prompt under `## Agent Memory (Your Notes To Yourself)` so notes survive context clears, restarts, and reconnects. New built-in skill `agent-memory` documents the GET/PATCH/DELETE flow (read-modify-write convention since PATCH is full-replace), and new endpoints `GET/PATCH/DELETE /api/agents/:id/memory` let an agent curate the string itself. Agents are guided to record user preferences, project facts, lessons from corrections, debugging recipes, and external-system pointers — but not code that can be re-derived from the tree
- **Bulk multi-skill assignment** — `BulkManageModal` can now add/remove multiple skills across many agents in a single action, with per-skill result breakdowns (`updated` / `alreadyHad` / `didNotHave` / `failed`). New API client helpers `bulkAddSkills` / `bulkRemoveSkills` call `/api/agents/bulk/skills/{add,remove}` and surface idempotent per-skill outcomes so the UI can show exactly which agents changed vs. were already in the desired state

### Fixed
- **`command-handler.test.ts` logger mock** — test mock for `../../utils/index.js` now exports the full `logger` factory tree (server/http/ws/claude/agent/files/boss) so `agent-service.ts`'s module-load-time `const log = logger.agent;` no longer throws when transitively imported through `backend.ts`. Unblocks the test suite after `backend.ts` started importing `agent-service.js` directly for memory injection

## [1.90.0] - 2026-05-08

### Added
- **Slack name cache** — new `SlackNameCache` infrastructure caches resolved user and channel display names (10 min TTL, LRU 500 per instance) so the trigger template can render `@David` / `#navi` / `DM con @Luis` / `Grupo: @a, @b…` instead of raw Slack IDs. One cache per `SlackInstance` (default vs. personal) prevents cross-instance name collisions. `slack-instance.ts` calls `resolveChannelLabel()` on message dispatch and enriches `SlackMessage.channelName`; the trigger handler exports new template variables (`slack.fromName`, `slack.fromId`, `slack.channelId`, `slack.channelName`, `slack.attachmentsCount`, `slack.attachmentsList`, `slack.instanceName`) alongside the legacy ones for backwards compatibility
- **WhatsApp group name cache** — new `GroupNameCache` resolves Baileys group JIDs to their current subjects via the upstream `GET /api/sessions/:id/groups` endpoint. Per-message webhook payloads lack the group subject, so the cache batch-primes from the full groups list (10 min TTL per session) and enriches inbound/outbound group messages with `groupName`. Wired into `whatsapp-trigger-handler.ts` to run in parallel with contact-name enrichment
- **WhatsApp contact sync in trigger handler** — `syncContacts()` now runs once per session (or on cache miss after TTL) before returning the contacts list, pulling all address-book tiers (critical/regular blocks + regular priority levels) instead of just the upstream's default ~39-entry subset. Ensures DM JIDs are name-enriched and bubbles render contact names instead of formatted phone numbers
- **FileViewerModal area-based file resolution** — when exact/cached/parent-walk/git-root/suffix-match strategies miss, the resolver now tries user-configured area directories (capped to 5 areas × 10 dirs each, 30s cache) via two additional strategies: `area-root` (verbatim join against each area dir, with tail-slices) and `area-suffix-match` (suffix-walk rooted at each area). The modal displays resolution badges with area context (`area-root · <area name>`) so users can see which area provided the file

### Changed
- **Slack message bubbles render resolved channel names** — `SlackMessageBubble` parser now extracts friendly labels from the trigger template's `{{slack.channelName}} ({{slack.channelId}})` format and falls back to raw channel ID or a label-only string (e.g. bare `#navi` or `DM con @luis`) when available. The bubble prefers the friendly name, so the chat history looks human-readable even when the channel was deleted or renamed
- **WhatsApp message bubbles enrich sender + group context** — `WhatsAppMessageBubble` parser now splits the `De:` line into `Name <jid>` (new template format) or bare `jid` (legacy), and parses `Grupo:` as `<bool> <name>` so the bubble can display contact names and group subjects. New `composeIdentity()` helper renders DM vs. group headers correctly (primary = contact name or phone, secondary = phone for DMs when distinct from primary). Outbound group messages now show the group subject
- **File routes resolve & expose area metadata** — `/api/files/read` and `/api/files/info` now return `areaId` and `areaName` when a file was resolved via an area-based strategy, so the client can annotate the resolution badge and help users understand which configured area provided the match

### Fixed
- **WhatsApp message enrichment runs contact + group lookups in parallel** — contact name and group subject are now fetched concurrently instead of sequentially, halving latency on cache-miss enrichment. Both fail gracefully with best-effort fallbacks (phone formatting for missing contact names, `humanizeGroupJid()` for missing group subjects)

## [1.89.0] - 2026-05-07

### Added
- **Multi-instance Slack integration** — Slack now supports parallel connections (e.g., a workspace bot via xoxb- token and your personal account via xoxp- token running side-by-side). Each instance maintains independent config, watermark state, and connection lifecycle via `slack-instance.ts` and `slack-instance-manifest.ts`. The `slack-config.ts` framework keys all state by instance ID; legacy single-instance deployments stay under the `default` ID with no migration required. New `/api/slack/instances` CRUD routes expose per-instance management; `SlackMultiInstanceSetup` toggles between the generic single-config UI and the new multi-instance panel. Database migration `006_slack_messages_integration_instance.sql` tags all historical Slack messages with their instance ID
- **Slack polling mode (Web API fallback)** — alongside real-time Socket Mode (xoxb- bot tokens), you can now run purely on Web API polling with a xoxp- user token (~30–60s message lag, zero Slack app configuration needed). New `SlackPollingClient` handles channel/DM enumeration, history backfill, thread-reply fetching, and rate-limit throttling; config exposes polling intervals, backfill caps, concurrency controls, and channel-type/allowlist filters so you can tune Slack's Tier-3 API budget (~50 req/min). Auth mode auto-detects from token prefix (xoxb → Socket, xoxp → polling). `currentMode` field broadcasts which mode the instance is actually using. Polling respects a `mirrorOwnMessages` flag for personal-token instances
- **Agent chat & delegation message cards** — the client now renders agent-to-agent messages and task delegations as rich cards (`AgentChatMessageCard`, `DelegationMessageCard`) with sender/task context, collapsible long-form bodies, and semantic icon signaling. Parser helpers (`agentChatMessageParser.ts`, `delegationMessageParser.ts`) extract structured payloads from assistant text; cards are wired into `OutputLine` and `HistoryLine` rendering paths
- **Post-reconnect resync service** — when the WebSocket reconnects, the client now pulls `GET /api/agents` to refresh agent status before relying on the `agents_update` snapshot (which can race against the server's background `syncAllAgentStatus`). New `postReconnectResync.ts` service handles the fetch + store merge with testable dependency injection; wired into `useWebSocketConnection` via the reconnect callback
- **Slack message direction tagging & outbound mirroring** — `SlackMessage` now carries `isOwnMessage` so outbound messages (from the instance's own bot/user account) are tagged and trigger-filterable. Database event-types field `integrationInstanceId` disambiguates multi-instance messages. Slack trigger config gained per-instance scoping (`instanceId`), DM-only / DM-exclude filters, user exclusion, and opt-in inclusion of own messages
- **WhatsApp trigger test coverage** — new `whatsapp-trigger-handler.test.ts` validates structural matching, variable extraction, and LLM formatting for WhatsApp message triggers
- **File routes test coverage** — new `files.test.ts` covers file discovery, fallback resolution, and error-state handling; `files.ts` gained structured "tried candidate locations" error reporting to help debug stale paths

### Changed
- **Live output deduplication refactored into helpers** — the `useHistoryLoader.ts` dedup logic moved into `historyDedup.ts` (pure functions with no React/store/websocket imports) so it's reusable in tests and composable with other output-handling logic. Key contract: always pass the *live* store outputs at dedup time, never a snapshot taken before the fetch, to preserve optimistic UI updates that land during the in-flight window. New `useHistoryLoaderDedup.test.ts` locks this behavior against the v1.88 regression
- **Virtualized output key logic extracted** — `VirtualizedOutputList` now delegates item-key computation to `virtualizedOutputKey.ts`'s `buildItemKey()`, which correctly bridges history-vs-live identity (UUID for history messages, timestamp+content hash for live outputs) and includes agent ID so identical content across agents never collides. Defensive de-dup collapses any duplicate keys that emerge from the merged array before render, preventing @tanstack/react-virtual from emitting stacked bubbles
- **WebSocket reconnect policy refined** — exponential backoff adjusted to 250ms→8s (was 1s→30s) to reduce perceived lag on transient dropouts; reconnect-attempt counters in toasts replaced with a `failingThresholdAttempts` flag (fires at attempt 5) that shows a persistent "Cannot reach server" overlay instead of an "attempt 4/10" countdown
- **NotConnectedOverlay now shows resync status** — when the socket reconnects and post-reconnect resync is in flight, a small "Reconnecting…" toast stays visible until the agent map is refreshed, so users see a reason for the brief latency
- **Slack instance-aware trigger handler** — `slackTriggerHandler` subscribes to every known Slack instance and tags each event with `instanceId` so triggers can scope to a single instance or match any. Variable extraction and structuralMatch rules updated to respect the new config fields (per-instance ID, own-message inclusion, DM filtering, user exclusion)
- **FileViewerModal fallback resolution UX** — when a path isn't found at the exact location or relative-search roots, the modal now shows a structured "Tried N candidate locations" panel with attempted paths, a copy button, and `strategy` badges that explain how the file was resolved (exact / cached / parent-walk / git-root / suffix-match) when it did load
- **Slack config schema updated** — "Bot Token" label changed to "Slack Token" to clarify that both xoxb- (bot) and xoxp- (user) tokens are accepted; description expanded with Socket Mode vs. polling trade-offs and scope requirements for each
- **CurlCard agent-message bodies now collapsible** — long agent messages (>5 lines or >280 chars) in curl cards collapse by default with a "Show more" button, matching the collapsible UX of `AgentChatMessageCard`
- **IntegrationsPanel Slack mode badge** — when Slack is connected, a small badge in the status line shows whether it's running Socket Mode ("Socket") or polling ("Polling"), with a hover title explaining the auth method
- **ClaudeOutputPanel style polish** — `CurlCard`, `GmailMessageBubble`, `WhatsAppMessageBubble`, and related styling (`_curl-card.scss`, `_gmail.scss`, `_whatsapp.scss`, `_index.scss`) received layout, spacing, and visual consistency refinements. `AgentProgressIndicator`, `BossContext`, `HistoryLine`, and `OutputLine` gained minor sizing and flex-alignment improvements
- **Store state additions** — new `resyncInProgress` and `connectionFailing` flags track reconnect-flow state so the UI can render appropriate feedback. Exposed via `useResyncInProgress()` and `useConnectionFailing()` hooks
- **Server data structures** — `SlackMessageEvent` (`event-types.ts`) and `SlackTrigger` config (`trigger-types.ts`) extended with instance-scoping and direction-filtering fields (`integrationInstanceId`, `excludeUserIds`, `dmOnly`, `excludeDms`, `includeOwnMessages`)

### Fixed
- **Connection error messaging no longer counts down** — retry attempt counters in toast messages were removed in favor of a persistent overlay once the `failingThresholdAttempts` threshold is crossed, eliminating "attempt 4/10" chatter and clarifying that the client keeps retrying without user intervention

## [1.88.1] - 2026-05-06

### Fixed
- **`ssh2` and `@types/ssh2` declared in `package.json`** — v1.88.0 added `ssh2` to `node_modules` locally without persisting it to `package.json`/`package-lock.json`, so the publish workflow's TypeScript build failed in CI with "Cannot find module 'ssh2'". This release adds the runtime dependency `ssh2@^1.17.0` and the dev dependency `@types/ssh2@^1.15.5` so `npm ci` in CI installs them and the build succeeds. No code changes versus v1.88.0 — purely a metadata fix to unblock the npm publish

## [1.88.0] - 2026-05-06

### Added
- **Database buildings now support SSH tunnels** — new SSH tunnel service manages jump-host forwarding for database connections, with encrypted credential storage (passwords, private keys, passphrases) at rest. The `SSHTunnelConfig` type (in `database-types.ts`) configures jump-host auth via password or key-based methods, local-port binding, and connection timeouts. Database connection pool factories (`getMySQLPool`, `getPgPool`, etc.) resolve endpoints through the tunnel when enabled. Server-side `test_database_connection_transient` WS handler lets you test unsaved connections with inline SSH config before persisting to a building. `buildingService.handleBuildingSync()` tears down tunnels when database buildings or their connections are deleted or materially changed. New builtin `explore-database` skill and `/api/database/*` REST routes expose database exploration
- **WhatsApp message triggers** — new `whatsappTriggerHandler` registers as a real trigger-service handler with filtering by sender JID, body regex, direction (inbound/outbound/any), group/DM toggle, specific session ID, and opt-in status-update capture. Bridge emits events into trigger evaluation via `notifyTriggerSubscribers()`. Client renders incoming/outbound WhatsApp messages as chat bubbles (`WhatsAppMessageBubble`, `_whatsapp.scss`) instead of plain text
- **Gmail message direction tagging** — `gmail-trigger-handler.ts` now extracts `email.direction` (outbound if SENT label, else inbound) and `email.labels` as trigger variables; direction appears in the LLM-facing prompt format. Client renders Gmail messages as collapsible email cards with quoted-thread tail hidden by default (`GmailMessageBubble`, `_gmail.scss`)
- **Message bubble rendering in output panels** — both `OutputLine` and `HistoryLine` parse incoming WhatsApp and Gmail user prompts and render them as rich message bubbles, matching the integration's semantic intent
- **Area context menu** — right-click on an area in 3D/2D/FlatView to open a context menu with Spawn Boss and Place Building actions, mirroring agent and building context menus

### Changed
- **History + live output chronological merge** — `VirtualizedOutputList` now sorts history and live outputs by canonical timestamp ascending (UUID as tiebreaker), then renders from a single merged array instead of concatenating separate blocks. Fixes timeline visibility when live events arrive before the latest persisted history entry. Stable per-item keys preserve virtualizer row-height caches across reorders
- **Live output deduplication simplified** — `useHistoryLoader.ts` now dedupes solely by UUID presence in history; timestamp-based pruning removed because it silently killed optimistic UI updates when an earlier JSONL entry changed the latest history timestamp. Added `sortOutputsChronologically()` utility for explicit sorting
- **Database connection UI overhaul** — `DatabaseConfigPanel` refactored with per-connection inline test results (idle/testing/success/error with 30s timeout), SSH config panel with auth method toggle (password vs. private key/file), and helper methods for cleaner updates. Connection host placeholder changes based on SSH state (127.0.0.1 when tunneling, localhost otherwise)
- **Database building style default** — new database buildings now default to "filing-cabinet" style instead of "server-rack" for better visual distinction from boss/agent servers
- **Agent card active-state styling** — `.aop-agent-card.active` now displays a full inset glow (tinted background + colored border + shadow) instead of minimal mixed color; `.active.boss` includes a gold tint overlay. Stopped cards gain the same glow treatment
- **File path resolution fallbacks** — `files.ts` now implements `findFileWithFallbacks()` to recover stale absolute paths and relative-path targets by walking the path tail up the directory tree (bounded to 12 levels), with an LRU cache (max 500) to avoid re-searching the same request
- **WhatsApp in trigger type selector** — `TriggerManagerPanel` now lists WhatsApp as a selectable trigger type
- **Dependency updates** — added `ssh2` for SSH tunnel support

### Fixed
- **Agent card selection visibility** — active area cards now display clear orange highlight + shadow (previously faint blended color was hard to discern)

## [1.87.0] - 2026-05-05

### Added
- **Configurable OAuth redirect base URL for Google integrations** — Gmail, Calendar, and Drive now expose an "OAuth Redirect Base URL" field in their OAuth setup screens. The value is stored in a single shared secret (`GOOGLE_REDIRECT_BASE_URL`) used by all three integrations when constructing the `redirect_uri` for Google's auth and token-exchange endpoints, so a non-localhost commander (VPN box, headless server, hosts-file domain alias) can complete the consent flow without a `redirect_uri_mismatch` error from Google's token endpoint. Empty value preserves the existing `http://localhost:<port>` default. The displayed redirect URI hint in the OAuth UI now reflects the override when set, per integration callback path. Google does not accept raw IPs, so a domain (e.g. `commander.local` mapped in `/etc/hosts`) is required when accessing the commander outside localhost

### Changed
- **Google integrations re-initialize their OAuth client on credential or redirect-URL change** — Calendar and Drive plugins' `setConfig` now call `shutdown()` + `init()` when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or `GOOGLE_REDIRECT_BASE_URL` changes, so a cached `oauth2Client` from a prior session is recreated with the new redirect URI on the next auth flow. `shutdown()` for both clients now also resets `oauth2Client = null` (previously only cleared the API handle)

## [1.86.0] - 2026-04-30

### Added
- **`useAndroidBackButton` hook for native Android back-gesture handling** — new Capacitor-backed hook (`src/packages/client/hooks/useAndroidBackButton.ts`) that wires the system back gesture on Android APK builds. Handler returns `'handled'` to absorb the gesture or `'exit'` to call `App.exitApp()` and let the OS close the app. No-op on web. Adds the `@capacitor/app` dependency for the underlying listener
- **FlatView routes Android back through its agent-history stack** — the back gesture now walks the same prev-agent stack the toolbar's Back button uses, falling back to `App.exitApp()` only when the stack is empty, so users get history navigation instead of an immediate app close

## [1.85.0] - 2026-04-29

### Added
- **Claude usage snapshot endpoint and modal section** — new `GET /api/agents/:id/usage` route on the server (Claude agents only) backed by `claude-usage-service.ts`, which assembles the kind of data the Claude CLI's `/usage` slash command surfaces but read non-interactively from local sources. The `ContextViewModal` now lazily fetches and renders this snapshot when opened for a Claude agent, with stale-request guarding (`usageReqRef`) so rapid agent switches don't leak older responses, plus loading and error states. Codex/Opencode agents skip the section entirely. Frontend client lives in `src/packages/client/api/claude-usage.ts`

### Changed
- **`AgentOverviewPanel` styling refresh** — overview panel SCSS trimmed and component markup adjusted to match
- **`FlatView` tweaks** — small render adjustments alongside the new context-modal usage section

### Fixed
- **Sidebar no longer auto-closes on desktop when selecting an agent** — `App.tsx` previously called `setSidebarOpen(false)` unconditionally after agent selection, collapsing the desktop sidebar on every click. Now gated behind `window.innerWidth <= 768` so only mobile collapses; desktop keeps the sidebar open

## [1.84.6] - 2026-04-29

### Fixed
- **Tapping an Android system notification now opens the right agent's chat (cold-start safe)** — `WebSocketForegroundService` already built `PendingIntent`s with an `agentId` extra, but `MainActivity` never read them, so the tap just brought the app to the foreground without routing. New `forwardNotificationIntentToJs(Intent)` extracts the `agentId`, dispatches the same `tide-notification-tap` `CustomEvent` the JS side already listens for in `client/utils/notifications.ts`, and clears the extra so a later unrelated `onResume` bounce doesn't resurrect the same tap. Called from `onResume()` so it fires for both warm-start (`onNewIntent → onResume`) and cold-start (`onCreate → onResume`) routes; the new `onNewIntent()` override calls `setIntent(intent)` so `getIntent()` in `onResume` returns the fresh extras
- **Cold-start race between the native dispatch and the JS bundle boot** — on a fresh launch the `CustomEvent` can fire before `initNotificationListeners` has had a chance to register. The native side now also stashes the payload on `window.__tidePendingNotificationTap`, and `initNotificationListeners` drains and consumes that property right after attaching the listener so the tap isn't lost

## [1.84.5] - 2026-04-29

### Fixed
- **Notification toast taps now register on touch devices** — `AgentNotificationToast` listened only for `onClick`, but on mobile WebViews the synthetic click was suppressed by the swipe-to-dismiss handler so taps did nothing. `handleTouchEnd` now also fires `onClick(notification)` when the gesture didn't pass the dismiss threshold and didn't lock into a swipe, with a `closest('.agent-notification-close')` guard so tapping the X doesn't double-fire navigation
- **Tapping a notification on FlatView no longer stacks a second chat overlay** — `store.openTerminalOnMobile()` used to flip `terminalOpen=true` and `mobileView='terminal'` regardless of view mode. In FlatView the right-side chat is already inline, so flipping those flags drew the Guake-style terminal overlay on top of FlatView's own chat. The store now reads `state.viewMode` and skips the flag flip when it's `'flat'`, matching the existing carve-out in `client/utils/notifications.ts` for the desktop flat path
- **FlatView side panels close on notification tap** — even with the agent selected, the FlatView agents drawer / inspector are kept in component-local state the store can't reach, so a notification tap that landed correctly was still hidden behind those panels. `openAgentTerminalFromNotification` now dispatches `tide-close-flat-side-views` after the mobile branch so any open side panel dismisses and the chat is visible

## [1.84.4] - 2026-04-29

### Changed
- **Mobile flat-map collapses areas to header-only tiles by default** — under the (max-width: 768px) breakpoint, the empty-state map used to render every area card with all its agent chips visible, which forced a horizontal pan because cards couldn't fit side-by-side at phone width. Now each area collapses to a header-only chip (color dot + name + agent count + caret) so all areas fit on screen at once while preserving their spatial grid positions (each card stays in the row/column its world coords assigned). Tapping a header expands that area in place via `grid-column: 1 / -1`, revealing the agent chips underneath; the other cards on the same spatial row are dropped from the render so the expanded card has the row to itself without overlap. Single-area expansion — tapping a different area collapses the previous one. Implemented with a `matchMedia('(max-width: 768px)')` listener on `useEffect` so orientation changes flip the behavior immediately. Desktop is unchanged
- **Mobile flat-map drops horizontal scroll** — `overflow-x: auto` / `touch-action: pan-x pan-y` / `overscroll-behavior-x: contain` on `.flat-chat--empty` are gone now that headers fit in a single column-set; the container is `overflow-x: hidden` with `touch-action: pan-y` so vertical scrolling is no longer fighting horizontal pan gestures

## [1.84.3] - 2026-04-29

### Changed
- **`ViewModeToggle` is now reachable from the FlatView Areas header** — the 3D / 2D / Dashboard switcher used to live elsewhere in the chrome and was missing once a user dropped into FlatView, so going back to 3D required hunting through menus. It now sits pinned in the top-right of the Areas header (`flat-map__header`) with `position: absolute; top: 10px; right: 12px`, a backdrop-blurred pill background (`color-mix(in srgb, $bg-secondary 92%, transparent)` + `backdrop-filter: blur(6px)`) and a subtle drop shadow so it floats above the grid. The header gets `padding-right: 130px` to reserve space and `position: relative` so the toggle anchors to it

## [1.84.2] - 2026-04-29

### Fixed
- **`AgentHoverTooltip` no longer renders its hover wrapper on touch devices** — on phones the hover tooltip would latch open on tap and stick over the underlying agent UI, since touch has no `mouseleave`. The component now subscribes to `window.matchMedia('(max-width: 768px)')` (with a `change` listener so orientation/resize is honored) and short-circuits to its raw children when the viewport is mobile, skipping `Tooltip` entirely. Desktop behavior is unchanged

## [1.84.1] - 2026-04-29

### Changed
- **Android Capacitor goes edge-to-edge** — `MainActivity.hideSystemUI()` no longer hides the status bar; instead it calls `WindowCompat.setDecorFitsSystemWindows(false)` and lets the WebView draw under the system bars, with `setAppearanceLightStatusBars(false)` / `setAppearanceLightNavigationBars(false)` so the icons stay visible against the dark UI. `styles.xml` makes the status and navigation bars transparent across `AppTheme`, `AppTheme.NoActionBar`, and `AppTheme.NoActionBarLaunch` (`android:statusBarColor=@android:color/transparent`, same for nav, plus `windowDrawsSystemBarBackgrounds=true` and the `enforceStatusBarContrast` / `enforceNavigationBarContrast` opt-outs). `index.html` viewport gains `viewport-fit=cover` so the WebView fills the cutout area
- **FlatView headers and bodies respect Android safe-area insets** — with the WebView now extending behind the status bar, FlatView headers (`flat-terminal-wrapper__header`, `flat-inspector__header`, `flat-middle__header`, `flat-map__header`) gain `padding-top: calc(6px + env(safe-area-inset-top, 0px))` so their content doesn't sit under the battery/wifi icons. `.flat-inspector__body` and `.flat-middle__content` gain `padding-bottom: var(--mobile-bottom-stack-height, 72px)` so the last item isn't hidden behind the bottom-nav (which sits at z-index 2100)
- **Mobile tracking-board layout — compact card variant under 768px** — new `@media (max-width: 768px)` block: card padding/gap shrinks (4–6px), column header drops to 9.5px, card name to 12px, `tracking-board-card-area` / `tracking-board-card-task` / `tracking-board-card-clear-context` are hidden on small screens, working-column shimmer animation is disabled (replaced with a flat color-mix tint) so phones don't repaint constantly, and unread cards drop the box-shadow halo for a flatter look. Inside `flat-inspector__body` the board lays out `flex: 0 0 auto; height: auto` with `overflow: visible` so the inspector body's own scroll is the only scroller (no nested-scroll trap)

### Fixed
- **FlatView inspector now closes after picking an agent** — clicking an agent in the inspector's tracking board (`onSelectAgent`) or in `SingleAgentPanel` (`onFocusAgent`) used to leave the inspector panel open over the new agent's content. Both callbacks now also call `handleCloseInspector()` so the inspector dismisses on selection
- **Spotlight no longer triggers terminal expand in FlatView** — `useSpotlightSearch`'s agent action unconditionally called `store.requestTerminalExpand()` after selecting, which is a Guake-style bottom-up expand and makes no sense in FlatView (no Guake terminal exists). Now guarded by `store.getState().viewMode !== 'flat'`

## [1.84.0] - 2026-04-28

### Added
- **WhatsApp notifications for agent events** — new `whatsapp-notification-publisher.ts` forwards classified agent events to WhatsApp via the existing Baileys integration, with a per-event-type filter persisted at `~/.local/share/tide-commander/whatsapp-notifications.json`. Seven toggleable event types: `messages`, `statusChanges`, `taskComplete`, `errors`, `planReady`, `agentSpawned`, `agentStopped`. Three new REST endpoints expose the config: `GET /api/whatsapp/notification-config`, `PATCH /api/whatsapp/notification-config` (filter and/or recipient JID), `DELETE /api/whatsapp/notification-config` (reset to defaults). Publisher silently skips when the toggle is off, the integration is disabled, the API key secret is missing, or no recipient is configured — no spurious failures during normal operation. Wired in at four publish sites: `POST /api/notify` and the `send_notification` WS handler classify the title into an event type; `agent-service.createAgent` emits `agentSpawned`, `agent-service.updateAgent` emits `statusChanges` on transition, `agent-service.deleteAgent` emits `agentStopped`
- **WhatsApp Notifications Settings modal** — new `WhatsAppNotificationsModal` in the toolbox config section lets the user pick a recipient JID and toggle each event type. Backed by `src/packages/client/api/whatsapp-notifications.ts` against the new `/notification-config` endpoints. Translations in `public/locales/en/config.json` (61 new strings)
- **Mobile FlatView agents drawer + inspector panel** — FlatView now has dedicated mobile-friendly Agents drawer and Inspector panels reachable from the bottom nav. App-level state mirrors them via `tide-flat-agents-drawer-state` / `tide-flat-inspector-state` custom events, and the toggle handlers (`handleToggleAgentsDrawer`, `handleToggleInspector`) close the other panels first so only one bottom-nav view is active at a time

### Changed
- **Mobile bottom nav is now a single-active-view controller** — the bottom-nav buttons (Spotlight, Commander, Toolbox, plus FlatView's Agents/Inspector toggles) used to each just `.open()` their modal. They now route through `handleToggle*` callbacks that close every other bottom-nav surface (toolbox, commander, spotlight, FlatView drawer/inspector) before opening the chosen one, and `MobileBottomMenu` highlights the currently-active view. The Spawn button also closes the rest before opening the spawn modal so we can't end up with overlapping bottom-nav panels
- **`SessionSearchModal` keyboard nav uses `if/else` instead of ternary-as-statement** — `e.shiftKey ? goPrev() : goNext();` was a `no-unused-expressions` lint warning. Converted to a real `if (e.shiftKey) { goPrev(); } else { goNext(); }`

### Fixed
- **`agent-service.test.ts` Codex context-limit suite crash** — three tests in the `agent-service context limits` suite started failing with `[vitest] No "createLogger" export is defined on the "../utils/index.js" mock` once the new WhatsApp publisher was wired into `agent-service.ts`. The transitive import chain (`agent-service → whatsapp-notification-publisher → secrets-service`) needed `createLogger` at module load. Mock now exports a `createLogger` stub returning `{ log, warn, error, info, debug }` so the chain resolves without changing test semantics

## [1.83.0] - 2026-04-27

### Added
- **Global Session Finder (Ctrl+Shift+F)** — new `SessionSearchModal` opens a cross-project search over every Claude Code session on disk, not just the ones for the currently-selected agent's cwd. Three new server endpoints back it: `GET /api/sessions/global` (paginated list of all sessions across every project, with `lastModified`, `messageCount`, first-prompt preview, and `sizeBytes`), `GET /api/sessions/search?q=...` (full-text search returning hit count + snippet per session, optional `cwdFilter`), and `GET /api/sessions/preview?cwd=...&sessionId=...` (loads the first N messages of a session for a hover/preview pane). Wired in via the new `open-session-finder` shortcut in the shortcuts store, the `useKeyboardShortcuts` hook, and a new "Find" button in the per-agent Session History header on `SingleAgentPanel`. Implementation lives in new files: `src/packages/client/components/SessionSearchModal.tsx`, `src/packages/client/api/sessions.ts`, `src/packages/client/styles/components/session-search-modal.scss`, `src/packages/server/routes/sessions.ts`, and 270 new lines of helpers (`listAllSessions`, `searchAllSessions`) in `src/packages/server/claude/session-loader.ts`
- **Cross-project session restore** — `restore_session` WS message now accepts an optional `cwd`. When the Session Finder picks a session from a different project, the server updates the agent's `cwd` alongside its `sessionId` so Claude Code can resolve the JSONL on the next run. Client `restoreSession(agentId, sessionId, cwd?)` mirrors this with an optimistic `cwd` update in the agent store. Activity log spells out the cwd swap (`Session restored from <new cwd> - will resume on next command`) so the user can see the change took effect
- **`agentId` now appears in every server log line** — new `src/packages/server/utils/log-context.ts` exposes `withAgentContext(agentId, fn)` and `getCurrentAgentId()` backed by `node:async_hooks`' `AsyncLocalStorage`. The logger reads `getCurrentAgentId()` inside `formatMessage()` and emits `[agentId=...]` (cyan) right after the context tag when the call is inside an agent-scoped frame. Wrapped at the boundaries: `ClaudeRunner.run/sendMessage/interrupt/stop`, the runner's internal event bus emit path, and all four command-execution paths in `runtime-command-execution.ts` (`executeCommand`, `sendCommand`, `sendSilentCommand`, `stopAgent`). Effect: chasing a single agent's behaviour in the log no longer requires hand-correlating thread IDs to context tags

## [1.82.1] - 2026-04-27

### Fixed
- **Spurious auto-restart loops on clean turn-end (watchdog vs. tailer race)** — when a tmux-mode CLI session ended, the 5-second watchdog often beat the 100ms `TmuxFileTailer` poll, stopped the tailer, and the CLI's final `step_complete` bytes still sitting in the log file were dropped. Without those bytes the runtime never transitioned `turnState` to `waiting_for_input`, and `runner.ts`'s `watchdog_missing_process` branch then mis-classified a clean turn-end exit as a mid-turn death (`status=error`) and kicked off an auto-restart loop. New `TmuxFileTailer.drain()` does a synchronous `readNewData()`; the watchdog calls `tailer.drain()` *before* `tailer.stop()` so the trailing events flow through `onLine → bus.emit → turnState` and the post-`step_complete` state is what `runner.ts` sees
- **`npm test` killing live agents every ~20s** — server modules resolve their data dir at module-load from `XDG_DATA_HOME || ~/.local/share/tide-commander`, so a test process that instantiated a real `ClaudeRunner` (mocks leaking, or code paths the mocks didn't cover) ran `recoverOrphanedProcesses()` against the *live* data dir, called `killUnknownTmuxSessions()`, and killed `tc-*` sessions belonging to the running dev server. New `src/test-setup.ts` (wired into `vitest.config.ts` via `setupFiles`) `mkdtempSync`'s a per-process sandbox and points `XDG_DATA_HOME` at it before any module imports it — `running-processes.json` reads/writes go to the sandbox, `tmux-mode-setting.json` is absent so `isTmuxEnabled()` returns false, and `killUnknownTmuxSessions()` early-returns even if a runner accidentally `start()`s

### Changed
- **`ClaudeRunner` constructor is now side-effect-free** — orphan recovery, the periodic `persistRunningProcesses` timer, and the watchdog used to kick off in the constructor, which meant any non-canonical context that imported the runner code (tests, scripts, sidecars) shared the live data dir and could kill the live server's tmux sessions on import. Background work moved into a new idempotent `start()` method; the canonical production entry point `runtime-service.init()` calls `runner.start?.()` after constructing all runners. `RuntimeRunner.start?()` is optional in the interface so existing test mocks don't have to implement it

## [1.82.0] - 2026-04-27

### Added
- **Per-file Git History modal** — right-click a file in the File Explorer tree or on a file tab to open a new `GitFileHistoryModal` that lists every commit that touched that path (using `git log --follow`, so renames are tracked), with a click-to-view diff pane that detects the file's language from its extension for syntax-highlighted diffs. Backed by a new `GET /api/files/git-file-history` endpoint (configurable `limit`, default 100, max 1000) and a paired `GET /api/files/git-commit-file-diff` route. Untitled / in-memory tabs are filtered out client-side via `isRealFileTab` since they have no on-disk path to query. Translations live under `terminal.fileGitHistory.*`
- **Right-click context menu on file tabs** — `FileTabs` now supports `onContextMenu`, exposing a "Show Git History" action for any tab whose path resolves to a real file on disk. Mirrors the new tree-row context menu entry, so the action is reachable from both surfaces
- **`detectLanguageFromPath` helper in `src/packages/server/routes/files.ts`** — small extension/basename → language mapping (Dockerfile, Makefile, TS/TSX/JS/JSX, JSON, HTML/CSS/SCSS, MD, Python, Ruby, Go, Rust, Java/Kotlin/Swift, C/C++/C#, PHP, shell, YAML/TOML/XML, SQL, Lua, Dart, Svelte/Vue, INI/env) used to tag diff payloads so the client can pick the correct highlighter without each consumer rolling its own detector

### Changed
- **Mobile agent toolbar stays visible while the keyboard is open** — `.mobile-bottom-stack` (agent bar + bottom nav) used to be hard-hidden via `display: none !important` whenever the IME opened. It now stays mounted and is lifted above the keyboard with `bottom: var(--keyboard-height)`. Removed the `(1 - --keyboard-visible)` multiplier from `main-content` height/max-height and from the `.guake-input-wrapper` `bottom` calc — the bottom stack height is now always reserved. Message-list `padding-bottom` adds `--mobile-bottom-stack-height` so the last message is still scrollable past the toolbar+input+keyboard stack. The `MobileBottomMenu` child component still hides its own contents on keyboard-open via its existing internal logic; only the outer stack visibility changed
- **`FlatView` cwd chip opens the file explorer instead of a single-file viewer** — clicking the working-directory chip in the chat header used to call `store.setFileViewerPath(cwd)` (single-file modal, which made no sense for a directory). It now calls `store.openFileExplorer(cwd)` and the chip gains keyboard support (`role="button"`, `tabIndex={0}`, Enter/Space handlers), an explicit aria-label, and a more descriptive title ("Open in file explorer: …")
- **`handleRevealInTree` lazy-loads via `expandToPath` and handles compaction chains** — the previous implementation built up parent paths from `currentFolder` and dropped them into `expandedPaths` directly, which only worked for already-loaded subtrees. The new flow awaits `expandToPath(filePath)` (lazy-loads each ancestor) and, after two `requestAnimationFrame`s, walks up the path string to find the closest rendered `[data-path]` row when the exact target isn't directly in the DOM (single-child directory chains are rendered as one compacted row, so the leaf may not have its own element). Drops the now-unused `currentFolder`/`pathsToExpand`/`setExpandedPaths` plumbing from this code path

## [1.81.2] - 2026-04-26

### Fixed
- **Mobile keyboard "ceiling" bug — input bar no longer flies to the top of the screen** — three coordinated fixes:
  - `MainActivity.java` clamps `WindowInsets.bottom` to ≤75% of viewport height before pushing it into `--native-keyboard-height`. Android occasionally reports inflated IME insets mid-animation and an unclamped value made the input bar lift to the screen ceiling
  - `useKeyboardHeight.ts` applies the same `Math.min(rawKeyboardHeight, viewport * 0.75)` clamp on the JS-driven `visualViewport.resize` path
  - `_mobile.scss` removes the `transform: translateY(--keyboard-height * -1)` on `.guake-input-wrapper` and folds the keyboard offset into the existing `bottom` calc instead. `transform` creates a containing block on the element which broke `position: fixed` relative to the visual viewport on some Android WebViews — combining transform + fixed was the root of the ceiling jump

### Added
- **`useKeyboardHeight` always-on `visualViewport` watcher** — the existing focus-gated listener missed cases where the keyboard opens without a `focus` event firing in sync (programmatic focus, autofill, IME show after navigation), leaving `--keyboard-height` / `--keyboard-visible` stale and the input bar misplaced. The new passive watcher subscribes to `visualViewport.resize`/`scroll` for the lifetime of the component on mobile and keeps the CSS variables in sync regardless of focus state. Native handler still owns the variables when `window.__nativeKeyboardHeight` is set

## [1.81.1] - 2026-04-26

### Added
- **Tmux session idle-timeout reaper in the watchdog** — tmux mode kept claude processes alive across Commander restarts via persistent stdin (the trailing `cat` in `tmux-helper.ts`), but those sessions never died on their own and accumulated as orphans (168 stale `tc-*` sessions observed in the wild). The 5-second watchdog loop now tracks `lastActivityTime` per active process, updates it on `sendToTmux` and on every stdout line via the runtime activity bus, and calls `killTmuxSession()` for any tmux-mode agent whose status is not `working` and whose last activity is older than the idle timeout. Default 30 minutes, configurable via the new `getTmuxIdleTimeoutMs()` / `setTmuxIdleTimeoutMs()` helpers in `system-prompt-service.ts` (persisted to `tmux-idle-timeout-setting.json`). `runner.isRunning()` already self-cleans `activeProcesses` and `runtime-command-execution.sendCommand()` falls through to `executeCommand` (fresh spawn) when no live runner exists, so a reaped session whose user sends a follow-up message recovers transparently — no message drop
- **Startup orphan reconciliation in `recovery-store.ts`** — on `recoverOrphanedProcesses()`, the recovery store now enumerates live `tc-*` tmux sessions via `tmux ls -F '#{session_name}'` and kills any whose agent ID is not present in `agentService.getAllAgents()`. Catches stragglers from prior Commander crashes where the agent record was deleted but its tmux session was adopted by `init` (`PPID 1`) and kept running. Runs once at boot, before the regular reconnect path so legitimate live sessions are still picked up

### Fixed
- **Building-card port links work over VPN/LAN** — `BossBuildingActionPopup`, `BuildingActionPopup`, `BuildingConfigModal/DockerConfigPanel`, and `toolbox/BuildingItem` were hardcoding `http://localhost:${port}` for the click-through links. Replaced with `http://${window.location.hostname}:${port}` across all 9 spots so the link points to whatever host the user actually loaded the UI from — `localhost` for local dev, the VPN/LAN address otherwise

### Changed
- **Expanded comment on the trailing `cat` in `tmux-helper.ts`** — the `(cat file; cat) | claude …` pattern in the non-`closeStdinAfterPrompt` branch is load-bearing: `sendToTmux()` injects mid-turn input via `tmux paste-buffer`, which only reaches claude's stdin if there is a live reader on the other side of the pipe. A previous attempt to remove the trailing `cat` silently broke mid-turn messaging (paste-buffer succeeded into a dead pane and the input was lost). The expanded comment now spells out *why* the trailing `cat` must stay, with a direct callout to the regression, so future readers don't repeat the mistake

## [1.81.0] - 2026-04-26

### Added
- **WhatsApp integration plugin** — full server module under `src/packages/server/integrations/whatsapp/` (client, routes, config, skill, trigger handler, contact-name cache, message-dedupe) registered in the integration registry alongside Gmail/Slack/Jira/Calendar/Drive. Inbound and outbound messages stream into the app via a new `whatsapp_message` server-to-client WebSocket event with full payload (sessionId, from, fromName, body, timestamp, isGroup, groupName, mediaType, mediaUrl, direction). Client adds a `WhatsAppConfigModal`, a `WhatsAppMessageToast`, an api client, a Settings section ("WhatsApp Integration", searchable), and a new `whatsapp` config-export category persisting `whatsapp-config.json`. Covered by `contact-name-cache.test.ts`, `message-dedupe.test.ts`, and `whatsapp-trigger-handler.test.ts`
- **Multi-URL backend with health-probe failover** — the configured backend URL now stores a JSON array (legacy single-string values migrate transparently). On each connect, the client probes each URL's `/api/health` with a 3 s timeout in priority order (last successful first, then list order) and connects to the first reachable host. The chosen URL is persisted as a separate `tide-active-backend-url` so HTTP calls (not just the WS) target the same host. Settings UI gains add/remove/reorder controls (priority badge, ↑/↓/×) per URL. The `NotConnectedOverlay` reconnect form promotes the typed URL to the top of the list while preserving the others, so LAN+VPN setups survive a manual reconnect
- **Watchdog idle-respawn for wedged Claude subprocesses** — `RunnerWatchdog` now SIGKILLs any process that has been mid-turn (`turnState === 'processing'`) but emitted no events for `TIDE_IDLE_RESPAWN_MS` (default 180 000 ms / 3 min). Catches the failure mode where the Anthropic API socket hangs in TCP retransmits without a process exit; the kill triggers the existing `process_closed → maybeAutoRestart` path so the agent respawns with session resume. A stderr breadcrumb tells the user why. Configurable via the `TIDE_IDLE_RESPAWN_MS` env var; covered by 6 new tests in `watchdog.test.ts`
- **`AgentOverviewPanel` highlights subordinates of the active boss** — when the selected agent is a boss, every subordinate gets a chain-link badge and a quietly breathing gold left-edge "tether" (synced animations, ~2.8 s cycle) so the user can see the reporting graph at a glance. Active card retains its own selection styling (no flicker)
- **`FlatView` empty-state map shows building chips per area** — area cards in the empty-chat overview now render building chips alongside agent chips, bucketed by the same point-in-area test the 3D scene uses. Right-click a chip for the full action menu (open / start / stop / restart / start-all subordinates / boss-specific actions), mirroring `AreaBuildingsPanel`
- **`onBuildingPopup` handler in App** — clicking a building now opens the floating `BuildingActionPopup` anchored to the click instead of immediately opening the modal, matching the agent popup pattern

### Changed
- **`AgentTerminalPane` no longer hides the bookmark `tool_use` chips for skill-related curls** — tracking-status PATCH, taskLabel, notify, and report-task `Bash` calls used to be suppressed entirely (both `tool_use` and `tool_result`); they now render as their styled chip via the existing `bash*Command` parsers, and only the noisy raw `tool_result` JSON dump is hidden. Live and persisted history paths are aligned
- **`FileViewerModal` download is now a real fetch + blob download** — replaced the `<a download>` anchor with an `authFetch`-driven blob download that respects the auth header, surfaces a downloading/error state on the button, and includes the agent's `baseDir` so relative paths download correctly. The previous anchor lost auth on cross-origin backends (the browser strips headers from anchor navigations)

## [1.80.0] - 2026-04-25

### Added
- **Relative-path resolution in `/api/files/*` endpoints** — every read endpoint (`read`, `exists`, `info`, `binary`, `list`, `tree`, `git-original`, `git-diff`) now accepts a `baseDir` query parameter and resolves a relative `path` against it via the new `resolveAndValidateFilePath` helper in `src/packages/server/routes/files.ts`. Absolute paths still pass through unchanged. When neither `baseDir` nor an absolute `path` is provided, the server falls back to its own cwd so file-modal links like `../../../tmp/foo.md` open even from contexts without an explicit agent cwd (spotlight, flat view). Covered by a new `src/packages/server/routes/files.test.ts` suite
- **Codex `error` items surfaced to the UI and to boss agents** — `CodexJsonEventParser` now parses Codex `item.completed` events of type `error` and emits a runtime `error` event carrying the message text. The same text is appended to the next `step_complete.resultText` (prefixed `[Error]`) so boss agents can see subordinate failures in their delegation results. Client-side, the WebSocket handler creates an output entry with `isError: true`, `OutputLine` switches to the new `output-error` class, and the SCSS rule paints a red-tinted background, red border, and an "Error" badge so failures pop out of the stream
- **Public `__seed_auth__.html` dev helper** — small static page in `public/` that seeds `tide-auth-token`, `tide-backend-url`, and view-mode preferences into `localStorage` then redirects to `/#app`. Useful for fresh browser profiles and end-to-end test setup

### Changed
- **`FileViewerModal` now sends `baseDir` to all file endpoints** — passes the agent's `searchRoot` as `baseDir` when calling `read`, `info`, `binary`, `list`, `git-diff`, and `git-original`, and resolves relative paths client-side via the new `resolveAgentFilePath` helper so the modal shows a canonical absolute path before the server response arrives
- **Codex CLI is launched with `--enable multi_agent`** — Codex renamed `[features].collab` → `[features].multi_agent`, and emits a deprecation error every turn when the old key is set in `~/.codex/config.toml`. `CodexBackend` now passes the new flag explicitly so subagent orchestration (`collab_tool_call` items) keeps working without user config changes
- **Mobile `agent-bar` items hit real touch targets** — the bar's items, spawn buttons, and folder dividers were 15×15 px on phones (well below any tap-target floor) and have been resized: 36×36 (mobile portrait, was 15×15), 32×32 (small mobile), 28×28 (small mobile landscape, denser since more agents fit per row). Folder items shrink to ~40% so the hierarchy reads agent-first; status dots, area dots, notification badges, and gaps are scaled proportionally
- **Mobile `FlatView` sidebar drawer is more prominent** — drawer width grows from `min(340px, 86vw)` to `min(380px, 92vw)` and on phones expands to fill the full viewport (`100vw`, no shadow) so the agent list is the dominant surface while open. Box-shadow is heavier and offset for depth, and the backdrop darkens from 0.45 → 0.68 with a 2px blur

## [1.79.0] - 2026-04-24

### Changed
- **`FlatView` middle column header simplified** — removed the `👥 Agents` title from the middle pane. The action buttons (spawn agent / class spawn) already convey what the column is, so the redundant heading just consumed vertical space. The corresponding `.flat-middle__title` font-size override is also dropped from `FlatView.scss` since the rule no longer has a target

## [1.78.0] - 2026-04-24

### Added
- **Mac trackpad two-finger horizontal swipe cycles agents in `FlatView`** — wheel-based fallback for the swipe gesture, since `popstate` alone is unreliable on Safari/Chrome for same-URL `pushState` navigations. The handler is attached to the FlatView wrapper (`{ passive: false }` so it can `preventDefault`) and uses an accumulator + dominance check (`|deltaX| > |deltaY| × 1.5`) before firing — gentle vertical scrolls are not misinterpreted as horizontal swipes. A 250ms idle window resets the accumulator, the trigger threshold is 80px, and a 600ms cooldown after each fire prevents momentum-flick double-triggers. Skipped when the gesture starts inside an inner element with horizontal overflow (e.g. wide code blocks) so existing horizontal scrollers keep working

### Fixed
- **`useBackNavigation` no longer destroys panel-owned forward stacks** — when a `popstate` carries `__flatAgentNav` or `__guakeAgentNav`, the hook now skips the `#app2` buffer re-push and the back-nav modal trigger that the global handler normally fires. Before this fix, the global hash buffer was overwriting the panel's own history entry, killing the prev/next stack `FlatView` and `GuakeOutputPanel` rely on for in-panel agent navigation. Mobile modal-close behavior is preserved — only the buffer re-push and the desktop back-nav modal are gated on `ownedByPanel`

## [1.77.0] - 2026-04-24

### Added
- **Browser back/forward navigation in `FlatView`** — Alt+Left / Alt+Right, trackpad swipe, and mouse side buttons (anything that fires a `popstate`) now cycle the selected agent the same way the prev/next buttons do. Mirrors `ClaudeOutputPanel`'s `__guakeAgentNav` pattern but uses a distinct `__flatAgentNav` history-state marker so the two views coexist without colliding. Each agent selection pushes a new history entry (replace on first init, push thereafter) and `popstate` resolves the target agent from `event.state.__flatAgentNav.agentId` against the live `agentIdSet`. Listeners are scoped to FlatView mount so they tear down cleanly on unmount

### Changed
- **`SubagentInline` shared component extracted** — the inline activity / stream panel for `Task` & `Agent` tool chips moves out of `OutputLine.tsx` (-107 lines) into a new `ClaudeOutputPanel/SubagentInline.tsx` (120 lines) and is now consumed by both `OutputLine` (live) and `HistoryLine` (persisted). The shared `SubagentStreamPanel` keeps the expand/collapse state, recent-3 preview, auto-scroll while working, and entry icons (`tool_use` / `tool_result` / `text`). `VirtualizedOutputList` threads the `subagents` map through to `HistoryLine` so persisted `Task`/`Agent` rows can resolve their subagent by `toolUseId`

### Fixed
- **Subagent stream no longer disappears after a JSONL re-fetch** — once the live `tool_use` chip gets deduped against the persisted history, `HistoryLine` becomes the sole renderer of the `Task`/`Agent` chip. Before this change it had no way to render the inline activity panel, so the `Stream (X events)` block would vanish on panel re-mount even while the subagent was still streaming. `HistoryLine` now matches the `tool_use.toolUseId` against the in-memory `subagents` map (linear scan through entries) and renders `<SubagentInline />` in both the simple-view and full-view branches

## [1.76.2] - 2026-04-24

### Fixed
- **Live tool-use chips no longer disappear after re-selecting an agent** — both `ClaudeOutputPanel/useHistoryLoader.ts` and `CommanderView/useAgentHistory.ts` now short-circuit `shouldKeepOutput` to keep any uuid-bearing live event whose uuid did not match a persisted JSONL entry. The previous fallback (`outputTs > lastHistoryTimestamp`) silently pruned WS events whose timestamps trailed the newest persisted JSONL entry, freezing tool_use / tool_result / subagent-progress chips after a history re-fetch. Legacy outputs without a uuid still go through the timestamp gate

## [1.76.1] - 2026-04-24

### Changed
- **`SubordinateProgressDots` now hides when no subordinate is `working`** — boss agents whose subordinates are all idle (or otherwise non-working) no longer render an empty progress indicator. Reduces visual noise on the agent cards / list rows / flat-view chips when there's no in-flight work to signal

### Fixed
- **`stopAgent` clears tracking-board state on explicit kill** — `runtime-command-execution.ts` now wipes `taskLabel`, `trackingStatus`, `trackingStatusDetail`, and `trackingStatusTimestamp` when an agent is stopped. Previously a killed agent would leave its last-known status (e.g. `thinking`, `working`) lingering on the tracking board indefinitely. Natural task completion is unaffected — that path goes through the agent's own final-turn PATCH, so `need-review` / `can-clear-context` outcomes are preserved

## [1.76.0] - 2026-04-24

### Added
- **`SubordinateProgressDots` shared component** — compact dot visualization of a boss's subordinates colored by agent status, capped at 12 dots with `+N` overflow. Also exports `SubordinateProgressTooltipContent` which renders a full per-subordinate list with status label, a preview line picked from `taskLabel` / `trackingStatusDetail` / `currentTask` / `lastAssignedTask` (in that priority order), todo completion chip (`completed/total todos`), and a relative idle time chip for idle subordinates. Sort order puts free agents (`idle` → `error` → `orphaned` → `waiting_permission` → `waiting` → `offline`) ahead of `working` so the user can see capacity at a glance
- **`AgentHoverTooltip` shared component** — wraps an arbitrary trigger and renders a combined tooltip showing task progress (via `TaskProgressTooltipContent`) and/or subordinate progress (via `SubordinateProgressTooltipContent`) with a divider when both are present. Defaults `triggerStyle` to `display: contents` so it stays transparent to the surrounding flexbox layout, and short-circuits to render children directly when there's nothing to show
- **Boss subordinate indicators across views** — `AgentOverviewPanel` agent cards, `UnitPanel/AgentsList` rows, and `FlatView` map chips now render `SubordinateProgressDots` for boss agents (with their resolved subordinate `Agent[]`) inline next to the existing `TaskProgressDots`, and the headers/chips are wrapped in `AgentHoverTooltip` so hovering exposes the full task list and subordinate roster in a single popover
- **Outdated-version indicator on `AgentBar`** — when the local version is `behind` the npm `latestVersion`, a new `.agent-bar-version-outdated-indicator` link with a `.agent-bar-version-outdated-dot` is rendered next to the version block. Opens https://github.com/deivid11/tide-commander/releases in a new tab and exposes `agentBar.outdatedIndicatorTooltip` / `agentBar.outdatedIndicatorAria` translation defaults
- **`Tooltip.triggerStyle` prop** — lets callers override the default `display: inline-flex` wrapper style. Used by `AgentHoverTooltip` to default to `display: contents` so the tooltip wrapper doesn't break the surrounding layout

### Changed
- **`TaskProgressDots` refactored to expose tooltip content separately** — the dots span no longer wraps itself in a `Tooltip`; consumers compose tooltips externally (e.g. via `AgentHoverTooltip`). The new exported `TaskProgressTooltipContent` component renders the `done/total tasks done` header + per-task list and is used by `AgentHoverTooltip`. Existing callers that still want a standalone tooltip can wrap manually
- **`AgentTerminalPane` hides internal-API bookkeeping calls from the rendered terminal** — `enrichHistory` now skips `tool_use` messages (not just `tool_result`s) whose `toolUseId` matches a suppressed entry, and the live-output deduper drops `Bash` calls whose command matches the tracking PATCH / taskLabel PATCH / notify / report-task curl patterns. The skill-ceremony curls no longer pollute the user-meaningful tool feed. Also adds a `seenToolUseKeys` set keyed on `uuid || toolUseId` to dedupe duplicated tool-use events across history loads
- **`FlatView` map chip native `title` is suppressed when hover content exists** — when an agent has todos or subordinates the `AgentHoverTooltip` takes over, so the chip's `title=` attribute is left undefined to avoid the browser's default tooltip racing the rich one

## [1.75.0] - 2026-04-24

### Added
- **Per-agent TodoWrite snapshot is now persisted on the agent** — the runtime listener intercepts top-level `TodoWrite` tool calls (ignoring sub-agent ones via `parentToolUseId`), parses them with the new `parseTodoWriteInput` helper, and stores the result on `Agent.latestTodos`. New shared types `AgentTodoStatus` and `AgentTodoItem` model the entry shape (`content` + `status` + optional `activeForm`). The snapshot is cleared automatically when the agent transitions back to `idle` so stale task lists never linger across turns
- **`TaskListView` shared component** — extracts the full TodoWrite list rendering (status counts header, per-item icons, content) into `components/shared/TaskListView.tsx` so both the streaming tool feed and the unit panel render the exact same layout from a single source of truth
- **`TaskProgressDots` shared component** — compact dot visualization of an agent's `latestTodos`, capped at 12 dots with `+N` overflow and a hover tooltip listing every task with status icons (`✓`/`▶`/`○`) and a `done/total` header. Lives at `components/shared/TaskProgressDots.tsx`
- **TaskProgressDots in agent cards and list items** — the `AgentOverviewPanel` agent cards and the `UnitPanel/AgentsList` rows both render the dots inline next to the name when `latestTodos` is present, giving a glance-able progress signal without opening the agent
- **TaskListView in `SingleAgentPanel`** — the unit panel now shows a `unit-task-list` block under the current task, rendering `TaskListView` when `latestTodos` exists or a translated "No active tasks" empty state otherwise. New `unitPanel.noActiveTasks` translation key
- **`ConfirmModal` shared component** — reusable TC-styled confirmation dialog at `components/shared/ConfirmModal.tsx` replacing native `window.confirm()`. Backed by the existing `.modal-overlay` / `.modal` / `.confirm-modal` styles so it inherits the dark theme, focus-traps the destructive button on open, supports Escape-to-close (capture phase so it wins over inner handlers), and exposes a `variant: 'danger' | 'primary'` toggle. Auto-closes on confirm via the wrapper handler
- **`removeAgentTitle` / `removeAgentMessage` translations** — split out of the old single-line `removeAgent` confirm so the new modal can show a proper title and a separate body line

### Changed
- **`AgentOverviewPanel` remove-agent flow uses `ConfirmModal`** — the trash-icon menu action now opens the modal instead of `window.confirm()`, with a typed `removeAgentConfirm` state holding `{ agentId, name }` until the user confirms or cancels
- **`TerminalHeader` remove-agent flow uses `ConfirmModal`** — same swap for the terminal header's remove button so the styling matches the rest of the app
- **`FlatView` remove-agent flow uses `ConfirmModal`** — the flat-view delete action moves off `window.confirm()` and onto the shared modal with the same confirm-state pattern
- **`SingleAgentPanel` "Clear all patterns" + "Terminate agent" flows use `ConfirmModal`** — `handleClearAllPatterns` and `handleKill` now open dedicated modals (`clearPatternsConfirmOpen`, `terminateConfirmOpen`) and the destructive work runs from the `onConfirm` handler. The terminate dialog also surfaces the existing "This action cannot be undone." line via the modal's `note` prop
- **`ToolRenderers.TodoWriteInput` delegates to `TaskListView`** — the inline TodoWrite renderer in the streaming tool feed loses its duplicated layout code and forwards parsed todos to the shared component, eliminating drift between the two surfaces
- **`ToolRenderers.ToolSearchInput` header layout overhauled** — selected tools now render as inline chips (capped at 4 with `+N` overflow) instead of a comma-separated meta-pill; the `Tools:` and `ToolSearch` badges are gone; `Fallback` / `Show` pills only render when their values are real (not `-`); the expand toggle is conditional on having query params and shows the param count in its label (`3 params`); the expanded panel drops the redundant tool list + section title and just shows the parameter rows. The collapsed "Collapsed" placeholder is removed entirely

### Fixed
- **`agent-service.updateAgent` clears `latestTodos` on idle transitions** — when an agent moves from any non-idle status into `idle`, the in-flight TodoWrite snapshot is wiped (unless the same update payload explicitly sets `latestTodos`). Prevents the previous turn's task list from ghosting on the next one

## [1.74.0] - 2026-04-24

### Added
- **Agent ID is now visible and click-to-copy in SingleAgentPanel** — a new `.unit-id` row under the unit name shows the full agent ID in a monospace style; clicking copies it to the clipboard with a success toast (and an error toast if `navigator.clipboard.writeText` rejects). Useful for grabbing IDs to paste into curl calls / boss-delegation messages without hunting through the agent object
- **Agent ID row in `AgentInfoModal`** — the terminal's agent info modal now renders a dedicated "Agent ID" line alongside Status / Class / Permission / Session, backed by new `terminal:agentInfo.agentId` translation key

### Changed
- **Russian locale cleanup** — dropped the orphan `unitPanel.otherAgents` key carried over from v1.73.0's removal of the Other Agents section

## [1.73.0] - 2026-04-24

### Added
- **Claude `effort` field is now persisted to disk** — `StoredAgent` gains an `effort` property so the Claude reasoning-effort setting (`low`/`medium`/`high`/`xHigh`/`max`) survives server restarts and agent reloads. Previously the value lived only in memory and was lost between sessions

### Changed
- **SingleAgentPanel 3D preview enlarged** — the agent model preview grows from 80x80 to 180x130 for a more prominent view of the unit
- **"Other Agents" list removed from SingleAgentPanel** — the in-panel sidebar of other agents (with its collapsible header and click-to-switch row) has been cut; agent switching stays available through the overview panel and other navigation affordances, and the single-agent panel now focuses strictly on the selected unit

## [1.72.0] - 2026-04-24

### Added
- **Resizable Flat view columns** — the chat/agents and chat/inspector dividers are now drag-resizable splitters (`.flat-splitter`) backed by CSS custom properties `--flat-middle-width` / `--flat-inspector-width`. Widths persist in localStorage (`tide-flat-middle-width`, `tide-flat-inspector-width`) and respect per-column minimums; the inline overrides cascade over the `@media (min-width: 1400px)` defaults. Splitters hide on mobile where the agents column becomes a drawer. New `getStorageNumber` / `setStorageNumber` helpers in `storage.ts`
- **Mobile FAB menu parity with desktop rails** — `MobileFabMenu` now exposes view-mode switcher, workspace switcher, Spawn Agent, Spawn Boss, New Building, New Area, and Organize All directly in the slide-out menu. Previously these actions were only reachable from the desktop-only FAB rail, stranding mobile users
- **`tmux-helper.test.ts`** — unit coverage for the tmux helper (pane PTY setup, send-keys routing, file tailer behaviour)

### Changed
- **`handleOrganizeAll` extracted to a shared callback** in `App.tsx` so the desktop FAB and mobile menu share one implementation
- **`report-task` endpoint truncates the echoed original task description to 160 chars** — the boss already has the delegation in its own conversation history, so replaying the full text wasted tokens and risked overflowing stream-json line limits. A short label still disambiguates which delegation the report refers to

### Fixed
- **tmux pane PTY now starts in raw mode (`stty raw -echo`)** — the Linux n_tty canonical-mode line buffer (~4096 bytes `N_TTY_BUF_SIZE`) was silently truncating long stream-json messages sent through the `(cat; cat) | claude` pipeline and killing the CLI with `Error parsing streaming input line: Unterminated string`. Raw mode disables the line-discipline buffer so bytes flow through unchanged
- **Per-agent tmux paste buffer name** — replaced the shared `tc-input` buffer with `tc-input-<agentId>` to eliminate cross-agent races on concurrent sends; added `-r` to `paste-buffer` so LF is preserved (now that the pane is raw, tmux's default LF→CR translation would corrupt claude's line terminator)
- **Zombie tmux session detection in watchdog** — the wrapping `(cat; cat) | claude` pipeline keeps the tmux session alive even when the inner CLI dies (e.g. claude exits on a stream-json parse error but `cat` is still hung on the pane stdin). `RunnerWatchdog` now verifies the expected CLI binary is still in the pane's process tree via new `isTmuxPaneCommandAlive()`; the basename is captured in `ActiveProcess.tmuxExpectedCommand` at spawn time
- **Mid-turn process deaths surface as `status: error`** — `ClaudeRunner` previously queued for silent recovery. When `turnState !== 'waiting_for_input'` at death, the agent card now flips to `error` with a task message so the user can see a recovery attempt is in flight. The next `init` event flips it back to `working` automatically once recovery succeeds
- **File tailer partial-line buffer** — `createFileTailer` now keeps a partial-line buffer across polls so long JSON events (codex lines frequently exceed 20KB) are delivered to `onLine` as complete lines rather than mid-line fragments

## [1.71.0] - 2026-04-24

### Added
- **One-shot cron triggers** — cron triggers can now be marked "Run once" to fire exactly once at a specific datetime instead of on a recurring schedule. New `runOnce` / `runAt` / `completedAt` / `missedAt` fields on `CronTrigger.config`; `cronService.scheduleOnce()` arms a one-shot via `setTimeout` (with chained waits beyond the 24.8-day `setTimeout` ceiling); on server restart, one-shots whose `runAt` slipped past within a 5-minute grace window fire immediately, and overdue ones are marked `missed` + auto-disabled. UI in TriggerManagerPanel has a "Repeats" vs "Run once" selector, a `datetime-local` picker, and status chips (`Once · pending` / `Once · completed` / `Once · missed`)
- **Auth Token field on the connect screen** — `NotConnectedOverlay` now exposes an `X-Auth-Token` input (with show/hide toggle) alongside the backend URL, so users connecting to an auth-enforcing server can paste their token without hunting for Settings first
- **Boss spawn from area context menu** — right-clicking an area header in the overview panel now offers "New Boss" (opens `BossSpawnModal` pre-configured for that area) and "New Area" (creates a new area placed at a free spot near the current one). A new `tide:open-boss-spawn-modal` global event carries `{ areaId, position }`; `BossSpawnModal` infers `cwd` from the area's `directories` or the most common cwd among its member agents
- **Codex reasoning effort in AgentEditModal** — the reasoning-effort dropdown (`none`/`minimal`/`low`/`medium`/`high`/`xhigh`) is now editable post-spawn, matching the SpawnModal; previously only the spawn form exposed it
- **Unsent-draft indicator on agent cards** — when an agent has text sitting in its input box, a small pencil icon appears next to the agent name on the overview panel. Backed by a new `agentDrafts.ts` store (`setAgentDraft` / `useHasDraft`) wired into `useTerminalInput` so the indicator appears as the user types and clears when the input is emptied
- **Debug panel in Flat UI chat** — the Flat UI chat header menu now has a "Show Debug Panel" toggle that opens the same `AgentDebugPanel` as the Guake terminal (auto-enables `agentDebugger` on first open), with the chat wrapper widening via the `--with-side-panel` class
- **Mobile agents drawer in Flat UI** — below the mobile breakpoint, the left agents column now renders as a slide-in drawer toggled by a new button; tapping an agent auto-closes the drawer so the user lands directly in chat
- **`areaPlacement.ts` helper** — `findFreeAreaSpot(areas, w, h, origin)` picks a non-overlapping location near an origin point, used by the new "New Area" context action

### Changed
- **Left-edge FAB rail unified into a single flex column (`.fab-rail`)** — replaces the stack of per-button `position: fixed; top: <Xpx>` rules that used to spill off the bottom on short viewports (mobile landscape, small tablets). The rail neutralizes each button's hardcoded positioning and flows them as a flex column, so every icon stays reachable. Popovers (view-mode, workspace) still anchor absolutely without needing `overflow` on the container
- **"Working" state on Flat UI map chips is much more alive** — the single-layer shimmer was replaced with a layered animation: double shimmer band at different phases, iridescent hue-cycling aura behind the chip, breathing glow/border pulse, bouncy pulsing dot, and twinkling sparkle dots. Every layer runs at its own tempo so the chip never loops in lockstep
- **Notification click in Flat view no longer opens the Guake overlay** — `openAgentTerminalFromNotification` now skips `setTerminalOpen(true)` when `viewMode === 'flat'`, so the fixed Guake overlay (z-index 200) stops covering the inline Flat chat the user is trying to land on

### Fixed
- **Area colour tint on overview agent name chip removed** — the inline background/border tint on `.aop-agent-name` was overriding the area's left-border accent and making the name chip look mismatched under hover/selection states

### Added
- **Boss crown + provider icon on Flat UI map chips** — agent chips in the empty-state area map now render a gold crown for boss agents and the provider logo (Claude / Codex / OpenCode) alongside the agent name
- **Context-usage gauge on Flat UI map chips** — each chip has a 2px bar pinned to its bottom edge showing context usage with color-graded fill (green <40%, yellow ≥40%, orange ≥60%, red ≥80%); tooltip shows the exact `used/total k` breakdown, reusing `getDisplayContextInfo()` so the statusbar and map chip share one source of truth
- **Codex reasoning effort selector** — SpawnModal now exposes a reasoning-effort dropdown for Codex agents (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`) with icons; CodexBackend translates the selection to `-c model_reasoning_effort=<value>` on the codex CLI invocation. New `CodexReasoningEffort` type and `CODEX_REASONING_EFFORTS` registry in `shared/agent-types.ts`

### Changed
- **Stdin-open backends (Claude) write directly regardless of turnState** — `sendMessage` no longer gates on `turnState === 'waiting_for_input'` for Claude; mid-turn messages go straight to Claude's `--input-format stream-json` stdin and Claude handles interleaving per its own protocol, so users no longer wait for `step_complete` before the message is seen. Same logic applies to the tmux send-keys path.

### Fixed
- **Stdin-closed backends (Codex / OpenCode) always interrupt and respawn on a new prompt** — `runtime-command-execution.ts` removed the `turnState !== 'waiting_for_input'` gate. Reason: OpenCode's NDJSON emits `step_finish` per LLM step, so `turnState` oscillates `processing ↔ waiting_for_input` within a single conversational turn; the old gate stranded prompts that arrived during those brief idle windows because the queue-respawn path only fires on process exit, which wasn't happening
- **Defensive stdin fallback** — if the child's stdin pipe is unexpectedly non-writable (pipe closed, process dying), the message is now queued for recovery via the respawn path instead of being dropped with an error
- **tmux send-keys routing clarified** — only queue on tmux when the backend closes stdin (codex); claude in tmux goes through the trailing `cat` in `(cat file; cat) | claude` and receives send-keys writes as additional stream-json lines regardless of turnState

## [1.69.0] - 2026-04-23

### Added
- **Edit / Delete agent context menu actions** — right-click on an agent card in the overview panel now exposes "Edit Agent" and "Delete Agent"; Delete opens a confirmation dialog and removes the agent from the server (`store.removeAgentFromServer`) rather than just the view
- **Right-click menu on Flat UI agent chips** — the empty-state area map in Flat UI now supports right-click on any agent chip with Edit Agent / Open Chat / Delete Agent actions, mirroring the overview panel UX
- **`tide:open-agent-edit` global event** — dispatching this CustomEvent with `{ agentId }` opens the AgentEditModal from any surface, so surfaces like the Flat map and overview panel don't need direct modal wiring
- **Codex `gpt-5.5` model** — registered the next-generation frontier Codex model alongside existing 5.4/5.3/5.2/5.1 entries

### Changed
- **System message styling** — runtime/session banners are now a single-row flex layout with per-emoji variant: 🛑 interrupt, ✅ success, ⚠ warn, ❌ error, 📋 task, 🔄 refresh all map to distinct Phosphor icons and CSS accent classes; larger base font (11.5px), tighter padding, and flattened markdown wrapper so the icon sits on the text baseline
- **Flat UI empty-state class rename** — `flat-empty-*` → `flat-map-*` across the empty-state area map (cards, chips, headers) to better reflect that the component is a map overview, not just an empty placeholder

### Fixed
- **Mid-turn prompts on Codex/OpenCode now interrupt and restart** — when the user sends a new prompt while a stdin-closing backend is mid-turn, `runtime-command-execution.ts` calls `runner.stop()` and re-spawns with the new prompt (and `clearQueue=true`) instead of queuing for post-turn delivery, matching user intent to replace pending work; safe for tmux mode because only the agent's detached tmux session is killed
- **Queued messages no longer lost when codex/opencode tmux sessions die** — `runner.watchdog_missing_process` now respawns with session-resume when `turnState === 'waiting_for_input'` and the queue is non-empty, fixing the silent loss caused by tmux launcher PIDs not emitting 'close' events
- **tmux send-keys path queues correctly for stdin-closing backends and mid-turn** — `codex` is launched as `cat <file> | codex` so its stdin is the pipe, not the tmux pane; `send-keys` would have written to a pane codex wasn't reading. Mid-turn messages on any backend now also go through the queue instead of send-keys
- **No more double-delivery on stdin-closing backends** — the stdin watchdog is skipped for backends that close stdin after the initial prompt, preventing the watchdog's onRespawn path and the queue-drain path from both delivering the same command
- **Queue drain defers to respawn for tmux + stdin-closed** — the drain step leaves the message queued when the backend closes stdin in tmux mode, letting the watchdog respawn path handle delivery instead of doing an unreliable send-keys
- **New `RuntimeRunner.closesStdinAfterPrompt()` method** — runners expose whether their backend consumes stdin once then closes, so command-execution logic can pick the right delivery path without hard-coded backend checks

## [1.68.0] - 2026-04-23

### Added
- **Agent info modal in Flat UI** — clicking the chat header now opens an `AgentInfoModal` showing the agent's full details; the header doubles as a toggle button with pressed state and tooltip
- **Model · Effort chip in headers** — both the Flat UI chat header and the Guake-style terminal header now show a provider icon plus a compact "Model · Effort" chip (Claude shows model + reasoning effort; Codex/OpenCode show model only)
- **Mouse back/forward gestures in Flat UI** — physical mouse side buttons (buttons 3/4) now navigate agent history in Flat UI, mirroring the 3D overlay
- **Close-chat button in Flat UI** — a new close control deselects the active agent from within the chat wrapper
- **Workspace filter applied to Flat UI** — agent and area lists in Flat UI now honor the active workspace filter via `isAgentVisibleInWorkspace` / `isAreaVisibleInWorkspace`

### Changed
- **Spotlight agent results sorted by recency** — within each Spotlight group, agents are now ordered by most-recent activity so the freshest agents surface first
- **WorkspaceSwitcher instances stay in sync** — multiple mounted switchers (App shell + AgentOverviewPanel) now subscribe to shared workspace state so changes in one propagate to the others
- **Auto-expand area on cross-surface agent selection** — selecting an agent from TrackingBoard, FlatView chat, or the 3D scene now auto-expands its containing area in `AgentOverviewPanel` so the highlighted card is actually visible
- **Sidebar hidden in Flat view** — the App-level sidebar and its edge toggle are suppressed while Flat view is active since Flat UI owns its own middle column
- **Codex prompts delivered via stdin** — `CodexBackend` now streams the assembled prompt through stdin (passing `-` as the PROMPT positional) instead of argv, avoiding tmux's ~16KB argv limit that silently rejected spawns for large prompts (skills + system prompt + class instructions)

### Fixed
- **Claude restart policy no longer wedges single-shot backends** — normal-exit conditions (`SIGINT`/`SIGTERM`, `turnState=waiting_for_input`, `exitCode === 0`) are now evaluated BEFORE the "runtime < 5s" crash heuristic, so Codex-style backends that legitimately finish a turn in under five seconds are recognized as completed instead of being flagged as crashed

## [1.67.0] - 2026-04-23

### Added
- **Flat UI view mode** — new full-page flat UI alternative to the 3D scene, selectable from the view-mode switcher
- **Area building buttons + embedded resizable terminal in Flat UI** — quick-create building controls per area and an embedded terminal pane that shares sizing preferences with the 3D overlay
- **GuakeGitPanel + AreaBuildingsPanel reused as Flat UI side panels** — the git and area-buildings panels from the 3D overlay now mount inside Flat UI so both surfaces share one source of truth

### Changed
- **Flat UI polish** — general layout and interaction refinements to the Flat UI view
- **CSS class rename: `exp-*` → `flat-*`** — leftover experimental class names in Flat UI have been aligned with the `flat-` prefix
- **Component rename: `Scene2DExperimental` → `FlatView`** — the experimental 2D scene is now the stable `FlatView`, and the clear-subordinates flow was tightened to match the 3D overlay

### Fixed
- **npm audit vulnerabilities resolved** — dependency updates to clear reported advisories

## [1.66.2] - 2026-04-22

### Changed
- **Toolbox backdrop now dims the page** — replace the transparent backdrop with a 30% black overlay that fades in (`pointer-events: none`, so it stays click-through); the panel is still closed via the X button or Escape

## [1.66.1] - 2026-04-22

### Changed
- **Simpler agent-switch path in terminal pane** — drop the `pendingSelectionScrollRef` indirection and the cold-switch `requestAnimationFrame`; remove `key={agentId}` from the virtualized output list so the same instance is reused across switches instead of being unmounted and rebuilt
- **Larger virtualizer overscan** — bump `VirtualizedOutputList` overscan from 10 to 25 items so more rows are pre-rendered above/below the viewport, reducing flashes of blank space during fast scrolling
- **Tracking-board card detail is now single-line ellipsis** — replace the 2-line `-webkit-line-clamp` clamp with `white-space: nowrap` + `text-overflow: ellipsis` for tighter, more predictable card sizing in both the sidebar and guake-terminal tracking boards

## [1.66.0] - 2026-04-22

### Added
- **Automatic hourly backups** — in-process scheduler backs up all config JSON files and the SQLite event database every hour with content-signature dedup (skips unchanged data); rotation keeps 8 newest hourly + 1 from each of the 2 most recent prior days (~10 total); default enabled for all installs
- **Backup & Restore skill** — new built-in agent skill documenting backup architecture, listing/inspecting/comparing backups, and step-by-step restore procedures (single file, full directory, SQLite-only)
- **Backup toggle in Settings** — Data section now includes an "Hourly Backups" toggle with status info (backup directory, last run time, error state)

## [1.65.1] - 2026-04-22

### Changed
- **Faster agent switching in terminal pane** — when switching to an agent whose history is already cached, skip the fade-out so content appears instantly; on cold switches, drop one redundant `requestAnimationFrame` so the scroll-to-bottom happens a frame earlier; tighten the auto-pin-to-bottom watchdog (1 stable frame instead of 3, 1.5s timeout instead of 8s); shorten history fade-in to 50ms / 0.1s slide

## [1.65.0] - 2026-04-22

### Added
- **Opencode provider integration** — new `OpencodeModelSelect` UI component, opencode API client, and `GET /api/agents/opencode/models` endpoint (1h cached, with `?refresh=1` bypass) that shells out to the `opencode models` CLI to populate the picker
- **Boss spawn enhancements** — boss agents can now spawn subordinates with `model`, `codexModel`, `opencodeModel`, `effort`, `provider`, `initialSkillIds`, `customInstructions`, `codexConfig`, and `permissionMode`; class default skills are auto-assigned alongside any explicit ones
- **Runtime stop `clearQueue` flag** — `RuntimeRunner.stop` / `stopAll` now accept an optional `clearQueue` argument so callers can choose whether queued work is dropped on stop

### Changed
- **Tracking status renamed `writing` → `thinking`** — the "agent is forming a plan" tracking status is now called `thinking` across shared types, client selectors/tracking board, and the built-in `task-label`, `agent-tracking`, and boss-instructions skills
- **Store fallback for `send_command`** — when the store's cached `sendMessage` is unavailable, agent command dispatch now dynamically imports the websocket send module so commands queue correctly while disconnected

## [1.64.1] - 2026-04-21

### Changed
- **Slack skill docs** — expanded user-mention guidance: explicit `<@USERID>` syntax (plain `@Name` does not ping), lookup-then-embed flow, broadcast tokens (`<!channel>`, `<!here>`, `<!everyone>`, `<!subteam^…>`), and a note that the user search endpoint requires `users:read` (+ `users:read.email` for email matches)

## [1.64.0] - 2026-04-21

### Added
- **Slack emoji reactions** — new `/api/slack/reactions/add` endpoint to react to messages (`reactions:write` scope); raw eye emoji chars auto-normalize to `eyes`; `already_reacted` is silently ignored
- **Slack auto-ack on triggers** — bot now auto-reacts with `:eyes:` when a Slack trigger fires, as a visual acknowledgement; fire-and-forget so failures never block triggers. Disable via `SLACK_REACT_ON_TRIGGER=false`
- **`writing` tracking status** — new tracking status group for agents currently producing output, surfaced in the client tracking board and selectors

### Changed
- **Slim PATCH /api/agents/:id response** — endpoint now returns only the fields agents care about (id, name, status, trackingStatus, taskLabel, lastActivity, isBoss) instead of the full agent object; full state still broadcast via WS `agent_updated`. Reduces agent context bloat from multi-KB `lastAssignedTask`/`currentTask` strings on frequent PATCHes
- **Tracking / task-label skill docs** — refreshed built-in skill instructions for agent-tracking and task-label

## [1.63.0] - 2026-04-21

### Added
- **Jira attachments** — new endpoints to list issue attachments, list comment-referenced attachments, download a single attachment via auth-handled proxy, and bulk-download all issue attachments server-side to a filesystem path
- **Slack file upload** — upload files/images to Slack via multipart or base64 JSON using Slack's new two-step files API (`files:write` scope), with optional `channelId`, `initialComment`, `threadTs`, `title`
- **Slack file read/download** — list files with filters, fetch metadata, stream binary via authenticated proxy, or save directly to disk server-side (`files:read` scope); `files: [...]` now included on Slack message responses
- **Slack trigger file vars** — `slack.fileCount`, `slack.fileIds`, `slack.fileNames` exposed to trigger templates; LLM event formatting now lists attachment names and mimetypes

## [1.62.0] - 2026-04-21

### Added
- **Bulk reasoning effort** — bulk change-model endpoint now accepts an optional `effort` field for Claude agents, letting you set low/medium/high/xHigh/max (or clear it) across many agents at once
- **Expandable terminal input** — new expand/collapse control on the terminal input area, plus upload-in-progress indicator with translated labels
- **File explorer language coverage** — syntax highlighting and file-type constants expanded with many additional languages and extensions

### Changed
- **Pasted text chip** — refined attachment chip rendering with updated layout and styling in the terminal input
- **Overview panel styling** — polished guake-terminal overview panel visuals

## [1.61.1] - 2026-04-21

### Fixed
- **File viewer markdown padding** — rendered markdown in the code viewer now has breathing room with consistent padding on all sides for easier reading

## [1.61.0] - 2026-04-20

### Added
- **Copy Markdown source** — DiffViewer now shows a "Copy Markdown" button when viewing markdown files in modified-only mode, copying the raw source text to clipboard

### Changed
- **Keyboard shortcut meta key** — `meta` modifier is now handled independently from `ctrl`; shortcuts can require Meta/Cmd alone without triggering on Ctrl, enabling proper Mac-only bindings
- **Language support cleanup** — removed Java and PHP CodeMirror/Prism language packages; JVM files (`.kt`, `.groovy`, `.scala`) now use C++ highlighting as a lighter-weight fallback

## [1.60.0] - 2026-04-20

### Added
- **Copy as rich text** — new button on conversation output and history lines copies formatted markdown content (with inline styles) to clipboard, with visual feedback on success or error

### Changed
- **Landing site** — Astro docs now served under `/docs` base path; Vite landing build now uses the legacy static layout as its root

## [1.59.0] - 2026-04-20

### Added
- **Scene simple mode** — new terrain option that renders a dark background with day-level lighting, hiding all decorative elements (sky, trees, clouds, lamps, grass, house); configurable via Settings

### Changed
- **Agent model preloading** — custom models are now only preloaded for classes that have visible agents in the scene, reducing unnecessary asset loading on startup

## [1.58.0] - 2026-04-20

### Added
- **OpenCode SQLite session reading** — session-loader now reads OpenCode sessions directly from `~/.local/share/opencode/opencode.db`, with legacy filesystem layout as fallback
- **OpenCode reasoning/thinking events** — `OpencodeJsonEventParser` now handles `reasoning` event type; thinking-only turns emit a placeholder instead of appearing to hang
- **Astro landing page** — new documentation site under `src/packages/landing/` replacing the old static HTML/JS/CSS
- **Docker entrypoint script** — added `entrypoint.sh` for containerized deployments
- **Null-activity stale fallback** — agents stuck in `working` with no resolvable session file auto-flip to idle after 30 seconds

### Changed
- **SpawnModal defaults** — Chrome disabled by default; default model changed to `opus[1m]`; default effort changed to `xHigh`
- **SpawnModal random class** — respects `DEFAULT_AGENT_CLASS` storage preference for random class pre-selection on open
- **ANSI stripping** — comprehensive escape sequence removal (CSI, OSC, nF, Fe) replacing the previous partial regex
- **Terminal JSON viewer** — automatically unwraps curl `/api/exec` wrapper responses to display inner command output as JSON
- **OpenCode context tracking** — OpenCode agents now mirror Claude behavior: `usage_snapshot` values are preserved across `step_complete`, preventing cumulative inflation

### Fixed
- **Orphaned OpenCode agents** — agents with unresolvable session files and no live process no longer remain stuck in `working` state indefinitely

## [1.57.0] - 2026-04-20

### Added
- **Custom Instructions per agent** — new textarea field in AgentEditModal lets you append custom instructions to any agent's system prompt; persisted via store and API
- **Docker support** — added `docker-compose.yml`, `.dockerignore`, and updated `Dockerfile` for containerized deployment
- **OpenCode SVG icon** — replaced generic icon with proper OpenCode logo in SpawnModal and AgentEditModal provider selector

### Changed
- **SpawnModal layout** — model selection and effort/browser controls split into separate rows; model select buttons now wrap instead of overflow
- **Jira client** — removed redundant `startAt` field from JQL query body

## [1.56.0] - 2026-04-20

### Added
- **JSON viewer in terminal** — bash tool output that is valid JSON is now rendered as a collapsible interactive tree in `TerminalModals`, with syntax-highlighted keys, values, and inline collapse/expand at depth ≥ 2
- **Class search filter in AgentEditModal** — new text input filters both custom and built-in agent classes by name as you type; clears on modal reset

### Fixed
- Jira client minor fix
- Toolbox and terminal tool styles updated

## [1.55.2] - 2026-04-20

### Fixed
- **Swipe gesture refactor** — `useSwipeGesture` now applies transforms directly via `containerRef` instead of React state, eliminating re-render jank; swipe direction exposed as `isDragging`/`indicatorDirection` booleans replacing the raw `swipeOffset` float
- **Terminal header swipe classes** — `TerminalHeader` now receives `isSwipingLeft`/`isSwipingRight` booleans instead of `swipeOffset`, making CSS class application more reliable
- Runtime command execution minor fix

## [1.55.1] - 2026-04-20

### Fixed
- **Mobile bottom stack layout** — `AgentBar` and `MobileBottomMenu` are now wrapped in a measured `mobile-bottom-stack` div; a `ResizeObserver` sets `--mobile-bottom-stack-height` so the terminal input sits exactly above the stack instead of overlapping it
- **Tracking status icons use Icon component** — `getTrackingStatusIcon` replaced with `getTrackingStatusIconName` + `Icon` component in `HistoryLine` and `OutputLine` for consistent icon rendering
- Mobile responsive style refinements

## [1.55.0] - 2026-04-19

### Added
- **Icon component** — new `Icon` component (`src/packages/client/components/Icon.tsx`) providing a unified icon system; built-in agent class icons (scout, builder, debugger, architect, warrior, support, boss) now render via `Icon` instead of emoji fallbacks in `AgentIcon`
- **New store selectors** — added `src/packages/client/store/selectors.ts` with reusable Redux selectors for agent class lookups

### Changed
- **Reliable mid-turn message delivery** — messages sent to an agent that is currently processing are now queued and delivered via `drainMessageQueue` once the turn completes, preventing silent drops that occurred when writing to stdin mid-turn
- **Spotlight and context menu files converted to `.tsx`** — `useSpotlightSearch`, `utils`, and `contextMenuActions` migrated from `.ts` to `.tsx` for JSX support

### Fixed
- Various UI component refinements across terminal output, tracking board, git panel, and mobile styles

## [1.54.1] - 2026-04-18

### Fixed
- **MobileBottomMenu hidden when sidebar is open** — menu now accepts a `sidebarOpen` prop and returns null while the sidebar is visible, preventing it from overlapping the panel; also removed the unused `useMobileView` hook from the component

## [1.54.0] - 2026-04-18

### Added
- **`opus[1m]` model** — new Tide Commander model label representing Opus 4.7 running with the 1M-token context beta; translates to `claude-opus-4-7` in the CLI, with `contextWindow: 1_000_000` in the metadata and correct limit propagation through `agent-service`, `agent-handler`, `llm-matcher-service`, and `backend.ts`
- **Bulk change-model** — new `POST /api/agents/bulk/change-model` endpoint and matching `bulkChangeModel()` API client let you switch model/provider for multiple selected agents at once; `BulkManageModal` gains a provider + model picker and a "Change Model" confirm step
- **Mobile bottom menu** — new `MobileBottomMenu` component provides a bottom navigation bar on mobile 3D view with quick-access buttons for Search, Tracking, Spawn, Commander, and Settings
- **Global search in FAB / mobile menu** — `FloatingActionButtons` and `MobileFabMenu` now expose an "Open Spotlight" (global search) button

### Changed
- **`CLAUDE_MODELS` metadata** — each entry now carries a `contextWindow` field (200k or 1M) used as the authoritative source for context limit derivation across the server, replacing the previous hardcoded 200k default
- **`getDefaultContextLimit`** — reads `CLAUDE_MODELS[model].contextWindow` so newly added larger-context models are picked up automatically without code changes
- **`initAgents`** — re-derives `contextLimit` from model metadata on startup so agents migrated to `opus[1m]` immediately show 1M context instead of the stale persisted 200k
- **`handleUpdateAgentProperties`** — immediately updates `contextLimit` and drops stale `contextStats` when the model changes, so the UI reflects the correct window size without waiting for the next modelUsage event
- **`VALID_CLAUDE_MODELS`** — now derived from `Object.keys(CLAUDE_MODELS)` (single source of truth) instead of a manually maintained `Set`
- **Sidebar closes on agent select** — tapping an agent on mobile now closes the sidebar

## [1.53.0] - 2026-04-18

### Added
- **Rich notification images** - `AgentNotification`, `POST /api/notify`, and the `SendNotificationMessage` WebSocket payload now accept optional `iconUrl` (round/large icon) and `imageUrl` (expanded big-picture) PNG URLs
- **Android large-icon / big-picture rendering** - `WebSocketForegroundService` downloads the PNGs asynchronously off the main thread via OkHttp, posts a plain notification immediately for low-latency delivery, then upgrades it in place once the bitmaps arrive (hides the round thumbnail on expand per platform guidance)

### Fixed
- **Mobile swipe breaking `position: fixed` descendants** - `_mobile-swipe.scss` no longer applies `transform: translateX(0)` or `will-change: transform` at rest, which was establishing a containing block and trapping the input wrapper's viewport-relative positioning. These properties are now only set on the active swipe/animation state classes

## [1.52.0] - 2026-04-18

### Added
- **Curl card renderer** - New `CurlCard` component and `curlParser` that detect curl commands in agent output and render them as structured cards (method, URL, headers, body) with their own stylesheet
- **Agent progress indicators in boss context** - Boss "Team Context" panel now shows per-subordinate `AgentProgressIndicator` with inline truncated markdown previews of their latest activity

### Changed
- **ANSI terminal palette** - Replaced the saturated standard/bright ANSI color table with a Nord-inspired, desaturated palette for better readability in the terminal output
- **Boss subordinate context percent** - `gatherSubordinateContext` now mirrors the `guake-agent-context` UI calculation byte-for-byte so every TEAM CONTEXT line matches the subordinate's UI bar
- **Terminal history & tracking board styles** - Substantial SCSS overhaul across `_history.scss`, `_tracking-board.scss`, `_output.scss`, and `_sidebar-tracking-board.scss` for tighter visual alignment
- **Tracking board selection callback** - Extracted and memoized via `useCallback` in `GuakeOutputPanel` to avoid re-creating the handler on each render
- **Team Context locale key** - Collapsed the pluralized `teamContext_one` / `teamContext` pair to a single `"Team Context"` string across all 10 locales

### Removed
- **Unused code** - Dropped the `store` import in `AgentTerminalPane`, the `HTTP_METHODS` constant in `curlParser`, and the `buildCapabilitiesSection` function (plus its now-orphan imports) in `subordinate-context-service`

## [1.51.0] - 2026-04-17

### Removed
- **Supervisor feature** - Removed the Supervisor service, UI, API routes, translations, and config entries
- **Picture-in-Picture window** - Removed the PiP agents view, the FAB entry point, and the `useDocumentPiP` hook
- **Snapshot system** - Removed the snapshot save/load UI, server routes, store, types, and tests
- **Tool History panel** - Removed the standalone tool-history component and its styles
- **fileTracker service** - Removed the unused server-side file tracker

### Added
- **Commander URL helper** - New `getCommanderBaseUrl()` utility that resolves the commander base URL from `process.env.PORT` at call time, replacing hardcoded `http://localhost:5174` usage in dynamic prompts and skill bodies

### Changed
- **Boss delegation prompts** - Subordinate task delegation now uses the runtime-resolved commander URL so report-task curls reflect the actual port the commander is listening on
- **UI surfaces** - Substantial refactor across Spotlight, AgentBar, AppModals, FloatingActionButtons, MobileFabMenu, UnitPanel, ClaudeOutputPanel, and CommanderView alongside the feature removals
- **Locale strings** - Updated `common`, `errors`, `notifications`, and `terminal` namespaces across all 11 locales to drop removed-feature copy
- **Documentation** - Updated `README.md`, `docs/asyncapi.yaml`, `docs/views.md`; removed `docs/snapshots.md`

### Fixed
- **command-handler / boss-response-handler tests** - Added the new `getCommanderBaseUrl` export to the `../../utils/index.js` mocks so the tests can import the handlers without crashing

## [1.50.0] - 2026-04-16

### Added
- **Sidebar view toggle** - New Agents / Tracking Board toggle in the sidebar, letting the tracking board live in the left panel alongside the agent list instead of only inside the terminal header
- **Two-click confirm hook** - Reusable `useTwoClickConfirm` hook providing a generic arm/confirm flow for destructive actions, with per-id pending state and automatic timeout
- **Sidebar tracking board styles** - Dedicated stylesheet for the in-sidebar tracking board and view-toggle controls

### Changed
- **TrackingBoard component** - Simplified internals and shed terminal-specific styling so the board can render in both the terminal header and the sidebar
- **AgentOverviewPanel / TerminalHeader / ClaudeOutputPanel** - Refactored to route tracking board rendering through the shared sidebar context and to share the two-click confirm hook
- **Scene interactions** - Building placement, drawing tools, and scene raycasting updated to use the new two-click confirm flow for potentially destructive actions
- **Release pipeline builtin skill** - Minor refinements to the bundled release pipeline skill definition

### Fixed
- **Gmail OAuth polling toggle** - Restored the missing `togglingPolling` state so the polling switch disables correctly while the toggle request is in flight

## [1.49.0] - 2026-04-16

### Added
- **Clear context from tracking board** - Per-agent and per-column "clear context" actions in the tracking board with a 3-second double-confirm safeguard
- **Unseen output indicator** - Tracking board flags agents that have produced output the user has not yet viewed
- **Gmail automatic polling toggle** - Connected Gmail integrations expose an explicit enable/disable control with live active/last-checked status
- **HTTP log blacklist** - Server request logger now skips noisy polled endpoints (starting with `GET /api/files/git-status`) via a configurable blacklist

### Changed
- **Agent notification toast** - Minor refinements to toast layout and styling

### Fixed
- **Gmail status field naming** - Frontend now reads `lastChecked`/`error` from the status payload, matching the server contract
- **Google Drive integration** - Full-featured Google Drive plugin: list/get/create/update/delete/copy/move files, create folders, search, and read file content with automatic export to text/CSV/PDF. Files can be created directly as native Google Docs from plain text or HTML.
- **Shared Drives (Team Drives) support** - Every Drive file operation accepts `supportsAllDrives`. New endpoints to list and read metadata for Shared Drives, plus `driveId`/`includeItemsFromAllDrives` scoping for file listings.
- **Google Docs API endpoints** - Full passthrough to the Docs API: `POST /api/drive/docs` (create), `GET /api/drive/docs/:docId` (structured document with styles, tables, inline objects, revision ID), `POST /api/drive/docs/:docId/batch-update` (generic `requests` array passthrough — every Docs mutation type supported without new server code).
- **Find/replace text convenience endpoint** - `POST /api/drive/files/:fileId/replace-text` for filling in templates while preserving formatting (fonts, headings, tables, images).
- **Copy-from-template endpoint** - `POST /api/drive/files/:fileId/copy` creates a new Doc from a template, optionally into a specific folder, working across My Drive and Shared Drives.
- **Move-file endpoint** - `POST /api/drive/files/:fileId/move` relocates files between folders including across the My Drive ↔ Shared Drives boundary.
- **Drive action event logging** - New `drive_actions` SQLite table and migration `005_drive_actions.sql` tracking create/update/delete/copy/move operations with agent and workflow instance attribution.
- **Agent skill doc for Google Drive** - Curl-based reference for all Drive and Docs endpoints with a Docs batchUpdate request-type cheatsheet and copy-pasteable examples.

### Changed
- **Unified Google OAuth credentials** - Gmail, Calendar, and Drive now share a single OAuth flow through the secrets system. Connecting one Google service auto-enables the others when scopes overlap; `GoogleOAuthSetup` replaces the Gmail-only setup component and drives the shared-credentials banner across integrations.
- **Integration registry** - Google Drive registered alongside Gmail and Calendar; integration context now exposes Google credentials to all three plugins uniformly.
- **Event types + integration types** - New Drive-related event shapes; shared integration types updated for multi-service credential sharing.

## [1.48.0] - 2026-04-16

### Added
- **Explicit Claude model IDs** - New `claude-opus-4-7` and `claude-opus-4-6` options in the model picker so agents can be pinned to a specific Opus version instead of the rolling `opus` alias
- **X-High reasoning effort** - New `xHigh` effort level (between `high` and `max`) supported from Opus 4.7 onward
- **Deprecated model flagging** - `isDeprecatedClaudeModel` helper + `deprecated` flag on `CLAUDE_MODELS` entries; legacy `opus` and `claude-opus-4-6` are marked deprecated and hidden from the "new agent" picker while remaining valid for existing agents

### Changed
- **`opus` alias now resolves to Opus 4.7** - `llm-matcher-service` maps the short `opus` name to `claude-opus-4-7` (previously `claude-opus-4-6-20250514`)
- **Codex backend skips Claude model IDs** - `shouldPassCodexModel` now treats any `claude-*` model ID as a non-Codex model so Codex agents no longer attempt to pass them through
- **Spawn/Edit/Boss/Bulk modals** - Model dropdowns filter out deprecated entries when creating new agents

### Fixed
- **Task reports survive expired delegations** - `/api/agents/:id/report-task` falls back to `agent.bossId` when the active delegation record has already cleared, and accepts the report (with a `forwarded` flag) even if the boss agent is gone instead of returning 400

## [1.47.0] - 2026-04-16

### Changed
- **Agent card avatar layout** - Overview panel cards now show a left-side avatar with provider badge overlay instead of inline icons
- **Tracking board compacted** - Denser card layout with avatar, smaller fonts, reduced spacing, and removed footer row
- **AgentIcon sizing** - Supports percentage-based dimensions for flexible container-driven sizing
- **Simplified active card styles** - Removed heavy backgrounds and box-shadows from active/boss card states

### Fixed
- **Custom icon sizing** - AgentIcon now correctly computes pixel vs percentage dimensions for uploaded PNG icons
- **Header avatar overflow** - Agent avatar in terminal header clips image icons properly at 30px

## [1.46.0] - 2026-04-16

### Added
- **Custom class icons** - Upload custom PNG/JPG/GIF/WebP/SVG icons for agent classes instead of using emoji
- **AgentIcon component** - Unified icon component that renders custom uploaded icons or falls back to emoji across the entire UI
- **Class icon API** - Backend routes for uploading, serving, and deleting custom class icon files
- **2D scene icon rendering** - Custom class icons rendered as images in the 2D canvas scene with caching

### Changed
- **Icon display across UI** - Agent bars, hover popups, spawn modals, tracking board, unit panels, and all agent views now use AgentIcon for consistent icon rendering
- **Class editor** - Icon picker now supports both emoji selection and image file upload with preview

## [1.45.0] - 2026-04-16

### Added
- **Per-agent keyboard shortcuts** - Assign global keyboard shortcuts to agents for instantly opening their guake terminal
- **Shortcut capture UI** - KeyCaptureInput in agent edit modal for recording shortcut combos
- **Agent terminal shortcuts in Controls** - View all agent shortcuts in the Controls modal keyboard section
- **Persist tracking status** - Tracking status now saved to disk and restored across server restarts

### Changed
- **WebSocket message types** - Synced UpdateAgentPropertiesMessage with all agent update fields (effort, useChrome, cwd, shortcut, opencodeModel)

## [1.44.0] - 2026-04-15

### Added
- **Session history** - Track past sessions per agent with summary, timestamps, and file validation
- **Session preview** - Click any past session to preview its conversation inline (user, assistant, and tool messages)
- **Session restore** - Switch back to a previous session directly from the history panel

### Fixed
- **Test mock for clear context** - Added missing `archiveCurrentSession` mock to agent-handler tests

## [1.43.1] - 2026-04-15

### Fixed
- **Boss spawn default model** - Changed default model from haiku to opus in boss spawn modal

## [1.43.0] - 2026-04-15

### Added
- **Waiting-subordinates tracking status** - New tracking status for boss agents waiting on delegated tasks, with dedicated purple column in the tracking board
- **Enhanced Clear All button** - Distinct green-styled button with agent count for the can-clear-context column

### Changed
- **Boss delegation instructions** - Rewritten to enforce pure dispatcher model: boss agents delegate everything without exception, maximize parallel delegation, zero-questions policy
- **Agent tracking skill** - Strengthened with mandatory completion rules, trigger conditions, and critical ordering requirements (tracking status must be last action)

## [1.42.0] - 2026-04-15

### Added
- **Agent tracking board** - New side panel showing agents grouped by tracking status (working, need-review, blocked, can-clear-context) with real-time updates
- **Agent tracking skill** - Built-in skill allowing agents to update their tracking status via API, automatically pre-selected for new agents
- **Tracking status API** - PATCH endpoint for agents to set trackingStatus and trackingStatusDetail fields
- **Auto-reset tracking status** - When an agent enters working state, tracking status automatically resets to "working" unless explicitly set otherwise

## [1.41.0] - 2026-04-15

### Added
- **Split terminal layout** - View up to 4 agent terminals side by side with `SplitTerminalLayout` and `AgentTerminalPane` components, persisted across sessions
- **Split pane store actions** - Add/remove/clear/toggle split panes with horizontal/vertical orientation support and localStorage persistence
- **Overview panel styling** - Enhanced agent overview panel styles for split layout context

### Changed
- **ClaudeOutputPanel refactor** - Extracted self-contained `AgentTerminalPane` component from monolithic panel (~770 lines removed), delegating history, output, input, and search to the pane

## [1.40.5] - 2026-04-15

### Fixed
- **History refresh flicker** - Removed history cache eviction on `triggerHistoryRefresh`, stale cache is now shown instantly while fresh data loads in the background, eliminating blank-then-repopulate flicker in the output panel

## [1.40.4] - 2026-04-15

### Added
- **Tmux process persistence** - Agent CLI processes can optionally run inside tmux sessions (`TIDE_USE_TMUX=1`) so they survive server restarts; includes tmux-helper module, file-tailing stdout pipeline, and tmux-aware recovery/reconnection
- **Tmux mode setting** - New API endpoints and system-prompt-service functions to toggle tmux mode via Settings UI
- **Reconnection grace period** - When WebSocket connection drops, a non-blocking "Reconnecting..." toast shows for 10s before the full overlay appears
- **History loader reconnect support** - On reconnect, existing conversation history stays on screen while fresh data loads in the background to avoid flicker

### Fixed
- **Notification suppression refinement** - Post-notification gate now allows step_complete, usage_snapshot, error, and compacting events through while suppressing text/tool output, preventing missed idle transitions
- **Stdout pipeline tests** - Extended test coverage for notification suppression and tmux log tailing

### Changed
- **Recovery store** - Persists tmux session names, log offsets, and provider info to enable cross-restart reconnection
- **Process lifecycle** - Tmux-aware spawn path with initial stdin piping and launcher process handling
- **Runner diagnostics** - Resolves real PID from tmux pane for debug tools

## [1.40.3] - 2026-04-15

### Fixed
- **Boss agent spawn validation** - Boss agents can now spawn custom agent classes (e.g. growey, espeon), not just built-in classes. The hardcoded class whitelist now dynamically includes all registered custom classes
- **Boss spawn instructions** - Updated boss instructions to inform boss agents they can use any registered agent class, not just the 6 built-in ones
- **PM2 foreground lifecycle** - Fixed startup race when PM2 restarts the process: instead of sending a duplicate SIGTERM, the new process now waits for the old one to exit gracefully

## [1.40.2] - 2026-04-14

### Fixed
- **OpenCode notification loop suppression** - Moved post-notification gate to top-level `handleEvent` to suppress all event types (including status flips), preventing working/idle flickering after task completion
- **OpenCode idle status timing** - OpenCode agents now skip the immediate idle-on-step-complete timeout like Codex agents, preventing premature status changes during agentic loop turns

## [1.40.1] - 2026-04-14

### Added
- **OpenCode provider integration** - New agent provider supporting OpenCode CLI with multi-provider model selection (e.g. minimax/MiniMax-M1-80k), full runtime provider, JSON event parser, spawn/edit UI, and backend wiring
- **Claude effort level** - Configurable reasoning effort (low/medium/high/max) for Claude agents in spawn and edit modals
- **Boss class defaults to Opus** - Boss agents now auto-select the opus model on spawn

### Fixed
- **OpenCode agentic loop suppression** - Prevent infinite output loops after notification curl by tracking notification-sent state and suppressing duplicate text in the stdout pipeline
- **Lint warning** - Fixed unused `isOpencodeProvider` variable by introducing `isCodexLikeProvider` for shared codex/opencode context stats path
- **Test mock** - Added missing `createOpencodeRuntimeProvider` export to runtime mock in runtime-service tests

### Changed
- **Agent types** - Extended `AgentProvider` to include `'opencode'`, added `OpencodeModel` type and `opencodeModel` field on Agent interface
- **Terminal header styling** - Updated guake terminal header styles for provider indicators
- **Context stats** - Opencode agents now share the codex context stats path for session snapshots

## [1.39.0] - 2026-04-14

### Added
- **Area spawn agent** - "Spawn Agent" option in area right-click menu with area center positioning and directory-based default cwd
- **Git pull auto-stash** - Git pull now auto-stashes local changes before pulling and restores them after, with conflict reporting in the UI

### Fixed
- **Grid config persistence** - Grid configuration now persists on refresh by tracking visibility state and reordering initialization calls
- **Commander View scroll** - Fixed scroll-up bug by releasing pinToBottom after scroll stabilizes and enhancing pin cancel behavior

### Changed
- **Release pipeline skill** - Added sub-agent delegation model for parallel execution of quality gates and builds

## [1.38.1] - 2026-04-14

### Fixed
- **Trigger field name mismatch** - Triggers created via the API with legacy field names (`matchingMode`, `slackChannelId`) are now auto-normalized to the correct structure (`matchMode`, `config.channelId`), fixing triggers that silently failed to fire
- **Trigger normalization on load** - Existing triggers with legacy field names are auto-healed on server startup

### Changed
- **Trigger designer skill** - Updated all examples to use correct field names (`matchMode`, `config` sub-object) and accurate template variables (`{{slack.user}}`, `{{slack.message}}`)
- **Slack integration instructions** - Added setup steps for Socket Mode, Event Subscriptions, and required bot event subscriptions

## [1.38.0] - 2026-04-14

### Added
- **Slack DM support** - New `/api/slack/dm` endpoint for sending direct messages to users by Slack user ID
- **Slack user search** - New `/api/slack/users/search?q=` endpoint to find users by name, display name, or email
- **Slack join channel** - New `/api/slack/channels/join` endpoint for the bot to join channels before reading or posting

### Fixed
- **Slack auto-connect on config save** - Saving Slack config with valid tokens and enabled state now automatically connects (previously required server restart)

## [1.37.2] - 2026-04-13

### Added
- **Area creation skill** - Create Building skill now includes full area management docs with schema, examples, and common mistakes to avoid

### Fixed
- **Resilient area loading** - Server and client now validate area data on load, skipping malformed entries with a logged error instead of crashing

## [1.37.1] - 2026-04-13

### Added
- **Configurable tab title** - New setting in General section to customize the browser tab title (defaults to "Tide Commander" when empty)
- **i18n support** - Tab title setting translated across all 10 supported languages

## [1.37.0] - 2026-04-13

### Added
- **Turn state tracking** - Agent processes now track whether they are mid-turn or waiting for input, enabling smarter stdin message routing
- **Spawn Agent context menu** - Right-click an area to spawn a new agent directly into it
- **Area directory inference** - SpawnModal uses area directories for cwd when spawning into an area, falling back to member agent cwds

### Changed
- **Stdin message routing** - Improved logging and routing logic when sending messages to running agents via stdin reuse
- **Process diagnostics** - Turn state now displayed in runner process state dumps

## [1.36.1] - 2026-04-10

### Changed
- **Dead code cleanup** - Removed unused components (RightPanel, SidebarTreeView, EventLogViewer, SnapshotViewer, StatsDashboard, WorkflowDetailView, WorkflowInstanceMonitor), hooks (useSnapshots), server modules (work-plan-service, event-queries, snapshots, workflow-builder skill), and dependencies (chokidar, croner)
- **Area layout service** - Improved layout persistence logic
- **Logger** - Cleaned up logging utilities

### Removed
- Unused `dev:5174` npm script (duplicate of `dev`)
- Legacy dashboard view files and right panel components
- Sidebar tree view component library (unused)

## [1.36.0] - 2026-04-10

### Added
- **Workspace Switcher** - Create and switch between workspaces that filter visible agents and areas, with full CRUD UI and keyboard shortcuts
- **Bulk Agent Management** - Modal for bulk operations on agents: select all, kill selected, restart selected, and filter by status
- **Area Layout Service** - Backend service for saving and restoring area layout positions with per-area persistence
- **Context menu area actions** - New context menu entries for area layout operations
- **Bulk agent API endpoints** - Backend routes for bulk kill, restart, and status operations on multiple agents

### Changed
- **3D/2D scene workspace filtering** - Both scene renderers now respect active workspace, hiding agents and buildings not in the current workspace
- **Agent overview swipe navigation** - Improved swipe behavior to respect workspace-filtered agent lists
- **Building manager workspace awareness** - Buildings are shown/hidden based on active workspace area membership

## [1.35.0] - 2026-04-10

### Added
- **Workspace Switcher** - Create and switch between workspaces that filter visible agents and areas, with full CRUD UI and keyboard shortcuts
- **Bulk Agent Management** - Modal for bulk operations on agents: select all, kill selected, restart selected, and filter by status
- **Area Layout Service** - Backend service for saving and restoring area layout positions with per-area persistence
- **Context menu area actions** - New context menu entries for area layout operations
- **Bulk agent API endpoints** - Backend routes for bulk kill, restart, and status operations on multiple agents

### Changed
- **3D/2D scene workspace filtering** - Both scene renderers now respect active workspace, hiding agents and buildings not in the current workspace
- **Agent overview swipe navigation** - Improved swipe behavior to respect workspace-filtered agent lists
- **Building manager workspace awareness** - Buildings are shown/hidden based on active workspace area membership

## [1.34.2] - 2026-04-06

### Changed
- **Tooltip component migration** - Replaced native `title` attributes with shared Tooltip component across AgentBar, FloatingActionButtons, DiffViewer, and RightPanel for consistent styled tooltips
- **Tooltip styling** - Updated tooltip styles and positioning for better visual consistency
- **Guake header styling** - Refined header layout styles

## [1.34.1] - 2026-04-06

### Changed
- **Rich copy styling** - Enhanced clipboard inline styles with GitHub-like theme, Google Docs table compatibility, and proper font stacks
- **Boss delegation instructions** - Refined boss agent instructions to prioritize delegation by default, with clearer guidelines for when to act directly vs delegate
- **Copy error logging** - Added console.error logging to clipboard copy failure handlers across DiffViewer, FileViewer, and FileViewerModal
- **DiffViewer clipboard** - Refactored to use shared clipboard utilities instead of direct navigator.clipboard calls
- **FileViewerModal copy buttons** - Hide rich text copy buttons in highlight view mode

## [1.34.0] - 2026-04-06

### Added
- **Inline discard button** - Per-file discard/delete button on hover in both Git Changes panel and Guake Git panel with confirmation dialogs
- **Pending message queue** - WebSocket messages are queued in localStorage when disconnected and automatically flushed on reconnect, preventing lost commands
- **Rich copy inline styles** - Clipboard rich-text copies now inline CSS styles for correct rendering in external apps (Word, Google Docs, email)

### Changed
- **Escape key handling** - Improved modal escape key behavior using `stopImmediatePropagation` and modal stack registration to prevent closing parent panels
- **Agent CWD tooltip** - Added full path tooltip on truncated agent working directory display in guake header

## [1.33.0] - 2026-03-24

### Added
- **Gmail service account auth** - Support for Google service account authentication with domain-wide delegation alongside existing OAuth2 flow

## [1.32.2] - 2026-03-23

### Fixed
- **AgentBar scroll** - Use dominant axis for wheel events, supporting both trackpad swipes and vertical scroll
- **Overscroll navigation** - Only block horizontal overscroll on canvas elements, allowing native horizontal scroll in panels

## [1.32.1] - 2026-03-23

### Fixed
- **Render loop resilience** - Keep render loop alive during canvas detach in React StrictMode remounts instead of stopping animation

## [1.32.0] - 2026-03-23

### Added
- **Directory context menu in Git Changes** - Right-click directories to discard or stage all files within them

## [1.31.0] - 2026-03-23

### Added
- **Trigger Manager UI** - Wired TriggerManagerPanel into the Toolbox for direct trigger creation and management from the UI
- **Integration skills visibility** - Made all 5 integration skills (Slack, Gmail, Google Calendar, Jira, Document Generator) discoverable in the skill management system
- **Trigger Designer skill** - New built-in skill with comprehensive documentation for trigger creation including webhook, cron, Slack, email, and Jira trigger types
- **Gmail trigger handler** - Added email-based workflow trigger handler for Gmail integration

## [1.30.0] - 2026-03-23

### Added
- **SQLite database support** - Full SQLite integration using better-sqlite3 with file-based connections, WAL mode, and schema introspection via PRAGMAs
- **SQL Server (MSSQL) database support** - Full SQL Server integration with connection pooling, schema introspection via sys.* catalog views, and TOP N query limiting

### Changed
- **Database engine icons** - Fixed hardcoded MySQL/PostgreSQL icons in popup and sidebar to dynamically use the registered engine icon from DATABASE_ENGINES registry
- **Database config panel** - Conditionally shows filepath input for SQLite or host/port/credentials for network databases

## [1.29.2] - 2026-03-23

### Fixed
- **Integration configuration saving** - Fixed silent failures in secrets storage where createSecret() and updateSecret() errors were not being propagated
- **Key normalization in secrets lookup** - Fixed getSecretByKey() to normalize lookup keys before comparison, preventing "key already exists" errors on update
- **Error message visibility** - Changed integration config API to return actual error messages instead of generic responses
- **Jira search endpoint** - Updated Jira client to use new /rest/api/3/search/jql endpoint (migrated from deprecated /rest/api/3/search)

### Improved
- **Error handling** - Added proper error propagation in integration configuration flow to surface issues to users

## [1.29.0] - 2026-03-19

### Added
- **Restart button** - Added restart button to bottom terminal panel for buildings

### Changed
- **Buildings panel compact layout** - Reduced padding and spacing throughout for denser display
- **PM2 details simplified** - Only show ports for PM2 buildings, removed verbose stats
- **Header status bar wrapping** - Status bar now wraps on smaller widths
- **Vite dev server** - Allow all hosts for dev server access

### Removed
- Unused `formatUptime` helper function

## [1.28.0] - 2026-03-17

### Added
- **Inline instructions editor** - Edit custom agent class instructions directly from the Agent Edit Modal with collapsible editor, save/cancel controls

## [1.27.0] - 2026-03-17

### Added
- **Agent overview enhancements** - Extended AgentOverviewPanel with new display features
- **Area editor updates** - New area configuration options in AreaEditor component
- **Backend prompt improvements** - Enhanced Claude and Codex backend prompt building
- **Common types expansion** - New shared type definitions

### Changed
- **Tool renderers** - Updated ToolRenderers component
- **File content handling** - Improved useFileContent hook
- **File viewer modal** - Streamlined FileViewerModal component
- **Data section** - Updated DataSection toolbox component
- **Overview panel styles** - Enhanced overview panel SCSS styling
- **Config translations** - Updated English config locale

## [1.26.0] - 2026-03-17

### Added
- **Git history panel** - New GitHistory component with virtualized commit list and file diff viewer
- **Boss context component** - New BossContext component for boss agent context display
- **Alfred integration** - Alfred workflow for searching and focusing agents
- **File routes expansion** - Extended file API routes with git history and diff endpoints
- **Codex parser improvements** - Enhanced JSON event parser with additional event handling

### Changed
- **Output panel enhancements** - Improved HistoryLine and OutputLine components
- **Terminal embed updates** - Enhanced TerminalEmbed with better protocol handling
- **Keyboard shortcuts** - Added new shortcut bindings
- **Scene input handling** - Updated input event handlers and 2D scene input
- **Boss instructions** - Reorganized builtin boss skill instructions
- **Database service** - Updated database service layer
- **File explorer styles** - New history panel styles, updated editor and index styles

## [1.25.0] - 2026-03-16

### Added
- **CodeMirror language modules** - Extracted language loading into dedicated `cm-languages.ts` module

### Changed
- **EmbeddedEditor refactoring** - Simplified editor component by extracting language logic
- **FileViewer improvements** - Streamlined file viewer with better code organization
- **File explorer styles** - Enhanced viewer styling with 170+ lines of new SCSS

## [1.24.0] - 2026-03-16

### Added
- **Terminal embed component** - New `TerminalEmbed` component for embedded terminal rendering
- **Terminal service enhancements** - Improved terminal proxy and service layer

### Changed
- **Context menu improvements** - Enhanced context menu component
- **Output panel refactoring** - Cleaned up ClaudeOutputPanel with deferred iframe loading
- **Guake terminal styles** - Updated base and output styles

## [1.23.0] - 2026-03-16

### Added
- **Overview panel improvements** - Enhanced agent overview with better filtering and stable sort ordering
- **File viewer enhancements** - Improved FileViewer and FileViewerModal components
- **Clipboard utility** - New clipboard helper module
- **Log retention utility** - New log retention management module

### Changed
- **Terminal input area** - Updated terminal input handling
- **Guake terminal styles** - Refreshed base and overview panel styles
- **Buildings store** - Updated building state management
- **Device performance** - Refined performance detection logic

## [1.22.0] - 2026-03-14

### Added
- **Device performance detection** - Automatic hardware capability detection for adaptive rendering quality
- **Scene rendering optimizations** - Improved render loop, scene core, and effects manager for better performance on lower-end devices

## [1.21.0] - 2026-03-13

### Added
- **Database panel** - Inline database panel for building actions in the bottom panel
- **PM2 logs panel** - Open PM2 logs directly in the bottom panel from building actions
- **Split panel support** - Right-click building actions to split horizontally into the bottom panel

### Changed
- **Boss delegation reminder** - Added reminder in boss context to encourage task delegation to subordinates

### Fixed
- **Unused variable lint warning** - Prefixed unused `closeAllBottomPanels` to pass strict lint checks

## [1.20.0] - 2026-03-13

### Added
- **Scene performance settings** - Configurable FPS cap, idle throttling, and render quality options in Settings
- **Virtualized output improvements** - Better scroll behavior and rendering performance for large output lists

### Changed
- **2D scene renderer** - Optimized render loop and effects manager for lower CPU usage
- **Scene manager** - Improved lifecycle and cleanup of scene resources
- **Config section** - Added scene performance controls to the settings UI

## [1.19.0] - 2026-03-13

### Changed
- **2D agent renderer** - Refactored layout, improved indicator scaling and positioning
- **Indicator scale utilities** - Updated scaling calculations for better visual consistency
- **Swipe navigation** - Enhanced touch swipe handling in the output panel
- **AgentRenderer tests** - Updated tests to match refactored renderer

## [1.18.0] - 2026-03-12

### Added
- **Stable agent sort ordering** - Bucket-based sorting prevents scroll jumping when agent statuses change frequently
- **Terminal header desktop kebab menu** - Context actions and toggles accessible via dropdown menu on desktop
- **Area-colored agent icon border** - Terminal header shows area color on the agent icon

### Changed
- **Agent overview sort logic** - Full re-sort only on agent set changes; preserves order within buckets
- **Terminal header styles** - Extended styling for desktop menu, area indicators, and responsive layout

### Fixed
- **ESLint compliance** - Removed invalid eslint-disable comment in AgentOverviewPanel

## [1.17.0] - 2026-03-12

### Added
- **Boss instructions builtin skill** - Extracted boss agent instructions from boss-message-service into a dedicated builtin skill for cleaner separation
- **File read endpoint** - New server route for reading file contents
- **DiffViewer lazy language loading** - Ensure syntax highlighting languages are loaded before rendering diffs
- **New/deleted file detection** - DiffViewer now detects and handles added and deleted files

### Changed
- **Boss message service** - Simplified to only contain dynamic context; static instructions moved to builtin skill
- **Runtime listeners** - Refactored boss delegation and event handling
- **Command/boss handlers** - Boss agents now receive custom agent config with skills
- **Overview panel styles** - Extended styling for agent overview panel
- **Storage utils** - Additional storage helper

### Fixed
- **ESLint compliance** - Removed invalid eslint-disable comment for non-existent rule
- **Boss command test** - Updated test to match new sendCommand signature

## [1.16.0] - 2026-03-12

### Added
- **Git diff file navigation** - Previous/next arrows to navigate between changed files in the diff modal
- **File delete action** - Delete files directly from the git panel with confirmation dialog
- **Terminal auto-start** - Clicking an offline terminal status bar button automatically starts the terminal
- **Terminal starting placeholder** - Shows "Starting terminal..." while the terminal boots up

### Changed
- **Terminal auto-close** - Bottom terminal panel auto-closes when the terminal process stops
- **Git panel styles** - Extended styling for navigation arrows, delete confirmation, and context menus
- **Header styles** - Additional guake terminal header styling
- **Base guake styles** - Extended base styling for terminal components

## [1.15.1] - 2026-03-11

### Changed
- **Lazy-loaded components** - Heavy modals and panels are now loaded on-demand via React.lazy, reducing initial bundle from ~2.4MB to ~1.3MB
- **On-demand syntax highlighting** - Rare Prism.js languages loaded only when needed, core languages remain eagerly loaded
- **Consolidated Prism imports** - FileViewerModal now uses shared syntax highlighting module

### Fixed
- **Lint error** - Removed invalid eslint-disable comment referencing missing rule

## [1.15.0] - 2026-03-11

### Added
- **Clickable port links** - Building port numbers are now clickable links that open the service in a new browser tab
- **Terminal status bar buttons** - Toggle buttons in the guake status bar for area terminal buildings
- **Orphaned ttyd cleanup** - Detect and kill ttyd processes whose backing tmux session has died
- **Terminal exit callbacks** - Immediate status broadcast when terminal processes exit
- **Extended editor language support** - Added PHP and additional file extension mappings to EmbeddedEditor

### Changed
- **Terminal service** - Added tmux session health checks and orphan detection
- **Building service** - Extended with terminal exit event integration
- **Terminal proxy** - Enhanced proxy capabilities
- **Guake header styles** - New styling for guake terminal header
- **Buildings panel styles** - Clickable port link styling
- **Database sidebar** - Minor style adjustments

## [1.14.0] - 2026-03-11

### Added
- **Area visibility filter** - Filter agent overview panel by specific areas with a dropdown selector
- **File content endpoint** - New server route for fetching file contents
- **Context menus in Git panel** - Right-click actions in the GuakeGitPanel
- **Syntax highlighting in Git panel** - Use shared syntax highlighting for file previews

### Changed
- **Agent overview panel** - Persist area filter preferences in saved config
- **DiffViewer** - Simplified component implementation
- **Mobile responsive styles** - Improved layout and spacing for mobile viewports
- **Building panel styles** - Enhanced styling for guake terminal buildings panel
- **Git panel styles** - Extended styles for git panel interactions
- **Overview panel styles** - Additional styling for agent overview panel
- **Terminal service** - Minor adjustments to terminal service

## [1.13.2] - 2026-03-11

### Fixed
- **Guake bottom terminal auth** - Pass auth token to the guake-style bottom terminal iframe (v1.13.1 only fixed the modal terminal)

## [1.13.1] - 2026-03-11

### Fixed
- **Terminal building auth** - Pass auth token to terminal iframe and WebSocket connections so terminal buildings work when authentication is enabled

## [1.13.0] - 2026-03-11

### Added
- **Terminal proxy enhancements** - Extended terminal proxy with additional capabilities
- **Output panel features** - New ClaudeOutputPanel functionality
- **Guake terminal styles** - Additional base styles for guake terminal

### Changed
- **Terminal service** - Extended terminal service with new functionality
- **Storage utilities** - Additional storage helper methods

## [1.12.0] - 2026-03-10

### Added
- **Terminal service** - Server-side terminal management with terminal-service and terminal-proxy
- **Embedded editor** - CodeMirror-based embedded editor in file explorer panel
- **Terminal config panel** - New TerminalConfigPanel for building configuration
- **Building types extensions** - Expanded shared building types
- **File routes** - Additional server file route endpoints
- **WebSocket terminal support** - WebSocket handler extensions for terminal communication
- **Database sidebar improvements** - Enhanced DatabaseSidebar with redesigned layout and styling
- **Modal styles** - New modal component styling
- **Keyboard shortcuts update** - Updated keyboard shortcut bindings
- **Vite config updates** - Build configuration adjustments

### Changed
- **AreaBuildingsPanel** - Expanded with additional building management features
- **Building service** - Extended building service capabilities
- **Create building skill** - Updated builtin skill for building creation
- **File explorer** - Updated FileViewer, types, and viewer styles
- **Guake terminal styles** - Updated base and buildings panel styles
- **Server app and index** - Server initialization updates

### Fixed
- **Lint errors** - Removed invalid eslint-disable-next-line and unused IncomingMessage import

## [1.11.0] - 2026-03-10

### Added
- **Area buildings panel** - New AreaBuildingsPanel component for viewing area buildings in the terminal
- **Buildings panel styles** - Comprehensive layout and styling for buildings panel
- **Modal stack hook** - New useModalStack hook for layered modal management
- **Terminal header toggle** - Buildings panel toggle in TerminalHeader

### Changed
- **Agent overview panel** - Extended with additional features and information display
- **App and AppModals** - Integrated new buildings panel
- **Git panel styles** - Additional styling refinements
- **Storage utilities** - New helper additions

## [1.10.0] - 2026-03-10

### Added
- **Git panel enhancements** - Expanded GuakeGitPanel with advanced diff viewing and tree navigation modes
- **Branch widget** - New BranchWidget component for file explorer branch display
- **Multi-repo branch support** - useGitBranch hook now supports multiple repository directories
- **Git server routes** - Extended file server routes for git branch and status operations
- **Storage utilities** - New storage utility helpers
- **Spawn modal options** - Extended SpawnModal with additional configuration options

### Changed
- **Boss context** - Improved BossContext component with updated messaging
- **Boss service** - Updated boss message service with refined delegation instructions
- **Markdown rendering** - Enhanced MarkdownComponents with improved rendering
- **Git panel styles** - New comprehensive git panel stylesheet with tree view support
- **History panel styles** - Additional history panel styling improvements

## [1.9.0] - 2026-03-10

### Added
- **Guake git panel** - New GuakeGitPanel component for integrated git status and diff viewing in the terminal
- **Git branch display** - New useGitBranch hook showing current branch in terminal header
- **Agent overview enhancements** - Extended AgentOverviewPanel with improved agent information display
- **Search history improvements** - Extended search history functionality with richer capabilities
- **2D scene config options** - New scene configuration entries for the 2D canvas
- **Agent store capabilities** - New agent store features with expanded test coverage
- **Agent renderer tests** - Added test suite for 2D AgentRenderer
- **Indicator scale utility** - New indicatorScale utility for 2D scene rendering
- **File route extensions** - Additional server file routes and websocket handler improvements

### Changed
- **Terminal header redesign** - Redesigned TerminalHeader with updated layout and styling
- **Guake terminal styles** - Overhauled base, header, input, output, and overview panel styles
- **Spawn modal updates** - Updated SpawnModal component interface
- **2D scene rendering** - Refined Scene2D, Scene2DRenderer, and AgentRenderer
- **DiffViewer component** - Updated diff viewer for git panel integration

### Fixed
- **Lint errors** - Resolved eslint-disable-line for missing react-hooks/exhaustive-deps rule and unused variable warnings

## [1.8.4] - 2026-03-09

### Fixed
- **Trackpad back navigation** - Prevent two-finger horizontal swipe from triggering browser back/forward navigation on desktop via CSS `overscroll-behavior`, JS wheel event interception, and history buffer absorption
- **Back navigation scope** - Extend history buffer protection from mobile-only to all platforms, silently absorbing accidental back gestures on desktop

## [1.8.3] - 2026-03-05

### Added
- **Codex context snapshot parsing** - Parse Codex session rollout files and TUI logs for accurate context usage tracking at init and completion
- **Codex default context limit** - Codex agents now default to 258,400 token context window instead of 200,000
- **Codex token_count event tracking** - Track model usage snapshots from token_count events for more accurate context estimates
- **Codex turn_aborted marker filtering** - Filter `<turn_aborted>` noise from agent messages in Codex parser
- **Recovery store improvements** - Recovery store now cleans up entries for deleted agents
- **Agent service test suite** - New tests for agent-service context snapshot functions
- **Runtime events test suite** - New tests for runtime event handling

### Changed
- **Codex context estimation** - Use authoritative input token snapshots directly instead of inflating with rolling estimates
- **Agent panel** - Updated AgentPanel with improved agent utility functions
- **2D scene renderer** - Updated Scene2D and AgentRenderer with provider-aware rendering
- **Runtime status sync** - Simplified status sync logic
- **Output store** - Improved output normalization and size handling
- **Base styles** - Minor CSS adjustments

### Fixed
- **Codex event_msg parsing** - Pass parsed payload instead of raw event to parseEventMsg for correct type handling
- **Context limit migration** - Fix Codex agents incorrectly inheriting Claude's 200k context limit from persisted data

## [1.8.2] - 2026-03-05

### Added
- **Provider badge images** - Agent name labels now show Claude/Codex logo images instead of colored dots, with async loading and fallback circles
- **Task label truncation** - Long task labels are now truncated with ellipsis at a fixed font size instead of shrinking

### Changed
- **Status indicator zoom** - Status bar indicators now scale based on camera distance for better visibility at different zoom levels

## [1.8.1] - 2026-03-05

### Changed
- **Name label sizing** - Fixed font size (420px cap) instead of shrink-to-fit loop, with text truncation and ellipsis for long names
- **Name label scaling** - Larger base scales (2.5 regular, 3.1 boss) and larger status indicators (2.1/2.6)
- **Layout versioning** - Added NAME_LABEL_LAYOUT_VERSION for automatic sprite rebuild on layout changes

### Fixed
- **Output truncation removed** - Removed per-entry 64KB truncation in output store, preserving full content

## [1.8.0] - 2026-03-05

### Added
- **ToolSearch renderer** - New formatted display for ToolSearch tool calls showing selected tools as chips, query parameters, fallback/show-hide state with expand/collapse
- **3 new themes** - Obsidian Bloom (ultra-dark graphite), Midnight Harbor (ocean twilight), Ember Noir (plum dusk with rose-indigo accents)
- **GPT-5.4 model** - Added GPT-5.4 as a Codex model option
- **Navigation button styles** - Back/forward navigation buttons in terminal header

### Changed
- **Abyss theme** - User message border changed from warm brown to purple for better contrast

## [1.7.1] - 2026-03-05

### Fixed
- **TerminalHeader navigation props** - Added missing back/forward navigation buttons to TerminalHeader interface and component (fixes CI build failure in v1.7.0)

## [1.7.0] - 2026-03-05

### Added
- **Working agent indicator** - Agent cards in overview panel now show a pulsing green dot and breathing glow animation when working
- **Boss delegation rules** - Boss agents now have strict delegation-over-tool-use enforcement and parallelization caution instructions
- **Auto-dismiss completed tasks** - Boss terminal progress indicators auto-clear completed/failed tasks after 300ms

### Changed
- **Agent progress container** - Only shows actively working tasks (not completed/failed), collapsed by default
- **Agent progress expand logic** - Uses explicit `defaultExpanded` prop instead of auto-expanding based on status
- **Context stats sync** - Runtime events now always keep contextStats in sync with token updates, preserving authoritative category breakdowns from /context
- **Scroll on agent select** - Terminal auto-scrolls to bottom when switching agents, using double rAF for reliability

### Fixed
- **Unused variable lint** - Removed unused `nonFreeTokens` variable in runtime-events context stats

## [1.6.2] - 2026-03-04

### Changed
- **Boss agent card styling** - Boss agents in overview panel now have gold-themed borders, background gradient, and crown emoji indicator
- **Boss agent sorting** - Boss agents now sort before regular idle agents in overview panel and swipe navigation
- **Subordinate context bars** - Boss panel subordinate list now shows context usage progress bars with color-coded fill (green to red)
- **Agent click opens terminal** - Clicking on other-agents and boss subordinates now also opens the terminal panel
- **Default skills** - `report-task-to-boss` skill is now pre-selected by default when spawning new agents

### Fixed
- **Subagent badge cleanup** - Deleting an agent now clears its subagent badge indicators from the store

## [1.6.1] - 2026-03-04

### Fixed
- **Persisted output parsing** - Terminal now correctly parses `<persisted-output>` wrapped exec task results, handling truncated large outputs from Claude Code
- **Exec task matching** - Streaming exec output now matches by extracted command name instead of unreliable time-window fallback, preventing cross-task output duplication
- **Removed debug logging** - Cleaned up console.log debug statements from exec task matching code

## [1.6.0] - 2026-03-04

### Added
- **Task report endpoint** - `POST /api/agents/:id/report-task` allows subordinates to report task completion/failure back to their boss agent with summary
- **Report-task-to-boss skill** - New builtin skill enabling subordinate agents to report results to their boss
- **Delegated task message UI** - Subordinate terminals now show a compact, expandable card for delegated tasks (with boss name, ID, and task command)
- **Task report header UI** - Boss terminals display styled completion/failure reports from subordinates with status badges, summaries, and expandable details
- **Bash report-task rendering** - curl commands to `/report-task` are rendered as compact status chips with summary preview in both live and history views
- **Progress indicator dismiss button** - Boss terminal progress indicators now have a dismiss (x) button to clear completed task cards
- **Progress indicator file/bash clicks** - Agent progress output now supports clickable file references and bash command inspection

### Changed
- **Delegated task wrapping** - Boss delegations now wrap the task command with context (boss name/ID and report-task instructions) so subordinates know how to report back
- **Agent task progress output** - Progress output now carries full tool metadata (toolName, toolInput, toolOutput) instead of plain strings, enabling rich rendering in the boss terminal
- **Boss response handler tests** - Updated delegation tests to use `expect.stringContaining()` matching the new wrapped delegation message format

## [1.5.0] - 2026-03-04

### Added
- **Swipeable notification toasts** - Swipe left to dismiss agent notifications on mobile with haptic feedback, direction locking, and opacity fade animation
- **Mobile tree panel resize** - Drag handle between tree and viewer panels in the file explorer on mobile, with persisted height via localStorage
- **Hidden files in file explorer** - Dotfiles and hidden directories are now visible in file listings, tree views, and search results

### Changed
- **File search limits** - Increased filename and content search result limits from 20 to 200 for more comprehensive results
- **Subagent badges** - Terminal header now only shows badges for spawning/working subagents, hiding completed and failed ones
- **Git tree indentation** - Improved alignment with base padding constant and negative-margin checkbox positioning so file icons align with directory arrows

### Removed
- **Current tool display** - Removed the CurrentTool widget from the agent unit panel (tool info is already shown in terminal output)

## [1.4.3] - 2026-03-01

### Added
- **Clear context shortcut** - Alt+Shift+C keyboard shortcut to clear context of the selected agent

### Fixed
- **File viewer syntax highlighting** - Fixed code not being syntax-highlighted in the file viewer modal (was rendering plain text)
- **Bash history rendering** - Bash commands and results in conversation history now get syntax highlighting and terminal-style output rendering
- **Context usage clamping** - Context usage percentage clamped to 0-100% range, preventing invalid display values
- **Context stats sanitization** - Server resets parsed context stats when totalTokens exceeds contextWindow, fixing stale data after autocompaction
- **Auto-scroll on send** - Terminal now scrolls to bottom when sending a message, resetting manual scroll-up state
- **Agent overview default state** - Agent cards in overview panel are now collapsed by default instead of auto-expanding the active agent

## [1.4.2] - 2026-03-01

### Added
- **Mobile theme selector** - Theme picker now available directly in the terminal header mobile overflow menu with color previews
- **Plan-ready notifications** - Notification skill now includes mandatory plan-ready notification instructions for agents entering plan mode

### Changed
- **Vibration intensity scale** - Expanded from 4 levels (0-3) to 6 levels (0-5: Off, Ultra Light, Very Light, Light, Medium, Heavy) for finer haptic control
- **Haptics Capacitor mapping** - Ultra Light and Very Light levels now use `selectionChanged()` on native Android, reserving impact haptics for Light/Medium/Heavy

### Fixed
- **Vibration intensity clamping** - Store now validates and clamps vibration intensity on load and update, preventing out-of-range values from persisted settings
- **Two-finger selector off respect** - Confirmation haptic no longer escalates from 0 to 1 when vibration is set to Off

## [1.4.1] - 2026-03-01

### Fixed
- **Two-finger selector hit-testing** - Added dynamic padding to agent list so first/last cards can be scrolled to center for reliable hit-testing, removed broken cursor overlay
- **Two-finger selector haptics** - Now uses configurable vibration intensity from settings instead of hardcoded values; confirmation haptic is one level above base intensity
- **Web vibration durations** - Re-tuned durations (Light: 5ms, Medium: 25ms, Heavy: 50ms) for more perceptible differences between levels
- **Two-finger selector cleanup** - Properly restores agent list padding on unmount while gesture is active

## [1.4.0] - 2026-03-01

### Added
- **Native Android haptics** - Added `@capacitor/haptics` as a proper dependency for native vibration feedback on Android devices

### Changed
- **Haptics dynamic import** - Capacitor Haptics module is now loaded via async dynamic import instead of synchronous require, with eager preloading for instant availability on first swipe
- **Web vibration durations** - Increased vibration durations (Light: 8ms to 15ms, Medium: 15ms to 35ms, Heavy: 25ms to 60ms) for more noticeable feedback on Android hardware
- **Idle agent sub-sorting** - Idle agents now sort by most recently active within the idle group, providing a stable secondary sort after taskLabel priority

## [1.3.0] - 2026-03-01

### Added
- **Two-finger scroll agent selector** - On mobile, use two fingers on the terminal area to scroll through agent cards in the overview panel with a visual cursor highlight
- **Configurable vibration intensity** - New setting in General to control haptic feedback strength (Off / Light / Medium / Heavy) for swipe gestures
- **Haptics utility** - Centralized haptic feedback module replacing inline Capacitor/Web vibration logic

### Changed
- **Working agent sort stability** - Working agents now sort alphabetically by name within the working group for consistent ordering
- **Swipe gesture haptics** - Refactored to use shared haptics utility with configurable intensity from settings

## [1.2.4] - 2026-03-01

### Fixed
- **Agent sorting priority** - Working and active agents now always sort above idle agents; idle-with-taskLabel priority only applies within the idle group, preventing completed-task agents from appearing above actively working ones

## [1.2.3] - 2026-03-01

### Fixed
- **Exec task matching** - Widened time window from 2s to 5s and added fallback to most recent running task when no time-window match found, fixing missed streaming output displays
- **Swipe navigation order** - Swipe next/prev now replicates the agent bar's area-grouped visual order (areas alphabetically, unassigned last) instead of flat toolbar order

## [1.2.2] - 2026-03-01

### Fixed
- **Swipe navigation sorting** - Aligned agent sort order in swipe navigation with overview panel: idle agents with task labels now sorted first, status ordering applied before unread check
- **Mobile agent bar sizing** - Reduced agent bar item and spawn button sizes (20px to 15px, icons 10px to 8px) for a more compact mobile bottom bar
- **Small mobile agent bar** - Scaled down agent bar items from 36px to 27px and icons from 16px to 12px for better fit on small screens
- **Mobile agent bar min-height** - Reduced from 24px to 18px for tighter layout

## [1.2.1] - 2026-02-28

### Fixed
- **Android keyboard height detection** - Native WindowInsets listener in MainActivity passes exact keyboard height to WebView via CSS custom properties, replacing unreliable Visual Viewport API on Android
- **Keyboard height calculation** - Fixed baseline overlap subtraction that caused incorrect keyboard height when system navigation bar was present
- **Mobile input bar padding** - Removed bottom safe-area padding when keyboard is visible to prevent input being pushed below keyboard edge

### Changed
- **Viewport meta tag** - Added `interactive-widget=resizes-content` for better keyboard behavior on modern mobile browsers
- **Idle agent sorting** - Idle agents with a task label (completed tasks needing attention) are now sorted before other idle agents in both overview panel and dashboard
- **useKeyboardHeight native detection** - Skips Visual Viewport API when native Android insets handler is active to avoid conflicts

## [1.2.0] - 2026-02-28

### Added
- **Syntax highlighting for code blocks** - Markdown code blocks in agent output now use Prism.js syntax highlighting when the language is supported
- **Syntax highlighting for bash commands** - Bash commands in OutputLine and BashModal render with Prism.js highlighting for better readability
- **Swipe-to-reveal clear context** - Mobile agent cards support swipe-left gesture to reveal a "Clear context" action button
- **`highlightCode` utility** - New exported function in syntaxHighlighting for safe Prism.js highlighting with HTML-escape fallback

### Changed
- **Agent card swipe interaction** - Cards now wrap in a swipe container with touch direction detection, preventing conflicts with vertical scrolling
- **Overview panel mobile polish** - Improved styling for swipe reveal actions and resize handle

## [1.1.1] - 2026-02-28

### Added
- **Mobile search toggle button** - Dedicated search icon button in overview panel stats row for quick access on phones

### Changed
- **Mobile overview panel border** - Thicker bottom border with cyan accent and layered box-shadow for better visual separation

## [1.1.0] - 2026-02-28

### Added
- **Subagent history loading** - New module loads persisted subagent JSONL files from disk with correlation mapping to parent session tool_use calls
- **Agent tool support** - Full parity with Task tool for subagent tracking, delegation, and history loading across frontend and backend
- **Unified diff reconstruction** - FileViewerModal reconstructs original file content from unified diffs with fallback diff view
- **Unified diff in file snapshots** - Build file snapshots now include `unified_diff` from `git diff HEAD` for richer context
- **Theme task label color** - Added `taskLabelColor` field to all 10 theme definitions for overview panel styling
- **CSS custom properties in overview panel** - Replaced Sass variables with CSS variables for better theming flexibility

### Changed
- **Overview panel color styling** - Agent name backgrounds, class badges, and area chips use lighter color-mix() approach for improved readability
- **Agent card rendering refactored** - Extracted `renderAgentCards()` with status separators for cleaner markup and sorting UX
- **History loader subagent hydration** - `useHistoryLoader` hook now calls `store.hydrateSubagentsFromHistory()` when subagent data arrives
- **File path detection improved** - File tools now detect root-level files without slashes (e.g., README.md)
- **Diff viewer styling** - Thinner scrollbars, transparent tracks, proper horizontal scrolling with `fit-content` width
- **File viewer scroll management** - Outer scroll disabled when DiffViewer shown to prevent double-scrolling

### Fixed
- **Subagent history correlation** - JSONL files properly correlated to parent tool_use IDs via `buildToolUseIdToSubagentIdMap()`
- **Stream entry limits** - Subagent file parsing truncates to 200 most recent entries per file to prevent payload bloat
- **Diff viewer filename overflow** - Ellipsis truncation with proper `min-width: 0` for long paths
- **Diff panel width management** - Both side-by-side panels now have proper overflow handling for flex layout

## [1.0.1] - 2026-02-28

### Added
- **Git changes context menu** - Right-click git files for actions: open, stage, discard, delete, copy path, reveal in tree, open conflict resolver
- **Git status grouping** - IntelliJ-style grouping into Conflicts, Changes, and Unversioned Files categories
- **Git discard endpoint** - New `/api/files/git-discard` for discarding working tree changes with proper handling of untracked, staged, and modified files
- **Mobile-responsive overview panel** - Collapsible filters, smart agent sorting by status/unread/activity, auto-scroll to active agent

### Changed
- **Swipe navigation direction** - Fixed swipe left/right to correctly map to previous/next agent
- **Agent selection tracking** - Timestamp-based direct click tracking with 1500ms threshold replaces boolean flag
- **Mobile layout improvements** - Overview header hidden on mobile, terminal fullscreen reclaims agent bar space, virtual keyboard suppresses autofocus
- **Git file item styling** - Reduced spacing and padding for denser list display
- **Button icons** - Clear Context uses broom icon, Remove Agent uses X mark icon
- **Onboarding modal** - Only displays when no agents exist

### Fixed
- **Mobile back navigation double-fire** - Added 200ms debounce for popstate/hashchange events
- **Agent overview sorting** - Removed deprecated hasUserInstruction check, reordered to status/unread/activity
- **Direct click autofocus** - Timestamp-based tracking prevents stale flag from suppressing focus

## [1.0.0] - 2026-02-27

### Added
- **Agent list search and filtering** - Search agents by name, task, class, or tool with status filter chips (Active, Idle, Waiting, Error) and count badges
- **Agent overview deep search** - Search through supervisor history and file changes with match context display
- **Same Area Only filter** - Scope agent overview panel to agents in the same area as the active agent
- **Terminal fullscreen toggle** - Fullscreen button with keyboard shortcut and mobile menu support
- **File viewer search highlights** - Absolute-positioned overlay spans for search matches with auto-scroll navigation
- **Spawn modal auto-select** - Automatically selects agent class when search narrows to exactly one result
- **Codex context stats** - Generates estimated context stats from usage snapshots for proper context bar display
- **Agent debugger enhancements** - Extracts parentAgentId and bossId from message payloads for better tracing

### Changed
- **Agent list UI restructured** - Search bar, status filters, quick stats bar, and activity-based sorting
- **Agent overview panel rewritten** - Configurable display options for subagents and recent activity sections
- **Supervisor reports improved** - Reports only on idle after step_complete with 5-minute cooldown to prevent duplicates
- **Codex session deduplication** - Content-based dedup for assistant messages prevents duplicate text from multiple event types
- **Notification toast redesign** - Icon inline with agent name, title on same line, removed "click to focus" hint
- **Terminal header simplified** - Shows task label or last input without status description filtering
- **Auto-resume on restart removed** - Agents start idle after server restart instead of attempting auto-resume
- **Agent debugger always captures** - Message logging no longer conditional on debugger enabled state
- **i18n updates** - New translation keys across all 11 locales for search, filters, fullscreen, and status labels

### Fixed
- **Codex context bar showing "Not retrieved yet"** - Properly generates stats from available token data
- **Duplicate assistant messages in Codex sessions** - Content-based dedup prevents same text appearing multiple times
- **File viewer search scroll** - Decoupled match navigation from scroll action for reliable auto-scroll
- **Agent debugger inconsistent capture** - Always logs and captures messages regardless of enabled state

## [0.85.0] - 2026-02-26

### Added
- **Mobile swipe-up close gesture** - Swipe up from terminal input to return to 3D scene on small screens
- **Codex binary path configuration** - Settings UI (Connection section) for overriding auto-detected Codex path
- **Pan inertia/momentum physics** - Smooth camera panning momentum on 3D and 2D scenes after swipe release
- **Web search tool rendering** - Codex session history now parses and displays web search tool results
- **Fallback tool renderer** - Unknown/unsupported Codex tool types shown with expandable details view
- **Codex experimental JSON event format** - Parser supports payload-wrapped response items and reasoning events
- **Android notification deduplication** - Notification ID tracking with 2-minute TTL prevents duplicate alerts
- **Session loader for Codex** - Parses Codex session history into structured events for display

### Changed
- **Codex backend uses `--experimental-json`** - Enhanced event stream format replacing `--json`
- **Notification skill simplified** - Uses only HTTP API, removed D-Bus fallback on Linux
- **Mobile terminal header sizing** - Minimum 40px height for better touch accessibility
- **2D scene stays mounted on mobile** - Prevents reload/flicker when toggling terminal panel
- **Notification toasts show agent class icon** - Visual distinction for agent notifications
- **Terminal input area refactored** - Mobile swipe gesture state management and tracking

### Fixed
- **Codex binary PATH resolution** - Respects `CODEX_BINARY` env var and Settings UI path override
- **Codex event text capping** - Fallback text capped at 4000 chars to prevent unreadable output
- **Codex task completion events** - Properly show last agent message in session history

## [0.84.3] - 2026-02-26

### Added
- **Keyboard jump to notifying agent** - Tab shortcut in Commander view jumps to the agent that last sent a notification, then cycles tabs normally
- **Auto-generate local certs on `--https`** - When HTTPS is enabled but no certs exist, mkcert auto-generates them instead of failing

### Changed
- **mkcert output visible** - Certificate installation now uses `stdio: inherit` so users see mkcert progress and password prompts
- **TLS cert resolution order** - Explicit `--tls-key`/`--tls-cert` flags applied before `--install-local-cert` to prevent override
- **Removed dead `spawnSyncOrThrow`** - Replaced by direct `execSync` calls in mkcert workflow

## [0.84.2] - 2026-02-26

### Changed
- **Landing page demo link** - Demo nav link now styled as primary button linking directly to `/app` instead of `#demo` anchor
- **mkcert resolution** - `--install-local-cert` now explicitly finds the system Go-based mkcert binary, skipping any npm `mkcert` package to avoid conflicts
- **Improved mkcert error messages** - Clear errors when mkcert is missing or `-install` fails, with install link and sudo hint

## [0.84.1] - 2026-02-26

### Added
- **Default skills for boss spawn modal** - Boss agents now pre-select full-notifications, streaming-exec, and task-label skills on open
- **Task-label skill added to default spawn skills** - Both regular and boss spawn modals include task-label in default skill set

### Changed
- **Clear context resets agent metadata** - Clearing context now resets status, taskLabel, currentTask, sessionId, tokens, and last prompts for immediate UI parity
- **Spawn modal skill initialization** - Default skills now re-apply on each modal open instead of only when no skills are selected
- **Notification route updates task label** - Posting a notification also updates the agent's taskLabel to reflect the message
- **Task label cleared on agent reset** - Agent handler and command handler clear taskLabel when resetting agent state

## [0.84.0] - 2026-02-26

### Added
- **Onboarding modal** - Welcome screen for first-time users with step-by-step guidance and "Create First Agent" button
- **Task label skill** - Agents can set brief task labels displayed in the UI, providing better visibility of current work
- **Drag and drop file attachment** - Terminal now supports dragging files directly into the input area
- **Touch input for agent bar** - Long-press on touch devices to reorder agents with improved drag handling
- **Syntax highlighting in conflict resolver** - File conflicts now display with language-specific syntax highlighting via Prism
- **Conflict navigation** - Previous/Next buttons and keyboard navigation to jump between merge conflicts
- **HTTPS/WSS server support** - Enable TLS/SSL encryption with `--https` flag and certificate configuration
- **Auth token generation** - New `--generate-auth-token` CLI flag to auto-generate secure authentication tokens
- **Smooth camera zoom interpolation** - Camera zoom now smoothly interpolates between positions instead of snapping
- **Dynamic battlefield sizing** - Terrain elements scale and reposition based on battlefield size configuration

### Changed
- **Conflict resolver "both" strategy** - Resolution options now support keeping both sides in addition to "ours" and "theirs"
- **File upload acceptance** - Terminal file input now accepts all file types instead of whitelisted extensions only
- **Agent panel task labels** - Task labels displayed in header next to agent ID for better visibility
- **3D sprite rendering** - Status bars and name labels use proper depth/render order for cleaner layering
- **Area state reactivity** - Area updates now create new Map references to ensure UI detects changes properly
- **2D scene touch input** - Touch events prioritize drawing mode and area resizing before panning/dragging

### Fixed
- **Terminal keyboard cleanup** - Fixed stuck keyboard visibility state after rapid agent switching
- **Conflict resolver auto-scroll** - Conflicts now automatically scroll into view on page load
- **Touch drag on mobile** - Improved drag threshold and long-press detection to prevent accidental drags
- **Vite dev server HTTPS** - Added HTTPS support in development builds with configurable certificate paths

## [0.83.0] - 2026-02-25

### Added
- **Area directory badges in terminal header** - Clickable folder badges showing assigned area directories for the active agent, opening the file explorer on click

### Changed
- **Smarter history refresh trigger** - `triggerHistoryRefresh` now only triggers an immediate re-fetch if the affected agent is currently selected in the terminal, reducing unnecessary network requests

## [0.82.0] - 2026-02-25

### Added
- **Backend connection validation** - New `backendConnection.ts` utility with URL validation and `/api/health` reachability check before connecting
- **NotConnectedOverlay connect flow** - Multi-step connection with status indicators (validating, checking reachability, connecting WebSocket) and clear error messages
- **Boss delegation parser refactor** - Extracted delegation block extraction, JSON segment parser, and typed payload into clean functions with test helper

### Changed
- **Exec route `success` semantics** - `/api/exec` now returns `success: true` whenever the command ran (agents check `exitCode` for pass/fail)
- **Streaming exec skill docs** - Documented `success`/`exitCode` semantics so agents correctly interpret non-zero exit codes

## [0.81.0] - 2026-02-25

### Added
- **Cross-tab backend URL sync** - New `subscribeBackendUrlChange()` utility syncs backend URL changes across browser tabs via `StorageEvent`

### Changed
- **Backend URL input persistence** - NotConnectedOverlay now saves URL on every keystroke instead of only on explicit save
- **Centralized `getBackendUrl()` usage** - WebSocket connection and API base URL now use the same `getBackendUrl()` accessor instead of raw storage reads
- **Simplified URL change subscriptions** - ConfigSection and NotConnectedOverlay use the new `subscribeBackendUrlChange()` helper, removing manual event listener boilerplate

## [0.80.0] - 2026-02-25

### Added
- **3D scene loading overlay** - Spinner overlay shown when switching to 3D mode for smoother UX
- **ExitPlanMode tool renderer** - Collapsible plan display with markdown rendering in terminal output
- **Touch long-press context menu** - Mobile 2D scene supports long-press to open agent context menus with haptic feedback
- **Android app icon refresh** - Updated launcher icons and foreground assets
- **Env-driven Capacitor server URL** - `CAP_SERVER_URL` controls dev vs bundled APK builds
- **New Makefile targets** - `apk-release-nondev` for bundled-asset debug APK, `dev-apk` for live-reload APK
- **Release pipeline: non-dev APK and npm publish steps** - Pipeline now builds both APK variants and includes npm publish phase

### Changed
- **Smart 3D scene disposal** - 3D scene kept in memory on desktop for instant mode switching, disposed only on mobile to save memory
- **Stdout pipeline improvements** - Enhanced output parsing and rendering
- **NotConnectedOverlay** - Updated layout and styling
- **ConfigSection** - Improved settings layout
- **VirtualizedOutputList and HistoryLine** - Enhanced rendering and interaction

## [0.79.0] - 2026-02-24

### Added
- **Auto-refresh conversation history** - Terminal output now auto-refreshes when an agent transitions from working to idle or when a session file updates, catching events missed during backend disconnects

## [0.78.1] - 2026-02-24

### Changed
- **Release pipeline skill refinements** - Debug APK now always builds as part of the release (no longer optional), version bump type is auto-decided from commit history

## [0.78.0] - 2026-02-24

### Added
- **Instant agent switching for cached history** - Switching between agents with cached conversation history is now instant, skipping redundant re-fetches
- **Release pipeline builtin skill** - New TC Release Pipeline skill for full release workflow: lint, type-check, test, build, version bump, changelog, git tag, and GitHub release
- **README resume section** - Added documentation for resuming agent sessions

## [0.77.0] - 2026-02-24

### Changed
- **Scene2D static/dynamic layer split** - Ground, grid, areas, and buildings render to an off-screen canvas cache that only redraws on camera or data changes; main canvas blits the cache in a single `drawImage` call
- **Adaptive FPS throttling** - Idle scenes render at 8 fps, working-agent scenes at 15 fps, and active interactions (pan/zoom/drag) run uncapped, cutting GPU usage when nothing is moving
- **DPR cap and pixel budget** - Device pixel ratio clamped to 1.25 with a 4M-pixel ceiling to keep `clearRect`/fill passes fast on ultra-wide and HiDPI displays
- **Frustum culling** - Agents, areas, buildings, and boss-subordinate lines skip drawing when off-screen
- **Removed all Canvas2D `shadowBlur`** - Replaced with lightweight offset shapes, wider translucent strokes, and radial gradients across `AgentRenderer`, `AreaRenderer`, `BuildingRenderer`, and `Scene2DEffects`
- **Removed all CSS `backdrop-filter: blur()`** - Agent bar, bottom toolbar, context menu, commander view overlay, guake terminal, and right panel now use higher-opacity backgrounds instead
- **Color conversion caching** - `hexToRgba`, `lightenColor`, and `darkenColor` results cached in shared maps with quantized alpha keys
- **Cached sorted area arrays** - Area sort by zIndex computed once and invalidated on mutation instead of re-sorting every frame
- **Per-frame store snapshots in AgentRenderer** - `beginFrame()` reads `customAgentClasses` and `agentsWithUnseenOutput` once, avoiding `store.getState()` per agent in the hot loop
- **Cached ground gradient in GridRenderer** - Radial gradient rebuilt only on viewport resize instead of every frame
- **Removed animated dash offsets** - Area borders, boss lines, and drawing previews use static dash patterns instead of per-frame `lineDashOffset` animation
- **Reduced working-agent animation complexity** - Removed water-wave ripple effect; simplified bounce, pulse, and selection glow to fewer trig calls
- **Granular store selectors** - New `useAgents`, `useAreas`, `useBuildings`, `useFileChanges` selectors replace broad state subscriptions
- **Memo-wrapped VirtualizedOutputList** - Wrapped in `React.memo` with custom comparator to skip re-renders when messages haven't changed

### Fixed
- **Memory leak in useSceneSetup cleanup** - StrictMode disposal now checks `store.viewMode` instead of `canvas.isConnected`, correctly preserving WebGL context during React re-mounts
- **Stale eslint disable comment** - Removed orphaned `react-hooks/exhaustive-deps` suppression in `useSpotlightSearch` (rule was not configured)

## [0.76.0] - 2026-02-24

### Added
- **Isolated ElapsedTimer in AgentPanel** - Extracted elapsed timer + stop button into its own `memo`-wrapped component so the parent `AgentPanel` no longer re-renders every second while an agent is working
- **Agent status label badge** - Colored status label (working/idle/error/offline) shown in the agent panel header for at-a-glance state
- **Animated mobile accordion** - Focused panel expands with `panelExpand` keyframe animation plus staggered `contentFadeIn` and `inputSlideIn` for smooth open/close transitions
- **Focus toggle** - Tapping an already-focused agent header collapses it back (toggle behavior instead of one-way)

### Changed
- **Exec task output preview** - Collapsed exec output now shows last 6 lines instead of 3 for better context
- **Mobile auto-focus skips touch devices** - `(pointer: coarse)` media query prevents auto-focusing inputs on mobile, avoiding unwanted virtual keyboard popup
- **Pin to bottom on focus** - Scroll auto-pins when an agent panel becomes focused (not just expanded)
- **Click handler optimization** - Panel body `onClick` only fires on non-focused panels; focused panels route header clicks to toggle

### Removed
- **WorkingIndicator in AgentPanel** - Replaced by the isolated `ElapsedTimer` component that uses the Guake stop bar styling
- **`.agent-panel-typing` / `.agent-panel-stop-btn`** - Removed old typing indicator styles in favor of shared `guake-stop-bar` styles

## [0.75.0] - 2026-02-23

### Added
- **AskUserQuestion inline renderer** - New `AskQuestionInput` component renders questions with numbered options, badges, description text, and expandable markdown previews directly in the output panel
- **Mobile card-stack Commander View** - Replaced scroll-based layout with Apple Wallet-style card stack: focused agent fills the screen, non-focused agents collapse to peeking headers with tap-to-focus

### Changed
- **WebSocket broadcast serialization** - Extracted `messageReplacer` and `serializeMessage` to serialize once and reuse the string for all clients, eliminating per-client re-serialization and double-parse validation
- **Combined status polling** - Merged separate status sync (30s) and orphan polling (10s) intervals into a single 20s timer, reducing timer overhead
- **Async session stat** - `getSessionActivityStatus` now uses `fs.promises.stat` instead of blocking `fs.statSync`

## [0.74.0] - 2026-02-23

### Changed
- **Atomic file writes with backup recovery** - All data persistence (agents, areas, buildings, skills, secrets, etc.) now uses write-to-tmp + rename pattern with `.bak` fallback, preventing corruption from mid-write crashes
- **Async debounced agent persistence** - `updateAgent()` coalesces rapid writes into a single async write (2s debounce), reducing I/O pressure from frequent status updates
- **Flush-on-shutdown** - New `flushPersistAgents()` cancels any pending debounced write and performs an immediate sync save during graceful shutdown
- **Removed unnecessary memo wrappers** - `VirtualizedOutputList` and `AgentPanel` no longer wrapped in `React.memo()` since they re-render on every parent update anyway
- **2D scene animation timing** - Separate `animationDelta` based on time since last render keeps animation speed constant regardless of FPS limiting

### Added
- **Mobile Commander View** - Fully responsive layout for screens under 768px: vertically scrolling 60vh agent cards with scroll-snap, touch-optimized 44px hit targets, compact header/tabs/filters, horizontally scrollable filter bar, and safe-area inset support for notched devices
- **Virtualizer initialRect** - Prevents empty first render by providing a non-zero initial size estimate
- **ResizeObserver scroll sync** - Dispatches a scroll event after container resize to keep the virtualizer offset in sync with the actual scrollTop after CSS grid reflows

### Fixed
- **Virtualizer blank on first render** - `initialRect: { width: 500, height: 800 }` prevents `outerSize=0` from yielding zero visible items until a scroll event
- **Virtualizer blank after filter change** - ResizeObserver detects container resize and forces virtualizer to re-read scroll offset, fixing zero-item renders after grid reflow

## [0.73.0] - 2026-02-23

### Changed
- **Memo-wrapped core components** - `AgentBar`, `GuakeOutputPanel`, `TerminalHeader`, `TerminalInputArea`, `AgentPanel`, `MobileFabMenu`, `GuakeAgentLink`, and `ThemeSelector` are now wrapped in `React.memo()` to skip re-renders when props are unchanged
- **Isolated ElapsedTimer component** - Extracted the 1-second elapsed timer into its own component so the entire `TerminalInputArea` no longer re-renders every tick
- **Stable callback references** - Replaced inline arrow functions with `useCallback` and ref-based patterns across `App.tsx`, `AgentBar`, and `CommanderView` keyboard handlers to preserve referential equality
- **Narrower store selectors** - New `useAgentCount`, `useSupervisorLastReport`, `useSupervisorGeneratingReport`, `useSubagentsMapForAgent`, and `useLastPrompt` selectors replace broad subscriptions
- **Set immutability for selectedAgentIds** - All mutations now create new `Set()` instances so shallow-equality selectors properly detect changes
- **Commander View tab counts** - Pre-computed `tabCounts` map replaces inline `Array.from().filter()` on every render
- **Working agent panel styling** - Changed from purple to green theme for better visual distinction
- **Agent removal cleanup** - `handleRemoveAgent` now stops the runtime, cancels pending permissions, and cleans up boss hierarchy before deleting

### Added
- **`AgentBarItem` memoized component** - Individual agent items in the bottom bar are now independently memoized, preventing full-bar re-renders on single-agent updates
- **`usePermissionRequests` reactive selector** - Permission requests in `GuakeOutputPanel` now use a store subscription instead of imperative reads, ensuring new permissions appear immediately
- **Agent-switch scroll reset** - `isAgentSwitching` state + `key={activeAgentId}` on `VirtualizedOutputList` forces a clean remount, fixing stale virtualizer offsets when switching agents

### Fixed
- **Stale closure in delete handler** - `handleDeleteSelectedAgents` now reads selection from `store.getState()` at execution time instead of a potentially stale closure
- **Console log cleanup** - Removed ~40 debug `console.log`, `console.warn`, and `console.trace` calls left over from development

## [0.72.1] - 2026-02-23

### Changed
- **Non-blocking WebSocket connection** - Connection handler no longer awaits `syncAllAgentStatus()` before sending initial state; sends custom classes, agents, and settings immediately, then syncs status in background with a follow-up `agents_update`

## [0.72.0] - 2026-02-23

### Changed
- **Granular store selectors** - App and AgentBar no longer subscribe to the entire store via `useStore()`; each slice (agents, areas, buildings, settings, etc.) uses its own selector, drastically reducing unnecessary re-renders
- **History cache for instant agent switching** - Per-agent history cache shows cached messages immediately on revisit instead of blanking the screen while fetching
- **Commander View virtualized output** - AgentPanel now uses `VirtualizedOutputList` instead of rendering every message in the DOM, improving scroll performance for long histories
- **Disabled performance.mark/measure** - Native `PerformanceMeasure` entries accumulated indefinitely causing ~40MB+ memory leak in long sessions; disabled to prevent bloat

### Added
- **`/clear` command in Commander View** - Typing `/clear` in an agent panel input now clears that agent's context and history
- **`useRenderCounter` dev hook** - Logs render frequency per component interval to help spot render storms during development
- **`useLastSelectedAgentId` selector** - Fine-grained selector that only triggers re-renders when the last-selected agent ID changes
- **Escape key fix in Commander View** - Escape no longer closes Commander View when a file viewer or context modal is open on top

### Fixed
- **Space key in collapsed terminal input** - Space shortcut to open terminal now properly blurs the input first in both 3D and 2D scene handlers
- **History fade-in flash** - Skip hiding content when switching agents if cached history is available, preventing a blank flash on revisit

## [0.71.5] - 2026-02-23

### Changed
- **Faster history fade-in** - Reduced terminal history message fade-in animation from 250ms (with 50ms delay) to 50ms immediate for snappier feel

## [0.71.4] - 2026-02-23

### Changed
- **README** - Added Commander View screenshot, updated view modes count from three to four, trailing whitespace cleanup

## [0.71.3] - 2026-02-23

### Fixed
- **Area logo hash in 3D sync** - Include logo opacity, dimensions, position, and filename in area hash so 3D scene re-renders when logo properties change
- **Logo texture race condition** - Logo texture load callback now fetches the current area group and state from the store instead of using stale closure references
- **Logo opacity stacking** - Enabled `depthWrite` and `alphaTest` on logo material and set `renderOrder: -1` to prevent fill opacity stacking through the logo
- **Brightness skips logos** - `setBrightness` and `setSelectedArea` now skip `areaLogo` meshes so logo opacity is not affected by brightness changes

## [0.71.2] - 2026-02-23

### Fixed
- **Duplicate native notifications** - Skip `showNotification` on native Android since the foreground service WebSocket already handles background notifications, preventing double alerts
- **Notification listener cleanup** - `initNotificationListeners` now returns a cleanup function and guards against duplicate registration across React re-renders
- **Listener memory leak** - WebSocket connection hook properly removes notification tap listeners on unmount

## [0.71.1] - 2026-02-23

### Changed
- **Custom app icon** - Replaced default Android launcher icons (all densities) with Tide Commander branded icon and dark background (#0a0a0f)
- **Proper Capacitor ES imports** - Switched from `require()` try/catch to direct ES module imports for `@capacitor/core` and `@capacitor/local-notifications`
- **ServerConfig plugin via registerPlugin** - Use Capacitor `registerPlugin()` API instead of accessing `Capacitor.Plugins` directly for type-safe native bridge calls
- **Keyboard adjustResize** - Added `android:windowSoftInputMode="adjustResize"` to AndroidManifest for proper keyboard handling
- **Notification error handling** - Wrapped all LocalNotifications calls in try/catch with console logging for better debugging on native
- **Notification ID range** - Shifted local notification IDs to start at 100 to avoid collision with foreground service notification (ID 1)
- **Removed scheduled delay** - Notifications now fire immediately instead of using 100ms `schedule.at` delay
- **Live reload dev config** - Added dev server URL to `capacitor.config.ts` for faster Android development iteration

### Removed
- **Deleted vector drawable icons** - Removed `ic_launcher_foreground.xml` and `ic_launcher_background.xml` in favor of raster PNG icons

## [0.71.0] - 2026-02-23

### Added
- **Native Android background notifications** - Foreground service now maintains its own OkHttp WebSocket connection to deliver agent notifications as Android system notifications when app is in background
- **ServerConfigPlugin** - New Capacitor plugin that syncs server URL and auth token from JS to native SharedPreferences for foreground service WebSocket
- **App foreground/background tracking** - MainActivity tracks `isAppInForeground` state so native notifications only fire when WebView JS is paused

### Changed
- **WebSocket foreground service rewrite** - Refactored `WebSocketForegroundService` with native OkHttp WebSocket client, exponential backoff reconnect, and dynamic foreground notification status updates
- **Capacitor dependency cleanup** - Removed unused `@capacitor/haptics` and `@capawesome/capacitor-background-task` plugins from Android build
- **Notification imports separated** - Split Capacitor core and local-notifications imports into separate try/catch blocks for better web build compatibility
- **Mobile message padding** - Increased bottom padding in mobile terminal output to account for context bar, stop bar, and input wrapper height
- **Sidebar collapse button mobile fix** - Pinned sidebar collapse button to right edge on mobile (sidebar off-screen by default)
- **Connection sync to native** - WebSocket connection handler now syncs server URL to native foreground service on successful connect

## [0.70.1] - 2026-02-23

### Added
- **Mobile overflow menu** - Terminal header actions consolidated into a "more actions" (⋮) dropdown menu on mobile for cleaner UI
- **Mobile-optimized terminal header** - Streamlined header layout with fewer visible buttons, context and search hidden behind overflow menu

### Changed
- **Mobile responsive overhaul** - Major rework of mobile styles (~750 lines) for improved terminal, agent bar, and panel layouts
- **Small mobile breakpoint** - Enhanced styles for very small screens with tighter spacing and compact controls
- **Terminal base styles** - Added mobile-specific terminal base adjustments
- **Terminal header styles** - New mobile overflow menu styles with dropdown positioning and animations
- **Terminal output styles** - Mobile output area spacing improvements

## [0.70.0] - 2026-02-20

### Added
- **Area logo overlays** - Upload logo/image files to zones with configurable position (center, corners), size, aspect ratio lock, and opacity slider; rendered in both 3D and 2D scenes with texture caching
- **Area logo API** - Upload, serve, and delete logo files via `/api/areas/:areaId/logo` and `/api/areas/logos/:filename` endpoints with 5MB limit and type validation
- **Database multi-query support** - SQL editor now splits queries by semicolons; "Run at Cursor" (Ctrl+Enter) executes the statement at caret, "Run All" (Ctrl+Shift+Enter) executes every statement sequentially
- **Query editor resize handle** - Drag handle below the editor to resize height, persisted to localStorage

### Changed
- **Folder dropdown compacted** - Smaller font/padding, hidden redundant path label when it matches folder name
- **Area logo cleanup on sync** - Orphaned logo files are automatically deleted when areas are removed or logos replaced
- **Locale updates** - Added area logo and multi-query translations across all 11 locales

## [0.69.4] - 2026-02-19

### Added
- **Subagent JSONL streaming** - Real-time streaming of subagent activity from JSONL files via file watcher, with inline stream panel showing tool use, text output, and results as they happen
- **Pull conflict resolution flow** - Git pull now detects merge conflicts and routes them through the existing merge resolution UI instead of showing a generic error

### Changed
- **Subagent auto-remove timer** - Extracted into shared `scheduleRemove` function; incoming stream entries now extend the timer so subagents with late-arriving data stay visible longer
- **Folder dropdown polish** - Tighter padding/spacing, smaller font sizes, smooth scroll with `onWheel`, and redundant path label hidden when it matches the folder name
- **Dedup debug logging** - History and live output deduplication now logs dropped outputs with UUIDs/timestamps for easier troubleshooting

### Fixed
- **Pull uses `--no-rebase`** - Git pull endpoint now uses merge strategy by default, and properly parses conflict file paths from combined stdout+stderr
- **Pull return type** - `pullFromRemote` now returns `MergeResult` (with `conflicts` array) instead of generic `GitBranchOperationResult`

## [0.69.3] - 2026-02-19

### Changed
- **Expandable subagent results** - Subagent completion messages now show a collapsible "Show result" toggle instead of inline preview text, keeping the output clean while preserving full result access
- **Hide tool_result in simple view** - Tool result entries are now hidden in simple/history view to match live output filtering behavior

### Removed
- **Dead silent context refresh code** - Removed unused `scheduleSilentContextRefresh` function and its wiring in runtime-events/runtime-service (context tracking now uses `usage_snapshot` events exclusively)

## [0.69.2] - 2026-02-19

### Changed
- **Simplified Claude context tracking** - `step_complete` for Claude agents now preserves the authoritative `usage_snapshot` value instead of re-deriving context from potentially cumulative modelUsage/token sums; eliminates inflated context bar readings
- **Subagent event isolation** - `usage_snapshot` and `step_complete` events with `parentToolUseId` are now skipped for context tracking, preventing subagent token counts from corrupting the parent agent's context bar; subagent cost is still accumulated into `tokensUsed`
- **Subagent context_update broadcast filter** - `runtime-listeners` skips broadcasting `context_update` for subagent events to prevent UI flicker
- **Mobile sidebar close button** - Redesigned as a sticky header bar pinned to the top of the sidebar instead of a small floating circle
- **Mobile sidebar backdrop** - Darker overlay (0.7 opacity) with stronger blur (4px) and `touch-action: none` to prevent scroll-through
- **Mobile agent list** - Touch-friendly sizing with 44px min-height tap targets, larger icons, and active-state feedback
- **Mobile tool history** - Added dedicated mobile styles for tool history panel (compact headers, items, and expandable details)
- **Mobile unit panel** - Horizontal stat rows, compact secondary info sections, hidden 3D model preview to save vertical space
- **Small mobile refinements** - Tighter sidebar close button, wrapping action icons, smaller agent list items for screens under 380px

### Fixed
- **Unit panel button tap delay** - Added `touch-action: manipulation` and `-webkit-tap-highlight-color: transparent` to eliminate 300ms tap delay on mobile

## [0.69.1] - 2026-02-18

### Added
- **Mobile context bar** - Compact context stats bar above the input area on mobile, tappable to open the full context modal
- **New backend tests** - Tests for comma-separated token counts and visual context format parsing

### Changed
- **Unified token parser** - `parseContextOutput` and `parseVisualContextOutput` now share a robust `parseTokenValue` helper supporting `k`, `m` suffixes, comma separators, and decimal percentages
- **Cumulative token guard** - `usage_snapshot` and `step_complete` handlers detect when token sums exceed the context limit (cumulative session totals) and preserve the last valid per-request value instead of inflating the context bar
- **Context stats broadcast sanitization** - `broadcastContextStats` resets totalTokens to 0 if it exceeds contextWindow, preventing impossible context bar values
- **Context command fallback chain** - `handleRequestContextStats` now tries CLI fetch, then in-session `/context` command, then tracked data (was: CLI then tracked data only)
- **Context stats from tracked data** - `buildStatsFromTrackedData` guards against values exceeding contextLimit
- **Real-time context updates** - `updateAgentContext` now also patches `contextStats` (totalTokens, contextWindow, usedPercent) so the context modal stays in sync
- **History view** - Shows all messages including utility slash commands (`/context`, `/cost`, `/compact`) and tool results in simple view
- **Visual context parser** - Upgraded regex to handle comma-separated numbers, `m` suffix (millions), and decimal percentages
- **Context stats parsing** - `runtime-listeners` now tries `parseAllFormats` (which handles visual bar-chart format) before falling back to `parseContextOutput`

### Fixed
- **Sidebar toggle on mobile** - Button now toggles the slide-in sidebar on mobile instead of the desktop collapse state
- **Sidebar open state on mobile** - `!important` overrides on transform/opacity/pointer-events ensure the sidebar actually appears when opened
- **Mobile agent bar height** - Uses CSS custom property with `safe-area-inset-bottom` for landscape and portrait modes
- **Stop bar position on mobile** - Moved up to clear the context bar
- **Session expanded state** - Moved `useState` for session continuation before early returns to fix React hook ordering
- **File path paste** - Inserts path as text when file is not found instead of silently dropping it
- **dist-app in .gitignore** - Added `dist-app/` to prevent build artifacts from being tracked

## [0.69.0] - 2026-02-18

### Added
- **Subagent observability** - Inline activity panels below Task tool lines show real-time tool usage, elapsed time, and completion stats for subagents
- **Real-time context tracking** - Context bar updates live during streaming via `usage_snapshot` events instead of waiting for step completion or `/context` command
- **Lightweight `context_update` WebSocket message** - New message type for efficient real-time context bar updates
- **Subagent activity tracking** - New `addSubagentActivity` and `updateSubagentStats` store actions with tool activity timeline UI
- **CLI context fetch** - Context stats modal now spawns a short-lived CLI process to get real `/context` data instead of sending commands to busy agents
- **Visual context format parser** - New `parseVisualContextOutput` function handles the bar-chart terminal format from newer Claude CLI versions
- **Empty assistant message placeholder** - History view shows italic "empty message" label for blank assistant responses
- **Makefile additions** - `make deploy-landing` and `make tc` commands, CLI section in help

### Changed
- **Context calculation** - Context window usage now counts input tokens only (cache_read + cache_creation + input_tokens); output tokens no longer inflated the context bar
- **Context token parsing** - Fixed regex to capture `k` suffix in token values (e.g., `377.3k`) instead of relying on magnitude heuristics
- **Subagent internal tool output** - Subagent tool_start and tool_result events with `parentToolUseId` are now shown in the inline activity panel instead of cluttering the parent terminal
- **Subagent completion events** - Now include duration, token usage, and tool count stats from Task tool metadata
- **Step complete handling** - Empty `modelUsage` objects (`{}`) no longer zero out context values; preserves usage_snapshot data
- **Context commands** - `/context`, `/cost`, `/compact` step_complete events preserve authoritative context_stats values instead of overwriting with zeros
- **Resume command** - Correctly shows `claude --resume` for Claude agents and `codex resume` for Codex agents
- **Markdown viewer** - "View as Markdown" button now passes full tool output instead of truncated display text
- **File path paste fallback** - When pasted path is not found, inserts it as plain text instead of silently dropping it
- **Subagent result preview** - No longer truncated to 200 chars; full preview passed to client

### Fixed
- **Unused import** - Removed unused `hasPendingSilentContextRefresh` import in runtime-events.ts

## [0.68.0] - 2026-02-18

### Added
- **Live elapsed timer in Guake terminal** - Shows a live `m:ss` countdown while agents are working, displayed next to the stop button
- **Completion time badge** - Brief green badge showing total elapsed time when an agent finishes a task (fades out after 4 seconds)
- **Google Analytics on landing page** - Added gtag.js tracking to the public landing page

## [0.67.3] - 2026-02-18

### Changed
- **3D scene dirty-checking for canvas redraws** - Status bar and name label sprites only redraw when agent status, context percent, or idle bucket changes, avoiding per-frame canvas operations
- **Raycaster hitbox caching** - Pre-computed hitbox array avoids rebuilding `Array.from()` on every raycast; uses `recursive: false` for faster intersection tests
- **Cylinder hitboxes for agents** - Replaced sphere hitboxes with taller cylinder hitboxes covering body and UI elements for more accurate click detection
- **Default scene config** - Changed default floor style to `metal` and disabled grid by default

### Fixed
- **Lint warnings** - Removed unused `freshState` and `isDomCollapsed` variables in InputHandler.ts
- **Debug console logging** - Removed debug logging from input handlers and DoubleClickDetector to eliminate Firefox click throttling
- **CharacterFactory test mock** - Added missing `CylinderGeometry` to THREE mock

## [0.67.2] - 2026-02-18

### Fixed
- **3D scene performance optimization** - Disabled shadow casting on street lamp point lights (~30fps improvement) and reduced bulb geometry segments from 16x16 to 8x8

## [0.67.1] - 2026-02-18

### Fixed
- **Version bump for npm publish** - Re-release of v0.67.0 content due to npm version conflict

## [0.67.0] - 2026-02-18

### Added
- **Static app build for web deployment** - New `vite.app-static.config.ts` builds the app for hosting at `/app/` path without a backend server (e.g., tidecommander.com/app)
- **Not Connected overlay** - When the app loads without a backend connection, a polished overlay shows setup instructions, a backend URL input, and an "Explore" option to browse the UI with 3s grace period
- **Asset path utility** - New `assetPath.ts` helper for resolving asset paths with correct base URL prefix
- **Echo Prompt experimental feature** - Duplicates user messages for improved LLM attention coverage, configurable in Settings > Experimental
- **Custom favicons and app icons** - Replaced emoji favicons with proper PNG icons (favicon.ico, 16x16, 32x32, apple-touch-icon, 192x192, 512x512)
- **Project logo** - New Tide Commander logo in README header and landing page navigation/footer
- **Try Demo badge** - README now includes a "Try Demo" badge linking to tidecommander.com/app

### Changed
- **BASE_URL-aware asset paths** - All hardcoded `/assets/` references across 15+ client files replaced with `import.meta.env.BASE_URL` for correct sub-path deployments
- **Landing page branding** - Replaced emoji logo with custom icon image in nav and footer
- **Landing page build** - Now copies favicon/icon assets to dist-landing
- **Config export** - Minor route path fix in config export

## [0.66.2] - 2026-02-17

### Added
- **Unseen badges on dashboard cards** - Dashboard agent cards now show unseen notification indicators
- **Unseen count in dashboard zone headers** - Zone group headers display count of unseen agents
- **Dashboard "Working & Unseen" group** - Status grouping now combines working and unseen idle agents into one group

### Fixed
- **Unseen badge reactivity** - Fixed Set mutation to create new Set instances for proper React re-renders
- **Terminal unseen clearing** - Viewing an agent in the terminal now properly clears its unseen badge
- **Unseen persistence efficiency** - Only saves to localStorage when unseen set actually changes

## [0.66.1] - 2026-02-17

### Added
- **Persistent unseen agent notifications** - Unseen agent badges now persist across page refreshes via localStorage, so users don't lose track of agents that completed work
- **3D/2D notification badges on agents** - Unseen notification indicators render directly on agent models in both 3D and 2D views

## [0.66.0] - 2026-02-17

### Added
- **Codex file diff enrichment** - Codex agents now generate real Edit tool events with git-backed old/new content diffs for shell-based file edits
- **Clickable file paths in bash commands** - File references in bash command displays are now clickable links that open in the file explorer
- **Bash edit inference from runtime** - Runtime listeners detect file edits from bash commands (sed, echo >>, tee, etc.) and emit synthetic Edit tool events with git diffs
- **New tests** - Added tests for exec command extraction and Codex file diff enrichment

### Changed
- **Improved exec command extraction** - Refactored `extractExecWrappedCommand()` with robust multi-pattern JSON payload parsing for curl /api/exec commands
- **README system prompt docs** - Updated prompt stacking documentation to include individual agent instructions layer
- **Output rendering refactored** - Extracted `extractExecPayloadCommand()` and `splitCommandForFileLinks()` as shared utilities

### Fixed
- **Lint warning** - Removed unused `error` variable in `src/packages/shared/version.ts`

## [0.65.1] - 2026-02-17

### Fixed
- **Silent query error handling** - Silent query results now correctly report failure status instead of always returning `success: true`, with proper error messages and conditional `affectedRows`

## [0.65.0] - 2026-02-17

### Added
- **Enhanced database inline cell editing** - Context menu on cells with Edit/Copy/Set NULL actions, date/time picker for datetime columns, and improved value parsing for JSON and boolean types
- **Silent query execution** - New `silent` mode for database queries that execute UPDATE statements without replacing the current result set, with `silent_query_result` WebSocket message for acknowledgement
- **Database panel keyboard shortcut** - Alt+D toggles the database panel, remembers last-used database building via localStorage
- **Database sidebar table selection** - Click to select a table, double-click to run SELECT query; expand/collapse is now a separate button
- **Buildings file cache** - Server-side mtime-based cache for `loadBuildings()` avoids redundant disk reads
- **CLI star prompt** - Startup banner now includes a link to star the GitHub repository

### Changed
- **Page Down Messages shortcut** - Changed from Alt+D to Alt+Shift+D to free Alt+D for database panel
- **Database query handler** - Improved error handling with try-catch, detailed logging with duration and affected rows
- **ResultsTable** - Enhanced with react-datepicker dependency, context menus, pending update state tracking, and improved SQL generation for object/JSON values

## [0.64.0] - 2026-02-16

### Added
- **Area drag moves contained agents and buildings** - Dragging an area in 3D or 2D view now moves all agents and buildings inside it together
- **npm version status in Agent Bar** - Shows current version vs npm latest with behind/ahead/equal indicators and color-coded badges
- **Shared version checking module** - New `src/packages/shared/version.ts` with `checkNpmVersion()` used by both CLI and client
- **Boss agent API instructions** - Boss agents now have detailed instructions for querying agent history, search, sessions, tool history, and status endpoints
- **Codex boss delegation support** - Codex agents now properly emit `resultText` in `step_complete` events, enabling boss delegation parsing
- **Local agent move** - New `moveAgentLocal()` store action for immediate UI position updates without server round-trip

### Changed
- **CLI version check refactored** - Extracted inline `checkForUpdates()` to shared `checkNpmVersion()` module for code reuse
- **Agent Bar version display** - Replaced `useAppUpdate` hook with `useNpmVersionStatus` for consistent npm-based version checking

## [0.63.4] - 2026-02-16

### Changed
- **Renamed diffs_view image** - Renamed `diffs_view.png` to `diffs_view_2.png` across docs, landing page, and README

## [0.63.3] - 2026-02-16

### Added
- **CLI update check** - On start, status, and "already running" messages, the CLI checks npm registry for newer versions and notifies the user with upgrade instructions

## [0.63.2] - 2026-02-16

### Changed
- **CLI startup banner** - Improved startup messages for both "already running" and "started" states with colored command reference help
- Removed old "Logs: tail -f logs/server.log" line in favor of command help display

## [0.63.1] - 2026-02-16

### Changed
- **Landing page redesign** - Major overhaul of landing page HTML and CSS
- **Makefile updates** - Updated build targets
- **.gitignore** - Added new ignore patterns

## [0.63.0] - 2026-02-16

### Added
- **Server performance metrics** - FPSMeter now shows server-side metrics (heap, RSS, CPU, system load, agent process stats) via `/api/perf` endpoint
- **File resolve API** - New `/api/files/resolve` endpoint to find files by name within a project directory
- **Spotlight search improvements** - Results now sorted by category order for consistent navigation; category grouping matches visual rendering
- **FileViewerModal enhancements** - Expanded file viewer with new features and improved styling
- **Performance route** - New `src/packages/server/routes/perf.ts` server route for system metrics

### Changed
- **Spotlight results ordering** - Flat result arrays now sorted to match category display order (commands, agents, buildings, areas, files, activity)
- **Store selectors** - New selectors for enhanced state access

## [0.62.1] - 2026-02-15

### Added
- **API Documentation links** - Added OpenAPI 3.1 (REST) and AsyncAPI 2.6 (WebSocket) spec links to README documentation table
- Marked API Documentation as complete in roadmap

## [0.62.0] - 2026-02-15

### Added
- **Multilingual support (i18n)** - Full internationalization with 10 languages: English, Spanish, French, German, Italian, Portuguese, Russian, Chinese (Simplified), Japanese, and Hindi
- Language selector in settings with automatic browser language detection
- All UI strings externalized to translation files via react-i18next

## [0.61.5] - 2026-02-13

### Added
- **npm version badge** - Added npm version shield badge to README header

## [0.61.4] - 2026-02-13

### Fixed
- **README images on npm** - Converted all relative image paths to absolute raw GitHub URLs so images render on npmjs and other platforms

## [0.61.3] - 2026-02-13

### Changed
- **README View Modes images** - Added 3D View (example-battlefield) and 2D View (preview-2d) screenshots to their respective View Modes sections; removed 2D preview from header area

## [0.61.2] - 2026-02-13

### Added
- **Inline file inspection screenshot** - Added image to README showing clickable file edits in chat

### Removed
- **Article files** - Removed devto-article.md and medium-article.md

## [0.61.1] - 2026-02-13

### Added
- **README images** - Added screenshots for classes, dashboard view, and file explorer git diffs sections

### Changed
- **README cleanup** - Removed stray lines at bottom of README, deleted medium-article.md

## [0.61.0] - 2026-02-13

### Added
- **Copy Markdown/Original buttons** - File viewer modal now has buttons to copy file content as markdown or original text
- **Doc assets** - Moved example-battlefield.png to docs/ folder

## [0.60.1] - 2026-02-13

### Fixed
- **Sidebar toggle button** - Repositioned to stay flush with sidebar edge, added directional chevron that flips based on collapsed state, improved styling with proper border-radius and hover effects

## [0.60.0] - 2026-02-12

### Added
- **Less/vim-style file viewer navigation** - Complete overhaul with j/k (line), d/u (half-page), f/b (full-page), g/G (top/bottom), h/l (horizontal), / (search), n/N (next/prev match), ? (help), visual mode selection
- **Search bar with match counter** - Floating search UI in file viewer with match highlighting and navigation
- **Keybindings help overlay** - Press ? in file viewer to see all available keyboard shortcuts
- **Scroll position indicator** - Shows current line/position/percentage in file viewer
- **bunx quick-start** - README now documents `bunx tide-commander` as the recommended way to run

### Changed
- **Agent bar redesign** - Overhauled layout and styling for agent bar items
- **File explorer tree** - Improved tree node interaction and styling
- **Layout styles** - Refined layout and spacing across components
- **Right panel styles** - Updated base styles for right panel

### Fixed
- **Lint warnings** - Fixed 10 unused variable warnings across AgentBar, FileViewer, and useLessNavigation

## [0.59.3] - 2026-02-11

### Added
- **Provider dots on agent labels** - 3D and 2D agent name labels now show a colored provider dot (orange for Claude, blue for Codex)
- **Agent bar horizontal scroll** - Agent bar now supports smooth horizontal scrolling via mouse wheel with transform-based approach

### Changed
- **3D name label rendering** - Reduced canvas width (8192 to 4096), adjusted scale and positioning for crisper labels
- **3D indicator scale** - Store base scale and aspect ratio in userData for dynamic scaling support
- **Agent bar layout** - Improved scroll-to-selected behavior using transform offset instead of scrollIntoView
- **Agent bar styles** - Refined layout and spacing for agent items

## [0.59.2] - 2026-02-11

### Added
- **Provider icons** - Claude and Codex agents now display their respective icons (claude.ico / codex.ico) throughout the UI
  - Terminal header next to agent name
  - Live output role labels
  - Conversation history role labels
  - Spawn modal provider selector buttons
  - Agent info modal runtime section
- **Image reference thumbnails** - Image file references in tool output now show inline thumbnail previews instead of generic icons

### Changed
- **Terminal header layout** - Improved flex layout with proper text truncation for title, supervisor badge, and last-input sections
- **Output role labels** - Changed to inline-flex for icon support

## [0.59.1] - 2026-02-11

### Added
- **File path paste to attach** - Paste a file path (e.g. `/home/user/doc.pdf`) in the terminal input to auto-attach the file
- **File-by-path API** - `POST /api/files/by-path` endpoint to retrieve files by absolute path for attachment
- **File type icons in attachments** - Attached files show VSCode-style file type icons based on extension
- **File type icons in tool output** - File references in tool output (Read, Write, Edit) show file type icons

### Changed
- **Terminal input attachments** - Enhanced attachment chip styling with file icons, image thumbnails, and better layout
- **Content rendering** - Improved rendering of file references in tool output with clickable icons
- **Tool output styling** - Refined tool output section styling for better readability

### Fixed
- **Lint warnings** - Fixed unused `filename` and `isImage` variables in files.ts

## [0.59.0] - 2026-02-11

### Added
- **Git merge and conflict resolution** - Merge branches, detect conflicts, view conflict versions (ours/theirs/merged), resolve and continue/abort merges
- **Branch comparison** - Compare branches with commit diff and file change list
- **Git commit from UI** - Stage and commit changes directly from the file explorer
- **Git log messages** - View commit messages for files via git-log-message endpoint
- **Git show endpoint** - View file contents at specific commits via git-show endpoint
- **Conflict resolver component** - Side-by-side conflict resolution UI with section-based editing
- **Branch comparison component** - Visual branch diff viewer with commit list and changed files
- **Building git status** - Buildings can now show git status indicators via useBuildingGitStatus hook
- **Spotlight improvements** - Enhanced spotlight search UI with better styling and result display

### Changed
- **Git status conflict detection** - Now detects merge conflicts (UU, AA, DD, AU, UA, DU, UD codes)
- **File explorer git changes** - Enhanced with conflict file indicators, merge status, and action buttons
- **File explorer search** - Improved search result styling and layout
- **File explorer tree** - Better tree node rendering and interaction
- **Branch widget** - Enhanced with merge capabilities and comparison triggers
- **Database panel** - Minor UI improvements
- **Building labels** - Added label utility functions, improved building type handling
- **Area folder icons** - Refined positioning and sizing in 2D renderer
- **Spotlight styles** - Major style overhaul for better readability

### Fixed
- **Lint warnings** - Fixed unused variables in ConflictResolver and UnifiedSearchResults

## [0.58.0] - 2026-02-11

### Added
- **Git branch widget** - New branch switcher in file explorer with local/remote branch listing, checkout, and fetch
- **Git branch API endpoints** - `GET /api/files/git-branches`, `POST /api/files/git-checkout`, `POST /api/files/git-fetch` server routes
- **Multiple folder icons per area** - Areas with multiple directories show individual folder icons in a grid layout (3D and 2D)
- **More area colors** - 16 additional area colors (8 bright + 8 dark variants)

### Changed
- **File explorer refactor** - Extracted shared types, simplified panel structure, improved state restoration logic
- **File explorer styles** - Cleaned up and consolidated SCSS, added viewer-specific styles
- **Folder icon click** - Now passes folder path to open the correct directory in explorer
- **2D area folder icons** - Grid layout with per-directory icons, matching 3D behavior

## [0.57.2] - 2026-02-11

### Added
- **Area double-click** - Double-clicking an area opens the toolbox/settings panel in both 3D and 2D scenes

### Changed
- **Agent wave ripple effects** - Subtler ripples using lighter blending mode, reduced radius and opacity to avoid displacing other elements
- **Building emoji/label scaling** - Emoji and label sizes now scale relative to building size instead of using fixed ranges

## [0.57.1] - 2026-02-11

### Added
- **Edge resize handles** - Rectangle areas now have N/S/E/W edge handles for single-axis resizing in both 3D and 2D scenes

### Changed
- **Asymmetric area resize** - Corner and edge handles now anchor the opposite side instead of resizing symmetrically from center
- **Resize cursors** - Edge handles show directional cursors (ns-resize, ew-resize) matching their axis

## [0.57.0] - 2026-02-11

### Added
- **Folder icons on areas** - Areas with directories now display a clickable folder icon in both 3D and 2D scenes
- **File explorer area integration** - Clicking a folder icon opens the file explorer directly for that area's directories
- **Folder path hints** - File explorer folder selector now shows the full path as a hint below the folder name
- **Cross-area folder navigation** - Folder dropdown in file explorer shows full paths and correctly navigates between areas

### Fixed
- **Lint warning** - Prefixed unused `zoom` variable in `Scene2D.getAreaFolderIconAtScreenPos`

## [0.56.1] - 2026-02-10

### Added
- **Create building skill** - New builtin skill for creating PM2-managed buildings with real examples and learned lessons
- **Wind Back and Wind Front buildings** - New building types with PM2 configuration

### Changed
- **Bitbucket PR skill** - Expanded documentation with variable reference table, PR ID extraction, agent variable management guide
- **Create building skill** - Updated with learned lessons from real usage

## [0.56.0] - 2026-02-10

### Added
- **Deep linking** - Open agent terminals via URL query params (`?agentId=X` or `?agentName=Y&openTerminal=1`)
- **Focus agent API** - New `POST /api/focus-agent` endpoint to focus an agent and open its terminal via WebSocket broadcast
- **Areas API** - New `GET /api/areas` endpoint to list drawing areas
- **KRunner integration** - KDE Plasma KRunner plugin for searching and focusing agents from desktop
- **Building status colors** - Added status colors for building states (running, stopped, starting, stopping, unknown) in 2D renderer
- **Agent class emoji** - Terminal header now shows agent class emoji/icon next to agent name

### Changed
- **Bitbucket PR skill** - Migrated from basic auth (`-u user:pass`) to Bearer token auth (`-H "Authorization: Bearer ..."`), reduced from 2 secrets to 1 (`BITBUCKET_TOKEN`), added variable management guide and PR ID extraction
- **Terminal click-outside handling** - Refactored to `isWithinGuakeSurface()` helper; portal-rendered modals no longer close the terminal when clicked
- **Modal stack registration** - Bash modal, response modal, context confirm, and agent info now register on the modal stack so Escape closes them before the terminal
- **Context confirm modal** - Added dedicated CSS class names for styling
- **Building default status** - Unknown building status now falls back to `stopped` instead of `idle`

## [0.55.0] - 2026-02-09

### Added
- **ModalPortal component** - Shared portal component for rendering modals outside the DOM hierarchy
- **WorkingIndicator component** - Shared animated working/loading indicator
- **Agent filtering and sorting** - Commander view supports filtering by status, activity window, and sorting by activity/name/created/context
- **Dashboard zone grouping** - Dashboard view groups agents by zone with improved layout
- **Terminal input enhancements** - Additional keyboard shortcut support
- **Session loader tests** - New test coverage for session loading edge cases

### Changed
- **Commander view overhaul** - Major refactoring of agent panel layout and interaction (143+ lines added)
- **Dashboard view expansion** - Significant expansion with zone-based grouping and agent management (244+ lines added)
- **Terminal modals refactor** - Reorganized modal components for cleaner architecture
- **Agent response modal** - Updated to use portal-based rendering
- **Context view modal** - Updated to use portal-based rendering
- **File viewer modal** - Updated to use portal-based rendering
- **Commander grid styles** - Reworked grid layout for better responsiveness
- **Commander header styles** - Enhanced header styling with new filter controls
- **Session loader** - Improved robustness of history message parsing
- **Storage utility** - Added new storage key

### Fixed
- **Lint warnings** - Fixed unused variable warnings in sceneLifecycle, AgentStatusCards, and DashboardView

## [0.54.1] - 2026-02-08

### Changed
- **README Documentation** - Fixed image URLs for better portability
  - Use raw GitHub URLs for preview images
  - Better image loading on various markdown renderers
  - Improved documentation display

- **Development Configuration** - Better default port handling
  - Set default PORT to 6200 in vite.config.ts
  - Add convenient `dev:5174` script for legacy port preference
  - Explicit PORT=5174 in dev script

- **WebSocket Connection** - Improved LAN device access
  - Detect browser hostname for WebSocket connection in dev mode
  - Prefer browser hostname for LAN device access
  - Keep loopback fallback for localhost browsing
  - Better multi-device development experience

### Fixed
- **Image Loading** - Absolute URLs for GitHub rendering
- **Dev Port Configuration** - Explicit default port handling

## [0.54.0] - 2026-02-08

### Added
- **npm publish workflow** - GitHub Actions workflow to publish to npm on release or manual trigger
- **Server metadata persistence** - CLI now writes `server-meta.json` alongside PID file to track host/port across commands
- **Startup verification** - Background start waits briefly to detect immediate crashes before reporting success
- **Graceful restart** - `tide-commander start --port X` auto-stops the existing server before starting with new options
- **Force shutdown timeout** - Server force-exits after 4.5s if graceful shutdown stalls
- **EADDRINUSE handling** - Server exits immediately with clear error when port is already in use
- **Colorized log viewer** - `tide-commander logs` now colorizes log levels, timestamps, and component tags
- **Server entry resolution** - CLI can launch from both compiled `.js` and development `.ts` entry points

### Changed
- **Production client networking** - API base URL and WebSocket connection now use same-origin in production builds instead of hardcoded localhost, enabling deployment on any host/port
- **Dev-only localhost fallback** - `localhost:6200` fallback is now only used in development mode (`import.meta.env.DEV`)
- **Robust version detection** - `getPackageVersion()` now walks up directory tree to find `package.json` instead of using relative path offsets
- **Status uses saved metadata** - `tide-commander status` reads host/port from saved server metadata instead of env vars
- **Server shutdown** - WebSocket clients are terminated and sockets destroyed during graceful shutdown
- **Socket tracking** - Server tracks active connections for clean shutdown

## [0.53.4] - 2026-02-08

### Changed
- **Default port** - Changed default server port from 5174 to 6200 across all files (server, client, CLI, docs, env example)

## [0.53.3] - 2026-02-08

### Added
- **Version command** - `tide-commander version` and `-v`/`--version` flags to display current version
- **Process uptime** - `tide-commander status` now shows server uptime on Linux via `/proc` stats
- **Version in banners** - Start and status banners now display the package version

### Changed
- **Colorized CLI output** - Status, start, and already-running banners now use ANSI colors for better readability
- **Richer status display** - Status command shows server URL, version, and uptime in a formatted panel
- **Already-running message** - Now includes the server URL for quick access

## [0.53.2] - 2026-02-08

### Fixed
- **Capacitor imports** - Wrapped Capacitor imports (core, haptics, local-notifications) in try-catch for conditional loading so web/CLI builds work without Capacitor packages installed
- **Null-safe platform checks** - `Capacitor.getPlatform()`, `isNativePlatform()`, and haptics calls now use optional chaining to prevent crashes when Capacitor is unavailable

## [0.53.1] - 2026-02-08

### Changed
- **CLI startup banner** - Background mode now shows a formatted banner with server URL and log file path

## [0.53.0] - 2026-02-08

### Added
- **CLI subcommands** - `tide-commander start|stop|status|logs` for full server lifecycle management
- **Background mode** - Server runs in background by default with PID file tracking (`~/.local/share/tide-commander/server.pid`)
- **Foreground mode** - `--foreground` flag to run server in the foreground
- **Log viewing** - `tide-commander logs` with `--lines` and `--follow` flags
- **Duplicate instance detection** - Prevents starting a second server when one is already running

### Changed
- **README restructured** - Getting started section now leads with global install and CLI usage; development setup moved to separate section
- **Codex integration** - Removed "Experimental" label from Codex integration in roadmap

## [0.52.0] - 2026-02-08

### Added
- **Global npm install** - Tide Commander can now be installed globally via `npm i -g tide-commander` with a CLI entry point supporting `--port`, `--host`, and `--listen-all` flags
- **CLI entry point** - New `src/packages/server/cli.ts` with argument parsing and server spawning
- **Server build pipeline** - Added `build:server` script using dedicated `tsconfig.server.json` for producing publishable dist output
- **Exec curl generation endpoint** - New `POST /api/exec/generate-curl` route for generating properly escaped curl commands for Codex agents
- **HOST env variable** - Backend now supports `HOST` environment variable to set bind address

### Changed
- **Exec command display** - Curl `/api/exec` commands now show the actual inner command being executed instead of the full curl wrapper, both in live output and history
- **History exec output parsing** - Improved robustness of exec task output extraction from stored history payloads with wrapper-aware JSON parsing
- **Session loader** - Tool results now prefer raw `stdout`/`stderr` from `tool_use_result` over potentially summarized `block.content` for richer history
- **ESM import paths** - Added `.js` extensions to all shared module imports for proper ESM compatibility in compiled output
- **Build script** - Changed from `tsc && vite build` to `npm run build:types && vite build && npm run build:server`
- **Exec route logging** - Added detailed request and error logging for exec endpoint

### Fixed
- **Exec route error responses** - Error responses now include structured details (code, syscall) for better debugging

## [0.51.5] - 2026-02-08

### Changed
- **Streaming exec skill** - Clarified when to use streaming exec vs direct shell commands; no longer mandates routing every command through `/api/exec`

### Fixed
- **Lint warning** - Removed unused `now` variable in OutputLine.tsx

## [0.51.4] - 2026-02-08

### Changed
- **Exec task output collapsible** - Long exec outputs now show only the last 3 lines by default with a toggle to expand/collapse full output
- **Better exec task matching** - Exec tasks are now matched to their triggering bash command by timestamp proximity (within 2s) instead of recency, preventing mismatched output
- **Styles for toggle UI** - Added toggle arrow, hover state, and ellipsis indicator for collapsed exec output

### Fixed
- **Lint warning** - Prefixed unused `truncatedTaskCommand` variable in OutputLine.tsx

## [0.51.3] - 2026-02-08

### Changed
- **History Line Rendering** - Major refactoring for better output display (135+ lines)
  - Improved component organization
  - Better formatting of output content
  - Enhanced visual consistency
  - Cleaner code structure

- **Output Line Component** - Better formatting and display
  - Improved component logic
  - Better text handling
  - Enhanced styling consistency

- **Exec Task Output** - Better streaming and display
  - Improved streaming exec task handling
  - Better output formatting in builtin skills
  - Enhanced display consistency

## [0.51.2] - 2026-02-08

### Fixed
- **Detached process cleanup** - Only kill detached provider processes when the agent is actually in detached state, preventing accidental process termination for non-detached agents

### Added
- Test for non-detached agent stop behavior to verify processes are not killed

## [0.51.1] - 2026-02-08

### Changed
- **Inline exec task display** - Running exec tasks now show inline on the Bash tool output line instead of a separate container, with a styled cyan badge showing the command
- **Removed ExecTasksContainer** - Replaced the standalone exec tasks section with the new inline display

### Fixed
- **package-lock.json** - Updated version to match package.json (was stuck at 0.50.0)

## [0.51.0] - 2026-02-08

### Changed
- **Consolidated system prompt injection** - Merged Tide Commander rules, custom agent prompt, and runtime system prompt into a single `--append-system-prompt-file` instead of three separate files
- **Class instructions ordering** - Moved class instructions after skills in prompt so they are less likely to get buried by long skill docs
- **Agent class hot restart** - Changing an agent's class now triggers a hot restart (same as model/provider changes), preserving session context

### Fixed
- **Keyboard shortcut tests** - Replaced `new KeyboardEvent()` with mock objects for Node.js test compatibility
- **Snapshot hook tests** - Skipped tests that require React rendering context (useState), added export validation tests instead
- **Codex backend tests** - Updated assertions to match new prompt wrapping format

### Added
- New test files: `outputs.test.ts`, `backend.test.ts`, `command-handler.test.ts`

## [0.50.0] - 2026-02-07

### Added
- **WebSocket Handler Decomposition** - Better handler organization
  - New `notification-handler.ts` for notification events
  - New `permission-handler.ts` for permission handling
  - New `supervisor-handler.ts` for supervisor events
  - New `sync-handler.ts` for state synchronization

- **WebSocket Listener System** - Centralized event listening
  - New `listeners/index.ts` for listener registration
  - New `listeners/boss-listeners.ts` for boss events
  - New `listeners/permission-listeners.ts` for permission events
  - New `listeners/runtime-listeners.ts` for runtime events
  - New `listeners/skill-listeners.ts` for skill events
  - New `listeners/supervisor-listeners.ts` for supervisor events

- **Runner Module Decomposition** - Better process management
  - New `runner/internal-events.ts` for internal event handling
  - New `runner/process-lifecycle.ts` for process lifecycle management
  - New `runner/recovery-store.ts` for recovery state management
  - New `runner/resource-monitor.ts` for resource monitoring
  - New `runner/restart-policy.ts` for restart policies
  - New `runner/stdout-pipeline.ts` for stdout processing
  - New `runner/watchdog.ts` for process watchdog monitoring

- **Test Coverage** - Comprehensive test suites
  - Internal events tests
  - Restart policy tests
  - Stdout pipeline tests
  - Watchdog tests

- **Dashboard Improvements** - Better status visualization
  - Enhanced agent debug panel (264+ lines)
  - Improved agent status cards
  - Better building status overview
  - New dashboard utils module

- **Agent Routes** - New API endpoints
  - Agent management REST API routes
  - Better agent lifecycle management

### Changed
- **WebSocket Handler Architecture** - Simplified main handler
  - Reduced from 926 to ~500 lines with better delegation
  - Handlers now focus on specific domains
  - Better separation of concerns

- **Runner Architecture** - Simplified main runner
  - Reduced from 1,120 to ~500 lines with better delegation
  - Process lifecycle now modular
  - Better recovery and restart handling
  - Improved watchdog monitoring

- **Client-Side Styling** - Dashboard improvements
  - 881+ lines of styling refactoring
  - Better responsive design
  - Improved visual consistency
  - Enhanced debug panel styling

### Removed
- **Code Cleanup** - Reduced maintenance burden
  - Removed ~2,778 lines of monolithic code
  - Eliminated complex handler dependencies
  - Cleaned up process management code

## [0.49.2] - 2026-02-07

### Changed
- **Agent Info Modal** - Enhanced prompt display
  - Display combined class and agent prompts side-by-side
  - Show full prompt text in formatted blocks
  - Better visual organization of prompt sections
  - Improved readability with proper formatting

- **Appended Instructions** - Clarified path requirements
  - Emphasize full project-relative paths (never abbreviated)
  - Better documentation of path conventions
  - Clearer guidance on file reference formatting
  - More explicit about avoiding absolute paths

- **Styling** - Agent info modal improvements
  - Enhanced prompt display styling
  - Better visual hierarchy for prompt blocks
  - Improved spacing and organization
  - Better readability for long prompts

### Fixed
- **Prompt Display** - Better modal formatting
  - Proper handling of combined prompts
  - Better text wrapping and display
  - Improved visual consistency

## [0.49.1] - 2026-02-07

### Added
- **Runtime Service Decomposition** - Better service organization
  - New `runtime-command-execution.ts` for command handling
  - New `runtime-events.ts` for event management
  - New `runtime-status-sync.ts` for status synchronization
  - New `runtime-subagents.ts` for subagent orchestration
  - New `runtime-watchdog.ts` for process monitoring
  - New `prompts/tide-commander.ts` for prompt templates

- **Client-Side Improvements** - Better UI and utilities
  - New `filePaths.test.ts` with comprehensive path utility tests
  - Enhanced file viewer modal with improved styling
  - Better output line rendering
  - Improved PiP agent view

- **Styling Enhancements** - Better visual presentation
  - Enhanced file viewer styling
  - Better terminal history display
  - Improved terminal output formatting

### Changed
- **Runtime Service** - Simplified and delegated
  - Reduced from 1,138 to 12k lines with better delegation
  - Commands now handled by runtime-command-execution
  - Events now managed by runtime-events
  - Status sync handled by runtime-status-sync
  - Subagent orchestration via runtime-subagents
  - Process watchdog monitoring via runtime-watchdog

- **Component Updates** - Better functionality
  - Improved output panel components
  - Better agent panel rendering
  - Enhanced file viewer modal
  - Better history line display

### Fixed
- **Process Management** - Better reliability
  - Improved status synchronization
  - Better subagent tracking
  - Enhanced watchdog monitoring
  - More robust command execution

## [0.49.0] - 2026-02-07

### Changed
- **Major Code Refactoring** - Improved maintainability and code organization
  - Modularized BuildingConfigModal into focused sub-components
  - Split CharacterFactory into specialized modules (AnimationConfigurator, ModelLoader, VisualConfig)
  - Refactored Scene2D renderer into separate renderer modules
  - Reorganized WebSocket layer into logical modules (callbacks, connection, handlers, send, state)
  - Better separation of concerns across all packages

- **Type System Cleanup** - Organized shared types
  - Split monolithic types.ts into focused type modules
  - Created agent-types, building-types, common-types, database-types, websocket-messages
  - Better type organization for maintainability

- **Component Architecture** - Improved structure
  - BuildingConfigPanel sub-components (Boss, Database, Docker, PM2, Logs, Commands)
  - Character system modularization with test coverage
  - Scene renderer specialization

### Added
- **Test Coverage** - Comprehensive test suites
  - AnimationConfigurator tests
  - CharacterFactory tests
  - ModelLoader tests
  - VisualConfig tests
  - Better test infrastructure for components

### Removed
- **Code Cleanup** - Reduced maintenance burden
  - Removed ~9,000 lines of legacy code
  - Eliminated monolithic file dependencies
  - Cleaned up unused code patterns

## [0.48.1] - 2026-02-07

### Changed
- **Documentation** - Improved runtime provider information
  - Clarify Claude and Codex CLI integration details
  - Better explanation of session persistence for both providers
  - Updated backend process manager documentation
  - Correct custom agent classes filename reference

### Fixed
- **Documentation Accuracy** - Better runtime support clarity
  - Specify how Claude vs Codex handle CLI invocation
  - Clarify session resumption mechanisms

## [0.48.0] - 2026-02-07

### Added
- **Architecture Documentation** - Comprehensive runtime architecture guide
  - New `docs/architecture.md` with Mermaid diagrams
  - System architecture diagram image
  - Runtime flow and command lifecycle documentation
  - Detailed explanation of agent orchestration

- **Output Rendering Utilities** - Enhanced text formatting
  - New `filePaths.ts` utility for path manipulation
  - Comprehensive output rendering test suite
  - Better markdown component rendering

- **UI Components** - Improved agent panel and file viewer
  - Enhanced CommanderView AgentPanel with better styling
  - Improved FileViewerModal with better file handling
  - Better visual styling for file viewer components

### Changed
- **Documentation** - Simplified README
  - Moved detailed architecture to dedicated docs
  - Better organization of technical documentation
  - Added link to architecture guide

- **Component Refactoring** - Better code organization
  - Improved MarkdownComponents with enhanced rendering
  - Refactored OutputLine component for clarity
  - Better BossContext and HistoryLine organization
  - Enhanced contentRendering module

- **Styling** - Responsive improvements
  - Better file viewer styling
  - Improved responsive design for mobile
  - Enhanced visual consistency

### Fixed
- **Output Rendering** - Better text formatting
  - Improved markdown and code block rendering
  - Better handling of special characters
  - More robust output parsing and display

## [0.47.4] - 2026-02-07

### Added
- **Contributing Guide** - New contributor documentation
  - Setup and workflow guidelines for developers
  - Pull request guidelines and best practices

- **CI Workflow** - Quality assurance automation
  - GitHub Actions workflow for testing
  - Automated quality checks and test exclusions

- **Testing Infrastructure** - Enhanced test suite
  - New tool formatting tests
  - CI-specific test exclusions

### Changed
- **History Loading** - Improved type safety and UUID handling
  - Better type annotations for history messages
  - Enhanced UUID filtering with stricter validation
  - Improved message array handling

### Fixed
- **Scene Setup** - Code cleanup and optimization
  - Removed unused variable
  - Better code maintainability

## [0.47.3] - 2026-02-07

### Added
- **Agent Info Modal** - New modal for displaying detailed agent information
  - New agent info modal styling and layout
  - Better agent information presentation

### Changed
- **Terminal Header** - Enhanced terminal header component
  - Improved header layout and styling
  - Better UI organization

- **Terminal Input Area** - Enhanced input component
  - Better input field handling
  - Improved user interaction

- **Terminal Modals** - UI improvements
  - Better modal dialog handling
  - Improved terminal modal management

- **Terminal Display** - Better visual presentation
  - Improved terminal styling and layout
  - Better organization of terminal elements

- **Agent Service** - Service improvements
  - Better agent lifecycle management
  - Improved agent handling

- **Runtime Service** - Better runtime management
  - Enhanced runtime service tests
  - Improved runtime type definitions

- **Session Loader** - Better session handling
  - Improved session loading
  - Better session management

### Fixed
- **Terminal UI** - Various UI refinements
  - Better terminal component organization
  - Improved visual consistency

## [0.47.2] - 2026-02-07

### Added
- **Output Rendering Tests** - Comprehensive test coverage for output formatting
  - Test suite for outputRendering utilities
  - Better validation of output formatting logic

### Changed
- **Output Formatting** - Enhanced terminal output rendering
  - Improved HistoryLine component rendering
  - Better OutputLine component with enhanced formatting
  - Improved visual presentation in terminal

- **Terminal Styling** - Better terminal display
  - Enhanced history styling with better readability
  - Improved output styling for clarity
  - Better tool output display with proper formatting

- **Runner Output** - Better streaming output handling
  - Improved output event processing
  - Better handling of streamed content

### Fixed
- **Output Display** - Fixes to terminal output rendering
  - Better formatting of history lines
  - Improved output line rendering
  - Fixed tool output display issues

## [0.47.1] - 2026-02-07

### Added
- **Boss Context System** - Enhanced context management for multi-agent coordination
  - New BossContext component for coordinating agent activities
  - Better context tracking and session management

- **Improved History Loading** - Enhanced conversation history retrieval
  - Better history loader with agent history tracking
  - Improved filtering and output management
  - Support for multi-agent conversations

### Changed
- **Output Rendering** - Enhanced output line component
  - Better formatting for different message types
  - Improved visual presentation and readability
  - Better handling of streamed content

- **Modal Components** - UI refinements
  - Improved FileViewerModal with better file handling
  - Enhanced modal styling and spacing
  - Better responsive design

- **Terminal Styling** - Enhanced visual display
  - Better history line rendering
  - Improved output formatting
  - Enhanced visual separation between messages

### Fixed
- **History Loading** - Better agent history retrieval
  - Improved conversation history loading from sessions
  - Better output deduplication
  - Enhanced error handling

## [0.47.0] - 2026-02-07

### Added
- **Codex Runtime Support** - Multi-runtime architecture for agent execution
  - New Codex runtime provider alongside Claude
  - JSON event parser for Codex protocol support
  - Runtime abstraction layer enabling pluggable backends
  - Comprehensive test suite for Codex integration

- **Runtime Service Refactor** - Modularized agent execution layer
  - New RuntimeService for unified runtime management
  - Improved separation of concerns in agent execution
  - Better support for multiple runtime backends

### Changed
- **UI Components** - Enhanced modal dialogs and forms
  - Improved AgentEditModal with better layout
  - Enhanced BossSpawnModal with better UX
  - Improved SpawnModal with additional options
  - Better modal styling and responsive design

- **Agent Management** - Updated store and service layer
  - Improved agent lifecycle management
  - Better delegation tracking
  - Enhanced output handling with UUID deduplication

### Fixed
- **Tool Output Rendering** - Proper formatting in streamed output
  - Fixed file links in tool use blocks
  - Better tool output display

## [0.46.1] - 2026-02-06

### Fixed
- **Output Rendering** - Improved OutputLine component rendering
  - Better formatting and display
  - Enhanced visual presentation
  - Improved component performance

- **Terminal Styling** - Enhanced terminal output display
  - Better styling for terminal output
  - Improved color and contrast
  - Enhanced visual separation

- **Runner Output** - Better output handling
  - Improved output event processing
  - Better error handling
  - Enhanced logging

### Changed
- **Package Dependencies** - Updated for stability
  - Updated package-lock.json
  - Better dependency management

## [0.46.0] - 2026-02-06

### Added
- **Enhanced Agent Debugging** - Improved debugging panel and utilities
  - Better AgentDebugPanel with enhanced debugging information
  - Improved agentDebugger service with better logging
  - Enhanced debugging type definitions

### Changed
- **Output Rendering** - Improved OutputLine component
  - Enhanced formatting and visual presentation
  - Better output styling and organization
  - Improved content rendering utilities

- **WebSocket Communication** - Better message handling
  - Improved WebSocket handler with enhanced message processing
  - Better message routing and coordination
  - Enhanced error handling and recovery

- **Type System** - Updated type definitions
  - Better type definitions for debugging
  - Improved type safety across packages
  - Enhanced type definitions for shared types

### Technical
- Enhanced AgentDebugPanel component
- Improved OutputLine with better formatting
- Better agentDebugger service
- Enhanced output rendering utilities
- Improved WebSocket handlers
- Better type definitions across all packages

## [0.45.0] - 2026-02-06

### Added
- **Automatic Session Reattachment** - Agents automatically reconnect to previous sessions
  - ReattachAgentMessage type definition for agent reconnection
  - Visual feedback for automatic reattachment process
  - Seamless reconnection on session loss

### Changed
- **Performance Optimization** - System messages now non-blocking
  - Improved reattachment speed and responsiveness
  - Better performance during agent initialization
  - Reduced blocking operations

- **Message Deduplication** - UUID-based deduplication system
  - Pass UUID for all output events in runner
  - UUID propagated through WebSocket output messages
  - Complete client-side deduplication support

### Fixed
- **Session Persistence** - Better handling of agent reconnection
  - Improved reconnection logic
  - Better error recovery
  - More reliable session management

### Technical
- Added ReattachAgentMessage type definition
- Improved runner output event handling with UUID
- Enhanced WebSocket message propagation
- Better system message handling for non-blocking operations

## [0.44.1] - 2026-02-05

### Changed
- **Keyboard Shortcuts** - Enhanced useKeyboardShortcuts hook
  - Better keyboard event handling
  - Improved shortcut detection
  - Better integration with App component

- **Layout Optimization** - Improved responsive design
  - Better layout styling for different screen sizes
  - Optimized spacing and positioning
  - Enhanced visual presentation

- **Store Management** - Better shortcuts configuration
  - Improved store shortcuts structure
  - Better organization of keyboard mappings
  - Enhanced configuration management

- **Documentation** - Updated and improved
  - Enhanced views documentation
  - Updated README with latest information
  - Better documentation organization

### Technical
- Enhanced keyboard event handling in hooks
- Better layout styling with improved responsiveness
- Improved store shortcuts configuration
- Better component keyboard integration

## [0.44.0] - 2026-02-05

### Added
- **Comprehensive Documentation** - Complete guides for all major features
  - Android development guide
  - Buildings and structures documentation
  - Custom agent classes guide
  - Docker setup and usage documentation
  - Secrets management guide
  - Skills system documentation
  - Snapshot feature documentation
  - Views and view modes documentation

### Changed
- **Documentation Organization** - Improved docs structure
  - Consolidated documentation in docs folder
  - Updated README with documentation references
  - Better organized guides and tutorials

## [0.43.2] - 2026-02-05

### Removed
- **Skills Directory** - Skills functionality consolidated into TypeScript files
  - Removed separate skills directory
  - All skills now defined as TypeScript implementations
  - Cleaner codebase organization
  - Better code colocation

### Changed
- **Codebase Structure** - Improved organization
  - Skills moved into TypeScript files
  - Better code organization and maintainability
  - Simplified skill management

## [0.43.1] - 2026-02-05

### Changed
- **Repository Cleanup** - Improved repository organization
  - Removed stale APK files from release directory
  - Cleaned up old release notes and changelogs
  - Release artifacts now managed separately
  - Better release folder organization

### Removed
- Old APK artifacts (v0.24.1, v0.25.0, v0.26.0, v0.27.0)
- Stale release documentation files
- Obsolete release notes and changelogs

## [0.43.0] - 2026-02-05

### Added
- **Enhanced Keyboard Shortcuts** - Improved keyboard event handling throughout the application
  - Better event delegation and propagation
  - More responsive keyboard input detection
  - Additional shortcut configurations

### Changed
- **Message Navigation** - Improved useMessageNavigation hook
  - Better message traversal logic
  - Enhanced navigation state management
  - Improved performance

- **Swipe Navigation** - Enhanced useSwipeNavigation hook
  - Better gesture handling
  - Improved swipe detection
  - Better event coordination

- **Controls Modal** - Improved keyboard integration
  - Better shortcut handling in modal context
  - Improved focus management
  - Enhanced keyboard event processing

- **File Explorer** - Better keyboard navigation
  - Improved file tree navigation
  - Better keyboard shortcuts integration
  - Enhanced accessibility

- **Key Capture Input** - Enhanced input component
  - Better event handling
  - Improved key detection
  - Enhanced user feedback

- **Input Handler** - Better input processing
  - Improved event delegation
  - Better throttling and debouncing
  - Enhanced input coordination

- **Scene2D Input** - Improved keyboard support
  - Better keyboard event handling
  - Enhanced input coordination with UI
  - Improved scene interaction

- **Shortcuts Modal** - Enhanced styling
  - Better visual presentation
  - Improved readability
  - Better component organization

### Technical
- Enhanced useKeyboardShortcuts hook with better event handling
- Improved store shortcuts configuration
- Better event delegation patterns across components
- Enhanced keyboard event processing pipeline

## [0.42.1] - 2026-02-05

### Fixed
- **Output Rendering** - Improved formatting and display
  - Enhanced OutputLine component for better content formatting
  - Better handling of tool outputs
  - Improved visual separation and styling

- **History Display** - Better historical message rendering
  - Improved HistoryLine component content handling
  - Enhanced formatting for historical conversations
  - Better readability

- **Content Rendering** - Enhanced content utilities
  - Improved content rendering pipeline
  - Better formatting options
  - Enhanced component integration

- **Server Diagnostics** - Better logging and error handling
  - Improved runner logging
  - Enhanced error context in service
  - Better type definitions for CLI operations

- **Effects Animation** - Better animation handling
  - Improved effects manager functionality
  - Better visual feedback

### Changed
- **Terminal Styling** - Enhanced output panel styling
  - Better visual presentation of outputs
  - Improved spacing and formatting
  - Enhanced color and contrast

### Removed
- Cleanup of diagnostic and debugging documentation files
  - Removed performance profiling guides (moved to inline documentation)
  - Removed phase 4 test reports
  - Removed snapshot debugging guides
  - Removed task completion summaries

## [0.42.0] - 2026-02-05

### Added
- **Agent Overview Panel** - New component for displaying agent information and status
  - Agent details display
  - Status indicators
  - Integrated into terminal header

- **Subagent Store** - New store module for managing agent delegation hierarchy
  - Delegation relationship management
  - Subordinate agent tracking
  - Agent hierarchy utilities

### Changed
- **OutputLine Component** - Enhanced formatting and styling
  - Better output display
  - Improved tool output rendering
  - Enhanced visual separation

- **HistoryLine Component** - Improved history display
  - Better formatting for historical messages
  - Enhanced readability
  - Improved styling

- **TerminalHeader** - Integrated agent overview
  - Agent information display
  - Better status visualization
  - Enhanced button layout

- **Dashboard Components** - Improved rendering and data handling
  - Better AgentStatusCards display
  - Enhanced BuildingStatusOverview
  - Improved type definitions and utilities

- **SidebarTreeView** - Enhanced tree rendering
  - Better node rendering
  - Improved tree utilities
  - Enhanced example usage

- **Database Panel** - UI improvements
  - Better layout and styling
  - Improved component organization

- **Scene Management** - Better error handling and logging
  - Enhanced SceneManager
  - Improved AgentManager
  - Better character factory support

- **Effects Manager** - New animation capabilities
  - Enhanced animation effects
  - Better visual feedback

- **WebSocket Handlers** - Improved agent management
  - Better event handling
  - Improved message processing

### Technical
- New AgentOverviewPanel component
- New subagents store module
- Enhanced type definitions and utilities
- Improved storage utilities and selectors
- Enhanced Claude backend logging
- Better error handling across components

## [0.41.0] - 2026-02-04

### Added
- **Dashboard View Component** - New comprehensive dashboard with agent status and metrics
  - Agent status cards with real-time information
  - Building status overview with progress tracking
  - Events timeline for monitoring activities
  - Metrics display panel for performance analytics
  - Responsive design for desktop and mobile

- **View Mode Toggle** - Switch between different application views
  - Toggle between 3D scene, terminal, and dashboard modes
  - State persistence across sessions
  - Keyboard shortcuts for quick switching

- **Right Panel Component** - Configurable side panel with tab support
  - Resizable panel with drag-to-resize functionality
  - Tab-based content organization
  - Flexible content integration

- **Sidebar Tree View** - Hierarchical tree component for navigation
  - Expandable/collapsible tree nodes
  - Custom rendering support
  - Utility functions for tree operations

- **Performance Monitoring** - New profiling guide and test reports
  - Performance profiling guide for optimization
  - Phase 4 test plan and reports
  - Build status tracking documentation

### Changed
- **UI Architecture** - Refactored for multi-view support
  - App component enhanced with view mode switching
  - Modal system improved with new RestoreArchivedAreaModal
  - Enhanced keyboard shortcuts configuration and documentation

- **Mobile Optimizations** - Improved mobile experience
  - Better keyboard handling and overlay detection
  - Optimized layout for smaller screens
  - Improved touch interactions

- **File Explorer** - Enhanced with new features
  - Tree panel resize functionality
  - Unified search results display
  - Improved file utilities and types

- **Database Panel** - UI and UX improvements
  - New DatabaseTabs component for multi-database support
  - Enhanced query editor with better styling
  - Improved results table display

- **3D Scene** - Input and rendering enhancements
  - Better input handling for Scene2D
  - Improved drawing manager
  - Enhanced agent manager functionality

### Technical
- New hooks: useViewMode, useTreePanelResize, useRightPanelResize
- Updated keyboard shortcuts with new configuration options
- Improved store with view mode management
- Enhanced area management with new modal support
- Better TypeScript types for view modes and components

## [0.40.0] - 2026-02-03

### Added
- **Snapshot Feature Format Migration** - Support for seamless snapshot format versioning
  - Version tracking for snapshot data structures
  - Automatic migration between snapshot formats
  - Better compatibility across snapshot versions

### Changed
- **VirtualizedOutputList Component** - Enhanced with snapshot state management
  - Improved snapshot compatibility and data handling
  - Better state preservation during snapshot operations
  - Enhanced performance for large message lists
- **TerminalInputArea Component** - Snapshot feature integration
  - Improved compatibility with snapshot data
  - Better input handling during snapshot operations
- **Agent Switching** - Seamless context preservation
  - Agents can now switch while preserving snapshot context
  - Better state management during agent transitions
- **Store Types** - Updated snapshot handling types
  - New snapshot version tracking
  - Improved type definitions for snapshot operations

### Technical
- Added snapshot format versioning system
- Enhanced AgentBar integration with snapshot feature
- Improved store actions for snapshot migration
- Better type safety for snapshot operations

## [0.39.0] - 2026-01-29

### Added
- **Clear Subordinates Context Feature** - Boss agents can now clear context for all subordinates at once
  - New "Clear All Subordinates" button in terminal header (visible only for boss agents with subordinates)
  - Confirmation modal with subordinate count confirmation
  - Clear context action for all subordinate agents simultaneously

### Changed
- **TerminalHeader Component** - Enhanced to support subordinate management
  - Added visibility check for boss agents with subordinates
  - New button for clearing all subordinate context
- **TerminalModals Component** - Improved context confirmation handling
  - Added 'clear-subordinates' action type
  - Dynamic modal messaging based on action type
  - Displays subordinate count in confirmation dialog
- **ClaudeOutputPanel Component** - Removed debug logging
  - Cleaned up console.log statements for terminal visibility detection
  - Removed MutationObserver for terminal state sync

### Technical
- Added `clearAllSubordinatesContext()` method to store delegation actions
- Exposed `clearAllSubordinatesContext()` through Store interface
- Proper type definitions for 'clear-subordinates' action

## [0.38.0] - 2026-01-29

### Added
- **Enhanced Keyboard Shortcuts Hook** - Improved keyboard event handling
  - Better event delegation and propagation
  - More responsive keyboard input detection
  - Additional shortcut configurations in store

### Changed
- **ClaudeOutputPanel Refactoring** - Improved message rendering and UI
  - Better layout with optimized flex properties
  - Improved scroll behavior and message indexing
  - Enhanced component organization
- **InputHandler Optimization** - More responsive input handling
  - Better event delegation for keyboard and mouse events
  - Improved debouncing and throttling
  - More granular event control
- **Scene2DCamera Improvements** - Smoother camera controls
  - Better zoom behavior with clamped values
  - Improved pan responsiveness
  - Optimized camera update logic
- **Scene2DRenderer Enhancement** - Better rendering performance
  - Cleaner render pipeline
  - Improved performance for large scenes
  - Better entity positioning and updates

### Technical
- Enhanced useKeyboardShortcuts hook with better event handling
- Improved InputHandler event delegation patterns
- Optimized Scene2DCamera with smooth transitions
- Better Scene2DRenderer rendering pipeline
- Store shortcuts updates for additional keyboard support

## [0.37.0] - 2026-01-29

### Added
- **VirtualizedOutputList Component** - High-performance rendering for large message lists
  - Virtual scrolling for handling thousands of messages
  - Dynamic item sizing based on content
  - Optimized re-renders for large terminal histories
  - Better memory efficiency for long-running sessions
- **Improved Terminal Input Handling** - Enhanced UX for terminal interactions
  - Better placeholder text and disabled state handling
  - Improved form submission and validation
  - Better focus management and keyboard navigation

### Changed
- **Default Settings State** - Settings now default to collapsed when no localStorage history exists
  - Better initial UX for first-time users
  - Settings sections collapse automatically on first visit
  - Consistent state across fresh installations
- **ThemeSelector Styling** - Enhanced visual design and interaction
  - Better keyboard navigation support
  - Improved active/focused states
  - Refined dropdown positioning
- **ClaudeOutputPanel Refactoring** - Major optimization of output rendering
  - Integration with VirtualizedOutputList for large message lists
  - Improved performance with virtualization
  - Better memory management during long sessions
- **Logger System Improvements** - Better error handling and formatting
  - Enhanced log formatting with timestamps
  - Improved error message clarity
  - Better structured logging throughout codebase
- **Input Handling Enhancements** - More robust keyboard event handling
  - Better debouncing of input events
  - Improved modifier key detection
  - More responsive keyboard interactions
- **Scene2DInput Touch Support** - Enhanced mobile input handling
  - Better touch event processing
  - Improved gesture detection
  - More responsive touch interactions
- **SCSS Terminal Input Styling** - Cleaner, more maintainable styles
  - Simplified input field styling
  - Better responsive breakpoints
  - Improved visual hierarchy

### Technical
- New `VirtualizedOutputList.tsx` component with windowing support
- Enhanced AgentManager state management
- Improved InputHandler event delegation
- Refactored Scene2DInput keyboard handling
- Better logger formatting with optional timestamps
- WebSocket handler message routing improvements
- Package dependencies updated

## [0.36.0] - 2026-01-29

### Added
- **Keyboard Shortcuts System** - New keyboard event handling for agent navigation and terminal control
  - Alt+H / Alt+L keyboard shortcuts for agent navigation (previous/next agent)
  - Space bar to open terminal with smart context detection
  - Proper input field detection to prevent shortcuts from triggering in text inputs
  - Exception handling for Alt+H/L in collapsed terminal input
- **Enhanced Terminal Integration** - Keyboard-driven terminal activation
  - Auto-select last active agent when opening terminal with Space
  - Terminal open/close state management via keyboard
  - Backtick or Escape to close terminal (as before)

### Changed
- **Voice Assistant API Calls** - Switched from fetch to authFetch for authenticated requests
  - Voice assistant, STT (Speech-To-Text), and TTS (Text-To-Speech) hooks now use authFetch
  - Ensures proper authentication headers for API endpoints
  - Better security for voice-based operations
- **Scene2DInput Refactoring** - Extended keyboard event handling
  - Added keyboard event listener setup and cleanup
  - Proper document-level keydown event handling
  - Feature flag for double-click camera focus (disabled by default)

### Technical
- New `onKeyDown` event handler in Scene2DInput for keyboard events
- New `getOrderedAgents()` utility method for consistent agent ordering
- Replaced fetch calls with authFetch in useSTT, useTTS, and VoiceAssistant
- Feature flag: `ENABLE_DOUBLE_CLICK_CAMERA_FOCUS` for camera zoom/pan on double-click
- Proper event listener cleanup in Scene2DInput.destroy()

## [0.35.1] - 2026-01-29

### Changed
- **Sidebar Layout** - Improved fixed positioning system
  - Changed sidebar from relative to fixed positioning
  - Fixed z-index positioning for proper layering
  - Agent bar and bottom toolbar now extend to full width
  - Sidebar collapse animation now uses translateX instead of width change
  - Removed unnecessary width transition for better performance
- **App Layout** - Removed unnecessary resize event dispatch
  - Eliminated setTimeout on sidebar collapse that could cause layout jank

### Fixed
- **Sidebar Collapse Animation** - Improved visual smoothness
  - Changed from width-based to transform-based animation (GPU-accelerated)
  - Better performance and smoother visual transitions
  - Proper pointer-events handling during collapse
- **Layout Spacing** - Agent bar and toolbar now properly span full width when sidebar is collapsed

## [0.34.0] - 2026-01-29

### Added
- **Z-Index/Stacking Order Management** - Areas now support layering and z-order control
  - Z-index property for DrawingArea to control stacking order
  - Store actions for z-index management: `getNextZIndex()`, `bringAreaToFront()`, `sendAreaToBack()`, `setAreaZIndex()`
  - Z-order synchronization with server
  - Migration support for existing areas without z-index
- **Water Wave Ripple Effect** - Visual effect for working agents in 2D scene
  - Animated concentric wave rings expanding from agent position
  - Cyan to purple gradient color scheme
  - Fading opacity as waves expand
  - Multiple concurrent waves for continuous animation

### Changed
- **2D Scene Rendering** - Areas now sorted by z-index for proper layering
  - DrawingManager applies z-offset to prevent z-fighting in 3D rendering
  - Scene2D sorts areas by z-index before rendering
  - Z-offset calculations for all area components (fill, border, labels, handles)
- **DrawingArea Type** - Extended with z-index support
  - New `zIndex: number` field in DrawingArea interface
  - Automatic z-index assignment for new areas
- **Area Store** - Enhanced z-index management
  - Z-index migration for legacy areas
  - New z-index management methods
  - Server synchronization for z-order changes

### Technical
- Extended Scene2D and Scene2DRenderer with z-index sorting logic
- New z-index offset calculations in DrawingManager (0.001 per level)
- Water ripple wave effect implementation in Scene2DRenderer
- Area store z-index management methods and migrations

## [0.33.0] - 2026-01-29

### Added
- **CharacterFactory Major Refactoring** - Complete rewrite of character animation and visual system
  - Enhanced animation loading and management
  - Improved model caching and optimization
  - Better support for custom animations
  - Procedural animation fallbacks for static models
  - Extended character configuration options
- **UI Component Enhancements** - Comprehensive visual improvements
  - New `AboutSection` with improved styling and layout
  - New `ConfigSection` for expanded configuration options
  - Enhanced `AgentBar` with better styling and interactions
  - Improved popup components (AgentHoverPopup, action popups)
  - Better responsive design across components
- **Scene Initialization Improvements** - Enhanced hook system
  - Refactored `useSceneSetup` hook with improved initialization logic
  - Better scene lifecycle management
  - Enhanced synchronization mechanisms
  - Improved error handling and fallbacks
- **Visual Effects Expansion** - Extended EffectsManager capabilities
  - Additional visual effect types
  - Better effect layering and composition
  - Improved performance with effect pooling
- **Server Service Enhancements**
  - Extended authentication service capabilities
  - Improved skill service with better skill management
  - Enhanced command handler with better event routing

### Changed
- **Scene Architecture** - Major refactor of scene core and manager
  - Better state management and coordination
  - Improved agent manager with extended styling system
  - Enhanced selection manager with better visual feedback
  - Better scene lifecycle coordination
- **Agent Components** - Improved styling and interactions
  - BossBuildingActionPopup with better layout
  - BuildingActionPopup with improved styling
  - DatabaseBuildingActionPopup enhancements
  - FloatingActionButtons with better positioning
  - SkillEditorModal improvements
  - SpawnModal with better UX
  - ContextMenu refinements
- **Scene Synchronization** - Enhanced useSceneSync hook
  - Better synchronization logic
  - Improved state updates
  - Better error handling
- **Styling System** - SCSS improvements
  - AgentBar styling enhancements
  - AboutSection styling
  - ConfigSection styling
  - Better responsive breakpoints

### Technical
- Major CharacterFactory refactor (536+ lines added)
- Enhanced SceneSetup hook logic (133+ lines added)
- Extended EffectsManager with new capabilities (55+ lines)
- New ConfigSection component with styling
- Improved AboutSection with additional features
- Enhanced AgentBar styling (64+ lines)
- New toolbox styling sections (117+ lines)
- Extended store selectors and types
- Improved server authentication service (8+ lines)
- Enhanced skill-service with better management
- Better websocket command handler

### Fixed
- Improved scene initialization reliability
- Better error handling in character loading
- Enhanced animation fallback system
- Better state synchronization

## [0.32.0] - 2026-01-29

### Added
- **2D Scene Formation Movement** - Agents can now move in coordinated formations
  - Circle formation for small groups (1-6 agents)
  - Grid formation for larger groups
  - Configurable formation spacing (1.2 unit default)
  - Smooth multi-agent positioning with centralized target point
- **Building Drag-Move Support** - Buildings can now be moved in the 2D scene
  - Real-time visual updates during drag operations
  - Building position synchronization
  - Integrated with 2D scene input handler
- **Text Attachment Handling** - Enhanced Claude output panel
  - New `PastedTextChip` component for displaying text attachments
  - Improved attachment rendering and styling
- **Shared FolderInput Component** - New reusable folder/directory input component
  - File/folder selection interface
  - Integrated with BuildingConfigModal and other modals
  - Better UX for directory-based configuration

### Changed
- **2D Scene Input Handler** - Extended with drag support for buildings
  - New `onBuildingDragMove` callback for building drag operations
  - Better event delegation for building interactions
  - Improved input handling for 2D scene objects
- **Scene2D Rendering** - Enhanced visual system
  - Improved building rendering with drag indicators
  - Better entity positioning and updates
  - Optimized renderer performance
- **ClaudeOutputPanel** - Improved input area
  - Better text input handling
  - Enhanced attachment chip styling
  - Improved terminal header organization
- **Server File Routes** - Expanded capabilities
  - New file upload endpoints
  - Enhanced file serving capabilities
  - Better error handling
- **WebSocket Handler** - Extended event routing
  - New handlers for building drag operations
  - Improved event propagation
  - Better client-server synchronization

### Technical
- New `PastedTextChip.tsx` component for attachment rendering
- New `FolderInput.tsx` shared component for directory selection
- Enhanced `Scene2D.ts` with building drag state management
- Extended `Scene2DInput.ts` with drag event handling
- Updated `Scene2DRenderer.ts` with drag visualization
- New file routes in `src/packages/server/routes/files.ts`
- Extended `claude-service.ts` with new capabilities
- Improved WebSocket handler with new event types
- Enhanced SCSS for attachment chips and input areas

## [0.31.0] - 2026-01-28

### Added
- **Database Building Action Popup** - New action popup for database building interactions
- **Database Service** - Backend service for database operations
- **Database WebSocket Handler** - Real-time database synchronization
- **Database Store** - Client-side state management for database features
- **Tooltip Component** - Reusable tooltip component for UI hints
- **Modal Close Hook** - useModalClose hook for improved modal management

### Changed
- **Modal System** - Enhanced modal styling and interactions
  - Refined modal layout and spacing
  - Improved modal header and content organization
  - Better modal backdrop and overlay handling
- **Spotlight Search** - Additional refinements and improvements
  - Better search result presentation
  - Improved type definitions
- **Terminal Header** - Enhanced terminal control UI
  - Better button organization
  - Improved responsive layout
- **Scene Setup** - Improved initialization and synchronization
  - Better state management
  - Enhanced hook organization
- **Skill Editor** - UI and interaction improvements
- **Agent Edit Modal** - Enhanced styling and layout
- **Building Config Modal** - Layout refinements

### Technical
- New `DatabaseBuildingActionPopup` component
- New `database-service.ts` for server-side database operations
- New `database-handler.ts` for WebSocket communication
- New `Tooltip` component with styling
- New `useModalClose` hook for modal management
- New `database.ts` store module for state management
- Enhanced store selectors and types
- Improved modal styling with SCSS refinements
- Updated websocket handler with database routes

## [0.30.0] - 2026-01-27

### Added
- **IframeModal Component** - New modal component for embedding iframe content
  - Flexible iframe container for displaying external content
  - Modal styling and positioning
- **PM2 Logs Skill** - Built-in skill for monitoring PM2 process logs
  - Server-side skill definition for process log streaming
  - Integration with PM2 service for process monitoring

### Changed
- **Spotlight Search** - Enhanced search functionality and utilities
  - Improved search algorithm and matching
  - Better result filtering and ranking
- **UI Components** - Multiple component refinements
  - BuildingActionPopup interactions
  - BossBuildingActionPopup enhancements
  - PM2LogsModal and BossLogsModal styling
  - AppModals integration improvements
- **Building Configuration** - Layout and styling updates
  - Refined building config SCSS
  - Improved layout components

### Technical
- New `IframeModal.tsx` component and styling
- New `pm2-logs.ts` skill definition
- Enhanced Spotlight search utilities
- Updated builtin skills index with PM2 logs skill
- Refined component interactions and styling

## [0.29.0] - 2026-01-27

### Added
- **Building Interactions System** - Interactive building management in scene
  - BuildingActionPopup component for context-aware building actions
  - BossBuildingActionPopup for boss-specific building interactions
  - Building configuration modal with advanced settings
  - Building state management in Redux store with selectors
- **Building WebSocket Handler** - Real-time synchronization of building operations
  - Building action execution via WebSocket
  - Building state updates and synchronization
  - Integration with client and server building services
- **PM2 Process Monitoring** - Monitor and view application processes
  - PM2LogsModal component for viewing process logs
  - BossLogsModal for boss-specific logs
  - PM2Service for process management
  - ANSI to HTML conversion for log rendering
- **Building Configuration Routes** - Server-side API for building management
  - Configuration endpoint for building settings
  - Building service enhancements
- **Bitbucket PR Skill** - Integration with Bitbucket pull request workflow
  - bitbucket-pr skill definition for agents
- **Enhanced Scene Interactions**
  - Building styles system with command center style
  - Improved InputEventHandlers for building interactions
  - CharacterLoader enhancements for character positioning

### Changed
- **Building Manager** - Extended with building action handling
  - New action execution methods
  - Building state tracking
  - Label utilities for building labels
- **Toolbox Component** - Enhanced with building config options
  - New building configuration section
  - Expanded styling options
  - Better component organization
- **Store Architecture** - Building state management
  - New buildings reducer
  - Building selectors and hooks
  - Building-related type definitions
- **WebSocket Handler** - Extended with building operations
  - Building event handlers
  - Building state synchronization
  - Building action routing
- **Scene Setup Hook** - Enhanced with building initialization
  - Better building lifecycle management
  - Improved scene synchronization

### Technical
- New `BuildingActionPopup` component for building interactions
- New `BossBuildingActionPopup` component for boss buildings
- New `PM2LogsModal` and `BossLogsModal` components
- New `ansiToHtml.ts` utility for log formatting
- New `bitbucket-pr.ts` skill definition
- New `config.ts` routes for building configuration
- New `pm2-service.ts` for process management
- Extended BuildingManager with interaction methods
- New building styles (commandCenter)
- Building store module with selectors
- Enhanced WebSocket building handler
- Improved scene synchronization

## [0.28.0] - 2026-01-27

### Added
- **Environment-based port configuration** - Backend and frontend ports can now be configured via a `.env` file using `PORT` and `VITE_PORT` variables
- **`.env.example`** - Documents all available environment variables (`PORT`, `VITE_PORT`, `LISTEN_ALL_INTERFACES`)
- **`dotenv` support** - Both the server and Vite config load `.env` automatically via `dotenv/config`

### Changed
- **WebSocket default port** - Client now uses the `PORT` env variable (injected at build time as `__SERVER_PORT__`) instead of hardcoded `5174` for backend discovery
- **Connection error message** - Toast notification now shows the actual configured port instead of hardcoded `5174`

## [0.27.1] - 2026-01-27

### Fixed
- **Custom model idle animation** - Agents with custom models no longer animate when idle animation is set to "None"; they freeze in their static pose instead of playing the first animation from the model file
- **Custom model walk animation** - Walking animation now correctly uses the custom animation mapping instead of hardcoded animation names that don't exist in custom models
- **Model preview in class editor** - Preview now respects the selected idle animation mapping; shows static pose when idle is set to "None"

### Changed
- **Z offset range** - Increased model position Z (height) offset range from ±1 to ±3 to accommodate models that sit below ground when static
- **setIdleAnimation/setWorkingAnimation** - Now route through `updateStatusAnimation` for consistent animation resolution across custom and built-in models

## [0.27.0] - 2026-01-27

### Added
- **Secrets Management System** - Store and inject sensitive data securely
  - `SecretsSection` component in Toolbox for managing secrets
  - Add, edit, delete secrets with name, key, value, description
  - Reference secrets in prompts using `{{KEY}}` placeholder syntax
  - Click to copy placeholder code for easy integration
  - Server-side secrets storage with WebSocket sync
- **Secrets Store & Service** - Backend infrastructure for secret management
  - Client-side secrets store with selectors and array hooks
  - `SecretsService` for server-side secret persistence
  - `SecretsHandler` for WebSocket communication
  - Type definitions for Secret interface
  - Real-time synchronization between client and server
- **File Viewer Modal Enhancements** - Improved keyboard navigation
  - Vim-style scrolling: j/k for up/down (100px per scroll)
  - Focus management for overlay keyboard capture
  - Escape key to close modal
  - Smooth scrolling animation support
  - Diff panel support with dual-panel scrolling
  - Event propagation control to avoid interference with message navigation

### Changed
- **Toolbox Component** - Added Secrets section
  - New collapsible "Secrets" section with storage persistence
  - `useSecretsArray()` hook for secrets list management
  - Form-based UI for adding/editing secrets
  - Improved section organization
- **FileViewerModal** - Keyboard event handling refactored
  - Global keyboard listener with capture phase
  - Better input field detection for text inputs
  - Event stopPropagation to prevent conflicts with other handlers
  - Focus management improvements
  - Ref-based scrolling container tracking
- **Message Navigation Hook** - Keyboard integration improvements
  - `inputRef` and `textareaRef` props for input focus management
  - `useTextarea` option for choosing input type
  - Auto-focus on input when typing during navigation
  - Smart input type detection for textarea vs input
  - Prevents character loss when switching to typing mode
- **App Component** - Secrets provider integration
  - Secrets state propagation through component tree
  - WebSocket handler updates for secrets sync

### Technical
- New `src/packages/client/store/secrets.ts` - Client secrets store
- New `src/packages/server/services/secrets-service.ts` - Server service
- New `src/packages/server/websocket/handlers/secrets-handler.ts` - Handler
- Extended WebSocket handler with secrets route
- Server data module updates for secret persistence
- Type definitions: `Secret`, `SecretsState` added to shared types
- Store selectors: `useSecrets()`, `useSecretsArray()`
- Improved keyboard event handling in FileViewerModal
- Message navigation hook enhancements for input handling

---

## [0.26.2] - 2026-01-27

### Fixed
- **Class editor modal overflow** - The "Create Agent Class" modal was taller than the screen with no scroll, making it impossible to use. Added max-height constraint and scrollable body.

---

## [0.26.1] - 2026-01-27

### Fixed
- **Skills and Controls floating buttons** - Fixed buttons that would blink but never open their panels. The useEffect that closes these modals when the terminal closes was re-triggering on modal state changes due to dependency array including modal objects, immediately closing them.

---

## [0.26.0] - 2026-01-27

### Added
- **Post-Processing Effects** - New PostProcessing system for scene effects
  - Color correction shader with saturation, contrast, and brightness controls
  - Composable effect rendering pipeline with Three.js
  - Foundation for advanced visual effects
- **Agent Model Styling System** - Advanced visual customization for agent models
  - Color mode options: Normal, B&W, Sepia, Cool, Warm, Neon
  - Saturation control (0-2 range: grayscale to vivid)
  - Material properties override: roughness, metalness, emissive boost
  - Wireframe rendering mode for debugging
  - Environment map intensity control
  - Per-material shader injection for color effects
  - Real-time shader uniforms for dynamic updates
- **Toolbox Model Style Panel** - New UI section for agent model styling
  - Color mode selector with emoji icons
  - Sliders for saturation, roughness, metalness, emissive boost, env map intensity
  - Wireframe toggle
  - CollapsibleSection integration for organized settings
- **Enhanced Terrain Configuration** - Additional visual controls
  - Sky color customization
  - Better integration with post-processing system

### Changed
- **AgentManager Refactoring** - Major expansion with styling system
  - New `setModelStyle()` and `getModelStyle()` methods
  - Unified `applyStyleToMesh()` method replacing individual style applications
  - Color shader injection into materials with dynamic uniforms
  - Support for 6 distinct color modes with shader code injection
  - Material property override system
- **Toolbox Component** - Reorganized and expanded
  - New ModelStyleConfig interface
  - COLOR_MODE_OPTIONS constant
  - updateModelStyle function for state management
  - Better section organization with collapsible UI
- **SceneCore** - Enhanced with post-processing support
  - Better scene effect composition
- **BossSpawnModal & AgentEditModal** - Minor UI improvements
- **Boss Handler** - Improved message routing

### Technical
- New PostProcessing.ts module with shader composition
- ColorCorrectionShader with GLSL color correction
- Material userData.hasColorShader tracking for injected shaders
- Shader uniform updates via material.onBeforeCompile
- New sceneConfig.modelStyle property
- Extended Toolbox configuration interface
- ColorMode type definition in Toolbox

## [0.25.0] - 2026-01-27

### Added
- **Message Navigation in Terminal** - Navigate through terminal messages with keyboard shortcuts
  - Alt+K / Alt+J for message-by-message navigation (up/down)
  - Alt+U / Alt+D for page-up/page-down (10 messages at a time)
  - Smooth animated scrolling to selected messages
  - Space bar to activate selected message (click links, buttons, bash output)
  - Escape to clear selection and exit navigation mode
  - Selected messages highlighted and auto-scroll into view
- **Enhanced Terminal Input State** - New hooks and store updates for better input handling
  - `useMessageNavigation` hook for managing message selection and scrolling
  - Integration with OutputLine component for message indexing
- **Agent Navigation Improvements** - Keyboard shortcuts for scene agent selection
  - Alt+H / Alt+L to navigate agents when terminal is closed
  - Consistent agent ordering with SwipeNavigation and AgentBar
  - Selection updates propagated through store
- **Terminal Activation with Space Bar** - Press Space to open terminal
  - Only opens terminal (Backtick or Escape to close)
  - Auto-selects last active agent if none selected
  - Respects input field context (doesn't trigger in text inputs)

### Changed
- **Terminal Output Display** - Enhanced output line styling and interactions
  - Added data-message-index attributes for navigation
  - Better visual feedback for interactive elements
  - Improved Bash output highlighting with additional color scheme
  - Enhanced guake-terminal styling with better output formatting
- **InputHandler Refactoring** - Extended keyboard event handling
  - Unified keyboard event processing for Space and Alt+H/L
  - Added agent ordering logic matching UI components
  - Better event delegation and input field detection
- **Character Loader** - Minor optimizations for character asset loading
- **WebSocket Handler** - Improved message handling robustness

### Technical
- New `useMessageNavigation` hook in ClaudeOutputPanel
- Extended OutputLine component with message indexing
- Store enhancements: lastSelectedAgentId tracking, terminal state management
- Keyboard event listener in InputHandler for Space and Alt+H/L
- Agent ordering utility in InputHandler matching AgentBar logic

## [0.24.1] - 2026-01-27

### Fixed
- **Agent Order Synchronization** - Fix inconsistent agent ordering between SwipeNavigation and AgentBar
  - Use unified `useAgentOrder` hook in both components for consistent navigation order
  - Add custom event broadcasting for order changes across component instances
  - Improve agent grouping by preserving custom order within area groups
- **SwipeNavigation Hook Refactor** - Simplified and improved agent ordering logic
  - Remove dependency on `useAreas` hook
  - Use base agent list sorted by creation time as foundation
  - Apply custom ordering from `useAgentOrder` for navigation consistency

## [0.24.0] - 2026-01-27

### Added
- **Theme Selector Keyboard Navigation** - Full keyboard support for theme switching
  - Arrow keys (Up/Down/Left/Right) cycle through themes
  - Enter/Space to open dropdown or select highlighted theme
  - Highlighted state for dropdown items with mouse hover support
- **Theme Selector Focus Management** - Improved accessibility
  - Focus styles on trigger button with cyan accent
  - Focus restoration after selection
  - Tooltip hints for keyboard shortcuts

### Changed
- **Theme Selector Styling** - Enhanced visual feedback
  - Active and highlighted states with distinct colors
  - Smooth transitions for all state changes
  - Cyan accent for focus states

### Fixed
- **Builtin Skill Assignment Restoration** - Preserve skill assignments on app restart
  - Restore agent assignments to builtin skills instead of discarding them
  - Preserve enabled state for previously configured skills
  - Merge persisted assignments with fresh builtin definitions

## [0.17.0] - 2026-01-26

### Added
- **Agent Delegation System** - Agents can now delegate tasks to other agents via a delegation request dialog
  - Click the delegation icon to send a task to another agent
  - Automatic skill injection and context management for delegated tasks
- **Boss Message Handling** - Bosses can now send formatted messages to subordinate agents
  - Message response modal with proper formatting and history
  - WebSocket communication for real-time agent-to-boss messaging
- **Agent Progress Indicator** - Visual progress tracking UI for delegated and autonomous tasks
  - Shows agent status and current operation
  - Integrated into Claude output panel
- **Built-in Skills Registry** - Server-side skill definitions for common operations
  - Git Captain skill for version control operations
  - Full Notifications skill for comprehensive notification system
  - Server Logs skill for debugging
  - Send Message to Agent skill for inter-agent communication
- **Skill Editor Enhancements** - Improved modal for managing agent skills
  - Better organization and styling
  - Enhanced skill selection interface

### Changed
- **WebSocket Handler** - Extended with agent delegation message support
- **Agent Service** - Added delegation request handling
- **Boss Message Service** - New service for formatting and routing boss messages
- **Store Structure** - Added delegation state and selectors
- **Modal Styling** - Enhanced modal system with improved layouts

### Technical
- New `delegation.ts` store module for delegation state management
- New `boss-response-handler.ts` for processing boss messages
- New `AgentProgressIndicator` component for progress tracking
- New `builtin-skills.ts` data module with skill definitions
- Extended WebSocket handlers for agent communication protocols
- Added delegation-related types to shared types module

## [0.16.1] - 2026-01-26

### Fixed
- **HMR (Hot Module Replacement) Issues** - Fix black screen and crashes during development reloads
  - Add app initialization flag to detect HMR vs full page load
  - Skip stale context cleanup during HMR
  - Implement proper canvas reattachment with animation frame management
  - Prevent rendering during scene transition
  - Use container dimensions as priority for canvas sizing
- **FPS Meter Position** - Move FPS meter to bottom-right to avoid UI conflicts
- **Canvas Dimension Handling** - Improved dimension priority during HMR
  - Use parent container as primary source (most reliable)
  - Fallback to canvas CSS, then canvas attributes, then window
- **InputHandler Touch Events** - Enhanced touch event handling

### Technical
- Add `isReattaching` flag to prevent renders during HMR transition
- Check `canvas.isConnected` to ensure DOM attachment before rendering
- Proper animation frame cleanup and restart in reattach method
- Window flag `__tideAppInitialized` for HMR detection

## [0.16.0] - 2026-01-26

### Added
- **Working Directory Support** - Agents can now have a configurable working directory
  - Add working directory field to agent edit modal
  - Directory changes trigger new session notification
  - Updates propagated via WebSocket handler
- **Emoji Picker Component** - New reusable emoji picker for UI
  - Standalone component for emoji selection
- **Boss Spawn Class Search** - Search and filter classes when spawning bosses
  - Filter custom classes by name, description, or ID
  - Filter built-in classes with same criteria
  - Improved class selection UX
- **Boss Name Prefix Customization** - Automatic name prefixing based on class
  - Boss class uses "Boss " prefix
  - Custom classes use their name as prefix
  - Dynamic prefix updates when changing class

### Changed
- **Skills Panel** - Enhanced styling and layout
- **Spawn Modals** - Improved UI for agent and boss spawning
- **Movement Animation** - Updated animation handling
- **Agent Store** - Added workdir field support

### Technical
- Modal component style enhancements
- Skills panel responsive improvements
- Server handler updates for workdir persistence

## [0.15.0] - 2026-01-26

### Added
- **Android/Capacitor Support** - Native Android app build
  - Capacitor configuration and Android project
  - Makefile with build commands (`make android-build`, `make android-run`)
  - Debug APK generation
- **Native Notifications** - Push notifications via Capacitor
  - `notifications.ts` utility for cross-platform notifications
  - Agent notification toast enhancements
- **Context Menu Improvements** - Enhanced right-click menu
  - Better styling and positioning
  - Mobile touch support
- **Modal Stack Enhancements** - Improved modal management
  - Better escape key handling
  - Stack depth tracking

### Changed
- **File Explorer Mobile** - Improved touch interactions
  - Better tree node touch targets
  - Enhanced file viewer mobile layout
- **Skills Panel** - Mobile responsive styles
- **WebSocket Reconnection** - Improved connection handling
- **Input Handler** - Better touch/mouse event handling
- **Storage Utils** - Additional storage helpers

### Fixed
- **File Content Loading** - Better error handling and caching
- **Server File Routes** - Improved file serving

### Technical
- Capacitor 7 with Android platform
- New Makefile for build automation
- `useModalStack` depth tracking additions

## [0.14.1] - 2026-01-25

### Added
- **Agent Navigation Shortcuts** - Keyboard shortcuts for switching agents
  - Alt+J to go to next agent (like swipe left)
  - Alt+K to go to previous agent (like swipe right)

### Fixed
- **Mobile Back Navigation** - Fix iOS Safari edge swipe breaking navigation
  - Push two history entries instead of one for buffer
  - Mobile back gestures can complete before popstate fires
  - Track history depth to properly calculate go-back amount

## [0.14.0] - 2026-01-25

### Added
- **PWA Support** - Install Tide Commander as a standalone app
  - Web app manifest with icons (192x192, 512x512)
  - Service worker for offline caching
  - PWA install banner with dismiss/install options
  - Standalone display mode support
- **Modal Stack System** - Proper modal layering and keyboard handling
  - `useModalStack` hook for z-index management
  - Escape key closes topmost modal only
  - Prevents body scroll when modals open
- **Swipe Gesture Hook** - Touch gesture detection for mobile
  - `useSwipeGesture` hook with configurable thresholds
  - Support for swipe direction detection

### Changed
- **Responsive Styles Reorganization** - Major refactor of mobile styles
  - Expanded responsive breakpoints and utilities
  - Better mobile panel layouts
  - Improved touch targets for mobile
- **File Explorer Styles** - Split into modular directory structure
  - `file-explorer/_index.scss` with partials
- **Guake Terminal Styles** - Split into modular directory structure
  - `guake-terminal/_index.scss` with partials
- **Agent Bar Mobile** - Enhanced mobile responsiveness
- **Git Changes Panel** - Improved mobile layout and interactions
- **Double Click Detection** - Better touch device handling

### Technical
- New `PWAInstallBanner` component
- `useModalStack`, `useSwipeGesture` hooks exported from hooks/index
- Touch event handling improvements in InputHandler
- Scene manager touch gesture support

## [0.13.0] - 2026-01-25

### Added
- **Power Saving Toggle** - New setting in Toolbox config to enable/disable idle throttling
  - Disabled by default to preserve current behavior
  - Prevents idle mode when any agent is actively working
- **WebGL Context Loss Handling** - Graceful recovery from GPU context loss
  - Stop animation loop on context loss
  - Automatically restart on context restore
- **Compact Toggle Switches** - Prettier toggle UI for boolean settings
  - Replace checkbox inputs with styled toggle switches
  - Smooth transitions and hover states

### Changed
- **Cached Boss-Subordinate Connections** - Only rebuild line mapping on selection change
  - Skip line updates when no agents are moving
- **Optimized Animation Mixer Updates** - Only update mixers for agents with active animations
  - Track animating agents in a Set for O(1) lookups
- **Delta Time Capping** - Cap frame delta at 100ms to prevent animation jumps after throttling
- **Controls Update During Skip** - Update OrbitControls even when skipping render frames
  - Maintains smooth damping during FPS limiting

### Fixed
- **Procedural Bodies Cache Invalidation** - Properly invalidate cache when agents added/removed

### Technical
- `setPowerSaving(enabled: boolean)` public method on SceneManager
- `hasWorkingAgents()` private method to check agent status
- `powerSaving` setting in store with default `false`
- `stopAnimation(agentId)` method on MovementAnimator
- Cached `proceduralBodiesCache` with dirty flag pattern

## [0.12.0] - 2026-01-25

### Added
- **Idle Detection & Power Saving** - Automatic FPS throttling when scene is inactive
  - Throttle to 10 FPS after 2 seconds of inactivity
  - Wake on user interaction (mouse, wheel, keyboard)
  - Wake automatically when agents are moving
- **Line Object Pooling** - Reuse boss-subordinate connection lines
  - No more geometry allocation/disposal on selection change
  - Update positions in-place via BufferAttribute

### Changed
- **Hash-based Change Detection** - Replace JSON.stringify with efficient hashing
  - Agent change detection uses position/status hash codes
  - Area and building sync uses size + hash comparison
  - Dramatically reduces GC pressure from string allocations
- **Throttled Hover Detection** - Reduce raycasting frequency to 20Hz
- **Batched Indicator Scale Updates** - Only recalculate when camera moves or every 100ms
  - Avoids per-agent per-frame store access

### Technical
- `MovementAnimator.hasActiveMovements()` method for idle detection
- `InputHandler.onActivity` callback for user interaction tracking
- `SceneManager.markActivity()` public method for external activity signals

## [0.11.0] - 2026-01-24

### Added
- **DOM Stats Tab** - New tab in Performance Monitor for DOM diagnostics
  - Node count, canvas count, image count, video count tracking
  - Color-coded thresholds (green/yellow/red) for node counts
- **Texture Memory Estimation** - Approximate GPU/VRAM usage tracking
  - Texture count from Three.js renderer
  - Estimated VRAM in megabytes
- **Memory Breakdown Panel** - Unified view of memory sources
  - JS Heap, GPU/Textures, and DOM memory estimates
  - Estimated total memory usage
  - Displayed in both Memory and DOM tabs

### Changed
- Performance Monitor tabs renamed: "Three.js" → "3D" for brevity
- Copy Stats now includes DOM and estimated memory data

### Technical
- Use refs for memoryHistory and threeJsStats to avoid interval recreation
- Reduced useEffect dependency array to prevent unnecessary re-renders

## [0.10.2] - 2026-01-24

### Fixed
- **Unmount State Update Prevention** - Prevent React state updates after component unmount
  - Added mount state ref tracking in ClaudeOutputPanel
  - Guard all async state updates in history loading with mount check
- **Agent Output Memory Leak** - Clean up agentOutputs map when removing agents
  - Prevents orphaned output data from accumulating in store

## [0.10.1] - 2026-01-24

### Fixed
- **Completion Indicator Timer Leak** - Fixed memory leak in ClaudeOutputPanel
  - Proper timer cleanup when agent status changes
  - Clear existing timer before creating new one
  - Cancel completion state immediately when agent starts working again
  - Cleanup timer on component unmount

## [0.10.0] - 2026-01-24

### Added
- **Agent Response Modal** - View Claude responses as formatted markdown in a modal
  - Click the 📄 button on any Claude message to open the modal
  - Full markdown rendering with syntax highlighting
  - Keyboard shortcut (Escape) to close
- **Performance Monitor** - Enhanced FPS meter with memory and Three.js diagnostics
  - Memory usage tracking with heap size and limit
  - Three.js resource counts (geometries, textures, programs)
  - Memory history graph for detecting leaks
  - Growth rate indicator
  - Tabbed interface: FPS / Memory / Three.js
- **Landing Page Scaffold** - New landing page directory structure
  - `dev:landing` script for developing the landing page

### Fixed
- **Memory Leak Prevention** - Comprehensive WebGL context cleanup
  - Proper disposal on page unload (beforeunload, unload, pagehide events)
  - bfcache detection and forced cleanup on restore
  - StrictMode compatibility (no duplicate scene creation on remount)
  - Session storage tracking for detecting unclean shutdowns
  - Canvas removal and WebGL context loss on cleanup
  - WebSocket disconnect and callback cleanup before scene disposal
- **Selection Visual Performance** - Reduced geometry churn from boss-subordinate lines
  - Only refresh visuals when selection or agent positions actually change
  - Prevents massive geometry recreation on every store update

### Changed
- API calls now use `apiUrl()` helper for proper base URL handling
  - History fetch, file upload, search all use dynamic base URL
  - Custom model URLs use `apiUrl()` for correct paths
  - Image URLs properly prefixed with API base URL
- FPSMeter renamed to Performance Monitor internally
- Scene manager exposed on `window.__tideScene` in dev mode for debugging

### Technical
- New `AgentResponseModal` component for markdown viewing
- New `disconnect()` and `clearCallbacks()` exports from websocket module
- `cleanupScene()` function centralizes all disposal logic
- `WEBGL_SESSION_KEY` for tracking active WebGL contexts across sessions
- `getApiBaseUrl()` utility for dynamic API base URL
- `apiUrl()` helper for constructing full API URLs

## [0.9.0] - 2026-01-23

### Added
- **Custom 3D Model Support** - Upload custom `.glb` models for agent classes
  - GLB file upload with validation and animation parsing
  - Automatic animation detection and mapping (idle, walk, working)
  - Custom animation mapping UI for mapping model animations to agent states
  - Model scale and position offset controls for fine-tuning placement
  - Live 3D preview with drag-to-rotate interaction
  - Server-side model storage and streaming API (`/api/custom-models`)
- **Procedural Animation System** - Models without animations get procedural idle effects
  - Gentle bobbing and swaying for static models
  - Automatic fallback when no animations detected
- **Enhanced Model Preview** - Interactive 3D preview in class editor
  - Drag-to-rotate functionality (click and drag to rotate model)
  - Support for custom model files, URLs, and built-in models
  - Procedural animation for models without built-in animations
- **GLB Parser Utility** - Client-side GLB parsing for animation extraction
  - Validates GLB magic bytes and structure
  - Extracts animation names without full model load
  - File size formatting helper

### Changed
- SkillsPanel now supports custom model upload with full configuration UI
- ModelPreview component accepts custom model files and URLs
- CharacterFactory and CharacterLoader support custom models from server
- SceneManager integrates ProceduralAnimator for animation-less models
- Custom classes can now have per-class animation mappings
- MovementAnimator supports custom walk animations per agent class

### Technical
- New `ProceduralAnimator` class for procedural animation state management
- New `glbParser.ts` utility for client-side GLB file parsing
- New `/api/custom-models` routes for model upload, retrieval, and deletion
- Extended `CustomAgentClass` type with model customization fields
- Added `AnimationMapping` type for per-class animation configuration

## [0.8.2] - 2026-01-22

> ⚠️ **EXPERIMENTAL RELEASE** - This version includes new features that require testing:
> - The stdin watchdog auto-respawn feature may cause unexpected behavior in some edge cases
> - History loading may occasionally fail when switching to an agent - refresh if this occurs

### Added
- **Stdin Activity Watchdog** (EXPERIMENTAL) - Detects stuck processes and auto-respawns them
  - 10 second timeout after sending stdin message
  - If no activity received, process is killed and respawned with same command
  - Activity callbacks system in ClaudeRunner to track process responsiveness

### Fixed
- History loading flicker when sending command to idle agent (session establishment)
- "No output yet" message showing briefly while agent is working
- Track session establishment separately from agent switches to avoid unnecessary loading states

### Changed
- ClaudeOutputPanel now tracks both agentId and sessionId changes separately
- Added `lastActivityTime` tracking to ActiveProcess for watchdog feature

## [0.8.1] - 2026-01-22

### Added
- Terminal resizing state in store to coordinate with battlefield interactions
- Visibility change listener to cancel drag states when document becomes hidden
- `useTerminalResizing` selector for components needing resize state

### Fixed
- Selection box appearing when dragging external windows (like Guake) over canvas
- Drag selection not canceling when window loses focus or visibility
- Selection box persisting during terminal resize operations

### Changed
- InputHandler now tracks if pointer down originated on canvas to prevent false drag events
- Added `cancelAllDragStates()` method to centralize cleanup of all drag/selection states

## [0.8.0] - 2026-01-22

### Added
- **Skill Hot-Reload** - When a skill's content is updated, all agents using that skill are automatically hot-restarted with preserved context
- Window blur event handler to clear hover state when switching apps (e.g., to Guake terminal)

### Changed
- Agent skill changes now trigger hot-restart to apply new skills in system prompt
- Refactored hover state clearing into reusable `clearHoverState()` method
- Skills are now properly applied on agent restart via `--resume` flag

### Fixed
- Hover tooltip persists when switching to another application window

## [0.7.3] - 2026-01-22

### Changed
- Improved version indicator visibility in agent bar (better contrast with rgba colors)

## [0.7.2] - 2026-01-22

### Fixed
- Fixed tooltip on hover agent appearing too fast (increased delay from 200ms to 400ms)
- Fixed hover state persisting when mouse leaves canvas (added pointerleave handler)

## [0.7.1] - 2026-01-22

### Added
- **Agent Notification System** - Agents can now send toast notifications to users
  - New `AgentNotificationToast` component with styled popups
  - REST API endpoint `/api/notify` for agents to send notifications via HTTP
  - WebSocket support for real-time notification delivery
  - Click notification to focus the sending agent
  - Auto-dismiss after 8 seconds with manual close option
- New `send-notification.md` skill for agents to send notifications

### Changed
- Moved version display from fixed position to agent bar (cleaner UI)
- Added `AgentNotification` types to shared types
- Enhanced WebSocket handler with notification broadcast support

## [0.7.0] - 2026-01-22

### Added
- Version display component showing app version in UI
- Agent cloning functionality (duplicate agents with same config)
- Enhanced CharacterFactory with sprite caching and preloading
- Vite environment variable support for version injection

### Changed
- Improved SceneManager with better character management
- Enhanced AgentEditModal styling
- Updated agent-handler with clone support
- Improved command-handler with better error handling

## [0.6.5] - 2026-01-22

### Added
- Live skill injection for running agents (skills are injected on next command without restart)
- Pending skill update tracking in skill-service
- Skill update notification builder for seamless skill additions

### Changed
- Command handler now injects skill updates when skills are assigned to running agents

## [0.6.4] - 2026-01-22

### Changed
- Boss agents can now use tools directly while preferring delegation to subordinates
- Updated trackpad gesture handler comments to be browser-agnostic (not Safari-specific)
- Updated controls modal text to be platform-agnostic (removed Mac-specific wording)

## [0.6.3] - 2026-01-22

### Removed
- Removed unused components (ActivityFeed, BottomToolbar, CommandInput, KeyboardShortcutsModal, MouseControlsModal, Spotlight)
- Removed unused useFormState hook
- Removed legacy process output file helpers from data module

## [0.6.2] - 2026-01-22

### Added
- Server logs skill for debugging
- Enhanced debug logging system with structured log entries
- Log streaming via WebSocket for real-time debugging

### Changed
- Improved ClaudeOutputPanel with history line enhancements
- Enhanced output filtering with additional output types
- Updated guake terminal styling with expanded features
- Improved session-loader with better error handling
- Enhanced backend event parsing

### Fixed
- Various TypeScript type improvements

## [0.6.1] - 2026-01-21

### Changed
- Refactored agent edit modal with improved styling and layout
- Converted class selection to compact chip buttons
- Improved form field organization with responsive rows
- Enhanced skills section with compact chip display
- Migrated inline styles to SCSS classes for better maintainability

### Fixed
- TypeScript errors in AgentDebugPanel and backend
- Fixed parseEvent return type to match interface
- Added type assertion for log.data in debug panel

## [0.6.0] - 2026-01-21

### Changed
- Redesigned BossSpawnModal with improved layout and UX
- Revamped SpawnModal with streamlined interface
- Enhanced modal styling with better visual hierarchy
- Updated boss spawn styling with improved form layout
- Refined forms styling for better consistency
- Minor guake terminal styling adjustments

## [0.5.1] - 2026-01-21

### Changed
- Refactored ControlsModal with simplified configuration
- Streamlined TrackpadGestureHandler for better performance
- Cleaned up InputHandler event handling
- Simplified mouse controls store

## [0.5.0] - 2026-01-21

### Added
- `TrackpadGestureHandler` for trackpad gesture support (pinch-to-zoom, two-finger pan)
- Enhanced controls modal with trackpad gesture settings
- Additional mouse control bindings and customization options

### Changed
- Improved CameraController with better zoom and pan handling
- Enhanced InputHandler with trackpad gesture integration
- Expanded MouseControlHandler with more action types
- Updated store with trackpad sensitivity settings
- Refined shortcuts modal styling with better organization

## [0.4.0] - 2026-01-21

### Added
- Mouse controls modal component for configuring mouse interactions
- Controls modal component for unified settings management
- `MouseControlHandler` for advanced mouse input handling
- Mouse controls store with configurable bindings
- Customizable keyboard shortcuts modal with improved layout
- Enhanced guake terminal styling with better visual hierarchy

### Changed
- Refactored App component with improved modal management
- Enhanced ClaudeOutputPanel with better layout and functionality
- Improved InputHandler with extended mouse event support
- Updated store with mouse controls state management
- Refined file explorer styling with better spacing
- Overhauled shortcuts modal with categorized sections
- Improved toolbox styling

## [0.3.0] - 2026-01-21

### Added
- File tabs component for multi-file editing support
- Content search results component with file content searching
- Unified search results combining file tree and content search
- `useFileExplorerStorage` hook for persisting explorer state
- Server-side file content search API endpoint (`/api/files/search`)
- Enhanced syntax highlighting with more language support
- File viewer image preview and binary file detection
- Line numbers in file viewer
- Copy file path functionality

### Changed
- Completely revamped file explorer UI with tabs and search integration
- Enhanced file content hook with caching and better error handling
- Improved file tree with search filtering and better performance
- Updated TreeNodeItem with refined styling and interactions
- Expanded syntax highlighting constants for more file types
- Improved guake terminal styling

## [0.2.0] - 2026-01-21

### Added
- Context menu component with right-click support for scene interactions
- `useContextMenu` hook for managing context menu state
- Direct folder path access in file explorer via `useExplorerFolderPath` store hook
- Enhanced file tree with expand/collapse all, refresh, and home navigation
- Bottom toolbar styling component
- Agent bar scroll buttons for horizontal navigation
- Building config modal backdrop blur styling
- New input handler interaction types (`rightClick`, `areaRightClick`)
- Scene manager `getWorldPositionFromScreen` method for coordinate conversion

### Changed
- File explorer panel now supports opening directly to a folder path
- Improved file tree hook with better state management and navigation
- Updated App component to integrate context menu and folder path features
- Enhanced input handler with right-click detection and modifier key support
- Refactored spawn modal and boss spawn modal prop types

### Removed
- Removed `openAreaExplorer` from toolbox (moved to context menu)

## [0.1.0] - Initial Release

- Initial release of Tide Commander
- RTS/MOBA-style interface for Claude Code agents
- Real-time agent visualization and management
- WebSocket-based communication
- File explorer integration
- Skills panel for agent configuration
