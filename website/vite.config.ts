import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { sveltekit } from '@sveltejs/kit/vite';
import { FileSystemIconLoader } from 'unplugin-icons/loaders';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vite';
import { SvelteTitleCompiler } from './icon-compiler.js';
import config from './svelte.config.js';

const base = config.kit?.paths?.base ?? '';

export default defineConfig({
	plugins: [
		sveltekit(),
		Icons({
			compiler: SvelteTitleCompiler,
			customCollections: {
				custom: FileSystemIconLoader('./src/lib/assets/icons')
			}
		}),
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			strategy: ['url', 'cookie', 'baseLocale'],
			// Match deployed URLs and the logical paths passed to resolve(localizeHref(...)).
			...(base && {
				urlPatterns: [base, ''].map((prefix) => ({
					pattern: `${prefix}/:path(.*)?`,
					localized: [
						['en', `${prefix}/en/:path(.*)?`],
						['th', `${prefix}/:locale(th)?/:path(.*)?`]
					]
				}))
			})
		})
	],
	ssr: {
		noExternal: ['@thisux/sveltednd']
	}
});
