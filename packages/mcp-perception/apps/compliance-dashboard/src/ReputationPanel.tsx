import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { betaCurve, betaPdf, credible } from './beta';
import {
  loadReputation, verifyAttestation,
  type LoadedData, type AgentView, type ContinuityStatus,
} from './cgr-data';

/* ── palette + layout, ported from docs/cgr_reputation_panel.prototype.html,
      scoped under .rep so it doesn't fight the host shell ─────────────────── */
const REP_CSS = `
.rep{--plane:#0d0d0d;--surface:#1a1a19;--surface-2:#212120;--ink:#ffffff;--ink-2:#c3c2b7;--muted:#898781;
  --grid:#2c2c2a;--axis:#383835;--border:rgba(255,255,255,0.10);--series:#3987e5;--series-soft:rgba(57,135,229,0.16);
  --aqua:#199e70;--good:#0ca30c;--critical:#d03b3b;--warning:#fab219;--gold:#e0b53d;--silver:#9fb0c2;--bronze:#c07f43;
  --unproven:#898781;--radius:12px;background:var(--plane);color:var(--ink);
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;min-height:100%}
.rep[data-theme="light"]{--plane:#f9f9f7;--surface:#fcfcfb;--surface-2:#f4f3ef;--ink:#0b0b0b;--ink-2:#52514e;--muted:#898781;
  --grid:#e1e0d9;--axis:#c3c2b7;--border:rgba(11,11,11,0.10);--series:#2a78d6;--series-soft:rgba(42,120,214,0.12);
  --aqua:#1baf7a;--good:#006300;--critical:#d03b3b;--warning:#eda100;--gold:#b98900;--silver:#6c7c8f;--bronze:#a6672e;--unproven:#898781}
.rep *{box-sizing:border-box}
.rep a{color:var(--series)}
.rep .wrap{max-width:1240px;margin:0 auto;padding:22px 22px 60px}
.rep header.top{display:flex;align-items:center;gap:16px;margin-bottom:18px;flex-wrap:wrap}
.rep .brand{display:flex;flex-direction:column;gap:2px}
.rep .brand h1{font-size:19px;margin:0;letter-spacing:-0.01em}
.rep .brand .sub{font-size:12.5px;color:var(--ink-2)}
.rep .spacer{flex:1}
.rep .neutrality{display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);
  border-radius:999px;padding:6px 12px;font-size:12px;color:var(--ink-2)}
.rep .dot{width:8px;height:8px;border-radius:50%;background:var(--good);box-shadow:0 0 0 3px rgba(12,163,12,.18)}
.rep .dot.warn{background:var(--warning);box-shadow:0 0 0 3px rgba(250,178,25,.18)}
.rep .toggle{background:var(--surface);border:1px solid var(--border);color:var(--ink-2);border-radius:999px;
  padding:6px 12px;font-size:12px;cursor:pointer}
.rep .grid{display:grid;grid-template-columns:300px 1fr;gap:16px}
@media(max-width:900px){.rep .grid{grid-template-columns:1fr}}
.rep .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px}
.rep .card h2{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:0 0 12px}
.rep .roster{padding:8px}
.rep .agent{display:grid;grid-template-columns:1fr auto;gap:4px 8px;padding:11px 12px;border-radius:10px;cursor:pointer;border:1px solid transparent}
.rep .agent:hover{background:var(--surface-2)}
.rep .agent.sel{background:var(--surface-2);border-color:var(--border)}
.rep .agent .h{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px}
.rep .agent .s{font-size:12px;color:var(--ink-2);font-variant-numeric:tabular-nums}
.rep .agent .meta{font-size:11.5px;color:var(--muted);grid-column:1/2}
.rep .chip{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;letter-spacing:.02em;justify-self:end;white-space:nowrap}
.rep .chip::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.9}
.rep .b-gold{color:var(--gold);background:color-mix(in srgb,var(--gold) 15%,transparent)}
.rep .b-silver{color:var(--silver);background:color-mix(in srgb,var(--silver) 15%,transparent)}
.rep .b-bronze{color:var(--bronze);background:color-mix(in srgb,var(--bronze) 15%,transparent)}
.rep .b-unproven{color:var(--unproven);background:color-mix(in srgb,var(--unproven) 15%,transparent)}
.rep .detail{display:flex;flex-direction:column;gap:16px}
.rep .hero{display:grid;grid-template-columns:auto 1fr;gap:20px;align-items:center}
.rep .score{font-size:52px;font-weight:700;letter-spacing:-0.02em;line-height:1}
.rep .score small{font-size:17px;color:var(--muted);font-weight:600}
.rep .hero .right{display:flex;flex-direction:column;gap:8px}
.rep .hero .hh{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.rep .hero .hh .name{font-size:15px;font-weight:600}
.rep .rationale{font-size:12.5px;color:var(--ink-2);max-width:60ch}
.rep .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
@media(max-width:620px){.rep .kpis{grid-template-columns:repeat(2,1fr)}}
.rep .kpi{background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:11px 12px}
.rep .kpi .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.rep .kpi .v{font-size:20px;font-weight:700;margin-top:3px;font-variant-numeric:tabular-nums}
.rep .kpi .v small{font-size:12px;color:var(--muted);font-weight:600}
.rep .two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:760px){.rep .two{grid-template-columns:1fr}}
.rep .legendrow{display:flex;gap:16px;flex-wrap:wrap;font-size:11.5px;color:var(--ink-2);margin-top:6px}
.rep .lg{display:inline-flex;align-items:center;gap:6px}
.rep .sw{width:11px;height:11px;border-radius:3px;display:inline-block}
.rep .cap{font-size:11.5px;color:var(--muted);margin-top:8px;line-height:1.5}
.rep .att{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 20px;font-size:12px}
@media(max-width:620px){.rep .att{grid-template-columns:1fr}}
.rep .att .row{display:flex;justify-content:space-between;gap:12px;border-bottom:1px dashed var(--grid);padding:6px 0}
.rep .att .k{color:var(--muted)}
.rep .att .val{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px}
.rep .verified{color:var(--good);font-weight:700;display:inline-flex;align-items:center;gap:5px}
.rep .badgerow{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.rep .vbadge{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:8px;border:1px solid transparent}
.rep .v-ok{color:var(--good);background:color-mix(in srgb,var(--good) 12%,transparent);border-color:color-mix(in srgb,var(--good) 30%,transparent)}
.rep .v-bad{color:var(--critical);background:color-mix(in srgb,var(--critical) 12%,transparent);border-color:color-mix(in srgb,var(--critical) 30%,transparent)}
.rep .v-warn{color:var(--warning);background:color-mix(in srgb,var(--warning) 13%,transparent);border-color:color-mix(in srgb,var(--warning) 34%,transparent)}
.rep .v-muted{color:var(--muted);background:color-mix(in srgb,var(--muted) 12%,transparent);border-color:var(--border)}
.rep .prov{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px}
.rep .prov-profile{color:var(--aqua);background:color-mix(in srgb,var(--aqua) 14%,transparent)}
.rep .prov-proxy{color:var(--muted);background:color-mix(in srgb,var(--muted) 12%,transparent)}
.rep table{width:100%;border-collapse:collapse;font-size:12.5px}
.rep th{text-align:left;color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding:8px 10px;border-bottom:1px solid var(--grid)}
.rep td{padding:9px 10px;border-bottom:1px solid var(--grid);font-variant-numeric:tabular-nums}
.rep tr:last-child td{border-bottom:none}
.rep .tag{font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:5px;text-transform:uppercase;letter-spacing:.03em}
.rep .t-rule{color:var(--aqua);background:color-mix(in srgb,var(--aqua) 14%,transparent)}
.rep .t-judgment{color:var(--series);background:var(--series-soft)}
.rep .oc{display:inline-flex;align-items:center;gap:6px;font-weight:600}
.rep .oc::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor}
.rep .o-paid{color:var(--good)}.rep .o-default{color:var(--critical)}.rep .o-pending{color:var(--muted)}
.rep .stars{color:var(--warning);letter-spacing:1px;font-size:12px}
.rep .foot{margin-top:20px;font-size:11.5px;color:var(--muted);line-height:1.6}
.rep .banner{background:color-mix(in srgb,var(--warning) 12%,transparent);border:1px solid color-mix(in srgb,var(--warning) 34%,transparent);
  color:var(--ink-2);border-radius:10px;padding:9px 13px;font-size:12px;margin-bottom:14px}
.rep .barrow{display:grid;grid-template-columns:170px 1fr 44px;gap:10px;align-items:center;margin:7px 0;font-size:12.5px}
.rep .barrow .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink-2)}
.rep .track{height:12px;background:var(--surface-2);border-radius:6px;overflow:hidden;position:relative}
.rep .fill{height:100%;border-radius:6px}
.rep .barrow .wv{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}
.rep .adv{color:var(--critical)}
.rep .tamper{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--muted);cursor:pointer;user-select:none}
.rep .priv{font-size:12px;color:var(--muted);background:var(--surface-2);border:1px dashed var(--border);border-radius:10px;padding:14px}
`;

