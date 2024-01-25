import { constants } from "fs";
import * as fsp from "fs/promises";
import * as JSON5 from "json5";
import { resolve } from "path";
import { parse } from "pg-connection-string";
import { pathToFileURL } from "url";

import { Settings } from "../settings";

export const DEFAULT_GMRC_PATH = `${process.cwd()}/.gmrc`;
export const DEFAULT_GMRCJS_PATH = `${DEFAULT_GMRC_PATH}.js`;
export const DEFAULT_GMRC_COMMONJS_PATH = `${DEFAULT_GMRC_PATH}.cjs`;

/**
 * Represents the option flags that are valid for all commands (see
 * src/cli.ts).
 */
export interface CommonArgv {
  /**
   * Optional path to the gmrc file.
   */
  config?: string;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await fsp.access(path, constants.F_OK /* visible to us */);
    return true;
  } catch (e) {
    return false;
  }
}

export async function getSettingsFromJSON(path: string): Promise<Settings> {
  let data;
  try {
    data = await fsp.readFile(path, "utf8");
  } catch (e) {
    throw new Error(
      `Failed to read '${path}': ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    return JSON5.parse(data);
  } catch (e) {
    throw new Error(
      `Failed to parse '${path}': ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Options passed to the getSettings function.
 */
interface Options {
  /**
   * Optional path to the gmrc config path to use; if not provided we'll fall
   * back to `./.gmrc` and `./.gmrc.js`.
   *
   * This must be the full path, including extension. If the extension is `.js`
   * then we'll use `require` to import it, otherwise we'll read it as JSON5.
   */
  configFile?: string;
}

/**
 * Gets the raw settings from the relevant .gmrc file. Does *not* validate the
 * settings - the result of this call should not be trusted. Pass the result of
 * this function to `parseSettings` to get validated settings.
 */
export async function getSettings(options: Options = {}): Promise<Settings> {
  const { configFile } = options;
  const tryRequire = async (path: string): Promise<Settings> => {
    // If the file is e.g. `foo.js` then Node `require('foo.js')` would look in
    // `node_modules`; we don't want this - instead force it to be a relative
    // path.
    const relativePath = pathToFileURL(resolve(process.cwd(), path)).href;

    try {
      const module = (await import(relativePath)) as {
        default: Settings;
      };
      return module.default;
    } catch (e) {
      throw new Error(
        `Failed to import '${relativePath}'; error:\n    ${
          e instanceof Error && e.stack
            ? e.stack.replace(/\n/g, "\n    ")
            : String(e)
        }`,
      );
    }
  };

  if (configFile != null) {
    if (!(await exists(configFile))) {
      throw new Error(`Failed to import '${configFile}': file not found`);
    }

    if (
      configFile.endsWith(".js") ||
      configFile.endsWith(".cjs") ||
      configFile.endsWith(".mjs")
    ) {
      return tryRequire(configFile);
    } else {
      return await getSettingsFromJSON(configFile);
    }
  } else if (await exists(DEFAULT_GMRC_PATH)) {
    return await getSettingsFromJSON(DEFAULT_GMRC_PATH);
  } else if (await exists(DEFAULT_GMRCJS_PATH)) {
    return tryRequire(DEFAULT_GMRCJS_PATH);
  } else if (await exists(DEFAULT_GMRC_COMMONJS_PATH)) {
    return tryRequire(DEFAULT_GMRC_COMMONJS_PATH);
  } else {
    throw new Error(
      "No .gmrc file found; please run `graphile-migrate init` first.",
    );
  }
}

export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");

    process.stdin.on("error", reject);
    process.stdin.on("readable", () => {
      let chunk;
      // Use a loop to make sure we read all available data.
      while ((chunk = process.stdin.read() as string | null) !== null) {
        data += chunk;
      }
    });

    process.stdin.on("end", () => {
      resolve(data);
    });
  });
}

export function getDatabaseName(connectionString: string): string {
  const databaseName = parse(connectionString).database;
  if (!databaseName) {
    throw new Error(
      "Could not determine database name from connection string.",
    );
  }
  return databaseName;
}
