import { createHash } from 'node:crypto';
import type { InternalFuiz, InternalReport } from '../storage';
import { type Base64Media, questionTypes } from '../types';
import { isUuid } from './hostGames';

export type ResourceKind = 'creation' | 'report';
export type PrivateRecord = InternalFuiz | InternalReport;
// D1 rows allow 2,000,000 bytes; reserve 100,000 for owner/kind/UUID/version/timestamps and row overhead.
export const MAX_PRIVATE_RESOURCE_BYTES = 1_900_000;
export class ResourceError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}
export function valid(condition: unknown, message = 'Invalid private record'): asserts condition {
	if (!condition) throw new ResourceError(400, message);
}
export function object(value: unknown, keys: string[]): Record<string, unknown> {
	valid(value && typeof value === 'object' && !Array.isArray(value));
	valid(Object.keys(value).every((key) => keys.includes(key)));
	return value as Record<string, unknown>;
}
const string = (v: unknown, max = 65536) => valid(typeof v === 'string' && v.length <= max);
const number = (v: unknown) =>
	valid(typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER);
export const integer = (v: unknown) =>
	valid(typeof v === 'number' && Number.isSafeInteger(v) && v >= 0);
const boolean = (v: unknown) => valid(typeof v === 'boolean');
function array(value: unknown, max: number, check: (item: unknown) => void) {
	valid(Array.isArray(value) && value.length <= max);
	for (const item of value) check(item);
}
const optional = (v: unknown, check: (v: unknown) => void) => {
	if (v !== undefined) check(v);
};
const nullable = (v: unknown, check: (v: unknown) => void) => {
	if (v !== null) check(v);
};
export const isMediaHash = (v: unknown): v is string =>
	typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);

/** Bound traversal before deeper validators; serialization never silently converts nonfinite numbers. */
export function finiteJson(value: unknown, maxBytes = 4 * 1024 * 1024) {
	let nodes = 0;
	function visit(v: unknown, depth: number) {
		valid(++nodes <= 200000 && depth <= 20, 'Private record is too complex');
		if (v === null || typeof v === 'boolean') return;
		if (typeof v === 'number') return number(v);
		if (typeof v === 'string') return string(v, maxBytes);
		valid(v && typeof v === 'object');
		if (Array.isArray(v)) {
			valid(v.length <= 10000);
			for (const item of v) visit(item, depth + 1);
		} else {
			valid(Object.keys(v).length <= 100);
			for (const [key, item] of Object.entries(v)) {
				valid(!['__proto__', 'prototype', 'constructor'].includes(key));
				visit(item, depth + 1);
			}
		}
	}
	visit(value, 0);
	valid(
		Buffer.byteLength(JSON.stringify(value), 'utf8') <= maxBytes,
		'Private record is too large'
	);
}

