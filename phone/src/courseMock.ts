// 코스 진행 '모의' 엔진 — 개발 탭 '코스 시험'에서 서버 없이 화면을 돌려 보기 위한 것.
// 기준 하루(engine/src/test/resources/plan-live-cases.json base)에서 시작해 사건마다 대충 시간표를 다시 짠다.
// 진짜 판정은 서버(엔진 이식)가 한다. 여기 숫자·글은 시험 사례와 비슷하게만 맞춘 것이고 규칙의 원본이 아니다.
import { Change, CourseEvent, LiveCourse, LiveStop, Outcome } from './course';
import { Leg, PlanOption, Stop, hhmm, toMin } from './plan';

type P = { id: string; name: string; lat: number; lng: number; indoor: boolean; dwell: number; open: number; close: number; stampable: boolean };
const m = (s: string) => toMin(s)!;
// 엔진 SeedPlaces 중 시험에 나오는 곳만 (plan-cases.json 값)
export const MOCK_PLACES: P[] = [
  { id: 'seokgul', name: '군위 삼존석굴', lat: 36.0489, lng: 128.6409, indoor: false, dwell: 30, open: m('09:00'), close: m('18:00'), stampable: true },
  { id: 'samguk', name: '삼국유사테마파크', lat: 36.16429, lng: 128.69592, indoor: false, dwell: 160, open: m('10:00'), close: m('18:00'), stampable: true },
  { id: 'dgsm', name: '국립대구과학관', lat: 35.6862, lng: 128.46642, indoor: true, dwell: 120, open: m('09:30'), close: m('17:30'), stampable: true },
  { id: 'thearc', name: '디아크', lat: 35.83908, lng: 128.46817, indoor: true, dwell: 25, open: m('10:00'), close: m('18:00'), stampable: true },
  { id: 'hwabon', name: '화본역', lat: 36.12665, lng: 128.69488, indoor: false, dwell: 40, open: m('09:00'), close: m('18:00'), stampable: true },
  { id: 'hahoe', name: '안동 하회마을', lat: 36.539, lng: 128.518, indoor: false, dwell: 120, open: m('09:00'), close: m('18:00'), stampable: true },
  { id: 'aquarium', name: '대구아쿠아리움', lat: 35.87802, lng: 128.62943, indoor: true, dwell: 100, open: m('10:00'), close: m('19:00'), stampable: false },
  { id: 'kidsworld', name: '대구어린이세상', lat: 35.84665, lng: 128.62776, indoor: true, dwell: 120, open: m('09:30'), close: m('18:00'), stampable: false },
  { id: 'nmd', name: '국립대구박물관', lat: 35.84586, lng: 128.63721, indoor: true, dwell: 75, open: m('10:00'), close: m('18:00'), stampable: false },
];
const HOME = { lat: 35.8858, lng: 128.5828 };
const NAP = [m('13:00'), m('14:30')];
const LIMIT = m('17:02');
const pl = (id: string) => MOCK_PLACES.find((p) => p.id === id);
const name = (id: string) => pl(id)?.name ?? id;

function driveMin(a: { lat: number; lng: number }, b: { lat: number; lng: number }, factor: number) {
  const R = 6371, d2r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * d2r, dLng = (b.lng - a.lng) * d2r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * d2r) * Math.cos(b.lat * d2r) * Math.sin(dLng / 2) ** 2;
  const km = 2 * R * Math.asin(Math.sqrt(h));
  return Math.max(5, Math.round((km * factor) / 50 * 60));
}

type State = { course: LiveCourse; proposal: PlanOption[] | null; dwell: Record<string, number> };
let st: State | null = null;

