// 진동 — 진동 모터를 돌리는 방식(잉~) 대신 안드로이드가 튜닝한 클릭·틱 효과 (네이티브 모듈). 없으면 expo-haptics.
// ui.tsx와 공용 부품(parts/)이 같이 쓴다 (부품이 ui.tsx를 거꾸로 부르지 않게 따로 둠)
import * as Haptics from 'expo-haptics';
import Native from '../modules/milestamp-native/src/MilestampNativeModule';

export const tap = () => { if (Native) { try { Native.haptic('click'); return; } catch {} } Haptics.selectionAsync().catch(() => {}); };
export const tick = () => { if (Native) { try { Native.haptic('tick'); return; } catch {} } Haptics.selectionAsync().catch(() => {}); };
/** 도장이 쾅 찍힐 때: 묵직한 한 번 */
export const thud = () => { if (Native) { try { Native.haptic('heavy'); return; } catch {} } Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}); };
export const done = () => { if (Native) { try { Native.haptic('success'); return; } catch {} } Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); };
