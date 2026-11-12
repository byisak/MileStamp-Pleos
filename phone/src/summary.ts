// 결과 카드 한 줄 이유를 사람 말 한 문장으로 (UX B1).
// 서버가 주는 이유 칩(reasons)·'왜?' 줄(why)·구간(legs)에서 센 이유 2~3개를 골라 동행에 맞게 잇는다.
//   '집에서 10분, 둘이 산책하기 좋은 곳이에요' · '낮잠 시간에 차에서 63분 재울 수 있고 해 지기 전에 와요' · '비 소식이 있어 실내로 골랐어요'
// 서버 글 모양이 바뀌어 아무것도 못 읽으면 null → 화면은 예전처럼 첫 줄을 그대로 쓴다.
// React Native를 부르지 않는 순수 함수라 web 시험(web/src/lib/summary.test.ts)이 이 파일을 그대로 불러 확인한다.
// plan.ts를 부르면 web 시험의 타입 검사에 앱 쪽 타입(react-native)까지 딸려 와서, 필요한 모양만 여기 적는다 (plan.ts PlanOption과 같음).
type Companion = 'kids' | 'couple' | 'friends' | 'solo';
type PlanOption = {
  stops: { id: string; indoor: boolean }[];
  legs: { kind: string; fromMin: number; toMin: number; placeId: string | null }[];
  reasons: { text: string; tone: string }[];
  why?: { placeId: string; lines: { text: string }[] }[];
  anchorId?: string;
};

type Clause = { key: string; rank: number; order: number; conn: string; end: string; uses: string[] };

/** 분위기 표시 → '○○하기' (동행 줄 '연인과 가기 좋아요 · 산책'의 뒤쪽) */
const TAG_VERB: Record<string, string> = {
  산책: '산책하기', 야경: '야경 보기', 데이트: '데이트하기', 카페: '카페 들르기', 드라이브: '드라이브하기',
  액티비티: '같이 놀기', 체험: '체험하기', 전시: '전시 보기', 조용함: '조용히 둘러보기',
};

const WHO: Record<Companion, string> = { kids: '아이가', couple: '둘이', friends: '친구들과', solo: '혼자' };

/** 첫 곳(또는 앵커)의 '왜?' 줄 글 */
function whyOf(o: PlanOption): string[] {
  const id = o.anchorId ?? o.stops[0]?.id;
  const w = o.why?.find((x) => x.placeId === id) ?? o.why?.[0];
  return w?.lines.map((l) => l.text) ?? [];
}

function fitClause(lines: string[], c: Companion, many: boolean, night: boolean): Clause | null {
  const place = many ? '코스' : '곳';
  const make = (verbPhrase: string, adjConn: string, adjEnd: string, uses: string): Clause =>
    ({ key: 'fit', rank: 5, order: 8, conn: `${verbPhrase} ${adjConn}`, end: `${verbPhrase} ${adjEnd} ${place}이에요`.replace('코스이에요', '코스예요'), uses: [uses] });
  if (c === 'kids') {
    const good = lines.find((x) => /살 아이가 놀기 좋아요$/.test(x));
    if (good) return make('아이가 놀기', '좋고', '좋은', good);
    const ok = lines.find((x) => /살 아이도 즐길 만해요$/.test(x));
    if (ok) return make('아이도 즐길', '만하고', '만한', ok);
    return null;
  }
  const good = lines.find((x) => /^(연인과 가기 좋아요|친구들과 놀기 좋아요|혼자 조용히 둘러보기 좋아요)/.test(x));
  if (good) {
    const tag = good.split(' · ')[1]?.trim();
    // '야경'은 해 진 뒤까지 머물 때만 (아침 코스에 '야경 보기 좋은 곳'은 틀린 말)
    const verb = tag && (tag !== '야경' || night) ? TAG_VERB[tag] : undefined;
    if (verb) return make(`${WHO[c]} ${verb}`, '좋고', '좋은', good);
    const base = c === 'couple' ? '둘이 가기' : c === 'friends' ? '친구들과 놀기' : '혼자 둘러보기';
    return make(base, '좋고', '좋은', good);
  }
  const ok = lines.find((x) => /^(둘이|친구들과|혼자) 가 볼 만해요$/.test(x));
  if (ok) return make(`${WHO[c]} 가 볼`, '만하고', '만한', ok);
  return null;
}

/**
 * 결과 카드 한 문장. [used] = 문장에 녹인 이유 칩 글(아래 칩에서 빼려고).
 * 어른끼리(kids 아님)는 아이·낮잠 말은 쓰지 않는다.
 */
