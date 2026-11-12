// 처음 연결 (MindNest Onboarding과 같은 틀): 차 QR 찍기 → 누구 폰인지 → 알림 켜기 → 우리 가족(건너뛰기 가능)
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { codeFrom, join } from '../api';
import { DEFAULT_FAMILY, Family, putFamily } from '../plan';
import { useSession } from '../session';
import { Btn, done, Icon, plainError, Input, MAX_W, Pill, T, tick, useKeyboard, useTheme } from '../ui';
import { FamilyForm } from './FamilySheet';
import { R } from '../theme';

const WHO = ['엄마', '아빠', '할머니', '할아버지', '이모', '삼촌'];

export function Onboarding() {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const session = useSession();
  const [step, setStep] = useState(0);
  const [code, setCode] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [typing, setTyping] = useState(false);
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [family, setFamily] = useState<Family>(DEFAULT_FAMILY);
  const [perm, askPerm] = useCameraPermissions();
  const pulse = useRef(new Animated.Value(1)).current;
  const kb = useKeyboard();

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.06, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);

  const got = (c: string | null) => {
    if (!c || code) return;
    tick();
    setCode(c);
    setErr('');
    setStep(1);
  };

  const connect = async () => {
    if (!code) return;
    setBusy(true); setErr('');
    try {
      const r = await join(code, who || '가족');
      setToken(r.token);
      done();
      setStep(2);
    } catch (e: any) {
      setErr(plainError(e, '연결하지 못했어요'));
      setCode(null);
      setStep(0); // 코드가 지났으면 다시 찍기
    } finally { setBusy(false); }
  };

  const notify = async (ask: boolean) => {
    if (ask) await Notifications.requestPermissionsAsync().catch(() => {});
    setStep(3);
  };

  const finish = async (save: boolean) => {
    if (!token) return;
    if (save) {
      setBusy(true); setErr('');
      try { await putFamily(token, family); done(); }
      catch (e: any) { setErr(plainError(e, '저장하지 못했어요. 다시 눌러 주세요')); setBusy(false); return; }
      setBusy(false);
    }
    await session.signIn(token);
  };

  const steps = [
    { title: '차 화면의 QR을\n찍어 주세요', sub: "차를 세운 뒤 차 화면 위쪽 '폰 연결'을 누르면 QR이 나와요. 10분 동안 쓸 수 있어요." },
    { title: '누구의 폰인가요?', sub: "가족 폰마다 이름이 보여요. 건너뛰면 '가족 폰'으로 보여요." },
    { title: '연결됐어요!', sub: '차 문이 열리면 듣던 이야기를 폰에서 이어 들을 수 있게 알림을 켜 둘게요.' },
    { title: '우리 가족', sub: "오늘 어디 갈지 추천할 때 써요. 낮잠 시각·귀가 한계·저녁은 '우리 차' 탭에서 바꿀 수 있어요." },
  ];
  // 코드로 입력하는 중이면 제목도 그에 맞게
  const s = step === 0 && typing ? { title: '차 화면의 코드를\n넣어 주세요', sub: "차 화면 '폰 연결'에서 QR과 같이 나오는 6자리 코드예요. 10분 동안 쓸 수 있어요." } : steps[step];

  return (
    <View style={{ flex: 1, backgroundColor: t.surface, paddingTop: ins.top + 16, paddingBottom: (kb.height ? kb.height : ins.bottom) + 16, paddingHorizontal: 22 }}>
     {/* 넓은 화면에서는 본문 폭(MAX_W)까지, 가운데 */}
     <View style={{ flex: 1, width: '100%', maxWidth: MAX_W, alignSelf: 'center' }}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[0, 1, 2, 3].map((i) => <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? t.ink : t.fill2 }} />)}
      </View>
      <T v="label" c="ink3" style={{ marginTop: 26 }}>{step + 1} / {steps.length}</T>
      <T v="display" style={{ marginTop: 4 }}>{s.title}</T>
      <T v="body" c="ink2" style={{ marginTop: 8 }}>{s.sub}</T>

      {step === 3 && (
        <ScrollView style={{ flex: 1, marginTop: 14, marginHorizontal: -22 }} contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}>
          <FamilyForm value={family} onChange={setFamily} simple />
          {!!err && <View style={{ marginTop: 14 }}><Pill text={err} tone="red" icon="circle-alert" /></View>}
        </ScrollView>
      )}

      {step < 3 && <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {step === 0 && (typing ? (
          <View style={{ alignSelf: 'stretch' }}>
            <Input value={typed} onChange={(v) => setTyped(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="차 화면의 코드 6자리" icon="keyboard" autoFocus
              onSubmit={() => got(codeFrom(typed))} />
            <Btn title="다음" onPress={() => got(codeFrom(typed))} disabled={typed.length !== 6} style={{ marginTop: 12 }} />
          </View>
        ) : perm?.granted ? (
          <View style={{ width: 260, height: 260, borderRadius: 28, overflow: 'hidden', backgroundColor: t.fill }}>
            <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={code ? undefined : (r) => got(codeFrom(r.data))} />
            <View pointerEvents="none" style={{ position: 'absolute', top: 40, left: 40, right: 40, bottom: 40, borderRadius: 18, borderWidth: 3, borderColor: '#fff' }} />
          </View>
        ) : (
          <Animated.View style={{ transform: [{ scale: pulse }], alignItems: 'center' }}>
            <View style={{ width: 120, height: 120, borderRadius: 60, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="scan-qr-code" size={56} color={t.accent} strokeWidth={1.8} />
            </View>
          </Animated.View>
        ))}

        {step === 1 && (
          <View style={{ alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {WHO.map((w) => {
              const on = w === who;
              return (
                <Pressable key={w} onPress={() => { tick(); setWho(on ? '' : w); }}
                  style={({ pressed }) => ({ width: '31.5%', height: 56, borderRadius: R.md, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: on ? t.ink : t.fill, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
                  <T v="btn" c={on ? 'onInk' : 'ink'}>{w}</T>
                </Pressable>
              );
            })}
          </View>
        )}

        {step === 2 && (
          <View style={{ width: 120, height: 120, borderRadius: 60, backgroundColor: t.okSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={60} color={t.ok} strokeWidth={2.4} />
          </View>
        )}

        {!!err && <View style={{ marginTop: 22 }}><Pill text={err} tone="red" icon="circle-alert" /></View>}
        {/* 넣은 코드 값은 화면에 보이지 않는다 (개발자 통과 코드가 시연 영상·캡처에 찍히지 않게, QA 0.9.7 #14) */}
        {step === 1 && code && <View style={{ marginTop: 22 }}><Pill text="코드를 확인했어요" tone="accent" icon="qr-code" /></View>}
      </View>}

      {step === 0 && !typing && !perm?.granted && <Btn title="카메라로 QR 찍기" icon="scan-qr-code" onPress={() => askPerm()} />}
      {step === 0 && !kb.height && <Btn title={typing ? 'QR로 찍을게요' : '코드로 입력할게요'} kind="line" icon={typing ? 'scan-qr-code' : 'keyboard'} onPress={() => setTyping((v) => !v)} style={{ marginTop: 10 }} />}
      {step === 1 && <Btn title="연결하기" kind="accent" icon="link" busy={busy} onPress={connect} />}
      {step === 1 && <Btn title="다시 찍기" kind="line" onPress={() => { setCode(null); setStep(0); }} style={{ marginTop: 10 }} />}
      {step === 2 && <Btn title="알림 켜고 다음" icon="bell" onPress={() => notify(true)} />}
      {step === 2 && <Btn title="나중에 할게요" kind="line" onPress={() => notify(false)} style={{ marginTop: 10 }} />}
      {step === 3 && <Btn title="저장하고 시작하기" kind="accent" icon="check" busy={busy} onPress={() => finish(true)} />}
      {step === 3 && <Btn title="건너뛰기" kind="line" disabled={busy} onPress={() => finish(false)} style={{ marginTop: 10 }} />}
     </View>
    </View>
  );
}
