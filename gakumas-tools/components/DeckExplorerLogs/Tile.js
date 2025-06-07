import { memo } from "react";
import styles from "./DeckExplorerLogs.module.scss";

function Tile({ text }) {
  return <div className={styles.defaultTile}>{text}</div>;
}

export default memo(Tile);
