/**
 * Theme definitions for Tide Commander
 *
 * Each theme defines CSS variable values that override the defaults in _variables.scss
 *
 * NOTE: Theme ids are stable storage keys (persisted in localStorage as 'tide-theme').
 * Several themes were redesigned with new identities but keep their legacy id so
 * saved user preferences continue to resolve.
 */

export type ThemeId = 'dracula' | 'muted' | 'muted-red' | 'nord' | 'solarized-dark' | 'monokai' | 'gruvbox' | 'atom' | 'cyberpunk' | 'synthwave' | 'abyss' | 'obsidian-bloom' | 'catppuccin' | 'github-dark' | 'one-dark' | 'midnight-harbor' | 'ember-noir' | 'classic';

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
  msgUserHighlightBg?: string;// Optional normal outgoing message background
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
  // Task label color (overview panel)
  taskLabelColor: string;     // Color for agent task label text in overview
}

export interface Theme {
  id: ThemeId;
  name: string;
  description: string;
  colors: ThemeColors;
}

// Bloodmoon - gothic crimson night, a cathedral lit by candles under a red moon
// Signature: black-red backgrounds, crimson user, antique-gold assistant, cold moonlight tools
const bloodmoonTheme: Theme = {
  id: 'dracula', // legacy id, kept for saved preferences
  name: 'Bloodmoon',
  description: 'Gothic crimson and antique gold',
  colors: {
    bgPrimary: '#120a0c',              // Black with dried-blood undertone
    bgSecondary: '#1a0f12',
    bgTertiary: '#241418',
    borderColor: '#3d1f26',
    textPrimary: '#ecdfe2',            // Bone white
    textSecondary: '#bd9fa8',
    textMuted: '#7a5a64',
    accentBlue: '#7a9cc9',             // Cold moonlight
    accentGreen: '#7ab88a',            // Graveyard moss
    accentOrange: '#d98a4a',           // Candle flame
    accentRed: '#e03e52',              // Crimson (signature)
    accentPurple: '#a878c9',           // Twilight violet
    accentCyan: '#6ab5bd',             // Mist
    accentClaude: '#c9a227',           // Antique gold Claude
    accentClaudeLight: '#e0be4a',
    accentPink: '#e06a88',             // Rose thorn
    accentYellow: '#d9b84a',           // Old gold
    // Messages: crimson user, antique-gold assistant
    msgUserBg: 'rgba(224, 62, 82, 0.10)',
    msgUserBorder: '#e03e52',
    msgUserText: '#e8697a',
    msgAssistantBg: 'rgba(201, 162, 39, 0.08)',
    msgAssistantBorder: '#c9a227',
    msgAssistantText: '#d9b84a',
    // Tools: warm candlelight use, cold moonlight result
    toolUseBg: 'rgba(217, 138, 74, 0.08)',
    toolUseBorder: '#d98a4a',
    toolUseText: '#d98a4a',
    toolUseName: '#e0be4a',
    toolResultBg: 'rgba(122, 156, 201, 0.07)',
    toolResultBorder: '#7a9cc9',
    toolResultText: '#9ab5d9',
    // Output line: faint blood tint
    outputLineBg: 'rgba(224, 62, 82, 0.03)',
    // Context stats: crimson
    contextBarBg: 'rgba(224, 62, 82, 0.22)',
    contextBarFill: '#e03e52',
    taskLabelColor: '#d9b84a',            // Old gold
  },
};

// Sumi - ink-wash calligraphy on warm paper, restraint with one vermilion seal stamp
// Signature: warm ink charcoal, rice-paper text, vermilion as the only loud color
const sumiTheme: Theme = {
  id: 'muted', // legacy id, kept for saved preferences
  name: 'Sumi',
  description: 'Ink wash with a vermilion seal',
  colors: {
    bgPrimary: '#161412',              // Warm ink black
    bgSecondary: '#1c1a17',
    bgTertiary: '#26231f',
    borderColor: '#3a352e',
    textPrimary: '#ddd6c9',            // Rice paper
    textSecondary: '#a89f8f',
    textMuted: '#6b6455',
    accentBlue: '#7d9aa8',             // Faded indigo ink
    accentGreen: '#8aa87d',            // Bamboo
    accentOrange: '#cf7d54',           // Persimmon
    accentRed: '#d4553b',              // Vermilion (signature)
    accentPurple: '#9a8aa8',           // Wisteria gray
    accentCyan: '#7da8a0',             // Celadon
    accentClaude: '#8aa87d',
    accentClaudeLight: '#9dbb8f',
    accentPink: '#bd8a8f',             // Faded plum
    accentYellow: '#c9b06b',           // Dry gold leaf
    // Messages: quiet ink-stroke user, vermilion-seal assistant
    msgUserBg: 'rgba(221, 214, 201, 0.05)',
    msgUserBorder: '#6b6455',
    msgUserText: '#c9c2b3',
    msgAssistantBg: 'rgba(212, 85, 59, 0.07)',
    msgAssistantBorder: '#d4553b',
    msgAssistantText: '#dd7a5f',
    // Tools: indigo-ink use, bamboo result
    toolUseBg: 'rgba(125, 154, 168, 0.06)',
    toolUseBorder: 'rgba(125, 154, 168, 0.35)',
    toolUseText: '#9ab3bd',
    toolUseName: '#c9b06b',
    toolResultBg: 'rgba(138, 168, 125, 0.06)',
    toolResultBorder: 'rgba(138, 168, 125, 0.35)',
    toolResultText: '#a3bd96',
    // Output line: barely-there paper grain
    outputLineBg: 'rgba(221, 214, 201, 0.02)',
    // Context stats: vermilion
    contextBarBg: 'rgba(212, 85, 59, 0.20)',
    contextBarFill: '#d4553b',
    taskLabelColor: '#d4553b',            // Vermilion seal
  },
};

