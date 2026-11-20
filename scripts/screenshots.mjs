// Screenshots of every page at 1440px and 375px, dark and light, plus automated checks (console errors, horizontal overflow).
// Usage: node scripts/screenshots.mjs [baseUrl] [outDir] [filter]   (needs the web app running in mock mode)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:3920';
const out = process.argv[3] || 'docs/screenshots';
const filter = process.argv[4] || '';
mkdirSync(out, { recursive: true });

const tokens = (await (await fetch(`${base}/api/check/tokens?limit=30`)).json()).tokens;
const pick = (g, i = 0) => tokens.filter((t) => t.grade === g && t.earlyBuyers >= 10)[i]?.mint;
const high = pick('High');
const med = pick('Medium');
const low = pick('Low');
const wallet = tokens.flatMap((t) => t.topBuyers).find((b) => b.tier === 'TOXIC' && !b.bundle)?.wallet;
const pages = [
  ['home', '/'],
  ['check', '/check'],
  ['check-high', `/check/${high}`],
  ['check-medium', `/check/${med}`],
  ['check-low', `/check/${low}`],
  ['check-wallet', `/check/${wallet}`],
  ['check-unknown', '/check/11111111111111111111111111111111'],
  ['check-invalid', '/check/not-an-address'],
  ['launch', '/launch'],
  ['launch-frog', '/launch/frog'],
  ['launch-cat', '/launch/cat'],
  ['swap', '/swap'],
  ['wallet', '/wallet'],
  ['pool', '/pool'],
  ['backtest', '/backtest'],
  ['how-it-works', '/how-it-works'],
].filter(([n]) => !filter || n.includes(filter));

const browser = await chromium.launch();
const problems = [];
for (const theme of ['dark', 'light']) {
  for (const [vw, w, h] of [['1440', 1440, 900], ['375', 375, 812]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await ctx.addInitScript((t) => localStorage.setItem('fw.theme', t), theme);
    for (const [name, path] of pages) {
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push(String(e)));
      const res = await page.goto(base + path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(250);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) problems.push(`${name} ${vw} ${theme}: horizontal overflow ${overflow}px`);
      if (res && res.status() >= 400 && !name.includes('invalid')) problems.push(`${name} ${vw} ${theme}: HTTP ${res.status()}`);
      for (const e of errors) problems.push(`${name} ${vw} ${theme}: console error: ${e.slice(0, 160)}`);
      await page.screenshot({ path: `${out}/${name}-${vw}-${theme}.png`, fullPage: true });
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
console.log(problems.length ? problems.join('\n') : 'no console errors, no horizontal overflow, no HTTP errors');
