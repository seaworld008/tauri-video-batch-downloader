import { describe, it, expect } from 'vitest';
import {
  detectUiFieldFromHeader,
  buildDefaultFieldMapping,
  buildBackendFieldMapping,
  canProceedWithImport,
  convertFieldMappingToBackend,
} from '../importMapping';

describe('importMapping Chinese header support', () => {
  it('detects Chinese headers for core fields', () => {
    expect(detectUiFieldFromHeader('视频链接')).toBe('record_url');
    expect(detectUiFieldFromHeader('专栏名称')).toBe('zl_name');
    expect(detectUiFieldFromHeader('课程ID')).toBe('kc_id');
    expect(detectUiFieldFromHeader('课程名称')).toBe('kc_name');
  });

  it('builds default mapping when only Chinese headers are provided', () => {
    const headers = ['视频链接', '专栏名称', '课程ID', '课程名称'];
    const mapping = buildDefaultFieldMapping(headers);

    expect(mapping['视频链接']).toBe('record_url');
    expect(mapping['专栏名称']).toBe('zl_name');
    expect(mapping['课程ID']).toBe('kc_id');
    expect(mapping['课程名称']).toBe('kc_name');
  });

  it('converts UI mapping with detected fields to backend keys', () => {
    const headers = ['视频链接', '课程名称'];
    const fieldMapping = buildDefaultFieldMapping(headers) as Record<string, string>;

    const backendMapping = buildBackendFieldMapping(headers, fieldMapping);

    expect(backendMapping.video_url).toBe('视频链接');
    expect(backendMapping.course_name).toBe('课程名称');
    expect(canProceedWithImport(headers, fieldMapping)).toBe(true);

    const converted = convertFieldMappingToBackend(fieldMapping);
    expect(converted.video_url).toBe('视频链接');
    expect(converted.course_name).toBe('课程名称');
  });
});