// Verdigris - oxidized copper and brass, a machine slowly turning green with age
// Signature: dark bronze base, patina-teal vs copper-glow duality
const verdigrisTheme: Theme = {
  id: 'muted-red', // legacy id, kept for saved preferences
  name: 'Verdigris',
  description: 'Oxidized copper and patina',
  colors: {
    bgPrimary: '#12100c',              // Dark aged bronze
    bgSecondary: '#191610',
    bgTertiary: '#232016',
    borderColor: '#3d3626',
    textPrimary: '#e0d9c9',            // Polished brass light
    textSecondary: '#b3a98f',
    textMuted: '#7a7159',
    accentBlue: '#6b9ab3',             // Steel blue
    accentGreen: '#5fae8a',            // Patina green
    accentOrange: '#d98d4f',           // Copper glow (signature)
    accentRed: '#c96b54',              // Rust
    accentPurple: '#9d86ad',           // Tarnish violet
    accentCyan: '#4fae9d',             // Verdigris teal (signature)
    accentClaude: '#4fae9d',
    accentClaudeLight: '#6bc9b8',
    accentPink: '#c98a93',             // Copper rose
    accentYellow: '#d4b45f',           // Brass
    // Messages: copper user, patina assistant
    msgUserBg: 'rgba(217, 141, 79, 0.09)',
    msgUserBorder: '#b8763d',
    msgUserText: '#d99d63',
    msgAssistantBg: 'rgba(79, 174, 157, 0.09)',
    msgAssistantBorder: '#4fae9d',
    msgAssistantText: '#6bc9b8',
    // Tools: brass use, oxide-green result
    toolUseBg: 'rgba(212, 180, 95, 0.07)',
    toolUseBorder: '#8a7a3d',
    toolUseText: '#d4b45f',
    toolUseName: '#4fae9d',
    toolResultBg: 'rgba(95, 174, 138, 0.07)',
    toolResultBorder: '#3d7a63',
    toolResultText: '#7abd9d',
    // Output line: faint patina film
    outputLineBg: 'rgba(79, 174, 157, 0.03)',
    // Context stats: copper
    contextBarBg: 'rgba(217, 141, 79, 0.22)',
    contextBarFill: '#d98d4f',
    taskLabelColor: '#d4b45f',            // Brass
  },
};

// Glacier - arctic ice shelf at blue hour, cold water under a low sun
// Signature: deep glacial blue-black, luminous ice cyan, one warm low-sun gold
const glacierTheme: Theme = {
  id: 'nord', // legacy id, kept for saved preferences
  name: 'Glacier',
  description: 'Arctic ice under a low sun',
  colors: {
    bgPrimary: '#081018',              // Deep glacial water
    bgSecondary: '#0d1620',
    bgTertiary: '#142230',
    borderColor: '#24384a',
    textPrimary: '#e3edf5',            // Fresh snow
    textSecondary: '#a9c0d1',
    textMuted: '#648599',
    accentBlue: '#6db3e8',             // Crevasse blue
    accentGreen: '#7dd6b3',            // Aurora mint
    accentOrange: '#e8b46d',           // Low winter sun
    accentRed: '#e87d8a',              // Alpenglow
    accentPurple: '#9aa8f0',           // Icy periwinkle
    accentCyan: '#7de3f0',             // Ice (signature)
    accentClaude: '#7dd6b3',
    accentClaudeLight: '#9de8c9',
    accentPink: '#d69ac0',             // Polar dusk
    accentYellow: '#f0dc9a',           // Pale sunlight
    // Messages: ice-cyan user, snow-white assistant
    msgUserBg: 'rgba(125, 227, 240, 0.08)',
    msgUserBorder: '#7de3f0',
    msgUserText: '#a3ecf5',
    msgAssistantBg: 'rgba(227, 237, 245, 0.06)',
    msgAssistantBorder: '#8fb3cc',
    msgAssistantText: '#cfe0ed',
    // Tools: low-sun gold use, periwinkle result
    toolUseBg: 'rgba(232, 180, 109, 0.07)',
    toolUseBorder: '#e8b46d',
    toolUseText: '#edc68f',
    toolUseName: '#7de3f0',
    toolResultBg: 'rgba(154, 168, 240, 0.07)',
    toolResultBorder: '#9aa8f0',
    toolResultText: '#b3bdf3',
    // Output line: deep water layer
    outputLineBg: 'rgba(20, 34, 48, 0.5)',
    // Context stats: ice cyan
    contextBarBg: 'rgba(125, 227, 240, 0.20)',
    contextBarFill: '#7de3f0',
    taskLabelColor: '#e8b46d',            // Low sun
  },
};

