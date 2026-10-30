import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..', '..');
export const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });

export const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export async function launch({ downloads = true } = {}) {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || 'msedge',
    headless: true,
    args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: downloads });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  return { browser, context, page, problems };
}

export async function openApp(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('[data-testid="viewer"]', { timeout: 120000 });
  await waitReady(page);
}

/** Wait until the geometry for the current settings is generated (status chip says ready). */
export async function waitReady(page, timeout = 60000) {
  await page.waitForSelector('[data-testid="geometry-status"] [data-state="ready"]', { timeout });
}

export async function shot(page, name) {
  const file = path.join(outDir, name);
  await page.screenshot({ path: file });
  return file;
}

export const results = [];
export function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -  ' + detail : ''}`);
}
