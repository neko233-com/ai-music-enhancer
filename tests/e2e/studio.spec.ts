import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('six demos, real wasm enhancement, A/B playback, high resolution and MP3 export', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '让好声音，更进一步。' })).toBeVisible();
  await expect(page.locator('.demo-list button')).toHaveCount(6);
  await page.getByLabel('处理引擎', { exact: true }).selectOption('local');
  await page.locator('.demo-list button').nth(2).click();
  await expect(page.getByRole('status')).toContainText('音频已就绪');
  await page.getByLabel('采样率', { exact: true }).selectOption('192000');
  await page.getByLabel('位深', { exact: true }).selectOption('33');
  await page.getByRole('button', { name: '开始增强', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('本地调音完成', { timeout: 90000 });
  await page.getByRole('button', { name: '播放原始音频', exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .nth(0)
        .evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: '播放增强音频', exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .nth(1)
        .evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeGreaterThan(0);
  expect(
    await page
      .locator('audio')
      .nth(0)
      .evaluate((el: HTMLAudioElement) => el.paused),
  ).toBe(true);
  await page.getByRole('button', { name: '暂停增强音频', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 WAV', exact: true }).click();
  const downloaded = await downloadPromise,
    bytes = await readFile((await downloaded.path())!);
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.readUInt32LE(24)).toBe(192000);
  expect(bytes.readUInt16LE(34)).toBe(32);
  expect(bytes.readUInt16LE(20)).toBe(3);
  await page.locator('.header').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/studio-desktop.png', fullPage: true });
  await page.getByLabel('输出格式', { exact: true }).selectOption('mp3');
  await page.getByRole('button', { name: '开始增强', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('本地调音完成');
  const mp3Promise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 MP3', exact: true }).click();
  const mp3 = await readFile((await (await mp3Promise).path())!);
  expect(mp3.length).toBeGreaterThan(10000);
  expect(mp3[0]).toBe(255);
  expect(errors).toEqual([]);
});
test('user uploads, rejects corrupt input, and mobile layout has no overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('上传音频').setInputFiles('web/public/demos/voice-1.wav');
  await expect(page.getByRole('status')).toContainText('音频已就绪');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/studio-mobile.png', fullPage: true });
  await page
    .getByLabel('上传音频')
    .setInputFiles({
      name: 'broken.wav',
      mimeType: 'audio/wav',
      buffer: Buffer.from('broken audio'),
    });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: '开始增强', exact: true })).toBeDisabled();
});
test('offline reload retains all demos and wasm processing', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(
    page.getByText('网页与示例已缓存，可离线重新打开。', { exact: false }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.demo-list button')).toHaveCount(6);
  await page.getByLabel('处理引擎', { exact: true }).selectOption('local');
  await page.locator('.demo-list button').nth(1).click();
  await expect(page.getByRole('status')).toContainText('音频已就绪');
  await page.getByRole('button', { name: '开始增强', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('本地调音完成');
  await context.setOffline(false);
});
