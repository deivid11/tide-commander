/**
 * Theme definitions for Tide Commander
 *
 * Each theme defines CSS variable values that override the defaults in _variables.scss
 */

export type ThemeId = 'dracula' | 'muted' | 'muted-red' | 'nord' | 'solarized-dark' | 'monokai' | 'gruvbox' | 'atom' | 'cyberpunk' | 'synthwave' | 'abyss' | 'catppuccin' | 'github-dark' | 'one-dark' | 'classic';

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
  toolUseName: string;        // Tool name color (e.g., "BASH", "READ")
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

// Dracula - True to the original Dracula theme: vampire purple, fangs pink, blood red
// Signature: Deep purple background, iconic pink/cyan/green combo
const draculaTheme: Theme = {
  id: 'dracula',
  name: 'Dracula',
  description: 'Vampire purple with fangs pink',
  colors: {
    bgPrimary: '#282a36',              // True Dracula background
    bgSecondary: '#21222c',
    bgTertiary: '#343746',
    borderColor: '#44475a',            // Dracula comment color
    textPrimary: '#f8f8f2',            // True Dracula foreground
    textSecondary: '#bfbfbf',
    textMuted: '#6272a4',              // Dracula comment
    accentBlue: '#8be9fd',             // Dracula cyan
    accentGreen: '#50fa7b',            // Dracula green
    accentOrange: '#ffb86c',           // Dracula orange
    accentRed: '#ff5555',              // Dracula red
    accentPurple: '#bd93f9',           // Dracula purple
    accentCyan: '#8be9fd',             // Dracula cyan
    accentClaude: '#50fa7b',           // Green for Claude
    accentClaudeLight: '#69ff94',
    accentPink: '#ff79c6',             // Dracula pink
    accentYellow: '#f1fa8c',           // Dracula yellow
    // Messages: Purple user (iconic Dracula), pink assistant
    msgUserBg: 'rgba(189, 147, 249, 0.12)',    // Purple transparent
    msgUserBorder: '#bd93f9',
    msgUserText: '#bd93f9',
    msgAssistantBg: 'rgba(255, 121, 198, 0.12)', // Pink transparent
    msgAssistantBorder: '#ff79c6',
    msgAssistantText: '#ff79c6',
    // Tools: Orange/cyan combo (Dracula signature)
    toolUseBg: 'rgba(255, 184, 108, 0.08)',
    toolUseBorder: '#ffb86c',
    toolUseText: '#ffb86c',
    toolUseName: '#8be9fd',             // Cyan tool names
    toolResultBg: 'rgba(80, 250, 123, 0.08)',
    toolResultBorder: '#50fa7b',
    toolResultText: '#50fa7b',
    // Output line: Subtle purple tint
    outputLineBg: 'rgba(189, 147, 249, 0.04)',
    // Context stats: Iconic purple
    contextBarBg: 'rgba(189, 147, 249, 0.25)',
    contextBarFill: '#bd93f9',
  },
};

// Muted - Foggy morning aesthetic, like coding at dawn through frosted glass
// Signature: Very soft grays with gentle color hints, extremely easy on the eyes
const mutedTheme: Theme = {
  id: 'muted',
  name: 'Muted',
  description: 'Foggy dawn through frosted glass',
  colors: {
    bgPrimary: '#16181c',
    bgSecondary: '#1c1f24',
    bgTertiary: '#24282e',
    borderColor: '#33393f',
    textPrimary: '#c8ccd4',
    textSecondary: '#9099a4',
    textMuted: '#5c6670',
    accentBlue: '#7aa8c8',             // Soft steel blue
    accentGreen: '#8ab898',            // Sage green
    accentOrange: '#c8a878',           // Dusty gold
    accentRed: '#c88888',              // Rose
    accentPurple: '#a898b8',           // Lavender fog
    accentCyan: '#88b8c0',             // Mist cyan
    accentClaude: '#8ab898',
    accentClaudeLight: '#9ac8a8',
    accentPink: '#b898a8',             // Dusty rose
    accentYellow: '#c8c098',           // Pale wheat
    // Messages: Soft sage user, mist assistant
    msgUserBg: 'rgba(138, 184, 152, 0.06)',
    msgUserBorder: 'rgba(138, 184, 152, 0.3)',
    msgUserText: '#8ab898',
    msgAssistantBg: 'rgba(168, 152, 184, 0.06)',
    msgAssistantBorder: 'rgba(168, 152, 184, 0.3)',
    msgAssistantText: '#a898b8',
    // Tools: Dusty gold/mist cyan
    toolUseBg: 'rgba(200, 168, 120, 0.05)',
    toolUseBorder: 'rgba(200, 168, 120, 0.3)',
    toolUseText: '#c8a878',
    toolUseName: '#88b8c0',             // Cyan tool names
    toolResultBg: 'rgba(136, 184, 192, 0.05)',
    toolResultBorder: 'rgba(136, 184, 192, 0.3)',
    toolResultText: '#88b8c0',
    // Output line: Subtle fog
    outputLineBg: 'rgba(144, 153, 164, 0.03)',
    // Context stats: Soft lavender
    contextBarBg: 'rgba(168, 152, 184, 0.2)',
    contextBarFill: '#a898b8',
  },
};

