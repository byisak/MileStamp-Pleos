import { NativeModule, requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type AutoStatus = {
  connected: boolean;
  phase: 'IDLE' | 'DRIVING' | 'STOPPED' | 'OUT';
  gpsPathKm: number;
  hardwareSpeed: boolean;
  mileage: boolean;
  pending: number;
  lastAttempt: string | null;
  hasToken: boolean;
  /** 지금 쉿인지 (자동이면 폰 시계·가족 낮잠으로 계산한 값) */
  quiet: boolean;
  quietMode: QuietMode;
  napStart: number | null;
  napLen: number | null;
  pendingMedal: string | null;
  timeFmt?: '12' | '24';
};

/** 쉿 모드: 자동(가족 낮잠 20분 전 ~ 끝) · 켜기 · 끄기 */
export type QuietMode = 'auto' | 'on' | 'off';

declare class MilestampAutoModule extends NativeModule<{}> {
  setConfig(server: string, token: string | null): void;
  /** 쉿 모드: 차 도장 소리·음성 끄기 */
  setQuiet(on: boolean): void;
  /** 쉿 모드 고름. 지금 쉿인지 돌려준다 */
  setQuietMode(mode: QuietMode): boolean;
  /** 가족 낮잠 (분, 둘 다 null = 낮잠 없음). 지금 쉿인지 돌려준다 */
  setNap(start: number | null, len: number | null): boolean;
  /** 시간 표시: '12'(오후 9:54) · '24'(21:54) — 차 화면 시각 */
  setTimeFormat?(fmt: '12' | '24'): void;
  status(): AutoStatus;
}

// 안드로이드 전용 (안드로이드 오토). 다른 곳에서는 null
const mod = Platform.OS === 'android' ? requireOptionalNativeModule<MilestampAutoModule>('MilestampAuto') : null;
export default mod;
