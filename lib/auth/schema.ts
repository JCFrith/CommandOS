import { z } from 'zod';

/** Credentials schema shared by the sign-in / sign-up form and server actions. */
export const credentialsSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

export type Credentials = z.infer<typeof credentialsSchema>;

/** OAuth providers CommandOS supports. */
export const OAUTH_PROVIDERS = ['google', 'github'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];