// Rosewood - Aged wine cellar aesthetic, rich and luxurious
// Signature: Deep burgundy, rose gold accents, warm candlelight
const mutedRedTheme: Theme = {
  id: 'muted-red',
  name: 'Rosewood',
  description: 'Aged wine by candlelight',
  colors: {
    bgPrimary: '#1a1014',
    bgSecondary: '#221418',
    bgTertiary: '#2c1c20',
    borderColor: '#482830',
    textPrimary: '#f0e4e8',
    textSecondary: '#c8b0b8',
    textMuted: '#8c6878',
    accentBlue: '#8898c8',             // Dusty blue
    accentGreen: '#78a890',            // Eucalyptus
    accentOrange: '#d8a068',           // Amber candlelight
    accentRed: '#c85868',              // Wine red
    accentPurple: '#a878a0',           // Plum
    accentCyan: '#88a8b0',             // Dusty teal
    accentClaude: '#78a890',
    accentClaudeLight: '#88b8a0',
    accentPink: '#d88898',             // Rose gold
    accentYellow: '#d8c088',           // Champagne
    // Messages: Rose gold user, wine assistant
    msgUserBg: 'rgba(216, 136, 152, 0.10)',
    msgUserBorder: '#d88898',
    msgUserText: '#d88898',
    msgAssistantBg: 'rgba(200, 88, 104, 0.10)',
    msgAssistantBorder: '#c85868',
    msgAssistantText: '#c85868',
    // Tools: Candlelight amber/plum
    toolUseBg: 'rgba(216, 160, 104, 0.08)',
    toolUseBorder: '#d8a068',
    toolUseText: '#d8a068',
    toolUseName: '#d8c088',             // Champagne tool names
    toolResultBg: 'rgba(168, 120, 160, 0.08)',
    toolResultBorder: '#a878a0',
    toolResultText: '#a878a0',
    // Output line: Warm wine tint
    outputLineBg: 'rgba(200, 88, 104, 0.03)',
    // Context stats: Rose gold
    contextBarBg: 'rgba(216, 136, 152, 0.25)',
    contextBarFill: '#d88898',
  },
};

