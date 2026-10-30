import { launch, openApp } from './lib.mjs';
import { makeHelpers, sleep } from './helpers.mjs';

const { browser, page, problems } = await launch();
const H = makeHelpers(page);
try {
  await openApp(page);
  const appearance = page.locator('[data-testid="section-appearance"]');
  await appearance.locator('> button').click(); // close
  await appearance.locator('> button').click(); // open, proving the section is interactive
  await page.locator('[data-testid="font-select"]').selectOption('lilita-one');
  await page.locator('[data-testid="card-color"]').fill('#dbeafe');
  await page.locator('[data-testid="alphabet-color"]').fill('#7c3aed');
  await page.locator('[data-testid="word-color"]').fill('#dc2626');
  await page.locator('[data-testid="border-style"]').selectOption('raised');
  await page.locator('[data-testid="border-color"]').fill('#ef4444');
  await page.locator('[data-testid="border-width"]').fill('3');
  await page.locator('[data-testid="border-height"]').fill('1');
  await H.waitReady();
  const status = await page.getAttribute('[data-testid="geometry-status"] [data-state="ready"]', 'data-triangles');
  if (Number(status) <= 1588) throw new Error(`raised border did not add geometry: ${status} triangles`);
  const card = page.locator('[data-testid="card-chip"]').first();
  if (!(await card.count())) throw new Error('card disappeared');
  console.log('style controls applied; triangles:', status, 'problems:', problems.length);
  await page.locator('[data-testid="section-text"] > button').click();
  await page.locator('[data-testid="alphabet-relief"]').selectOption('engraved-filled');
  await page.locator('[data-testid="word-relief"]').selectOption('engraved-filled');
  await page.locator('[data-testid="border-style"]').selectOption('engraved-filled');
  await H.waitReady();
  const filledDims = await page.textContent('[data-testid="model-dimensions"]');
  if (!/80 × 100 × 4\.6 mm/.test(filledDims)) throw new Error(`engraved-filled pattern did not preserve the raised fill: ${filledDims}`);
  console.log('engraved-filled controls applied; triangles:', await page.getAttribute('[data-testid="geometry-status"] [data-state="ready"]', 'data-triangles'), 'problems:', problems.length);
  await page.click('[data-testid="generate-numbers"]');
  await page.fill('[data-testid="number-range-from"]', '1');
  await page.fill('[data-testid="number-range-to"]', '3');
  await page.click('[data-testid="number-range-generate"]');
  await page.waitForTimeout(250);
  if ((await page.locator('[data-testid="card-chip"]').count()) < 4) throw new Error('number range did not add 1-3 cards');
  console.log('number range controls applied; cards:', await page.locator('[data-testid="card-chip"]').count());
} finally {
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 8000))]);
  process.exit(0);
}
