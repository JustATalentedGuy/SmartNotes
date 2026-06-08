import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function scoreColor(score: number): string {
  if (score >= 0.75) return 'text-success'
  if (score >= 0.50) return 'text-warning'
  return 'text-danger'
}

export function scoreBg(score: number): string {
  if (score >= 0.75) return 'bg-success'
  if (score >= 0.50) return 'bg-warning'
  return 'bg-danger'
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}
