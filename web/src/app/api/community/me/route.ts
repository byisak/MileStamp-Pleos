import { communityCaller, communityFail, readBody } from "@/lib/community-route";
import { freeSuggestion, loadProfile, saveProfile } from "@/lib/community";
import { ICONS, REGION, TIP_TAGS } from "@/lib/community-shape";

// TODO(문의 연락처): 운영 문의 메일이 정해지면 Vercel 환경 변수 COMMUNITY_CONTACT_EMAIL에 넣는다. 없으면 폰은 '준비 중'으로 보인다.
const contact = () => process.env.COMMUNITY_CONTACT_EMAIL?.trim() || null;

/**
 * GET /api/community/me → { profile | null, suggestion: {handle, icon}, icons[], tipTags[], region: {code,label}, contact }
 * profile = { handle, icon, region, termsAt, hidden, banned }
 */
export async function GET(req: Request) {
  const who = await communityCaller(req);
  if (who instanceof Response) return who;
  try {
    const profile = await loadProfile(who.carId);
    return Response.json({
      profile, suggestion: profile ? null : await freeSuggestion(),
      icons: ICONS, tipTags: TIP_TAGS, region: REGION, contact: contact(),
    });
  } catch (e) {
    return communityFail(e);
  }
}

/** PUT /api/community/me { handle?, icon?, acceptTerms?, hidden? } → { profile } (처음엔 acceptTerms: true 필요) */
export async function PUT(req: Request) {
  const who = await communityCaller(req);
  if (who instanceof Response) return who;
  try {
    return Response.json({ profile: await saveProfile(who.carId, await readBody(req)) });
  } catch (e) {
    return communityFail(e);
  }
}
