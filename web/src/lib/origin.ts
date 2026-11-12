/** 폰이 열 주소의 앞부분. 운영은 PUBLIC_URL, 없으면 요청이 들어온 주소. */
export function publicOrigin(req: Request) {
  return (process.env.PUBLIC_URL ?? new URL(req.url).origin).replace(/\/$/, "");
}
