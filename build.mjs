// Bündelt die Oberfläche nach src/renderer/dist/app.js
import { build } from 'esbuild';

const dev = process.argv.includes('--dev');
await build({ entryPoints: ['src/renderer/js/app.js'], bundle: true, minify: !dev, sourcemap: dev ? 'inline' : false, legalComments: 'none', logLevel: 'warning', format: 'iife', target: 'chrome130', outfile: 'src/renderer/dist/app.js' });
