import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDownloadStore } from '../downloadStore'
import { invoke } from '@tauri-apps/api/tauri'

// Mock Tauri API
vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn().mockResolvedValue([])
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {})
}))

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn()
  }
}))

describe('downloadStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue([])
    
    // Reset store state between tests
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
  })

  describe('initial state', () => {
    it('has correct initial state', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      expect(result.current.tasks).toEqual([])
      expect(result.current.searchQuery).toBe('')
      expect(result.current.filterStatus).toBe('all')
      expect(result.current.isLoading).toBe(false)
      expect(result.current.selectedTasks).toEqual([])
      expect(result.current.isImporting).toBe(false)
    })

    it('has correct initial stats', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      expect(result.current.stats).toEqual({
        total_tasks: 0,
        completed_tasks: 0,
        failed_tasks: 0,
        total_downloaded: 0,
        average_speed: 0,
        active_downloads: 0
      })
    })

    it('has correct initial config', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      expect(result.current.config).toBeDefined()
      expect(result.current.config.concurrent_downloads).toBe(3)
      expect(result.current.config.retry_attempts).toBe(3)
      expect(result.current.config.timeout_seconds).toBe(30)
    })
  })

  describe('UI state management', () => {
    it('updates search query', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      act(() => {
        result.current.setSearchQuery('test query')
      })
      
      expect(result.current.searchQuery).toBe('test query')
    })

    it('updates filter status', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      act(() => {
        result.current.setFilterStatus('downloading')
      })
      
      expect(result.current.filterStatus).toBe('downloading')
    })

    it('manages selected tasks', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      act(() => {
        result.current.setSelectedTasks(['task1', 'task2'])
      })
      
      expect(result.current.selectedTasks).toEqual(['task1', 'task2'])
    })

    it('toggles task selection', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      // Start with no selections
      expect(result.current.selectedTasks).toEqual([])
      
      // Add first task
      act(() => {
        result.current.toggleTaskSelection('task1')
      })
      
      expect(result.current.selectedTasks).toEqual(['task1'])
      
      // Add second task
      act(() => {
        result.current.toggleTaskSelection('task2')
      })
      
      expect(result.current.selectedTasks).toEqual(['task1', 'task2'])
      
      // Remove first task
      act(() => {
        result.current.toggleTaskSelection('task1')
      })
      
      expect(result.current.selectedTasks).toEqual(['task2'])
      
      // Remove second task
      act(() => {
        result.current.toggleTaskSelection('task2')
      })
      
      expect(result.current.selectedTasks).toEqual([])
    })

    it('clears selection', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      act(() => {
        result.current.setSelectedTasks(['task1', 'task2'])
        result.current.clearSelection()
      })
      
      expect(result.current.selectedTasks).toEqual([])
    })
  })

  describe('sorting configuration', () => {
    it('sets sort by field', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      act(() => {
        result.current.setSortBy('title')
      })
      
      expect(result.current.sortBy).toBe('title')
      expect(result.current.sortDirection).toBe('asc')
    })

    it('toggles sort direction when setting same field', () => {
      const { result } = renderHook(() => useDownloadStore())
      
      act(() => {
        result.current.setSortBy('title', 'asc')
      })
      
      expect(result.current.sortBy).toBe('title')
      expect(result.current.sortDirection).toBe('asc')
      
      act(() => {
        result.current.setSortBy('title')
      })
      
      expect(result.current.sortDirection).toBe('desc')
    })
  })

  describe('async operations', () => {
    it('calls correct Tauri command for adding tasks', async () => {
      const { result } = renderHook(() => useDownloadStore())
      const mockTasks = [
        {
          url: 'https://example.com/video.mp4',
          title: 'Test Video',
          output_path: '/downloads/video.mp4',
          progress: 0,
          downloaded_size: 0,
          speed: 0,
          eta: undefined,
          error_message: undefined
        }
      ]
      
      vi.mocked(invoke).mockResolvedValue([])
      
      await act(async () => {
        await result.current.addTasks(mockTasks)
      })
      
      expect(invoke).toHaveBeenCalledWith('add_download_tasks', { tasks: mockTasks })
    })

    it('calls correct Tauri command for removing tasks', async () => {
      const { result } = renderHook(() => useDownloadStore())
      const taskIds = ['task1', 'task2']
      
      await act(async () => {
        await result.current.removeTasks(taskIds)
      })
      
      expect(invoke).toHaveBeenCalledWith('remove_download_tasks', { task_ids: taskIds })
    })

    it('calls correct Tauri command for download control', async () => {
      const { result } = renderHook(() => useDownloadStore())
      const taskId = 'test-task-id'
      
      await act(async () => {
        await result.current.startDownload(taskId)
      })
      
      expect(invoke).toHaveBeenCalledWith('start_download', { task_id: taskId })
      
      await act(async () => {
        await result.current.pauseDownload(taskId)
      })
      
      expect(invoke).toHaveBeenCalledWith('pause_download', { task_id: taskId })
      
      await act(async () => {
        await result.current.resumeDownload(taskId)
      })
      
      expect(invoke).toHaveBeenCalledWith('resume_download', { task_id: taskId })
    })

    it('handles initialization correctly', async () => {
      const { result } = renderHook(() => useDownloadStore())
      
      const mockTasks = []
      const mockConfig = { concurrent_downloads: 3 }
      const mockStats = { total_tasks: 0 }
      
      vi.mocked(invoke)
        .mockResolvedValueOnce(mockTasks)
        .mockResolvedValueOnce(mockConfig)
        .mockResolvedValueOnce(mockStats)
      
      await act(async () => {
        await result.current.initializeStore()
      })
      
      expect(invoke).toHaveBeenCalledWith('get_download_tasks')
      expect(invoke).toHaveBeenCalledWith('get_config')
      expect(invoke).toHaveBeenCalledWith('get_download_stats')
    })

    it('refreshes data correctly', async () => {
      const { result } = renderHook(() => useDownloadStore())
      
      await act(async () => {
        await result.current.refreshTasks()
      })
      
      expect(invoke).toHaveBeenCalledWith('get_download_tasks')
      
      await act(async () => {
        await result.current.refreshStats()
      })
      
      expect(invoke).toHaveBeenCalledWith('get_download_stats')
    })
  })

  describe('error handling', () => {
    it('handles add tasks error gracefully', async () => {
      const { result } = renderHook(() => useDownloadStore())
      
      vi.mocked(invoke).mockRejectedValue(new Error('Failed to add tasks'))
      
      await act(async () => {
        await result.current.addTasks([])
      })
      
      expect(result.current.isLoading).toBe(false)
    })

    it('handles initialization error gracefully', async () => {
      const { result } = renderHook(() => useDownloadStore())
      
      vi.mocked(invoke).mockRejectedValue(new Error('Initialization failed'))
      
      await act(async () => {
        await result.current.initializeStore()
      })
      
      expect(result.current.isLoading).toBe(false)
    })
  })
})