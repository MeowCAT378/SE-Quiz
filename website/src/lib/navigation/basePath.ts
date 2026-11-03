import { base } from '$app/paths';

/** Convert a deployed pathname to the logical path used by policy and service signatures. */
export function stripBase(path: string): string {
	return base && (path === base || path.startsWith(`${base}/`))
		? path.slice(base.length) || '/'
		: path;
}
