#!/usr/bin/env node
// build.mjs — bundles 404.html + style.css + app.js + peakworker.js into one HTML file.
//
// Usage:
//   node build.mjs [--minify] [--src ./src] [--out ./dist/index.html]
//
// By default it looks for 404.html, style.css, app.js, and peakworker.js in ./src
// and writes the combined file to ./dist/index.html.
//
// style.css is inlined into a <style> tag, app.js is inlined into a <script type="module">
// tag. peakworker.js can't just be pasted into the page — it has to run in its own
// Worker thread — so instead its source is embedded as a string inside app.js and turned
// into a Blob URL at runtime; the `new Worker('/peakworker.js')` call is rewritten to use
// that Blob URL instead of fetching a separate file.
//
// Install once:  npm install --save-dev terser clean-css html-minifier-terser

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

function getArg(name, fallback) {
	const i = process.argv.indexOf(name);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const minify = process.argv.includes('--minify');
const srcDir = getArg('--src', './');
const outFile = getArg('--out', './404.html');

const readSrc = (name) => readFile(join(srcDir, name), 'utf8');

async function build() {
	let [html, css, appJs, workerJs] = await Promise.all([
		readSrc('peak.html'),
		readSrc('style.css'),
		readSrc('app.js'),
		readSrc('peakworker.js'),
	]);

	if (minify) {
		const { minify: minifyJs } = await import('terser');
		const { default: CleanCSS } = await import('clean-css');

		// (A few more passes, and rewrites that are safe for this code: a few
		// hundred bytes)
		const opts = {ecma: 2020, compress: {passes: 3, unsafe: true, unsafe_arrows: true, unsafe_methods: true, pure_getters: true}, format: {ecma: 2020}};
		const [appMin, workerMin] = await Promise.all([
			minifyJs(appJs, { ...opts, module: true }),
			minifyJs(workerJs, { ...opts, toplevel: true }), // (nothing outside it uses its names)
		]);
		if (appMin.error) throw appMin.error;
		if (workerMin.error) throw workerMin.error;
		appJs = appMin.code;
		workerJs = workerMin.code;

		const cssResult = new CleanCSS({ level: { 1: { all: true }, 2: { all: true } } }).minify(css);
		if (cssResult.errors.length) throw new Error(cssResult.errors.join('\n'));
		css = cssResult.styles;

		// Short names for the stylesheet's own custom properties (--card-bg
		// -> --A), most used first: capitals (A..Z, then AA, AB, ...), which
		// dictionaries' own styles don't use (cambogeo's --s); not the ones
		// app.js sets ('--load')
		const used = {};
		for (const [, n] of css.matchAll(/--([\w-]+)/g)) used[n] = (used[n] || 0) + 1;
		const keep = n => /^[A-Z]+$/.test(n) || appJs.includes(`'--${n}'`) || appJs.includes(`"--${n}"`);
		const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', shortName = i => (i >= 26 ? L[Math.floor(i / 26) - 1] : '') + L[i % 26];
		const short = {};
		Object.keys(used).filter(n => !keep(n)).sort((a, b) => used[b] * b.length - used[a] * a.length)
			.forEach((n, i) => { short[n] = shortName(i); });
		css = css.replace(/--([\w-]+)/g, (m, n) => short[n] ? `--${short[n]}` : m);
	}

	// Embed peakworker.js as a string constant and hand app.js a ready-made Blob URL
	// for it, then point the existing Worker(...) call at that URL instead of a path.
	// Matches new Worker('/peakworker.js') or new Worker("/peakworker.js") — minifiers
	// are free to swap the quote style, so this can't be a plain string match.
	const workerCallRe = /new Worker\((['"])\/peakworker\.js\1\)/;
	if (!workerCallRe.test(appJs)) {
		throw new Error(`Could not find new Worker('/peakworker.js') in app.js — has it changed? Update build.mjs to match.`);
	}
	// (A name the minifier won't have used: its are a few characters long)
	const workerUrlVar = '__pw_';
	// (A template literal: fewer escapes than a JSON string's)
	const workerStr = '`' + workerJs.replace(/[\\`]|\$\{/g, '\\$&') + '`';
	appJs = `const ${workerUrlVar}=URL.createObjectURL(new Blob([${workerStr}],{type:"text/javascript"}));` +
		appJs.replace(new RegExp(workerCallRe, 'g'), `new Worker(${workerUrlVar})`);

	// Inline the stylesheet <link> and the app.js <script src>.
	html = html.replace(
		/<link[^>]*rel=["']stylesheet["'][^>]*href=["']\/style\.css["'][^>]*>/i,
		() => `<style>${css}</style>`
	);
	html = html.replace(
		/<script[^>]*src=["']\/app\.js["'][^>]*><\/script>/i,
		() => `<script type="module">${appJs}</script>`
	);

	if (minify) {
		const { minify: minifyHtml } = await import('html-minifier-terser');
		html = await minifyHtml(html, {
			collapseWhitespace: true,
			removeComments: true,
			removeAttributeQuotes: true,
			collapseBooleanAttributes: true,
			removeRedundantAttributes: true,
			removeOptionalTags: true,
			useShortDoctype: true,
			removeEmptyAttributes: true,
			// JS/CSS are already minified above; skip re-minifying them here.
			minifyCSS: false,
			minifyJS: false,
		});
	}

	await mkdir(dirname(outFile), { recursive: true });
	await writeFile(outFile, html, 'utf8');

	const kb = (s) => (Buffer.byteLength(s, 'utf8') / 1024).toFixed(1);
	console.log(`Wrote ${outFile} (${kb(html)} KB)`);
	console.log(`  html: ${kb(html)} KB total  |  css: ${kb(css)} KB  |  app.js: ${kb(appJs)} KB  |  peakworker.js: ${kb(workerJs)} KB`);
}

build().catch((err) => {
	console.error(err);
	process.exit(1);
});
