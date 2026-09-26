import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('local GPU reconstruction and real FLAC download through the web UI', async ({
  page,
  context,
}) => {
  test.skip(
    process.env.NEKO_GPU_E2E !== '1',
    'Opt-in test requires local NVIDIA GPU and installed AudioSR model',
  );
  test.setTimeout(180000);
  if (process.env.E2E_URL?.startsWith('https:')) {
    // Simulate the user allowing this site's local-network permission in an isolated test context.
    await context.grantPermissions(['local-network-access'], {
      origin: new URL(process.env.E2E_URL).origin,
    });
  }
  await page.goto('/');
  await page.getByRole('button', { name: '检测连接', exact: true }).click();
  await expect(page.locator('.service strong')).toContainText('模型就绪', { timeout: 15000 });
  await page.getByLabel('上传音频').setInputFiles('web/public/demos/voice-1.wav');
  await expect(page.getByRole('status')).toContainText('音频已就绪');
  await page.getByLabel('处理引擎', { exact: true }).selectOption('audiosr');
  await page.getByLabel('采样率', { exact: true }).selectOption('192000');
  await page.getByRole('button', { name: '开始增强', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('AI 细节重建完成', { timeout: 150000 });
  await page.getByRole('button', { name: '播放增强音频', exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .nth(1)
        .evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: '暂停增强音频', exact: true }).click();
  await page.getByLabel('输出格式', { exact: true }).selectOption('flac');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 FLAC', exact: true }).click();
  const bytes = await readFile((await (await download).path())!);
  expect(bytes.toString('ascii', 0, 4)).toBe('fLaC');
  await page.setViewportSize({ width: 1505, height: 1045 });
  await page.locator('.header').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/studio-gpu.png', fullPage: true });
});
