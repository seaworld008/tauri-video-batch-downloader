import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  formatBytes,
  formatDuration,
  formatSpeed,
  formatDate,
  formatRelativeTime,
  formatNumber,
  truncateText,
  formatPercentage,
  formatFileName,
  formatTaskStatus,
  formatETA
} from '../format'

describe('formatBytes', () => {
  it('formats bytes correctly', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1 MB')
    expect(formatBytes(1024 * 1024 * 1.5)).toBe('1.5 MB')
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB')
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1 TB')
  })

  it('handles negative values', () => {
    expect(formatBytes(-1024)).toBe('0 B')
  })

  it('handles custom decimal places', () => {
    expect(formatBytes(1536, 2)).toBe('1.5 KB')
    expect(formatBytes(1536, 0)).toBe('2 KB')
  })

  it('handles very large numbers', () => {
    const petabyte = 1024 ** 5
    expect(formatBytes(petabyte)).toBe('1 PB')
  })
})

describe('formatDuration', () => {
  it('formats duration in seconds correctly', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(30)).toBe('30s')
    expect(formatDuration(60)).toBe('1m')
    expect(formatDuration(90)).toBe('1m 30s')
    expect(formatDuration(3600)).toBe('1h')
    expect(formatDuration(3661)).toBe('1h 1m 1s')
    expect(formatDuration(86400)).toBe('24h')
  })

  it('handles decimal seconds', () => {
    expect(formatDuration(1.5)).toBe('1s')
    expect(formatDuration(59.9)).toBe('59s')
  })

  it('handles negative duration', () => {
    expect(formatDuration(-30)).toBe('0s')
  })

  it('formats large durations', () => {
    expect(formatDuration(86400 * 2)).toBe('48h') // 2 days = 48h
  })
})

describe('formatSpeed', () => {
  it('formats speed correctly', () => {
    expect(formatSpeed(0)).toBe('0 B/s')
    expect(formatSpeed(512)).toBe('512 B/s')
    expect(formatSpeed(1024)).toBe('1 KB/s')
    expect(formatSpeed(1024 * 1024)).toBe('1 MB/s')
    expect(formatSpeed(1024 * 1024 * 10.5)).toBe('10.5 MB/s')
  })

  it('handles negative speed', () => {
    expect(formatSpeed(-1024)).toBe('0 B/s')
  })
})

describe('formatDate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats recent dates as relative time', () => {
    // 5 minutes ago
    const fiveMinutesAgo = new Date('2024-01-15T11:55:00Z').toISOString()
    expect(formatDate(fiveMinutesAgo)).toBe('5分钟前')
    
    // 2 hours ago
    const twoHoursAgo = new Date('2024-01-15T10:00:00Z').toISOString()
    expect(formatDate(twoHoursAgo)).toBe('2小时前')
  })

  it('formats older dates as absolute time', () => {
    // 2 weeks ago - should show absolute date (note: timezone offset may affect time)
    const twoWeeksAgo = new Date('2024-01-01T10:30:45Z').toISOString()
    const result = formatDate(twoWeeksAgo)
    expect(result).toMatch(/01-01 \d{2}:\d{2}/) // flexible time due to timezone
  })

  it('handles just now', () => {
    const now = new Date('2024-01-15T12:00:00Z').toISOString()
    expect(formatDate(now)).toBe('刚刚')
  })

  it('handles invalid dates', () => {
    expect(formatDate('invalid-date')).toBe('无效日期')
  })
})

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats relative time using Intl.RelativeTimeFormat', () => {
    const now = new Date('2024-01-15T12:00:00Z').toISOString()
    expect(formatRelativeTime(now)).toBe('刚刚')
    
    const fiveMinutesAgo = new Date('2024-01-15T11:55:00Z').toISOString()
    // This will use Intl.RelativeTimeFormat which may vary by locale
    const result = formatRelativeTime(fiveMinutesAgo)
    expect(typeof result).toBe('string')
    expect(result).toContain('分钟')
  })

  it('handles invalid dates', () => {
    expect(formatRelativeTime('invalid-date')).toBe('无效日期')
  })
})

