// Disposable browser fixture. No prompts or credentials are logged or retained.
let itemNumber = 0;
const batches: { model: string; count: number }[] = [];
let active = 0;
let maxActive = 0;
Bun.serve({
	hostname: '0.0.0.0',
	port: 11434,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === '/v1/models') return Response.json({ data: [{ id: 'fixture-model' }] });
		if (url.pathname === '/stats') return Response.json({ batches, active, maxActive });
		if (url.pathname !== '/v1/chat/completions') return new Response(null, { status: 404 });
		const auth = request.headers.get('authorization');
		if (auth && auth !== 'Bearer fixture-local-key') return new Response(null, { status: 401 });
		const input = await request.json();
		if (input.model !== 'fixture-model') return new Response(null, { status: 404 });
		if (String(input.messages[1].content).includes('Concurrency hold')) {
			active++;
			maxActive = Math.max(maxActive, active);
			try {
				await Bun.sleep(1000);
			} finally {
				active--;
			}
		}
		const properties = input.response_format.json_schema.schema.properties;
		const schema = properties.items;
		const count = schema.minItems;
		const fields = schema.items.properties;
		const plan =
			String(input.messages[1].content)
				.match(/Difficulty plan: ([^\n]+)/)?.[1]
				.split(',') ?? [];
		batches.push({ model: input.model, count });
		const items = Array.from({ length: count }, (_, index) => {
			const id = ++itemNumber;
			if (fields.prompt) return { prompt: `Fixture prompt ${id}` };
			if (fields.statement)
				return {
					statement: `Fixture statement ${id}`,
					correct: true,
					difficulty: plan[index] ?? 'easy'
				};
			if (fields.range)
				return {
					question: `Fixture estimate ${id}`,
					range: { min: 0, max: 100, step: 2 },
					correct: 50,
					tolerance: 0,
					unit: '%',
					difficulty: plan[index] ?? 'medium'
				};
			if (fields.answers)
				return {
					question: `Fixture short answer ${id}`,
					answers: ['Earth', 'โลก'],
					difficulty: plan[index] ?? 'medium'
				};
			if (fields.items)
				return {
					question: `Fixture ordering ${id}`,
					items: ['First', 'Second', 'Third'],
					difficulty: plan[index] ?? 'medium'
				};
			if (fields.labels)
				return {
					question: `Fixture rating ${id}`,
					labels: { low: 'Low', mid: 'Neutral', high: 'High' }
				};
			if (!fields.choices)
				return {
					question: `Fixture pin ${id}`,
					...(fields.difficulty ? { difficulty: plan[index] ?? 'medium' } : {})
				};
			return {
				question: `Fixture question ${id}`,
				choices: Array.from(
					{ length: fields.choices.minItems },
					(_, choice) => `Option ${choice + 1}`
				),
				...(fields.correctIndex ? { correctIndex: 0, difficulty: plan[index] ?? 'easy' } : {})
			};
		});
		return Response.json({
			choices: [
				{
					finish_reason: 'stop',
					message: {
						content: JSON.stringify({
							items,
							...(properties.language ? { language: 'en' } : {}),
							...(properties.answerLabels ? { answerLabels: ['True', 'False'] } : {})
						})
					}
				}
			]
		});
	}
});
