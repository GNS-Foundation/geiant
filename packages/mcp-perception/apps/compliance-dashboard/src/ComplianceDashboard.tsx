import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '@modelcontextprotocol/ext-apps/react';
import { applyDocumentTheme, applyHostStyleVariables, applyHostFonts } from '@modelcontextprotocol/ext-apps';
import type { App as McpAppType } from '@modelcontextprotocol/ext-apps';
import type { ComplianceReport } from './types';

/* ── Styles ─────────────────────────────────────────────── */

const styles = `
.cd{max-width:720px;margin:0 auto;padding:24px 20px 40px;animation:fi .4s ease}
@keyframes fi{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes su{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}

.cd-hdr{display:flex;align-items:center;gap:12px;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid var(--geiant-border)}
.cd-shield{width:40px;height:40px;background:linear-gradient(135deg,var(--geiant-cyan),var(--geiant-teal));border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
.cd-h1{font-size:18px;font-weight:600;color:var(--color-text-primary,#fff);letter-spacing:-.02em}
.cd-sub{font-family:var(--font-mono,var(--geiant-mono));font-size:12px;color:var(--geiant-text2);margin-top:2px}
.cd-handle{color:var(--geiant-cyan)}
.cd-pk{color:var(--geiant-text3)}

.cd-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}
.cd-sc{background:var(--geiant-bg2);border:1px solid var(--geiant-border);border-radius:10px;padding:14px 16px;text-align:center}
.cd-sl{font-size:11px;font-weight:500;color:var(--geiant-text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
.cd-sv{font-family:var(--font-mono,var(--geiant-mono));font-size:22px;font-weight:700;color:var(--color-text-primary,#fff)}
.cd-sv.cyan{color:var(--geiant-cyan)}.cd-sv.green{color:var(--geiant-green)}.cd-sv.amber{color:var(--geiant-amber)}

.cd-sec{background:var(--geiant-bg2);border:1px solid var(--geiant-border);border-radius:10px;padding:16px 18px;margin-bottom:12px;animation:su .35s ease both}
.cd-sec:nth-child(4){animation-delay:.05s}.cd-sec:nth-child(5){animation-delay:.1s}
.cd-sec:nth-child(6){animation-delay:.15s}.cd-sec:nth-child(7){animation-delay:.2s}
.cd-sec:nth-child(8){animation-delay:.25s}

.cd-st{font-size:11px;font-weight:600;color:var(--geiant-text2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px;display:flex;align-items:center;gap:6px}
.cd-dot{width:6px;height:6px;border-radius:50%;background:var(--geiant-cyan)}

.cd-track{position:relative;height:6px;background:var(--geiant-bg3);border-radius:3px;margin:8px 0 12px;overflow:hidden}
.cd-fill{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,var(--geiant-cyan),var(--geiant-teal));border-radius:3px;transition:width 1.2s cubic-bezier(.22,1,.36,1)}
.cd-tl{display:flex;justify-content:space-between;font-family:var(--font-mono,var(--geiant-mono));font-size:10px;color:var(--geiant-text3)}
.cd-tl .act{color:var(--geiant-cyan);font-weight:700}
.cd-pct{font-family:var(--font-mono,var(--geiant-mono));font-size:13px;color:var(--geiant-text);margin-top:2px}

.cd-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:600;font-family:var(--font-mono,var(--geiant-mono))}
.cd-badge.v{background:rgba(0,200,83,.12);color:var(--geiant-green)}
.cd-badge.inv{background:rgba(227,6,19,.12);color:var(--geiant-red)}

.cd-cr{display:flex;align-items:center;gap:16px;font-family:var(--font-mono,var(--geiant-mono));font-size:13px}
.cd-cm{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;font-size:12px;color:var(--geiant-text2)}
.cd-cm span{font-family:var(--font-mono,var(--geiant-mono));font-size:12px}
.cd-cml{color:var(--geiant-text3);font-family:var(--font-sans,var(--geiant-sans))!important}

.cd-er{display:flex;align-items:center;gap:10px;padding:8px 0;font-family:var(--font-mono,var(--geiant-mono));font-size:12px;color:var(--geiant-text);border-bottom:1px solid var(--geiant-border)}
.cd-er:last-child{border-bottom:none}
.cd-ei{color:var(--geiant-text3);min-width:24px}
.cd-eroot{color:var(--geiant-text2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.cd-dg{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px}
.cd-dg .l{color:var(--geiant-text3);font-size:12px}
.cd-dg .val{font-family:var(--font-mono,var(--geiant-mono));font-size:12px;color:var(--geiant-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cd-dg .val.cy{color:var(--geiant-cyan)}

.cd-ra{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}
.cd-rp{display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--geiant-bg);border-radius:8px;font-size:12px;color:var(--geiant-text)}
.cd-rp .chk{color:var(--geiant-green)}.cd-rp .cross{color:var(--geiant-red)}

.cd-cb{background:var(--geiant-bg);border-radius:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;font-size:12px}
.cd-cb .lbl{color:var(--geiant-text2)}
.cd-cb .days{font-family:var(--font-mono,var(--geiant-mono));font-weight:700;color:var(--geiant-amber);font-size:14px}

.cd-vo{margin-top:12px;background:var(--geiant-bg);border:1px solid var(--geiant-border);border-radius:8px;padding:14px;font-family:var(--font-mono,var(--geiant-mono));font-size:11px;color:var(--geiant-text2);line-height:1.7;white-space:pre-wrap;max-height:200px;overflow-y:auto}

.cd-actions{display:flex;gap:10px;margin-top:20px}
.cd-btn{flex:1;padding:10px 0;border:1px solid var(--geiant-border);border-radius:8px;background:var(--geiant-bg2);color:var(--geiant-text);font-family:var(--font-sans,var(--geiant-sans));font-size:13px;font-weight:500;cursor:pointer;transition:background .15s,border-color .15s;text-align:center}
.cd-btn:hover{background:var(--geiant-bg3);border-color:var(--geiant-cyan)}
.cd-btn.pri{background:linear-gradient(135deg,rgba(0,153,204,.15),rgba(0,180,160,.10));border-color:rgba(0,153,204,.3);color:var(--geiant-cyan)}
.cd-btn.done{border-color:var(--geiant-green);color:var(--geiant-green)}

@media print{
  body{background:#fff!important;color:#111!important}
  .cd{max-width:100%;padding:0}
  .cd-sec{border-color:#ddd}
  .cd-actions{display:none}
}
`;

