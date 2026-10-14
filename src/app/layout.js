import "./globals.css";
export const metadata = {
  title: "Мой Такси — панель водителя",
  description: "Личный кабинет водителя: QR-код, заказы и история поездок.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  applicationName: "Мой Такси",
};
export default function RootLayout({ children }) {
  return <html lang="ru"><body>{children}</body></html>;
}