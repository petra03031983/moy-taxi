import "./astana-map.css";

export const metadata = {
  title: "Астана Гид",
  description: "Астана Гид — подробная карта Астаны, поиск адресов и построение маршрутов.",
  applicationName: "Астана Гид",
  manifest: "/astana-map-manifest.webmanifest",
  icons: {
    icon: "/astana-map-icon-user-20261108.jpg",
    shortcut: "/astana-map-icon-user-20261108.jpg",
    apple: "/astana-map-icon-user-20261108.jpg"
  }
};

export default function AstanaMapLayout({ children }) {
  return children;
}
