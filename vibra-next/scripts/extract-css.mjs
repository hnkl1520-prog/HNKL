// 원본 vibra.html 의 <style> 블록을 public/vibra.css 로 그대로 뽑아낸다.
//
//   node scripts/extract-css.mjs
//
// 원본 CSS 를 고쳤을 때 다시 돌리면 된다. 내용은 한 글자도 바꾸지 않는다.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../../public/works/projects/vibra/vibra.html');
const OUT = resolve(here, '../public/vibra.css');

const html = readFileSync(SRC, 'utf8');

const open = html.indexOf('<style>');
const close = html.indexOf('</style>', open);
if (open < 0 || close < 0) throw new Error('vibra.html 에서 <style> 블록을 찾지 못했습니다.');

// 앞뒤 개행/공백만 다듬고 내용은 그대로
const css = html
    .slice(open + '<style>'.length, close)
    .replace(/^\r?\n/, '')
    .replace(/[ \t]*$/, '');

writeFileSync(OUT, css, 'utf8');

console.log(`추출 완료 → public/vibra.css`);
console.log(`  ${css.split('\n').length}줄 · ${(Buffer.byteLength(css, 'utf8') / 1024).toFixed(1)}KB`);
