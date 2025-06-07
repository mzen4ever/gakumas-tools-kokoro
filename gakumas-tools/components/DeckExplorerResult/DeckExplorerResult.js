import { memo } from "react";
import { useTranslations } from "next-intl";
import DeckExplorerLogs from "@/components/DeckExplorerLogs/DeckExplorerLogs";
import DeckExplorerResultGraphs from "./DeckExplorerResultGraphs";
import styles from "./DeckExplorerResult.module.scss";
import KofiAd from "@/components/KofiAd";

function DeckExplorerResult({ data, idolId, plan }) {
  const t = useTranslations("SimulatorResult");

  return (
    <div id="simulator_result" className={styles.result}>
      <table className={styles.stats}>
        <thead>
          <tr>
            <th>{t("min")}</th>
            <th>{t("average")}</th>
            <th>{t("median")}</th>
            <th>{t("max")}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{data.minRun.score}</td>
            <td>{data.averageScore}</td>
            <td>{data.medianScore}</td>
            <td>{data.maxRun.score}</td>
          </tr>
        </tbody>
      </table>

      <DeckExplorerResultGraphs data={data} plan={plan} />

      <label>{t("logs")}</label>
      <DeckExplorerLogs
        minRun={data.minRun}
        averageRun={data.averageRun}
        maxRun={data.maxRun}
        idolId={idolId}
      />

      <KofiAd />
    </div>
  );
}

export default memo(DeckExplorerResult);
