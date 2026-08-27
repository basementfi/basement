"use client";

import Navbar from "@/components/Navbar";
import Dashboard from "@/components/Dashboard";
import Footer from "@/components/Footer";

export default function DashboardPage() {
  return (
    <div className="relative min-h-screen flex flex-col">

      {/* Navbar */}
      <div className="w-full border-b" style={{ borderColor: "var(--border)" }}>
        <Navbar />
      </div>

      <main className="flex-1 flex flex-col items-center px-4 pt-6 pb-24 gap-6">
        <div className="max-w-[1440px] w-full">
          <Dashboard />
        </div>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
