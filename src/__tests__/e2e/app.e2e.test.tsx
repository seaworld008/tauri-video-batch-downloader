/**
 * 端到端测试 (E2E Tests)
 * 使用 tauri-driver 测试完整的应用程序流程
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Builder, By, until, WebDriver, Capabilities } from 'selenium-webdriver'
import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import os from 'os'

// E2E测试配置
const E2E_CONFIG = {
  TIMEOUT: 30000,
  POLL_INTERVAL: 100,
  APP_START_TIMEOUT: 15000,
  TAURI_DRIVER_PORT: 4444,
  APP_PATH: join(process.cwd(), 'src-tauri/target/debug/video-downloader-tauri.exe')
}

describe('应用程序端到端测试', () => {
  let driver: WebDriver
  let tauriDriver: ChildProcess

  beforeAll(async () => {
    // 启动 tauri-driver
    const tauriDriverPath = join(os.homedir(), '.cargo', 'bin', 'tauri-driver')
    tauriDriver = spawn(tauriDriverPath, [], {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    // 等待 tauri-driver 启动
    await new Promise((resolve) => {
      setTimeout(resolve, 2000)
    })

    // 配置 WebDriver capabilities
    const capabilities = new Capabilities()
    capabilities.set('tauri:options', { 
      application: E2E_CONFIG.APP_PATH 
    })
    capabilities.setBrowserName('wry')

    // 创建 WebDriver 实例
    driver = await new Builder()
      .withCapabilities(capabilities)
      .usingServer(`http://127.0.0.1:${E2E_CONFIG.TAURI_DRIVER_PORT}/`)
      .build()

    // 等待应用启动
    await driver.manage().setTimeouts({ implicit: E2E_CONFIG.TIMEOUT })
  }, E2E_CONFIG.APP_START_TIMEOUT)

  afterAll(async () => {
    if (driver) {
      await driver.quit()
    }
    if (tauriDriver) {
      tauriDriver.kill()
    }
  })

  it('应用程序应该成功启动并显示主界面', async () => {
    // 验证应用标题
    const title = await driver.getTitle()
    expect(title).toBe('视频批量下载器')

    // 验证主要UI元素存在
    const header = await driver.findElement(By.css('[data-testid="app-header"]'))
    expect(await header.isDisplayed()).toBe(true)

    const sidebar = await driver.findElement(By.css('[data-testid="app-sidebar"]'))
    expect(await sidebar.isDisplayed()).toBe(true)

    const mainContent = await driver.findElement(By.css('[data-testid="main-content"]'))
    expect(await mainContent.isDisplayed()).toBe(true)
  })

  it('应该能够导航到下载页面', async () => {
    // 点击导航菜单中的下载页面
    const downloadsNavItem = await driver.findElement(
      By.css('[data-testid="nav-downloads"]')
    )
    await downloadsNavItem.click()

    // 等待页面加载
    await driver.wait(
      until.elementLocated(By.css('[data-testid="downloads-page"]')),
      E2E_CONFIG.TIMEOUT
    )

    // 验证页面内容
    const downloadsPage = await driver.findElement(By.css('[data-testid="downloads-page"]'))
    expect(await downloadsPage.isDisplayed()).toBe(true)

    // 验证关键UI元素
    const importButton = await driver.findElement(By.css('[data-testid="import-button"]'))
    expect(await importButton.isDisplayed()).toBe(true)

    const taskList = await driver.findElement(By.css('[data-testid="task-list"]'))
    expect(await taskList.isDisplayed()).toBe(true)
  })

  it('应该能够打开导入对话框', async () => {
    // 点击导入按钮
    const importButton = await driver.findElement(By.css('[data-testid="import-button"]'))
    await importButton.click()

    // 等待导入对话框出现
    await driver.wait(
      until.elementLocated(By.css('[data-testid="import-dialog"]')),
      E2E_CONFIG.TIMEOUT
    )

    const importDialog = await driver.findElement(By.css('[data-testid="import-dialog"]'))
    expect(await importDialog.isDisplayed()).toBe(true)

    // 验证对话框内容
    const fileInput = await driver.findElement(By.css('input[type="file"]'))
    expect(await fileInput.isDisplayed()).toBe(true)

    const urlTextarea = await driver.findElement(By.css('[data-testid="url-textarea"]'))
    expect(await urlTextarea.isDisplayed()).toBe(true)

    // 关闭对话框
    const closeButton = await driver.findElement(By.css('[data-testid="dialog-close"]'))
    await closeButton.click()

    // 等待对话框消失
    await driver.wait(
      until.stalenessOf(importDialog),
      E2E_CONFIG.TIMEOUT
    )
  })

  it('应该能够通过URL导入下载任务', async () => {
    // 打开导入对话框
    const importButton = await driver.findElement(By.css('[data-testid="import-button"]'))
    await importButton.click()

    await driver.wait(
      until.elementLocated(By.css('[data-testid="import-dialog"]')),
      E2E_CONFIG.TIMEOUT
    )

    // 切换到URL导入标签
    const urlTab = await driver.findElement(By.css('[data-testid="url-import-tab"]'))
    await urlTab.click()

    // 输入测试URL
    const testUrls = [
      'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4',
      'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_2mb.mp4'
    ].join('\n')

    const urlTextarea = await driver.findElement(By.css('[data-testid="url-textarea"]'))
    await urlTextarea.clear()
    await urlTextarea.sendKeys(testUrls)

    // 点击导入按钮
    const confirmImportButton = await driver.findElement(By.css('[data-testid="confirm-import"]'))
    await confirmImportButton.click()

    // 等待任务被添加
    await driver.wait(
      until.elementLocated(By.css('[data-testid="task-item"]')),
      E2E_CONFIG.TIMEOUT
    )

    // 验证任务已添加
    const taskItems = await driver.findElements(By.css('[data-testid="task-item"]'))
    expect(taskItems.length).toBeGreaterThan(0)

    // 验证任务信息
    const firstTask = taskItems[0]
    const taskTitle = await firstTask.findElement(By.css('[data-testid="task-title"]'))
    const titleText = await taskTitle.getText()
    expect(titleText).toContain('SampleVideo')
  })

  it('应该能够启动下载任务', async () => {
    // 找到第一个待下载的任务
    const firstTask = await driver.findElement(By.css('[data-testid="task-item"]'))
    
    // 点击开始下载按钮
    const startButton = await firstTask.findElement(By.css('[data-testid="start-download"]'))
    await startButton.click()

    // 等待任务状态更新
    await driver.sleep(1000)

    // 验证任务状态变为下载中
    const taskStatus = await firstTask.findElement(By.css('[data-testid="task-status"]'))
    const statusText = await taskStatus.getText()
    expect(statusText).toBe('下载中')

    // 验证进度条出现
    const progressBar = await firstTask.findElement(By.css('[data-testid="progress-bar"]'))
    expect(await progressBar.isDisplayed()).toBe(true)
  })

  it('应该能够暂停和恢复下载', async () => {
    // 找到下载中的任务
    const downloadingTask = await driver.findElement(
      By.css('[data-testid="task-item"][data-status="downloading"]')
    )

    // 点击暂停按钮
    const pauseButton = await downloadingTask.findElement(By.css('[data-testid="pause-download"]'))
    await pauseButton.click()

    // 等待状态更新
    await driver.sleep(1000)

    // 验证任务状态变为已暂停
    const taskStatus = await downloadingTask.findElement(By.css('[data-testid="task-status"]'))
    let statusText = await taskStatus.getText()
    expect(statusText).toBe('已暂停')

    // 点击恢复按钮
    const resumeButton = await downloadingTask.findElement(By.css('[data-testid="resume-download"]'))
    await resumeButton.click()

    // 等待状态更新
    await driver.sleep(1000)

    // 验证任务状态恢复为下载中
    statusText = await taskStatus.getText()
    expect(statusText).toBe('下载中')
  })

  it('应该能够使用筛选和搜索功能', async () => {
    // 测试状态筛选
    const statusFilter = await driver.findElement(By.css('[data-testid="status-filter"]'))
    await statusFilter.click()

    const downloadingOption = await driver.findElement(By.css('[data-value="downloading"]'))
    await downloadingOption.click()

    // 验证只显示下载中的任务
    await driver.sleep(500)
    const visibleTasks = await driver.findElements(By.css('[data-testid="task-item"]:not([style*="display: none"])'))
    expect(visibleTasks.length).toBeGreaterThan(0)

    for (const task of visibleTasks) {
      const status = await task.findElement(By.css('[data-testid="task-status"]'))
      const statusText = await status.getText()
      expect(statusText).toBe('下载中')
    }

    // 重置筛选
    await statusFilter.click()
    const allOption = await driver.findElement(By.css('[data-value="all"]'))
    await allOption.click()

    // 测试搜索功能
    const searchInput = await driver.findElement(By.css('[data-testid="search-input"]'))
    await searchInput.clear()
    await searchInput.sendKeys('SampleVideo')

    // 验证搜索结果
    await driver.sleep(500)
    const searchResults = await driver.findElements(By.css('[data-testid="task-item"]:not([style*="display: none"])'))
    
    for (const result of searchResults) {
      const title = await result.findElement(By.css('[data-testid="task-title"]'))
      const titleText = await title.getText()
      expect(titleText.toLowerCase()).toContain('samplevideo')
    }

    // 清除搜索
    await searchInput.clear()
  })

  it('应该能够管理批量操作', async () => {
    // 选择多个任务
    const taskCheckboxes = await driver.findElements(By.css('[data-testid="task-checkbox"]'))
    
    // 至少选择两个任务
    if (taskCheckboxes.length >= 2) {
      await taskCheckboxes[0].click()
      await taskCheckboxes[1].click()

      // 打开批量操作菜单
      const batchActionsButton = await driver.findElement(By.css('[data-testid="batch-actions"]'))
      await batchActionsButton.click()

      // 验证批量操作选项可见
      const batchMenu = await driver.findElement(By.css('[data-testid="batch-menu"]'))
      expect(await batchMenu.isDisplayed()).toBe(true)

      const startAllButton = await driver.findElement(By.css('[data-testid="batch-start"]'))
      const pauseAllButton = await driver.findElement(By.css('[data-testid="batch-pause"]'))
      const removeAllButton = await driver.findElement(By.css('[data-testid="batch-remove"]'))

      expect(await startAllButton.isDisplayed()).toBe(true)
      expect(await pauseAllButton.isDisplayed()).toBe(true)
      expect(await removeAllButton.isDisplayed()).toBe(true)

      // 关闭菜单（点击外部区域）
      const mainContent = await driver.findElement(By.css('[data-testid="main-content"]'))
      await mainContent.click()

      await driver.wait(
        until.stalenessOf(batchMenu),
        E2E_CONFIG.TIMEOUT
      )
    }
  })

  it('应该能够查看下载统计信息', async () => {
    // 验证统计信息面板存在
    const statsPanel = await driver.findElement(By.css('[data-testid="download-stats"]'))
    expect(await statsPanel.isDisplayed()).toBe(true)

    // 验证各项统计数据
    const totalTasks = await driver.findElement(By.css('[data-testid="total-tasks"]'))
    const totalTasksText = await totalTasks.getText()
    expect(totalTasksText).toMatch(/\d+/)

    const activeTasks = await driver.findElement(By.css('[data-testid="active-tasks"]'))
    const activeTasksText = await activeTasks.getText()
    expect(activeTasksText).toMatch(/\d+/)

    const completedTasks = await driver.findElement(By.css('[data-testid="completed-tasks"]'))
    const completedTasksText = await completedTasks.getText()
    expect(completedTasksText).toMatch(/\d+/)

    const totalDownloaded = await driver.findElement(By.css('[data-testid="total-downloaded"]'))
    const totalDownloadedText = await totalDownloaded.getText()
    expect(totalDownloadedText).toMatch(/[\d.]+\s*(B|KB|MB|GB)/)
  })

  it('应该能够打开和配置设置页面', async () => {
    // 导航到设置页面
    const settingsNavItem = await driver.findElement(By.css('[data-testid="nav-settings"]'))
    await settingsNavItem.click()

    // 等待设置页面加载
    await driver.wait(
      until.elementLocated(By.css('[data-testid="settings-page"]')),
      E2E_CONFIG.TIMEOUT
    )

    const settingsPage = await driver.findElement(By.css('[data-testid="settings-page"]'))
    expect(await settingsPage.isDisplayed()).toBe(true)

    // 验证设置选项
    const concurrentDownloads = await driver.findElement(By.css('[data-testid="concurrent-downloads"]'))
    const retryAttempts = await driver.findElement(By.css('[data-testid="retry-attempts"]'))
    const timeout = await driver.findElement(By.css('[data-testid="timeout-setting"]'))

    expect(await concurrentDownloads.isDisplayed()).toBe(true)
    expect(await retryAttempts.isDisplayed()).toBe(true)
    expect(await timeout.isDisplayed()).toBe(true)

    // 测试设置修改
    await concurrentDownloads.clear()
    await concurrentDownloads.sendKeys('5')

    // 保存设置
    const saveButton = await driver.findElement(By.css('[data-testid="save-settings"]'))
    await saveButton.click()

    // 验证设置已保存
    await driver.sleep(1000)
    const savedValue = await concurrentDownloads.getAttribute('value')
    expect(savedValue).toBe('5')
  })

  it('应用程序应该能够正确处理错误状态', async () => {
    // 返回下载页面
    const downloadsNavItem = await driver.findElement(By.css('[data-testid="nav-downloads"]'))
    await downloadsNavItem.click()

    // 添加一个无效的URL来测试错误处理
    const importButton = await driver.findElement(By.css('[data-testid="import-button"]'))
    await importButton.click()

    await driver.wait(
      until.elementLocated(By.css('[data-testid="import-dialog"]')),
      E2E_CONFIG.TIMEOUT
    )

    const urlTextarea = await driver.findElement(By.css('[data-testid="url-textarea"]'))
    await urlTextarea.clear()
    await urlTextarea.sendKeys('https://invalid-url-that-does-not-exist.com/video.mp4')

    const confirmImportButton = await driver.findElement(By.css('[data-testid="confirm-import"]'))
    await confirmImportButton.click()

    // 等待错误任务出现
    await driver.sleep(2000)

    // 尝试下载这个无效的任务
    const invalidTask = await driver.findElements(By.css('[data-testid="task-item"]'))
    const lastTask = invalidTask[invalidTask.length - 1]

    const startButton = await lastTask.findElement(By.css('[data-testid="start-download"]'))
    await startButton.click()

    // 等待错误状态出现
    await driver.sleep(3000)

    const taskStatus = await lastTask.findElement(By.css('[data-testid="task-status"]'))
    const statusText = await taskStatus.getText()
    expect(statusText).toBe('失败')

    // 验证错误信息显示
    const errorMessage = await lastTask.findElement(By.css('[data-testid="error-message"]'))
    expect(await errorMessage.isDisplayed()).toBe(true)

    const errorText = await errorMessage.getText()
    expect(errorText.length).toBeGreaterThan(0)
  })
})