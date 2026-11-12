// 안드로이드 오토 다리: 폰 토큰(SecureStore)과 서버 주소를 네이티브(차 화면)에 넘긴다.
// 차 화면은 폰 앱 안에서 돌기 때문에 같은 토큰으로 /api/plan·/api/plan/course·/api/phone/stamps를 부른다.
// 부르는 곳: 앱을 켤 때와 토큰이 바뀔 때(연결·끊기) — syncAuto() 한 줄.
// 쉿 모드: '우리 차' 탭에서 고른 값(자동·켜기·끄기, SecureStore)과 가족 낮잠을 넘기면 네이티브가 도장 때마다 폰 시계로 계산한다.
// 시간 표시(12/24시간)도 같은 길로 넘긴다(setAutoTimeFmt).
import * as SecureStore from 'expo-secure-store';
import Auto, { type AutoStatus, type QuietMode } from '../modules/milestamp-auto/src/MilestampAutoModule';
import { BASE, loadToken } from './api';
import { loadTimeFmt, TimeFmt } from './timefmt';

export type { QuietMode };
const QUIET_KEY = 'milestamp_auto_quiet';

/** 안드로이드 오토를 쓸 수 있는 폰인지 (안드로이드 + 모듈 있음) */
export const hasAuto = !!Auto;

/** 고른 쉿 모드 (없으면 자동) */
export async function loadQuietMode(): Promise<QuietMode> {
  try {
    const v = await SecureStore.getItemAsync(QUIET_KEY);
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch { return 'auto'; }
}

/** 쉿 모드 고르기: 저장하고 네이티브에 넘긴다. 지금 쉿인지 돌려준다(모듈 없으면 null) */
export async function setQuietMode(mode: QuietMode): Promise<boolean | null> {
  try { await SecureStore.setItemAsync(QUIET_KEY, mode); } catch {}
  try { return Auto ? Auto.setQuietMode(mode) : null; } catch { return null; }
}

/** 가족 낮잠(분, 둘 다 null = 낮잠 없음) → 네이티브 (가족 설정을 받거나 바꿀 때). 지금 쉿인지 돌려준다 */
export function syncAutoNap(napStart: number | null, napLen: number | null): boolean | null {
  try { return Auto ? Auto.setNap(napStart, napLen) : null; } catch { return null; }
}

/** 지금 토큰을 차 화면 쪽에 맞춘다. token을 주면 그 값(null = 끊음), 안 주면 SecureStore에서 읽는다 */
export async function syncAuto(token?: string | null): Promise<void> {
  if (!Auto) return;
  try {
    const t = token === undefined ? await loadToken() : token;
    Auto.setConfig(BASE, t ?? null);
    Auto.setQuietMode(await loadQuietMode());
    setAutoTimeFmt(await loadTimeFmt());
  } catch {
    // 안드로이드 오토가 없어도 앱은 그대로
  }
}

/** 시간 표시(12/24시간) → 네이티브 (차 화면 시각도 같은 방식으로). 옛 모듈엔 함수가 없을 수 있다 */
export function setAutoTimeFmt(f: TimeFmt): void {
  try { Auto?.setTimeFormat?.(f); } catch {}
}

/** 차 연결·판정 상태 (개발 탭 시험용). 안드로이드가 아니면 null */
export function autoStatus(): AutoStatus | null {
  try { return Auto?.status() ?? null; } catch { return null; }
}