/** 남은 곳 순서대로 지금부터 시간표를 짠다 (문 열기 기다림 · 낮잠 이동 한 번) */
/** atPlace: 지금 머무는 곳(ids[0])에 curArrive에 도착해 있음 → 출발 = max(지금, 도착 + 머무름), leaveAt이 있으면 그 시각 */
function timetable(nowMin: number, from: { lat: number; lng: number }, ids: string[], dwell: Record<string, number>, factor: number, napTaken: boolean,
  atPlace: { arrive: number; leaveAt?: number } | null) {
  const legs: Leg[] = [];
  const stops: { id: string; arrive: number; depart: number }[] = [];
  let t = nowMin, here = from, nap = napTaken;
  ids.forEach((id, i) => {
    const p = pl(id)!;
    if (i === 0 && atPlace) { // 지금 머무는 곳: 남은 머무름부터
      const dep = atPlace.leaveAt ?? Math.max(t, atPlace.arrive + (dwell[id] ?? p.dwell));
      legs.push({ kind: 'STAY', fromMin: t, toMin: dep, placeId: id });
      stops.push({ id, arrive: atPlace.arrive, depart: dep });
      here = p; t = dep; return;
    }
    const d = driveMin(here, p, factor);
    const napDrive = !nap && d >= 60 && t >= NAP[0] - 30 && t <= NAP[1];
    if (napDrive) nap = true;
    let arrive = t + d;
    legs.push({ kind: napDrive ? 'NAP_DRIVE' : 'DRIVE', fromMin: t, toMin: arrive, placeId: id });
    if (arrive < p.open) { legs.push({ kind: 'STAY', fromMin: arrive, toMin: p.open, placeId: null }); arrive = p.open; }
    const depart = arrive + (dwell[id] ?? p.dwell);
    legs.push({ kind: 'STAY', fromMin: arrive, toMin: depart, placeId: id });
    stops.push({ id, arrive, depart });
    here = p; t = depart;
  });
  const home = t + driveMin(here, HOME, factor);
  legs.push({ kind: 'HOME', fromMin: t, toMin: home, placeId: null });
  return { legs, stops, home, napTaken: nap };
}

function retime(c: LiveCourse, nowMin: number, dwell: Record<string, number>): LiveCourse {
  const cur = c.stops.find((s) => s.status === 'ARRIVED');
  const done = [...c.stops].reverse().find((s) => s.status === 'DONE');
  const from = cur ? pl(cur.placeId)! : done ? pl(done.placeId)! : HOME;
  const rem = c.stops.filter((s) => s.status === 'PLANNED' || s.status === 'NEXT').map((s) => s.placeId);
  const ids = cur ? [cur.placeId, ...rem] : rem;
  const tt = timetable(nowMin, from, ids, dwell, c.roadFactor ?? 1.3, !!c.napTaken, cur ? { arrive: cur.actualArriveMin ?? cur.plannedArriveMin } : null);
  const warnings: string[] = [];
  tt.legs.forEach((l) => { if (l.kind === 'DRIVE' && l.toMin - l.fromMin > 60) warnings.push(`깨어 있는 이동 ${l.toMin - l.fromMin}분 (${name(l.placeId!)})`); });
  if (c.rainFromMin != null) tt.stops.forEach((s) => { const p = pl(s.id)!; if (!p.indoor && s.arrive < c.rainFromMin! && s.depart > c.rainFromMin!) warnings.push(`${p.name} 머무는 중 비 (${hhmm(c.rainFromMin!)}부터)`); });
  let seenNext = false;
  const stops: LiveStop[] = c.stops.map((s) => {
    const t = tt.stops.find((x) => x.id === s.placeId);
    if (s.status === 'DONE' || s.status === 'SKIPPED') return s;
    if (s.status === 'ARRIVED') return { ...s, plannedDepartMin: t?.depart ?? s.plannedDepartMin, dwellGuessMin: dwell[s.placeId] ?? s.dwellGuessMin };
    const status = seenNext ? 'PLANNED' : 'NEXT'; seenNext = true;
    return { ...s, status, plannedArriveMin: t?.arrive ?? s.plannedArriveMin, plannedDepartMin: t?.depart ?? s.plannedDepartMin, dwellGuessMin: dwell[s.placeId] ?? s.dwellGuessMin };
  });
  return { ...c, nowMin, stops, legs: tt.legs, arriveHomeMin: tt.home, slackMin: c.limitMin - tt.home, napLeg: tt.legs.find((l) => l.kind === 'NAP_DRIVE') ?? null, warnings };
}

