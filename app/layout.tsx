import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '1scan | QR Pass Verification', description: '1scan — secure, single-use QR pass verification', robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
