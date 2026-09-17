/*
 * global.d.ts: tells TypeScript that importing a .css file is allowed,
 * so lines like import "./index.css" compile without errors. Webpack
 * handles the actual CSS loading.
 */

declare module "*.css";