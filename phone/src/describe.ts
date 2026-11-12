// 소식 한 줄 글 — 오늘 탭 '오늘의 기록' 줄: 제목 = 장소 이름, 보조 = 무엇이었는지 ('29번째 도장' · '미션 · …')
// (서버 web/src/components/event-text.ts 와 같은 말투)
import type { IconName } from './icon';
import type { TripEvent } from './api';
import { place } from './places';
import { festivalById } from './catalog';
import { stampNo, W } from './words';

export function describe(e: TripEvent): { icon: IconName; title: string; sub: string } {
  const p = place(e.place_id);
  const name = p?.name ?? '';
  switch (e.kind) {
    case 'handoff': return { icon: 'headphones', title: name || W.resume, sub: `${W.resume} · 차에서 듣던 문장부터` };
    case 'intro': return { icon: 'moon', title: name || '조용한 소개', sub: '조용한 소개 · 조용히 가는 중이라 폰으로' };
    case 'mission': return { icon: 'flag', title: name || '미션', sub: '미션 · 퀴즈 하나 + 찾아보기 하나' };
    case 'stamp': {
      const n = e.payload.number, rare = e.payload.rare;
      if (typeof e.payload.festivalId === 'string') {
        const f = festivalById(e.payload.festivalId);
        return { icon: 'party-popper', title: name || f?.name || '축제 도장', sub: [`축제 도장 · ${f?.name ?? '기간 한정'}`, n ? stampNo(n) : ''].filter(Boolean).join(' · ') };
      }
      return { icon: 'stamp', title: name || '도장', sub: [n ? stampNo(n) : '도장', rare ? `희귀 · ${rare}` : '', e.payload.silent ? '조용히 찍음' : ''].filter(Boolean).join(' · ') };
    }
    case 'summary': {
      const s = e.payload;
      return { icon: 'trophy', title: '오늘 하루 자랑 카드', sub: `도장 ${s.stamps ?? 0}개${s.rare ? ` · 희귀 ${s.rare}` : ''}${s.km ? ` · ${Math.round(s.km)}km` : ''}` };
    }
  }
}
