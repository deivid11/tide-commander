/**
 * Theme definitions for Tide Commander
 *
 * Each theme defines CSS variable values that override the defaults in _variables.scss
 */

export type ThemeId = 'dracula' | 'muted' | 'muted-red' | 'nord' | 'solarized-dark' | 'monokai' | 'gruvbox' | 'atom' | 'cyberpunk' | 'synthwave' | 'abyss';

export interface ThemeColors {
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  borderColor: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accentBlue: string;
  accentGreen: string;
  accentOrange: string;
  accentRed: string;
  accentPurple: string;
  accentCyan: string;
  accentClaude: string;       // Claude AI messages (warm/brown tones)
  accentClaudeLight: string;  // Claude AI label color
  // Markdown-specific colors for headers and emphasis
  accentPink: string;         // h1, table headers
  accentYellow: string;       // h5, emphasis
  // Message-specific colors (for creative theming)
  msgUserBg: string;          // User message background
  msgUserBorder: string;      // User message border
  msgUserText: string;        // User message text/label
  msgAssistantBg: string;     // Assistant message background
  msgAssistantBorder: string; // Assistant message border
  msgAssistantText: string;   // Assistant message text/label
  // Tool colors (creative per theme)
  toolUseBg: string;          // Tool use background
  toolUseBorder: string;      // Tool use border
  toolUseText: string;        // Tool use text/label
  toolResultBg: string;       // Tool result background
  toolResultBorder: string;   // Tool result border
  toolResultText: string;     // Tool result text/label
  // Output line background (for streaming output)
  outputLineBg: string;       // Background for output-line elements
  // Context stats colors
  contextBarBg: string;       // Context bar background
  contextBarFill: string;     // Context bar fill color (default, overridden by percent color)
}

export interface Theme {
  id: ThemeId;
  name: string;
  description: string;
  colors: ThemeColors;
}

// Dracula - the classic dark theme with purple personality
// Signature: Purple/pink accents, cool dark background
const draculaTheme: Theme = {
  id: 'dracula',
  name: 'Dracula',
  description: 'Classic purple-pink on charcoal',
  colors: {
    bgPrimary: '#1a1b26',
    bgSecondary: '#22232e',
    bgTertiary: '#2c2d3a',
    borderColor: '#3a3b4a',
    textPrimary: '#e8eaf0',
    textSecondary: '#b0b4c0',
    textMuted: '#7a7e90',
    accentBlue: '#8ab0d8',
    accentGreen: '#88c098',
    accentOrange: '#e0b070',
    accentRed: '#e08080',
    accentPurple: '#b0a0d8',
    accentCyan: '#80c0d0',
    accentClaude: '#88c098',
    accentClaudeLight: '#98d0a8',
    accentPink: '#d090b0',
    accentYellow: '#e0d090',
    // Messages: Purple user, pink assistant
    msgUserBg: '#2a2840',
    msgUserBorder: '#8080c0',
    msgUserText: '#a0a0e0',
    msgAssistantBg: '#302838',
    msgAssistantBorder: '#c080a0',
    msgAssistantText: '#e0a0c0',
    // Tools: Orange glow
    toolUseBg: '#302820',
    toolUseBorder: '#e0b070',
    toolUseText: '#f0c080',
    toolResultBg: '#282038',
    toolResultBorder: '#b0a0d8',
    toolResultText: '#c0b0e8',
    // Output line: Subtle purple tint
    outputLineBg: '#242030',
    // Context stats: Purple tint
    contextBarBg: 'rgba(176, 160, 216, 0.3)',
    contextBarFill: '#b0a0d8',
  },
};

