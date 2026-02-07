import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Void — Device Sandbox",
  description: "Connect and control virtual smart devices via Enode Sandbox",
};

export default function DevicesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
