// 앱 디자인에 맞춘 팝업. react-native의 Alert.alert와 같은 모양으로 부른다:
//   Alert.alert('제목', '설명', [{ text: '취소', style: 'cancel' }, { text: '지우기', style: 'destructive', onPress }])
// 루트에 <AlertHost />를 한 번 둔다. 버튼 2개는 가로, 3개 이상은 세로로.
import { useEffect, useRef, useState } from 'react';
import { Alert as RNAlert, Animated, Modal, Pressable, Text, View } from 'react-native';
import { Icon } from './icon';
import { F, TYPE, useTheme, R } from './theme';

type Button = { text?: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };
type Dialog = { title: string; message?: string; buttons: Button[] };

let push: ((d: Dialog) => void) | null = null;

export const Alert = {
  alert(title: string, message?: string, buttons?: Button[]) {
    const d = { title, message, buttons: buttons?.length ? buttons : [{ text: '확인' }] };
    if (push) push(d);
    else RNAlert.alert(title, message, buttons as any);
  },
};

export function AlertHost() {
  const t = useTheme();
  const [queue, setQueue] = useState<Dialog[]>([]);
  const cur = queue[0];
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    push = (d) => setQueue((q) => [...q, d]);
    return () => { push = null; };
  }, []);
  useEffect(() => {
    if (!cur) return;
    fade.setValue(0);
    Animated.spring(fade, { toValue: 1, useNativeDriver: true, speed: 22, bounciness: 5 }).start();
  }, [cur]);

  const close = (b?: Button) => {
    setQueue((q) => q.slice(1));
    if (b?.onPress) setTimeout(b.onPress, 60); // 닫힌 뒤 실행 (다음 팝업이 겹치지 않게)
  };
  if (!cur) return null;

  const dangerBtn = cur.buttons.find((b) => b.style === 'destructive');
  const danger = !!dangerBtn;
  const icon = /로그아웃/.test(dangerBtn?.text || '') ? 'log-out' : /지우|삭제/.test(dangerBtn?.text || '') ? 'trash-2' : 'circle-alert';
  const cancel = cur.buttons.find((b) => b.style === 'cancel');
  const vertical = cur.buttons.length > 2;
  // 가로 배치: 취소를 왼쪽, 주 버튼을 오른쪽
  const ordered = vertical ? cur.buttons.filter((b) => b.style !== 'cancel') : [...cur.buttons].sort((a) => (a.style === 'cancel' ? -1 : 1));

  const btn = (b: Button, i: number, total: number) => {
    const isCancel = b.style === 'cancel';
    const isDanger = b.style === 'destructive';
    const primary = !isCancel && (vertical ? i === 0 : i === total - 1);
    const bg = isDanger ? t.danger : primary ? t.ink : t.fill;
    const fg = isDanger ? t.onDanger : primary ? t.onInk : t.ink;
    return (
      <Pressable key={i} onPress={() => close(b)}
        style={({ pressed }) => ({ flex: vertical ? undefined : 1, height: 50, borderRadius: R.md, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
        <Text style={[TYPE.btn, { color: fg }]}>{b.text || '확인'}</Text>
      </Pressable>
    );
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => close(cancel)}>
      <Animated.View style={{ flex: 1, backgroundColor: t.dim, opacity: fade, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <Pressable style={{ position: 'absolute', inset: 0 }} onPress={() => cancel && close(cancel)} />
        <Animated.View style={{
          width: '100%', maxWidth: 360, backgroundColor: t.surface, borderRadius: R.sheet, paddingHorizontal: 22, paddingTop: 24, paddingBottom: 18,
          transform: [{ scale: fade.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
        }}>
          {danger && (
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: t.redSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
              <Icon name={icon} size={22} color={t.red} />
            </View>
          )}
          <Text style={[TYPE.title, { fontSize: 20, lineHeight: 27, color: t.ink }]}>{cur.title}</Text>
          {!!cur.message && <Text style={[TYPE.sub, { color: t.ink2, marginTop: 8, fontFamily: F.m }]}>{cur.message}</Text>}
          <View style={{ flexDirection: vertical ? 'column' : 'row', gap: 8, marginTop: 22 }}>
            {ordered.map((b, i) => btn(b, i, ordered.length))}
            {vertical && cancel && (
              <Pressable onPress={() => close(cancel)} style={{ height: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={[TYPE.btn, { color: t.ink3, fontSize: 15 }]}>{cancel.text || '취소'}</Text>
              </Pressable>
            )}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
