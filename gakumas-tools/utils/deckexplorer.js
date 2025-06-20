import { loadoutToSearchParams } from "./simulator";

/**
 * DeckExplorer 向け URL を生成
 */
export function getDeckExplorerUrl(loadout) {
  const searchParams = loadoutToSearchParams(loadout);
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://gakumas-tools-kokoro.onrender.com";
  return `${base}/deckexplorer?${searchParams.toString()}`;
}
