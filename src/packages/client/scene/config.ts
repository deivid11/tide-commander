import type { AgentClass } from '../../shared/types';

// Agent class visual configuration
export const AGENT_CLASS_CONFIG: Record<AgentClass, { icon: string; color: number; description: string }> = {
  scout: { icon: '🔍', color: 0x4a9eff, description: 'Explores and searches codebase' },
  builder: { icon: '🔨', color: 0xff9e4a, description: 'Creates and builds features' },
  debugger: { icon: '🐛', color: 0xff4a4a, description: 'Finds and fixes bugs' },
  architect: { icon: '📐', color: 0x9e4aff, description: 'Plans and designs systems' },
  warrior: { icon: '⚔️', color: 0xff4a9e, description: 'Tackles tough problems' },
  support: { icon: '💚', color: 0x4aff9e, description: 'Helps and assists others' },
  boss: { icon: '👑', color: 0xffd700, description: 'Manages and delegates to subordinates' },
};

// Default names for agents
export const DEFAULT_NAMES = [
  'Elon Musk', 'Steve Jobs', 'Linus Torvalds', 'Jensen', 'Jeff Bezos',
  'Tim Cook', 'Alan Turing', 'Lisa', 'Satoshi Nakamoto',
];

// Legacy alias for backwards compatibility
export const LOTR_NAMES = DEFAULT_NAMES;

// Character model mapping for each agent class (Kenney Mini Characters)
export const AGENT_CLASS_MODELS: Record<AgentClass, string> = {
  scout: 'character-male-a.glb',
  builder: 'character-male-b.glb',
  debugger: 'character-female-a.glb',
  architect: 'character-male-c.glb',
  warrior: 'character-female-b.glb',
  support: 'character-female-c.glb',
  boss: 'character-male-c.glb', // Boss uses architect model (distinguished by crown)
};

// Character model display info for the selector (maps to built-in agent classes)
export const CHARACTER_MODELS: { id: AgentClass; model: string; name: string; gender: string }[] = [
  { id: 'scout', model: 'character-male-a.glb', name: 'Explorer', gender: 'Male' },
  { id: 'builder', model: 'character-male-b.glb', name: 'Crafter', gender: 'Male' },
  { id: 'architect', model: 'character-male-c.glb', name: 'Planner', gender: 'Male' },
  { id: 'debugger', model: 'character-female-a.glb', name: 'Analyst', gender: 'Female' },
  { id: 'warrior', model: 'character-female-b.glb', name: 'Fighter', gender: 'Female' },
  { id: 'support', model: 'character-female-c.glb', name: 'Healer', gender: 'Female' },
];

// All available character models (Kenney Mini Characters)
export const ALL_CHARACTER_MODELS: { file: string; name: string; gender: string }[] = [
  { file: 'character-male-a.glb', name: 'Male A (Explorer)', gender: 'Male' },
  { file: 'character-male-b.glb', name: 'Male B (Crafter)', gender: 'Male' },
  { file: 'character-male-c.glb', name: 'Male C (Planner)', gender: 'Male' },
  { file: 'character-male-d.glb', name: 'Male D', gender: 'Male' },
  { file: 'character-male-e.glb', name: 'Male E', gender: 'Male' },
  { file: 'character-male-f.glb', name: 'Male F', gender: 'Male' },
  { file: 'character-female-a.glb', name: 'Female A (Analyst)', gender: 'Female' },
  { file: 'character-female-b.glb', name: 'Female B (Fighter)', gender: 'Female' },
  { file: 'character-female-c.glb', name: 'Female C (Healer)', gender: 'Female' },
  { file: 'character-female-d.glb', name: 'Female D', gender: 'Female' },
  { file: 'character-female-e.glb', name: 'Female E', gender: 'Female' },
  { file: 'character-female-f.glb', name: 'Female F', gender: 'Female' },
];

// Movement settings
export const MOVE_SPEED = 3; // Units per second
export const DRAG_THRESHOLD = 5; // Pixels before considered a drag
export const CAMERA_SAVE_INTERVAL = 1000; // Save camera every 1 second

// Formation settings
export const FORMATION_SPACING = 1.2;
