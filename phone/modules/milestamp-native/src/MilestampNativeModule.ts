import { NativeModule, requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

declare class MilestampNativeModule extends NativeModule<{}> {
  haptic(kind: 'tick' | 'click' | 'heavy' | 'success'): void;
}

// 안드로이드 전용. 다른 곳에서는 아무 일도 안 한다
const mod = Platform.OS === 'android' ? requireOptionalNativeModule<MilestampNativeModule>('MilestampNative') : null;
export default mod;
