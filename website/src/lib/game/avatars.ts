import { assets } from '$app/paths';
import * as m from '$lib/paraglide/messages.js';

export const avatars = Array.from({ length: 20 }, (_, index) => {
	const number = String(index + 1).padStart(2, '0');
	return {
		id: `avatar-${number}`,
		src: `${assets}/avatars/avatar-${number}.png`,
		label: () => m.avatar_option({ number: String(index + 1) })
	};
});

export const defaultAvatar = avatars[0].id;

export function avatarUrl(id: string | undefined): string {
	return avatars.find((avatar) => avatar.id === id)?.src ?? avatars[0].src;
}

export function randomAvatar(): string {
	return avatars[Math.floor(Math.random() * avatars.length)].id;
}
