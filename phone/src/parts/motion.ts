// 기기 '애니메이션 삭제(움직임 줄이기)' 설정을 따른다 — 켜져 있으면 부품은 움직임 없이(또는 페이드만).
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setOn(v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setOn);
    return () => { alive = false; sub.remove(); };
  }, []);
  return on;
}
