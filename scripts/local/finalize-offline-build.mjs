import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSW } from "workbox-build";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const clientDirectory = resolve(root, ".output/public");
const serviceWorkerDirectory = resolve(clientDirectory, "offline-shell.js");
const serviceWorkerDestination = resolve(clientDirectory, "sw.js");

await mkdir(clientDirectory, { recursive: true });
await writeFile(
  serviceWorkerDirectory,
  `self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      const shellUrl = new URL("/", self.location.origin);
      const response = await fetch(shellUrl, { cache: "no-store" });
      if (response.ok) {
        const cache = await caches.open("offline-shell");
        await cache.put(shellUrl, response);
      }
    } catch (error) {
      console.warn("[Offline app] Could not cache the public app shell:", error);
    }
  })());
});
`,
);

const result = await generateSW({
  globDirectory: clientDirectory,
  globPatterns: ["**/*.{js,css,png,svg,woff2,webmanifest}"],
  swDest: serviceWorkerDestination,
  importScripts: ["/offline-shell.js"],
  clientsClaim: true,
  skipWaiting: true,
  cleanupOutdatedCaches: true,
  maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
  runtimeCaching: [
    {
      urlPattern: ({ request, url }) =>
        request.mode === "navigate" &&
        !url.pathname.startsWith("/~oauth") &&
        !url.pathname.startsWith("/api/"),
      handler: "NetworkFirst",
      options: {
        cacheName: "pages",
        networkTimeoutSeconds: 4,
        expiration: { maxEntries: 80 },
        plugins: [
          {
            handlerDidError: async ({ request }) => {
              if (request.mode !== "navigate") return;
              const shellUrl = new URL("/", self.location.origin);
              const cache = await caches.open("offline-shell");
              return cache.match(shellUrl);
            },
          },
        ],
      },
    },
    {
      urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/assets/"),
      handler: "CacheFirst",
      options: { cacheName: "assets", expiration: { maxEntries: 400 } },
    },
  ],
});

if (result.count === 0) {
  throw new Error("The offline service worker did not precache any client assets.");
}

console.log(`Generated offline service worker with ${result.count} precached assets.`);
