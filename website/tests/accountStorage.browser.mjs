import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const base = process.env.BROWSER_TEST_URL || 'http://127.0.0.1:9396';
const executable =
	process.env.BROWSER_EXECUTABLE || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = await mkdtemp(join(tmpdir(), 'seopen-browser-task6-'));
const portProbe = createServer();
await new Promise((done) => portProbe.listen(0, '127.0.0.1', done));
const port = portProbe.address().port;
await new Promise((done) => portProbe.close(done));
const endpoint = `http://127.0.0.1:${port}`;
const browser = spawn(
	executable,
	[
		'--headless=new',
		'--disable-gpu',
		'--no-first-run',
		'--no-default-browser-check',
		`--remote-debugging-port=${port}`,
		'--disable-extensions',
		'--disable-sync',
		`--user-data-dir=${profile}`,
		'about:blank'
	],
	{ windowsHide: true, stdio: 'ignore' }
);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let socket;
const keepAlive = setInterval(() => {}, 1000);
try {
	let tabs;
	for (let i = 0; i < 50; i++) {
		try {
			tabs = await (await fetch(`${endpoint}/json/list`)).json();
			break;
		} catch {
			await sleep(200);
		}
	}
	if (!tabs) throw new Error('Disposable browser did not start');
	const tab = await (await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })).json();
	socket = new WebSocket(tab.webSocketDebuggerUrl);
	await new Promise((done, reject) => {
		const timer = setTimeout(() => reject(new Error('Browser connection timeout')), 10000);
		socket.addEventListener(
			'open',
			() => {
				clearTimeout(timer);
				done();
			},
			{ once: true }
		);
		socket.addEventListener('error', reject, { once: true });
	});
	let seq = 0;
	const waiting = new Map();
	socket.addEventListener('message', (event) => {
		const result = JSON.parse(event.data);
		if (result.method === 'Runtime.exceptionThrown') console.error(JSON.stringify(result.params));
		if (result.id) {
			const callback = waiting.get(result.id);
			if (!callback) return;
			waiting.delete(result.id);
			result.error ? callback.reject(result.error) : callback.resolve(result.result);
		}
	});
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = ++seq;
			const timer = setTimeout(() => reject(new Error('CDP timeout: ' + method)), 45000);
			waiting.set(id, {
				resolve: (value) => {
					clearTimeout(timer);
					resolve(value);
				},
				reject
			});
			socket.send(JSON.stringify({ id, method, params }));
		});
	await send('Runtime.enable');
	await send('Page.navigate', { url: `${base}/tests/accountStorage.browser.html` });
	let result;
	for (let i = 0; i < 120; i++) {
		await sleep(500);
		const output = await send('Runtime.evaluate', {
			expression: 'globalThis.task6Result',
			awaitPromise: true,
			returnByValue: true
		});
		if (output.result?.value) {
			result = output.result.value;
			break;
		}
	}
	if (!result) {
		const body = await send('Runtime.evaluate', {
			expression: 'document.body.innerText',
			returnByValue: true
		});
		throw new Error(`No browser test result: ${body.result?.value}`);
	}
	console.log(JSON.stringify(result, null, 2));
	if (result.error) process.exitCode = 1;
} catch (cause) {
	console.error(cause);
	process.exitCode = 1;
} finally {
	clearInterval(keepAlive);
	if (socket?.readyState === WebSocket.OPEN)
		socket.send(JSON.stringify({ id: 99999, method: 'Browser.close' }));
	socket?.close();
	browser.kill();
	await sleep(1000);
	if (resolve(profile).startsWith(resolve(tmpdir()) + '\\seopen-browser-task6-'))
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
