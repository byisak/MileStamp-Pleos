// 시연용 깔끔 보기: 데모 차(통과 코드)로 연결해도 개발 표시를 숨겨 보통 가족 폰처럼 보이게 한다 (시연 영상 촬영용).
// 개발 탭 맨 위 스위치로 켜고 이 폰에만 저장(SecureStore). 켜면 '개발' 탭도 숨기고, 끄려면 아래 '우리 차' 탭을 길게 누른다.
// 숨기는 것: 도장북 '개발 모드' 알약·파란 안내 띠·'찍기 가능' 고리·'모두 찍기'·'도장 처음으로', 우리 차 '데모' 표시,
//   오늘 탭 '시험 장면'·'모의' 알약·'실제로 돌아가기'. 기능은 그대로(시험 장면 계획·모의 엔진은 계속 돌아감).
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { useSession } from './session';

const KEY = 'milestamp_demo_clean';

let clean = false;
const subs = new Set<() => void>();
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const notify = () => subs.forEach((f) => f());
const get = () => clean;

/** 저장된 값 읽기 (앱 켤 때 한 번) */
export async function loadDemoClean(): Promise<boolean> {
  try {
    const v = (await SecureStore.getItemAsync(KEY)) === '1';
    if (v !== clean) { clean = v; notify(); }
  } catch {}
  return clean;
}

export function setDemoClean(on: boolean) {
  if (on !== clean) { clean = on; notify(); }
  SecureStore.setItemAsync(KEY, on ? '1' : '0').catch(() => {});
}

/** 깔끔 보기 스위치 값 */
export function useDemoClean(): boolean {
  return useSyncExternalStore(subscribe, get, get);
}

/** 개발 표시를 보여도 되나: 데모 차 연결이고 깔끔 보기가 꺼져 있을 때만 */
export function useDevUi(): boolean {
  const { me } = useSession();
  const c = useDemoClean();
  return !!me?.demo && !c;
}
