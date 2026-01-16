const CACHE_NAME = 'plx-scanner-v7-no-dropdown'; 

const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://docs.opencv.org/4.5.0/opencv.js'
];

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then((keyList) => Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) return caches.delete(key);
    }))));
    return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    e.respondWith(caches.match(e.request).then((response) => response || fetch(e.request)));
});