const stopOf = (id: string): Stop => { const p = pl(id)!; return { id, name: p.name, lat: p.lat, lng: p.lng, indoor: p.indoor, stampable: p.stampable }; };
function option(c: LiveCourse, label: string, ids: string[], dwell: Record<string, number>, leaveAt?: number): PlanOption {
  const cur = c.stops.find((s) => s.status === 'ARRIVED');
  const done = [...c.stops].reverse().find((s) => s.status === 'DONE');
  const from = cur ? pl(cur.placeId)! : done ? pl(done.placeId)! : HOME;
  const tt = timetable(c.nowMin, from, cur ? [cur.placeId, ...ids] : ids, dwell, c.roadFactor ?? 1.3, !!c.napTaken, cur ? { arrive: cur.actualArriveMin ?? cur.plannedArriveMin, leaveAt } : null);
  return { kind: ids.length ? 'COURSE' : 'GO_HOME', label: ids.length ? label : '바로 집으로', stops: ids.map(stopOf), firstLegMin: tt.legs.find((l) => l.kind !== 'STAY') ? tt.legs.find((l) => l.kind !== 'STAY')!.toMin - tt.legs.find((l) => l.kind !== 'STAY')!.fromMin : 0,
    detourMin: null, arriveHomeMin: tt.home, arriveHome: hhmm(tt.home), legs: tt.legs, reasons: [{ text: `${hhmm(tt.home)} 귀가`, tone: 'PLAIN' }] };
}

const change = (text: string, cause: string, deltaHomeMin: number, size: Change['size'], atMin: number): Change => ({ text, cause, deltaHomeMin, size, atMin });

export function mockReset(): LiveCourse {
  const dwell = { seokgul: 30, samguk: 160, dgsm: 120 }; // 기준 하루: 석굴 08:59-09:29 → 테마파크 10:00-12:40 → 과학관 14:09-16:09 → 집 16:47
  const base: LiveCourse = {
    id: 'lc-mock', version: 1, chosenBy: '아빠 폰', chosenAtMin: m('08:30'), nowMin: m('08:30'), here: [HOME.lat, HOME.lng],
    arriveHomeMin: 0, limitMin: LIMIT, slackMin: 0, rainFromMin: m('15:00'), roadFactor: 1.3, dwellScale: 1, napTaken: false,
    stops: ['seokgul', 'samguk', 'dgsm'].map((id, i) => ({ placeId: id, status: i ? 'PLANNED' : 'NEXT', plannedArriveMin: 0, plannedDepartMin: 0, dwellGuessMin: pl(id)!.dwell })),
    legs: [], warnings: [], lastChange: null,
  };
  st = { course: retime(base, m('08:30'), dwell), proposal: null, dwell };
  return st.course;
}
export const mockCourse = () => st?.course ?? mockReset();

/** 한계 침범이면 '덜 놀기'·'빼기', 여유 45분 이상이면 '한 곳 더' */
function proposals(c: LiveCourse, dwell: Record<string, number>): PlanOption[] {
  const rem = c.stops.filter((s) => s.status === 'PLANNED' || s.status === 'NEXT').map((s) => s.placeId);
  const over = c.arriveHomeMin - c.limitMin;
  if (over > 0 && rem.length) {
    const last = rem[rem.length - 1];
    const out: PlanOption[] = [];
    if (over <= 30) out.push(option(c, `${name(last)} ${over}분 덜 놀기`, rem, { ...dwell, [last]: (dwell[last] ?? pl(last)!.dwell) - over }));
    out.push(option(c, `${name(last)} 빼기`, rem.slice(0, -1), dwell));
    return out;
  }
  if (c.slackMin >= 45) {
    const used = new Set(c.stops.map((s) => s.placeId));
    for (const cand of ['thearc', 'aquarium', 'kidsworld', 'nmd']) {
      if (used.has(cand)) continue;
      const o = option(c, `한 곳 더 · ${name(cand)}`, [...rem, cand], dwell);
      if (o.arriveHomeMin <= c.limitMin - 10) return [o];
    }
  }
  return [];
}

function finish(next: LiveCourse, ch: Change | null, forceKind?: Outcome['kind'], voice?: string): Outcome {
  const s = st!;
  next = { ...next, version: s.course.version + 1, lastChange: ch };
  const opts = forceKind === 'HomeNow' ? [] : proposals(next, s.dwell);
  s.course = next; s.proposal = opts.length ? opts : null;
  const kind: Outcome['kind'] = forceKind ?? (opts.length ? 'Proposal' : ch ? 'Retimed' : 'NoChange');
  return { kind, course: next, change: ch, voice: voice ?? ch?.text ?? null, options: opts.length ? opts : undefined };
}

