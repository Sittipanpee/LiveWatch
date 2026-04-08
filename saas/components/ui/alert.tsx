import { AlertCircle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

const alertVariants = cva('flex gap-3 p-4 rounded-xl border text-sm', {
  variants: {
    variant: {
      info: 'bg-blue-50 border-blue-200 text-blue-900',
      success: 'bg-green-50 border-green-200 text-green-900',
      warning: 'bg-amber-50 border-amber-200 text-amber-900',
      danger: 'bg-red-50 border-red-200 text-red-900',
    },
  },
  defaultVariants: { variant: 'info' },
})

const icons = { info: Info, success: CheckCircle2, warning: AlertCircle, danger: XCircle }

export interface AlertProps extends VariantProps<typeof alertVariants> {
  children: ReactNode
  className?: string
}

export function Alert({ variant = 'info', children, className }: AlertProps) {
  const Icon = icons[variant ?? 'info']
  return (
    <div className={cn(alertVariants({ variant }), className)}>
      <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <div className="flex-1">{children}</div>
    </div>
  )
}
