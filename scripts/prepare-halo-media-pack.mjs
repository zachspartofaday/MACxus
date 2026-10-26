// Legacy maintainer command; preparation now uses the shared catalog/handler.
process.argv.push('--pack', 'halo-preview-media-v1');
await import('./prepare-compatibility-packs.mjs');
