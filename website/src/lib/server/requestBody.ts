import { error } from '@sveltejs/kit';

export async function readTextBody(request: Request, limit = 65_536): Promise<string> {
	const reader = request.body?.getReader();
	if (!reader) return '';
	// Count bytes while streaming: Content-Length may be absent or supplied by the caller.
	let size = 0;
	const chunks: Uint8Array[] = [];
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) {
				await reader.cancel();
				error(413, 'Request body too large');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		error(400, 'Invalid request encoding');
	}
}

export async function readJsonBody<T = Record<string, unknown>>(
	request: Request,
	limit = 65_536
): Promise<T> {
	const text = await readTextBody(request, limit);
	try {
		const value: unknown = JSON.parse(text);
		if (!value || typeof value !== 'object' || Array.isArray(value))
			error(400, 'JSON object required');
		return value as T;
	} catch {
		error(400, 'Invalid JSON request');
	}
}

export async function readFormBody(request: Request): Promise<FormData> {
	const text = await readTextBody(request);
	try {
		return await new Request(request.url, {
			method: 'POST',
			headers: { 'content-type': request.headers.get('content-type') ?? '' },
			body: text
		}).formData();
	} catch {
		error(400, 'Invalid form request');
	}
}
