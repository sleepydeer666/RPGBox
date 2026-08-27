import { useEffect, useState, type ComponentProps } from 'react'

type DeferredInputProps = Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'onBlur'> & {
  value: string
  onCommit: (value: string) => void
}

type DeferredTextareaProps = Omit<ComponentProps<'textarea'>, 'value' | 'onChange' | 'onBlur'> & {
  value: string
  onCommit: (value: string) => void
}

export function DeferredInput({ value, onCommit, ...props }: DeferredInputProps) {
  const [draft, setDraft] = useState(value)

  useEffect(() => setDraft(value), [value])

  return <input {...props} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => {
    if (draft !== value) onCommit(draft)
  }} />
}

export function DeferredTextarea({ value, onCommit, ...props }: DeferredTextareaProps) {
  const [draft, setDraft] = useState(value)

  useEffect(() => setDraft(value), [value])

  return <textarea {...props} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => {
    if (draft !== value) onCommit(draft)
  }} />
}
