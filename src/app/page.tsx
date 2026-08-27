"use client";

import Navbar from "@/components/Navbar";
import VaultList from "@/components/VaultList";
import VaultTable from "@/components/VaultTable";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <div className="relative min-h-screen flex flex-col">

      {/* Navbar */}
      <div className="w-full border-b" style={{ borderColor: "var(--border)" }}>
        <Navbar />
      </div>

      {/* Content */}
      <main className="flex-1 flex flex-col items-center px-4 gap-10 pt-6 pb-24">
        {/* Hero */}
        <div className="text-center flex flex-col items-center gap-6 pt-8 pb-2">
          <h1 className="text-4xl sm:text-7xl font-extrabold tracking-tight leading-[1.05] max-w-2xl">
            <span style={{ fontWeight: 700 }}>Deposit assets,</span>{" "}
            <br />
            <span style={{ color: "#34D399" }}>earn yield.</span>
          </h1>
        </div>

        <div className="max-w-[1440px] w-full">
          <VaultList />
        </div>

        <div className="max-w-[1440px] w-full">
          <VaultTable />
        </div>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
