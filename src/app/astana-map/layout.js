import "./astana-map.css";

export const metadata = {
  title: "Астана Гид",
  description: "Астана Гид — подробная карта Астаны, поиск адресов и построение маршрутов.",
  applicationName: "Астана Гид",
  manifest: "/astana-map-manifest.webmanifest",
  icons: {
    icon: "/astana-map-icon.jpg",
    shortcut: "/astana-map-icon.jpg",
    apple: "/astana-map-icon.jpg"
  }
};

export default function AstanaMapLayout({ children }) {
  return children;
}
