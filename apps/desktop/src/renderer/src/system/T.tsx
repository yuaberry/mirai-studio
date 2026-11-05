/**
 * T — inline translation component. `<T k="Story Bible" />` resolves the
 * active locale from settings and renders the pt-BR string when one exists
 * (English source otherwise). Lets static headers/labels go bilingual without
 * wiring hooks into every component body.
 */
import { useT } from '../lib/i18n'

export function T({ k }: { k: string }) {
  const tr = useT()
  return <>{tr(k)}</>
}
