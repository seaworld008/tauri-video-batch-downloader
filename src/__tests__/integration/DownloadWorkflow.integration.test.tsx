/**
 * 下载流程集成测试
 * 测试 Store 和逻辑层的集成，不依赖具体的 React 组件
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { randomFillSync } from 'crypto'
import '@testing-library/jest-dom'

import { mockIPC, clearMocks } from '@tauri-apps/api/mocks'
import { useDownloadStore } from '../../stores/downloadStore'
import type { VideoTask, DownloadStats } from '../../types'

// jsdom doesn't come with a WebCrypto implementation
beforeEach(() => {
  Object.defineProperty(window, 'crypto', {
    value: {
      // @ts-ignore
      getRandomValues: (buffer: any) => {
        return randomFillSync(buffer);
      },
    },
  });

  // Reset store state
  useDownloadStore.setState({
    tasks: [],
    selectedTasks: [],
    searchQuery: '',
    filterStatus: 'all',
    isLoading: false,
    isImporting: false,
    sortBy: 'created_at',
    sortDirection: 'desc',
  })
});

afterEach(() => {
  clearMocks()
  vi.clearAllMocks()
})

const mockTasks: VideoTask[] = [
  {
    id: 'task-1',
    url: 'https://example.com/video1.mp4',
    title: '测试视频 1',
    output_path: '/downloads/video1.mp4',
    status: 'pending',
    progress: 0,
    downloaded_size: 0,
    file_size: 1024 * 1024 * 100, // 100MB
    speed: 0,
    eta: null,
    error_message: null,
    created_at: '2024-01-01T10:00:00Z',
    updated_at: '2024-01-01T10:00:00Z',
    downloader_type: 'http'
  },
  {
    id: 'task-2', 
    url: 'https://example.com/video2.mp4',
    title: '测试视频 2',
    output_path: '/downloads/video2.mp4',
    status: 'downloading',
    progress: 45.5,
    downloaded_size: 1024 * 1024 * 45,
    file_size: 1024 * 1024 * 100,
    speed: 1024 * 512, // 512KB/s
    eta: 120, // 2 minutes
    error_message: null,
    created_at: '2024-01-01T10:00:00Z',
    updated_at: '2024-01-01T10:05:00Z',
    downloader_type: 'http'
  }
]

const mockStats: DownloadStats = {
  total_tasks: 2,
  completed_tasks: 0,
  failed_tasks: 0,
  total_downloaded: 1024 * 1024 * 45,
  average_speed: 1024 * 512,
  active_downloads: 1
}

describe('下载流程集成测试 - Store Level', () => {
  it('应该能够初始化 Store 并获取数据', async () => {
    // Mock IPC calls
    mockIPC((cmd, args) => {
      switch (cmd) {
        case 'get_download_tasks':
          return mockTasks
        case 'get_download_stats':
          return mockStats
        case 'get_config':
          return {
            concurrent_downloads: 3,
            retry_attempts: 3,
            timeout_seconds: 30,
            user_agent: 'Test Agent',
            output_directory: '/downloads'
          }
        default:
          return Promise.resolve()
      }
    })

    // 初始化 store
    await useDownloadStore.getState().initializeStore()

    // 验证数据已加载
    const state = useDownloadStore.getState()
    expect(state.tasks).toHaveLength(2)
    expect(state.stats.total_tasks).toBe(2)
    expect(state.stats.active_downloads).toBe(1)
    expect(state.isLoading).toBe(false)

    // 验证任务内容
    const task1 = state.tasks.find(t => t.id === 'task-1')
    expect(task1).toBeDefined()
    expect(task1?.title).toBe('测试视频 1')
    expect(task1?.status).toBe('pending')

    const task2 = state.tasks.find(t => t.id === 'task-2')
    expect(task2).toBeDefined()
    expect(task2?.title).toBe('测试视频 2')
    expect(task2?.status).toBe('downloading')
    expect(task2?.progress).toBe(45.5)
  })

  it('应该能够添加新任务', async () => {
    // Mock IPC calls
    mockIPC((cmd, args) => {
      switch (cmd) {
        case 'add_download_tasks':
          // 模拟返回添加的任务（带有服务端生成的ID）
          const tasks = (args as any).tasks.map((task: any, index: number) => ({
            ...task,
            id: `new-task-${index}`,
            status: 'pending',
            progress: 0,
            downloaded_size: 0,
            speed: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }))
          return tasks
        case 'get_download_stats':
          return { ...mockStats, total_tasks: mockStats.total_tasks + 1 }
        default:
          return Promise.resolve()
      }
    })

    const store = useDownloadStore.getState()
    
    // 添加新任务
    const newTasks = [{
      url: 'https://example.com/new-video.mp4',
      title: '新视频',
      output_path: '/downloads/new-video.mp4',
      progress: 0,
      downloaded_size: 0,
      speed: 0,
      eta: undefined,
      error_message: undefined
    }]

    await store.addTasks(newTasks)

    // 验证任务已添加
    const updatedState = useDownloadStore.getState()
    expect(updatedState.tasks).toHaveLength(1) // 由于重置了state，只有新添加的任务
    expect(updatedState.tasks[0].title).toBe('新视频')
    expect(updatedState.tasks[0].id).toBe('new-task-0')
  })

  it('应该能够启动下载任务', async () => {
    // 设置初始任务
    useDownloadStore.setState({
      tasks: [mockTasks[0]] // 只用第一个任务（pending状态）
    })

    let downloadStarted = false

    // Mock IPC calls
    mockIPC((cmd, args) => {
      switch (cmd) {
        case 'start_download':
          downloadStarted = true
          expect((args as any).taskId).toBe('task-1')
          return Promise.resolve()
        default:
          return Promise.resolve()
      }
    })

    const store = useDownloadStore.getState()
    
    // 启动下载
    await store.startDownload('task-1')

    // 验证IPC调用
    expect(downloadStarted).toBe(true)

    // 验证任务状态已更新
    const updatedState = useDownloadStore.getState()
    const task = updatedState.tasks.find(t => t.id === 'task-1')
    expect(task?.status).toBe('downloading')
  })

  it('应该能够管理任务选择状态', () => {
    // 设置初始任务
    useDownloadStore.setState({
      tasks: mockTasks,
      selectedTasks: []
    })

    const store = useDownloadStore.getState()

    // 测试单个任务选择
    store.toggleTaskSelection('task-1')
    expect(useDownloadStore.getState().selectedTasks).toEqual(['task-1'])

    // 测试取消选择
    store.toggleTaskSelection('task-1')
    expect(useDownloadStore.getState().selectedTasks).toEqual([])

    // 测试多任务选择
    store.setSelectedTasks(['task-1', 'task-2'])
    expect(useDownloadStore.getState().selectedTasks).toEqual(['task-1', 'task-2'])

    // 测试全选
    store.selectAllTasks()
    const allIds = mockTasks.map(t => t.id)
    expect(useDownloadStore.getState().selectedTasks).toEqual(allIds)

    // 测试清除选择
    store.clearSelection()
    expect(useDownloadStore.getState().selectedTasks).toEqual([])
  })

  it('应该能够处理筛选和搜索', () => {
    // 设置初始任务
    useDownloadStore.setState({
      tasks: mockTasks,
      searchQuery: '',
      filterStatus: 'all'
    })

    const store = useDownloadStore.getState()

    // 测试状态筛选
    store.setFilterStatus('downloading')
    expect(useDownloadStore.getState().filterStatus).toBe('downloading')

    store.setFilterStatus('pending')
    expect(useDownloadStore.getState().filterStatus).toBe('pending')

    // 测试搜索
    store.setSearchQuery('视频 1')
    expect(useDownloadStore.getState().searchQuery).toBe('视频 1')

    store.setSearchQuery('')
    expect(useDownloadStore.getState().searchQuery).toBe('')
  })

  it('应该能够处理批量操作', async () => {
    // 设置初始任务
    useDownloadStore.setState({
      tasks: mockTasks,
      selectedTasks: ['task-1', 'task-2']
    })

    let removedTaskIds: string[] = []

    // Mock IPC calls
    mockIPC((cmd, args) => {
      switch (cmd) {
        case 'remove_download_tasks':
          removedTaskIds = (args as any).taskIds
          return Promise.resolve()
        case 'get_download_stats':
          return { ...mockStats, total_tasks: mockStats.total_tasks - removedTaskIds.length }
        default:
          return Promise.resolve()
      }
    })

    const store = useDownloadStore.getState()
    
    // 执行批量删除
    await store.removeTasks(['task-1', 'task-2'])

    // 验证IPC调用
    expect(removedTaskIds).toEqual(['task-1', 'task-2'])

    // 验证任务已从store中移除
    const updatedState = useDownloadStore.getState()
    expect(updatedState.tasks).toHaveLength(0)
    expect(updatedState.selectedTasks).toHaveLength(0)
  })

  it('应该能够处理错误状态', async () => {
    // Mock IPC calls with error
    mockIPC((cmd, args) => {
      switch (cmd) {
        case 'add_download_tasks':
          throw new Error('Failed to add tasks')
        default:
          return Promise.resolve()
      }
    })

    const store = useDownloadStore.getState()
    
    // 尝试添加任务（应该失败）
    const newTasks = [{
      url: 'https://example.com/error-video.mp4',
      title: '错误视频',
      output_path: '/downloads/error-video.mp4',
      progress: 0,
      downloaded_size: 0,
      speed: 0,
      eta: undefined,
      error_message: undefined
    }]

    // addTasks 方法内部处理错误，不会抛出错误到外部
    await store.addTasks(newTasks)

    // 验证错误处理
    const state = useDownloadStore.getState()
    expect(state.isLoading).toBe(false) // 应该停止loading状态
    expect(state.tasks).toHaveLength(0) // 任务不应该被添加
  })

  it('应该能够更新配置', async () => {
    let configUpdated = false
    let updatedConfig: any

    // Mock IPC calls
    mockIPC((cmd, args) => {
      switch (cmd) {
        case 'update_config':
          configUpdated = true
          updatedConfig = (args as any).config
          return Promise.resolve()
        default:
          return Promise.resolve()
      }
    })

    const store = useDownloadStore.getState()
    
    // 更新配置
    const newConfig = {
      concurrent_downloads: 5,
      retry_attempts: 5,
      timeout_seconds: 60
    }

    await store.updateConfig(newConfig)

    // 验证IPC调用
    expect(configUpdated).toBe(true)
    expect(updatedConfig).toMatchObject(newConfig)

    // 验证配置已更新
    const updatedState = useDownloadStore.getState()
    expect(updatedState.config.concurrent_downloads).toBe(5)
    expect(updatedState.config.retry_attempts).toBe(5)
    expect(updatedState.config.timeout_seconds).toBe(60)
  })

  it('应该能够处理排序功能', () => {
    // 设置初始任务（按创建时间倒序）
    useDownloadStore.setState({
      tasks: mockTasks,
      sortBy: 'created_at',
      sortDirection: 'desc'
    })

    const store = useDownloadStore.getState()

    // 测试按标题排序
    store.setSortBy('title')
    let state = useDownloadStore.getState()
    expect(state.sortBy).toBe('title')
    expect(state.sortDirection).toBe('asc') // 默认升序

    // 再次点击相同字段应该切换排序方向
    store.setSortBy('title')
    state = useDownloadStore.getState()
    expect(state.sortBy).toBe('title')
    expect(state.sortDirection).toBe('desc')

    // 测试按进度排序
    store.setSortBy('progress', 'asc')
    state = useDownloadStore.getState()
    expect(state.sortBy).toBe('progress')
    expect(state.sortDirection).toBe('asc')
  })
})