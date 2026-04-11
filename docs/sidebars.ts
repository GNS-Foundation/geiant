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
        'integrations/microsoft-sql-mcp',
        'integrations/claude-managed-agents',
        'integrations/goose',
        'integrations/aws-agentcore',
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
    {
      type: 'category',
      label: 'Hive',
      items: [
        'hive/overview',
        'hive/quick-start',
        'hive/h3-resolution',
        'hive/worker-cli',
        'hive/api-reference',
      ],
    },
  ],
};

export default sidebars;
