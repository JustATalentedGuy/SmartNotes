import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'
import React from 'react'

// ── Button ────────────────────────────────────────────────────────────────

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant
  loading?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const btnVariants: Record<BtnVariant, string> = {
  primary:   'bg-accent hover:bg-accent-hover text-white shadow-lg shadow-accent/20',
  secondary: 'bg-card border border-border text-slate-200 hover:border-accent/60 hover:text-accent',
  ghost:     'text-muted hover:text-slate-200 hover:bg-card',
  danger:    'bg-danger/10 border border-danger/40 text-danger hover:bg-danger/20',
}
const btnSizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-sm' }

export function Button({ variant = 'primary', loading, size = 'md', className, children, disabled, ...props }: BtnProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center gap-2 font-medium rounded-lg transition-all duration-150',
        'focus:outline-none focus:ring-2 focus:ring-accent/40',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        btnVariants[variant], btnSizes[size], className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {children}
    </button>
  )
}

// ── Badge ─────────────────────────────────────────────────────────────────

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'accent'
const badgeVariants: Record<BadgeVariant, string> = {
  default: 'bg-border/60 text-slate-300',
  success: 'bg-success/15 text-success border border-success/30',
  warning: 'bg-warning/15 text-warning border border-warning/30',
  danger:  'bg-danger/15  text-danger  border border-danger/30',
  accent:  'bg-accent/15  text-accent  border border-accent/30',
}

interface BadgeProps { variant?: BadgeVariant; className?: string; children: React.ReactNode }
export function Badge({ variant = 'default', className, children }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium', badgeVariants[variant], className)}>
      {children}
    </span>
  )
}

// ── Input ─────────────────────────────────────────────────────────────────

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-slate-200',
        'placeholder:text-muted focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30',
        'transition-colors disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

// ── Textarea ──────────────────────────────────────────────────────────────

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-slate-200 font-mono',
        'placeholder:text-muted focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30',
        'transition-colors resize-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

// ── Progress ──────────────────────────────────────────────────────────────

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1.5 bg-border rounded-full overflow-hidden', className)}>
      <div
        className="h-full bg-accent rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}

// ── Card ──────────────────────────────────────────────────────────────────

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('bg-card border border-border rounded-xl', className)} {...props}>
      {children}
    </div>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('animate-spin text-accent', className)} />
}

// ── Label ─────────────────────────────────────────────────────────────────

export function Label({ className, children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn('text-xs font-semibold text-muted uppercase tracking-wider', className)} {...props}>
      {children}
    </label>
  )
}

// ── Section header ────────────────────────────────────────────────────────

export function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold text-slate-100">{title}</h2>
      {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
    </div>
  )
}

// ── Alert ─────────────────────────────────────────────────────────────────

export function Alert({ type = 'info', children }: { type?: 'info' | 'warn' | 'error'; children: React.ReactNode }) {
  const styles = {
    info:  'bg-accent/10 border-accent/30 text-accent',
    warn:  'bg-warning/10 border-warning/30 text-warning',
    error: 'bg-danger/10  border-danger/30  text-danger',
  }
  return (
    <div className={cn('border rounded-lg px-4 py-3 text-sm', styles[type])}>
      {children}
    </div>
  )
}