// Nord - True Nord palette: polar night, snow storm, aurora borealis
// Signature: Authentic Nord colors, icy blues and aurora dancing across the sky
const nordTheme: Theme = {
  id: 'nord',
  name: 'Nord',
  description: 'Polar night with aurora',
  colors: {
    bgPrimary: '#2e3440',              // Nord0 - Polar Night
    bgSecondary: '#3b4252',            // Nord1
    bgTertiary: '#434c5e',             // Nord2
    borderColor: '#4c566a',            // Nord3
    textPrimary: '#eceff4',            // Nord6 - Snow Storm
    textSecondary: '#d8dee9',          // Nord4
    textMuted: '#7b88a1',
    accentBlue: '#81a1c1',             // Nord9 - Frost
    accentGreen: '#a3be8c',            // Nord14 - Aurora
    accentOrange: '#d08770',           // Nord12 - Aurora
    accentRed: '#bf616a',              // Nord11 - Aurora
    accentPurple: '#b48ead',           // Nord15 - Aurora
    accentCyan: '#88c0d0',             // Nord8 - Frost
    accentClaude: '#a3be8c',
    accentClaudeLight: '#b3ce9c',
    accentPink: '#b48ead',
    accentYellow: '#ebcb8b',           // Nord13 - Aurora
    // Messages: Frost blue user, aurora green assistant
    msgUserBg: 'rgba(136, 192, 208, 0.10)',   // Frost cyan
    msgUserBorder: '#88c0d0',
    msgUserText: '#88c0d0',
    msgAssistantBg: 'rgba(163, 190, 140, 0.10)', // Aurora green
    msgAssistantBorder: '#a3be8c',
    msgAssistantText: '#a3be8c',
    // Tools: Aurora orange/purple
    toolUseBg: 'rgba(208, 135, 112, 0.08)',
    toolUseBorder: '#d08770',
    toolUseText: '#d08770',
    toolUseName: '#ebcb8b',             // Yellow tool names
    toolResultBg: 'rgba(180, 142, 173, 0.08)',
    toolResultBorder: '#b48ead',
    toolResultText: '#b48ead',
    // Output line: Polar night subtle
    outputLineBg: 'rgba(67, 76, 94, 0.3)',
    // Context stats: Frost blue
    contextBarBg: 'rgba(129, 161, 193, 0.25)',
    contextBarFill: '#81a1c1',
  },
};

// Solarized Dark - True Solarized: precision-engineered for reading
// Signature: Authentic Solarized colors, scientifically designed contrast
const solarizedDarkTheme: Theme = {
  id: 'solarized-dark',
  name: 'Solarized',
  description: 'Precision-engineered contrast',
  colors: {
    bgPrimary: '#002b36',              // Solarized base03
    bgSecondary: '#073642',            // Solarized base02
    bgTertiary: '#094652',
    borderColor: '#586e75',            // Solarized base01
    textPrimary: '#93a1a1',            // Solarized base1
    textSecondary: '#839496',          // Solarized base0
    textMuted: '#657b83',              // Solarized base00
    accentBlue: '#268bd2',             // Solarized blue
    accentGreen: '#859900',            // Solarized green (yellow-green)
    accentOrange: '#cb4b16',           // Solarized orange
    accentRed: '#dc322f',              // Solarized red
    accentPurple: '#6c71c4',           // Solarized violet
    accentCyan: '#2aa198',             // Solarized cyan
    accentClaude: '#859900',
    accentClaudeLight: '#95a910',
    accentPink: '#d33682',             // Solarized magenta
    accentYellow: '#b58900',           // Solarized yellow
    // Messages: Cyan user, green assistant
    msgUserBg: 'rgba(42, 161, 152, 0.12)',
    msgUserBorder: '#2aa198',
    msgUserText: '#2aa198',
    msgAssistantBg: 'rgba(133, 153, 0, 0.12)',
    msgAssistantBorder: '#859900',
    msgAssistantText: '#859900',
    // Tools: Orange/violet (solarized signature)
    toolUseBg: 'rgba(203, 75, 22, 0.10)',
    toolUseBorder: '#cb4b16',
    toolUseText: '#cb4b16',
    toolUseName: '#b58900',             // Yellow tool names
    toolResultBg: 'rgba(108, 113, 196, 0.10)',
    toolResultBorder: '#6c71c4',
    toolResultText: '#6c71c4',
    // Output line: Subtle teal
    outputLineBg: 'rgba(7, 54, 66, 0.5)',
    // Context stats: Solarized blue
    contextBarBg: 'rgba(38, 139, 210, 0.25)',
    contextBarFill: '#268bd2',
  },
};

