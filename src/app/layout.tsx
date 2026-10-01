import type { Metadata } from 'next'
import { Fira_Sans, Fira_Code } from 'next/font/google'
import './globals.css'

const firaSans = Fira_Sans({
  variable: '--font-sans-stack',
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  display: 'swap',
})

const firaCode = Fira_Code({
  variable: '--font-mono-stack',
  weight: ['400', '500'],
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Curve Lab',
  description:
    'Design and stress-test a Meteora Dynamic Bonding Curve against real mainnet demand before you launch on it.',
}

// Typed explicitly rather than with Next's generated `LayoutProps`, which only
// exists under .next/types after a build and so breaks typecheck on a fresh clone.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${firaSans.variable} ${firaCode.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
