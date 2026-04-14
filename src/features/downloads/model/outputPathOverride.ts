import type { VideoTask } from '../../../types';

export interface TaskOutputPathUpdate {
  task_id: string;
  output_path: string;
}

const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/;

const normalizeSeparators = (value: string) => value.replace(/\\/g, '/');

const trimTrailingSeparators = (value: string) => value.replace(/[\\/]+$/, '');

const trimLeadingSeparators = (value: string) => value.replace(/^[\\/]+/, '');

const trimRelativePrefix = (value: string) => value.replace(/^\.\/+/, '').replace(/^\.\\+/, '');

const isAbsolutePath = (value: string) =>
  value.startsWith('/') || WINDOWS_ABSOLUTE_PATH.test(value);

const joinPath = (base: string, suffix: string) => {
  const normalizedBase = trimTrailingSeparators(normalizeSeparators(base));
  const normalizedSuffix = trimLeadingSeparators(normalizeSeparators(suffix));

  if (!normalizedBase) {
    return normalizedSuffix;
  }

  if (!normalizedSuffix) {
    return normalizedBase;
  }

  return `${normalizedBase}/${normalizedSuffix}`;
};

const getLeafSegment = (value: string) => {
  const normalized = trimTrailingSeparators(normalizeSeparators(value));
  const segments = normalized.split('/').filter(Boolean);
  return segments.at(-1) ?? '';
};

const sanitizeFilename = (value: string) =>
  value.replace(/[<>:"|?*\\/]/g, '_').replace(/\s+/g, ' ').trim();

const getUrlExtension = (url: string) => {
  const normalizedUrl = url.trim().split('?')[0].split('#')[0];
  const urlLeaf = normalizedUrl.split('/').filter(Boolean).at(-1);
  if (!urlLeaf) {
    return '';
  }

  const dotIndex = urlLeaf.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === urlLeaf.length - 1) {
    return '';
  }

  return urlLeaf.slice(dotIndex + 1);
};

const deriveFilename = (task: VideoTask) => {
  const resolvedPath = task.resolved_path?.trim();
  if (resolvedPath) {
    const normalized = normalizeSeparators(resolvedPath);
    return getLeafSegment(normalized);
  }

  const sanitizedTitle = sanitizeFilename(task.title ?? '');
  const extension = getUrlExtension(task.url);
  if (sanitizedTitle) {
    const loweredTitle = sanitizedTitle.toLowerCase();
    if (extension && !loweredTitle.endsWith(`.${extension.toLowerCase()}`)) {
      return `${sanitizedTitle}.${extension}`;
    }
    return sanitizedTitle;
  }

  const normalizedUrl = task.url.trim().split('?')[0].split('#')[0];
  const urlLeaf = normalizedUrl.split('/').filter(Boolean).at(-1);
  if (urlLeaf) {
    return urlLeaf;
  }

  return task.title.trim() || 'download';
};

export const rebaseTaskOutputPath = (
  currentOutputPath: string,
  defaultOutputDirectory: string,
  overrideOutputDirectory: string
) => {
  const normalizedCurrent = trimTrailingSeparators(normalizeSeparators(currentOutputPath.trim()));
  const normalizedDefault = trimTrailingSeparators(
    normalizeSeparators(defaultOutputDirectory.trim())
  );
  const normalizedOverride = trimTrailingSeparators(
    normalizeSeparators(overrideOutputDirectory.trim())
  );

  if (!normalizedOverride) {
    return normalizedCurrent;
  }

  if (!normalizedCurrent) {
    return normalizedOverride;
  }

  if (!isAbsolutePath(normalizedCurrent)) {
    return joinPath(normalizedOverride, trimRelativePrefix(normalizedCurrent));
  }

  if (
    normalizedDefault &&
    (normalizedCurrent === normalizedDefault ||
      normalizedCurrent.startsWith(`${normalizedDefault}/`))
  ) {
    const suffix = trimLeadingSeparators(normalizedCurrent.slice(normalizedDefault.length));
    return suffix ? joinPath(normalizedOverride, suffix) : normalizedOverride;
  }

  const leafSegment = getLeafSegment(normalizedCurrent);
  return leafSegment ? joinPath(normalizedOverride, leafSegment) : normalizedOverride;
};

export const buildTaskOutputPathUpdates = (
  tasks: VideoTask[],
  defaultOutputDirectory: string,
  overrideOutputDirectory: string
): TaskOutputPathUpdate[] =>
  tasks.map(task => ({
    task_id: task.id,
    output_path: rebaseTaskOutputPath(
      task.output_path,
      defaultOutputDirectory,
      overrideOutputDirectory
    ),
  }));

export const buildTaskOutputPathPreview = (
  task: VideoTask | undefined,
  defaultOutputDirectory: string,
  overrideOutputDirectory: string
) => {
  if (!task) {
    return '';
  }

  const rebasedDirectory = rebaseTaskOutputPath(
    task.output_path,
    defaultOutputDirectory,
    overrideOutputDirectory
  );

  return joinPath(rebasedDirectory, deriveFilename(task));
};