// Monokai Pro - True Monokai: warm charcoal with neon highlights
// Signature: Iconic hot pink, electric lime, warm background
const monokaiTheme: Theme = {
  id: 'monokai',
  name: 'Monokai',
  description: 'Neon jungle on warm charcoal',
  colors: {
    bgPrimary: '#272822',              // True Monokai background
    bgSecondary: '#1e1f1a',
    bgTertiary: '#3e3d32',
    borderColor: '#49483e',            // Monokai comment
    textPrimary: '#f8f8f2',            // Monokai foreground
    textSecondary: '#cfcfc2',
    textMuted: '#75715e',              // Monokai comment
    accentBlue: '#66d9ef',             // Monokai blue
    accentGreen: '#a6e22e',            // Monokai green
    accentOrange: '#fd971f',           // Monokai orange
    accentRed: '#f92672',              // Monokai pink (used as red)
    accentPurple: '#ae81ff',           // Monokai purple
    accentCyan: '#66d9ef',
    accentClaude: '#a6e22e',
    accentClaudeLight: '#b6f23e',
    accentPink: '#f92672',             // Iconic Monokai pink
    accentYellow: '#e6db74',           // Monokai yellow
    // Messages: Hot pink user, electric lime assistant
    msgUserBg: 'rgba(249, 38, 114, 0.10)',
    msgUserBorder: '#f92672',
    msgUserText: '#f92672',
    msgAssistantBg: 'rgba(166, 226, 46, 0.10)',
    msgAssistantBorder: '#a6e22e',
    msgAssistantText: '#a6e22e',
    // Tools: Orange/purple Monokai style
    toolUseBg: 'rgba(253, 151, 31, 0.08)',
    toolUseBorder: '#fd971f',
    toolUseText: '#fd971f',
    toolUseName: '#66d9ef',             // Cyan tool names
    toolResultBg: 'rgba(174, 129, 255, 0.08)',
    toolResultBorder: '#ae81ff',
    toolResultText: '#ae81ff',
    // Output line: Warm charcoal
    outputLineBg: 'rgba(62, 61, 50, 0.3)',
    // Context stats: Hot pink
    contextBarBg: 'rgba(249, 38, 114, 0.25)',
    contextBarFill: '#f92672',
  },
};

// Gruvbox Dark - True Gruvbox: retro groove, coffee shop warmth
// Signature: Authentic Gruvbox colors, earthy and cozy
const gruvboxTheme: Theme = {
  id: 'gruvbox',
  name: 'Gruvbox',
  description: 'Retro coffee shop warmth',
  colors: {
    bgPrimary: '#282828',              // Gruvbox bg0
    bgSecondary: '#1d2021',            // Gruvbox bg0_h
    bgTertiary: '#3c3836',             // Gruvbox bg1
    borderColor: '#504945',            // Gruvbox bg3
    textPrimary: '#ebdbb2',            // Gruvbox fg
    textSecondary: '#d5c4a1',          // Gruvbox fg2
    textMuted: '#928374',              // Gruvbox gray
    accentBlue: '#83a598',             // Gruvbox blue
    accentGreen: '#b8bb26',            // Gruvbox green
    accentOrange: '#fe8019',           // Gruvbox orange
    accentRed: '#fb4934',              // Gruvbox red
    accentPurple: '#d3869b',           // Gruvbox purple
    accentCyan: '#8ec07c',             // Gruvbox aqua
    accentClaude: '#b8bb26',
    accentClaudeLight: '#c8cb36',
    accentPink: '#d3869b',
    accentYellow: '#fabd2f',           // Gruvbox yellow
    // Messages: Orange user, aqua assistant
    msgUserBg: 'rgba(254, 128, 25, 0.10)',
    msgUserBorder: '#fe8019',
    msgUserText: '#fe8019',
    msgAssistantBg: 'rgba(142, 192, 124, 0.10)',
    msgAssistantBorder: '#8ec07c',
    msgAssistantText: '#8ec07c',
    // Tools: Yellow/purple Gruvbox style
    toolUseBg: 'rgba(250, 189, 47, 0.08)',
    toolUseBorder: '#fabd2f',
    toolUseText: '#fabd2f',
    toolUseName: '#83a598',             // Blue tool names
    toolResultBg: 'rgba(211, 134, 155, 0.08)',
    toolResultBorder: '#d3869b',
    toolResultText: '#d3869b',
    // Output line: Earthy warmth
    outputLineBg: 'rgba(60, 56, 54, 0.4)',
    // Context stats: Gruvbox orange
    contextBarBg: 'rgba(254, 128, 25, 0.25)',
    contextBarFill: '#fe8019',
  },
};

