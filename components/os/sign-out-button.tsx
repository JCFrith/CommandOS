'use client';

import { LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { signOut } from '@/app/(auth)/actions';

/** Signs the operator out via the server action, then redirects to `/login`. */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <Button type="submit" variant="outline">
        <LogOut className="size-4" />
        Sign out
      </Button>
    </form>
  );
}
