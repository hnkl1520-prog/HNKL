// 앱 파일에서 '==== 이름 START/END ====' 구역을 떼어 Node 에서 돌린다.
// 앱은 한 파일(odd-mirror.html)로 두고, 검증은 같은 코드를 그대로 쓰기 위한 장치.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP = path.resolve(HERE, '../../public/works/labs/odd-mirror/odd-mirror.html');

export function sectionCode(names, html = fs.readFileSync(APP, 'utf8')) {
  return names.map((n) => {
    const m = html.match(new RegExp(`// ==== ${n} START ====\\n([\\s\\S]*?)// ==== ${n} END ====`));
    if (!m) throw new Error(`구역 없음: ${n}`);
    return m[1];
  }).join('\n');
}

export function load(names, exported) {
  return new Function(`${sectionCode(names)}\nreturn { ${exported.join(', ')} };`)();
}
