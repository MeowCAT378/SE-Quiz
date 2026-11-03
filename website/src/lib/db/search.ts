import type { SearchFilters } from './base';

/** Bind all input values for both D1 and PostgreSQL. */
export function buildSearchQuery(
	term: string,
	filters: SearchFilters,
	limit: number,
	dialect: 'd1' | 'postgres' = 'd1'
): { sql: string; params: (string | number)[] } {
	const params: (string | number)[] = [];
	const bind = (value: string | number) => {
		params.push(value);
		return dialect === 'postgres' ? '$' + params.length : '?';
	};
	const like = dialect === 'postgres' ? 'ILIKE' : 'LIKE';
	const conditions: string[] = [];
	if (term) {
		conditions.push(
			'(' +
				['title', 'author', 'subjects', 'keywords', 'thumbnail_alt']
					.map((column) => column + ' ' + like + ' ' + bind('%' + term + '%'))
					.join(' OR ') +
				')'
		);
	}
	for (const [column, values] of [
		['language', filters.languages],
		['subjects', filters.subjects],
		['grades', filters.grades]
	] as const) {
		if (values?.length) {
			conditions.push(
				'(' +
					values
						.map((value) =>
							column === 'language'
								? 'language = ' + bind(value)
								: column + ' ' + like + ' ' + bind('%"' + value + '"%')
						)
						.join(' OR ') +
					')'
			);
		}
	}
	return {
		sql:
			'SELECT * FROM fuizzes' +
			(conditions.length ? ' WHERE ' + conditions.join(' AND ') : '') +
			' LIMIT ' +
			bind(limit),
		params
	};
}
