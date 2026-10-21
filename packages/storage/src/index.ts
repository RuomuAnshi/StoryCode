export * from './fs-adapter.js';
export * from './memory-fs.js';
export * from './project-store.js';
export * from './snapshot-store.js';
export * from './proposal-service.js';
export * from './search-index.js';
export * from './indexer.js';
// NOTE: `node-fs.js` is deliberately NOT re-exported here. It imports
// `node:fs`, which would drag Node built-ins into the Tauri webview bundle.
// Node-only consumers (tests, scripts) import it from
// `@storycode/storage/node-fs` instead.
