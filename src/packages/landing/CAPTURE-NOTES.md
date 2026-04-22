# Tide Commander — Screenshot Capture Notes

All screenshots captured from the isolated client at `http://localhost:9059` and saved to `/home/riven/d/tide-commander/src/packages/landing/public/screenshots/`.

Four demo agents (Demo Boss, Demo Analyst, Demo Crafter, Demo Scout) were spawned inside the 9059 backend specifically to populate agent-driven views. Screenshots exist in two flavors where useful: the plain file (viewport only) and a `*b-full.png` variant (fullPage).

Total captured files: 57 (47 numbered scenes, 10 "b"/full-page variants).

---

## Core UI

- `01-main-3d-scene-empty.png` — Main 3D isometric scene with no agents (viewport).
- `01-main-3d-scene-empty-full.png` — Same scene, full page capture including overflow.
- `02-main-2d-view.png` — Lightweight 2D top-down view of the battlefield.
- `03-dashboard-view.png` — Dashboard with metrics/status overview (empty state).
- `04-tracking-board.png` — Tracking Board tab inside the sidebar.
- `05-main-3d-with-sidebar.png` — 3D scene with the agents sidebar open.
- `06-main-3d-sidebar-closed.png` — 3D scene with the sidebar collapsed.
- `35-main-3d-with-agents.png` — 3D view populated with 4 demo agents.
- `36-main-2d-with-agents.png` — 2D view populated with 4 demo agents.
- `36-workspaces-menu.png` — Workspaces ("All") dropdown menu opened.
- `37-dashboard-with-agents.png` — Dashboard populated with agent metrics.

## Modals

- `07-spawn-agent-modal.png` — Spawn Agent modal (default state).
- `07b-spawn-agent-modal-full.png` — Spawn Agent modal, full page.
- `08-spawn-boss-modal.png` — Spawn Boss Agent modal.
- `08b-spawn-boss-modal-full.png` — Spawn Boss modal, full page.
- `19-system-prompt-modal.png` — System-Level Custom Prompt modal editor.
- `29-create-agent-class-modal.png` — Create Agent Class modal.
- `29b-create-agent-class-modal-full.png` — Create Agent Class modal, full page.
- `44-edit-agent-modal.png` — Edit Agent properties modal.
- `44b-edit-agent-modal-full.png` — Edit Agent modal, full page.
- `46-add-building-modal.png` — Add New Building modal.
- `46b-add-building-modal-full.png` — Add New Building modal, full page.
- `47-draw-area-mode.png` — "Draw New Area" Rectangle tool drawing mode active.

## Settings

- `09-settings-general.png` — Settings ➜ General section.
- `09b-settings-general-full.png` — Settings ➜ General, full page.
- `10-settings-agent-names.png` — Agent Names configuration.
- `11-settings-appearance.png` — Appearance / theming.
- `12-settings-connection.png` — Connection / backend settings.
- `13-settings-scene.png` — Scene settings panel.
- `13-settings-scene-expanded.png` — Scene settings with expanded subsections.
- `14-settings-terrain.png` — Terrain generation / tiling.
- `15-settings-agent-model-style.png` — Agent model/style picker.
- `16-settings-animations.png` — Animation controls.
- `17-settings-secrets.png` — Secrets / API keys.
- `18-settings-system-prompt.png` — System Prompt section entry (launches modal).
- `20-settings-data.png` — Data import/export controls.
- `21-settings-integrations.png` — Integrations section.
- `22-settings-workflows.png` — Workflows configuration.
- `23-settings-triggers.png` — Triggers management.
- `24-settings-monitoring.png` — Monitoring & observability.
- `25-settings-experimental.png` — Experimental flags.
- `26-settings-about.png` — About panel (version, links).

## Skills & Classes

- `27-manage-skills.png` — Manage Skills main view (Skills tab).
- `28-manage-skills-classes-tab.png` — Manage Skills with Classes tab selected.

## Controls & Help

- `30-controls-keyboard.png` — Controls help: keyboard bindings.
- `31-controls-mouse.png` — Controls help: mouse bindings.
- `32-controls-trackpad.png` — Controls help: trackpad bindings.
- `33-global-search.png` — Global Search overlay.

## Agent Interaction

- `34-commander-view-empty.png` — Commander View with no agents.
- `38-commander-view-with-agents.png` — Commander View populated with 4 agents.
- `39-agent-inspector.png` — Agent Inspector / conversation pane.
- `40-agent-overview-panel.png` — Agent Overview tab.
- `41-agent-tracking-board-view.png` — Agent-scoped Tracking Board tab.
- `42-agent-git-changes.png` — Agent Git Changes / file diff tab.
- `43-boss-inspector-team-view.png` — Boss Inspector Team tab (delegation view).
- `45-agent-more-actions-menu.png` — Agent row "more actions" popover menu.

---

## Not Captured / Notes

- **Bash modal**: could not locate an explicit keyboard shortcut or UI entry in the 9059 client. `Ctrl+`` did not open one. If triggered via a specific per-agent action, it would require a running agent session to display.
- **Work Plan / Delegation graph**: with only idle demo agents (no delegated missions), the boss inspector shows the Team tab empty of in-flight work. Captured the Team tab (`43-boss-inspector-team-view.png`) but no active delegation visualisation was available.
- **Tool History / Notifications center**: accessible via the main app at `:5173` but explicitly out of scope per user instruction ("screenshots should never be taken from 5173"). The 9059 sandbox has no accumulated tool history to display.
- **Populated Dashboard charts with real metrics**: the demo agents are idle so dashboard metrics remain near-zero. The layout/cards are captured in `37-dashboard-with-agents.png`.
- **Agent conversation with real messages**: demo agents were spawned but no prompts were executed in the 9059 sandbox, so the inspector shows the agent shell/structure rather than an active conversation.
- **Real production data**: intentionally avoided. Prior captures from `:5173` (`37-agent-inspector-full.png`, `38-agent-overview.png`) were deleted to comply with the user's directive.

All screenshots were taken at the default browser viewport unless the filename ends in `-full.png`, which indicates a full-page capture.
