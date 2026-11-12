import { isIgnored, safeOrigin, staticLabel, type Track } from './types'
import type { Properties } from '../types'

const NOT_A_FIELD = new Set(['submit', 'button', 'reset', 'image', 'hidden'])
const CONTAINERS = new Set(['FIELDSET', 'BUTTON', 'OBJECT'])

function fieldCount(form: HTMLFormElement): number {
  return Array.from(form.elements).filter((el) => {
    if (CONTAINERS.has(el.tagName)) return false
    return !(el instanceof HTMLInputElement && NOT_A_FIELD.has(el.type))
  }).length
}

/** Attributes are read with getAttribute: a field named "id" shadows `form.id`. */
function describe(form: HTMLFormElement): Properties {
  const props: Properties = { field_count: fieldCount(form) }
  const label = staticLabel(form, 'data-corlex-action')
  if (label) props['action'] = label
  const action = form.getAttribute('action')
  const origin = action ? safeOrigin(action) : ''
  if (origin) props['form_origin'] = origin
  const method = (form.getAttribute('method') ?? 'get').toLowerCase()
  props['form_method'] = ['get', 'post', 'dialog'].includes(method) ? method : 'get'
  return props
}

/** `form_submit`: which form and how many fields, never what was entered. */
export function startForms(track: Track): () => void {
  const onSubmit = (event: Event) => {
    const form = event.target
    if (form instanceof HTMLFormElement && !isIgnored(form)) track('form_submit', describe(form))
  }
  addEventListener('submit', onSubmit, true)
  return () => removeEventListener('submit', onSubmit, true)
}