// Muted theme (default - matches original SCSS $dracula-* colors)
const mutedTheme: Theme = {
  id: 'muted',
  name: 'Muted',
  description: 'Soft, low-contrast colors easy on the eyes',
  colors: {
    bgPrimary: '#0d0d14',
    bgSecondary: '#14141e',
    bgTertiary: '#1c1c28',
    borderColor: '#2a2a3a',
    textPrimary: '#d0d0d8',
    textSecondary: '#8a8a98',
    textMuted: '#5a6a8a',
    accentBlue: '#5a8fd4',
    accentGreen: '#5cb88a',
    accentOrange: '#c89a5a',
    accentRed: '#c85a5a',
    accentPurple: '#9a80c0',
    accentCyan: '#6ab8c8',
    accentClaude: '#a06848',
    accentClaudeLight: '#c8896a',
    accentPink: '#c87a9a',
    accentYellow: '#c8c87a',
    // Messages: Original cyan/green
    msgUserBg: '#162028',
    msgUserBorder: '#6ab8c8',
    msgUserText: '#8ad0e0',
    msgAssistantBg: '#182820',
    msgAssistantBorder: '#5cb88a',
    msgAssistantText: '#7cd0a0',
    // Tools: Warm orange/purple
    toolUseBg: '#201c18',
    toolUseBorder: '#c89a5a',
    toolUseText: '#e0b070',
    toolResultBg: '#1c1828',
    toolResultBorder: '#9a80c0',
    toolResultText: '#b090d0',
    // Output line: Deep navy
    outputLineBg: '#121620',
    // Context stats: Muted purple
    contextBarBg: 'rgba(154, 128, 192, 0.3)',
    contextBarFill: '#9a80c0',
  },
};

// Rosewood - warm crimson theme, cozy and bold
// Signature: Deep reds and warm pinks
const mutedRedTheme: Theme = {
  id: 'muted-red',
  name: 'Rosewood',
  description: 'Deep crimson warmth',
  colors: {
    bgPrimary: '#1a1215',
    bgSecondary: '#221a1c',
    bgTertiary: '#2e2426',
    borderColor: '#4a3538',
    textPrimary: '#f0e8ea',
    textSecondary: '#c0b0b4',
    textMuted: '#988088',
    accentBlue: '#70a0c8',
    accentGreen: '#70c090',
    accentOrange: '#e8a060',
    accentRed: '#e87070',
    accentPurple: '#c090c0',
    accentCyan: '#70c0c8',
    accentClaude: '#70c090',
    accentClaudeLight: '#80d0a0',
    accentPink: '#e080a0',
    accentYellow: '#e0c870',
    // Messages: Rose user, burgundy assistant
    msgUserBg: '#2a1820',
    msgUserBorder: '#c06080',
    msgUserText: '#e08090',
    msgAssistantBg: '#281820',
    msgAssistantBorder: '#a06060',
    msgAssistantText: '#c08080',
    // Tools: Gold/orchid
    toolUseBg: '#282018',
    toolUseBorder: '#e8a060',
    toolUseText: '#f0b878',
    toolResultBg: '#281828',
    toolResultBorder: '#c090c0',
    toolResultText: '#d0a0d0',
    // Output line: Warm burgundy tint
    outputLineBg: '#241418',
    // Context stats: Rose orchid
    contextBarBg: 'rgba(192, 144, 192, 0.3)',
    contextBarFill: '#c090c0',
  },
};

// Nord - icy arctic theme with blue personality
// Signature: Frost blues and aurora accents
const nordTheme: Theme = {
  id: 'nord',
  name: 'Nord',
  description: 'Arctic frost and aurora',
  colors: {
    bgPrimary: '#161a20',
    bgSecondary: '#1e2430',
    bgTertiary: '#28303c',
    borderColor: '#3a4450',
    textPrimary: '#e8f0f8',
    textSecondary: '#a8b8c8',
    textMuted: '#7888b0',
    accentBlue: '#5098d0',
    accentGreen: '#98d080',
    accentOrange: '#e09870',
    accentRed: '#d07078',
    accentPurple: '#b090d0',
    accentCyan: '#70c8e0',
    accentClaude: '#98d080',
    accentClaudeLight: '#a8e090',
    accentPink: '#c880b0',
    accentYellow: '#e8d070',
    // Messages: Frost blue user, aurora green assistant
    msgUserBg: '#182030',
    msgUserBorder: '#5098d0',
    msgUserText: '#88c0e8',
    msgAssistantBg: '#182820',
    msgAssistantBorder: '#70c080',
    msgAssistantText: '#90e098',
    // Tools: Aurora orange/purple
    toolUseBg: '#202018',
    toolUseBorder: '#e09870',
    toolUseText: '#f0b088',
    toolResultBg: '#201830',
    toolResultBorder: '#b090d0',
    toolResultText: '#c8a8e0',
    // Output line: Icy frost blue
    outputLineBg: '#1a2028',
    // Context stats: Frost blue
    contextBarBg: 'rgba(80, 152, 208, 0.3)',
    contextBarFill: '#5098d0',
  },
};