export function summaryOf(o: PlanOption, companion: Companion): { text: string; used: string[] } | null {
  if (!o.stops.length) return null;
  const kids = companion === 'kids';
  const reasons = o.reasons ?? [];
  const lines = whyOf(o);
  const allIndoor = o.stops.every((s) => s.indoor);
  const many = o.stops.length > 1;
  const out: Clause[] = [];
  const r = (re: RegExp) => reasons.find((x) => re.test(x.text));

  // 날씨 때문에 실내 (가장 셈)
  const air = reasons.find((x) => x.tone === 'AIR');
  const rain = r(/비 → 실내|비 와도 실내/);
  if (air && allIndoor) out.push({ key: 'air', rank: 10, order: 0, conn: '미세먼지가 나빠 실내로 골랐고', end: '미세먼지가 나빠 실내로 골랐어요', uses: [air.text] });
  else if (rain && allIndoor) {
    const later = /오후 비|곧 비|비 와도/.test(rain.text);
    out.push({ key: 'rain', rank: 10, order: 0, conn: later ? '비 소식이 있어 실내로 골랐고' : '비가 와서 실내로 골랐고', end: later ? '비 소식이 있어 실내로 골랐어요' : '비가 와서 실내로 골랐어요', uses: [rain.text] });
  }
  // 축제 (기간 한정)
  const fest = reasons.find((x) => x.tone === 'FESTIVAL');
  const until = fest && /(\d{1,2}\/\d{1,2})까지/.exec(fest.text)?.[1];
  if (fest && until) out.push({ key: 'fest', rank: 9, order: 1, conn: `${until}까지만 하는 축제이고`, end: `${until}까지만 하는 축제예요`, uses: [fest.text] });
  // 낮잠 (아이와만)
  if (kids) {
    const napLeg = o.legs.find((l) => l.kind === 'NAP_DRIVE');
    if (napLeg) {
      const m = napLeg.toMin - napLeg.fromMin;
      const home = napLeg.placeId == null;
      const head = home ? `집에 오는 길에 차에서 ${m}분` : `낮잠 시간에 차에서 ${m}분`;
      out.push({ key: 'nap', rank: 8, order: 3, conn: `${head} 재울 수 있고`, end: `${head} 재울 수 있어요`, uses: reasons.filter((x) => /낮잠 맞춤/.test(x.text)).map((x) => x.text) });
    }
  }
  // 가까움: '왜?' 첫 이동 줄('집에서 10분 · 가까워요')
  const near = lines.map((x) => /^(집에서|지금 있는 곳에서) (\d+)분 · 가까워요$/.exec(x)).find(Boolean);
  if (near) {
    const from = near[1] === '집에서' ? '집' : '여기';
    const m = Number(near[2]);
    // 3분 안쪽은 '집에서 1분'보다 '집 바로 근처'가 자연스럽다
    const at = from === '집' ? '집에서' : '여기서';
    const conn = m <= 3 ? `${from} 바로 근처이고` : `${at} ${m}분,`;
    const end = m <= 3 ? `${from} 바로 근처예요` : `${at} ${m}분이면 가요`;
    out.push({ key: 'near', rank: 6, order: 2, conn, end, uses: reasons.filter((x) => /^가까워요/.test(x.text)).map((x) => x.text) });
  }
  // 야경 (어른끼리)
  const night = r(/^야경 · 해 진 뒤/);
  if (!kids && night) out.push({ key: 'night', rank: 6, order: 5, conn: '해 진 뒤 야경까지 보고', end: '해 진 뒤 야경까지 보고 와요', uses: [night.text] });
  // 동행에 잘 맞음
  const fit = fitClause(lines, companion, many, !kids && !!night);
  if (fit) out.push(fit);
  // 맑음 → 야외
  const clear = r(/^(오전 )?맑음 → 야외$/);
  if (clear && !out.some((x) => x.key === 'air' || x.key === 'rain')) {
    const morning = clear.text.startsWith('오전');
    const head = morning ? '오전엔 맑아' : '날이 맑아';
    const what = kids ? '바깥에서 놀기' : '걷기';
    out.push({ key: 'clear', rank: 3, order: 4, conn: `${head} ${what} 좋고`, end: `${head} ${what} 좋아요`, uses: [clear.text] });
  }
  // 새 도장
  const stamp = reasons.find((x) => x.tone === 'STAMP' && /도장 \d/.test(x.text));
  if (stamp) out.push({ key: 'stamp', rank: 2, order: 7, conn: '새 도장도 받을 수 있고', end: '새 도장도 받을 수 있어요', uses: [stamp.text] });
  // 돌아오는 때 (아이와: 해 지기 전·낮잠 전·점심 전)
  if (kids) {
    const sun = r(/^해 지기 .+ 전 귀가$/);
    const napBefore = r(/^낮잠 전 귀가/);
    const lunch = r(/^점심 전 귀가/);
    if (napBefore) out.push({ key: 'back', rank: 4, order: 9, conn: '낮잠 전에 집에 오고', end: '낮잠 전에 집에 와요', uses: [napBefore.text] });
    else if (lunch) out.push({ key: 'back', rank: 4, order: 9, conn: '점심 전에 집에 오고', end: '점심 전에 집에 와요', uses: [lunch.text] });
    else if (sun) out.push({ key: 'back', rank: 4, order: 9, conn: '해 지기 전에 오고', end: '해 지기 전에 와요', uses: [sun.text] });
  }
  if (!out.length) return null;
  // 센 것 2~3개 (날씨로 실내면 2개까지 — 문장이 길어지지 않게)
  const max = out.some((x) => x.rank >= 10) ? 2 : 3;
  const picked = [...out].sort((a, b) => b.rank - a.rank).slice(0, max).sort((a, b) => a.order - b.order);
  const text = picked.map((c, i) => (i === picked.length - 1 ? c.end : c.conn)).join(' ');
  return { text, used: picked.flatMap((c) => c.uses) };
}
