import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(() => {
	// Docker entrypoint exports BACKEND_URL for the frontend process.
	// We proxy /api -> backend so the browser can use relative URLs.
	const backendUrl = process.env.BACKEND_URL ?? 'http://127.0.0.1:8080';
	const backendApiKey = process.env.BACKEND_API_KEY ?? '';

	return {
		plugins: [tailwindcss(), react()],
		server: {
			host: true,
			port: 3000,
			strictPort: true,
			proxy: {
				'/api': {
					target: backendUrl,
					changeOrigin: true,
					configure: (proxy) => {
						proxy.on('proxyReq', (proxyReq) => {
							if (backendApiKey) proxyReq.setHeader('x-api-key', backendApiKey);
						});
					}
				},
				'/openapi.json': {
					target: backendUrl,
					changeOrigin: true,
					configure: (proxy) => {
						proxy.on('proxyReq', (proxyReq) => {
							if (backendApiKey) proxyReq.setHeader('x-api-key', backendApiKey);
						});
					}
				}
			}
		},
		preview: {
			host: true,
			port: 3000,
			strictPort: true
		}
	};
});