// Ukiyo - Japanese woodblock print: prussian-blue wave, washi cream, ochre and torii red
// Signature: prussian blue base with warm paper text, printmaker's restrained palette
const ukiyoTheme: Theme = {
  id: 'solarized-dark', // legacy id, kept for saved preferences
  name: 'Ukiyo',
  description: 'Woodblock wave in prussian blue',
  colors: {
    bgPrimary: '#0c1b26',              // Prussian blue depth
    bgSecondary: '#10222f',
    bgTertiary: '#16303f',
    borderColor: '#2a4a5d',
    textPrimary: '#ede4d1',            // Washi cream
    textSecondary: '#bfae90',
    textMuted: '#6d7f86',
    accentBlue: '#4a90bd',             // The wave (signature)
    accentGreen: '#7aa86b',            // Matcha
    accentOrange: '#d9884a',           // Persimmon
    accentRed: '#c94f4f',              // Torii red
    accentPurple: '#8a7aad',           // Mountain haze
    accentCyan: '#5fb3a8',             // Seafoam
    accentClaude: '#7aa86b',
    accentClaudeLight: '#93bd85',
    accentPink: '#c9829a',             // Sakura
    accentYellow: '#d9a83d',           // Ochre
    // Messages: wave-blue user, washi-cream assistant
    msgUserBg: 'rgba(74, 144, 189, 0.10)',
    msgUserBorder: '#4a90bd',
    msgUserText: '#74aad1',
    msgAssistantBg: 'rgba(237, 228, 209, 0.05)',
    msgAssistantBorder: '#8f8368',
    msgAssistantText: '#d9cdb3',
    // Tools: ochre use, seafoam result
    toolUseBg: 'rgba(217, 168, 61, 0.07)',
    toolUseBorder: '#d9a83d',
    toolUseText: '#d9b45f',
    toolUseName: '#5fb3a8',
    toolResultBg: 'rgba(95, 179, 168, 0.07)',
    toolResultBorder: '#5fb3a8',
    toolResultText: '#7ac4b8',
    // Output line: deep water print layer
    outputLineBg: 'rgba(16, 34, 47, 0.5)',
    // Context stats: prussian wave
    contextBarBg: 'rgba(74, 144, 189, 0.22)',
    contextBarFill: '#4a90bd',
    taskLabelColor: '#d9a83d',            // Ochre
  },
};

// Magma - basalt fields and lava flows, heat cracking through black stone
// Signature: warm basalt charcoal, lava orange and molten gold against cool ash
const magmaTheme: Theme = {
  id: 'monokai', // legacy id, kept for saved preferences
  name: 'Magma',
  description: 'Lava veins through black basalt',
  colors: {
    bgPrimary: '#100c0a',              // Cooled basalt
    bgSecondary: '#171210',
    bgTertiary: '#211a16',
    borderColor: '#3a2c22',
    textPrimary: '#ede3da',            // Pale ash
    textSecondary: '#b8a496',
    textMuted: '#75655a',
    accentBlue: '#6d9ec9',             // Heat-shimmer blue
    accentGreen: '#9db34f',            // Sulfur green
    accentOrange: '#f57626',           // Lava (signature)
    accentRed: '#e84d33',              // Molten fissure
    accentPurple: '#9d7aa8',           // Volcanic glass
    accentCyan: '#5fadb3',             // Steam vent
    accentClaude: '#e8a53d',           // Molten gold Claude
    accentClaudeLight: '#f5bd5f',
    accentPink: '#d9756d',             // Ember coral
    accentYellow: '#f5c542',           // Molten gold
    // Messages: cool ash user, lava assistant
    msgUserBg: 'rgba(237, 227, 218, 0.05)',
    msgUserBorder: '#75655a',
    msgUserText: '#cbbcae',
    msgAssistantBg: 'rgba(245, 118, 38, 0.09)',
    msgAssistantBorder: '#f57626',
    msgAssistantText: '#f5934f',
    // Tools: molten-gold use, heat-shimmer result
    toolUseBg: 'rgba(245, 197, 66, 0.07)',
    toolUseBorder: '#a8862e',
    toolUseText: '#f5c542',
    toolUseName: '#e84d33',
    toolResultBg: 'rgba(109, 158, 201, 0.06)',
    toolResultBorder: '#3d5a75',
    toolResultText: '#8fb3d1',
    // Output line: heat glow under the crust
    outputLineBg: 'rgba(232, 77, 51, 0.03)',
    // Context stats: lava
    contextBarBg: 'rgba(245, 118, 38, 0.24)',
    contextBarFill: '#f57626',
    taskLabelColor: '#f5c542',            // Molten gold
  },
};