// Solarized - the scientific precision theme
// Signature: Deep teal background, vibrant accents
const solarizedDarkTheme: Theme = {
  id: 'solarized-dark',
  name: 'Solarized',
  description: 'Scientific teal precision',
  colors: {
    bgPrimary: '#002830',
    bgSecondary: '#003844',
    bgTertiary: '#004858',
    borderColor: '#186070',
    textPrimary: '#c0d0d0',
    textSecondary: '#90a0a0',
    textMuted: '#608080',
    accentBlue: '#2090d0',
    accentGreen: '#80a800',
    accentOrange: '#c86000',
    accentRed: '#d03030',
    accentPurple: '#7070c0',
    accentCyan: '#20a8a0',
    accentClaude: '#80a800',
    accentClaudeLight: '#90b810',
    accentPink: '#c03080',
    accentYellow: '#b09000',
    // Messages: Blue user, chartreuse assistant
    msgUserBg: '#003040',
    msgUserBorder: '#2090d0',
    msgUserText: '#50b0e0',
    msgAssistantBg: '#103018',
    msgAssistantBorder: '#80a800',
    msgAssistantText: '#a0c820',
    // Tools: Orange/violet (solarized signature)
    toolUseBg: '#102010',
    toolUseBorder: '#c86000',
    toolUseText: '#e08020',
    toolResultBg: '#101830',
    toolResultBorder: '#7070c0',
    toolResultText: '#9090d0',
    // Output line: Deep teal
    outputLineBg: '#003038',
    // Context stats: Teal cyan
    contextBarBg: 'rgba(32, 168, 160, 0.3)',
    contextBarFill: '#20a8a0',
  },
};

// Monokai - the iconic warm coding theme
// Signature: Hot pink, electric cyan, lime green
const monokaiTheme: Theme = {
  id: 'monokai',
  name: 'Monokai',
  description: 'Electric neon on warm black',
  colors: {
    bgPrimary: '#1a1a18',
    bgSecondary: '#242420',
    bgTertiary: '#30302a',
    borderColor: '#48483e',
    textPrimary: '#e8e8e0',
    textSecondary: '#b0b0a0',
    textMuted: '#808070',
    accentBlue: '#50c8e8',
    accentGreen: '#a0e020',
    accentOrange: '#f89020',
    accentRed: '#e82070',
    accentPurple: '#a080f0',
    accentCyan: '#50c8e8',
    accentClaude: '#a0e020',
    accentClaudeLight: '#b0f030',
    accentPink: '#e82070',
    accentYellow: '#e0d860',
    // Messages: Electric cyan user, lime assistant
    msgUserBg: '#182028',
    msgUserBorder: '#50c8e8',
    msgUserText: '#70e0f8',
    msgAssistantBg: '#202818',
    msgAssistantBorder: '#a0e020',
    msgAssistantText: '#c0f840',
    // Tools: Orange/purple neon
    toolUseBg: '#201810',
    toolUseBorder: '#f89020',
    toolUseText: '#ffa840',
    toolResultBg: '#181828',
    toolResultBorder: '#a080f0',
    toolResultText: '#c0a0ff',
    // Output line: Warm charcoal with yellow tint
    outputLineBg: '#1e1e1a',
    // Context stats: Electric cyan
    contextBarBg: 'rgba(80, 200, 232, 0.3)',
    contextBarFill: '#50c8e8',
  },
};

