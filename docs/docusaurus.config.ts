import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'GEIANT Docs',
  tagline: 'Geospatial AI Governance Runtime — Developer Documentation',
  favicon: 'img/logo.png',
  url: 'https://docs.geiant.com',
  baseUrl: '/',
  organizationName: 'GNS-Foundation',
  projectName: 'geiant',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  i18n: { defaultLocale: 'en', locales: ['en'] },
  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/GNS-Foundation/geiant/tree/main/docs/',
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    image: 'img/logo.png',
    navbar: {
      title: 'GEIANT',
      logo: { alt: 'GEIANT Logo', src: 'img/logo.png' },
      items: [
        { type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Documentation' },
        { href: 'https://www.npmjs.com/package/@gns-aip/sdk', label: 'npm', position: 'right' },
        { href: 'https://github.com/GNS-Foundation/geiant', label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        { title: 'Docs', items: [
          { label: 'Quick Start', to: '/quick-start' },
          { label: 'Architecture', to: '/architecture/overview' },
          { label: 'EU AI Act', to: '/compliance/eu-ai-act' },
        ]},
        { title: 'Packages', items: [
          { label: '@gns-aip/sdk', href: 'https://www.npmjs.com/package/@gns-aip/sdk' },
          { label: 'langchain-gns-aip', href: 'https://www.npmjs.com/package/langchain-gns-aip' },
        ]},
        { title: 'Community', items: [
          { label: 'GitHub', href: 'https://github.com/GNS-Foundation/geiant' },
          { label: 'IETF TrIP Draft', href: 'https://datatracker.ietf.org/doc/draft-ayerbe-trip-protocol' },
        ]},
      ],
      copyright: `© ${new Date().getFullYear()} ULISSY s.r.l. — Built with Docusaurus`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'sql', 'typescript'],
    },
    colorMode: { defaultMode: 'dark', disableSwitch: false, respectPrefersColorScheme: true },
  } satisfies Preset.ThemeConfig,
};

export default config;