// Terracotta - desert canyon at dusk: fired clay, sandstone, turquoise sky
// Signature: espresso-clay base, terracotta orange against southwest turquoise
const terracottaTheme: Theme = {
  id: 'gruvbox', // legacy id, kept for saved preferences
  name: 'Terracotta',
  description: 'Desert clay and turquoise',
  colors: {
    bgPrimary: '#171009',              // Canyon shadow
    bgSecondary: '#1f150c',
    bgTertiary: '#2a1d12',
    borderColor: '#46311f',
    textPrimary: '#f0e0cd',            // Sun-bleached sand
    textSecondary: '#c9ad8f',
    textMuted: '#8a6f56',
    accentBlue: '#6d9ab3',             // Dusk sky
    accentGreen: '#8fa86b',            // Agave
    accentOrange: '#e08d47',           // Fired clay (signature)
    accentRed: '#cf5f45',              // Canyon red
    accentPurple: '#ad7d93',           // Desert bloom
    accentCyan: '#56b3a3',             // Turquoise (signature)
    accentClaude: '#8fa86b',
    accentClaudeLight: '#a3bd7f',
    accentPink: '#d98a75',             // Adobe rose
    accentYellow: '#e0b45f',           // Sandstone
    // Messages: turquoise user, clay assistant
    msgUserBg: 'rgba(86, 179, 163, 0.09)',
    msgUserBorder: '#56b3a3',
    msgUserText: '#74c4b5',
    msgAssistantBg: 'rgba(224, 141, 71, 0.09)',
    msgAssistantBorder: '#e08d47',
    msgAssistantText: '#e8a36b',
    // Tools: sandstone use, desert-bloom result
    toolUseBg: 'rgba(224, 180, 95, 0.07)',
    toolUseBorder: '#a3823d',
    toolUseText: '#e0b45f',
    toolUseName: '#56b3a3',
    toolResultBg: 'rgba(173, 125, 147, 0.07)',
    toolResultBorder: '#ad7d93',
    toolResultText: '#c299ad',
    // Output line: canyon shadow layer
    outputLineBg: 'rgba(42, 29, 18, 0.5)',
    // Context stats: fired clay
    contextBarBg: 'rgba(224, 141, 71, 0.22)',
    contextBarFill: '#e08d47',
    taskLabelColor: '#e0b45f',            // Sandstone
  },
};

// Observatory - brass telescope over indigo star charts, an astronomer's night desk
// Signature: deep indigo-navy, star-chart blue paired with warm instrument brass
const observatoryTheme: Theme = {
  id: 'atom', // legacy id, kept for saved preferences
  name: 'Observatory',
  description: 'Star charts and telescope brass',
  colors: {
    bgPrimary: '#0a0d1a',              // Indigo night
    bgSecondary: '#0f1322',
    bgTertiary: '#171d33',
    borderColor: '#2b3352',
    textPrimary: '#e0e4f0',            // Starlight
    textSecondary: '#a8b0cc',
    textMuted: '#656f94',
    accentBlue: '#7d93e0',             // Star chart (signature)
    accentGreen: '#7dc9a3',            // Meridian green
    accentOrange: '#e0a55f',           // Lamp glow
    accentRed: '#d96b7a',              // Red giant
    accentPurple: '#a88de0',           // Nebula
    accentCyan: '#6bc9d9',             // Comet tail
    accentClaude: '#d9a54a',           // Instrument brass Claude
    accentClaudeLight: '#e8bd74',
    accentPink: '#d98ab8',             // Distant nebula
    accentYellow: '#e8cf7d',           // Star gold
    // Messages: star-blue user, brass assistant
    msgUserBg: 'rgba(125, 147, 224, 0.10)',
    msgUserBorder: '#7d93e0',
    msgUserText: '#9dade8',
    msgAssistantBg: 'rgba(217, 165, 74, 0.08)',
    msgAssistantBorder: '#d9a54a',
    msgAssistantText: '#e0b86b',
    // Tools: comet use, nebula result
    toolUseBg: 'rgba(107, 201, 217, 0.07)',
    toolUseBorder: '#6bc9d9',
    toolUseText: '#8fd6e0',
    toolUseName: '#e8cf7d',
    toolResultBg: 'rgba(168, 141, 224, 0.07)',
    toolResultBorder: '#a88de0',
    toolResultText: '#bda6e8',
    // Output line: deep chart layer
    outputLineBg: 'rgba(23, 29, 51, 0.5)',
    // Context stats: star blue
    contextBarBg: 'rgba(125, 147, 224, 0.22)',
    contextBarFill: '#7d93e0',
    taskLabelColor: '#e8cf7d',            // Star gold
  },
};

// Night Market - neon signage over a rain-slick Kowloon alley, jade and lanterns
// Signature: teal-black base, neon rose and jade signage, gold lantern highlights
const nightMarketTheme: Theme = {
  id: 'cyberpunk', // legacy id, kept for saved preferences
  name: 'Night Market',
  description: 'Neon signs over rain-slick streets',
  colors: {
    bgPrimary: '#070d0d',              // Wet asphalt teal-black
    bgSecondary: '#0b1414',
    bgTertiary: '#121e1e',
    borderColor: '#1f3333',
    textPrimary: '#eaf2ee',
    textSecondary: '#9fbdb3',
    textMuted: '#567a70',
    accentBlue: '#3da5e8',             // Cold signage blue
    accentGreen: '#3de8a3',            // Jade neon (signature)
    accentOrange: '#ff8f3d',           // Lantern flame
    accentRed: '#ff4d5f',              // Neon sign red (signature)
    accentPurple: '#b36bff',           // Violet tube
    accentCyan: '#3de8e0',             // Flickering cyan
    accentClaude: '#3de8a3',
    accentClaudeLight: '#6bf0bb',
    accentPink: '#ff5fa3',             // Neon rose
    accentYellow: '#ffd23d',           // Gold lantern
    // Messages: neon-rose user, jade assistant
    msgUserBg: 'rgba(255, 95, 163, 0.10)',
    msgUserBorder: '#ff5fa3',
    msgUserText: '#ff85b8',
    msgAssistantBg: 'rgba(61, 232, 163, 0.08)',
    msgAssistantBorder: '#3de8a3',
    msgAssistantText: '#6bf0bb',
    // Tools: lantern-gold use, signage-blue result
    toolUseBg: 'rgba(255, 210, 61, 0.07)',
    toolUseBorder: '#bd9a2b',
    toolUseText: '#ffd23d',
    toolUseName: '#3de8e0',
    toolResultBg: 'rgba(61, 165, 232, 0.07)',
    toolResultBorder: '#2b7aad',
    toolResultText: '#6bbdf0',
    // Output line: neon reflection on wet ground
    outputLineBg: 'rgba(61, 232, 224, 0.025)',
    // Context stats: neon red
    contextBarBg: 'rgba(255, 77, 95, 0.25)',
    contextBarFill: '#ff4d5f',
    taskLabelColor: '#ffd23d',            // Gold lantern
  },
};

