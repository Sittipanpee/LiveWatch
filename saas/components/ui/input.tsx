import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, className, id, ...props },
  ref,
) {
  return (
    <div className="space-y-1.5">
      {label ? <label htmlFor={id} className="block text-sm font-medium text-gray-700">{label}</label> : null}
      <input
        ref={ref}
        id={id}
        className={cn(
          'block w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent',
          error && 'border-red-400 focus:ring-red-400',
          className,
        )}
        {...props}
      />
      {error ? <p className="text-xs text-red-600">{error}</p> : hint ? <p className="text-xs text-gray-500">{hint}</p> : null}
    </div>
  )
})
