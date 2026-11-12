// 동그란 아이콘 — 줄 앞·빈 화면·숫자 카드. 장식이라 화면 읽기에서는 건너뛴다(옆 글이 뜻을 말함).
import { View } from 'react-native';
import { Icon, IconName } from '../icon';
import { R, ToneName, useTheme } from '../theme';

export type BadgeTone = ToneName | 'accent' | 'surface' | 'mute' | 'ink';
const SIZE = { sm: 28, md: 40, lg: 48, xl: 60 } as const;
const ICON = { sm: 15, md: 19, lg: 22, xl: 26 } as const;

export function IconBadge({ icon, tone = 'plain', size = 'md' }: { icon: IconName; tone?: BadgeTone; size?: keyof typeof SIZE }) {
  const t = useTheme();
  const [bg, fg] = tone === 'accent' ? [t.accentSoft, t.accent]
    : tone === 'surface' ? [t.surface, t.ink2]
    : tone === 'mute' ? [t.fill, t.ink3]
    : tone === 'ink' ? [t.ink, t.onInk]
    : t.tone[tone];
  const d = SIZE[size];
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
      style={{ width: d, height: d, borderRadius: R.pill, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={ICON[size]} color={fg} strokeWidth={2.2} />
    </View>
  );
}
