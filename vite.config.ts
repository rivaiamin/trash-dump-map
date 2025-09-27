import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import { readFileSync } from 'fs';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), mkcert()],
	server: {
		https: {
			cert: readFileSync('/mnt/c/Users/user/dev-certs/localhost-cert.pem'),
			key: readFileSync('/mnt/c/Users/user/dev-certs/localhost-key.pem')
		},
		host: true,
		hmr: {
			protocol: 'wss',
			host: 'localhost'
		}
	},
	preview: {
		https: {
			cert: readFileSync('/mnt/c/Users/user/dev-certs/localhost-cert.pem'),
			key: readFileSync('/mnt/c/Users/user/dev-certs/localhost-key.pem')
		},
		host: true
	}
});