// Gruvbox - retro earthy warmth
// Signature: Creamy yellows, burnt orange, earthy reds
const gruvboxTheme: Theme = {
  id: 'gruvbox',
  name: 'Gruvbox',
  description: 'Retro cream and orange',
  colors: {
    bgPrimary: '#1c1816',
    bgSecondary: '#282420',
    bgTertiary: '#38322c',
    borderColor: '#504840',
    textPrimary: '#e8dcc8',
    textSecondary: '#c0b098',
    textMuted: '#908070',
    accentBlue: '#70a8a8',
    accentGreen: '#a8b820',
    accentOrange: '#e89020',
    accentRed: '#d85050',
    accentPurple: '#c088a0',
    accentCyan: '#70c0a0',
    accentClaude: '#a8b820',
    accentClaudeLight: '#b8c830',
    accentPink: '#c088a0',
    accentYellow: '#e8c820',
    // Messages: Orange user, lime-gold assistant
    msgUserBg: '#282018',
    msgUserBorder: '#e89020',
    msgUserText: '#f8a840',
    msgAssistantBg: '#242818',
    msgAssistantBorder: '#a8b820',
    msgAssistantText: '#c8d840',
    // Tools: Red/aqua (gruvbox signature)
    toolUseBg: '#281818',
    toolUseBorder: '#d85050',
    toolUseText: '#e87070',
    toolResultBg: '#182820',
    toolResultBorder: '#70c0a0',
    toolResultText: '#90d8b8',
    // Output line: Earthy brown tint
    outputLineBg: '#201c18',
    // Context stats: Earthy orange
    contextBarBg: 'rgba(232, 144, 32, 0.3)',
    contextBarFill: '#e89020',
  },
};

// Atom One Dark - clean modern dark theme
// Signature: Vibrant blue and green, clean
const atomTheme: Theme = {
  id: 'atom',
  name: 'Atom',
  description: 'Clean modern One Dark',
  colors: {
    bgPrimary: '#1a1d23',
    bgSecondary: '#21252b',
    bgTertiary: '#282c34',
    borderColor: '#3a3f4b',
    textPrimary: '#e0e4ec',
    textSecondary: '#abb2bf',
    textMuted: '#5c6370',
    accentBlue: '#61afef',
    accentGreen: '#98c379',
    accentOrange: '#d19a66',
    accentRed: '#e06c75',
    accentPurple: '#c678dd',
    accentCyan: '#56b6c2',
    accentClaude: '#98c379',
    accentClaudeLight: '#a8d389',
    accentPink: '#e06c75',
    accentYellow: '#e5c07b',
    // Messages: Blue user, green assistant
    msgUserBg: '#1c2530',
    msgUserBorder: '#61afef',
    msgUserText: '#81c8ff',
    msgAssistantBg: '#1c2820',
    msgAssistantBorder: '#98c379',
    msgAssistantText: '#b0d890',
    // Tools: Orange/purple (atom signature)
    toolUseBg: '#242018',
    toolUseBorder: '#d19a66',
    toolUseText: '#e8b080',
    toolResultBg: '#201828',
    toolResultBorder: '#c678dd',
    toolResultText: '#d890f0',
    // Output line: Clean slate blue
    outputLineBg: '#1e2128',
    // Context stats: Purple accent
    contextBarBg: 'rgba(198, 120, 221, 0.3)',
    contextBarFill: '#c678dd',
  },
};

