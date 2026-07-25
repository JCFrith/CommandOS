import Link from 'next/link';
import { Command } from 'lucide-react';

/**
 * Centered, branded shell for unauthenticated surfaces (sign in / sign up).
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-12">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="bg-primary/20 absolute top-[-10%] left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full blur-[120px]" />
        <div className="bg-accent/10 absolute right-[-10%] bottom-[-20%] h-[30rem] w-[30rem] rounded-full blur-[120px]" />
      </div>

      <Link href="/" className="mb-8 flex items-center gap-2.5" aria-label="CommandOS home">
        <span className="bg-primary/15 text-primary ring-primary/25 grid size-9 place-items-center rounded-lg ring-1">
          <Command className="size-4" />
        </span>
        <span className="text-base font-semibold tracking-tight">CommandOS</span>
      </Link>

      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
