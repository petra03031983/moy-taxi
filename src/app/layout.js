import "./globals.css";
export const metadata = {
  title: "Мой Такси — такси пассажиру и водителю",
  description: "Единое приложение заказа такси: маршрут, цены, выбор водителя и управление поездками.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  applicationName: "Мой Такси",
};
export default function RootLayout({ children }) {
  return <html lang="ru"><body>{children}</body></html>;
}