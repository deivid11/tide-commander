# Custom Agent Classes & 3D Models

## Built-in Classes

Tide Commander ships with seven example agent classes:

| Class | Icon |
|-------|------|
| Scout | 🔍 |
| Builder | 🔨 |
| Debugger | 🐛 |
| Architect | 📐 |
| Warrior | ⚔️ |
| Support | 💚 |
| Boss | 👑 |

These classes are **cosmetic by default** - they don't change the agent's behavior. A Scout agent is the same normal Claude Code agent as a Builder. The class only determines the 3D model and color on the battlefield. To make a class behave differently, add **custom instructions** or **default skills** to it (see below).

The Boss class is the exception: agents with the Boss class can have subordinate agents assigned to them and gain delegation capabilities.

There are 12 built-in 3D character models (6 male, 6 female) shared across the default classes.

## Creating Custom Classes

You can create your own agent classes through the Classes tab in the Skills panel. A custom class defines:

- **Name, icon, and color** - Visual identity
- **Description** - What this class specializes in
- **3D Model** - Choose a built-in model or upload your own
- **Instructions** - Markdown text injected as system prompt (like a CLAUDE.md)
- **Default skills** - Skills automatically assigned to all agents of this class

## Custom 3D Models

### Supported Format

Custom models must be in **GLB (GLTF Binary)** format. This is the standard binary format for 3D models and is widely supported by tools like Blender, Mixamo, and Ready Player Me.

Maximum file size: 50 MB.

### Uploading a Model

1. Open the **Classes** tab in the Skills panel
2. Create a new class or edit an existing one
3. In the model section, click **Upload Custom Model** or drag and drop a `.glb` file
4. The model preview shows your uploaded model in real-time

### Animation Mapping

If your GLB model contains animations, they will be detected automatically. You can map them to three states:

| State | When Used |
|-------|-----------|
| Idle | Agent is waiting or has no active task |
| Walk | Agent is moving on the battlefield |
| Working | Agent is actively running a task |

The editor auto-maps common animation names (e.g., an animation named "idle" maps to the Idle state), but you can override the mapping manually using the dropdowns.

If your model has no animations, Tide Commander falls back to procedural animations (bobbing, rotation).

### Model Configuration

- **Scale** - Size multiplier (default: 1.0). Boss agents automatically get an additional 1.5x scale.
- **Offset** - Position adjustment on three axes (X, Y, Z) for centering the model on the ground plane.

### Storage

- Custom model files are stored in `~/.tide-commander/custom-models/{classId}.glb`
- Class definitions are stored in `~/.local/share/tide-commander/custom-classes.json`
- Class instructions are stored in `~/.tide-commander/class-instructions/{classId}.md`

## Assigning Classes to Agents

Classes are selected when spawning a new agent. You can also change an agent's class later through the agent edit panel. Changing the class swaps the 3D model on the battlefield in real-time.
