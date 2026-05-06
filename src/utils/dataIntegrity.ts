import type { VideoTask } from '../schemas';

export const checkDataIntegrity = (
  data: VideoTask[]
): {
  duplicates: string[];
  orphaned: string[];
  corrupted: string[];
} => {
  const duplicates: string[] = [];
  const orphaned: string[] = [];
  const corrupted: string[] = [];
  const seenIds = new Set<string>();

  data.forEach(task => {
    if (seenIds.has(task.id)) {
      duplicates.push(task.id);
    } else {
      seenIds.add(task.id);
    }

    if (!task.url || !task.title) {
      corrupted.push(task.id);
    }

    if (task.status === 'downloading' && !task.speed) {
      orphaned.push(task.id);
    }
  });

  return { duplicates, orphaned, corrupted };
};

export const createValidationStats = () => {
  let totalValidations = 0;
  let successfulValidations = 0;
  let failedValidations = 0;
  let totalValidationTime = 0;

  return {
    recordValidation: (success: boolean, duration: number) => {
      totalValidations++;
      if (success) {
        successfulValidations++;
      } else {
        failedValidations++;
      }
      totalValidationTime += duration;
    },

    getStats: () => ({
      total: totalValidations,
      successful: successfulValidations,
      failed: failedValidations,
      successRate: totalValidations > 0 ? successfulValidations / totalValidations : 0,
      averageDuration: totalValidations > 0 ? totalValidationTime / totalValidations : 0,
    }),

    reset: () => {
      totalValidations = 0;
      successfulValidations = 0;
      failedValidations = 0;
      totalValidationTime = 0;
    },
  };
};
