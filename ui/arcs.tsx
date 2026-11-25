import { forwardRef } from 'react'
import type { ReactNode } from 'react'
import { Accordion } from './arc/accordion/accordion'
import { Select as ArcSelect } from './arc/select/select'
import type { SelectProps as ArcSelectProps } from './arc/select/select'
import './tapd-arc-theme.css'
import './tapd-settings.css'

export { Input } from './arc/input/input'

// The DSH loader ships JavaScript alone. The build embeds the compiled CSS in its factory.
declare const __TAVLO_TAPD_ARC_CSS__: string
export function ArcStyle() {
  return <style data-tavlo-tapd-arc-styles="">{__TAVLO_TAPD_ARC_CSS__}</style>
}

type SelectProps = Omit<ArcSelectProps, 'options' | 'onValueChange'> & {
  choices: ReadonlyArray<readonly [string, string, boolean?]>
  onChange?: (value: string) => void
}

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { choices, value, defaultValue, onChange, ...props }, ref,
) {
  // Radix reserves the empty string for a placeholder. TAPD uses it for a real
  // "Ungrouped" choice; translate only if the empty value is actually offered.
  const values = new Set(choices.map(([choice]) => choice))
  let emptyChoice = ''
  if (values.has('')) {
    emptyChoice = '__tavlo_tapd_blank__'
    while (values.has(emptyChoice) || emptyChoice === value || emptyChoice === defaultValue) emptyChoice += '_'
  }
  const options = choices.map(([choice, label, disabled]) => ({ value: choice || emptyChoice, label, disabled }))
  return <ArcSelect {...props} ref={ref} options={options}
    value={value === '' ? emptyChoice : value}
    defaultValue={defaultValue === '' ? emptyChoice : defaultValue}
    onValueChange={(selected) => onChange?.(selected === emptyChoice ? '' : selected)} />
})

export function Disclosure({ title, annotation, defaultOpen = false, children }: {
  title: ReactNode; annotation?: ReactNode; defaultOpen?: boolean; children: ReactNode;
}) {
  return <Accordion defaultOpen={defaultOpen ? 0 : -1} items={[{ title, annotation, content: children }]} />
}