// Firefly - a forest clearing at dusk, amber fireflies drifting between dark pines
// Signature: green-black woods, warm firefly amber as the living accent
const fireflyTheme: Theme = {
  id: 'synthwave', // legacy id, kept for saved preferences
  name: 'Firefly',
  description: 'Amber sparks in a dark forest',
  colors: {
    bgPrimary: '#0a120b',              // Forest floor
    bgSecondary: '#0e1810',
    bgTertiary: '#152417',
    borderColor: '#28402c',
    textPrimary: '#dde8d9',            // Moonlit leaves
    textSecondary: '#a3bda0',
    textMuted: '#5f7a5c',
    accentBlue: '#6b9ebd',             // Dusk sky through canopy
    accentGreen: '#6bbd7a',            // Fern
    accentOrange: '#e89d3d',           // Amber glow
    accentRed: '#cf6456',              // Redwood bark
    accentPurple: '#9d86bd',           // Twilight violet
    accentCyan: '#63bdad',             // Creek water
    accentClaude: '#6bbd7a',
    accentClaudeLight: '#85ce90',
    accentPink: '#c987a3',             // Foxglove
    accentYellow: '#f5d76b',           // Firefly light (signature)
    // Messages: moonlit user, firefly-amber assistant
    msgUserBg: 'rgba(221, 232, 217, 0.05)',
    msgUserBorder: '#5f7a5c',
    msgUserText: '#bdd1ba',
    msgAssistantBg: 'rgba(245, 215, 107, 0.07)',
    msgAssistantBorder: '#bd9d3d',
    msgAssistantText: '#e8ce7d',
    // Tools: fern use, creek result
    toolUseBg: 'rgba(107, 189, 122, 0.07)',
    toolUseBorder: '#3d6b47',
    toolUseText: '#8fce9a',
    toolUseName: '#f5d76b',
    toolResultBg: 'rgba(99, 189, 173, 0.07)',
    toolResultBorder: '#63bdad',
    toolResultText: '#85cec2',
    // Output line: undergrowth shadow
    outputLineBg: 'rgba(21, 36, 23, 0.5)',
    // Context stats: firefly amber
    contextBarBg: 'rgba(245, 215, 107, 0.20)',
    contextBarFill: '#d9bd56',
    taskLabelColor: '#f5d76b',            // Firefly light
  },
};

// Abyss - pitch-black void with vivid accents emerging from darkness
// Signature: Ultra-dark neutral backgrounds, warm vivid colors pop against the void
const abyssTheme: Theme = {
  id: 'abyss',
  name: 'Abyss',
  description: 'Pitch-black void, vivid accents',
  colors: {
    bgPrimary: '#08090c',              // Near-black void
    bgSecondary: '#0e1014',            // Deep shadow
    bgTertiary: '#16181e',             // Dark shelf
    borderColor: '#242830',            // Faint neutral edges
    textPrimary: '#b0b4bc',            // Neutral light gray
    textSecondary: '#808690',          // Muted gray
    textMuted: '#4c5058',              // Deep muted
    accentBlue: '#3d8ab8',             // Subdued ocean blue
    accentGreen: '#3ea868',            // Muted deep green
    accentOrange: '#c07848',           // Dimmed ember orange
    accentRed: '#b84848',              // Dark muted red
    accentPurple: '#8060b0',           // Muted violet
    accentCyan: '#3ca8a8',             // Subdued teal
    accentClaude: '#3ea868',
    accentClaudeLight: '#50b878',
    accentPink: '#a85880',             // Dusty rose
    accentYellow: '#b8a840',           // Dim gold
    // Messages: User messages keep a dark base; normal outgoing rows get a subtle violet fill
    msgUserBg: '#181c24',
    msgUserHighlightBg: 'rgba(128, 96, 176, 0.14)',
    msgUserBorder: '#6a4e96',
    msgUserText: '#d0d4dc',
    msgAssistantBg: '#12161e',
    msgAssistantBorder: '#1c3838',        // Subtle teal border for assistant
    msgAssistantText: '#a0a8b4',
    // Tools: Subtle warm/cool borders, distinct backgrounds
    toolUseBg: '#161a22',
    toolUseBorder: '#3a2820',             // Subtle warm border
    toolUseText: '#989ea8',
    toolUseName: '#c07848',
    toolResultBg: '#121824',
    toolResultBorder: '#202038',          // Subtle cool border
    toolResultText: '#989ea8',
    // Output line: Deep void
    outputLineBg: '#0a0c10',
    // Context stats: Muted neutral
    contextBarBg: 'rgba(60, 68, 76, 0.25)',
    contextBarFill: '#4c5460',
    taskLabelColor: '#c07848',            // Muted ember
  },
};

