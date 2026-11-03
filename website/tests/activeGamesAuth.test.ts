import type { RequestEvent } from '@sveltejs/kit';
import { expect, it } from 'vitest';
import { DELETE as adminDelete } from '../src/routes/admin-api/games/active/+server';
import { DELETE as apiDelete } from '../src/routes/api/games/active/+server';

it.each([
	adminDelete,
	apiDelete
])('requires authentication even when a game code is supplied', async (handler) => {
	const event = {
		locals: { isAdmin: false, database: { removeActiveGame: async () => {} } },
		request: new Request('http://localhost/games/active', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ quizId: 'quiz', gameCode: '123456' })
		})
	} as unknown as RequestEvent;
	await expect(handler(event)).rejects.toMatchObject({ status: 401 });
});