const BANDLABEL: Record<string, string> = { gold: 'GOLD', silver: 'SILVER', bronze: 'BRONZE', unproven: 'UNPROVEN' };
const short = (k?: string | null, n = 4) => (k ? `${k.slice(0, n)}…${k.slice(-n)}` : '—');
const fmtAsOf = (iso: string) => iso.replace('T', ' ').replace(/\..*/, '').replace('Z', ' UTC');

/* ── posterior SVG: Beta(a,b), 90% CI, mean AND cgr_score/ceiling marked separately ── */
function Posterior({ a, b, score }: { a: number; b: number; score: number }) {
  const W = 460, H = 210, L = 8, R = 8, T = 12, B = 26, pw = W - L - R, ph = H - T - B;
  const { xs, ys } = useMemo(() => betaCurve(a, b), [a, b]);
  const ymax = Math.max(...ys) * 1.08 || 1;
  const [cl, ch] = useMemo(() => credible(a, b), [a, b]);
  const mean = a / (a + b);
  const X = (x: number) => L + x * pw;
  const Y = (y: number) => T + ph - (y / ymax) * ph;
  const line = xs.map((x, i) => `${i ? 'L' : 'M'} ${X(x).toFixed(1)} ${Y(ys[i]).toFixed(1)}`).join(' ');
  let shade = `M ${X(cl)} ${Y(0)}`;
  xs.forEach((x, i) => { if (x >= cl && x <= ch) shade += ` L ${X(x).toFixed(1)} ${Y(ys[i]).toFixed(1)}`; });
  shade += ` L ${X(ch)} ${Y(0)} Z`;
  const scoreDiffers = Math.abs(mean - score) > 0.004;
  return (
    <svg width="100%" height="210" viewBox="0 0 460 210" preserveAspectRatio="xMidYMid meet">
      {[0, .25, .5, .75, 1].map((t) => (
        <g key={t}>
          <line x1={X(t)} x2={X(t)} y1={T} y2={T + ph} stroke="var(--grid)" strokeWidth="1" />
          <text x={X(t)} y={H - 8} fill="var(--muted)" fontSize="10.5" textAnchor="middle">{t.toFixed(2)}</text>
        </g>
      ))}
      <path d={shade} fill="var(--series-soft)" />
      <path d={line} fill="none" stroke="var(--series)" strokeWidth="2" strokeLinejoin="round" />
      {/* mean (posterior center) */}
      <line x1={X(mean)} x2={X(mean)} y1={Y(betaPdf(mean, a, b))} y2={T + ph} stroke="var(--ink)" strokeWidth="2" />
      <text x={X(mean)} y={T - 2} fill="var(--ink)" fontSize="11" fontWeight="700" textAnchor="middle">{mean.toFixed(3)}</text>
      {/* cgr_score / ceiling — marked SEPARATELY (differs from mean when the gate binds) */}
      {scoreDiffers && (
        <>
          <line x1={X(score)} x2={X(score)} y1={T} y2={T + ph} stroke="var(--warning)" strokeWidth="2" strokeDasharray="3 3" />
          <text x={Math.min(X(score), W - 40)} y={T + ph + 18} fill="var(--warning)" fontSize="10.5" fontWeight="700" textAnchor="middle">score {score.toFixed(2)}</text>
        </>
      )}
    </svg>
  );
}

