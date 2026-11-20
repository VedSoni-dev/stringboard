import type { Metadata } from "next";
import { StudioProvider } from "@/kit/react/studio";

export const metadata: Metadata = { title: "App" };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <StudioProvider>{children}</StudioProvider>;
}
