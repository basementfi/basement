"use client";

import FAQ from "@/components/FAQ";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export default function FAQPage() {
  return (
    <div className="relative min-h-screen flex flex-col">

      {/* Navbar */}
      <div className="w-full border-b" style={{ borderColor: "var(--border)" }}>
        <Navbar />
      </div>

      <main className="flex-1 flex flex-col items-center px-4 pt-10 pb-24 gap-8">
        <div className="max-w-2xl w-full">
          <FAQ />
        </div>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