// Cyberpunk - neon on deep dark, high contrast
// Signature: Electric cyan, hot magenta, toxic green
const cyberpunkTheme: Theme = {
  id: 'cyberpunk',
  name: 'Cyberpunk',
  description: 'Neon city nights',
  colors: {
    bgPrimary: '#0a0a12',
    bgSecondary: '#12121c',
    bgTertiary: '#1a1a28',
    borderColor: '#2a2a40',
    textPrimary: '#f0f0ff',
    textSecondary: '#b0b0d0',
    textMuted: '#6060a0',
    accentBlue: '#00d4ff',
    accentGreen: '#00ff88',
    accentOrange: '#ff8800',
    accentRed: '#ff0066',
    accentPurple: '#a855f7',
    accentCyan: '#00d4ff',
    accentClaude: '#00ff88',
    accentClaudeLight: '#40ffa0',
    accentPink: '#ff0066',
    accentYellow: '#ffee00',
    // Messages: Electric cyan user, toxic green assistant
    msgUserBg: '#0a1820',
    msgUserBorder: '#00d4ff',
    msgUserText: '#40e8ff',
    msgAssistantBg: '#0a200a',
    msgAssistantBorder: '#00ff88',
    msgAssistantText: '#40ffa0',
    // Tools: Hot orange/electric purple
    toolUseBg: '#181008',
    toolUseBorder: '#ff8800',
    toolUseText: '#ffa030',
    toolResultBg: '#100820',
    toolResultBorder: '#a855f7',
    toolResultText: '#c080ff',
    // Output line: Deep neon void
    outputLineBg: '#0c0c18',
    // Context stats: Electric cyan
    contextBarBg: 'rgba(0, 212, 255, 0.3)',
    contextBarFill: '#00d4ff',
  },
};

// Synthwave - retro 80s neon, warm pinks and blues
// Signature: Hot pink, sunset orange, electric blue
const synthwaveTheme: Theme = {
  id: 'synthwave',
  name: 'Synthwave',
  description: 'Retro 80s sunset vibes',
  colors: {
    bgPrimary: '#1a1020',
    bgSecondary: '#241830',
    bgTertiary: '#2e2040',
    borderColor: '#402850',
    textPrimary: '#fff0f8',
    textSecondary: '#c0a0b8',
    textMuted: '#806080',
    accentBlue: '#00b8ff',
    accentGreen: '#00e890',
    accentOrange: '#ff6830',
    accentRed: '#ff2080',
    accentPurple: '#b040ff',
    accentCyan: '#00e0d0',
    accentClaude: '#00e890',
    accentClaudeLight: '#40f0a0',
    accentPink: '#ff2080',
    accentYellow: '#ffe040',
    // Messages: Hot pink user, aqua assistant
    msgUserBg: '#281028',
    msgUserBorder: '#ff2080',
    msgUserText: '#ff50a0',
    msgAssistantBg: '#102028',
    msgAssistantBorder: '#00e0d0',
    msgAssistantText: '#40f0e0',
    // Tools: Sunset orange/bright purple
    toolUseBg: '#201810',
    toolUseBorder: '#ff6830',
    toolUseText: '#ff8850',
    toolResultBg: '#181030',
    toolResultBorder: '#b040ff',
    toolResultText: '#c860ff',
    // Output line: Retro purple haze
    outputLineBg: '#1c1428',
    // Context stats: Hot pink
    contextBarBg: 'rgba(255, 32, 128, 0.3)',
    contextBarFill: '#ff2080',
  },
};

// Abyss - ultra dark with vibrant accents
// Signature: Deep black backgrounds, bright saturated colors pop
const abyssTheme: Theme = {
  id: 'abyss',
  name: 'Abyss',
  description: 'Deep black, vivid accents',
  colors: {
    bgPrimary: '#080a0c',
    bgSecondary: '#0c0e12',
    bgTertiary: '#12161a',
    borderColor: '#1c2028',
    textPrimary: '#a8b0b8',
    textSecondary: '#889098',
    textMuted: '#505860',
    accentBlue: '#4da8da',
    accentGreen: '#50c878',
    accentOrange: '#e89050',
    accentRed: '#e85050',
    accentPurple: '#a070d8',
    accentCyan: '#50d0d0',
    accentClaude: '#50c878',
    accentClaudeLight: '#68e090',
    accentPink: '#e070a0',
    accentYellow: '#e8d050',
    // Messages: Blue user, green assistant - eye friendly text, transparent borders
    msgUserBg: '#0b0b0b',
    msgUserBorder: 'transparent',
    msgUserText: '#98a0a8',
    msgAssistantBg: '#1B1C25',
    msgAssistantBorder: 'transparent',
    msgAssistantText: '#98a0a8',
    // Tools: Bright orange/purple on dark, using textSecondary
    toolUseBg: '#1B1C25',
    toolUseBorder: '#e89050',
    toolUseText: '#98a0a8',
    toolResultBg: '#1B1C25',
    toolResultBorder: '#a070d8',
    toolResultText: '#98a0a8',
    // Output line: Deep void
    outputLineBg: '#0a0c10',
    // Context stats: Dark muted for abyss
    contextBarBg: 'rgba(80, 88, 96, 0.3)',
    contextBarFill: '#606870',
  },
};