// Noir - a black-and-white film with a single thread of crimson
// Signature: pure grayscale, high contrast, one blood-red accent cutting through
const noirTheme: Theme = {
  id: 'obsidian-bloom', // legacy id, kept for saved preferences
  name: 'Noir',
  description: 'Grayscale film, one crimson thread',
  colors: {
    bgPrimary: '#0a0a0a',              // Black frame
    bgSecondary: '#111111',
    bgTertiary: '#1a1a1a',
    borderColor: '#2e2e2e',
    textPrimary: '#e8e8e8',            // Silver screen
    textSecondary: '#a8a8a8',
    textMuted: '#666666',
    accentBlue: '#9fb6c9',             // Desaturated steel
    accentGreen: '#8fbf9a',            // Faded green
    accentOrange: '#cfa87a',           // Sepia
    accentRed: '#d64545',              // The crimson thread (signature)
    accentPurple: '#a89ab8',           // Smoke violet
    accentCyan: '#93b8bd',             // Gray-cyan
    accentClaude: '#c0c0c0',           // Silver Claude
    accentClaudeLight: '#dcdcdc',
    accentPink: '#c98a9a',             // Faded lipstick
    accentYellow: '#cfc39a',           // Old paper
    // Messages: silver user, crimson-thread assistant
    msgUserBg: 'rgba(232, 232, 232, 0.06)',
    msgUserBorder: '#8a8a8a',
    msgUserText: '#d8d8d8',
    msgAssistantBg: 'rgba(214, 69, 69, 0.07)',
    msgAssistantBorder: '#d64545',
    msgAssistantText: '#e07a7a',
    // Tools: soft gray panels, contrast from borders only
    toolUseBg: 'rgba(255, 255, 255, 0.04)',
    toolUseBorder: '#3a3a3a',
    toolUseText: '#b0b0b0',
    toolUseName: '#e8e8e8',
    toolResultBg: 'rgba(0, 0, 0, 0.35)',
    toolResultBorder: '#2a2a2a',
    toolResultText: '#9a9a9a',
    // Output line: film grain
    outputLineBg: 'rgba(255, 255, 255, 0.02)',
    // Context stats: crimson
    contextBarBg: 'rgba(214, 69, 69, 0.20)',
    contextBarFill: '#d64545',
    taskLabelColor: '#d64545',            // Crimson thread
  },
};

// Moonmilk - a dreamy pastel cavern, soft minerals glowing in violet-gray dark
// Signature: deep violet-gray base with soft luminous pastels floating above it
const moonmilkTheme: Theme = {
  id: 'catppuccin', // legacy id, kept for saved preferences
  name: 'Moonmilk',
  description: 'Dreamy pastels in violet dark',
  colors: {
    bgPrimary: '#16151d',              // Cavern dark
    bgSecondary: '#1c1b25',
    bgTertiary: '#262432',
    borderColor: '#3d3a52',
    textPrimary: '#e8e4f2',            // Pale mineral
    textSecondary: '#bdb8d1',
    textMuted: '#7d7894',
    accentBlue: '#a3c4f5',             // Pastel periwinkle
    accentGreen: '#b3e0b8',            // Pastel mint
    accentOrange: '#f5c49d',           // Pastel apricot
    accentRed: '#f0a3ad',              // Pastel coral
    accentPurple: '#cbb3f5',           // Pastel lilac (signature)
    accentCyan: '#a8e3e0',             // Pastel aqua
    accentClaude: '#b3e0b8',
    accentClaudeLight: '#c9edcd',
    accentPink: '#f5bcd9',             // Pastel rose
    accentYellow: '#f2e3ad',           // Pastel butter
    // Messages: periwinkle user, lilac assistant
    msgUserBg: 'rgba(163, 196, 245, 0.08)',
    msgUserBorder: '#a3c4f5',
    msgUserText: '#bcd4f7',
    msgAssistantBg: 'rgba(203, 179, 245, 0.08)',
    msgAssistantBorder: '#cbb3f5',
    msgAssistantText: '#dac9f7',
    // Tools: apricot use, mint result
    toolUseBg: 'rgba(245, 196, 157, 0.07)',
    toolUseBorder: '#f5c49d',
    toolUseText: '#f7d4b5',
    toolUseName: '#a8e3e0',
    toolResultBg: 'rgba(179, 224, 184, 0.07)',
    toolResultBorder: '#b3e0b8',
    toolResultText: '#c9edcd',
    // Output line: soft cavern layer
    outputLineBg: 'rgba(38, 36, 50, 0.4)',
    // Context stats: pastel rose
    contextBarBg: 'rgba(245, 188, 217, 0.20)',
    contextBarFill: '#f5bcd9',
    taskLabelColor: '#f2e3ad',            // Pastel butter
  },
};