export function mockEvent(e: CourseEvent): Outcome {
  const s = st ?? (mockReset(), st!);
  const c = s.course;
  const now = m(e.now);
  const before = c.arriveHomeMin;
  const nextName = () => { const n = c.stops.find((x) => x.status === 'NEXT'); return n ? name(n.placeId) : '집'; };
  switch (e.type) {
    case 'Departed': {
      let stops = c.stops.map((x): LiveStop => (x.placeId === e.from && x.status !== 'DONE' ? { ...x, status: 'DONE', actualDepartMin: now } : x));
      const fromStop = c.stops.find((x) => x.placeId === e.from);
      const early = fromStop ? fromStop.plannedDepartMin - now : 0;
      const n = retime({ ...c, stops }, now, s.dwell);
      const delta = n.arriveHomeMin - before;
      // 낮잠 창보다 일찍 나서면 '더 놀다 가기' 카드 (시험 사례 1)
      if (early >= 10 && fromStop && n.napLeg == null && now < NAP[0]) {
        const wait = NAP[0] - 10 - now;
        const rem = n.stops.filter((x) => x.status === 'PLANNED' || x.status === 'NEXT').map((x) => x.placeId);
        const stay = option({ ...n, nowMin: now + wait }, `${hhmm(now + wait)}에 출발`, rem, s.dwell);
        const more = proposals(n, s.dwell);
        const ch = change(`${early}분 일찍 · ${wait}분 더 놀면 차에서 낮잠`, '일찍 출발', delta, 'LOUD', now);
        const next = { ...n, version: c.version + 1, lastChange: ch };
        s.course = next; s.proposal = [stay, ...more];
        return { kind: 'Proposal', course: next, change: ch, options: s.proposal, voice: `${early}분 일찍 나섰어요. ${wait}분만 더 놀다 가면 아이들이 차에서 낮잠 잘 수 있어요.` };
      }
      if (Math.abs(delta) < 5 && Math.abs(early) < 10) return finish(n, null, 'NoChange');
      const txt = early > 0 ? `${early}분 일찍 · ${nextName()} ${hhmm(n.stops.find((x) => x.status === 'NEXT')?.plannedArriveMin ?? n.arriveHomeMin)} · 귀가 ${hhmm(n.arriveHomeMin)}`
        : `${-early}분 늦게 나섰어요 · 귀가 ${hhmm(n.arriveHomeMin)}`;
      return finish(n, change(txt, '일찍 출발', delta, Math.abs(delta) >= 15 ? 'SOFT' : 'QUIET', now));
    }
    case 'Arrived': {
      const stops = c.stops.map((x): LiveStop => (x.placeId === e.place ? { ...x, status: 'ARRIVED', actualArriveMin: now } : x.status === 'ARRIVED' ? { ...x, status: 'DONE' } : x));
      const n = retime({ ...c, stops }, now, s.dwell);
      const delta = n.arriveHomeMin - before;
      return Math.abs(delta) < 5 ? finish(n, null, 'NoChange') : finish(n, change(`${name(e.place)} 도착 · 귀가 ${hhmm(n.arriveHomeMin)}`, '도착', delta, 'QUIET', now));
    }
    case 'NaviEta': {
      const leg = c.legs.find((l) => l.kind === 'DRIVE' || l.kind === 'NAP_DRIVE');
      const guess = leg ? leg.toMin - Math.max(leg.fromMin, now) : 0;
      const diff = e.remainMin - guess;
      // 두 번 연속 같은 방향일 때만 반영 (버전은 그대로)
      const pending = (c as any).etaPending as number | undefined;
      if (pending == null || Math.sign(pending) !== Math.sign(diff)) { s.course = { ...c, etaPending: diff } as LiveCourse; return { kind: 'NoChange', course: s.course, change: null, voice: null }; }
      if (Math.abs(diff) < 8 && Math.abs(diff) < guess * 0.15) return finish(c, null, 'NoChange');
      const factor = Math.round(((c.roadFactor ?? 1.3) * 0.7 + (c.roadFactor ?? 1.3) * (e.remainMin / Math.max(1, guess)) * 0.3) * 100) / 100;
      const n = retime({ ...c, roadFactor: Math.min(2.5, Math.max(0.8, factor)), etaPending: null } as LiveCourse, now, s.dwell);
      const nx = n.stops.find((x) => x.status === 'NEXT');
      return finish(n, change(`내비 ${diff > 0 ? '+' : ''}${diff}분 · ${nx ? `${name(nx.placeId)} ${hhmm(nx.plannedArriveMin)}` : '집'} · 귀가 ${hhmm(n.arriveHomeMin)}`, '내비', n.arriveHomeMin - before, 'QUIET', now));
    }
    case 'ReplaceNext': {
      const i = c.stops.findIndex((x) => x.status === 'NEXT');
      const stops = [...c.stops.filter((x) => x.placeId !== e.place || x.status === 'DONE')];
      const at = i < 0 ? stops.length : Math.max(0, stops.findIndex((x) => x.status === 'NEXT'));
      stops.splice(at < 0 ? stops.length : at, 0, { placeId: e.place, status: 'NEXT', plannedArriveMin: now, plannedDepartMin: now, dwellGuessMin: pl(e.place)!.dwell });
      const n = retime({ ...c, stops }, now, s.dwell);
      const over = n.arriveHomeMin - n.limitMin;
      const o = finish(n, change(over > 0 ? `다음은 ${name(e.place)} · 그대로면 ${hhmm(n.arriveHomeMin)} 귀가` : `다음은 ${name(e.place)} · 귀가 ${hhmm(n.arriveHomeMin)}`, '다음 바꾸기', n.arriveHomeMin - before, 'LOUD', now));
      return { ...o, voice: `다음은 ${name(e.place)}로 안내할게요.` };
    }
    case 'Skip': {
      const stops = c.stops.map((x): LiveStop => (x.placeId === e.place && x.status !== 'DONE' ? { ...x, status: 'SKIPPED', actualDepartMin: x.status === 'ARRIVED' ? now : x.actualDepartMin } : x));
      const n = retime({ ...c, stops }, now, s.dwell);
      const o = finish(n, change(`${name(e.place)} 뺐어요 · ${n.slackMin >= 45 ? '한 곳 더 갈 수 있어요' : `귀가 ${hhmm(n.arriveHomeMin)}`}`, '빼기', n.arriveHomeMin - before, 'LOUD', now));
      return { ...o, voice: `${name(e.place)}을 뺐어요. ${o.options ? `${o.options[0].stops[o.options[0].stops.length - 1].name}에 들렀다 갈까요?` : `${hhmm(n.arriveHomeMin)}쯤 집에 도착해요.`}` };
    }
    case 'Insert': {
      const stops = c.stops.filter((x) => x.placeId !== e.place || x.status === 'DONE');
      stops.push({ placeId: e.place, status: 'PLANNED', plannedArriveMin: now, plannedDepartMin: now, dwellGuessMin: pl(e.place)!.dwell });
      const n = retime({ ...c, stops }, now, s.dwell);
      const over = n.arriveHomeMin - n.limitMin;
      return finish(n, change(over > 0 ? `${name(e.place)} 들르면 ${hhmm(n.arriveHomeMin)} 귀가 · 한계 ${over}분 넘어요` : `${name(e.place)} 들렀다 가요 · 귀가 ${hhmm(n.arriveHomeMin)}`, '들르기', n.arriveHomeMin - before, 'SOFT', now));
    }
    case 'GoHome': {
      const stops = c.stops.map((x): LiveStop => (x.status === 'PLANNED' || x.status === 'NEXT' ? { ...x, status: 'SKIPPED' } : x.status === 'ARRIVED' ? { ...x, status: 'DONE', actualDepartMin: now } : x));
      const n = retime({ ...c, stops }, now, s.dwell);
      return finish(n, change(`집으로 · ${hhmm(n.arriveHomeMin)} 도착`, '집으로', n.arriveHomeMin - before, 'LOUD', now), 'HomeNow', `집으로 안내할게요. ${hhmm(n.arriveHomeMin)}쯤 도착해요.`);
    }
    case 'Remote': {
      if (e.version <= c.version) return { kind: 'NoChange', course: c, change: null, voice: null };
      const kept = c.stops.filter((x) => x.status === 'DONE' || x.status === 'ARRIVED');
      const keptIds = new Set(kept.map((x) => x.placeId));
      const stops: LiveStop[] = [...kept, ...e.stops.filter((id) => !keptIds.has(id)).map((id, i): LiveStop => ({ placeId: id, status: i ? 'PLANNED' : 'NEXT', plannedArriveMin: now, plannedDepartMin: now, dwellGuessMin: pl(id)?.dwell ?? 60 }))];
      const n = retime({ ...c, stops }, now, s.dwell);
      const o = finish(n, change(`${e.by}이 코스를 바꿨어요 · ${n.slackMin >= 45 ? '한 곳 더 갈 수 있어요' : `귀가 ${hhmm(n.arriveHomeMin)}`}`, '폰 변경', n.arriveHomeMin - before, 'LOUD', now));
      s.course = { ...s.course, version: Math.max(e.version, c.version) + 1 };
      return { ...o, course: s.course };
    }
    case 'Weather': {
      const rain = e.sky === 'RAIN' ? now : e.rainFrom ? m(e.rainFrom) : null;
      const n = retime({ ...c, rainFromMin: rain }, now, s.dwell);
      const cur = n.stops.find((x) => x.status === 'ARRIVED');
      if (rain != null && cur && !pl(cur.placeId)!.indoor && cur.plannedDepartMin > rain && rain > now) {
        const rem = n.stops.filter((x) => x.status === 'PLANNED' || x.status === 'NEXT').map((x) => x.placeId);
        const early = option(n, `비 오기 전 ${hhmm(rain)} 출발`, rem, s.dwell, rain);
        const ch = change(`비 ${hhmm(rain)}부터 · ${hhmm(rain)}에 먼저 나설까요`, '비', 0, 'LOUD', now);
        const next = { ...n, version: c.version + 1, lastChange: ch };
        s.course = next; s.proposal = [early];
        return { kind: 'Proposal', course: next, change: ch, options: [early], voice: `비가 ${hhmm(rain)}부터 와요. ${hhmm(rain)}에 먼저 나설까요?` };
      }
      return finish(n, rain != null ? change(`비 ${hhmm(rain)}부터`, '비', 0, 'SOFT', now) : null);
    }
    case 'LimitChanged': {
      const n = retime({ ...c, limitMin: m(e.limit) }, now, s.dwell);
      const over = n.arriveHomeMin - n.limitMin;
      return finish(n, change(over > 0 ? `귀가 한계 ${e.limit} · 그대로면 ${over}분 넘어요` : `귀가 한계 ${e.limit}`, '한계', 0, over > 0 ? 'LOUD' : 'QUIET', now));
    }
    case 'StillParked': {
      const cur = c.stops.find((x) => x.status === 'ARRIVED');
      const nx = c.stops.find((x) => x.status === 'NEXT');
      const n = cur ? retime(c, now, s.dwell)
        : retime({ ...c, legs: c.legs }, now, s.dwell); // 길 위 정차: 지금부터 다시 (대충 — 남은 이동을 지금부터)
      const lost = n.arriveHomeMin - before;
      if (lost < 5) return finish(n, null, 'NoChange');
      return finish(n, change(cur ? `${name(cur.placeId)}에서 ${lost}분 더 · 귀가 ${hhmm(n.arriveHomeMin)}` : `예상 밖 정차 ${lost}분 · ${nx ? name(nx.placeId) : '집'} ${hhmm(nx?.plannedArriveMin ?? n.arriveHomeMin)}`, '예상 밖 정차', lost, lost >= 15 ? 'LOUD' : 'QUIET', now));
    }
    case 'SetEnd': {
      // 모의: 도착지·도착 목표만 바꾸고 시간표는 대충 그대로 (규칙의 원본은 엔진)
      const end = e.end === 'home' ? null : e.end ?? c.end ?? null;
      const n = retime({ ...c, end, limitMin: e.limit ? m(e.limit) : c.limitMin, userLimit: !!e.limit || c.userLimit, napOff: e.napOff ?? c.napOff }, now, s.dwell);
      const nm = end?.name ?? '집';
      return finish(n, change(`도착지 ${nm} · ${nm}에 ${hhmm(n.arriveHomeMin)} 도착`, '도착지', n.arriveHomeMin - before, 'LOUD', now));
    }
    case 'SetDwell': {
      // 모의: 그곳 머무름만 바꾸고 다시 짠다 (규칙의 원본은 엔진 — 15~360분, 5분 단위)
      const mins = Math.min(360, Math.max(15, Math.round(e.minutes / 5) * 5));
      s.dwell = { ...s.dwell, [e.place]: mins };
      const stops = c.stops.map((x): LiveStop => (x.placeId === e.place ? { ...x, dwellGuessMin: mins, dwellSet: true } : x));
      const n = retime({ ...c, stops }, now, s.dwell);
      return finish(n, change(`${name(e.place)} ${mins}분으로 바꿨어요 · 집에 ${hhmm(n.arriveHomeMin)}쯤`, '머무름', n.arriveHomeMin - before, 'SOFT', now));
    }
    case 'ExtendStay': {
      const cur = c.stops.find((x) => x.status === 'ARRIVED');
      if (!cur) return finish(c, null, 'NoChange');
      const more = Math.min(360, Math.max(0, Math.round(e.minutes / 5) * 5));
      const total = Math.max(0, now + more - (cur.actualArriveMin ?? cur.plannedArriveMin));
      s.dwell = { ...s.dwell, [cur.placeId]: total };
      const stops = c.stops.map((x): LiveStop => (x === cur ? { ...x, dwellGuessMin: total, dwellSet: true } : x));
      const n = retime({ ...c, stops }, now, s.dwell);
      const head = more === 0 ? `${name(cur.placeId)}에서 지금 나서요` : `${name(cur.placeId)}에서 ${more}분 더 놀아요`;
      return finish(n, change(`${head} · 집에 ${hhmm(n.arriveHomeMin)}쯤`, '머무름', n.arriveHomeMin - before, 'SOFT', now));
    }
    case 'PlaceClosed': {
      const stops = c.stops.map((x): LiveStop => (x.placeId === e.place && (x.status === 'PLANNED' || x.status === 'NEXT') ? { ...x, status: 'SKIPPED' } : x));
      const n = retime({ ...c, stops }, now, s.dwell);
      return finish(n, change(`${name(e.place)} 문 닫음 · 뺐어요`, '휴무', n.arriveHomeMin - before, 'LOUD', now));
    }
  }
}

