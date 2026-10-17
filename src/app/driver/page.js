import { redirect } from "next/navigation";

export default function DriverAlias() {
  redirect("/?role=driver&register=1");
}
