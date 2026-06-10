import { Platform } from 'react-native'

// Analog skin — follows LifeOS Analog Style Guide
export const MONO = 'IBMPlexMono_400Regular'
export const MONO_MED = 'IBMPlexMono_500Medium'
export const MONO_SB = 'IBMPlexMono_600SemiBold'
export const MONO_BOLD = 'IBMPlexMono_700Bold'

export const T = {
  // Warm machined grays
  bg:       '#CCCAC0',   // page background — darker so cards float above it
  bg2:      '#BAB8AE',   // gradient end
  surface:  '#DEDAD2',   // card surface — lighter than bg, clear lift

  // Text
  ink:    '#1C1A14',
  mute:   '#5A5448',
  faint:  '#837C6F',

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
  line: 'rgba(90,84,72,0.38)',

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
  shadowColor: '#6B6358',
  shadowOffset: { width: 7, height: 7 },
  shadowOpacity: 0.85,
  shadowRadius: 18,
  elevation: 8,
} as const

export const SHADOW_DARK_RAISED_SM = {
  shadowColor: '#6B6358',
  shadowOffset: { width: 3, height: 3 },
  shadowOpacity: 0.80,
  shadowRadius: 10,
  elevation: 5,
} as const

export const SHADOW_LIGHT_RAISED = Platform.OS === 'ios' ? {
  shadowColor: '#FFFFFF',
  shadowOffset: { width: -5, height: -5 },
  shadowOpacity: 1.0,
  shadowRadius: 12,
} as const : {}

export const SHADOW_LIGHT_RAISED_SM = Platform.OS === 'ios' ? {
  shadowColor: '#FFFFFF',
  shadowOffset: { width: -3, height: -3 },
  shadowOpacity: 1.0,
  shadowRadius: 7,
} as const : {}

// Inset: darker than bg for recessed look
export const insetBg = '#BCBAB0'

// Convenience: single-layer raised-sm for small elements (chips, icon buttons)
// where wrapping in two Views is too heavy
export const raisedShadowSm = SHADOW_DARK_RAISED_SM