// Gunmetal - brushed-steel control panel: utilitarian, precise, safety-marked
// Signature: neutral gunmetal grays with signal blue and safety orange markings
const gunmetalTheme: Theme = {
  id: 'github-dark', // legacy id, kept for saved preferences
  name: 'Gunmetal',
  description: 'Brushed steel with safety orange',
  colors: {
    bgPrimary: '#0e1114',              // Dark gunmetal
    bgSecondary: '#14181d',
    bgTertiary: '#1c2228',
    borderColor: '#333d47',
    textPrimary: '#d7dde3',            // Stamped steel
    textSecondary: '#99a6b3',
    textMuted: '#5c6a77',
    accentBlue: '#4da3e0',             // Signal blue (signature)
    accentGreen: '#4dbd8a',            // Indicator green
    accentOrange: '#f08c28',           // Safety orange (signature)
    accentRed: '#e05252',              // Alarm red
    accentPurple: '#8f85cc',           // Wiring violet
    accentCyan: '#45b8c9',             // Gauge cyan
    accentClaude: '#4dbd8a',
    accentClaudeLight: '#6bd1a3',
    accentPink: '#cc7a9d',             // Test-probe pink
    accentYellow: '#e0b83d',           // Caution stripe
    // Messages: signal-blue user, plain-steel assistant
    msgUserBg: 'rgba(77, 163, 224, 0.08)',
    msgUserBorder: '#4da3e0',
    msgUserText: '#74b8e8',
    msgAssistantBg: 'rgba(215, 221, 227, 0.045)',
    msgAssistantBorder: '#5c6a77',
    msgAssistantText: '#b3bfc9',
    // Tools: safety-orange use, indicator-green result
    toolUseBg: 'rgba(240, 140, 40, 0.07)',
    toolUseBorder: '#a3611f',
    toolUseText: '#f08c28',
    toolUseName: '#45b8c9',
    toolResultBg: 'rgba(77, 189, 138, 0.06)',
    toolResultBorder: '#2e7a58',
    toolResultText: '#6bd1a3',
    // Output line: panel recess
    outputLineBg: 'rgba(28, 34, 40, 0.5)',
    // Context stats: safety orange
    contextBarBg: 'rgba(240, 140, 40, 0.22)',
    contextBarFill: '#f08c28',
    taskLabelColor: '#e0b83d',            // Caution stripe
  },
};

// Moonrise - full moon over slate hills, everything washed in silver and pale gold
// Signature: neutral slate base, silver assistant voice, moonbeam blue and moon gold
const moonriseTheme: Theme = {
  id: 'one-dark', // legacy id, kept for saved preferences
  name: 'Moonrise',
  description: 'Silver light over slate hills',
  colors: {
    bgPrimary: '#101318',              // Night slate
    bgSecondary: '#151920',
    bgTertiary: '#1d232c',
    borderColor: '#333c4a',
    textPrimary: '#dfe4ec',            // Moonlit stone
    textSecondary: '#a5aebd',
    textMuted: '#667082',
    accentBlue: '#8fb8e8',             // Moonbeam (signature)
    accentGreen: '#93c9a8',            // Night meadow
    accentOrange: '#d9ad7a',           // Window light
    accentRed: '#d98593',              // Dusk rose
    accentPurple: '#ad9dd9',           // Night violet
    accentCyan: '#8fccd9',             // Still water
    accentClaude: '#c9d1e0',           // Silver Claude
    accentClaudeLight: '#e0e6f0',
    accentPink: '#d3a3c2',             // Evening bloom
    accentYellow: '#e8d9a3',           // Pale moon gold
    // Messages: moonbeam user, silver assistant
    msgUserBg: 'rgba(143, 184, 232, 0.08)',
    msgUserBorder: '#8fb8e8',
    msgUserText: '#aecbf0',
    msgAssistantBg: 'rgba(223, 228, 236, 0.05)',
    msgAssistantBorder: '#8a94a8',
    msgAssistantText: '#cdd5e0',
    // Tools: moon-gold use, night-violet result
    toolUseBg: 'rgba(232, 217, 163, 0.06)',
    toolUseBorder: '#8a8163',
    toolUseText: '#e8d9a3',
    toolUseName: '#8fccd9',
    toolResultBg: 'rgba(173, 157, 217, 0.06)',
    toolResultBorder: '#ad9dd9',
    toolResultText: '#c2b8e3',
    // Output line: slate shadow
    outputLineBg: 'rgba(29, 35, 44, 0.5)',
    // Context stats: moonbeam
    contextBarBg: 'rgba(143, 184, 232, 0.20)',
    contextBarFill: '#8fb8e8',
    taskLabelColor: '#e8d9a3',            // Moon gold
  },
};

