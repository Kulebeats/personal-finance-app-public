export const ENVIRONMENT_BLOCKED_EXIT: 4;
export function requiredChromiumFolder(executablePath: string, args: readonly string[]): { root: string; folder: string } | undefined;
export function chromiumBuildProblem(options: {
  executablePath: string;
  args: readonly string[];
  version: string;
  exists?: (file: string) => boolean;
  list?: (directory: string) => string[];
}): string | undefined;
export function playwrightChromiumProblem(args: readonly string[]): Promise<string | undefined>;
