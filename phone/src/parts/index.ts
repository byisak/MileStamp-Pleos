// 공용 부품 15개 (docs/디자인-개편-계획.md 3절, 목록·속성은 docs/디자인-부품.md).
// 규칙: 색 값은 받지 않고 tone 이름만, 크기·간격·모서리는 theme.ts 토큰만, 누르는 칸 44 이상, 화면 읽기 이름표.
// 차 앱은 같은 이름 앞에 Ms (3단계).
export { PrimaryCTA } from './PrimaryCTA';
export { ActionButton, ActionRow } from './ActionRow';
export type { ActionItem, ActionTone, ActionSize } from './ActionRow';
export { IconBadge } from './IconBadge';
export type { BadgeTone } from './IconBadge';
export { Chip } from './Chip';
export type { ChipPart } from './Chip';
export { Row } from './Row';
export { MoreSheet } from './MoreSheet';
export type { MoreItem } from './MoreSheet';
export { StopTimeline, STATE_TEXT } from './StopTimeline';
export type { StopState, TimelineStop } from './StopTimeline';
export { StatStrip } from './StatStrip';
export type { StatItem } from './StatStrip';
export { ExplainCard } from './ExplainCard';
export { NextHero } from './NextHero';
export { DayBar, DayBarBlock, DayLegend } from './DayBar';
export type { Mark } from './DayBar';
export { Header, Landscape, sceneFor } from './Header';
export { Empty } from './Empty';
export { ErrorRow } from './ErrorRow';
export { ProposalBanner } from './ProposalBanner';
export { useReducedMotion } from './motion';
