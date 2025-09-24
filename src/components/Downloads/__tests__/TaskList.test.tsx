import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaskList } from '../TaskList'
import type { VideoTask } from '../../../types'

// Mock @tanstack/react-virtual
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    scrollToIndex: vi.fn()
  })
}))

describe('TaskList', () => {
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

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders task list component without crashing', () => {
    render(<TaskList tasks={mockTasks} />)
    
    // TaskList should render some content
    expect(screen.getByRole('region')).toBeInTheDocument()
  })

  it('renders virtual scrolling container', () => {
    render(<TaskList tasks={mockTasks} />)
    
    // Should render the virtualized list container
    const listContainer = screen.getByRole('region')
    expect(listContainer).toBeInTheDocument()
  })

  it('handles empty task list', () => {
    render(<TaskList tasks={[]} />)
    
    // Should still render the container
    expect(screen.getByRole('region')).toBeInTheDocument()
  })

  it('handles large task lists with virtual scrolling', () => {
    const largeTasks = Array.from({ length: 1000 }, (_, i) => ({
      ...mockTasks[0],
      id: `task-${i}`,
      title: `Video ${i}`
    }))

    const { container } = render(<TaskList tasks={largeTasks} />)
    
    // Should render without performance issues due to virtualization
    expect(container).toBeInTheDocument()
  })

  it('provides correct ARIA attributes', () => {
    render(<TaskList tasks={mockTasks} />)
    
    const container = screen.getByRole('region')
    expect(container).toHaveAttribute('aria-label', '下载任务列表')
  })

  it('re-renders when tasks prop changes', () => {
    const { rerender } = render(<TaskList tasks={[mockTasks[0]]} />)
    
    // Initial render with one task
    expect(screen.getByRole('region')).toBeInTheDocument()
    
    // Re-render with different tasks
    rerender(<TaskList tasks={mockTasks} />)
    
    // Should still render properly
    expect(screen.getByRole('region')).toBeInTheDocument()
  })
})