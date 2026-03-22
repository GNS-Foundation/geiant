import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'intro',
    'quick-start',
    {
      type: 'category',
      label: 'Architecture',
      items: [
        'architecture/overview',
        'architecture/audit-trail',
        'architecture/delegation',
        'architecture/protocol-spec',
      ],
    },
    {
      type: 'category',
      label: 'Integrations',
      items: [
        'integrations/langchain',
        'integrations/mcp-server',
      ],
    },
    {
      type: 'category',
      label: 'Compliance',
      items: [
        'compliance/eu-ai-act',
        'compliance/compliance-reports',
      ],
    },
    {
      type: 'category',
      label: 'API Reference',
      items: [
        'api/http-endpoints',
      ],
    },
  ],
};

export default sidebars;
