/**
 * 端到端测试 (E2E Tests)
 * 使用 tauri-driver 测试完整的应用程序流程
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Builder, By, until, WebDriver, Capabilities } from 'selenium-webdriver';
import { spawn, ChildProcess, execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

// E2E测试配置
const defaultBinaryName =
  process.platform === 'win32' ? 'video-downloader-pro.exe' : 'video-downloader-pro';

const findAppBinary = () => {
  const debugDir = join(process.cwd(), 'src-tauri/target/debug');
  const candidates =
    process.platform === 'win32'
      ? [defaultBinaryName, 'Video Downloader Pro.exe', 'video_downloader_pro.exe']
      : [defaultBinaryName, 'video_downloader_pro'];

  for (const candidate of candidates) {
    const candidatePath = join(debugDir, candidate);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return join(debugDir, defaultBinaryName);
};

const parseVersion = (text: string) => {
  const match = text.match(/\d+\.\d+\.\d+\.\d+/);
  return match ? match[0] : null;
};

const getEdgeDriverVersion = () => {
  try {
    const output = execSync('msedgedriver --version', { encoding: 'utf8' });
    return parseVersion(output);
  } catch {
    return null;
  }
};

const getWebView2Version = () => {
  if (process.platform !== 'win32') {
    return null;
  }

  const registryKeys = [
    'HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
  ];

  for (const key of registryKeys) {
    try {
      const output = execSync(`reg query "${key}" /v pv 2>nul`, { encoding: 'utf8' });
      const match = output.match(/pv\s+REG_SZ\s+([0-9.]+)/);
      if (match) {
        return match[1];
      }
    } catch {
      continue;
    }
  }

  return null;
};

const E2E_CONFIG = {
  TIMEOUT: 30000,
  APP_START_TIMEOUT: 15000,
  TAURI_DRIVER_PORT: 4444,
  APP_PATH: process.env.E2E_APP_PATH ? process.env.E2E_APP_PATH : findAppBinary(),
  TAURI_DRIVER_PATH: process.env.TAURI_DRIVER_PATH
    ? process.env.TAURI_DRIVER_PATH
    : join(
        os.homedir(),
        '.cargo',
        'bin',
        process.platform === 'win32' ? 'tauri-driver.exe' : 'tauri-driver'
      ),
};

const hasAppBinary = existsSync(E2E_CONFIG.APP_PATH);
const hasTauriDriver = existsSync(E2E_CONFIG.TAURI_DRIVER_PATH);
const driverVersion = getEdgeDriverVersion();
const webviewVersion = process.env.E2E_WEBVIEW2_VERSION ?? getWebView2Version();
const isForceEnabled = process.env.E2E_FORCE === 'true';
const isDriverCompatible = isForceEnabled
  ? true
  : !!driverVersion &&
    !!webviewVersion &&
    driverVersion.split('.')[0] === webviewVersion.split('.')[0];

const describeE2E = hasAppBinary && hasTauriDriver && isDriverCompatible ? describe : describe.skip;

const clearToasts = async (driver: WebDriver) => {
  await driver.executeScript(`
    document.querySelectorAll('[data-hot-toast]').forEach(node => node.remove());
  `);
};

describeE2E('应用程序端到端测试', () => {
  let driver: WebDriver;
  let tauriDriver: ChildProcess;

  beforeAll(async () => {
    tauriDriver = spawn(E2E_CONFIG.TAURI_DRIVER_PATH, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    await new Promise(resolve => {
      setTimeout(resolve, 2000);
    });

    const capabilities = new Capabilities();
    capabilities.set('tauri:options', {
      application: E2E_CONFIG.APP_PATH,
    });
    capabilities.setBrowserName('wry');

    driver = await new Builder()
      .withCapabilities(capabilities)
      .usingServer(`http://127.0.0.1:${E2E_CONFIG.TAURI_DRIVER_PORT}/`)
      .build();

    await driver.manage().setTimeouts({ implicit: E2E_CONFIG.TIMEOUT });
  }, E2E_CONFIG.APP_START_TIMEOUT);

  afterAll(async () => {
    if (driver) {
      await driver.quit();
    }
    if (tauriDriver) {
      tauriDriver.kill();
    }
  });

  it('应用程序应该成功启动并显示主界面', async () => {
    await driver.wait(
      until.elementLocated(By.css('[data-testid="app-header"]')),
      E2E_CONFIG.TIMEOUT
    );

    const header = await driver.findElement(By.css('[data-testid="app-header"]'));
    expect(await header.isDisplayed()).toBe(true);

    const title = await driver.findElement(By.css('[data-testid="app-title"]'));
    expect(await title.getText()).toContain('Video Downloader');

    const mainContent = await driver.findElement(By.css('[data-testid="main-content"]'));
    expect(await mainContent.isDisplayed()).toBe(true);
  });

  it('应该能够查看下载统计信息', async () => {
    const statsPanel = await driver.findElement(By.css('[data-testid="download-stats"]'));
    expect(await statsPanel.isDisplayed()).toBe(true);

    const totalTasks = await driver.findElement(By.css('[data-testid="total-tasks"]'));
    const activeTasks = await driver.findElement(By.css('[data-testid="active-tasks"]'));
    const completedTasks = await driver.findElement(By.css('[data-testid="completed-tasks"]'));
    const totalDownloaded = await driver.findElement(By.css('[data-testid="total-downloaded"]'));

    expect(await totalTasks.getText()).toMatch(/\d+/);
    expect(await activeTasks.getText()).toMatch(/\d+/);
    expect(await completedTasks.getText()).toMatch(/\d+/);
    expect(await totalDownloaded.getText()).toMatch(/[\d.]+\s*(B|KB|MB|GB)/);
  });

  it('应该能够通过URL添加任务', async () => {
    const urlInput = await driver.findElement(By.css('[data-testid="url-input"]'));
    const addButton = await driver.findElement(By.css('[data-testid="add-url"]'));

    await urlInput.clear();
    await urlInput.sendKeys('https://example.com/video-1.mp4');
    await addButton.click();

    await urlInput.clear();
    await urlInput.sendKeys('https://example.com/video-2.mp4');
    await addButton.click();

    await driver.wait(
      until.elementLocated(By.css('[data-testid="url-entry"]')),
      E2E_CONFIG.TIMEOUT
    );

    const confirmImportButton = await driver.findElement(By.css('[data-testid="confirm-import"]'));
    await confirmImportButton.click();

    await driver.wait(
      until.elementLocated(By.css('[data-testid="task-item"]')),
      E2E_CONFIG.TIMEOUT
    );

    const taskItems = await driver.findElements(By.css('[data-testid="task-item"]'));
    expect(taskItems.length).toBeGreaterThan(0);

    const firstTaskTitle = await taskItems[0].findElement(By.css('[data-testid="task-title"]'));
    expect(await firstTaskTitle.getText()).toContain('任务');
  });

  it('应该能够使用搜索与筛选功能', async () => {
    const searchInput = await driver.findElement(By.css('[data-testid="search-input"]'));
    await searchInput.clear();
    await searchInput.sendKeys('任务_1');

    await driver.wait(
      until.elementLocated(By.css('[data-testid="task-item"]')),
      E2E_CONFIG.TIMEOUT
    );

    const searchResults = await driver.findElements(By.css('[data-testid="task-title"]'));
    expect(searchResults.length).toBeGreaterThan(0);

    const statusFilter = await driver.findElement(By.css('[data-testid="status-filter"]'));
    expect(await statusFilter.isDisplayed()).toBe(true);

    const allFilter = await driver.findElement(By.css('[data-value="all"]'));
    await allFilter.click();

    await searchInput.clear();
  });

  it('应该能够打开并保存设置', async () => {
    await clearToasts(driver);
    const settingsNavItem = await driver.findElement(By.css('[data-testid="nav-settings"]'));
    await driver.executeScript('arguments[0].click();', settingsNavItem);

    const settingsDrawer = await driver.findElement(By.css('[data-testid="settings-drawer"]'));
    await driver.wait(async () => {
      const className = await settingsDrawer.getAttribute('class');
      return className?.includes('translate-x-0');
    }, E2E_CONFIG.TIMEOUT);

    const concurrentDownloads = await driver.findElement(
      By.css('[data-testid="concurrent-downloads"]')
    );
    const retryAttempts = await driver.findElement(By.css('[data-testid="retry-attempts"]'));
    const timeout = await driver.findElement(By.css('[data-testid="timeout-setting"]'));

    await driver.executeScript(
      "arguments[0].scrollIntoView({block: 'center'});",
      concurrentDownloads
    );

    expect(await concurrentDownloads.getAttribute('value')).not.toBeNull();
    expect(await retryAttempts.getAttribute('value')).not.toBeNull();
    expect(await timeout.getAttribute('value')).not.toBeNull();

    const currentValue = await concurrentDownloads.getAttribute('value');
    const nextValue = currentValue ? String(Number(currentValue) + 1) : '4';

    await concurrentDownloads.clear();
    await concurrentDownloads.sendKeys(nextValue);

    const saveButton = await driver.findElement(By.css('[data-testid="save-settings"]'));
    await saveButton.click();

    await driver.sleep(1000);
    const savedValue = await concurrentDownloads.getAttribute('value');
    expect(savedValue).toBe(nextValue);
  });
});
