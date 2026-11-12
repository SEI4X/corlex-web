import { truncateBytes } from '#core'
import type { Properties } from '../types'

export type Track = (name: string, properties?: Properties) => void

/** Elements (and their children) marked with this attribute are never captured. */
export const IGNORE_ATTRIBUTE = 'data-corlex-ignore'

export const isIgnored = (el: Element): boolean => el.closest(`[${IGNORE_ATTRIBUTE}]`) !== null

/** Collapses whitespace and cuts to `max` characters. */
export const clip = (text: string, max: number): string =>
  text.replace(/\s+/g, ' ').trim().slice(0, max)

/** Only the HTTP(S) origin; paths, credentials, query and fragment can carry personal data. */
export function safeOrigin(raw: string): string {
  try {
    const url = new URL(raw, location.href)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : ''
  } catch {
    return ''
  }
}

/** The host deliberately supplies a fixed label; labels must not contain user-entered values. */
export function staticLabel(element: Element | null, name: string): string | undefined {
  const value = element?.getAttribute(name)?.trim()
  return value ? truncateBytes(value, 128) : undefined
}
