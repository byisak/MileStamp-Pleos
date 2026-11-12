import { whoFromRequest } from "@/lib/plan";
import { loadSchedule } from "@/lib/schedule";

/**
 * 일정 탭 — 폰(Bearer 폰 토큰)·차 공용, 읽기만.
 *   GET /api/plan/schedule
 *   → { today, upcoming: [{ day, planId, title, stops:[{placeId, name, lat, lng, arriveMin, departMin, status}], departMin, arriveHomeMin,
 *                          chosenBy, companion?, anchorId?, course, version }],
 *       past: [{ day, planId, title, stops, visited:[placeId…], stampsEarned }] }
 *   upcoming = 오늘 ~ 14일 뒤, 날마다 가장 최근의 코스 있는 계획(취소하면 코스가 지워져 빠진다), 날짜 순.
 *   past = 지난 60일 중 코스가 있던 날, 최근 날 먼저. visited = 코스에서 도착·다녀옴 + 그날 도장·'다녀옴' 기록이 있는 곳.
 *   stampsEarned = 그날 받은 도장 수(코스 밖 곳 포함).
 * 날짜 옮기기 = POST /api/plan/schedule/move (move/route.ts) · 취소 = POST /api/plan/choose {planId, idx: null}
 */
export async function GET(req: Request) {
  const who = await whoFromRequest(req);
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await loadSchedule(who.carId));
}
