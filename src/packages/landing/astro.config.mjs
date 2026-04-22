import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
  site: 'https://tidecommander.com',
  base: '/docs',
  integrations: [
    starlight({
      title: 'Tide Commander',
      description:
        'Visual multi-agent orchestrator for Claude Code, Codex, and OpenCode. Deploy, command, and monitor AI coding agents from a single 3D interface.',
      logo: {
        src: './src/assets/tc-icon.png',
        alt: 'Tide Commander',
        replacesTitle: false,
      },
      favicon: '/favicon.ico',
      social: {
        github: 'https://github.com/deivid11/tide-commander',
        discord: 'https://discord.gg/MymXXDCvf',
      },
      customCss: ['./src/styles/theme.css'],
      head: [
        {
          tag: 'meta',
          attrs: { name: 'theme-color', content: '#0a0a0f' },
        },
      ],
      editLink: {
        baseUrl:
          'https://github.com/deivid11/tide-commander/edit/master/src/packages/landing/',
      },
      lastUpdated: true,
      pagination: true,
      expressiveCode: {
        themes: ['github-dark-default', 'github-light'],
        styleOverrides: {
          borderRadius: '10px',
          codeFontFamily:
            "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, monospace",
        },
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Quickstart', slug: 'getting-started/quickstart' },
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Your First Agent', slug: 'getting-started/first-agent' },
            { label: 'Providers', slug: 'getting-started/providers' },
          ],
        },
        {
          label: 'Core Concepts',
          items: [
            { label: 'Overview', slug: 'concepts/overview' },
            { label: 'Agents', slug: 'concepts/agents' },
            { label: 'Boss & Subordinates', slug: 'concepts/boss-and-subordinates' },
            { label: 'Delegation', slug: 'concepts/delegation' },
            { label: 'Classes', slug: 'concepts/classes' },
            { label: 'Skills', slug: 'concepts/skills' },
            { label: 'Areas', slug: 'concepts/areas' },
            { label: 'Snapshots', slug: 'concepts/snapshots' },
            { label: 'Secrets', slug: 'concepts/secrets' },
          ],
        },
        {
          label: 'Views',
          items: [
            { label: 'Overview', slug: 'views/overview' },
            { label: '3D Battlefield', slug: 'views/3d' },
            { label: '2D Canvas', slug: 'views/2d' },
            { label: 'Dashboard', slug: 'views/dashboard' },
            { label: 'Commander View', slug: 'views/commander' },
            { label: 'Guake Terminal', slug: 'views/guake-terminal' },
            { label: 'Spotlight Search', slug: 'views/spotlight' },
          ],
        },
        {
          label: 'Buildings',
          items: [
            { label: 'Overview', slug: 'buildings/overview' },
            { label: 'Server', slug: 'buildings/server' },
            { label: 'Database', slug: 'buildings/database' },
            { label: 'Docker', slug: 'buildings/docker' },
            { label: 'Link', slug: 'buildings/link' },
            { label: 'Boss Building', slug: 'buildings/boss-building' },
          ],
        },
        {
          label: 'Configuration',
          items: [
            { label: 'System Prompt', slug: 'configuration/system-prompt' },
            { label: 'Prompt Stacking', slug: 'configuration/prompt-stacking' },
            { label: 'Permissions', slug: 'configuration/permissions' },
            { label: 'Environment Variables', slug: 'configuration/env-vars' },
            { label: 'HTTPS & Auth', slug: 'configuration/https-and-auth' },
            { label: 'Keyboard Shortcuts', slug: 'configuration/keyboard-shortcuts' },
          ],
        },
        {
          label: 'Advanced',
          items: [
            { label: 'Custom Classes', slug: 'advanced/custom-classes' },
            { label: 'Custom Skills', slug: 'advanced/custom-skills' },
            { label: 'Custom 3D Models', slug: 'advanced/custom-3d-models' },
            { label: 'Multiplayer', slug: 'advanced/multiplayer' },
          ],
        },
        {
          label: 'Deployment',
          items: [
            { label: 'Docker', slug: 'deployment/docker' },
            { label: 'Android APK', slug: 'deployment/android' },
            { label: 'Mobile Remote', slug: 'deployment/mobile-remote' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Architecture', slug: 'reference/architecture' },
            { label: 'REST API', slug: 'reference/api-rest' },
            { label: 'WebSocket API', slug: 'reference/api-websocket' },
            { label: 'CLI', slug: 'reference/cli' },
            { label: 'Data Storage', slug: 'reference/data-storage' },
            { label: 'Codex JSON Events', slug: 'reference/codex-events' },
          ],
        },
        {
          label: 'Contributing',
          items: [
            { label: 'Setup', slug: 'contributing/setup' },
            { label: 'Security', slug: 'contributing/security' },
            { label: 'Changelog', slug: 'contributing/changelog' },
          ],
        },
      ],
    }),
  ],
});