function Verifiability({ rule, judgment }: { rule: number; judgment: number }) {
  const W = 460, H = 66, L = 8, R = 8, y = 14, h = 26, pw = W - L - R;
  const tot = rule + judgment || 1;
  const rw = (rule / tot) * pw;
  const gap = tot > rule && rule > 0 ? 2 : 0;
  const pct = Math.round((judgment / tot) * 100);
  return (
    <svg width="100%" height="66" viewBox="0 0 460 66" preserveAspectRatio="xMidYMid meet">
      {rw - gap > 0 && (
        <>
          <rect x={L} y={y} width={Math.max(0, rw - gap)} height={h} rx="5" fill="var(--aqua)"><title>{`rule (verifiable): ${rule} decisions`}</title></rect>
          {rw - gap > 44 && <text x={L + 9} y={y + h / 2 + 4} fill="#fff" fontSize="11.5" fontWeight="700">{rule}</text>}
        </>
      )}
      <rect x={L + rw + gap} y={y} width={Math.max(0, pw - rw - gap)} height={h} rx="5" fill="var(--series)"><title>{`judgment (unverifiable): ${judgment} decisions`}</title></rect>
      {pw - rw - gap > 44 && <text x={L + rw + gap + 9} y={y + h / 2 + 4} fill="#fff" fontSize="11.5" fontWeight="700">{judgment}</text>}
      <text x={L} y={H - 6} fill="var(--muted)" fontSize="10.5">{`${pct}% of this agent's calls are unverifiable judgment — exactly where reputation earns its keep.`}</text>
    </svg>
  );
}

