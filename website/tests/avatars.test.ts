import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { avatars, avatarUrl, defaultAvatar, randomAvatar } from '../src/lib/game/avatars';

describe('avatar catalog', () => {
	it('maps exactly 20 stable IDs to transparent 64 × 64 PNG assets', () => {
		expect(new Set(avatars.map((avatar) => avatar.id)).size).toBe(20);
		expect(avatars).toHaveLength(20);
		expect(new Set(avatars.map((avatar) => avatar.label())).size).toBe(20);
		for (const avatar of avatars) {
			expect(avatar.src).toBe(`/avatars/${avatar.id}.png`);
			const png = readFileSync(new URL(`../static${avatar.src}`, import.meta.url));
			expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
			expect(png.readUInt32BE(16)).toBe(64);
			expect(png.readUInt32BE(20)).toBe(64);
			expect(png[25]).toBe(6); // RGBA, retaining transparent pixels.
			const idatLength = png.readUInt32BE(33);
			const rgba = inflateSync(png.subarray(41, 41 + idatLength));
			const colors = new Set<string>();
			let transparent = false;
			for (let y = 0; y < 64; y++) {
				expect(rgba[y * 257]).toBe(0); // Each row uses the lossless None filter.
				for (let x = 0; x < 64; x++) {
					const pixel = rgba.subarray(y * 257 + 1 + x * 4, y * 257 + 5 + x * 4);
					if (pixel[3] === 0) transparent = true;
					else colors.add(pixel.toString('hex'));
				}
			}
			expect(transparent).toBe(true);
			expect(colors.size).toBeGreaterThanOrEqual(8);
			expect(colors.size).toBeLessThanOrEqual(12);
			if (avatar.id === 'avatar-01') {
				expect(colors.has('4a82b5ff')).toBe(true); // Blue eyes.
				expect(colors.has('91c8e9ff')).toBe(true); // Light-blue dress.
			}
		}
	});

	it('chooses only allowed IDs and uses one fallback for missing or invalid values', () => {
		const allowed = new Set(avatars.map((avatar) => avatar.id));
		for (let i = 0; i < 1000; i++) expect(allowed.has(randomAvatar())).toBe(true);
		expect(avatarUrl(undefined)).toBe(avatarUrl(defaultAvatar));
		expect(avatarUrl('https://example.com/portrait.png')).toBe(avatarUrl(defaultAvatar));
	});
});