// Atom - Space editor aesthetic, deep space with starlight accents
// Signature: Deep cosmic background, stellar highlights, space exploration feel
const atomTheme: Theme = {
  id: 'atom',
  name: 'Atom',
  description: 'Deep space exploration',
  colors: {
    bgPrimary: '#0c1014',              // Deep space black
    bgSecondary: '#121820',
    bgTertiary: '#1a222c',
    borderColor: '#283040',
    textPrimary: '#d8e0f0',            // Starlight white
    textSecondary: '#9ca8c0',
    textMuted: '#5a6880',
    accentBlue: '#5dade2',             // Nebula blue
    accentGreen: '#58d68d',            // Aurora green
    accentOrange: '#f0b060',           // Sun orange
    accentRed: '#ec7063',              // Mars red
    accentPurple: '#af7ac5',           // Nebula purple
    accentCyan: '#48c9b0',             // Comet cyan
    accentClaude: '#58d68d',
    accentClaudeLight: '#68e69d',
    accentPink: '#f1948a',             // Stellar pink
    accentYellow: '#f7dc6f',           // Solar yellow
    // Messages: Nebula blue user, aurora green assistant
    msgUserBg: 'rgba(93, 173, 226, 0.10)',
    msgUserBorder: '#5dade2',
    msgUserText: '#5dade2',
    msgAssistantBg: 'rgba(88, 214, 141, 0.10)',
    msgAssistantBorder: '#58d68d',
    msgAssistantText: '#58d68d',
    // Tools: Solar orange/nebula purple
    toolUseBg: 'rgba(240, 176, 96, 0.08)',
    toolUseBorder: '#f0b060',
    toolUseText: '#f0b060',
    toolUseName: '#48c9b0',             // Comet cyan tool names
    toolResultBg: 'rgba(175, 122, 197, 0.08)',
    toolResultBorder: '#af7ac5',
    toolResultText: '#af7ac5',
    // Output line: Deep space
    outputLineBg: 'rgba(26, 34, 44, 0.5)',
    // Context stats: Nebula purple
    contextBarBg: 'rgba(175, 122, 197, 0.25)',
    contextBarFill: '#af7ac5',
  },
};

// Cyberpunk - Neon noir dystopia, rain-soaked streets, holographic glitches
// Signature: Maximum contrast, glowing neons against void black, Blade Runner vibes
const cyberpunkTheme: Theme = {
  id: 'cyberpunk',
  name: 'Cyberpunk',
  description: 'Neon noir dystopia',
  colors: {
    bgPrimary: '#030308',              // Near-black void
    bgSecondary: '#08080f',
    bgTertiary: '#101018',
    borderColor: '#181828',
    textPrimary: '#e8e8ff',
    textSecondary: '#a0a0c8',
    textMuted: '#5050a0',
    accentBlue: '#00f0ff',             // Electric cyan (iconic)
    accentGreen: '#00ff9f',            // Toxic neon green
    accentOrange: '#ff6600',           // Warning orange
    accentRed: '#ff003c',              // Danger red
    accentPurple: '#bf00ff',           // Ultraviolet
    accentCyan: '#00f0ff',
    accentClaude: '#00ff9f',
    accentClaudeLight: '#50ffbf',
    accentPink: '#ff00aa',             // Hot magenta
    accentYellow: '#fff000',           // Hazard yellow
    // Messages: Hot magenta user, toxic green assistant (high contrast)
    msgUserBg: 'rgba(255, 0, 170, 0.12)',
    msgUserBorder: '#ff00aa',
    msgUserText: '#ff00aa',
    msgAssistantBg: 'rgba(0, 255, 159, 0.10)',
    msgAssistantBorder: '#00ff9f',
    msgAssistantText: '#00ff9f',
    // Tools: Ultraviolet/electric cyan
    toolUseBg: 'rgba(191, 0, 255, 0.10)',
    toolUseBorder: '#bf00ff',
    toolUseText: '#bf00ff',
    toolUseName: '#00f0ff',             // Electric cyan tool names
    toolResultBg: 'rgba(0, 240, 255, 0.08)',
    toolResultBorder: '#00f0ff',
    toolResultText: '#00f0ff',
    // Output line: Void with neon hint
    outputLineBg: 'rgba(191, 0, 255, 0.03)',
    // Context stats: Hot magenta
    contextBarBg: 'rgba(255, 0, 170, 0.30)',
    contextBarFill: '#ff00aa',
  },
};

