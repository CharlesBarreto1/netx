import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** class-names helper com dedupe de tailwind. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
