import "./astana-map.css";

export const metadata = {
  title: "Астана Гид",
  description: "Астана Гид — подробная карта Астаны, поиск адресов и построение маршрутов.",
  applicationName: "Астана Гид",
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
