export function parseListDate(value: string): string | null {
	if (!value.trim()) return '';
	const parts = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
	if (!parts || parts[3] === '0000') return null;
	const iso = `${parts[3]}-${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
	const date = new Date(`${iso}T00:00:00Z`);
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

export function reversedDates(start: string, end: string): boolean {
	const from = parseListDate(start);
	const through = parseListDate(end);
	return !!from && !!through && from > through;
}

export function matchesListFilters(
	title: string,
	timestamp: number,
	query: string,
	start: string,
	end: string
): boolean {
	const from = parseListDate(start);
	const through = parseListDate(end);
	if (
		from === null ||
		through === null ||
		(from && through && from > through) ||
		!title.toLowerCase().includes(query.trim().toLowerCase())
	)
		return false;
	const date = new Date(timestamp);
	const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
	return (!from || day >= from) && (!through || day <= through);
}
