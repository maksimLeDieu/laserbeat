const { chromium } = require('../../node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const p = await b.newPage({ viewport: { width: 1000, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('file://' + __dirname + '/morceaux.html'); await p.evaluate(() => document.fonts.ready);
  for (const n of ['mic', 'cassette', 'favela', 'drift', 'blocks', 'guitar']) {
    await p.evaluate(n => window.render(n), n);
    await p.locator('#c').screenshot({ path: __dirname + '/raw-' + n + '.png' });
  }
  console.log(errs); await b.close();
})();
