"use client";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { Tooltip } from "react-tooltip";
import {
  IdolConfig,
  StageConfig,
  IdolStageConfig,
  STRATEGIES,
} from "gakumas-engine";

import Button from "@/components/Button";
import Input from "@/components/Input";
import KofiAd from "@/components/KofiAd";
import Loader from "@/components/Loader";
import LoadoutSkillCardGroup from "@/components/LoadoutSkillCardGroup";
import ParametersInput from "@/components/ParametersInput";
import StagePItems from "@/components/StagePItems";
import StageSelect from "@/components/StageSelect";
import EntityIcon from "@/components/EntityIcon";

import LoadoutContext from "@/contexts/LoadoutContext";
import WorkspaceContext from "@/contexts/WorkspaceContext";

import { simulate } from "@/simulator";
import { MAX_WORKERS, SYNC } from "@/simulator/constants";
import { logEvent } from "@/utils/logging";
import {
  bucketScores,
  getMedianScore,
  mergeResults,
  getIndications,
} from "@/utils/simulator";
import { formatStageShortName } from "@/utils/stages";
import { EntityTypes } from "@/utils/entities";

import DeckExplorerButtons from "@/components/DeckExplorer/DeckExplorerButtons";
import DeckExplorerSubTools from "@/components/DeckExplorer/DeckExplorerSubTools";
// import DeckExplorerResult from "@/components/DeckExplorerResult/DeckExplorerResult";

import styles from "@/components/DeckExplorer/DeckExplorer.module.scss";

const DE_NUM_RUNS = 50;

function generateItemCombos(currentItems, candidates) {
  const fixed = currentItems[0];
  const mutable = currentItems.slice(1).filter((id) => id !== null);
  const allUsableItems = Array.from(new Set([...mutable, ...candidates]));
  if (allUsableItems.length < 2) return [];
  const results = [];
  function permute(arr, combo = []) {
    if (combo.length === 2) {
      results.push([fixed, ...combo]);
      return;
    }
    for (let i = 0; i < arr.length; i++) {
      if (combo.includes(arr[i])) continue;
      permute(arr, [...combo, arr[i]]);
    }
  }
  permute(allUsableItems);
  return results;
}

