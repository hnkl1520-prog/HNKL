import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,

    // 상위 폴더(원본 사이트)에도 package-lock.json 이 있어서 Next 가 루트를 헷갈려한다.
    // 이 프로젝트 폴더가 루트임을 못박는다.
    outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),

    // 원본이 <img>/<video> 를 직접 쓰므로 next/image 최적화는 켜지 않는다.
    // (최적화가 끼면 크기·화질이 미세하게 달라져 '원본과 동일' 조건이 깨진다)
    images: { unoptimized: true },
};

export default nextConfig;
