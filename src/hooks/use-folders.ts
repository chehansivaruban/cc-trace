"use client";

import { useEffect, useState } from "react";

export type Folders = { claude: string; projects: string; debug: string; home: string };

let cached: Promise<Folders | null> | null = null;

/** The folders cc-trace reads from (and the home folder, for masking). Fetched once per page load. */
export function useFolders(): Folders | null {
  const [folders, setFolders] = useState<Folders | null>(null);
  useEffect(() => {
    cached ??= fetch("/api/folders")
      .then((r) => (r.ok ? (r.json() as Promise<Folders>) : null))
      .catch(() => null);
    let live = true;
    void cached.then((f) => live && setFolders(f));
    return () => {
      live = false;
    };
  }, []);
  return folders;
}
