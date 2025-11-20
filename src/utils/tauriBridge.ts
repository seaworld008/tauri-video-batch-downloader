import { invoke } from "@tauri-apps/api/tauri";

export const invokeTauri = async <T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> => {
  if (!args) {
    return invoke<T>(command);
  }

  return invoke<T>(command, args);
};

