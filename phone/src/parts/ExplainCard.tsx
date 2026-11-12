// 설명 카드 — 엔진이 만든 쉬운 설명(제목 + 한두 문장) + '말로 듣기'(기기 음성). 늦어짐(warn)이면 제목만 빨강 글자(redText).
// 화면을 떠나거나 읽을 글이 바뀌면 읽기를 멈춘다.
import * as Speech from 'expo-speech';
import { useEffect, useState } from 'react';
import { StyleProp, Text, View, ViewStyle } from 'react-native';
import { Icon } from '../icon';
import { R, S, TYPE, useTheme } from '../theme';
import { W } from '../words';
import { ActionButton } from './ActionRow';

export function ExplainCard({ headline, body, warn, tag, speech, style }: {
  headline: string;
  body?: string;
  warn?: boolean;
  /** 제목 위 작은 이름표 (예: '아래 1번 제안대로 바꾸면') */
  tag?: string;
  /** 읽어 줄 글 (없으면 '말로 듣기' 버튼 없음). 화면 글과 달라도 됨(시각을 '오후 4시 30분'처럼) */
  speech?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => { Speech.stop(); }, []);
  useEffect(() => { if (speaking) { Speech.stop(); setSpeaking(false); } }, [speech]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = () => {
    if (!speech) return;
    if (speaking) { Speech.stop(); setSpeaking(false); return; }
    setSpeaking(true);
    Speech.speak(speech, { language: 'ko-KR', rate: 1.0, onDone: () => setSpeaking(false), onStopped: () => setSpeaking(false), onError: () => setSpeaking(false) });
  };
  return (
    <View style={[{ backgroundColor: t.fill, borderRadius: R.md + 2, paddingHorizontal: S.xl, paddingTop: S.l + 1, paddingBottom: S.l }, style]}>
      {!!tag && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs + 1, marginBottom: S.xs + 1 }}>
          <Icon name="circle-alert" size={14} color={t.accent} strokeWidth={2.4} />
          <Text style={[TYPE.cap, { color: t.accent, fontFamily: TYPE.label.fontFamily }]}>{tag}</Text>
        </View>
      )}
      <Text accessibilityRole="header" style={[TYPE.h, { fontSize: 17, lineHeight: 24, fontFamily: TYPE.title.fontFamily, color: warn ? t.redText : t.ink }]}>{headline}</Text>
      {!!body && <Text style={[TYPE.body, { color: t.ink2, marginTop: S.xs }]}>{body}</Text>}
      {!!speech && (
        <ActionButton label={speaking ? '그만 듣기' : W.listen} icon={speaking ? 'square' : 'volume-2'} tone="surface" size="sm" onPress={toggle}
          style={{ marginTop: S.l - 2, alignSelf: 'flex-start', borderRadius: R.pill }} />
      )}
    </View>
  );
}
