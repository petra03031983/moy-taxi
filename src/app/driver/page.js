import { redirect } from "next/navigation";

export const metadata = {
  title: "Мой Такси — Водитель",
  applicationName: "Мой Такси — Водитель",
  manifest: "/driver/manifest.webmanifest",
};

export default function DriverAlias() {
  redirect("/?role=driver&register=1");
}
