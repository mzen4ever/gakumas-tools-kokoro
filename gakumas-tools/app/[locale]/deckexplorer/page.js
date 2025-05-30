import { setRequestLocale } from "next-intl/server";
import DeckExplorer from "@/components/DeckExplorer";
import { generateMetadataForTool } from "@/utils/metadata";

export async function generateMetadata({ params }) {
  const { locale } = await params;
  return await generateMetadataForTool("deckexplorer", locale);
}

export default async function DeckExplorerPage({ params }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <DeckExplorer />;
}