// All available themes
export const themes: Theme[] = [
  draculaTheme,      // Default
  mutedTheme,
  mutedRedTheme,     // Rosewood
  nordTheme,
  solarizedDarkTheme,
  monokaiTheme,
  gruvboxTheme,
  atomTheme,
  cyberpunkTheme,
  synthwaveTheme,
  abyssTheme,
];

// Get theme by ID
export function getTheme(id: ThemeId): Theme {
  return themes.find(t => t.id === id) || mutedTheme;
}

// Default theme
export const DEFAULT_THEME: ThemeId = 'dracula';

// Apply theme to document (sets CSS variables)
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const { colors } = theme;

  root.style.setProperty('--bg-primary', colors.bgPrimary);
  root.style.setProperty('--bg-secondary', colors.bgSecondary);
  root.style.setProperty('--bg-tertiary', colors.bgTertiary);
  root.style.setProperty('--border-color', colors.borderColor);
  root.style.setProperty('--text-primary', colors.textPrimary);
  root.style.setProperty('--text-secondary', colors.textSecondary);
  root.style.setProperty('--text-muted', colors.textMuted);
  root.style.setProperty('--accent-blue', colors.accentBlue);
  root.style.setProperty('--accent-green', colors.accentGreen);
  root.style.setProperty('--accent-orange', colors.accentOrange);
  root.style.setProperty('--accent-red', colors.accentRed);
  root.style.setProperty('--accent-purple', colors.accentPurple);
  root.style.setProperty('--accent-cyan', colors.accentCyan);
  root.style.setProperty('--accent-claude', colors.accentClaude);
  root.style.setProperty('--accent-claude-light', colors.accentClaudeLight);
  root.style.setProperty('--accent-pink', colors.accentPink);
  root.style.setProperty('--accent-yellow', colors.accentYellow);
  // Message colors
  root.style.setProperty('--msg-user-bg', colors.msgUserBg);
  root.style.setProperty('--msg-user-border', colors.msgUserBorder);
  root.style.setProperty('--msg-user-text', colors.msgUserText);
  root.style.setProperty('--msg-assistant-bg', colors.msgAssistantBg);
  root.style.setProperty('--msg-assistant-border', colors.msgAssistantBorder);
  root.style.setProperty('--msg-assistant-text', colors.msgAssistantText);
  // Tool colors
  root.style.setProperty('--tool-use-bg', colors.toolUseBg);
  root.style.setProperty('--tool-use-border', colors.toolUseBorder);
  root.style.setProperty('--tool-use-text', colors.toolUseText);
  root.style.setProperty('--tool-result-bg', colors.toolResultBg);
  root.style.setProperty('--tool-result-border', colors.toolResultBorder);
  root.style.setProperty('--tool-result-text', colors.toolResultText);
  // Output line background
  root.style.setProperty('--output-line-bg', colors.outputLineBg);
  // Context stats colors
  root.style.setProperty('--context-bar-bg', colors.contextBarBg);
  root.style.setProperty('--context-bar-fill', colors.contextBarFill);

  // Store in localStorage
  try {
    localStorage.setItem('tide-theme', theme.id);
  } catch {
    // localStorage not available
  }
}

// Get saved theme from localStorage
export function getSavedTheme(): ThemeId {
  try {
    const saved = localStorage.getItem('tide-theme');
    if (saved && themes.some(t => t.id === saved)) {
      return saved as ThemeId;
    }
  } catch {
    // localStorage not available
  }
  return DEFAULT_THEME;
}

// Initialize theme on page load
export function initializeTheme(): void {
  const themeId = getSavedTheme();
  const theme = getTheme(themeId);
  applyTheme(theme);
}
