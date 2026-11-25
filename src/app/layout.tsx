import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import "./caller.css";
import "./admin.css";
import "./workspace.css";
import "./glass.css";
import { ThemeProvider } from "@/product/theme";

const glassFont = Outfit({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-glass",
});

export const metadata: Metadata = {
  title: "Monettic — Business Intelligence & Outreach",
  description:
    "Understand your business, discover relevant customers and build thoughtful email outreach with Monettic.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={glassFont.variable} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('orbit-theme');document.documentElement.dataset.theme=(t==='light'||t==='dark')?t:'dark'}catch(e){document.documentElement.dataset.theme='dark'}",
          }}
        />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
