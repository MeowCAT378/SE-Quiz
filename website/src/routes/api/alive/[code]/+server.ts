import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ params }) => {
	const code = params.code?.toUpperCase();
	if (!code) {
		return new Response('false', { status: 400 });
	}

	const targets = [
		`http://game-server:8080/alive/${code}`,
		`http://localhost:9808/alive/${code}`,
		`http://127.0.0.1:9808/alive/${code}`
	];

	for (const target of targets) {
		try {
			const res = await fetch(target, { method: 'GET' });
			if (res.ok) {
				const text = await res.text();
				return new Response(text, {
					headers: {
						'Content-Type': 'text/plain; charset=utf-8',
						'Access-Control-Allow-Origin': '*'
					}
				});
			}
		} catch {
			// Try next target
		}
	}

	return new Response('false', {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Access-Control-Allow-Origin': '*'
		}
	});
};