// Synthwave - Retro 80s sunset over chrome grid horizon
// Signature: Purple gradient sky, sunset orange/pink, chrome blues, VHS aesthetic
const synthwaveTheme: Theme = {
  id: 'synthwave',
  name: 'Synthwave',
  description: 'Sunset over chrome horizon',
  colors: {
    bgPrimary: '#241b30',              // Purple twilight
    bgSecondary: '#1a1424',
    bgTertiary: '#2e2540',
    borderColor: '#4a3860',
    textPrimary: '#f8e8f8',
    textSecondary: '#c8a8d0',
    textMuted: '#7860a0',
    accentBlue: '#2de2e6',             // Chrome cyan
    accentGreen: '#0abdc6',            // Teal chrome
    accentOrange: '#ff9e64',           // Sunset orange
    accentRed: '#ff3864',              // Sunset red
    accentPurple: '#9d4edd',           // Vaporwave purple
    accentCyan: '#2de2e6',
    accentClaude: '#0abdc6',
    accentClaudeLight: '#2ad0d8',
    accentPink: '#f706cf',             // Hot neon pink
    accentYellow: '#fede5d',           // Sun gold
    // Messages: Neon pink user, chrome cyan assistant
    msgUserBg: 'rgba(247, 6, 207, 0.12)',
    msgUserBorder: '#f706cf',
    msgUserText: '#f706cf',
    msgAssistantBg: 'rgba(45, 226, 230, 0.10)',
    msgAssistantBorder: '#2de2e6',
    msgAssistantText: '#2de2e6',
    // Tools: Sunset orange/vaporwave purple
    toolUseBg: 'rgba(255, 158, 100, 0.10)',
    toolUseBorder: '#ff9e64',
    toolUseText: '#ff9e64',
    toolUseName: '#fede5d',             // Sun gold tool names
    toolResultBg: 'rgba(157, 78, 221, 0.10)',
    toolResultBorder: '#9d4edd',
    toolResultText: '#9d4edd',
    // Output line: Purple haze
    outputLineBg: 'rgba(157, 78, 221, 0.05)',
    // Context stats: Neon pink
    contextBarBg: 'rgba(247, 6, 207, 0.25)',
    contextBarFill: '#f706cf',
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
    toolUseName: '#e89050',
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

// Catppuccin Mocha - True Catppuccin: cozy pastel cafe vibes
// Signature: Authentic Catppuccin Mocha palette, warm and inviting
const catppuccinTheme: Theme = {
  id: 'catppuccin',
  name: 'Catppuccin',
  description: 'Cozy pastel mocha cafe',
  colors: {
    bgPrimary: '#1e1e2e',              // Catppuccin Base
    bgSecondary: '#181825',            // Catppuccin Mantle
    bgTertiary: '#313244',             // Catppuccin Surface0
    borderColor: '#45475a',            // Catppuccin Surface1
    textPrimary: '#cdd6f4',            // Catppuccin Text
    textSecondary: '#bac2de',          // Catppuccin Subtext1
    textMuted: '#6c7086',              // Catppuccin Overlay0
    accentBlue: '#89b4fa',             // Catppuccin Blue
    accentGreen: '#a6e3a1',            // Catppuccin Green
    accentOrange: '#fab387',           // Catppuccin Peach
    accentRed: '#f38ba8',              // Catppuccin Red
    accentPurple: '#cba6f7',           // Catppuccin Mauve
    accentCyan: '#94e2d5',             // Catppuccin Teal
    accentClaude: '#a6e3a1',
    accentClaudeLight: '#b6f3b1',
    accentPink: '#f5c2e7',             // Catppuccin Pink
    accentYellow: '#f9e2af',           // Catppuccin Yellow
    // Messages: Lavender user, teal assistant (cozy contrast)
    msgUserBg: 'rgba(180, 190, 254, 0.10)',    // Lavender
    msgUserBorder: '#b4befe',
    msgUserText: '#b4befe',
    msgAssistantBg: 'rgba(148, 226, 213, 0.10)', // Teal
    msgAssistantBorder: '#94e2d5',
    msgAssistantText: '#94e2d5',
    // Tools: Peach/mauve pastels
    toolUseBg: 'rgba(250, 179, 135, 0.08)',
    toolUseBorder: '#fab387',
    toolUseText: '#fab387',
    toolUseName: '#f9e2af',             // Yellow tool names
    toolResultBg: 'rgba(203, 166, 247, 0.08)',
    toolResultBorder: '#cba6f7',
    toolResultText: '#cba6f7',
    // Output line: Subtle surface
    outputLineBg: 'rgba(49, 50, 68, 0.4)',
    // Context stats: Pink
    contextBarBg: 'rgba(245, 194, 231, 0.25)',
    contextBarFill: '#f5c2e7',
  },
};

// GitHub Dark - Authentic GitHub Dark Default palette
// Signature: Professional, minimal, developer-focused
const githubDarkTheme: Theme = {
  id: 'github-dark',
  name: 'GitHub Dark',
  description: 'Developer professional minimal',
  colors: {
    bgPrimary: '#0d1117',              // GitHub canvas default
    bgSecondary: '#161b22',            // GitHub canvas subtle
    bgTertiary: '#21262d',             // GitHub canvas inset
    borderColor: '#30363d',            // GitHub border default
    textPrimary: '#c9d1d9',            // GitHub fg default
    textSecondary: '#8b949e',          // GitHub fg muted
    textMuted: '#484f58',              // GitHub fg subtle
    accentBlue: '#58a6ff',             // GitHub accent blue
    accentGreen: '#3fb950',            // GitHub success
    accentOrange: '#d29922',           // GitHub attention
    accentRed: '#f85149',              // GitHub danger
    accentPurple: '#a371f7',           // GitHub done purple
    accentCyan: '#79c0ff',             // GitHub accent cyan
    accentClaude: '#3fb950',
    accentClaudeLight: '#56d364',
    accentPink: '#f778ba',             // GitHub sponsors pink
    accentYellow: '#e3b341',           // GitHub highlight
    // Messages: Blue user (PR style), green assistant (merge style)
    msgUserBg: 'rgba(88, 166, 255, 0.08)',
    msgUserBorder: '#58a6ff',
    msgUserText: '#58a6ff',
    msgAssistantBg: 'rgba(63, 185, 80, 0.08)',
    msgAssistantBorder: '#3fb950',
    msgAssistantText: '#3fb950',
    // Tools: Attention orange/done purple
    toolUseBg: 'rgba(210, 153, 34, 0.08)',
    toolUseBorder: '#d29922',
    toolUseText: '#d29922',
    toolUseName: '#79c0ff',             // Cyan tool names
    toolResultBg: 'rgba(163, 113, 247, 0.08)',
    toolResultBorder: '#a371f7',
    toolResultText: '#a371f7',
    // Output line: Subtle inset
    outputLineBg: 'rgba(33, 38, 45, 0.5)',
    // Context stats: GitHub blue
    contextBarBg: 'rgba(88, 166, 255, 0.25)',
    contextBarFill: '#58a6ff',
  },
};

// One Dark Pro - Moonlit coding session, serene and focused
// Signature: Cool moonlit slate, balanced and refined, late night coding feel
const oneDarkTheme: Theme = {
  id: 'one-dark',
  name: 'One Dark',
  description: 'Moonlit late night coding',
  colors: {
    bgPrimary: '#282c34',              // One Dark background
    bgSecondary: '#21252b',
    bgTertiary: '#2c323c',
    borderColor: '#3e4451',
    textPrimary: '#abb2bf',            // One Dark foreground
    textSecondary: '#828997',
    textMuted: '#5c6370',              // One Dark comment
    accentBlue: '#61afef',             // One Dark blue
    accentGreen: '#98c379',            // One Dark green
    accentOrange: '#d19a66',           // One Dark dark yellow/orange
    accentRed: '#e06c75',              // One Dark red
    accentPurple: '#c678dd',           // One Dark magenta
    accentCyan: '#56b6c2',             // One Dark cyan
    accentClaude: '#98c379',
    accentClaudeLight: '#a8d389',
    accentPink: '#e06c75',             // Using red as pink
    accentYellow: '#e5c07b',           // One Dark yellow
    // Messages: Moonlit cyan user, forest green assistant
    msgUserBg: 'rgba(86, 182, 194, 0.10)',
    msgUserBorder: '#56b6c2',
    msgUserText: '#56b6c2',
    msgAssistantBg: 'rgba(152, 195, 121, 0.10)',
    msgAssistantBorder: '#98c379',
    msgAssistantText: '#98c379',
    // Tools: Orange glow/purple magic
    toolUseBg: 'rgba(209, 154, 102, 0.08)',
    toolUseBorder: '#d19a66',
    toolUseText: '#d19a66',
    toolUseName: '#e5c07b',             // Yellow tool names
    toolResultBg: 'rgba(198, 120, 221, 0.08)',
    toolResultBorder: '#c678dd',
    toolResultText: '#c678dd',
    // Output line: Moonlit slate
    outputLineBg: 'rgba(44, 50, 60, 0.5)',
    // Context stats: Blue moonlight
    contextBarBg: 'rgba(97, 175, 239, 0.25)',
    contextBarFill: '#61afef',
  },
};

// Classic - the original transparent style before the theme system
// Signature: Very dark background with transparent colored message blocks
const classicTheme: Theme = {
  id: 'classic',
  name: 'Classic',
  description: 'Original transparent style',
  colors: {
    bgPrimary: '#0d0d14',
    bgSecondary: '#14141e',
    bgTertiary: '#1c1c28',
    borderColor: '#2a2a3a',
    textPrimary: '#d0d0d8',
    textSecondary: '#8a8a98',
    textMuted: '#5a6a8a',
    accentBlue: '#5a8fd4',
    accentGreen: '#50fa7b',              // Bright green (Dracula-style)
    accentOrange: '#c89a5a',
    accentRed: '#c85a5a',
    accentPurple: '#9a80c0',
    accentCyan: '#8be9fd',               // Bright cyan (Dracula-style)
    accentClaude: '#50fa7b',             // Green for Claude
    accentClaudeLight: '#69ff94',
    accentPink: '#c87a9a',
    accentYellow: '#c8c87a',
    // Messages: Transparent backgrounds with specified colors
    msgUserBg: 'rgba(139, 233, 253, 0.12)',        // Cyan 12% transparent
    msgUserBorder: 'transparent',
    msgUserText: '#8be9fd',                         // Cyan for user role text
    msgAssistantBg: 'rgba(80, 250, 123, 0.12)',    // Green 12% transparent
    msgAssistantBorder: 'transparent',
    msgAssistantText: '#50fa7b',                    // Green for assistant role text
    // Tools: Transparent backgrounds with cyan text
    toolUseBg: 'rgba(255, 184, 108, 0.05)',        // Orange 5% transparent for tool use
    toolUseBorder: 'transparent',
    toolUseText: '#8be9fd',                         // Cyan for tool use text
    toolUseName: '#ffb86c',                         // Orange for tool name
    toolResultBg: 'rgba(80, 250, 123, 0.06)',      // Green 6% transparent
    toolResultBorder: 'transparent',
    toolResultText: '#50fa7b',                      // Green for tool result text
    // Output line: Transparent
    outputLineBg: 'transparent',
    // Context stats: Muted sage green
    contextBarBg: 'rgba(106, 154, 120, 0.25)',
    contextBarFill: '#6a9a78',
  },
};

// All available themes
export const themes: Theme[] = [
  classicTheme,      // Default - original transparent style
  abyssTheme,        // Ultra dark with vivid accents
  draculaTheme,
  mutedTheme,
  mutedRedTheme,     // Rosewood
  nordTheme,
  solarizedDarkTheme,
  monokaiTheme,
  gruvboxTheme,
  atomTheme,
  cyberpunkTheme,
  synthwaveTheme,
  catppuccinTheme,
  githubDarkTheme,
  oneDarkTheme,
];

// Get theme by ID
export function getTheme(id: ThemeId): Theme {
  return themes.find(t => t.id === id) || mutedTheme;
}

// Default theme
export const DEFAULT_THEME: ThemeId = 'classic';

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
  root.style.setProperty('--tool-use-name', colors.toolUseName);
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
