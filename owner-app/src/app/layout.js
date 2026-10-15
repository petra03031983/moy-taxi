import "./globals.css";
export const metadata = {
  title: "Кабинет владельца — Мой Такси",
  description: "Отдельное приложение владельца сервиса Мой Такси.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/owner-icon.svg", apple: "/owner-icon.svg" },
  applicationName: "Кабинет владельца — Мой Такси",
};
export default function RootLayout({ children }) {
  return <html lang="ru"><body>{children}</body></html>;
}
