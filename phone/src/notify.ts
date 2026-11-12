// 알림: 채널 · 앞에 떠 있을 때도 보이기 · FCM 토큰을 서버에
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { registerPush } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function setupChannel() {
  if (Platform.OS !== 'android') return;
  // 서버(FCM)가 channel_id "trip"으로 보낸다
  await Notifications.setNotificationChannelAsync('trip', {
    name: '차에서 온 소식',
    description: '도장 · 이어 듣기 · 코스 제안 · 미션 · 자랑 카드',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 120, 80, 120],
    lightColor: '#2C4A3E',
  });
}

// 같은 토큰을 거듭 보내지 않는다. (getDevicePushTokenAsync가 토큰 이벤트를 다시 일으켜서,
// 이벤트에서 또 가져오면 끝없이 돈다 — 실제로 초당 수백 번 보낸 적 있음)
let sent: string | null = null;

export async function sendPushToken(phoneToken: string, fcm: string): Promise<boolean> {
  if (sent === fcm) return true;
  sent = fcm;
  try { await registerPush(phoneToken, fcm); return true; }
  catch { sent = null; return false; }
}

/** 허락돼 있으면 토큰을 서버에 등록. 안 돼 있으면 false */
export async function syncPushToken(phoneToken: string): Promise<boolean> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return false;
    const t = await Notifications.getDevicePushTokenAsync();
    if (typeof t.data !== 'string') return false;
    return sendPushToken(phoneToken, t.data);
  } catch { return false; }
}

export async function askAndSync(phoneToken: string): Promise<boolean> {
  const p = await Notifications.requestPermissionsAsync().catch(() => null);
  if (!p?.granted) return false;
  return syncPushToken(phoneToken);
}
