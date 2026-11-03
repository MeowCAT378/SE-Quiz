import { stripBase } from '$lib/navigation/basePath';

// This is the hook's coarse gate, not the full authorization policy: service callbacks and
// AI routes enforce their own credentials, and private handlers must still check ownership.
export function routePolicy(path: string, method: string): 'public' | 'user' | 'admin' {
	path = stripBase(path);
	const under = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
	if (under('/admin/login') || under('/admin/logout') || under('/login') || under('/logout'))
		return 'public';
	if (under('/admin') || under('/admin-api') || under('/api/admin')) return 'admin';
	if (['/create', '/host', '/quiz', '/reports', '/publish', '/library/public'].some(under))
		return 'user';
	if (
		[
			'/api/add',
			'/api/quiz',
			'/api/creations',
			'/api/reports',
			'/api/host/media',
			'/api/host/games',
			'/api/gdrive',
			'/api/git'
		].some(under)
	)
		return 'user';
	if (under('/api/library/publish-init') || under('/api/library/publish-stream')) return 'user';
	if ((under('/api/games/active') || under('/share')) && method !== 'GET' && method !== 'HEAD')
		return 'user';
	return 'public';
}