function Ceiling({ capTier, nResolved, score }: { capTier: number; nResolved: number; score: number }) {
  const W = 460, H = 56, L = 8, R = 8, y = 16, h = 14, pw = W - L - R;
  const X = (v: number) => L + v * pw;
  const eps = 0.02, NLIFT = 20;
  const s = Math.min(1, nResolved / NLIFT);
  const ceil = Math.min(1, capTier + eps + (1 - capTier - eps) * s);
  return (
    <svg width="100%" height="56" viewBox="0 0 460 56" preserveAspectRatio="xMidYMid meet">
      <rect x={L} y={y} width={pw} height={h} rx="7" fill="var(--surface-2)" />
      <rect x={L} y={y} width={Math.max(0, X(score) - L)} height={h} rx="7" fill="var(--series)" />
      <line x1={X(ceil)} x2={X(ceil)} y1={y - 5} y2={y + h + 5} stroke="var(--warning)" strokeWidth="2.5" />
      <text x={Math.min(X(ceil), W - 70)} y={H - 6} fill="var(--warning)" fontSize="10.5" fontWeight="700">{`ceiling ${ceil.toFixed(2)}`}</text>
      <text x={L} y={y - 4} fill="var(--muted)" fontSize="10.5">{`score ${score.toFixed(3)}`}</text>
    </svg>
  );
}

/* ── continuity badge (#7/#10) ─────────────────────────────────────────────── */
function ContinuityBadge({ status, reason }: { status: ContinuityStatus; reason?: string }) {
  const map: Record<ContinuityStatus, [string, string]> = {
    verified: ['v-ok', '✔ continuity verified'],
    asserted: ['v-warn', '⚠ continuity asserted'],
    unverified: ['v-muted', 'continuity n/a'],
  };
  const [cls, label] = map[status];
  return <span className={`vbadge ${cls}`} title={reason ?? 'independently walked anchor→current'}>{label}</span>;
}