/** 제안 카드 채택: 카드의 장소 순서·머무름대로 코스를 바꾼다 */
export function mockAdopt(idx: number): Outcome {
  const s = st ?? (mockReset(), st!);
  const o = s.proposal?.[idx];
  const c = s.course;
  if (!o) return { kind: 'NoChange', course: c, change: null, voice: null };
  const kept = c.stops.filter((x) => x.status === 'DONE' || x.status === 'SKIPPED' || x.status === 'ARRIVED');
  const keptIds = new Set(kept.map((x) => x.placeId));
  const dwell = { ...s.dwell };
  o.legs.forEach((l) => { if (l.kind === 'STAY' && l.placeId) dwell[l.placeId] = l.toMin - l.fromMin; });
  const fresh = o.stops.filter((x) => !keptIds.has(x.id)).map((x, i): LiveStop => ({ placeId: x.id, status: i ? 'PLANNED' : 'NEXT', plannedArriveMin: 0, plannedDepartMin: 0, dwellGuessMin: dwell[x.id] ?? 60 }));
  // 카드에서 빠진 남은 곳은 건너뜀
  const dropped = c.stops.filter((x) => (x.status === 'PLANNED' || x.status === 'NEXT') && !o.stops.some((y) => y.id === x.placeId)).map((x): LiveStop => ({ ...x, status: 'SKIPPED' }));
  // '12:50에 출발'처럼 머무름을 늘린 카드: 시간표 시작을 카드의 첫 이동 시각으로
  const firstMove = o.legs.find((l) => l.kind === 'DRIVE' || l.kind === 'NAP_DRIVE' || l.kind === 'HOME');
  const nowMin = Math.max(c.nowMin, firstMove ? firstMove.fromMin : c.nowMin);
  s.dwell = dwell;
  const n = retime({ ...c, stops: [...kept, ...dropped, ...fresh] }, nowMin, dwell);
  const ch = change(`${o.label} · 귀가 ${hhmm(n.arriveHomeMin)}`, '채택', n.arriveHomeMin - c.arriveHomeMin, 'SOFT', c.nowMin);
  s.course = { ...n, version: c.version + 1, lastChange: ch }; s.proposal = null;
  return { kind: 'Retimed', course: s.course, change: ch, voice: null };
}
