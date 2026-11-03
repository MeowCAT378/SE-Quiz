import { describe, expect, it } from 'vitest';
import { buildSearchQuery } from '../src/lib/db/search';
import { POST } from '../src/routes/[[lang=locale]]/library/search/+server';

describe('library search', () => {
	it('allows no filters and binds the limit', () => {
		expect(buildSearchQuery('', {}, 24)).toEqual({
			sql: 'SELECT * FROM fuizzes LIMIT ?',
			params: [24]
		});
	});
	it('binds search and filter values instead of interpolating SQL', () => {
		const result = buildSearchQuery('math', { languages: ["th' OR 1=1 --"] }, 5, 'postgres');
		expect(result.sql).not.toContain("th' OR");
		expect(result.sql).toContain('title ILIKE $1');
		expect(result.sql).toContain('language = $6');
		expect(result.params).toEqual([
			'%math%',
			'%math%',
			'%math%',
			'%math%',
			'%math%',
			"th' OR 1=1 --",
			5
		]);
	});
});

describe('library search route', () => {
	const request = () =>
		new Request('http://localhost/th/library/search', {
			method: 'POST',
			body: JSON.stringify({ term: 'math', subjects: [], grades: [], languages: [] })
		});

	it('reports an unavailable library instead of a successful empty search', async () => {
		await expect(
			POST({ request: request(), locals: {} } as Parameters<typeof POST>[0])
		).rejects.toMatchObject({ status: 503 });
	});

	it('keeps a successful empty search empty', async () => {
		const response = await POST({
			request: request(),
			locals: { database: { search: async () => [] } }
		} as unknown as Parameters<typeof POST>[0]);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual([]);
	});
});
