// Screenshots of every page at 1440px and 375px, dark and light, plus automated checks (console errors, horizontal overflow).
// Usage: node scripts/screenshots.mjs [baseUrl] [outDir] [filter]   (needs the web app running; devnet pools are read live)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:3920';
const out = process.argv[3] || 'docs/screenshots';
const filter = process.argv[4] || '';
mkdirSync(out, { recursive: true });

// default (real data): Fairway pools on devnet; ?demo=1 pages keep the simulated fixtures reachable
const fw = (await (await fetch(`${base}/api/fairway/tokens`)).json()).tokens ?? [];
const launchMint = fw.find((t) => t.isLaunch)?.mint;
const traded = fw.find((t) => t.check.earlyBuyers > 0)?.mint ?? fw[0]?.mint;
const demoTokens = (await (await fetch(`${base}/api/check/tokens?limit=30&demo=1`)).json()).tokens;
const high = demoTokens.filter((t) => t.grade === 'High' && t.earlyBuyers >= 10)[0]?.mint;
const pages = [
  ['home', '/'],
  ['swap', '/swap'],
  ['launch', '/launch'],
  ['launch-live', `/launch/${launchMint}`],
  ['explore', '/explore'],
  ['explore-pump', '/explore?tab=pump'],
  ['check', '/check'],
  ['check-fairway', `/check/${traded}`],
  ['check-unknown', '/check/11111111111111111111111111111111'],
  ['check-invalid', '/check/not-an-address'],
  ['demo-check-high', `/check/${high}?demo=1`],
  ['demo-swap', '/swap?demo=1'],
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
      const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
      await page.waitForTimeout(1500);
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
