import { expect, it } from 'vitest';
import { canCreate, canManageActiveGame, liveRooms } from '../src/lib/homepageAccess';

const owner = { id: 'owner' };

it('includes standalone rooms with no published quizzes, deduplicated by code', () => {
	const room = { quiz_id: 'private', game_code: '12345' };
	expect(liveRooms([room, room], {}, [])).toEqual([room]);
});

it('excludes only rooms already represented by a published card', () => {
	const first = { quiz_id: 'published', game_code: '12345' };
	const second = { quiz_id: 'published', game_code: '23456' };
	expect(liveRooms([first, second], { published: '12345' }, [{ id: 'published' }])).toEqual([
		second
	]);
});

it('includes every distinct standalone room without a search filter', () => {
	const rooms = [
		{ quiz_id: null, game_code: '12345' },
		{ quiz_id: 'private', game_code: '98765' }
	];
	expect(liveRooms(rooms, {}, [])).toEqual(rooms);
});

it('shows host controls only for the authenticated owner', () => {
	expect(canManageActiveGame(owner, ['12345'], '12345')).toBe(true);
	expect(canManageActiveGame(owner, [], '12345')).toBe(false);
	expect(canManageActiveGame(null, ['12345'], '12345')).toBe(false);
});

it('shows Create to every authenticated role', () => {
	expect(canCreate({ id: 'admin' })).toBe(true);
	expect(canCreate({ id: 'teacher' })).toBe(true);
	expect(canCreate(null)).toBe(false);
});
