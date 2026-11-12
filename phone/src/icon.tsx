// 아이콘: Lucide 선 아이콘 한 벌 (시안 proto/icons.html). 이모지·Ionicons 대신 전부 이것.
// 쓰는 아이콘만 여기 모아 둔다 → 이름이 틀리면 타입 오류, 앱에 실리는 그림도 이것뿐.
// 굵기 기본 2(24칸 기준, 크기에 비례), 색 기본은 글자색(ink).
import {
  ArrowLeftRight, ArrowRight, GripVertical, Ellipsis, LayoutList, ChevronLeft, Settings, LocateFixed, Star, Baby, Bell, Car, CarFront, Castle, Check, ChevronRight, Circle, CircleAlert, CircleCheck, CircleDot,
  CircleMinus, CirclePlus, CircleX, Clock, CloudRain, ChevronDown, ChevronUp, Volume2,
  CloudSun, Download, Drama, FastForward, Flag, FlaskConical, Frown, Gem, Globe, Headphones, Hourglass, House, Images, Keyboard, Link, MessageCircle,
  LogOut, Map as MapIcon, MapPin, Mic, Moon, Mountain, Navigation, Package, PartyPopper, Pause, Pencil, PencilLine, Play, QrCode, RefreshCw,
  RotateCcw, Route, Maximize2, Minus, Plus, Heart, BookOpen, Calendar, CalendarCheck, CalendarClock, Search, ArrowUp, ArrowDown,
  ScanQrCode, School, Send, Share2, Smartphone, Smile, Snowflake, Square, Stamp, Sun, Sunrise, Sunset, Telescope, Timer,
  ExternalLink, VolumeX, TrainFront, Trash2, TriangleAlert, Trophy, Umbrella, Undo2, Unlink, User, Users, Utensils, Waves, X,
  // 장소 아이콘 (새 도장 27곳)
  Bird, Flower, Flower2, TrainTrack, Trees, Factory, Fence, TreeDeciduous, Ship, Sailboat, Fish, TrafficCone, Landmark, Siren, Soup, Orbit, Crown, Rabbit, PawPrint, FerrisWheel, TreePine, Wind, Sprout, Hexagon, CableCar,
} from 'lucide-react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTheme } from './theme';

const ICONS = {
  ellipsis: Ellipsis, 'grip-vertical': GripVertical, 'layout-list': LayoutList, 'chevron-left': ChevronLeft, settings: Settings, 'locate-fixed': LocateFixed, star: Star,
  'arrow-left-right': ArrowLeftRight, 'arrow-right': ArrowRight, baby: Baby, bell: Bell, car: Car, 'car-front': CarFront, castle: Castle, check: Check,
  'chevron-right': ChevronRight, 'chevron-down': ChevronDown, 'chevron-up': ChevronUp, 'volume-2': Volume2, circle: Circle, 'circle-alert': CircleAlert, 'circle-check': CircleCheck, 'circle-dot': CircleDot,
  'circle-minus': CircleMinus, 'circle-plus': CirclePlus,
  'circle-x': CircleX, clock: Clock, 'cloud-rain': CloudRain, 'cloud-sun': CloudSun, download: Download, drama: Drama,
  'fast-forward': FastForward, flag: Flag, 'flask-conical': FlaskConical, frown: Frown, gem: Gem, globe: Globe,
  headphones: Headphones, hourglass: Hourglass, house: House, images: Images, keyboard: Keyboard, link: Link, 'message-circle': MessageCircle, 'log-out': LogOut, map: MapIcon,
  'map-pin': MapPin, 'maximize-2': Maximize2, mic: Mic, moon: Moon, mountain: Mountain, navigation: Navigation, package: Package, 'party-popper': PartyPopper, pause: Pause,
  pencil: Pencil, 'pencil-line': PencilLine, play: Play, 'qr-code': QrCode, 'refresh-cw': RefreshCw, 'rotate-ccw': RotateCcw, route: Route,
  'external-link': ExternalLink, 'volume-x': VolumeX, 'scan-qr-code': ScanQrCode, school: School, send: Send, 'share-2': Share2, smartphone: Smartphone, smile: Smile,
  snowflake: Snowflake, square: Square, stamp: Stamp, sun: Sun, sunrise: Sunrise, sunset: Sunset, telescope: Telescope,
  timer: Timer, 'train-front': TrainFront, 'trash-2': Trash2, 'triangle-alert': TriangleAlert, trophy: Trophy, umbrella: Umbrella, 'undo-2': Undo2,
  minus: Minus, plus: Plus, heart: Heart, 'book-open': BookOpen, calendar: Calendar, 'calendar-check': CalendarCheck, 'calendar-clock': CalendarClock, search: Search, 'arrow-up': ArrowUp, 'arrow-down': ArrowDown,
  unlink: Unlink, user: User, users: Users, utensils: Utensils, waves: Waves, x: X,
  bird: Bird, flower: Flower, 'flower-2': Flower2, 'train-track': TrainTrack, trees: Trees, factory: Factory, fence: Fence, 'tree-deciduous': TreeDeciduous, ship: Ship, sailboat: Sailboat, fish: Fish, 'traffic-cone': TrafficCone, landmark: Landmark, siren: Siren, soup: Soup, orbit: Orbit, crown: Crown, rabbit: Rabbit, 'paw-print': PawPrint, 'ferris-wheel': FerrisWheel, 'tree-pine': TreePine, wind: Wind, sprout: Sprout, hexagon: Hexagon, 'cable-car': CableCar,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, color, strokeWidth = 2, style }: {
  name: IconName; size?: number; color?: string; strokeWidth?: number; style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const C = ICONS[name];
  return <C size={size} color={color ?? t.ink} strokeWidth={strokeWidth} style={style as any} />;
}