describe('formatPercentage', () => {
  it('formats percentage correctly', () => {
    expect(formatPercentage(0)).toBe('0.0%')
    expect(formatPercentage(50)).toBe('50.0%')
    expect(formatPercentage(99.9)).toBe('99.9%')
    expect(formatPercentage(100)).toBe('100.0%')
  })

  it('handles custom decimal places', () => {
    expect(formatPercentage(33.333, 2)).toBe('33.33%')
    expect(formatPercentage(66.666, 0)).toBe('67%')
  })
})

describe('formatNumber', () => {
  it('formats numbers with locale-specific formatting', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(123)).toBe('123')
    expect(formatNumber(1234)).toBe('1,234')
    expect(formatNumber(12345)).toBe('12,345')
    expect(formatNumber(123456789)).toBe('123,456,789')
  })

  it('handles negative numbers', () => {
    expect(formatNumber(-1234)).toBe('-1,234')
  })

  it('handles decimal numbers', () => {
    expect(formatNumber(1234.56)).toBe('1,234.56')
  })
})

describe('truncateText', () => {
  it('truncates text correctly', () => {
    const longText = 'This is a very long text that should be truncated'
    
    expect(truncateText(longText, 10)).toBe('This is...')
    expect(truncateText(longText, 20)).toBe('This is a very lo...')
    expect(truncateText('Short', 10)).toBe('Short')
  })

  it('handles text exactly at max length', () => {
    const text = 'Exactly 10'
    expect(truncateText(text, 10)).toBe('Exactly 10')
  })

  it('handles edge cases', () => {
    expect(truncateText('', 10)).toBe('')
    expect(truncateText('Text', 3)).toBe('...')
    expect(truncateText('Text', 4)).toBe('Text')
  })

  it('handles unicode characters', () => {
    const text = '这是一个很长的中文文本内容'
    expect(truncateText(text, 8)).toBe('这是一个很...')
  })
})

describe('formatFileName', () => {
  it('extracts filename from URL', () => {
    expect(formatFileName('https://example.com/video.mp4')).toBe('video.mp4')
    expect(formatFileName('https://example.com/path/to/video.mp4?v=123')).toBe('video.mp4')
  })

  it('extracts filename from path', () => {
    expect(formatFileName('/path/to/video.mp4')).toBe('video.mp4')
    expect(formatFileName(String.raw`C:\Users\Videos\video.mp4`)).toBe('video.mp4')
  })

  it('handles edge cases', () => {
    expect(formatFileName('https://example.com/')).toBe('unknown')
    expect(formatFileName('')).toBe('unknown')
    expect(formatFileName('no-extension')).toBe('no-extension')
  })
})

describe('formatTaskStatus', () => {
  it('formats task status to Chinese', () => {
    expect(formatTaskStatus('pending')).toBe('等待中')
    expect(formatTaskStatus('downloading')).toBe('下载中')
    expect(formatTaskStatus('paused')).toBe('已暂停')
    expect(formatTaskStatus('completed')).toBe('已完成')
    expect(formatTaskStatus('failed')).toBe('失败')
    expect(formatTaskStatus('cancelled')).toBe('已取消')
  })

  it('handles unknown status', () => {
    expect(formatTaskStatus('unknown')).toBe('unknown')
  })
})

describe('formatETA', () => {
  it('formats ETA correctly', () => {
    expect(formatETA(0)).toBe('--')
    expect(formatETA(null)).toBe('--')
    expect(formatETA(undefined)).toBe('--')
    expect(formatETA(30)).toBe('30秒')
    expect(formatETA(90)).toBe('2分钟')
    expect(formatETA(3600)).toBe('1小时')
    expect(formatETA(3900)).toBe('1小时5分钟')
    expect(formatETA(86400)).toBe('1天')
    expect(formatETA(90000)).toBe('1天1小时')
  })

  it('handles negative values', () => {
    expect(formatETA(-30)).toBe('--')
  })
})