import * as m from '$lib/paraglide/messages.js';
export function storageErrorMessage(cause: unknown, fallback = m.private_save_error()): string {
	switch ((cause as { status?: number })?.status) {
		case 413:
			return m.private_size_error();
		case 409:
			return m.private_conflict();
		case 401:
		case 403:
			return m.private_session_error();
		default:
			return fallback;
	}
}
