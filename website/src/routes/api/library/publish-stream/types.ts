export type PublishingState =
	| 'generating-keywords'
	| 'forking'
	| 'creating-branch'
	| 'uploading'
	| 'creating-pr';

import type { FullOnlineFuiz } from '$lib/types';

export type PublishJob = {
	ownerId: string;
	sessionVersion: number;
	fuiz: FullOnlineFuiz;
};
