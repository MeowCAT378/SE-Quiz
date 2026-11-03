/**
 * Base blob storage abstract class
 * Provides a simple interface for storing and retrieving JSON blobs by key
 */

// Keys are internal storage addresses, not access grants. Private-media reads must resolve them
// through owned host_media rows before using either the filesystem or R2 adapter.
export abstract class BaseBlobStorage {
	abstract get(key: string): Promise<string | null>;
	abstract put(key: string, value: string): Promise<void>;
	abstract delete(key: string): Promise<void>;
}
