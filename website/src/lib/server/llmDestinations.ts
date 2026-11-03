import { isIP } from 'node:net';
import { LlmError } from '../ai/llmConfiguration';

const host = (value: string) => value.toLowerCase().replace(/^\[|\]$/g, '');
function ipv4(address: string): string | undefined {
	const value = host(address);
	if (isIP(value) === 4) return value;
	if (value.startsWith('::ffff:')) {
		const tail = value.slice(7);
		if (isIP(tail) === 4) return tail;
		const parts = tail.split(':');
		if (parts.length === 2) {
			const high = Number.parseInt(parts[0], 16),
				low = Number.parseInt(parts[1], 16);
			return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
		}
	}
}
export function isForbiddenAddress(address: string): boolean {
	const raw = host(address);
	const value = isIP(raw) === 6 ? host(new URL(`http://[${raw}]/`).hostname) : raw;
	const v4 = ipv4(value);
	if (v4) {
		const [a, b] = v4.split('.').map(Number);
		return a === 0 || a >= 224 || (a === 169 && b === 254) || v4 === '100.100.100.200';
	}
	if (isIP(value) !== 6) return value.includes('%');
	return (
		value === 'fd00:ec2::254' ||
		(!isPrivateAddress(value) && !/^[23]/.test(value)) ||
		/^2002:|^2001:(?:0:|:)/.test(value)
	);
}
export function isPrivateAddress(address: string): boolean {
	const value = host(address),
		v4 = ipv4(value);
	if (v4) {
		const [a, b] = v4.split('.').map(Number);
		return (
			a === 10 ||
			a === 127 ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 100 && b >= 64 && b <= 127)
		);
	}
	return value === '::1' || value.startsWith('fc') || value.startsWith('fd');
}
export function validateLlmEndpoint(endpoint: string): URL {
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		throw new LlmError('invalid_configuration', 400, 'endpoint');
	}
	const hostname = host(url.hostname);
	if (
		!['http:', 'https:'].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		isForbiddenAddress(hostname) ||
		/(?:^|\.)metadata(?:\.|$)/i.test(hostname)
	)
		throw new LlmError('destination_not_allowed');
	return url;
}
