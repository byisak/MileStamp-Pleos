import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * 도장 그림 저장소 = Cloudflare R2 (S3 호환). 서버는 짧은(5분) PUT 주소만 만들어 주고, 브라우저가 webp를 R2에 바로 올린다.
 * 환경 변수: R2_ACCOUNT_ID · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_BUCKET · R2_PUBLIC_BASE(공개 주소, 예: https://pub-xxxx.r2.dev)
 * 키: stamps/<placeId>/<version>.webp · stamps/<placeId>/<version>_bw.webp — 판마다 새 키라 바뀌지 않음(1년 캐시).
 * 축제: festivals/<id>/poster-<판>.webp · festivals/<id>/stamp-<판>.webp(_bw).
 * 버킷 CORS: PUT을 https://milestamp.vercel.app · http://localhost:3200 에서, 헤더 Content-Type 허용.
 */
export function r2Ready(): boolean {
  const e = process.env;
  return !!(e.R2_ACCOUNT_ID && e.R2_ACCESS_KEY_ID && e.R2_SECRET_ACCESS_KEY && e.R2_BUCKET && e.R2_PUBLIC_BASE);
}

let client: S3Client | null = null;
function s3(): S3Client {
  client ??= new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  });
  return client;
}

export function stampKey(placeId: string, version: number, bw: boolean): string {
  return `stamps/${placeId}/${version}${bw ? "_bw" : ""}.webp`;
}

/** 축제 그림: festivals/<id>/poster-<판>.webp (1080px 이하) · festivals/<id>/stamp-<판>.webp · stamp-<판>_bw.webp. */
export function festivalKey(festivalId: string, kind: "poster" | "stamp", version: number, bw = false): string {
  return `festivals/${festivalId}/${kind}-${version}${bw && kind === "stamp" ? "_bw" : ""}.webp`;
}

export function publicUrl(key: string): string {
  return `${process.env.R2_PUBLIC_BASE!.replace(/\/+$/, "")}/${key}`;
}

export async function presignPut(key: string): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET!,
    Key: key,
    ContentType: "image/webp",
    CacheControl: "public, max-age=31536000, immutable",
  });
  return getSignedUrl(s3(), cmd, { expiresIn: 300 });
}

/** AI 도장 후보·배경: ai/<place|festival>/<id>/<jobId>/<n>.<webp|png|jpg> (작업마다 새 키). */
export function aiKey(kind: "place" | "festival", id: string, jobId: string, n: number | "bg", ext: string): string {
  return `ai/${kind}/${id}/${jobId}/${n}.${ext}`;
}

/** 서버가 바로 올리기 (AI 그림처럼 서버에서 만든 것). */
export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<string> {
  await s3().send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET!,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: "public, max-age=31536000, immutable",
  }));
  return publicUrl(key);
}