export function ReputationPanel() {
  const [data, setData] = useState<LoadedData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [tamper, setTamper] = useState(false);
  const [tamperVer, setTamperVer] = useState<AgentView['verification'] | null>(null);

  useEffect(() => {
    loadReputation().then((d) => { setData(d); setSel(0); }).catch((e) => setErr(String(e?.message ?? e)));
  }, []);

  const agent = data?.agents[sel];

  // Tamper: flip a signed field and re-run the REAL verifier → badges must fail.
  const onTamper = useCallback(async (on: boolean) => {
    setTamper(on);
    if (!on || !data || !agent) { setTamperVer(null); return; }
    const mutated = { ...agent.attestation, cgr_score: agent.attestation.cgr_score + 0.05 };
    setTamperVer(await verifyAttestation(mutated, data.foundationKey, data.fetchProofs));
  }, [data, agent]);

  useEffect(() => { setTamper(false); setTamperVer(null); }, [sel]);

  if (err) return <div className="rep" data-theme={theme}><div className="wrap"><div className="banner">Failed to load reputation data: {err}</div></div></div>;
  if (!data || !agent) return <div className="rep" data-theme={theme}><style>{REP_CSS}</style><div className="wrap"><div className="cap">Loading CGR reputation…</div></div></div>;

  const ver = tamper && tamperVer ? tamperVer : agent.verification;
  const ci = credible(agent.a, agent.b);
  const capTier = agent.cap_d ?? agent.capability_tier ?? 0;

  return (
    <div className="rep" data-theme={theme}>
      <style>{REP_CSS}</style>
      <div className="wrap">
        <header className="top">
          <div className="brand">
            <h1>CGR Reputation</h1>
            <div className="sub">Capability-Grounded Reputation · receivables dimension · GNS Cloud</div>
          </div>
          <div className="spacer" />
          <div className="neutrality" title="Scores are issued as Foundation-signed attestations on a key distinct from any agent's own signing key.">
            <span className={`dot${data.keyPinned ? '' : ' warn'}`} /> Issued by <b style={{ color: 'var(--ink)', margin: '0 3px' }}>GNS&nbsp;Foundation</b>
            {' '}· key <span style={{ fontFamily: 'ui-monospace,monospace' }}>{short(data.foundationKey, 8)}</span>
            {' '}· {data.source === 'live' ? 'live' : 'sample'}
          </div>
          <button className="toggle" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>◐ Theme</button>
        </header>

        {data.note && <div className="banner">{data.note}</div>}

        <div className="grid">
          {/* roster */}
          <aside className="card roster">
            <h2 style={{ padding: '0 4px' }}>Agents · {data.agents.length}</h2>
            {data.agents.map((a, i) => (
              <div key={a.handle} className={`agent ${i === sel ? 'sel' : ''}`} onClick={() => setSel(i)}>
                <div className="h">{a.handle.split('@')[0]}</div>
                <span className={`chip b-${a.band}`}>{BANDLABEL[a.band]}</span>
                <div className="meta">n={a.n_resolved} · <span style={{ fontFamily: 'ui-monospace,monospace' }}>{short(a.subject_key)}</span></div>
                <div className="s">{a.mean.toFixed(3)}</div>
              </div>
            ))}
            <div className="cap" style={{ padding: '0 6px 4px' }}>Ranked by CGR posterior mean. <b>unproven</b> = honest cold-start (thin evidence), not a low score.</div>
          </aside>

          {/* detail */}
          <main className="detail">
            <section className="card">
              <div className="hero">
                <div><div className="score">{agent.score.toFixed(3)} <small>/ 1.00</small></div></div>
                <div className="right">
                  <div className="hh">
                    <span className="name">{agent.handle}</span>
                    <span className={`chip b-${agent.band}`}>{BANDLABEL[agent.band]}</span>
                  </div>
                  <div className="rationale">{agent.rationale}</div>
                  <div className="kpis">
                    <div className="kpi"><div className="l">Evidence mass</div><div className="v">{agent.confidence.toFixed(1)}<small> n=α+β</small></div></div>
                    <div className="kpi"><div className="l">Resolved</div><div className="v">{agent.n_resolved}<small> outcomes</small></div></div>
                    <div className="kpi"><div className="l">Capability</div><div className="v">{capTier.toFixed(2)} <span className={`prov ${agent.cap_source === 'profile' ? 'prov-profile' : 'prov-proxy'}`}>{agent.cap_source === 'profile' ? 'measured' : 'proxy'}</span></div></div>
                    <div className="kpi"><div className="l">90% interval</div><div className="v">{ci[0].toFixed(2)}–{ci[1].toFixed(2)}</div></div>
                  </div>
                  <div className="cap">As of <b>{fmtAsOf(agent.as_of)}</b> · scores are recency/λ-weighted (#13) — a stale-good agent fades until it re-earns.</div>
                </div>
              </div>
            </section>

            <div className="two">
              <section className="card">
                <h2>Posterior — not a point</h2>
                <Posterior a={agent.a} b={agent.b} score={agent.score} />
                <div className="legendrow">
                  <span className="lg"><span className="sw" style={{ background: 'var(--series)' }} /> posterior density</span>
                  <span className="lg"><span className="sw" style={{ background: 'var(--series-soft)', border: '1px solid var(--series)' }} /> 90% credible interval</span>
                  <span className="lg"><span className="sw" style={{ width: 2, height: 12, borderRadius: 0, background: 'var(--ink)' }} /> mean</span>
                  <span className="lg"><span className="sw" style={{ width: 2, height: 12, borderRadius: 0, background: 'var(--warning)' }} /> cgr_score / ceiling</span>
                </div>
                <div className="cap">Beta({agent.a.toFixed(1)}, {agent.b.toFixed(1)}) over the agent's true pay-rate. Width <b>is</b> the uncertainty. The mean is the raw posterior center; <b>cgr_score</b> is the evidence-gated point — they diverge when the ceiling binds.</div>
              </section>

              <section className="card">
                <h2>Evidence &amp; verifiability</h2>
                {agent.rule !== undefined && agent.judgment !== undefined ? (
                  <>
                    <Verifiability rule={agent.rule} judgment={agent.judgment} />
                    <div className="legendrow">
                      <span className="lg"><span className="sw" style={{ background: 'var(--aqua)' }} /> rule (verifiable) — calibrates</span>
                      <span className="lg"><span className="sw" style={{ background: 'var(--series)' }} /> judgment (unverifiable) — the value slice</span>
                    </div>
                  </>
                ) : (
                  <div className="priv">Verifiability split is drawn from private substrate — visible to the operating tenant only.</div>
                )}
                <div style={{ height: 14 }} />
                <h2 style={{ marginTop: 6 }}>Evidence-gated ceiling</h2>
                <Ceiling capTier={capTier} nResolved={agent.n_resolved} score={agent.score} />
                <div className="cap">Evidence lifts the ceiling as outcomes resolve (ε=0.02, N_lift=20). Capability bound cap_d={capTier.toFixed(2)} from <b>{agent.cap_source === 'profile' ? 'a measured J-Space profile' : 'the TierGate proxy'}</b>{agent.cap_source === 'profile' && agent.cap_confidence != null ? ` (confidence ${agent.cap_confidence.toFixed(2)})` : ''}.</div>
              </section>
            </div>

            <section className="card">
              <h2>Attestation</h2>
              <div className="badgerow">
                <span className={`vbadge ${ver.sigValid ? 'v-ok' : 'v-bad'}`} title={ver.sigReason ?? 'Ed25519 over JCS body, bound on subject_key'}>
                  {ver.sigValid ? '✔ Ed25519 verified' : '✕ signature invalid'}
                </span>
                <ContinuityBadge status={ver.continuity} reason={ver.continuityReason} />
                <span className={`prov ${agent.cap_source === 'profile' ? 'prov-profile' : 'prov-proxy'}`} title="Where the capability bound cap_d came from">
                  cap: {agent.cap_source === 'profile' ? 'measured profile' : 'TierGate proxy'}{agent.cap_source === 'profile' && agent.cap_confidence != null ? ` · conf ${agent.cap_confidence.toFixed(2)}` : ''}
                </span>
                <label className="tamper"><input type="checkbox" checked={tamper} onChange={(e) => onTamper(e.target.checked)} /> simulate tamper</label>
              </div>
              <div className="att">
                {([
                  ['schema', agent.attestation.schema],
                  ['issuer', agent.attestation.issuer],
                  ['issuer_key_id', short(agent.attestation.issuer_key_id, 8)],
                  ['subject_key (current)', short(agent.subject_key, 6)],
                  ['subject_did (anchor)', agent.subject_did ?? '—'],
                  ['as_of', fmtAsOf(agent.as_of)],
                  ['dimension', agent.attestation.dimension],
                  ['identity', ver.keyHistory && ver.keyHistory.length > 1 ? `rotated · ${ver.keyHistory.length} keys, one identity` : 'single key (never rotated)'],
                ] as [string, string][]).map(([k, v]) => (
                  <div className="row" key={k}><span className="k">{k}</span><span className="val" title={v}>{v}</span></div>
                ))}
              </div>
              <div className="cap">Verified in-browser with <b>@geiant/core</b> <code>verifyCGRAttestation</code> (bound on subject_key) and <code>verifyContinuity</code> (independent anchor→current walk over <code>/v1/cgr/rotations</code>). GEIANT never computes CGR — it verifies a score issued under a distinct Foundation key.</div>
            </section>

            <section className="card">
              <h2>Decision → outcome → review history</h2>
              {agent.hist ? (
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead><tr><th>invoice_ref</th><th>decision</th><th>type</th><th>outcome</th><th>days</th><th>reviews</th></tr></thead>
                    <tbody>
                      {agent.hist.map((r) => (
                        <tr key={r[0]}>
                          <td style={{ fontFamily: 'ui-monospace,monospace' }}>{r[0]}</td>
                          <td>{r[1] === 'certify' ? '✔ certify' : '✕ reject'}</td>
                          <td><span className={`tag t-${r[2]}`}>{r[2]}</span></td>
                          <td><span className={`oc o-${r[3]}`}>{r[3]}</span></td>
                          <td>{r[4] ?? '—'}</td>
                          <td><span className="stars">{'★'.repeat(r[5])}{'☆'.repeat(Math.max(0, 5 - r[5]))}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="priv">Private substrate — decision→outcome→review history is visible only to the operating tenant. Scores + attestations + continuity above are the neutral, shareable surface.</div>
              )}
              <div className="cap">Reviewer weights are Brier-calibrated on <b>resolved</b> outcomes, then applied to the early signal on unresolved invoices — "verify the reviewer, not the task."</div>
            </section>

            <section className="card">
              <h2>Reviewer calibration (global)</h2>
              {data.reviewers ? (
                data.reviewers.map((rv) => (
                  <div className="barrow" key={rv.nm}>
                    <span className="nm">{rv.nm}</span>
                    <div className="track" title={`Brier ${rv.brier} over ${rv.n} resolved`}><div className="fill" style={{ width: `${(rv.w * 100).toFixed(0)}%`, background: rv.adv ? 'var(--critical)' : 'var(--series)' }} /></div>
                    <span className={`wv ${rv.adv ? 'adv' : ''}`}>{rv.w.toFixed(2)}</span>
                  </div>
                ))
              ) : (
                <div className="priv">Reviewer identities are private substrate — visible to the operating tenant only.</div>
              )}
              <div className="cap">A reviewer earns weight by predicting outcomes that later settle. A review-farm that rubber-stamps earns ≈ 0 and cannot move a score.</div>
            </section>
          </main>
        </div>

        <div className="foot">
          Wired to the live CGR API (<code>GET /v1/cgr/scores</code> + <code>/v1/cgr/attestations</code> + <code>/v1/cgr/rotations</code>). Posterior drawn from <code>post_alpha</code>/<code>post_beta</code>; <code>cgr_score</code> marked separately from the mean (they diverge when the evidence-gated ceiling binds). Substrate (decisions, outcomes, reviewers) stays tenant-private; only scores + attestations + continuity are shared.
        </div>
      </div>
    </div>
  );
}
