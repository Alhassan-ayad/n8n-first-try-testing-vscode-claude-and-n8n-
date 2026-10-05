import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.CEP_API_URL ?? 'http://127.0.0.1:3000', rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
});