/* ── Helpers ─────────────────────────────────────────────── */

const truncPk = (pk: string, n = 8) => pk.slice(0, n) + '...';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });

const daysUntil = (iso: string) =>
  Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));

/* ── Component ──────────────────────────────────────────── */

interface Props {
  mockReport: ComplianceReport;
}

export function ComplianceDashboard({ mockReport }: Props) {
  const [report, setReport] = useState<ComplianceReport>(mockReport);
  const [showVerify, setShowVerify] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  // ── MCP App SDK: useApp hook ──────────────────────────
  const { app } = useApp({
    appInfo: { name: 'GEIANT Compliance Dashboard', version: '0.1.0' },
    capabilities: {},
    onAppCreated: (mcpApp: McpAppType) => {
      // Receive compliance report from tool result
      mcpApp.ontoolresult = (result) => {
        try {
          const text = result.content?.find((c: any) => c.type === 'text')?.text;
          if (text) setReport(JSON.parse(text));
        } catch { /* keep mock data on parse failure */ }
      };

      // Apply host theme when context changes
      mcpApp.onhostcontextchanged = (ctx) => {
        if (ctx.theme) applyDocumentTheme(ctx.theme);
        if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
        if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
      };

      mcpApp.onteardown = async () => { /* cleanup if needed */ };
    },
  });

  // Apply initial host context after connection
  useEffect(() => {
    if (!app) return;
    const ctx = app.getHostContext();
    if (ctx?.theme) applyDocumentTheme(ctx.theme);
    if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
    if (ctx?.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  }, [app]);

  useEffect(() => { setMounted(true); }, []);

  const r = report;
  const daysLeft = useMemo(() => daysUntil(r.regulatory.enforcementDate), [r]);
  const scoreWidth = useMemo(() => Math.min(100, (r.trustScore.score / 100) * 100), [r]);

  const tierMap: Record<string, number> = { Provisioned: 0, Observed: 1, Trusted: 2, Certified: 3 };
  const tierIdx = tierMap[r.trustScore.tier] ?? 0;

  const copyJson = useCallback(async () => {
    // Sandboxed iframe blocks navigator.clipboard — send JSON into the chat instead
    try {
      await app?.sendMessage({
        content: [{ type: 'text', text: '```json\n' + JSON.stringify(r, null, 2) + '\n```' }],
      });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: try clipboard anyway (works in basic-host / goose)
      try {
        await navigator.clipboard.writeText(JSON.stringify(r, null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch { /* silently fail */ }
    }
  }, [r, app]);

  const [pdfRequested, setPdfRequested] = useState(false);

  const exportPdf = useCallback(async () => {
    // Sandboxed iframe blocks window.print — ask Claude to generate the PDF instead
    try {
      await app?.updateModelContext({
        content: [{ type: 'text', text:
          'User clicked "Export PDF" on the compliance dashboard. ' +
          'Please generate a professional PDF compliance report for ' +
          r.agent.handle + ' using the compliance data already returned by the tool. ' +
          'Include all sections: trust score, chain verification, epochs, ' +
          'delegation certificate, and regulatory status.'
        }],
      });
      setPdfRequested(true);
      setTimeout(() => setPdfRequested(false), 3000);
    } catch {
      // Fallback: try window.print (works in basic-host / goose)
      window.print();
    }
  }, [app, r]);

  const verifyLog = useMemo(() => {
    const lines: string[] = ['Merkle Verification Log', '='.repeat(40)];
    for (const ep of r.epochs) {
      lines.push(`\nEpoch #${ep.index}  blocks ${ep.blockRange[0]} -> ${ep.blockRange[1]}`);
      lines.push(`  root   ${ep.merkleRoot}`);
      lines.push(`  status ${ep.valid ? 'VALID' : 'INVALID'}`);
    }
    lines.push(`\nChain integrity: ${r.chain.valid ? 'VALID' : 'BROKEN'}`);
    lines.push(`  ${r.chain.blockCount} blocks, ${r.chain.issues} issues`);
    return lines.join('\n');
  }, [r]);

  return (
    <>
      <style>{styles}</style>
      <div className="cd">

        {/* Header */}
        <div className="cd-hdr">
          <div className="cd-shield">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <div>
            <div className="cd-h1">GEIANT Compliance Report</div>
            <div className="cd-sub">
              <span className="cd-handle">{r.agent.handle}</span>
              {' · '}
              <span className="cd-pk">{truncPk(r.agent.publicKey)}</span>
            </div>
          </div>
        </div>

        {/* Top-level stats */}
        <div className="cd-stats">
          <div className="cd-sc">
            <div className="cd-sl">Trust Score</div>
            <div className="cd-sv cyan">{r.trustScore.score.toFixed(2)}%</div>
          </div>
          <div className="cd-sc">
            <div className="cd-sl">Total Ops</div>
            <div className="cd-sv">{r.trustScore.totalOps}</div>
          </div>
          <div className="cd-sc">
            <div className="cd-sl">Violations</div>
            <div className={`cd-sv ${r.trustScore.violations === 0 ? 'green' : 'amber'}`}>
              {r.trustScore.violations === 0 ? '\u2705 ' : ''}{r.trustScore.violations}
            </div>
          </div>
        </div>

        {/* TierGate */}
        <div className="cd-sec">
          <div className="cd-st"><span className="cd-dot" />TierGate Progress</div>
          <div className="cd-track">
            <div className="cd-fill" style={{ width: mounted ? `${scoreWidth}%` : '0%' }} />
          </div>
          <div className="cd-tl">
            {['Provisioned', 'Observed', 'Trusted', 'Certified'].map((t, i) => (
              <span key={t} className={i === tierIdx ? 'act' : ''}>{t}</span>
            ))}
          </div>
          <div className="cd-pct">
            {r.trustScore.score.toFixed(2)}% — {r.trustScore.opsToNextTier} ops to {r.trustScore.nextTier}
          </div>
        </div>

        {/* Chain Verification */}
        <div className="cd-sec">
          <div className="cd-st"><span className="cd-dot" />Chain Verification</div>
          <div className="cd-cr">
            <span className={`cd-badge ${r.chain.valid ? 'v' : 'inv'}`}>
              {r.chain.valid ? '\u2705 Valid' : '\u274c Invalid'}
            </span>
            <span>{r.chain.blockCount} blocks</span>
            <span>{r.chain.issues} issues</span>
          </div>
          <div className="cd-cm">
            <div><span className="cd-cml">First: </span><span>{fmtDate(r.chain.firstBlock)}</span></div>
            <div><span className="cd-cml">Last: </span><span>{fmtDate(r.chain.lastBlock)}</span></div>
          </div>
        </div>

        {/* Epochs */}
        <div className="cd-sec">
          <div className="cd-st"><span className="cd-dot" />Epochs (Merkle Roots)</div>
          {r.epochs.map((ep) => (
            <div className="cd-er" key={ep.index}>
              <span className="cd-ei">#{ep.index}</span>
              <span>blocks {ep.blockRange[0]}&rarr;{ep.blockRange[1]}</span>
              <span className="cd-eroot">{truncPk(ep.merkleRoot, 12)}</span>
              <span className={`cd-badge ${ep.valid ? 'v' : 'inv'}`}>
                {ep.valid ? '\u2705' : '\u274c'}
              </span>
            </div>
          ))}
        </div>

        {/* Delegation */}
        <div className="cd-sec">
          <div className="cd-st"><span className="cd-dot" />Delegation Certificate</div>
          <div className="cd-dg">
            <span className="l">Principal</span>
            <span className="val">{truncPk(r.delegation.principal, 12)}</span>
            <span className="l">Territory</span>
            <span className="val cy">{r.delegation.territory} ({r.delegation.territoryLabel})</span>
            <span className="l">Valid</span>
            <span className="val">{fmtDate(r.delegation.validFrom)} &rarr; {fmtDate(r.delegation.validUntil)}</span>
            <span className="l">Facets</span>
            <span className="val cy">{r.delegation.facets.join(', ')}</span>
          </div>
        </div>

        {/* Regulatory */}
        <div className="cd-sec">
          <div className="cd-st"><span className="cd-dot" />Regulatory Basis</div>
          <div className="cd-ra">
            {r.regulatory.articles.map((a) => (
              <div className="cd-rp" key={a.id}>
                <span className={a.compliant ? 'chk' : 'cross'}>
                  {a.compliant ? '\u2705' : '\u274c'}
                </span>
                {a.label}
              </div>
            ))}
          </div>
          <div className="cd-cb">
            <span className="lbl">Enforcement deadline: {fmtDate(r.regulatory.enforcementDate)}</span>
            <span className="days">{daysLeft}d</span>
          </div>
        </div>

        {/* Verify overlay */}
        {showVerify && <div className="cd-vo">{verifyLog}</div>}

        {/* Actions */}
        <div className="cd-actions">
          <button className={`cd-btn ${pdfRequested ? 'done' : 'pri'}`} onClick={exportPdf}>
            {pdfRequested ? 'PDF Requested \u2713' : 'Export PDF'}
          </button>
          <button className={`cd-btn ${copied ? 'done' : ''}`} onClick={copyJson}>
            {copied ? 'Sent to Chat \u2713' : 'Copy JSON'}
          </button>
          <button className="cd-btn" onClick={() => setShowVerify((v) => !v)}>
            {showVerify ? 'Hide Verify' : 'Verify Offline'}
          </button>
        </div>
      </div>
    </>
  );
}
