// Beta-posterior math — ported verbatim from docs/cgr_reputation_panel.prototype.html
// so the drawn density matches the validated prototype exactly. Pure; no scoring
// math added — the panel only DRAWS Beta(post_alpha, post_beta) supplied by the API.

const LG_C = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function lgamma(x: number): number {
  const g = 7;
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = LG_C[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += LG_C[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

export function betaPdf(x: number, a: number, b: number): number {
  if (x <= 0 || x >= 1) return 0;
  const lnB = lgamma(a) + lgamma(b) - lgamma(a + b);
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - lnB);
}

export function betaCurve(a: number, b: number, n = 240): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    xs.push(x);
    ys.push(betaPdf(x, a, b));
  }
  return { xs, ys };
}

/** Central credible interval [lo, hi] (default 90%) via numeric CDF inversion. */
export function credible(a: number, b: number, lo = 0.05, hi = 0.95, n = 2000): [number, number] {
  const step = 1 / n;
  const mass: number[] = [];
  for (let i = 1; i < n; i++) mass.push(betaPdf(i * step, a, b));
  const tot = mass.reduce((s, v) => s + v, 0) || 1;
  let cum = 0;
  let ql: number | null = null;
  let qh: number | null = null;
  for (let i = 0; i < mass.length; i++) {
    cum += mass[i] / tot;
    const x = (i + 1) * step;
    if (ql === null && cum >= lo) ql = x;
    if (qh === null && cum >= hi) { qh = x; break; }
  }
  return [ql ?? 0, qh ?? 1];
}

export const betaMean = (a: number, b: number): number => a / (a + b);
