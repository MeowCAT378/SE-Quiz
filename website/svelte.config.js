import { default as cloudflareAdapter } from '@sveltejs/adapter-cloudflare';
import { default as nodeAdapter } from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const adapterName = process.env.ADAPTER || 'cloudflare';
const base = process.env.BASE_PATH ?? '';
if (base && (!/^(\/[A-Za-z0-9_-]+)+$/.test(base) || base.trim() !== base))
	throw new Error('BASE_PATH must use /name segments without a trailing slash');

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: [vitePreprocess()],

	kit: {
		adapter: adapterName === 'node' ? nodeAdapter() : cloudflareAdapter(),

		paths: {
			base: /** @type {'' | `/${string}`} */ (base),
			relative: false
		}
	}
};

export default config;