function mediaReference(value: unknown, hashes: Set<string>) {
	const image = object(object(value, ['Image']).Image, ['HashReference']);
	const ref = object(image.HashReference, ['hash', 'alt']);
	valid(isMediaHash(ref.hash));
	string(ref.alt);
	hashes.add(ref.hash);
}
function point(value: unknown) {
	const p = object(value, ['x', 'y']);
	number(p.x);
	number(p.y);
}
function pin(value: unknown) {
	const shape = object(value, ['Rectangle', 'Ellipse', 'Polygon']);
	valid(Object.keys(shape).length === 1);
	if ('Rectangle' in shape) {
		const r = object(shape.Rectangle, ['x', 'y', 'width', 'height']);
		for (const key of ['x', 'y', 'width', 'height']) number(r[key]);
	}
	if ('Ellipse' in shape) {
		const r = object(shape.Ellipse, ['center', 'radius_x', 'radius_y']);
		point(r.center);
		number(r.radius_x);
		number(r.radius_y);
	}
	if ('Polygon' in shape) array(object(shape.Polygon, ['points']).points, 1000, point);
}
function slide(value: unknown, hashes: Set<string>) {
	const wrapper = object(value, [...questionTypes]);
	valid(Object.keys(wrapper).length === 1);
	const kind = Object.keys(wrapper)[0];
	const extra: Record<string, string[]> = {
		MultipleChoice: ['answers', 'answer_mode'],
		TypeAnswer: ['answers', 'case_sensitive'],
		Order: ['answers', 'axis_labels'],
		Slider: ['range', 'correct', 'tolerance', 'unit'],
		Scale: ['min', 'max', 'style', 'labels'],
		Poll: ['answers'],
		Pin: ['correct_area'],
		FreeText: ['mode', 'max_entries', 'max_entry_length'],
		Brainstorm: [
			'idea_time_limit',
			'vote_time_limit',
			'max_ideas_per_player',
			'max_votes_per_player',
			'max_idea_length'
		],
		InfoSlide: ['body', 'duration']
	};
	const common =
		kind === 'InfoSlide'
			? ['title', 'media']
			: [
					'title',
					'media',
					'introduce_question',
					'points_awarded',
					...(kind === 'Brainstorm' ? [] : ['time_limit'])
				];
	const body = object(wrapper[kind], [...common, ...extra[kind]]);
	string(body.title, 500);
	optional(body.media, (v) => mediaReference(v, hashes));
	for (const key of [
		'introduce_question',
		'time_limit',
		'idea_time_limit',
		'vote_time_limit',
		'duration'
	])
		optional(body[key], (v) => nullable(v, number));
	if (kind !== 'InfoSlide') number(body.points_awarded);
	const text = (v: unknown) => string(object(v, ['Text']).Text);
	switch (kind) {
		case 'MultipleChoice':
			array(body.answers, 1000, (v) => {
				const a = object(v, ['correct', 'content']);
				boolean(a.correct);
				text(a.content);
			});
			optional(body.answer_mode, (v) => valid(v === 'SingleAnswer' || v === 'MultipleAnswers'));
			break;
		case 'TypeAnswer':
			array(body.answers, 1000, string);
			boolean(body.case_sensitive);
			break;
		case 'Order': {
			array(body.answers, 1000, string);
			const labels = object(body.axis_labels, ['from', 'to']);
			optional(labels.from, string);
			optional(labels.to, string);
			break;
		}
		case 'Poll':
			array(body.answers, 1000, text);
			break;
		case 'Slider': {
			const r = object(body.range, ['min', 'max', 'step']);
			number(r.min);
			number(r.max);
			number(r.step);
			number(body.correct);
			number(body.tolerance);
			optional(body.unit, (v) => nullable(v, string));
			break;
		}
		case 'Scale': {
			number(body.min);
			number(body.max);
			valid(body.style === 'Agreement' || body.style === 'Nps');
			const labels = object(body.labels, ['low', 'mid', 'high']);
			for (const value of Object.values(labels)) nullable(value, string);
			break;
		}
		case 'Pin':
			optional(body.correct_area, (v) => nullable(v, pin));
			break;
		case 'FreeText':
			valid(body.mode === 'WordCloud' || body.mode === 'OpenEnded');
			integer(body.max_entries);
			integer(body.max_entry_length);
			break;
		case 'Brainstorm':
			integer(body.max_ideas_per_player);
			integer(body.max_votes_per_player);
			integer(body.max_idea_length);
			break;
		case 'InfoSlide':
			optional(body.body, (v) => nullable(v, string));
			break;
	}
}
export function validateRecord(
	kind: ResourceKind,
	value: unknown
): { record: PrivateRecord; hashes: string[] } {
	valid(kind === 'creation' || kind === 'report');
	finiteJson(value);
	if (Buffer.byteLength(canonical(value), 'utf8') > MAX_PRIVATE_RESOURCE_BYTES)
		throw new ResourceError(413, 'Private record exceeds the 1900000-byte storage limit');
	const keys = ['uniqueId', 'versionId', 'lastEdited'];
	const r = object(value, [
		...keys,
		...(kind === 'creation'
			? ['config']
			: [
					'title',
					'playedAt',
					'gameCode',
					'gameInstanceId',
					'fuizUniqueId',
					'fuizVersionId',
					'playerCount',
					'scoreMode',
					'questions',
					'results',
					'teams',
					'responses'
				])
	]);
	valid(isUuid(r.uniqueId));
	integer(r.versionId);
	integer(r.lastEdited);
	const hashes = new Set<string>();
	if (kind === 'creation') {
		const config = object(r.config, ['title', 'slides']);
		string(config.title, 500);
		array(config.slides, 500, (v) => slide(v, hashes));
	} else {
		string(r.title, 500);
		integer(r.playedAt);
		integer(r.playerCount);
		valid((r.playerCount as number) <= 1000);
		optional(r.gameCode, (v) => string(v, 32));
		optional(r.gameInstanceId, (v) => valid(isUuid(v)));
		optional(r.fuizUniqueId, (v) => valid(isUuid(v)));
		optional(r.fuizVersionId, integer);
		optional(r.scoreMode, (v) => valid(v === 'points' || v === 'correctness'));
		array(r.questions, 500, (v) => {
			const q = object(v, [
				'id',
				'type',
				'title',
				'correctAnswer',
				'correct',
				'wrong',
				'pointsAwarded'
			]);
			string(q.title, 500);
			integer(q.correct);
			integer(q.wrong);
			optional(q.id, integer);
			optional(q.type, (v) => valid(questionTypes.includes(v as (typeof questionTypes)[number])));
			optional(q.correctAnswer, string);
			optional(q.pointsAwarded, number);
		});
		const tuples = (v: unknown, check: (v: unknown) => void, count: number) =>
			array(v, 1000, (tuple) => {
				valid(Array.isArray(tuple) && tuple.length === 2);
				string(tuple[0]);
				array(tuple[1], count, check);
			});
		tuples(r.results, number, 500);
		optional(r.responses, (v) => tuples(v, string, 500));
		optional(r.teams, (v) => tuples(v, string, 1000));
	}
	return { record: value as PrivateRecord, hashes: [...hashes] };
}
export function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value !== null && typeof value === 'object')
		return `{${Object.keys(value)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
			.join(',')}}`;
	return JSON.stringify(value);
}
export const digest = (value: string | Uint8Array) =>
	createHash('sha256').update(value).digest('hex');

