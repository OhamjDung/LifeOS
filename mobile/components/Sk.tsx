// Analog skin primitives — follows LifeOS Analog Style Guide
// Neumorphism rule: surface = background color, depth from shadow ONLY (no borders to fake depth)
// Two-shadow recipe: outer View = light shadow (top-left), inner View = dark shadow (bottom-right)
import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle, TextStyle, Platform } from 'react-native'
import {
  T, MONO,
  SHADOW_DARK_RAISED, SHADOW_DARK_RAISED_SM,
  SHADOW_LIGHT_RAISED, SHADOW_LIGHT_RAISED_SM,
  raisedShadowSm, insetBg,
} from '../lib/theme'

// ── SkCard (neumorphic raised card) ───────────────────────────
// Two-layer shadow: outer = white top-left, inner = dark bottom-right
// Pressed = darker bg, no outer shadow (approximates inset)

interface SkCardProps {
  children: React.ReactNode
  style?: ViewStyle
  pressed?: boolean
  onPress?: () => void
  borderLeft?: string
}

export function SkCard({ children, style, pressed, onPress, borderLeft }: SkCardProps) {
  const inner = (
    <View style={[sk.cardLightWrap, pressed && { ...SHADOW_LIGHT_RAISED, shadowOpacity: 0 }]}>
      <View style={[
        sk.cardDarkWrap,
        pressed ? sk.cardPressed : SHADOW_DARK_RAISED,
        borderLeft ? { borderLeftWidth: 3, borderLeftColor: borderLeft } : undefined,
        style,
      ]}>
        {children}
      </View>
    </View>
  )

  if (onPress) {
    return <TouchableOpacity onPress={onPress} activeOpacity={0.85}>{inner}</TouchableOpacity>
  }
  return inner
}

// ── SkKicker ──────────────────────────────────────────────────

export function SkKicker({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[sk.kicker, style]}>{children}</Text>
}

// ── SkChip (dark LCD count badge) ─────────────────────────────

export function SkChip({ children }: { children: React.ReactNode }) {
  return (
    <View style={[sk.chipLightWrap, SHADOW_LIGHT_RAISED_SM]}>
      <View style={[sk.chipDarkWrap, SHADOW_DARK_RAISED_SM]}>
        <Text style={sk.chipText}>{children}</Text>
      </View>
    </View>
  )
}

// ── SkCheck ───────────────────────────────────────────────────

export function SkCheck({ done, onPress, square }: { done: boolean; onPress: () => void; square?: boolean }) {
  // Unchecked = inset (recessed well)
  // Checked = sage filled, inner pressed shadow
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75}
      style={[
        sk.check,
        square && sk.checkSquare,
        done ? sk.checkDone : sk.checkEmpty,
      ]}
    >
      {done && <Text style={sk.checkMark}>✓</Text>}
    </TouchableOpacity>
  )
}

// ── SkIconBtn ─────────────────────────────────────────────────

export function SkIconBtn({
  children, onPress, active, size = 38,
}: { children: React.ReactNode; onPress?: () => void; active?: boolean; size?: number }) {
  const r = size * 0.29
  if (active) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}
        style={[sk.iconBtnActive, { width: size, height: size, borderRadius: r }]}>
        {children}
      </TouchableOpacity>
    )
  }
  return (
    <View style={[SHADOW_LIGHT_RAISED_SM, { borderRadius: r }]}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}
        style={[sk.iconBtn, SHADOW_DARK_RAISED_SM, { width: size, height: size, borderRadius: r }]}>
        {children}
      </TouchableOpacity>
    </View>
  )
}

// ── SkTagBadge (dark LCD tag) ─────────────────────────────────

export function SkTagBadge({ label }: { label: string }) {
  return (
    <View style={sk.tagBadge}>
      <Text style={sk.tagBadgeText}>{label.toUpperCase()}</Text>
    </View>
  )
}

// ── SkSectionHead ─────────────────────────────────────────────

export function SkSectionHead({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <View style={sk.sectionHead}>
      <SkKicker>{label}</SkKicker>
      {right}
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────

const sk = StyleSheet.create({
  // Two-layer card: outer = light shadow, inner = dark shadow + bg
  // IMPORTANT: no borderWidth anywhere — depth from shadow only (style guide §01 Don't)
  cardLightWrap: {
    borderRadius: 18,
    // Light shadow (top-left) — applied here
    ...SHADOW_LIGHT_RAISED,
  },
  cardDarkWrap: {
    borderRadius: 18,
    backgroundColor: T.surface,
    // Dark shadow (bottom-right) comes from SHADOW_DARK_RAISED applied in component
  },
  cardPressed: {
    backgroundColor: insetBg,
    shadowColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
  },

  kicker: {
    fontFamily: MONO,
    fontSize: 13,
    letterSpacing: 3,
    color: T.faint,
    textTransform: 'uppercase',
    fontWeight: '500',
  },

  chipLightWrap: {
    borderRadius: 9,
    ...SHADOW_LIGHT_RAISED_SM,
  },
  chipDarkWrap: {
    borderRadius: 9,
    backgroundColor: T.display,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  chipText: {
    fontFamily: MONO,
    fontSize: 12,
    color: T.displayInk,
    letterSpacing: 1,
    fontWeight: '500',
  },

  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkSquare: { borderRadius: 7 },
  checkEmpty: {
    backgroundColor: insetBg,
    // Inset shadow approximation (RN can't do true inset — style guide §01 rule 4)
    shadowColor: '#948D7E',
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 0.45,
    shadowRadius: 4,
    elevation: 0,
  },
  checkDone: {
    backgroundColor: T.sage,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 0.32,
    shadowRadius: 4,
    elevation: 0,
  },
  checkMark: { color: '#EEF0E6', fontSize: 16, lineHeight: 20, fontWeight: '600' },

  iconBtn: {
    backgroundColor: T.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnActive: {
    backgroundColor: T.display,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
  },

  tagBadge: {
    backgroundColor: T.display,
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagBadgeText: {
    fontFamily: MONO,
    fontSize: 10,
    color: T.displayInk,
    letterSpacing: 1,
  },

  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
})
