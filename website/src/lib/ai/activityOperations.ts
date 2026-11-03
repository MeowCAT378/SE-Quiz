type ActiveOperation = {
	owner: string;
	controller: AbortController;
};

// ponytail: Limits are per process; use shared coordination for replicas or Worker isolates.
const active = new Map<string, ActiveOperation>();

export function beginActivityOperation(
	id: string,
	owner: string,
	limit: number
): AbortController | undefined {
	if (
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		active.size >= limit ||
		active.has(id) ||
		[...active.values()].some((operation) => operation.owner === owner)
	)
		return undefined;
	const controller = new AbortController();
	active.set(id, { owner, controller });
	return controller;
}

export function cancelActivityOperation(id: string, owner: string): boolean {
	const operation = active.get(id);
	if (!operation || operation.owner !== owner) return false;
	operation.controller.abort();
	return true;
}

export function finishActivityOperation(controller: AbortController): void {
	for (const [id, operation] of active) {
		if (operation.controller === controller) {
			active.delete(id);
			return;
		}
	}
}
