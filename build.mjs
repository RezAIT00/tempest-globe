import { build } from 'esbuild';
import { writeFileSync, readFileSync } from 'node:fs';
const r = await build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', target: 'es2021', write: false, legalComments: 'eof', logLevel: 'info' });
const js = r.outputFiles[0].text.replaceAll('</script', '<\\/script');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>Tempest Globe</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#050405}body{background:radial-gradient(circle at 50% 46%,#0b1013 0,#0a0d10 min(39vh,39vw),#2a2a30 calc(min(39vh,39vw) + 1px),#17171b calc(min(39vh,39vw) + 5px),#07070a calc(min(39vh,39vw) + 7px),#050405 72%)}canvas{display:block;position:fixed;inset:0;width:100vw;height:100vh;touch-action:none;outline:none;-webkit-user-select:none;user-select:none;opacity:0;transition:opacity 1.2s}</style></head><body><canvas id="c"></canvas><script>${js}</script></body></html>`;
writeFileSync('tempest-globe.html', html);
console.log('tempest-globe.html', (html.length / 1024).toFixed(0) + ' KB', readFileSync('src/main.js').length);
