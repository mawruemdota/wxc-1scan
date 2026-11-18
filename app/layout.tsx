import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'First-to-Scan QR Pass', description: 'Single-use QR pass verification', robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
