import { Platform } from 'react-native'

// Analog skin — follows LifeOS Analog Style Guide
export const MONO = 'IBMPlexMono_400Regular'
export const MONO_MED = 'IBMPlexMono_500Medium'
export const MONO_SB = 'IBMPlexMono_600SemiBold'
export const MONO_BOLD = 'IBMPlexMono_700Bold'

export const T = {
  // Warm machined grays
  bg:       '#E7E4DB',   // page background (also surface — they must match for neumorphism)
  bg2:      '#D3CFC4',   // gradient end (use expo-linear-gradient: bg → bg2, 160deg)
  surface:  '#E2DFD6',   // card surface — same warm gray family as bg

  // Text
  ink:    '#23201A',
  mute:   '#615B50',
  faint:  '#8B8578',

  // Sage accent (default)
  sage:       '#516439',
  sageDim:    '#7E9152',   // accent-bright: event borders, hovers
  displayInk: '#CDDBA6',  // accent-light: text on dark LCD

  // LCD digit colors — FIXED, never change with accent
  lcdGreen: '#9FE3B0',   // done
  lcdAmber: '#ECA06A',   // alert / reach out

  // Urgency — FIXED across all accents
  clay:    '#9C4D29',
  clayFg:  '#EEDFD8',

  // Dark LCD panel
  display: '#2A2F29',

  // Structural
  line: 'rgba(110,104,92,0.24)',

  // Spacing — comfy density (×1.18)
  gap:      19,   // 16 × 1.18
  listGap:  13,   // 11 × 1.18
  cardPadY: 15,   // 13 × 1.18
  padX:     18,
  topPad:   58,
} as const

// ── The dual-shadow recipe (style guide §01) ──────────────────
// RN can't do two box-shadows on one view.
// Fix: nest two Views. Outer = light shadow (top-left), Inner = dark shadow (bottom-right).
// On Android elevation covers the dark side; white shadow is skipped (Android doesn't support it).

export const SHADOW_DARK_RAISED = {
  shadowColor: '#948D7E',
  shadowOffset: { width: 7, height: 7 },
  shadowOpacity: 0.62,
  shadowRadius: 15,
  elevation: 6,
} as const

export const SHADOW_DARK_RAISED_SM = {
  shadowColor: '#948D7E',
  shadowOffset: { width: 3, height: 3 },
  shadowOpacity: 0.58,
  shadowRadius: 8,
  elevation: 4,
} as const

export const SHADOW_LIGHT_RAISED = Platform.OS === 'ios' ? {
  shadowColor: '#FFFFFF',
  shadowOffset: { width: -5, height: -5 },
  shadowOpacity: 0.96,
  shadowRadius: 12,
} as const : {}

export const SHADOW_LIGHT_RAISED_SM = Platform.OS === 'ios' ? {
  shadowColor: '#FFFFFF',
  shadowOffset: { width: -3, height: -3 },
  shadowOpacity: 0.93,
  shadowRadius: 7,
} as const : {}

// Inset approximation: slightly darker bg — RN has no inset box-shadow
// Follows the spirit (recessed look) but can't achieve the true dual-inset-shadow
export const insetBg = '#D4D1C8'

// Convenience: single-layer raised-sm for small elements (chips, icon buttons)
// where wrapping in two Views is too heavy
export const raisedShadowSm = SHADOW_DARK_RAISED_SM
