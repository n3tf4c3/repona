import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Repona",
  description: "Lista de compras e controle de estoque.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
