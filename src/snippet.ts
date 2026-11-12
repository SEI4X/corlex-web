import { boot } from './boot'

// Entry of dist/c.js: the no-code snippet. It runs once, from an async <script>.
boot(document.currentScript as HTMLScriptElement | null, window)
