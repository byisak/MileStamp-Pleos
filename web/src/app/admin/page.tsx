import { Suspense } from "react";
import { adminPasswordSet, isAdmin } from "@/lib/admin-auth";
import { catalogVersion, loadAdminPlaces, loadRestaurants, loadTagVocab } from "@/lib/catalog";
import { sql } from "@/lib/db";
import { loadAdminFestivals } from "@/lib/festivals";
import { curatedRows, popularExt } from "@/lib/explore";
import { AdminApp, type Tab } from "./ui/AdminApp";

/** 관리자 (/admin). 쿠키·DB를 읽으므로 모두 Suspense 안에서. */
export default function AdminPage({ searchParams }: PageProps<"/admin">) {
  return (
    <Suspense fallback={<div className="login"><p className="muted">불러오는 중…</p></div>}>
      <Gate searchParams={searchParams} />
    </Suspense>
  );
}

async function Gate({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  if (!adminPasswordSet()) {
    return (
      <div className="login">
        <div className="card">
          <div className="logo" />
          <h1>관리자 비밀번호가 설정되지 않았어요</h1>
          <p>서버 환경 변수 <b>ADMIN_PASSWORD</b>를 넣고 다시 배포하면 이 화면에서 로그인할 수 있어요.</p>
        </div>
      </div>
    );
  }
  if (!(await isAdmin())) {
    return (
      <div className="login">
        <form className="card" method="post" action="/api/admin/login">
          <div className="logo" />
          <h1>마일스탬프 관리자</h1>
          <p>명소·도장·맛집을 고치면 폰과 차가 다음에 켤 때 받아 가요.</p>
          {sp.e ? <div className="err">비밀번호가 맞지 않아요</div> : null}
          <input type="password" name="password" placeholder="관리자 비밀번호" autoFocus required autoComplete="current-password" />
          <button className="btn ink" type="submit">들어가기</button>
        </form>
      </div>
    );
  }
  const [places, version, restaurants, stamps30, festivals, popular, kto100, tagVocab] = await Promise.all([
    loadAdminPlaces(),
    catalogVersion(),
    loadRestaurants(),
    sql<{ id: string; cars: number }[]>`
      select e.place_id as id, count(distinct e.car_id)::int as cars
      from events e join cars c on c.id = e.car_id
      where e.kind = 'stamp' and not c.demo and e.created_at > now() - interval '30 days' and e.place_id is not null
      group by e.place_id`,
    loadAdminFestivals(),
    // 내가 고르기 표(visits_ext·curated_places)가 아직 없는 DB에서도 관리자 화면은 열리게
    popularExt().catch(() => []),
    curatedRows().catch(() => []),
    loadTagVocab(),
  ]);
  // 들어오면 '할 일'부터 (?tab=으로 바로 갈 수 있음, ?place=면 그 명소 편집)
  const pick0 = typeof sp.place === "string" ? sp.place : undefined;
  const tab = (["todo", "places", "festivals", "stamps", "food", "popular", "reports", "ops"] as const).find((t) => t === sp.tab) ?? (pick0 ? "places" : "todo");
  const pick = typeof sp.place === "string" ? sp.place : undefined;
  return (
    <AdminApp
      initialTab={tab as Tab}
      initialPlace={pick}
      places={places}
      version={version}
      restaurants={restaurants}
      stamps30={Object.fromEntries(stamps30.map((r) => [r.id, r.cars]))}
      festivals={festivals}
      tourReady={!!process.env.DATA_GO_KR_KEY}
      kakaoReady={!!process.env.KAKAO_REST_KEY || process.env.KAKAO_LOCAL_MOCK === "1"}
      tagVocab={tagVocab}
      popular={popular}
      kto100={kto100}
    />
  );
}