// Mariana - the deepest trench, bioluminescent life glowing in crushing dark
// Signature: abyssal navy base, electric plankton cyan and biolume green
const marianaTheme: Theme = {
  id: 'midnight-harbor', // legacy id, kept for saved preferences
  name: 'Mariana',
  description: 'Bioluminescence in the trench',
  colors: {
    bgPrimary: '#04090f',              // Abyssal water
    bgSecondary: '#071019',
    bgTertiary: '#0c1a26',
    borderColor: '#163247',
    textPrimary: '#d3e8f0',            // Diffuse glow
    textSecondary: '#8fb3c4',
    textMuted: '#4d7085',
    accentBlue: '#2e9be0',             // Deep current
    accentGreen: '#2ee0a8',            // Biolume green (signature)
    accentOrange: '#e09d45',           // Vent glow
    accentRed: '#e0596b',              // Deep-sea coral
    accentPurple: '#7d6be0',           // Jellyfish violet
    accentCyan: '#2ee0e0',             // Plankton glow (signature)
    accentClaude: '#2ee0a8',
    accentClaudeLight: '#5feabd',
    accentPink: '#e07ab8',             // Anemone
    accentYellow: '#e0cf6b',           // Anglerfish lure
    // Messages: plankton-cyan user, biolume-green assistant
    msgUserBg: 'rgba(46, 224, 224, 0.07)',
    msgUserBorder: '#2ee0e0',
    msgUserText: '#6beaea',
    msgAssistantBg: 'rgba(46, 224, 168, 0.07)',
    msgAssistantBorder: '#2ee0a8',
    msgAssistantText: '#5feabd',
    // Tools: lure-gold use, jelly-violet result
    toolUseBg: 'rgba(224, 207, 107, 0.06)',
    toolUseBorder: '#99883d',
    toolUseText: '#e0cf6b',
    toolUseName: '#2ee0e0',
    toolResultBg: 'rgba(125, 107, 224, 0.07)',
    toolResultBorder: '#7d6be0',
    toolResultText: '#a394ea',
    // Output line: trench layer
    outputLineBg: 'rgba(12, 26, 38, 0.5)',
    // Context stats: plankton cyan
    contextBarBg: 'rgba(46, 224, 224, 0.18)',
    contextBarFill: '#2ee0e0',
    taskLabelColor: '#e0cf6b',            // Anglerfish lure
  },
};

// Nightshade - a poisonous midnight garden: belladonna violet, moth silver, toxin green
// Signature: dark aubergine base, luminous belladonna purple with a poison-green edge
const nightshadeTheme: Theme = {
  id: 'ember-noir', // legacy id, kept for saved preferences
  name: 'Nightshade',
  description: 'Belladonna violet, poison green',
  colors: {
    bgPrimary: '#120d17',              // Midnight aubergine
    bgSecondary: '#18121f',
    bgTertiary: '#221a2c',
    borderColor: '#3d2f4d',
    textPrimary: '#e8e0f0',            // Moth wing
    textSecondary: '#bdadd1',
    textMuted: '#7a6b94',
    accentBlue: '#7a9be0',             // Nocturne blue
    accentGreen: '#7dd96b',            // Poison green (signature)
    accentOrange: '#d99a56',           // Amber pollen
    accentRed: '#d95f70',              // Berry red
    accentPurple: '#b37ae8',           // Belladonna (signature)
    accentCyan: '#6bc4d9',             // Dew
    accentClaude: '#a385e0',
    accentClaudeLight: '#bfa6ed',
    accentPink: '#d97ab3',             // Night orchid
    accentYellow: '#d9c46b',           // Dry stamen gold
    // Messages: moth-silver user, belladonna assistant
    msgUserBg: 'rgba(232, 224, 240, 0.05)',
    msgUserBorder: '#7a6b94',
    msgUserText: '#cfc2e0',
    msgAssistantBg: 'rgba(179, 122, 232, 0.09)',
    msgAssistantBorder: '#b37ae8',
    msgAssistantText: '#c799ed',
    // Tools: poison-green use, dew-cyan result
    toolUseBg: 'rgba(125, 217, 107, 0.06)',
    toolUseBorder: '#4a8a3d',
    toolUseText: '#93e085',
    toolUseName: '#d9c46b',
    toolResultBg: 'rgba(107, 196, 217, 0.06)',
    toolResultBorder: '#6bc4d9',
    toolResultText: '#8fd3e3',
    // Output line: garden shadow
    outputLineBg: 'rgba(34, 26, 44, 0.5)',
    // Context stats: belladonna
    contextBarBg: 'rgba(179, 122, 232, 0.22)',
    contextBarFill: '#b37ae8',
    taskLabelColor: '#7dd96b',            // Poison green
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
    taskLabelColor: '#8be9fd',            // Classic cyan
  },
};

// All available themes
export const themes: Theme[] = [
  classicTheme,      // Default - original transparent style
  abyssTheme,        // Ultra dark with vivid accents
  noirTheme,         // Grayscale film with one crimson thread
  bloodmoonTheme,    // Gothic crimson and antique gold
  sumiTheme,         // Ink wash with a vermilion seal
  verdigrisTheme,    // Oxidized copper and patina
  glacierTheme,      // Arctic ice under a low sun
  ukiyoTheme,        // Woodblock wave in prussian blue
  magmaTheme,        // Lava veins through black basalt
  terracottaTheme,   // Desert clay and turquoise
  observatoryTheme,  // Star charts and telescope brass
  nightMarketTheme,  // Neon signs over rain-slick streets
  fireflyTheme,      // Amber sparks in a dark forest
  moonmilkTheme,     // Dreamy pastels in violet dark
  gunmetalTheme,     // Brushed steel with safety orange
  moonriseTheme,     // Silver light over slate hills
  marianaTheme,      // Bioluminescence in the trench
  nightshadeTheme,   // Belladonna violet with poison green
];

// Get theme by ID
export function getTheme(id: ThemeId): Theme {
  return themes.find(t => t.id === id) || classicTheme;
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
  root.style.setProperty('--msg-user-highlight-bg', colors.msgUserHighlightBg ?? colors.msgUserBg);
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
  // Task label color
  root.style.setProperty('--task-label-color', colors.taskLabelColor);

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
