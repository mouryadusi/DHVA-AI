import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dhva AI",
  description: "The AI voice employee that answers your business phone.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-ink-950 text-ink-50 antialiased">{children}</body>
    </html>
  );
}
