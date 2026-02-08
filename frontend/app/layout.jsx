import Script from 'next/script';
import './globals.css';
import Providers from '../lib/Providers';

export const metadata = {
  title: 'Anime Dashboard',
  description: 'Telegram Mini App dashboard'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
