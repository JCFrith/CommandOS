import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { QueryProvider } from '@/lib/query/provider';
import { CommandMenu } from '@/components/os/command-menu';
import { cn } from '@/lib/utils';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'CommandOS',
    template: '%s · CommandOS',
  },
  description: 'The AI-native operations platform. Command your entire operation from one surface.',
  applicationName: 'CommandOS',
};

export const viewport: Viewport = {
  themeColor: '#0b0b12',
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={cn(
          geistSans.variable,
          geistMono.variable,
          'bg-background text-foreground min-h-dvh font-sans antialiased',
        )}
      >
        <QueryProvider>
          {children}
          <CommandMenu />
        </QueryProvider>
      </body>
    </html>
  );
}
