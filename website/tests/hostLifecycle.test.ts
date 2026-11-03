import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/clientOnly', () => ({ addIds: (config: unknown) => config }));

import { handleGameMessage } from '../src/routes/[[lang=locale]]/host/messageHandler';

const context = {
	code: '12345',
	currentState: undefined,
	watcherId: 'host',
	bindableGameInfo: { volumeOn: true, locked: false }
};
describe('Host lifecycle dispatch', () => {
	it('preserves server generation and remaining time through warning and reset', () => {
		for (const timeout of [
			{ generation: 3, remaining_ms: 59000, warning: true },
			{ generation: 4, remaining_ms: 600000, warning: false }
		])
			expect(handleGameMessage({ HostTimeout: timeout }, context)).toEqual({ timeout });
	});
	it('keeps partial results and finishes through Summary dispatch', () => {
		const summary = {
			stats: [[1, 0] as [number, number]],
			player_count: 1,
			results: [['Player', [1000]] as [string, number[]]],
			team_mapping: [],
			config: { title: 'Partial', slides: [] },
			options: { random_names: null, show_answers: true, no_leaderboard: false, teams: undefined }
		};
		const result = handleGameMessage({ Summary: { Host: summary } }, context);
		expect(result.shouldMarkFinished).toBe(true);
		expect(result.shouldCloseSocket).toBe(true);
		expect(result.newState).toMatchObject({
			Game: {
				Summary: {
					stats: [[1, 0]],
					results: { Player: [1000] }
				}
			}
		});
	});
});