export default function DeckExplorer() {
  const t = useTranslations("Simulator");

  const {
    stage,
    loadout,
    simulatorUrl,
    setSupportBonus,
    setParams,
    replacePItemId,
    pushLoadoutHistory,
  } = useContext(LoadoutContext);
  const { plan, idolId } = useContext(WorkspaceContext);

  const [strategy, setStrategy] = useState("HeuristicStrategy");
  const [simulatorData, setSimulatorData] = useState(null);
  const [itemCandidates, setItemCandidates] = useState([null, null, null]);
  const [running, setRunning] = useState(false);
  const [doneMessage, setDoneMessage] = useState("");
  const [topCombos, setTopCombos] = useState([]);
  const workersRef = useRef();

  const config = useMemo(() => {
    const idolConfig = new IdolConfig(loadout);
    const stageConfig = new StageConfig(stage);
    return new IdolStageConfig(idolConfig, stageConfig);
  }, [loadout, stage]);

  const { pItemIndications, skillCardIndicationGroups } = getIndications(
    config,
    loadout
  );

  useEffect(() => {
    let numWorkers = 1;
    if (navigator.hardwareConcurrency) {
      numWorkers = Math.min(navigator.hardwareConcurrency, MAX_WORKERS);
    }
    workersRef.current = [];
    for (let i = 0; i < numWorkers; i++) {
      workersRef.current.push(
        new Worker(new URL("../../simulator/worker.js", import.meta.url))
      );
    }
    return () => workersRef.current?.forEach((worker) => worker.terminate());
  }, []);

  useEffect(() => {
    if (simulatorData) {
      document.getElementById("simulator_result")?.scrollIntoView({
        behavior: "smooth",
      });
    }
  }, [simulatorData]);

  const setResult = useCallback(
    (result) => {
      const bucketedScores = bucketScores(result.scores);
      const medianScore = getMedianScore(result.scores);
      console.timeEnd("simulation");
      console.log("All simulation scores:", result.scores);
      const average = (
        result.scores.reduce((sum, val) => sum + val, 0) / result.scores.length
      ).toFixed(2);
      console.log(`Average Score: ${average}`);
      setSimulatorData({ bucketedScores, medianScore, ...result });
      setRunning(false);
      setDoneMessage("完了");
    },
    [setSimulatorData, setRunning]
  );

  function replaceItemCandidate(index, id) {
    const updated = [...itemCandidates];
    updated[index] = id;
    setItemCandidates(updated);
  }

  async function runSimulation() {
    setRunning(true);
    setDoneMessage("");
    console.time("simulation");

    const combos = generateItemCombos(loadout.pItemIds, itemCandidates).slice(0, 20);
    const scored = [];

    for (const combo of combos) {
      const newLoadout = { ...loadout, pItemIds: combo };
      const newConfig = new IdolStageConfig(
        new IdolConfig(newLoadout),
        new StageConfig(stage)
      );
      const result = simulate(newConfig, strategy, DE_NUM_RUNS);
      const avg = result.scores.reduce((sum, v) => sum + v, 0) / result.scores.length;
      scored.push({ result, combo, avg });
      await new Promise((r) => setTimeout(r, 0));
    }

    scored.sort((a, b) => b.avg - a.avg);
    setResult(scored[0].result);
    setTopCombos(scored.slice(0, 5));
  }

  return (
    <div id="simulator_loadout" className={styles.loadoutEditor}>
      <div className={styles.configurator}>
        <StageSelect />
        {stage.type === "event" ? (
          t("enterPercents")
        ) : (
          <div className={styles.supportBonusInput}>
            <label>{t("supportBonus")}</label>
            <Input
              type="number"
              value={parseFloat(((loadout.supportBonus || 0) * 100).toFixed(2))}
              onChange={(value) =>
                setSupportBonus(parseFloat((value / 100).toFixed(4)))
              }
            />
          </div>
        )}

        <div className={styles.params}>
          <ParametersInput
            parameters={loadout.params}
            onChange={setParams}
            withStamina
            max={10000}
          />
          <div className={styles.typeMultipliers}>
            {Object.keys(config.typeMultipliers).map((param) => (
              <div key={param}>
                {Math.round(config.typeMultipliers[param] * 100)}%
              </div>
            ))}
            <div />
          </div>
        </div>

        <div className={styles.pItemsRow}>
          <div className={styles.pItems}>
            <StagePItems
              pItemIds={loadout.pItemIds}
              replacePItemId={replacePItemId}
              indications={pItemIndications}
              size="medium"
            />
          </div>
          <span>{formatStageShortName(stage, t)}</span>
        </div>

        <h4>アイテム候補（最大3つ）</h4>
        <StagePItems
          pItemIds={itemCandidates}
          replacePItemId={replaceItemCandidate}
          indications={[]}
          size="medium"
        />

        {loadout.skillCardIdGroups.map((skillCardIdGroup, i) => (
          <LoadoutSkillCardGroup
            key={i}
            skillCardIds={skillCardIdGroup}
            customizations={loadout.customizationGroups[i]}
            indications={skillCardIndicationGroups[i]}
            groupIndex={i}
            idolId={config.idol.idolId || idolId}
          />
        ))}

        <DeckExplorerSubTools defaultCardIds={config.defaultCardIds} />

        <select
          className={styles.strategySelect}
          value={strategy}
          onChange={(e) => setStrategy(e.target.value)}
        >
          {Object.keys(STRATEGIES).map((strategy) => (
            <option key={strategy} value={strategy}>
              {strategy}
            </option>
          ))}
        </select>

        <Button style="blue" onClick={runSimulation} disabled={running}>
          {running ? <Loader /> : t("simulate")}
        </Button>

        

        <DeckExplorerButtons />
        <div className={styles.url}>{simulatorUrl}</div>

        {topCombos.length > 0 && (
          <div className={styles.results}>
            <h4>上位5位組み合わせ</h4>
            <div className={styles.comboRow}>
              {topCombos.map((entry, idx) => (
                <div key={idx} className={styles.comboGroup}>
                  <div className={styles.comboIcons}>
                    {entry.combo.map((id, i) => (
                      <EntityIcon
                        key={i}
                        type={EntityTypes.P_ITEM}
                        id={id}
                        style="medium"
                      />
                    ))}
                  </div>
                  <div className={styles.comboScore}>
                    スコア: {Math.round(entry.avg)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* {simulatorData && (
        <DeckExplorerResult data={simulatorData} plan={plan} idolId={idolId} />
      )} */}

      

{/*       <KofiAd /> */}
    </div>
  );
}
