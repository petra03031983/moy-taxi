export const metadata = {
  title: "Кабинет владельца — Мой Такси",
  description: "Отдельная панель управления сервисом Мой Такси.",
  manifest: "/admin/manifest.webmanifest",
  icons: { icon: "/owner-icon.svg", apple: "/owner-icon.svg" },
  applicationName: "Кабинет владельца",
};

export default function AdminLayout({ children }) {
  return <>{children}</>;
}
