# docs.geiant.com

GEIANT developer documentation — built with [Docusaurus](https://docusaurus.io/).

## Structure

```
docs/
├── intro.md                    # What is GEIANT?
├── quick-start.md              # 10-minute setup guide
├── architecture/
│   ├── overview.md             # Four-layer stack
│   ├── audit-trail.md          # Virtual breadcrumb chain
│   └── delegation.md           # Delegation certificates
├── integrations/
│   ├── langchain.md            # LangChain integration
│   └── mcp-server.md           # MCP perception service
├── compliance/
│   ├── eu-ai-act.md            # Art. 12/14 mapping
│   └── compliance-reports.md   # Report endpoint reference
└── api/
    └── http-endpoints.md       # REST API reference
```

## Development

```bash
npm install
npm start        # localhost:3000 with hot reload
npm run build    # production build → build/
```

## Deployment

Deployed to Netlify at `docs.geiant.com`. Auto-deploys on push to main.

## DNS

Add CNAME record in Cloudflare:
```
docs.geiant.com → <netlify-subdomain>.netlify.app
```
