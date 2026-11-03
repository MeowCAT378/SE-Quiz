import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { FileSystemIconLoader } from 'unplugin-icons/loaders';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vite';
import { SvelteTitleCompiler } from '../icon-compiler.js';

// Isolated component/IndexedDB harness: no application server, credentials or live database.
export default defineConfig({
	plugins: [
		svelte({ configFile: false }),
		Icons({
			compiler: SvelteTitleCompiler,
			customCollections: { custom: FileSystemIconLoader('./src/lib/assets/icons') }
		})
	],
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('../src/lib', import.meta.url)),
			'$app/navigation': fileURLToPath(new URL('./browserFramework.ts', import.meta.url)),
			'$app/paths': fileURLToPath(new URL('./browserFramework.ts', import.meta.url)),
			'$app/state': fileURLToPath(new URL('./browserFramework.ts', import.meta.url)),
			'$app/environment': fileURLToPath(new URL('./browserFramework.ts', import.meta.url)),
			'$env/dynamic/public': fileURLToPath(new URL('./browserFramework.ts', import.meta.url))
		}
	},
	server: { host: '127.0.0.1', port: 9396, strictPort: true }
});
