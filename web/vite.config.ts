import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

const raiz = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: raiz,
  base: '/precios-mercado/',
  define: { __VERSION__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) ?? 'local') },
  resolve: { alias: { '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)) } },
  server: { fs: { allow: ['..'] } },
  build: { outDir: 'dist', emptyOutDir: true },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt': nunca se recarga sola en medio de una compra; avisa y el usuario decide.
      registerType: 'prompt',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.svg'],
      manifest: {
        name: 'Precios de Mercado',
        short_name: 'Mercado',
        description: 'Compara precios de Éxito, Olímpica, D1 y Ara en Riohacha y lleva el presupuesto mientras compras.',
        lang: 'es-CO',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f7f5f0',
        theme_color: '#0f766e',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Solo el shell de la app. Los datos van en IndexedDB; nunca se cachean respuestas de Google.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        // Solo los logos de las tiendas (imágenes estáticas), para verlos sin señal.
        runtimeCaching: [
          {
            // El lector de códigos para celulares sin lector propio (iPhone): 1 MB, solo se baja si se usa la cámara.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: { cacheName: 'lector-codigos', expiration: { maxEntries: 2 }, cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url }) =>
              /(^|\.)(exito\.com|olimpica\.com|vteximg\.com\.br|aratiendas\.com)$/.test(url.hostname) &&
              /\.(ico|png|jpe?g|svg|webp)$/i.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'logos-tiendas',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
