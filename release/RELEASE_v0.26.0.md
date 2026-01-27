# Tide Commander v0.26.0 Release

**Released:** January 27, 2026

## Summary
Major visual enhancement release featuring advanced agent model styling system with 6 color modes, post-processing effects, and real-time shader customization. Adds comprehensive toolbox UI for customizing agent appearance.

## Key Features

### Agent Model Styling
- **6 Color Modes** - Transform agent appearance instantly
  - Normal - Default realistic colors
  - B&W - Grayscale monochrome
  - Sepia - Vintage warm tones
  - Cool - Blue and cyan tones
  - Warm - Orange and red tones
  - Neon - Bright vibrant colors

### Material Customization
- **Saturation Control** - 0 (grayscale) to 2 (vivid)
- **Roughness Override** - Fine-tune surface properties
- **Metalness Override** - Control reflectivity
- **Emissive Boost** - Add glow effects
- **Environment Map Intensity** - Adjust reflections
- **Wireframe Mode** - Debug geometry and structure

### Post-Processing System
- **Color Correction Shader** - Professional-grade color control
- **Effect Composition Pipeline** - Extensible rendering system
- **Dynamic Shader Injection** - Real-time uniform updates
- **Performance Optimized** - Efficient material patching

### Toolbox UI Enhancements
- **Model Style Section** - Collapsible panel for styling
- **Interactive Sliders** - Smooth parameter adjustment
- **Emoji Icons** - Visual mode indicators
- **Live Preview** - See changes immediately

## Technical Implementation

### New Components
- PostProcessing.ts - Effect composition system
- Shader injection system in AgentManager
- ColorMode type definitions

### Enhanced Systems
- AgentManager with styling API
- Material userData tracking
- Shader uniform management
- SceneCore integration

### Architecture
- Per-material shader injection
- Dynamic uniform updates
- Closure-based shader compilation
- Efficient recompilation caching

## Files

- `tide-commander-v0.26.0.apk` - Android APK build (4.3 MB)
- `tide-commander-v0.25.0.apk` - Previous release
- `tide-commander-v0.24.1.apk` - Archive
- `CHANGELOG.md` - Full changelog history
- `RELEASE_v0.25.0.md` - Previous release notes

## Installation

Extract and install the APK on Android devices:
```bash
adb install tide-commander-v0.26.0.apk
```

## Build Information

- Version: 0.26.0
- Build Date: 2026-01-27
- Build Type: Release
- Commits: 28 files changed, 1200 insertions(+)
- Git Tag: v0.26.0
- Modules Added: PostProcessing.ts (130+ lines)

## Usage

1. Open Toolbox
2. Expand "Agent Model Style" section
3. Select color mode from options
4. Adjust sliders for saturation, roughness, metalness
5. Toggle wireframe for geometry view
6. See changes apply in real-time

## Performance Notes

- Shader injection only occurs on first material access
- Subsequent updates reuse compiled shaders
- Wireframe mode recommended for debugging only
- Color modes optimized for standard materials
