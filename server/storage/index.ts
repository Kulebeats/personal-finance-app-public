import { StorageTagModule } from "./StorageTagModule";
import type { IStorage } from "./types";

/**
 * @deprecated Use domain repositories instead (e.g. AccountRepository).
 */
export class DatabaseStorage extends StorageTagModule implements IStorage {}

/**
 * @deprecated Use domain repositories instead (e.g. AccountRepository).
 */
export const storage = new DatabaseStorage();

export type { IStorage } from "./types";
