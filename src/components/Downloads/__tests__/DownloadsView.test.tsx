import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DownloadsView } from '../DownloadsView'
import { useDownloadStore } from '../../../stores/downloadStore'
import type { VideoTask } from '../../../types'

// Mock the download store
vi.mock('../../../stores/downloadStore')
const mockUseDownloadStore = vi.mocked(useDownloadStore)

// Mock child components
vi.mock('../TaskList', () => ({
  TaskList: ({ tasks }: { tasks: VideoTask[] }) => (
    <div data-testid="task-list">
      Tasks: {tasks.length}
    </div>
  )
}))

vi.mock('../TaskControls', () => ({
  TaskControls: ({ selectedTasks }: { selectedTasks: string[] }) => (
    <div data-testid="task-controls">
      Selected: {selectedTasks.length}
    </div>
  )
}))

vi.mock('../DownloadStats', () => ({
  DownloadStats: ({ stats }: { stats: any }) => (
    <div data-testid="download-stats">
      Total: {stats.total_tasks}
    </div>
  )
}))

vi.mock('../SearchAndFilter', () => ({
  SearchAndFilter: () => <div data-testid="search-filter">Search</div>
}))

vi.mock('../../Common/EmptyState', () => ({
  EmptyState: ({ title }: { title: string }) => (
    <div data-testid="empty-state">{title}</div>
  )
}))

describe('DownloadsView', () => {
  const mockTasks: VideoTask[] = [
    {
      id: '1',
      title: 'Test Video 1',
      url: 'https://example.com/video1.mp4',
      output_path: '/downloads/video1.mp4',
      status: 'pending',
      progress: 0,
      downloaded_size: 0,
      speed: 0,
      created_at: '2024-01-01T10:00:00Z',
      updated_at: '2024-01-01T10:00:00Z'
    },
    {
      id: '2',
      title: 'Test Video 2',
      url: 'https://example.com/video2.mp4',
      output_path: '/downloads/video2.mp4',
      status: 'downloading',
      progress: 45.5,
      downloaded_size: 1024 * 1024,
      speed: 1024 * 500,
      created_at: '2024-01-01T10:30:00Z',
      updated_at: '2024-01-01T10:35:00Z'
    }
  ]

  const mockStore = {
    tasks: mockTasks,
    stats: {
      total_tasks: 2,
      completed_tasks: 0,
      failed_tasks: 0,
      total_downloaded: 1024 * 1024,
      average_speed: 1024 * 500,
      active_downloads: 1
    },
    isLoading: false,
    filterStatus: 'all' as const,
    searchQuery: '',
    selectedTasks: [],
    refreshTasks: vi.fn(),
    refreshStats: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseDownloadStore.mockReturnValue(mockStore)
  })

  it('renders download stats correctly', () => {
    render(<DownloadsView />)
    expect(screen.getByTestId('download-stats')).toHaveTextContent('Total: 2')
  })

  it('renders task controls', () => {
    render(<DownloadsView />)
    expect(screen.getByTestId('task-controls')).toBeInTheDocument()
  })

  it('renders task list with correct number of tasks', () => {
    render(<DownloadsView />)
    expect(screen.getByTestId('task-list')).toHaveTextContent('Tasks: 2')
  })

  it('renders search and filter component', () => {
    render(<DownloadsView />)
    expect(screen.getByTestId('search-filter')).toBeInTheDocument()
  })

  it('shows loading state', () => {
    mockUseDownloadStore.mockReturnValue({
      ...mockStore,
      isLoading: true,
      tasks: []
    })

    render(<DownloadsView />)
    expect(screen.getByText('加载下载任务...')).toBeInTheDocument()
  })

  it('shows empty state when no tasks', () => {
    mockUseDownloadStore.mockReturnValue({
      ...mockStore,
      tasks: []
    })

    render(<DownloadsView />)
    expect(screen.getByTestId('empty-state')).toHaveTextContent('暂无下载任务')
  })

  it('filters tasks based on filterStatus', () => {
    const tasksWithDifferentStatuses: VideoTask[] = [
      { ...mockTasks[0], status: 'pending' },
      { ...mockTasks[1], status: 'downloading' },
      { ...mockTasks[0], id: '3', status: 'completed' }
    ]

    mockUseDownloadStore.mockReturnValue({
      ...mockStore,
      tasks: tasksWithDifferentStatuses,
      filterStatus: 'downloading'
    })

    render(<DownloadsView />)
    
    // Should show only 1 downloading task to TaskList
    expect(screen.getByTestId('task-list')).toHaveTextContent('Tasks: 1')
  })

  it('filters tasks based on search query', () => {
    mockUseDownloadStore.mockReturnValue({
      ...mockStore,
      searchQuery: 'Video 1'
    })

    render(<DownloadsView />)
    
    // Should show only 1 task matching the search
    expect(screen.getByTestId('task-list')).toHaveTextContent('Tasks: 1')
  })
})