import "./astana-map.css";

export const metadata = {
  title: "Карта Астана",
  description: "Карта Астана — поиск адресов и построение маршрутов.",
  applicationName: "Карта Астана",
  manifest: "/astana-map-manifest.webmanifest",
  icons: {
    icon: "/astana-map-icon.svg",
    shortcut: "/astana-map-icon.svg",
    apple: "/astana-map-icon.svg"
  }
};

export default function AstanaMapLayout({ children }) {
  return children;
}
