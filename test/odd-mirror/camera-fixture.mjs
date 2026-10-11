// macOS의 기본 이미지 도구로 기존 사진을 가상 카메라 BMP로 변환. 외부 전송 없음.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const src=fileURLToPath(new URL('../../public/assets/Profile_Photo.png',import.meta.url));
const crop='/private/tmp/odd-mirror-fixture-crop.png',padded='/private/tmp/odd-mirror-fixture-padded.png',bmp='/private/tmp/odd-mirror-fixture-final.bmp';
execFileSync('/usr/bin/sips',['-c','720','720','--cropOffset','300','230',src,'--out',crop],{stdio:'ignore'});
// 16:9 가상 카메라에 패딩할 때 얼굴이 검출 최소 크기보다 작아지지 않게 확대.
execFileSync('/usr/bin/sips',['-c','400','400','--cropOffset','100','170',crop,'--out',crop],{stdio:'ignore'});
execFileSync('/usr/bin/sips',['-z','720','720',crop,'--out',crop],{stdio:'ignore'});
execFileSync('/usr/bin/sips',['-p','720','1280','--padColor','DDDDDD',crop,'--out',padded],{stdio:'ignore'});
execFileSync('/usr/bin/sips',['-s','format','bmp',padded,'--out',bmp],{stdio:'ignore'});
console.log(bmp);