export function validateMedia(hash: string, value: unknown) {
	valid(isMediaHash(hash), 'Invalid media identifier');
	finiteJson(value, 8 * 1024 * 1024);
	const media = object(object(object(value, ['Image']).Image, ['Base64']).Base64, [
		'data',
		'alt',
		'hash'
	]);
	string(media.alt);
	optional(media.hash, (v) => valid(v === hash));
	string(media.data, 8 * 1024 * 1024);
	const match =
		/^data:(image\/(?:apng|avif|gif|jpeg|png|svg\+xml|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
			media.data as string
		);
	valid(match, 'Supported base64 image required');
	const [, mime, encoded] = match;
	const bytes = Buffer.from(encoded, 'base64');
	valid(
		bytes.length > 0 && bytes.length <= 5 * 1024 * 1024 && bytes.toString('base64') === encoded,
		'Invalid image bytes'
	);
	const start = bytes.subarray(0, 128).toString('latin1');
	const signatures: Record<string, boolean> = {
		'image/png': bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
		'image/apng':
			bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' &&
			bytes.includes(Buffer.from('acTL')),
		'image/gif': /^GIF8[79]a/.test(start),
		'image/jpeg': bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
		'image/webp': start.startsWith('RIFF') && start.slice(8, 12) === 'WEBP',
		'image/avif': start.slice(4, 8) === 'ftyp' && /avif|avis/.test(start.slice(8)),
		'image/svg+xml':
			/^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(bytes.toString('utf8')) &&
			/<\/svg\s*>\s*$|\/\s*>\s*$/.test(bytes.toString('utf8'))
	};
	valid(signatures[mime], 'Image type does not match bytes');
	const contentDigest = digest(Buffer.concat([Buffer.from(`${mime}\n`), bytes]));
	// Alt text belongs to each hash reference; immutable blobs have canonical empty alt text.
	const normalized: Base64Media = {
		Image: { Base64: { data: `data:${mime};base64,${encoded}`, hash, alt: '' } }
	};
	return { media: normalized, mime, byteSize: bytes.length, contentDigest };
}
