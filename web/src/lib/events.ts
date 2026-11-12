import { sql, type EventKind } from "./db";
import { place } from "./places";
import { pushToCar, type PushMessage } from "./push";
import { assignStampNumber } from "./stamp-number";
import { stopName } from "./livecourse";
import { releasePending } from "./community";

export const KINDS: EventKind[] = ["handoff", "mission", "intro", "stamp", "summary"];

/**
 * 소식을 저장하고 이 차의 가족 폰에 알린다 (차 API와 데모 시험이 같이 쓴다). push: false면 저장만.
 * festival = 축제 한정 도장 (place_id 칸에 축제 id, 이름은 축제 이름, 알림 '축제 도장!'). exceptPhone = 알림에서 뺄 폰(보낸 폰).
 */
export async function createEvent(
  carId: string, kind: EventKind, placeId: string | null, payload: Record<string, unknown>,
  opts: { push?: boolean; festival?: { id: string; name: string }; exceptPhone?: string } = {},
) {
  const fest = kind === "stamp" ? opts.festival : undefined;
  const p = fest ? { id: fest.id, name: fest.name, mission: undefined } : place(placeId);
  if (kind === "stamp") payload = await stampNumber(carId, payload);
  const [ev] = await sql<{ id: string; created_at: Date }[]>`
    insert into events (car_id, kind, place_id, payload)
    values (${carId}, ${kind}, ${p?.id ?? null}, ${sql.json(payload as never)})
    returning id, created_at`;

  // 집 도착(오늘 요약) → '함께'에 올려 두고 기다리던 글을 지금 보이게 (표가 없으면 조용히 넘어감)
  if (kind === "summary") await releasePending(carId);

  const url = `/e/${ev.id}`;
  // 장소표 밖(바깥 장소 'ext:…')이면 차가 실어 보낸 이름 (없으면 '고른 곳') — 날 id는 알림에 쓰지 않는다
  const name = p?.name ?? (placeId ? stopName(placeId, typeof payload.name === "string" ? payload.name : null) : "");
  const messages: Partial<Record<EventKind, PushMessage>> = {
    handoff: { title: "폰에서 이어 들어요", body: `${name} 이야기, 끊긴 문장부터`, url, tag: "listen" },
    mission: { title: `${name} 미션 도착`, body: "주차장을 벗어난 뒤 시작해요", url, tag: `mission-${p?.id}` },
    intro: { title: `곧 ${name}`, body: "조용히 가는 중이라 소개를 폰으로 보냈어요", url, tag: "intro" },
    summary: { title: "오늘 하루 자랑 카드", body: "가족에게 보내 보세요", url, tag: "summary" },
    stamp: fest ? {
      title: `축제 도장! ${name}`,
      body: `${payload.season ? `${payload.season} 한정 · ` : "기간 한정 · "}${payload.number ? `${payload.number}번째 도장 · ` : ""}도장북 '축제 도장'에 들어갔어요`,
      url, tag: "stamp",
    } : {
      title: `도장 쾅! ${name}`,
      body: payload.rare ? `희귀 도장 · ${payload.rare}` : `${payload.number ? `${payload.number}번째 도장 · ` : ""}도장북에 들어갔어요`,
      url, tag: "stamp",
    },
  };
  // 쉿 모드(아이가 자는 중)로 찍은 도장은 폰도 울리지 않는다
  const quiet = kind === "stamp" && payload.silent === true;
  const msg = opts.push === false || quiet ? undefined : messages[kind];
  // 앱은 data만으로 해당 시트를 바로 연다 (서버·DB가 잠에서 깨는 몇 초를 기다리지 않게)
  const data = {
    eventId: ev.id, kind, placeId: p?.id ?? "",
    payload: JSON.stringify(payload), createdAt: ev.created_at.toISOString(),
  };
  const pushed = msg ? await pushToCar(carId, msg, data, { except: opts.exceptPhone }) : 0;
  return { id: ev.id, pushed, payload };
}

/**
 * 도장 No.는 서버가 정한다: 이 차의 앞선 도장 수 + 1. 차가 보낸 번호가 없거나 다르면 서버 번호로 바꾸고,
 * 차가 보낸 번호는 payload.carNumber에 남긴다 (차가 자기 기록을 서버 행과 맞춰 볼 때 씀).
 */
export async function stampNumber(carId: string, payload: Record<string, unknown>) {
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from events where car_id = ${carId} and kind = 'stamp'`;
  return assignStampNumber(payload, n);
}
