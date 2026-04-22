'use client';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from 'react';

import { cn } from '@/lib/cn';

/**
 * Avatar — wrapper do Radix Avatar. Uso típico:
 *
 *   <Avatar>
 *     <AvatarImage src={user.avatarUrl ?? undefined} alt={user.name} />
 *     <AvatarFallback>{user.initials}</AvatarFallback>
 *   </Avatar>
 *
 * Tamanho default: 28px (compacto, Linear-style). Passe `className="h-8 w-8"`
 * para tamanhos maiores.
 */
export const Avatar = forwardRef<
  ElementRef<typeof AvatarPrimitive.Root>,
  ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(function Avatar({ className, ...props }, ref) {
  return (
    <AvatarPrimitive.Root
      ref={ref}
      className={cn(
        'relative flex h-7 w-7 shrink-0 overflow-hidden rounded-full',
        className,
      )}
      {...props}
    />
  );
});

export const AvatarImage = forwardRef<
  ElementRef<typeof AvatarPrimitive.Image>,
  ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(function AvatarImage({ className, ...props }, ref) {
  return (
    <AvatarPrimitive.Image
      ref={ref}
      className={cn('aspect-square h-full w-full object-cover', className)}
      {...props}
    />
  );
});

export const AvatarFallback = forwardRef<
  ElementRef<typeof AvatarPrimitive.Fallback>,
  ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(function AvatarFallback({ className, ...props }, ref) {
  return (
    <AvatarPrimitive.Fallback
      ref={ref}
      className={cn(
        'flex h-full w-full items-center justify-center rounded-full',
        'bg-surface-muted text-[11px] font-semibold text-text-muted',
        className,
      )}
      {...props}
    />
  );
});

/**
 * Gera iniciais a partir de um nome: "Charles Barreto" → "CB".
 * Usa no máximo 2 letras; fallback "?".
 */
export function initialsFromName(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
