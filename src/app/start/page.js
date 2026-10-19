"use client";

import { useEffect } from "react";

export default function StartPage() {
  useEffect(() => {
    window.location.replace("/");
  }, []);
  return <main aria-busy="true" style={{ minHeight: "100dvh", background: "#f4f7f5" }} />;
}
