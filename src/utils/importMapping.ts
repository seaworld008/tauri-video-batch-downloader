import type { ImportPreview } from '../types';

export type UiFieldKey = 'record_url' | 'zl_id' | 'zl_name' | 'kc_id' | 'kc_name';

const REQUIRED_FIELDS: UiFieldKey[] = ['record_url'];

const URL_KEYWORDS = ['url', 'link', 'href', 'download', 'record'];
const URL_KEYWORDS_CN = ['链接', '地址', '下载', '播放'];
const COLUMN_KEYWORDS = ['column', 'zl', '专栏'];
const COURSE_KEYWORDS = ['course', 'kc', '课', '课程'];
const ID_KEYWORDS = ['id', 'code', 'number', '编号', '识别'];
const NAME_KEYWORDS = ['name', 'title', '名', '称', '标题'];
const VIDEO_KEYWORDS = ['video', '视频'];

const normalize = (value: string): string => value.replace(/[\s_-]+/g, '').toLowerCase();

const containsAny = (value: string, keywords: string[]): boolean =>
  keywords.some(keyword => value.includes(keyword));

const resolveUiField = (value: string | undefined): UiFieldKey | undefined => {
  if (!value) return undefined;
  const normalized = normalize(value);

  if (['recordurl', 'videourl', 'url', 'videoaddress', 'videolink'].includes(normalized)) {
    return 'record_url';
  }

  if (['zlid', 'columnid', 'id'].includes(normalized)) {
    return 'zl_id';
  }

  if (['zlname', 'columnname', 'name'].includes(normalized)) {
    return 'zl_name';
  }

  if (['kcid', 'courseid'].includes(normalized)) {
    return 'kc_id';
  }

  if (['kcname', 'coursename', 'title'].includes(normalized)) {
    return 'kc_name';
  }

  return undefined;
};

const mapHeaderToUiField = (header: string): UiFieldKey | undefined => {
  const normalized = normalize(header);

  const looksLikeUrl =
    containsAny(normalized, URL_KEYWORDS) || containsAny(normalized, URL_KEYWORDS_CN);
  const looksLikeId = containsAny(normalized, ID_KEYWORDS);
  const looksLikeName = containsAny(normalized, NAME_KEYWORDS);

  if (looksLikeUrl && !looksLikeId) {
    return 'record_url';
  }

  if (containsAny(normalized, COLUMN_KEYWORDS)) {
    if (looksLikeId) {
      return 'zl_id';
    }
    if (looksLikeName) {
      return 'zl_name';
    }
  }

  if (containsAny(normalized, COURSE_KEYWORDS)) {
    if (looksLikeId) {
      return 'kc_id';
    }
    if (looksLikeName) {
      return 'kc_name';
    }
  }

  if (containsAny(normalized, VIDEO_KEYWORDS) && looksLikeName && !looksLikeUrl) {
    return 'kc_name';
  }

  return undefined;
};

const mapBackendValueToUiField = (value: string): UiFieldKey | undefined => resolveUiField(value);

export const detectUiFieldFromHeader = (header: string): UiFieldKey | undefined =>
  mapHeaderToUiField(header);

const findVideoUrlHeader = (
  headers: string[],
  fieldMapping: Record<string, string>
): string | undefined => {
  const mappedEntry = Object.entries(fieldMapping).find(
    ([, value]) => resolveUiField(value) === 'record_url'
  );

  if (mappedEntry) {
    return mappedEntry[0];
  }

  return headers.find(header => mapHeaderToUiField(header) === 'record_url');
};

const mapUiFieldToBackendKey = (field: UiFieldKey): string => {
  switch (field) {
    case 'record_url':
      return 'video_url';
    case 'zl_id':
      return 'column_id';
    case 'zl_name':
      return 'column_name';
    case 'kc_id':
      return 'course_id';
    case 'kc_name':
      return 'course_name';
    default:
      return field;
  }
};

export const buildDefaultFieldMapping = (
  headers: string[],
  previewMapping?: ImportPreview['field_mapping'],
  existingMapping?: Record<string, string>
): Record<string, UiFieldKey> => {
  const result: Record<string, UiFieldKey> = {};

  headers.forEach(header => {
    const existingValue = existingMapping?.[header];
    const resolved = resolveUiField(existingValue);
    if (resolved) {
      result[header] = resolved;
    }
  });

  if (previewMapping) {
    Object.entries(previewMapping).forEach(([header, value]) => {
      if (!headers.includes(header) || result[header]) return;
      const resolved = mapBackendValueToUiField(value);
      if (resolved) {
        result[header] = resolved;
      }
    });
  }

  headers.forEach(header => {
    if (result[header]) return;
    const auto = mapHeaderToUiField(header);
    if (auto) {
      result[header] = auto;
    }
  });

  return result;
};

export const convertFieldMappingToBackend = (
  fieldMapping: Record<string, string>
): Record<string, string> => {
  const backendMapping: Record<string, string> = {};

  Object.entries(fieldMapping).forEach(([header, value]) => {
    const resolved = resolveUiField(value);
    if (!resolved) return;
    const backendKey = mapUiFieldToBackendKey(resolved);
    backendMapping[backendKey] = header;
  });

  return backendMapping;
};

export const hasRequiredFieldMapping = (fieldMapping: Record<string, string>): boolean => {
  const resolvedFields = new Set(
    Object.values(fieldMapping)
      .map(value => resolveUiField(value))
      .filter((value): value is UiFieldKey => Boolean(value))
  );

  return REQUIRED_FIELDS.every(field => resolvedFields.has(field));
};

export const buildBackendFieldMapping = (
  headers: string[],
  fieldMapping: Record<string, string>
): Record<string, string> => {
  const backendMapping = convertFieldMappingToBackend(fieldMapping);

  if (!backendMapping.video_url) {
    const fallbackHeader = findVideoUrlHeader(headers, fieldMapping);
    if (fallbackHeader) {
      backendMapping.video_url = fallbackHeader;
    }
  }

  return backendMapping;
};

export const canProceedWithImport = (
  headers: string[],
  fieldMapping: Record<string, string>
): boolean => {
  return Boolean(findVideoUrlHeader(headers, fieldMapping));
};
