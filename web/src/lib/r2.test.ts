import { test } from "node:test";
import assert from "node:assert/strict";
import { presignPut, publicUrl, r2Ready, stampKey } from "./r2";

test("R2: 판마다 새 키, 공개 주소, 서명된 PUT 주소 (통신 없음)", async () => {
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE"]) delete process.env[k];
  assert.equal(r2Ready(), false);
  Object.assign(process.env, {
    R2_ACCOUNT_ID: "acc123", R2_ACCESS_KEY_ID: "AK", R2_SECRET_ACCESS_KEY: "SK", R2_BUCKET: "milestamp", R2_PUBLIC_BASE: "https://pub-x.r2.dev/",
  });
  assert.equal(r2Ready(), true);
  assert.equal(stampKey("chimsan", 3, false), "stamps/chimsan/3.webp");
  assert.equal(stampKey("chimsan", 3, true), "stamps/chimsan/3_bw.webp");
  assert.equal(publicUrl("stamps/chimsan/3.webp"), "https://pub-x.r2.dev/stamps/chimsan/3.webp");
  const u = new URL(await presignPut("stamps/chimsan/3.webp"));
  assert.match(u.href, /acc123\.r2\.cloudflarestorage\.com/);
  assert.match(u.pathname, /stamps\/chimsan\/3\.webp$/);
  assert.ok(u.searchParams.get("X-Amz-Signature"));
  assert.equal(u.searchParams.get("X-Amz-Expires"), "300");
});
