import { Corlex } from './client'

export type {
  AutocaptureOptions,
  CorlexApi,
  ConfigApi,
  ConfigJson,
  ConfigOptions,
  ConfigUpdate,
  ConsentState,
  ExperimentAssignment,
  InitOptions,
  Properties,
} from './types'
export { Corlex }
export { SDK_VERSION } from './version'

const corlex = new Corlex()

export const init: Corlex['init'] = (options) => corlex.init(options)
export const track: Corlex['track'] = (name, properties) => corlex.track(name, properties)
export const identify: Corlex['identify'] = (userId, traits) => corlex.identify(userId, traits)
export const setUserProperties: Corlex['setUserProperties'] = (properties) =>
  corlex.setUserProperties(properties)
/** Remote Config: `config.get('free_trial_days', 7)`, `config.ready()`, `config.onUpdate(…)`. */
export const config: Corlex['config'] = corlex.config
/** A/B test: `experiment('paywall_test')` gives `{ variant, value }` or `null`, and counts the exposure. */
export const experiment: Corlex['experiment'] = (key) => corlex.experiment(key)
export const flag: Corlex['flag'] = (key, defaultValue) => corlex.flag(key, defaultValue)
export const reset: Corlex['reset'] = () => corlex.reset()
export const flush: Corlex['flush'] = () => corlex.flush()
export const getConsent: Corlex['getConsent'] = () => corlex.getConsent()
export const optIn: Corlex['optIn'] = () => corlex.optIn()
export const optOut: Corlex['optOut'] = () => corlex.optOut()
