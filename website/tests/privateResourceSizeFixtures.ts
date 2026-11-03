import type { ResourceKind } from '../src/lib/server/privateValidation';
import type { InternalFuiz, InternalReport } from '../src/lib/storage';

/** Independent UTF-8 fixture sizing; includes multibyte text, not just ASCII characters. */
export function privateRecordBytes(
	kind: ResourceKind,
	size: number
): InternalFuiz | InternalReport {
	const metadata = {
		uniqueId: '00000000-0000-4000-a000-000000000099',
		versionId: 0,
		lastEdited: 0
	};
	const chunks = Array.from({ length: 32 }, (_, i) => (i < 31 ? 'ก'.repeat(20000) : ''));
	if (kind === 'creation') {
		const record: InternalFuiz = {
			...metadata,
			config: { title: '', slides: chunks.map((body) => ({ InfoSlide: { title: '', body } })) }
		};
		const last = record.config.slides[31] as { InfoSlide: { title: string; body: string } };
		last.InfoSlide.body = 'x'.repeat(size - Buffer.byteLength(JSON.stringify(record), 'utf8'));
		return record;
	}
	const record: InternalReport & Required<Pick<InternalReport, 'responses'>> = {
		...metadata,
		title: '',
		playedAt: 0,
		playerCount: 32,
		questions: [{ title: '', correct: 0, wrong: 32 }],
		results: chunks.map((_, i) => [`player-${i}`, [0]]),
		responses: chunks.map((value, i) => [`player-${i}`, [value]])
	};
	record.responses[31][1][0] = 'x'.repeat(size - Buffer.byteLength(JSON.stringify(record), 'utf8'));
	return record;
}
