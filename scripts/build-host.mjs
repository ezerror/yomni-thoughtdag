import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../upstream/package.json', import.meta.url));
const postcss = require('postcss');
const css = postcss.parse(await readFile(new URL('../dist/host-app/app.css', import.meta.url), 'utf8'));
css.walkRules(rule => {
  rule.selector = rule.selector.replace(/:root|:host/g, '.thoughtdag-host').replace(/(^|[\s,>+~])(?:html|body)(?=[\s.#:[,>+~]|$)/g, '$1.thoughtdag-host');
});
await writeFile(new URL('../ui/canvas.css', import.meta.url), css.toString() + '\n.thoughtdag-host{position:relative;width:100%;height:100%;min-height:0;overflow:hidden;contain:layout paint style;isolation:isolate;font-family:inherit;--font-sans:inherit}.thoughtdag-host :focus-visible{outline:none;box-shadow:none}\n');
