import Link from "next/link";
import PixelEditor from "@/components/PixelEditor";

export const metadata = { title: "Draw your character — Pixel Cafe" };

export default function CreatePage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/" className="font-pixel text-sm text-amber">← Pixel Cafe</Link>
        <h1 className="font-pixel text-sm sm:text-base">Character Studio</h1>
      </header>
      <PixelEditor />
    </main>
  );
}
