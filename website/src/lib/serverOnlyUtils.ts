import { Buffer } from 'node:buffer';
import { env as privateEnv } from '$env/dynamic/private';
import { env } from '$env/dynamic/public';
import {
	getMedia,
	type IdlessFullFuizConfig,
	type PublishedFuiz,
	type PublishedFuizDB
} from './types';
import { bring } from './util';

export function dataURIToBlob(dataURI: string): Blob {
	const [info, data] = dataURI.split(',');

	const mimeString = info.split(';')[0].split(':')[1];

	return new Blob([Uint8Array.fromBase64(data)], {
		type: mimeString
	});
}

export async function getThumbnail(
	fuiz: IdlessFullFuizConfig
): Promise<{ thumbnail: ArrayBuffer; thumbnailAlt: string } | undefined> {
	return await fuiz.slides.reduce<
		Promise<{ thumbnail: ArrayBuffer; thumbnailAlt: string } | undefined> | undefined
	>(async (m, s) => {
		const prev = await m;
		if (prev) return prev;
		const media = getMedia(s);
		if (!media) return undefined;
		const blob = dataURIToBlob(media.Image.Base64.data);

		const formData = new FormData();
		formData.append('image', blob);

		const thumbnail = await bring(
			(privateEnv.CORKBOARD_INTERNAL_URL || env.PUBLIC_CORKBOARD_URL) + '/thumbnail',
			{
				method: 'POST',
				body: formData
			}
		);

		if (!thumbnail?.ok) return undefined;

		return { thumbnail: await thumbnail.arrayBuffer(), thumbnailAlt: media.Image.Base64.alt };
	}, undefined);
}

export function encodeAsDataURL(array: ArrayBuffer | Uint8Array | Buffer): string {
	try {
		const base64 = Buffer.from(array as any).toString('base64');
		return 'data:image/png;base64,' + base64;
	} catch {
		let binary = '';
		for (const byte of new Uint8Array(array as any)) {
			binary += String.fromCharCode(byte);
		}
		return 'data:image/png;base64,' + btoa(binary);
	}
}

export function fixPublish(p: PublishedFuizDB): PublishedFuiz {
	let thumbnail: string | null = null;
	if (p.thumbnail) {
		try {
			thumbnail = encodeAsDataURL(p.thumbnail);
		} catch (err) {
			console.warn('Could not encode thumbnail for quiz:', err);
		}
	}

	let subjects: string[] = [];
	if (p.subjects) {
		try {
			subjects = typeof p.subjects === 'string' ? JSON.parse(p.subjects) : (p.subjects as any);
		} catch {
			subjects = [];
		}
	}

	let grades: string[] = [];
	if (p.grades) {
		try {
			grades = typeof p.grades === 'string' ? JSON.parse(p.grades) : (p.grades as any);
		} catch {
			grades = [];
		}
	}

	let published_at = new Date();
	if (p.published_at) {
		try {
			published_at = new Date(p.published_at);
		} catch {
			published_at = new Date();
		}
	}

	return {
		...p,
		thumbnail,
		subjects: Array.isArray(subjects) ? subjects : [],
		grades: Array.isArray(grades) ? grades : [],
		published_at
	};
}
