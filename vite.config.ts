import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import { readFileSync } from 'fs';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), mkcert()],
	server: {
		https: {
			cert: readFileSync('src/ssl/localhost+2.pem'),
			key: readFileSync('src/ssl/localhost+2-key.pem')
		},
		host: true,
		hmr: {
			protocol: 'wss',
			host: 'localhost'
		}
	},
	preview: {
		https: {
			cert: readFileSync('src/ssl/localhost+2.pem'),
			key: readFileSync('src/ssl/localhost+2-key.pem')
		},
		host: true
	}
});
