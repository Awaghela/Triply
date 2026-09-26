"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Avatar } from "./primitives";

export function Topbar({ tripName }: { tripName?: string }) {
  const { user, logout } = useAuth();
  const router = useRouter();

  return (
    <header className="border-b border-ink/10 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 -rotate-6 items-center justify-center rounded-md bg-ink text-paper">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M3 12l7-9v6h11l-7 9v-6H3z" fill="currentColor" />
              </svg>
            </div>
            <span className="font-display text-lg font-medium">Triply</span>
          </Link>
          {tripName && (
            <>
              <span className="text-ink/25">/</span>
              <span className="text-sm font-medium text-ink/70">{tripName}</span>
            </>
          )}
        </div>
        {user && (
          <div className="flex items-center gap-3">
            <Avatar name={user.name} color={user.avatar_color} size="sm" />
            <span className="hidden text-sm text-ink/70 sm:inline">{user.name}</span>
            <button
              onClick={() => {
                logout();
                router.push("/");
              }}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-ink/50 hover:bg-ink/5 hover:text-ink"
            >
              Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
